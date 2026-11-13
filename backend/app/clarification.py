from typing import Any


def analyze_request(text: str, schema: list[dict[str, Any]], prior_intent: dict[str, Any] | None = None) -> dict[str, Any]:
    normalized = text.lower()
    intent: dict[str, Any] = dict(prior_intent or {})
    intent["request"] = text
    if prior_intent and not prior_intent.get("missing"):
        return intent
    columns = {column["name"].lower() for table in schema for column in table.get("columns", [])}
    ranking = any(word in normalized for word in ("top", "best", "highest", "leading"))
    has_metric = any(word in normalized for word in ("number of", "count", "bookings", "orders", "revenue", "fare", "profit"))
    if ranking and "month" in normalized and has_metric and not any(word in normalized for word in ("each month", "per month", "monthly")):
        intent.update({"operation": "ranking", "metric": "count", "missing": ["ranking_scope"]})
        intent["ranking_scope_options"] = [
            "The top customer for each month",
            "One overall top customer across all months",
            "The top customer for a particular month",
        ]
    elif ranking and not intent.get("metric"):
        intent["operation"] = "ranking"
        numeric_hint = next((name for name in columns if any(word in name for word in ("revenue", "fare", "amount", "price", "count", "order"))), None)
        intent["missing"] = ["metric"] if not numeric_hint else []
        if not numeric_hint:
            intent["metric_options"] = [name for name in columns if name not in {"id", "customer_id"}][:5]
    elif "revenue" in normalized or "sales" in normalized:
        intent["operation"] = "aggregation"
        intent["metric"] = "revenue"
        intent["missing"] = [] if intent.get("time_range") else ["time_range"]
    else:
        intent["operation"] = "unknown"
        intent["missing"] = ["operation"]
    if "2025" in normalized:
        intent["time_range"] = "2025"
        intent["missing"] = [item for item in intent.get("missing", []) if item != "time_range"]
    return intent


def questions_for(intent: dict[str, Any]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    if "metric" in intent.get("missing", []):
        questions.append({"id": "metric", "question": "How should the results be ranked?", "kind": "single_choice", "options": ["Revenue", "Number of orders", "Profit"]})
    if "time_range" in intent.get("missing", []):
        questions.append({"id": "time_range", "question": "Which time period should be used?", "kind": "single_choice", "options": ["This year", "Last year", "All time"]})
    if "operation" in intent.get("missing", []):
        questions.append({"id": "operation", "question": "I couldn't identify an analysis operation. Would you like a count, total, average, trend, or ranking?", "kind": "single_choice", "options": ["Count", "Total", "Average", "Trend", "Ranking"]})
    if "ranking_scope" in intent.get("missing", []):
        questions.append({"id": "ranking_scope", "question": "Your request specifies a monthly ranking. Which result do you want?", "kind": "single_choice", "options": intent.get("ranking_scope_options", [])})
    return questions


def apply_answers(intent: dict[str, Any], answers: dict[str, str]) -> dict[str, Any]:
    updated = dict(intent)
    updated.update(answers)
    updated["missing"] = [item for item in intent.get("missing", []) if item not in answers]
    if "ranking_scope" in answers:
        updated["ranking_scope"] = answers["ranking_scope"]
    return updated
