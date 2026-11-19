import base64
import binascii
import json
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI, OpenAIError
from pydantic import BaseModel, Field


load_dotenv()

BASE_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="EASY-CHATGPT")

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_IMAGE_BYTES = 4 * 1024 * 1024


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str | list[dict] = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)


def get_client() -> tuple[OpenAI, str]:
    base_url = os.getenv("OPENAI_BASE_URL")
    api_key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("OPENAI_MODEL")

    missing = [
        name
        for name, value in (
            ("OPENAI_BASE_URL", base_url),
            ("OPENAI_API_KEY", api_key),
            ("OPENAI_MODEL", model),
        )
        if not value
    ]
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"Missing required environment variables: {', '.join(missing)}",
        )

    return OpenAI(base_url=base_url, api_key=api_key), model


def parse_data_url(url: str) -> tuple[str, int]:
    prefix, separator, encoded = url.partition(",")
    if not separator or not prefix.startswith("data:") or ";base64" not in prefix:
        raise HTTPException(status_code=400, detail="Images must be base64 data URLs.")

    mime_type = prefix[5:].split(";", 1)[0]
    if mime_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Images must be PNG, JPEG, or WebP.")

    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Image data URL is not valid base64.") from exc

    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Images must be 4 MB or smaller.")

    return mime_type, len(image_bytes)


def image_placeholder(mime_type: str, size: int) -> str:
    return f"[image: {mime_type}, {round(size / 1024)} KB]"


def prepare_messages(messages: list[ChatMessage]) -> tuple[list[dict], list[dict]]:
    model_messages = []
    sanitized_messages = []

    for message in messages:
        model_message = message.model_dump()
        sanitized_message = message.model_dump()

        if isinstance(model_message["content"], list):
            for index, part in enumerate(model_message["content"]):
                if part.get("type") != "image_url":
                    continue

                image_url = part.get("image_url")
                if not isinstance(image_url, dict) or not isinstance(image_url.get("url"), str):
                    raise HTTPException(status_code=400, detail="Image content parts must include an image_url.url.")

                mime_type, size = parse_data_url(image_url["url"])
                image_url["detail"] = "low"
                sanitized_message["content"][index]["image_url"]["url"] = image_placeholder(mime_type, size)
                sanitized_message["content"][index]["image_url"]["detail"] = "low"

        model_messages.append(model_message)
        sanitized_messages.append(sanitized_message)

    return model_messages, sanitized_messages


@app.post("/api/chat")
def chat(request: ChatRequest):
    client, model = get_client()
    messages, sanitized_messages = prepare_messages(request.messages)

    try:
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=False,
        )
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    answer = completion.choices[0].message.content or ""
    usage = completion.usage.model_dump() if completion.usage else None

    return {
        "answer": answer,
        "messages_sent": sanitized_messages,
        "usage": usage,
    }


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.post("/api/chat/stream")
def chat_stream(request: ChatRequest):
    client, model = get_client()
    messages, sanitized_messages = prepare_messages(request.messages)

    def stream_events():
        try:
            stream = client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
            )

            for chunk in stream:
                if chunk.usage:
                    yield sse_event("usage", chunk.usage.model_dump())

                if not chunk.choices:
                    continue

                content = chunk.choices[0].delta.content
                if content:
                    yield sse_event("token", {"content": content})

            yield sse_event("done", {"messages_sent": sanitized_messages})
        except OpenAIError as exc:
            yield sse_event("error", {"detail": str(exc)})
        except Exception as exc:
            yield sse_event("error", {"detail": str(exc)})

    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")


@app.get("/{full_path:path}")
def serve_frontend(full_path: str):
    index = FRONTEND_DIR / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="Frontend not found")
    return FileResponse(index)
