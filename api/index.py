"""Vercel ASGI entrypoint for the QueryMind FastAPI application."""

from backend.app.main import app

__all__ = ["app"]
