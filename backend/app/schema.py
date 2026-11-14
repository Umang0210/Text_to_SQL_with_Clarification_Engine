from functools import lru_cache
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

from .config import settings


def _engine_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def dialect_for(url: str) -> str:
    return "postgres" if "postgres" in url else "sqlite"


@lru_cache(maxsize=32)
def _engine(url: str) -> Engine:
    engine_url = _engine_url(url)
    if engine_url.startswith("sqlite"):
        return create_engine(
            engine_url,
            poolclass=NullPool,
            connect_args={"check_same_thread": False, "timeout": settings.query_timeout_seconds},
        )
    return create_engine(
        engine_url,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args={"options": f"-c statement_timeout={settings.query_timeout_seconds * 1000}"},
    )


@lru_cache(maxsize=32)
def discover_schema(url: str) -> list[dict[str, Any]]:
    engine = _engine(url)
    with engine.connect() as connection:
        inspector = inspect(connection)
        result: list[dict[str, Any]] = []
        for table in inspector.get_table_names():
            columns = [
                {"name": column["name"], "type": str(column["type"]), "nullable": column["nullable"]}
                for column in inspector.get_columns(table)
            ]
            result.append(
                {
                    "table": table,
                    "columns": columns,
                    "primary_key": inspector.get_pk_constraint(table).get("constrained_columns", []),
                    "foreign_keys": inspector.get_foreign_keys(table),
                }
            )
        return result


def execute_read_only(url: str, sql: str, max_rows: int) -> tuple[list[str], list[dict[str, Any]]]:
    engine = _engine(url)
    with engine.connect() as connection:
        if url.startswith("sqlite"):
            connection.execute(text(f"PRAGMA busy_timeout = {settings.query_timeout_seconds * 1000}"))
        result = connection.execute(text(sql))
        rows = result.fetchmany(max_rows)
        return list(result.keys()), [dict(row._mapping) for row in rows]
