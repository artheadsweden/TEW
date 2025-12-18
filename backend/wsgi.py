"""WSGI entrypoint for production servers (e.g. Render).

Render expects a process binding to $PORT. Gunicorn imports `app` from here.
"""

from app import create_app

app = create_app()
