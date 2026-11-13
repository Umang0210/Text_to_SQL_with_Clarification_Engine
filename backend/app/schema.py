from typing import Any

from sqlalchemy import create_engine, inspect, text


def _engine_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def dialect_for(url: str) -> str:
    return "postgres" if "postgres" in url else "sqlite"


def discover_schema(url: str) -> list[dict[str, Any]]:
    engine = create_engine(_engine_url(url))
    inspector = inspect(engine)
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
    engine = create_engine(_engine_url(url))
    with engine.connect() as connection:
        result = connection.execute(text(sql))
        rows = result.fetchmany(max_rows)
        return list(result.keys()), [dict(row._mapping) for row in rows]
