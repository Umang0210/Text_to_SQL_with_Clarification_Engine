import re
from typing import Any

from .gemini import GeminiUnavailable, gemini

try:
    import sqlglot
    from sqlglot import exp
except ImportError:  # pragma: no cover
    sqlglot = None
    exp = None


def _is_text_column(expression: str, text_columns: set[str]) -> bool:
    column = expression.rsplit(".", 1)[-1].strip('"').lower()
    return column in text_columns and not re.match(r"(?is)^\s*lower\s*\(", expression)


def normalize_case_insensitive_text_comparisons(sql: str, schema: list[dict[str, Any]]) -> str:
    text_columns = {
        str(column["name"]).lower()
        for table in schema
        for column in table.get("columns", [])
        if re.match(r"(?is)^(text|varchar|character varying|char|character|citext)", str(column.get("type", "")))
    }

    def left_comparison(match: re.Match[str]) -> str:
        left, operator, literal = match.groups()
        operator = re.sub(r"\s+", " ", operator).upper()
        if not _is_text_column(left, text_columns):
            return match.group(0)
        if operator in {"=", "<>", "!="}:
            return f"LOWER({left}) {operator} LOWER({literal})"
        return f"{left} {operator.replace('LIKE', 'ILIKE')} {literal}"

    normalized = re.sub(
        r"""(\b(?:(?:[a-z_]\w*)\.)?(?:"[^"]+"|[a-z_]\w*))\s*(=|<>|!=|LIKE|NOT\s+LIKE)\s*('(?:''|[^'])*')""",
        left_comparison,
        sql,
        flags=re.IGNORECASE,
    )

    def right_comparison(match: re.Match[str]) -> str:
        literal, operator, right = match.groups()
        operator = re.sub(r"\s+", " ", operator).upper()
        if not _is_text_column(right, text_columns):
            return match.group(0)
        if operator in {"=", "<>", "!="}:
            return f"LOWER({literal}) {operator} LOWER({right})"
        return f"{literal} {operator.replace('LIKE', 'ILIKE')} {right}"

    normalized = re.sub(
        r"""('(?:''|[^'])*')\s*(=|<>|!=|LIKE|NOT\s+LIKE)\s*(\b(?:(?:[a-z_]\w*)\.)?(?:"[^"]+"|[a-z_]\w*))""",
        right_comparison,
        normalized,
        flags=re.IGNORECASE,
    )
    return re.sub(
        r"""(\b(?:(?:[a-z_]\w*)\.)?(?:"[^"]+"|[a-z_]\w*))\s*=\s*(\b(?:(?:[a-z_]\w*)\.)?(?:"[^"]+"|[a-z_]\w*))""",
        lambda match: (
            f"LOWER({match.group(1)}) = LOWER({match.group(2)})"
            if _is_text_column(match.group(1), text_columns) and _is_text_column(match.group(2), text_columns)
            else match.group(0)
        ),
        normalized,
        flags=re.IGNORECASE,
    )


def validate_sql(sql: str, schema: list[dict[str, Any]], max_rows: int = 500) -> tuple[bool, str | None, list[str]]:
    errors: list[str] = []
    normalized = normalize_case_insensitive_text_comparisons(sql.strip().rstrip(";"), schema)
    if not normalized:
        return False, None, ["SQL is required"]
    if sqlglot:
        try:
            tree = sqlglot.parse_one(normalized)
            if not isinstance(tree, exp.Select):
                errors.append("Only read-only SELECT statements are allowed")
        except Exception as error:
            errors.append(f"SQL parse error: {error}")
    elif not re.match(r"(?is)^select\b", normalized):
        errors.append("Only read-only SELECT statements are allowed")
    allowed_tables = {item["table"] for item in schema}
    referenced = {match.lower() for match in re.findall(r"(?i)\b(?:from|join)\s+([a-zA-Z_][\w]*)", normalized)}
    unknown = sorted(table for table in referenced if table not in {name.lower() for name in allowed_tables})
    if unknown:
        errors.append(f"Unknown table(s): {', '.join(unknown)}")
    if errors:
        return False, None, errors
    if not re.search(r"(?i)\blimit\s+\d+", normalized):
        normalized += f" LIMIT {max_rows}"
    return True, normalized, []


def generate_sql(intent: dict[str, Any], schema: list[dict[str, Any]]) -> str:
    if gemini.configured:
        try:
            result = gemini.generate_json(
                "Generate one read-only SQL SELECT statement. Use only tables and columns in the schema. For text equality use LOWER(column) = LOWER('value'); for text pattern matching use ILIKE. Apply this to WHERE, HAVING, AND/OR filters, and text JOIN comparisons. Do not lower numeric, date, boolean, NULL, or other non-text values. Return JSON with a sql string. Do not explain or invent identifiers.",
                {"intent": intent, "schema": schema},
            )
            sql = result.get("sql")
            if not isinstance(sql, str) or not sql.strip():
                raise ValueError("Gemini returned no SQL")
            return sql
        except GeminiUnavailable:
            raise
    tables = {item["table"]: {column["name"] for column in item["columns"]} for item in schema}
    if "orders" in tables:
        if intent.get("operation") == "ranking":
            metric = "revenue" if intent.get("metric", "").lower() == "revenue" else "order_count"
            expression = "SUM(revenue)" if metric == "revenue" and "revenue" in tables["orders"] else "COUNT(*)"
            return f"SELECT customer_id, {expression} AS {metric} FROM orders GROUP BY customer_id ORDER BY {metric} DESC LIMIT 10"
        if intent.get("metric") == "revenue" and "revenue" in tables["orders"]:
            return "SELECT SUM(revenue) AS total_revenue FROM orders"
    all_columns = {column for columns in tables.values() for column in columns}
    table = next(iter(tables), None)
    if table:
        if intent.get("operation") == "aggregation" and intent.get("metric") == "count":
            return f"SELECT COUNT(*) AS total_count FROM {table}"
        if intent.get("operation") == "ranking":
            group_column = next((column for column in ("customer_name", "customer_id", "city") if column in tables[table]), None)
            if group_column:
                return f"SELECT {group_column}, COUNT(*) AS booking_count FROM {table} GROUP BY {group_column} ORDER BY booking_count DESC LIMIT 10"
        if intent.get("operation") == "unknown":
            raise ValueError("I could not identify a supported operation for this dataset")
    if not table:
        raise ValueError("No tables are available for SQL generation")
    return f"SELECT * FROM {table}"
