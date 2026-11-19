# EASY-CHATGPT

Chat app with a vanilla HTML/CSS/JavaScript frontend and a FastAPI backend proxying requests to an OpenAI-compatible chat completions API.

The browser never calls the model directly. It sends conversation messages to FastAPI, and FastAPI calls the configured model using values from `.env`.

The UI uses the streaming endpoint, `POST /api/chat/stream`, which proxies tokens as server-sent events. The original non-streaming endpoint, `POST /api/chat`, remains available and returns the full answer at once.

The UI also supports one image attachment per user message. Images are sent in OpenAI Chat Completions format as `image_url` content parts with base64 data URLs and `detail: "low"` to keep image token cost down.

## Files

```text
.
├── .env.example
├── .gitignore
├── README.md
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── __init__.py
│       └── main.py
└── frontend/
    ├── index.html
    ├── styles.css
    └── app.js
```

## Configuration

Copy the example file and fill in your provider details:

```bash
cp .env.example .env
```

Required variables:

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=replace-with-your-api-key
OPENAI_MODEL=gpt-4o-mini
```

Use your provider's OpenAI-compatible base URL and model name if you are not using OpenAI directly.

`gpt-4o-mini` is vision-capable. If you use another provider or model, set `OPENAI_MODEL` to a model that supports image input.

## Image Limits

- One image per message
- PNG, JPEG, or WebP only
- 4 MB maximum file size
- Data URLs only, no remote image URLs

## Run With Docker

```bash
docker compose up --build
```

Open:

```text
http://localhost:6661
```

## Run Locally Without Docker

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 6661
```

Open:

```text
http://localhost:6661
```

## Context View

After each turn, the right panel shows:

- `messages_sent`: the exact messages FastAPI sent to the model
- `usage`: the token usage object returned by the OpenAI-compatible API

This lets you watch the conversation context and token counts grow turn by turn. In streaming mode, token usage is requested from the provider with `stream_options.include_usage` and displayed when the turn completes.

Image data is never shown in the context panel. The backend sanitizes `messages_sent` for both `/api/chat` and `/api/chat/stream`, replacing base64 data URLs with placeholders like `[image: image/png, 312 KB]`.

Images remain in the conversation context for follow-up questions, so the image is resent on later turns until you clear the chat. That makes follow-up questions work, but it also means image token cost is paid again while the image remains in context.

## Verify Vision

1. Confirm your existing `.env` has a vision-capable model, such as `OPENAI_MODEL=gpt-4o-mini`.

2. Start the app with your usual command.

3. Open `http://localhost:6661`.

4. Send a text-only message and confirm the response still streams.

5. Attach a PNG, JPEG, or WebP image under 4 MB and ask `What is in this image?`.

6. Confirm the answer streams token by token.

7. Confirm the context panel shows an `image_url` content part with a placeholder like `[image: image/png, 312 KB]`, not the full base64 data URL.

8. Ask a follow-up question without reattaching the image and confirm the model still answers about the image.

9. Try an unsupported or oversized image and confirm the UI shows a readable error.
