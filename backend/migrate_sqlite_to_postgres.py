#!/usr/bin/env python3
"""Migrate local SQLite data to a Postgres database.

This project historically used SQLite at `web/backend/instance/app.db`.
If you set `DATABASE_URL` to a Postgres connection string (e.g. Supabase),
`web/backend/app.py` will use Postgres instead.

This script copies the existing SQLite data into Postgres while preserving IDs.

Usage:
  # 1) Export DATABASE_URL in your shell (do NOT commit it)
  # 2) Run:
  python3 web/backend/migrate_sqlite_to_postgres.py

Options:
  --sqlite-path   Path to SQLite file (default: web/backend/instance/app.db)
  --force         Wipe existing rows in Postgres before inserting
  --dry-run       Only read SQLite and print counts (no Postgres writes)

Notes:
- If your DB password contains reserved URL characters (e.g. '&', '(', ')'),
  URL-encode the password portion before putting it in DATABASE_URL.
- For schema changes on Postgres, use proper migrations (Alembic/Flask-Migrate).
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Iterable

from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.inspection import inspect as sa_inspect


def chunked(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def model_rows_to_dicts(rows: list[Any]) -> list[dict[str, Any]]:
    if not rows:
        return []

    mapper = sa_inspect(rows[0].__class__).mapper
    keys = [attr.key for attr in mapper.column_attrs]
    out: list[dict[str, Any]] = []
    for obj in rows:
        out.append({k: getattr(obj, k) for k in keys})
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite-path", default="web/backend/instance/app.db")
    parser.add_argument("--force", action="store_true", help="Delete existing Postgres rows before insert")
    parser.add_argument("--dry-run", action="store_true", help="Read SQLite and print counts only")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()

    sqlite_path = args.sqlite_path

    # Allow running from repo root: make sure web/backend is importable.
    backend_dir = Path(__file__).resolve().parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    # Import app/models after arg parse.
    from app import (
        Bookmark,
        EpubBookmark,
        EpubNote,
        EpubProgress,
        Feedback,
        InviteCode,
        ListeningProgress,
        Note,
        User,
        create_app,
        db,
    )

    models_in_fk_order = [
        InviteCode,
        User,
        EpubProgress,
        ListeningProgress,
        Bookmark,
        Note,
        EpubBookmark,
        EpubNote,
        Feedback,
    ]

    # Build a SQLite app context by ensuring DATABASE_URL is not set.
    prev_db_url = os.environ.pop("DATABASE_URL", None)
    try:
        sqlite_app = create_app()
    finally:
        if prev_db_url is not None:
            os.environ["DATABASE_URL"] = prev_db_url

    # Read from SQLite
    sqlite_counts: dict[str, int] = {}
    sqlite_data: dict[str, list[dict[str, Any]]] = {}
    with sqlite_app.app_context():
        # If the SQLite path is missing, fail early with a clear message.
        if not os.path.exists(sqlite_path):
            raise SystemExit(f"SQLite DB not found at: {sqlite_path}")

        # Force SQLite usage for this app.
        if db.engine.url.get_backend_name() != "sqlite":
            raise SystemExit("Expected SQLite backend for source DB, but got: " + db.engine.url.get_backend_name())

        for model in models_in_fk_order:
            rows = db.session.execute(select(model)).scalars().all()
            sqlite_data[model.__tablename__] = model_rows_to_dicts(rows)
            sqlite_counts[model.__tablename__] = len(rows)

    print("SQLite counts:")
    for name in sqlite_counts:
        print(f"  {name}: {sqlite_counts[name]}")

    if args.dry_run:
        print("Dry run: no Postgres writes.")
        return 0

    # Target Postgres uses DATABASE_URL.
    if not os.environ.get("DATABASE_URL"):
        raise SystemExit("DATABASE_URL is not set. Export it first, then rerun this script.")

    pg_app = create_app()
    with pg_app.app_context():
        backend = db.engine.url.get_backend_name()
        if backend != "postgresql":
            raise SystemExit(f"Expected Postgres backend for target DB, but got: {backend}")

        # Ensure tables exist (create_all already runs in create_app).
        # Safety check: abort if Postgres already contains data unless --force.
        existing_counts: dict[str, int] = {}
        for model in models_in_fk_order:
            count = db.session.execute(select(func.count()).select_from(model)).scalar_one()
            existing_counts[model.__tablename__] = int(count)

        has_existing = any(v > 0 for v in existing_counts.values())
        if has_existing and not args.force:
            lines = ["Target Postgres DB is not empty. Rerun with --force to wipe and re-import."]
            for name, c in existing_counts.items():
                if c:
                    lines.append(f"  {name}: {c}")
            raise SystemExit("\n".join(lines))

        if args.force and has_existing:
            # Delete in reverse dependency order.
            for model in reversed(models_in_fk_order):
                db.session.execute(model.__table__.delete())
            db.session.commit()

        # Insert in dependency order.
        for model in models_in_fk_order:
            rows = sqlite_data.get(model.__tablename__) or []
            if not rows:
                continue

            for batch in chunked(rows, args.batch_size):
                db.session.execute(model.__table__.insert(), batch)
            db.session.commit()

        # Reset sequences for integer PKs named 'id'.
        for model in models_in_fk_order:
            if "id" not in model.__table__.c:
                continue
            table = model.__tablename__
            try:
                db.session.execute(
                    db.text(
                        "SELECT setval(pg_get_serial_sequence(:t, :c), COALESCE((SELECT MAX(id) FROM "
                        + table
                        + "), 0))"
                    ),
                    {"t": table, "c": "id"},
                )
            except Exception:
                # Not all PKs are backed by a serial sequence; ignore.
                db.session.rollback()
        db.session.commit()

        print("Postgres import complete.")
        for model in models_in_fk_order:
            count = db.session.execute(select(func.count()).select_from(model)).scalar_one()
            print(f"  {model.__tablename__}: {int(count)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
