from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ConnectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1)


class ConnectionResponse(BaseModel):
    id: str
    name: str
    dialect: str


class DatasetResponse(BaseModel):
    id: str
    connection_id: str
    name: str
    filename: str
    size_bytes: int
    uploaded_at: datetime
    tables: list[dict[str, Any]]
    preview: list[dict[str, Any]]
    duplicate_rows: int
    potential_primary_keys: dict[str, list[str]]


class MessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class ClarificationQuestion(BaseModel):
    id: str
    question: str
    kind: str = "single_choice"
    options: list[str] = []


class QueryResponse(BaseModel):
    status: str
    conversation_id: str
    message: str
    questions: list[ClarificationQuestion] = []
    sql: str | None = None
    columns: list[str] = []
    rows: list[dict[str, Any]] = []
    explanation: str | None = None
    execution_ms: float | None = None
    dataset_name: str | None = None
    validation_status: str | None = None
    created_at: datetime


class ValidationResponse(BaseModel):
    valid: bool
    normalized_sql: str | None = None
    errors: list[str] = []
