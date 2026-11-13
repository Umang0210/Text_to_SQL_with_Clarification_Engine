import re
from typing import Any

try:
    import sqlglot
    from sqlglot import exp
except ImportError:  # pragma: no cover
    sqlglot = None
    exp = None


def validate_sql(sql: str, schema: list[dict[str, Any]], max_rows: int = 500) -> tuple[bool, str | None, list[str]]:
    errors: list[str] = []
    normalized = sql.strip().rstrip(";")
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
