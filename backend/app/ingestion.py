import csv
import json
import re
import sqlite3
from pathlib import Path
from typing import Any
from uuid import uuid4

from openpyxl import load_workbook

from .config import settings

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json", ".db", ".sqlite", ".sqlite3"}


def _safe_identifier(value: str, fallback: str = "table") -> str:
    cleaned = re.sub(r"\W+", "_", value.strip().lower()).strip("_")
    return cleaned or fallback


def _rows_from_csv(path: Path) -> list[tuple[str, list[dict[str, Any]]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    return [(_safe_identifier(path.stem), rows)]


def _rows_from_json(path: Path) -> list[tuple[str, list[dict[str, Any]]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = next((value for value in data.values() if isinstance(value, list)), [data])
    if not isinstance(data, list) or not all(isinstance(row, dict) for row in data):
        raise ValueError("JSON must contain an object or an array of objects")
    return [(_safe_identifier(path.stem), data)]


def _rows_from_workbook(path: Path, selected_sheets: list[str] | None) -> list[tuple[str, list[dict[str, Any]]]]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    names = selected_sheets or workbook.sheetnames
    missing = set(names) - set(workbook.sheetnames)
    if missing:
        raise ValueError(f"Unknown sheet(s): {', '.join(sorted(missing))}")
    result = []
    for name in names:
        values = list(workbook[name].values)
        if not values:
            continue
        headers = [_safe_identifier(str(value), f"column_{index}") for index, value in enumerate(values[0])]
        result.append((_safe_identifier(name), [dict(zip(headers, row)) for row in values[1:] if any(value is not None for value in row)]))
    return result


def _inspect_existing(path: Path) -> tuple[list[tuple[str, list[dict[str, Any]]]], sqlite3.Connection]:
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    return [(table, [dict(row) for row in connection.execute(f'SELECT * FROM "{table}" LIMIT 100')]) for table in tables], connection


def ingest_file(filename: str, content: bytes, selected_sheets: list[str] | None = None) -> dict[str, Any]:
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise ValueError("Supported formats are CSV, Excel, JSON and SQLite")
    if len(content) > settings.max_upload_bytes:
        raise ValueError(f"File exceeds the {settings.max_upload_bytes // (1024 * 1024)} MB limit")
    upload_root = Path(settings.upload_dir)
    upload_root.mkdir(parents=True, exist_ok=True)
    dataset_id = str(uuid4())
    source = upload_root / f"{dataset_id}{extension}"
    source.write_bytes(content)
    if extension in {".db", ".sqlite", ".sqlite3"}:
        rows, source_connection = _inspect_existing(source)
    else:
        if extension == ".csv":
            rows = _rows_from_csv(source)
        elif extension == ".json":
            rows = _rows_from_json(source)
        else:
            rows = _rows_from_workbook(source, selected_sheets)
        source_connection = None
    database_path = upload_root / f"{dataset_id}.querymind.db"
    target = sqlite3.connect(database_path)
    try:
        for table, records in rows:
            if not records:
                continue
            columns = list(records[0])
            quoted_columns = ", ".join(f'"{column}"' for column in columns)
            target.execute(f'DROP TABLE IF EXISTS "{table}"')
            target.execute(f'CREATE TABLE "{table}" ({", ".join(f"""\"{column}\" TEXT""" for column in columns)})')
            target.executemany(f'INSERT INTO "{table}" ({quoted_columns}) VALUES ({", ".join("?" for _ in columns)})', [[record.get(column) for column in columns] for record in records])
        target.commit()
        metadata = _metadata(target)
    finally:
        target.close()
        if source_connection:
            source_connection.close()
    return {"id": dataset_id, "url": f"sqlite:///{database_path.resolve()}", "metadata": metadata, "size_bytes": len(content)}


def _metadata(connection: sqlite3.Connection) -> dict[str, Any]:
    tables = []
    preview: list[dict[str, Any]] = []
    duplicate_rows = 0
    keys: dict[str, list[str]] = {}
    for (table,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table'"):
        columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
        records = [dict(row) for row in connection.execute(f'SELECT * FROM "{table}" LIMIT 100')]
        count = connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        duplicates = connection.execute(f'SELECT COUNT(*) - COUNT(DISTINCT ({", ".join(f"""\"{c}\"""" for c in columns)})) FROM "{table}"').fetchone()[0] or 0
        duplicate_rows += max(0, duplicates)
        candidates = [column for column in columns if connection.execute(f'SELECT COUNT(*) FROM "{table}" WHERE "{column}" IS NULL OR "{column}" = ""').fetchone()[0] == 0 and connection.execute(f'SELECT COUNT(DISTINCT "{column}") FROM "{table}"').fetchone()[0] == count]
        tables.append({"table": table, "columns": [{"name": column, "type": "TEXT"} for column in columns], "row_count": count})
        keys[table] = candidates
        preview.extend(records[:100])
    return {"tables": tables, "preview": preview[:100], "duplicate_rows": duplicate_rows, "potential_primary_keys": keys}
