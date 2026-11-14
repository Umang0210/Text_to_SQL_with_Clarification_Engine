from typing import Any
import logging

from .gemini import GeminiUnavailable, gemini

logger = logging.getLogger(__name__)

def interpret_result(sql: str, rows: list[dict[str, Any]], dataset_name: str) -> str:
    if gemini.configured:
        try:
            result = gemini.generate_json(
                "Explain only the supplied SQL result. Return JSON with a concise explanation string. Never invent values or findings.",
                {"sql": sql, "rows": rows, "dataset": dataset_name},
            )
            explanation = result.get("explanation")
            if isinstance(explanation, str) and explanation.strip():
                return explanation
        except GeminiUnavailable:
            logger.exception("result_explanation_failed")
    return f"Returned {len(rows)} row(s) from {dataset_name}."
