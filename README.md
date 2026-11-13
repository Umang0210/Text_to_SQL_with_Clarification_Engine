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

External LLM providers can be added behind `LLMProvider`; no API keys are required for the local fallback.
