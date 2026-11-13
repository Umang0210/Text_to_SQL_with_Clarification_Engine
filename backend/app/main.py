from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .clarification import analyze_request, apply_answers, questions_for
from .config import settings
from .ingestion import ingest_file
from .models import ConnectionCreate, ConnectionResponse, DatasetResponse, MessageRequest, QueryResponse, ValidationResponse
from .schema import discover_schema, dialect_for, execute_read_only
from .sql import generate_sql, validate_sql
from .store import Dataset, store

app = FastAPI(title="QueryMind API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/connections", response_model=ConnectionResponse)
def create_connection(payload: ConnectionCreate) -> ConnectionResponse:
    connection = store.add_connection(payload.name, payload.url, dialect_for(payload.url))
    return ConnectionResponse(id=connection["id"], name=connection["name"], dialect=connection["dialect"])


@app.get("/connections")
def list_connections() -> list[ConnectionResponse]:
    return [ConnectionResponse(id=item["id"], name=item["name"], dialect=item["dialect"]) for item in store.connections.values()]


@app.post("/datasets/upload", response_model=DatasetResponse)
async def upload_dataset(file: UploadFile = File(...), sheets: str | None = Form(None)) -> DatasetResponse:
    try:
        content = await file.read()
        selected = [item.strip() for item in sheets.split(",") if item.strip()] if sheets else None
        result = ingest_file(file.filename or "dataset", content, selected)
    except (ValueError, OSError) as error:
        raise HTTPException(400, str(error)) from error
    dataset = store.add_connection(Path(file.filename or "dataset").stem, result["url"], "sqlite")
    dataset_record = Dataset(
        result["id"], dataset["name"], file.filename or "dataset", result["url"], result["size_bytes"], datetime.now(timezone.utc), result["metadata"]
    )
    store.datasets[result["id"]] = dataset_record
    store.active_dataset_id = result["id"]
    return DatasetResponse(id=result["id"], name=dataset_record.name, filename=dataset_record.filename, size_bytes=dataset_record.size_bytes, uploaded_at=dataset_record.uploaded_at, tables=result["metadata"]["tables"], preview=result["metadata"]["preview"], duplicate_rows=result["metadata"]["duplicate_rows"], potential_primary_keys=result["metadata"]["potential_primary_keys"])


@app.get("/datasets")
def list_datasets() -> list[DatasetResponse]:
    return [_dataset_response(dataset) for dataset in store.datasets.values()]


def _dataset_response(dataset: Any) -> DatasetResponse:
    metadata = dataset.metadata
    return DatasetResponse(id=dataset.id, name=dataset.name, filename=dataset.filename, size_bytes=dataset.size_bytes, uploaded_at=dataset.uploaded_at, tables=metadata["tables"], preview=metadata["preview"], duplicate_rows=metadata["duplicate_rows"], potential_primary_keys=metadata["potential_primary_keys"])


@app.post("/datasets/{dataset_id}/activate")
def activate_dataset(dataset_id: str) -> DatasetResponse:
    dataset = store.datasets.get(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    store.active_dataset_id = dataset_id
    return _dataset_response(dataset)


def _connection(connection_id: str) -> dict[str, str]:
    connection = store.connections.get(connection_id)
    if not connection:
        raise HTTPException(404, "Connection not found")
    return connection


@app.get("/connections/{connection_id}/schema")
def get_schema(connection_id: str) -> list[dict[str, Any]]:
    return discover_schema(_connection(connection_id)["url"])


@app.post("/conversations")
def create_conversation(connection_id: str) -> dict[str, str]:
    _connection(connection_id)
    conversation = store.create_conversation(connection_id)
    return {"id": conversation.id}


@app.post("/conversations/{conversation_id}/messages", response_model=QueryResponse)
def send_message(conversation_id: str, payload: MessageRequest) -> QueryResponse:
    conversation = store.conversations.get(conversation_id)
    if not conversation:
        raise HTTPException(404, "Conversation not found")
    conversation.messages.append({"role": "user", "content": payload.content})
    connection = _connection(conversation.connection_id)
    schema = discover_schema(connection["url"])
    intent = analyze_request(payload.content, schema, conversation.intent)
    conversation.intent = intent
    questions = questions_for(intent)
    now = datetime.now(timezone.utc)
    if questions:
        conversation.pending_questions = questions
        return QueryResponse(status="clarification_required", conversation_id=conversation_id, message="I found a specific ambiguity that changes the result.", questions=questions, created_at=now, dataset_name=connection["name"])
    sql = generate_sql(intent, schema)
    valid, normalized, errors = validate_sql(sql, schema, settings.max_rows)
    if not valid or not normalized:
        raise HTTPException(422, {"errors": errors})
    try:
        columns, rows = execute_read_only(connection["url"], normalized, settings.max_rows)
    except Exception as error:
        store.add_query(conversation_id, payload.content, normalized, "failed")
        raise HTTPException(422, f"Query execution failed: {error}") from error
    store.add_query(conversation_id, payload.content, normalized, "success")
    return QueryResponse(status="completed", conversation_id=conversation_id, message="Query completed.", sql=normalized, columns=columns, rows=rows, explanation=f"Returned {len(rows)} row(s) from {connection['name']}.", created_at=now, dataset_name=connection["name"], validation_status="valid")


@app.post("/conversations/{conversation_id}/clarifications", response_model=QueryResponse)
def answer_clarification(conversation_id: str, answers: dict[str, str]) -> QueryResponse:
    conversation = store.conversations.get(conversation_id)
    if not conversation:
        raise HTTPException(404, "Conversation not found")
    conversation.intent = apply_answers(conversation.intent or {}, answers)
    return send_message(conversation_id, MessageRequest(content=conversation.intent.get("request", "")))


@app.post("/sql/validate", response_model=ValidationResponse)
def validate_endpoint(connection_id: str, sql: str) -> ValidationResponse:
    schema = get_schema(connection_id)
    valid, normalized, errors = validate_sql(sql, schema, settings.max_rows)
    return ValidationResponse(valid=valid, normalized_sql=normalized, errors=errors)


@app.get("/queries/history")
def query_history() -> list[dict[str, Any]]:
    return [record.__dict__ for record in reversed(store.queries)]
