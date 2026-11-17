# EASY-CHATGPT

Baseline chat app with a vanilla HTML/CSS/JavaScript frontend and a FastAPI backend proxying requests to an OpenAI-compatible chat completions API.

The browser never calls the model directly. It sends conversation messages to FastAPI, and FastAPI calls the configured model using values from `.env`.

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

This lets you watch the conversation context and token counts grow turn by turn.
