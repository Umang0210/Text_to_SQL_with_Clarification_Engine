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

The Next.js app and all QueryMind API routes live under `frontend/`. Set the Vercel project **Root Directory** to `frontend`. From that configured root, use `npm install` and `npm run build`; do not prefix commands with `frontend/`. `NEXT_PUBLIC_API_URL=/api` keeps browser requests same-origin.

The API uses Vercel Node.js route handlers under `frontend/app/api/`. Vercel functions are stateless, so uploaded dataset tables and metadata are stored in the external PostgreSQL database configured by `DATABASE_URL`. Uploaded SQLite files are read in memory and imported into PostgreSQL; no Vercel filesystem data is treated as durable. Object storage is not required by the current import path because the queryable data is persisted as PostgreSQL tables.

### Production environment variables

Configure these in Vercel for **Production, Preview, and Development** as appropriate:

```text
DATABASE_URL=your-Vercel-Postgres-or-Neon-connection-string
GEMINI_API_KEY=your-server-only-Gemini-key
GEMINI_MODEL=gemini-2.5-flash
NEXT_PUBLIC_API_URL=/api
```

`GEMINI_API_KEY` is read only in server route modules and is never exposed to the browser. The current PostgreSQL schema is created automatically on first request. The database user needs permission to create tables and insert/select data.

Vercel serverless request bodies are limited, so the direct upload route accepts files up to 4 MB. For larger datasets, add direct browser-to-object-storage uploads and an asynchronous import worker; do not increase the route limit beyond the platform request limit.

Dataset management is backed by PostgreSQL through these same-origin routes:

- `GET /api/datasets/[id]/preview` provides paginated, searchable, sortable records.
- `GET /api/datasets/[id]/download` exports a selected dataset table as CSV.
- `GET /api/datasets/[id]/insights` returns live column-level counts and null statistics.
- `PATCH /api/datasets/[id]/rename` updates dataset metadata without changing physical tables.
- `DELETE /api/datasets/[id]` drops only the dataset-owned tables and associated metadata in one transaction.

The database role must also have permission to create and drop imported tables. Dataset deletion is intentionally explicit in the UI and requires confirmation.
