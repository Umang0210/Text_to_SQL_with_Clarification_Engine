import json
import logging
import time
from typing import Any

from .config import settings

logger = logging.getLogger(__name__)


class GeminiUnavailable(RuntimeError):
    pass


class GeminiService:
    def __init__(self) -> None:
        self._client = None
        if settings.gemini_api_key:
            from google import genai

            self._client = genai.Client(
                api_key=settings.gemini_api_key,
                http_options={"timeout": settings.gemini_timeout_seconds * 1000},
            )

    @property
    def configured(self) -> bool:
        return self._client is not None

    def generate_json(self, instruction: str, payload: dict[str, Any], retries: int | None = None) -> dict[str, Any]:
        if not self._client:
            raise GeminiUnavailable("Gemini is not configured. Set GEMINI_API_KEY on the backend.")
        prompt = f"{instruction}\n\nContext JSON:\n{json.dumps(payload, default=str)}"
        last_error: Exception | None = None
        retry_count = settings.gemini_retries if retries is None else retries
        for attempt in range(retry_count + 1):
            try:
                response = self._client.models.generate_content(
                    model=settings.gemini_model,
                    contents=prompt,
                    config={"response_mime_type": "application/json", "temperature": 0.1},
                )
                value = json.loads(response.text or "{}")
                if not isinstance(value, dict):
                    raise ValueError("Gemini returned a non-object JSON response")
                return value
            except Exception as error:
                last_error = error
                if attempt < retry_count:
                    time.sleep(2**attempt)
        raise GeminiUnavailable(f"Gemini request failed after retries: {last_error}") from last_error


gemini = GeminiService()
