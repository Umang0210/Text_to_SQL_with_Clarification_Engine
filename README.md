# QueryMind

QueryMind is a conversational Text-to-SQL application centered on an intelligent clarification workflow.

## Quick start

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API is available at `http://localhost:8000` and its OpenAPI documentation at `/docs`.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

The frontend is available at `http://localhost:3000`. Set `NEXT_PUBLIC_API_URL` when the backend is not running on port 8000.

### Docker

```powershell
docker compose up --build
```

The included demo connection uses SQLite so the vertical slice works without external credentials. PostgreSQL and pgvector services are included for production-oriented development.

## Current capabilities

- Conversation state with clarification questions.
- Deterministic clarification for common ambiguous requests.
- SQLite and PostgreSQL schema discovery.
- Provider-independent SQL generation interface with a local fallback.
- Read-only SQL validation, identifier checks, limits, and execution.
- Query history and result interpretation.
- Next.js workspace for chat, SQL preview, and tabular results.

## Gemini configuration

Gemini is the primary provider when `GEMINI_API_KEY` is set. The backend keeps the key server-side and uses the same service for intent extraction, clarification, SQL generation, and result interpretation.

```powershell
$env:GEMINI_API_KEY="your_gemini_api_key"
$env:GEMINI_MODEL="gemini-2.5-flash"
```

Without a key, the deterministic local intent/SQL path remains available for development and tests. When a key is configured but Gemini is unavailable, the API returns an explicit `503` rather than claiming that an AI operation succeeded.

## Vercel deployment

The Next.js app lives in `frontend/`. The root [`vercel.json`](./vercel.json) directs Vercel to install and build from that directory. In the Vercel project settings, set **Root Directory** to `frontend` when using the standard dashboard flow, or deploy from the repository root using the included configuration. Set `NEXT_PUBLIC_API_URL` to the deployed FastAPI URL; Gemini variables belong only to the backend host.

Vercel cannot host the FastAPI process from this Next.js deployment. Deploy `backend/` separately and configure `CORS_ALLOWED_ORIGINS` with the Vercel origin.

The production frontend requires `NEXT_PUBLIC_API_URL` at build time. It intentionally does not fall back to localhost in a deployed browser, because that would make uploads fail with a misleading network error.
