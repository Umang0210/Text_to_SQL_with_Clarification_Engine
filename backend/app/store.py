from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


@dataclass
class Conversation:
    id: str
    connection_id: str
    messages: list[dict[str, str]] = field(default_factory=list)
    intent: dict[str, Any] | None = None
    pending_questions: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class QueryRecord:
    id: str
    conversation_id: str
    request: str
    sql: str
    status: str
    created_at: datetime


@dataclass
class Dataset:
    id: str
    connection_id: str
    name: str
    filename: str
    url: str
    size_bytes: int
    uploaded_at: datetime
    metadata: dict[str, Any]


class MemoryStore:
    def __init__(self) -> None:
        self.connections: dict[str, dict[str, str]] = {}
        self.conversations: dict[str, Conversation] = {}
        self.queries: list[QueryRecord] = []
        self.datasets: dict[str, Dataset] = {}
        self.active_dataset_id: str | None = None

    def add_connection(self, name: str, url: str, dialect: str) -> dict[str, str]:
        connection = {"id": str(uuid4()), "name": name, "url": url, "dialect": dialect}
        self.connections[connection["id"]] = connection
        return connection

    def create_conversation(self, connection_id: str) -> Conversation:
        conversation = Conversation(str(uuid4()), connection_id)
        self.conversations[conversation.id] = conversation
        return conversation

    def add_query(self, conversation_id: str, request: str, sql: str, status: str) -> None:
        self.queries.append(QueryRecord(str(uuid4()), conversation_id, request, sql, status, datetime.now(timezone.utc)))


store = MemoryStore()
