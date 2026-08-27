"""Vercel entrypoint for the Disaster Response Intelligence API.

Vercel detects the FastAPI application exported as `app`. Static files in the
repository's public directory are served at the site root.
"""

from backend.main import app

__all__ = ["app"]
