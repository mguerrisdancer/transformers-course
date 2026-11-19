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


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


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


@app.post("/api/chat")
def chat(request: ChatRequest):
    client, model = get_client()
    messages = [message.model_dump() for message in request.messages]

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
        "messages_sent": messages,
        "usage": usage,
    }


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.post("/api/chat/stream")
def chat_stream(request: ChatRequest):
    client, model = get_client()
    messages = [message.model_dump() for message in request.messages]

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

            yield sse_event("done", {"messages_sent": messages})
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
