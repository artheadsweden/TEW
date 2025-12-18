from __future__ import annotations

import json
import os
import urllib.request
import socket
from typing import Iterable
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, current_user, login_required, login_user, logout_user
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
MANIFEST_PATH = BASE_DIR / "audio_manifest.json"
DOWNLOADS_DIR = BASE_DIR / "static" / "downloads"
SYNC_TEXT_DIR = BASE_DIR / "static" / "synced_text"
BUILD_INFO_PATH = BASE_DIR / "build_info.json"


db = SQLAlchemy()
login_manager = LoginManager()


def _normalize_database_url(raw: str) -> str:
    db_uri = (raw or "").strip()
    if not db_uri:
        raise SystemExit("DATABASE_URL is required (no SQLite fallback).")

    # Common alias used by some hosts.
    if db_uri.startswith("postgres://"):
        db_uri = "postgresql://" + db_uri[len("postgres://") :]

    # Prefer psycopg3 (psycopg) over psycopg2 for better compatibility on newer
    # Python runtimes (e.g. Render currently defaults to Python 3.13).
    if db_uri.startswith("postgresql://"):
        db_uri = "postgresql+psycopg://" + db_uri[len("postgresql://") :]

    # Guard against common URL-encoding pitfalls in passwords.
    # If your password contains reserved characters (e.g. '(' or ')'), the URL must
    # percent-encode them, otherwise SQLAlchemy's URL parser may reject it.
    if db_uri.startswith("postgresql") and "@" in db_uri:
        # Extract userinfo (user:pass) between scheme and '@'
        userinfo = db_uri.split("://", 1)[1].split("@", 1)[0]
        if any(ch in userinfo for ch in ("(", ")", " ")):
            raise SystemExit(
                "DATABASE_URL appears to contain unencoded special characters in the password. "
                "URL-encode the password (percent-encoding) before setting DATABASE_URL."
            )

    # Supabase Postgres typically requires SSL.
    if db_uri.startswith("postgresql") and "sslmode=" not in db_uri:
        db_uri += ("&" if "?" in db_uri else "?") + "sslmode=require"

    # Some hosting environments (including Render in some regions) may not have
    # outbound IPv6. If DNS returns an IPv6 address first, libpq/psycopg can fail
    # with "Network is unreachable". When possible, add `hostaddr=<ipv4>` while
    # keeping the hostname for TLS/SNI.
    try:
        parts = urlsplit(db_uri)
        if parts.scheme.startswith("postgresql"):
            qs = dict(parse_qsl(parts.query, keep_blank_values=True))
            if "hostaddr" not in qs and parts.hostname:
                # Resolve an IPv4 address for the hostname.
                port = parts.port or 5432
                infos = socket.getaddrinfo(parts.hostname, port, family=socket.AF_INET, type=socket.SOCK_STREAM)
                if infos:
                    ipv4 = infos[0][4][0]
                    qs["hostaddr"] = ipv4
                    new_query = urlencode(qs)
                    parts = parts._replace(query=new_query)
                    db_uri = urlunsplit(parts)
    except Exception:
        # Best-effort only; fall back to the original URL.
        pass

    return db_uri


class InviteCode(db.Model):
    __tablename__ = "invite_codes"

    code = db.Column(db.String(64), primary_key=True)
    used_at = db.Column(db.DateTime, nullable=True)
    used_by_email = db.Column(db.String(255), nullable=True)

    @property
    def is_used(self) -> bool:
        return self.used_at is not None


class User(db.Model, UserMixin):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    reader_theme = db.Column(db.String(12), default="paper", nullable=False)
    reader_font_scale = db.Column(db.Float, default=1.0, nullable=False)
    reader_line_height = db.Column(db.Float, default=1.65, nullable=False)


class ListeningProgress(db.Model):
    __tablename__ = "listening_progress"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    chapter_id = db.Column(db.String(64), nullable=False)
    position_seconds = db.Column(db.Float, default=0.0, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (db.UniqueConstraint("user_id", "chapter_id", name="uq_progress_user_chapter"),)


class EpubProgress(db.Model):
    __tablename__ = "epub_progress"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, unique=True)
    cfi = db.Column(db.Text, nullable=False)
    chapter_href = db.Column(db.Text, nullable=True)
    chapter_title = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Bookmark(db.Model):
    __tablename__ = "bookmarks"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    chapter_id = db.Column(db.String(64), nullable=False)
    position_seconds = db.Column(db.Float, nullable=False)
    label = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Note(db.Model):
    __tablename__ = "notes"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    chapter_id = db.Column(db.String(64), nullable=False)
    position_seconds = db.Column(db.Float, nullable=False)
    note_type = db.Column(db.String(30), nullable=True)
    severity = db.Column(db.String(10), nullable=True)
    spoiler = db.Column(db.Boolean, default=False, nullable=False)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class EpubBookmark(db.Model):
    __tablename__ = "epub_bookmarks"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    cfi = db.Column(db.Text, nullable=False)
    chapter_href = db.Column(db.Text, nullable=True)
    chapter_title = db.Column(db.Text, nullable=True)
    label = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class EpubNote(db.Model):
    __tablename__ = "epub_notes"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    cfi = db.Column(db.Text, nullable=False)
    chapter_href = db.Column(db.Text, nullable=True)
    chapter_title = db.Column(db.Text, nullable=True)
    note_type = db.Column(db.String(30), nullable=True)
    severity = db.Column(db.String(10), nullable=True)
    spoiler = db.Column(db.Boolean, default=False, nullable=False)
    excerpt = db.Column(db.Text, nullable=True)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Feedback(db.Model):
    __tablename__ = "feedback"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    scope = db.Column(db.String(20), nullable=False)  # 'chapter' or 'general'
    chapter_id = db.Column(db.String(64), nullable=True)
    status = db.Column(db.String(10), default="new", nullable=False)
    draft_version = db.Column(db.String(40), nullable=True)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


@login_manager.user_loader
def load_user(user_id: str):
    return db.session.get(User, int(user_id))


def create_app() -> Flask:
    app = Flask(__name__)

    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)

    frontend_origin = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")

    db_uri = _normalize_database_url(os.environ.get("DATABASE_URL", ""))

    app.config.update(
        SECRET_KEY=os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me"),
        SQLALCHEMY_DATABASE_URI=db_uri,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SESSION_COOKIE_SAMESITE="Lax",
    )

    CORS(app, supports_credentials=True, origins=[frontend_origin])

    db.init_app(app)
    login_manager.init_app(app)

    with app.app_context():
        db.create_all()

        # The block below is for lightweight schema evolution on local SQLite.
        # For Postgres, use proper migrations (Alembic/Flask-Migrate) if you need
        # to evolve an existing schema.
        try:
            is_sqlite = (db.engine.url.get_backend_name() == "sqlite")
        except Exception:
            is_sqlite = False

        if not is_sqlite:
            is_sqlite = False

        def _sqlite_has_column(table: str, column: str) -> bool:
            try:
                rows = db.session.execute(db.text(f"PRAGMA table_info({table})")).fetchall()
                return any(r[1] == column for r in rows)
            except Exception:
                return False

        def _sqlite_add_column(table: str, column: str, ddl: str) -> None:
            try:
                db.session.execute(db.text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                db.session.commit()
            except Exception:
                db.session.rollback()

        if is_sqlite:
            # Lightweight schema evolution for local SQLite (beta/dev).
            # Safe to run repeatedly; only adds missing columns.
            if not _sqlite_has_column("notes", "note_type"):
                _sqlite_add_column("notes", "note_type", "VARCHAR(30)")
            if not _sqlite_has_column("notes", "severity"):
                _sqlite_add_column("notes", "severity", "VARCHAR(10)")
            if not _sqlite_has_column("notes", "spoiler"):
                _sqlite_add_column("notes", "spoiler", "BOOLEAN NOT NULL DEFAULT 0")

            if not _sqlite_has_column("epub_notes", "note_type"):
                _sqlite_add_column("epub_notes", "note_type", "VARCHAR(30)")
            if not _sqlite_has_column("epub_notes", "severity"):
                _sqlite_add_column("epub_notes", "severity", "VARCHAR(10)")
            if not _sqlite_has_column("epub_notes", "spoiler"):
                _sqlite_add_column("epub_notes", "spoiler", "BOOLEAN NOT NULL DEFAULT 0")
            if not _sqlite_has_column("epub_notes", "excerpt"):
                _sqlite_add_column("epub_notes", "excerpt", "TEXT")

            if not _sqlite_has_column("feedback", "status"):
                _sqlite_add_column("feedback", "status", "VARCHAR(10) NOT NULL DEFAULT 'new'")
            if not _sqlite_has_column("feedback", "draft_version"):
                _sqlite_add_column("feedback", "draft_version", "VARCHAR(40)")

            if not _sqlite_has_column("users", "reader_theme"):
                _sqlite_add_column("users", "reader_theme", "VARCHAR(12) NOT NULL DEFAULT 'paper'")
            if not _sqlite_has_column("users", "reader_font_scale"):
                _sqlite_add_column("users", "reader_font_scale", "FLOAT NOT NULL DEFAULT 1.0")
            if not _sqlite_has_column("users", "reader_line_height"):
                _sqlite_add_column("users", "reader_line_height", "FLOAT NOT NULL DEFAULT 1.65")

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.get("/api/build-info")
    @login_required
    def build_info():
        # Simple JSON blob to help readers/admin correlate feedback with draft.
        fallback = {
            "draftVersion": "v0",
            "updatedAt": datetime.utcnow().date().isoformat(),
            "whatChanged": [],
        }
        try:
            if BUILD_INFO_PATH.exists():
                data = json.loads(BUILD_INFO_PATH.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    out = {
                        "draftVersion": str(data.get("draftVersion") or fallback["draftVersion"]),
                        "updatedAt": str(data.get("updatedAt") or fallback["updatedAt"]),
                        "whatChanged": data.get("whatChanged") or [],
                    }
                    if not isinstance(out["whatChanged"], list):
                        out["whatChanged"] = []
                    return jsonify(out)
        except Exception:
            pass
        return jsonify(fallback)

    @app.get("/api/auth/me")
    def me():
        if not current_user.is_authenticated:
            return jsonify({"authenticated": False}), 200
        return jsonify(
            {
                "authenticated": True,
                "user": {
                    "id": current_user.id,
                    "name": current_user.name,
                    "email": current_user.email,
                    "isAdmin": bool(current_user.is_admin),
                },
            }
        )

    @app.get("/api/me/reader-settings")
    @login_required
    def get_reader_settings():
        return jsonify(
            {
                "theme": getattr(current_user, "reader_theme", None) or "paper",
                "fontScale": float(getattr(current_user, "reader_font_scale", 1.0) or 1.0),
                "lineHeight": float(getattr(current_user, "reader_line_height", 1.65) or 1.65),
            }
        )

    @app.put("/api/me/reader-settings")
    @login_required
    def put_reader_settings():
        payload = request.get_json(silent=True) or {}

        theme = payload.get("theme")
        if theme in ("paper", "white", "night"):
            current_user.reader_theme = theme

        font_scale_raw = payload.get("fontScale")
        try:
            font_scale = float(font_scale_raw)
            # Keep within sane bounds.
            current_user.reader_font_scale = max(0.75, min(1.6, font_scale))
        except Exception:
            pass

        line_height_raw = payload.get("lineHeight")
        try:
            line_height = float(line_height_raw)
            current_user.reader_line_height = max(1.2, min(2.4, line_height))
        except Exception:
            pass

        db.session.commit()
        return get_reader_settings()

    @app.post("/api/auth/signup")
    def signup():
        payload = request.get_json(force=True)
        name = (payload.get("name") or "").strip()
        email = (payload.get("email") or "").strip().lower()
        password = payload.get("password") or ""
        invite_code = (payload.get("inviteCode") or "").strip()

        if not (name and email and password and invite_code):
            return jsonify({"error": "Missing required fields"}), 400

        code = db.session.get(InviteCode, invite_code)
        if code is None:
            return jsonify({"error": "Invalid invite code"}), 400
        if code.is_used:
            return jsonify({"error": "Invite code already used"}), 400

        if User.query.filter_by(email=email).first() is not None:
            return jsonify({"error": "Email already registered"}), 400

        user = User(name=name, email=email, password_hash=generate_password_hash(password))
        db.session.add(user)

        code.used_at = datetime.utcnow()
        code.used_by_email = email
        db.session.add(code)

        db.session.commit()

        login_user(user)
        return jsonify({"ok": True})

    @app.post("/api/auth/login")
    def login():
        payload = request.get_json(force=True)
        email = (payload.get("email") or "").strip().lower()
        password = payload.get("password") or ""

        user = User.query.filter_by(email=email).first()
        if user is None or not check_password_hash(user.password_hash, password):
            return jsonify({"error": "Invalid email or password"}), 400

        login_user(user)
        return jsonify({"ok": True})

    @app.post("/api/auth/logout")
    @login_required
    def logout():
        logout_user()
        return jsonify({"ok": True})

    @app.get("/api/book/downloads")
    @login_required
    def downloads():
        epub_exists = (DOWNLOADS_DIR / "The_Enemy_Within.epub").exists()
        pdf_exists = (DOWNLOADS_DIR / "The_Enemy_Within.pdf").exists()
        return jsonify(
            {
                "epub": "/downloads/The_Enemy_Within.epub" if epub_exists else None,
                "pdf": "/downloads/The_Enemy_Within.pdf" if pdf_exists else None,
            }
        )

    @app.get("/downloads/<path:filename>")
    @login_required
    def download_file(filename: str):
        return send_from_directory(DOWNLOADS_DIR, filename, as_attachment=True)

    @app.get("/api/book/epub")
    @login_required
    def epub_inline():
        # Serve the EPUB inline for the in-browser reader (not as an attachment).
        filename = "The_Enemy_Within.epub"
        if not (DOWNLOADS_DIR / filename).exists():
            return jsonify({"error": "EPUB not available"}), 404
        return send_from_directory(
            DOWNLOADS_DIR,
            filename,
            as_attachment=False,
            mimetype="application/epub+zip",
        )

    @app.get("/api/audio/manifest")
    @login_required
    def audio_manifest():
        if not MANIFEST_PATH.exists():
            return jsonify({"bookTitle": "The Enemy Within", "chapters": []})
        return jsonify(json.loads(MANIFEST_PATH.read_text(encoding="utf-8")))

    def _read_manifest() -> dict:
        if not MANIFEST_PATH.exists():
            return {"bookTitle": "The Enemy Within", "chapters": []}
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    def _find_chapter_audio_url(manifest: dict, chapter_id: str) -> str | None:
        for ch in manifest.get("chapters") or []:
            if ch.get("id") == chapter_id:
                return ch.get("audioUrl")
        return None

    def _is_allowed_audio_source(url: str) -> bool:
        try:
            from urllib.parse import urlparse

            u = urlparse(url)
            if u.scheme not in {"http", "https"}:
                return False
            host = (u.hostname or "").lower()
            return host.endswith("dropbox.com") or host.endswith("dropboxusercontent.com")
        except Exception:
            return False

    @app.get("/api/audio/stream/<chapter_id>")
    @login_required
    def stream_audio(chapter_id: str):
        manifest = _read_manifest()
        src = _find_chapter_audio_url(manifest, chapter_id)
        if not src:
            return jsonify({"error": "Unknown chapter"}), 404

        if not _is_allowed_audio_source(src):
            return jsonify({"error": "Audio source not allowed"}), 400

        range_header = request.headers.get("Range")
        headers = {
            "User-Agent": "TEW-BetaReader/1.0",
            "Accept": "audio/mpeg,audio/*;q=0.9,*/*;q=0.1",
        }
        if range_header:
            headers["Range"] = range_header

        req = urllib.request.Request(src, headers=headers, method="GET")

        try:
            upstream = urllib.request.urlopen(req, timeout=30)
        except Exception as e:
            return jsonify({"error": f"Failed to fetch audio: {e}"}), 502

        def generate() -> Iterable[bytes]:
            try:
                while True:
                    chunk = upstream.read(1024 * 64)
                    if not chunk:
                        break
                    yield chunk
            finally:
                try:
                    upstream.close()
                except Exception:
                    pass

        status = getattr(upstream, "status", 200)
        resp = Response(stream_with_context(generate()), status=status)

        # Preserve key headers for correct seeking/decoding.
        upstream_headers = getattr(upstream, "headers", {})
        content_type = upstream_headers.get("Content-Type") or "audio/mpeg"
        resp.headers["Content-Type"] = content_type
        for h in ["Accept-Ranges", "Content-Range", "Content-Length", "Content-Disposition"]:
            v = upstream_headers.get(h)
            if v:
                resp.headers[h] = v

        # Avoid caching during development.
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/api/audio/synced-text/<chapter_id>")
    @login_required
    def synced_text(chapter_id: str):
        path = (SYNC_TEXT_DIR / f"{chapter_id}.json").resolve()
        try:
            # Basic path traversal protection; SYNC_TEXT_DIR is fixed.
            if SYNC_TEXT_DIR.resolve() not in path.parents:
                return jsonify({"error": "Invalid chapter"}), 400
        except Exception:
            return jsonify({"error": "Invalid chapter"}), 400

        if not path.exists():
            return jsonify({"error": "No synced text for this chapter"}), 404

        try:
            return jsonify(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            return jsonify({"error": "Synced text file is invalid"}), 500

    @app.get("/api/progress")
    @login_required
    def get_progress():
        rows = ListeningProgress.query.filter_by(user_id=current_user.id).all()
        return jsonify(
            {
                "items": [
                    {
                        "chapterId": r.chapter_id,
                        "positionSeconds": r.position_seconds,
                        "updatedAt": r.updated_at.isoformat(),
                    }
                    for r in rows
                ]
            }
        )

    @app.post("/api/progress")
    @login_required
    def set_progress():
        payload = request.get_json(force=True)
        chapter_id = (payload.get("chapterId") or "").strip()
        position_seconds = float(payload.get("positionSeconds") or 0.0)

        if not chapter_id:
            return jsonify({"error": "Missing chapterId"}), 400

        row = ListeningProgress.query.filter_by(user_id=current_user.id, chapter_id=chapter_id).first()
        if row is None:
            row = ListeningProgress(user_id=current_user.id, chapter_id=chapter_id, position_seconds=position_seconds)
            db.session.add(row)
        else:
            row.position_seconds = position_seconds
            row.updated_at = datetime.utcnow()

        db.session.commit()
        return jsonify({"ok": True})

    @app.get("/api/bookmarks")
    @login_required
    def list_bookmarks():
        chapter_id = request.args.get("chapterId")
        q = Bookmark.query.filter_by(user_id=current_user.id)
        if chapter_id:
            q = q.filter_by(chapter_id=chapter_id)
        rows = q.order_by(Bookmark.created_at.desc()).all()
        return jsonify(
            {
                "items": [
                    {
                        "id": r.id,
                        "chapterId": r.chapter_id,
                        "positionSeconds": r.position_seconds,
                        "label": r.label,
                        "createdAt": r.created_at.isoformat(),
                    }
                    for r in rows
                ]
            }
        )

    @app.post("/api/bookmarks")
    @login_required
    def add_bookmark():
        payload = request.get_json(force=True)
        chapter_id = (payload.get("chapterId") or "").strip()
        position_seconds = float(payload.get("positionSeconds") or 0.0)
        label = (payload.get("label") or "").strip() or None

        if not chapter_id:
            return jsonify({"error": "Missing chapterId"}), 400

        row = Bookmark(user_id=current_user.id, chapter_id=chapter_id, position_seconds=position_seconds, label=label)
        db.session.add(row)
        db.session.commit()
        return jsonify({"ok": True, "id": row.id})

    @app.delete("/api/bookmarks/<int:bookmark_id>")
    @login_required
    def delete_bookmark(bookmark_id: int):
        row = Bookmark.query.filter_by(user_id=current_user.id, id=bookmark_id).first()
        if row is None:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(row)
        db.session.commit()
        return jsonify({"ok": True})

    @app.get("/api/notes")
    @login_required
    def list_notes():
        chapter_id = request.args.get("chapterId")
        q = Note.query.filter_by(user_id=current_user.id)
        if chapter_id:
            q = q.filter_by(chapter_id=chapter_id)
        rows = q.order_by(Note.created_at.desc()).all()
        return jsonify(
            {
                "items": [
                    {
                        "id": r.id,
                        "chapterId": r.chapter_id,
                        "positionSeconds": r.position_seconds,
                        "type": r.note_type,
                        "severity": r.severity,
                        "spoiler": bool(r.spoiler),
                        "text": r.text,
                        "createdAt": r.created_at.isoformat(),
                        "updatedAt": r.updated_at.isoformat(),
                    }
                    for r in rows
                ]
            }
        )

    @app.post("/api/notes")
    @login_required
    def add_note():
        payload = request.get_json(force=True)
        chapter_id = (payload.get("chapterId") or "").strip()
        position_seconds = float(payload.get("positionSeconds") or 0.0)
        text = (payload.get("text") or "").strip()
        note_type = (payload.get("type") or "").strip() or None
        severity = (payload.get("severity") or "").strip() or None
        spoiler = bool(payload.get("spoiler") or False)

        if not (chapter_id and text):
            return jsonify({"error": "Missing chapterId or text"}), 400

        row = Note(
            user_id=current_user.id,
            chapter_id=chapter_id,
            position_seconds=position_seconds,
            note_type=note_type,
            severity=severity,
            spoiler=spoiler,
            text=text,
        )
        db.session.add(row)
        db.session.commit()
        return jsonify({"ok": True, "id": row.id})

    @app.put("/api/notes/<int:note_id>")
    @login_required
    def edit_note(note_id: int):
        payload = request.get_json(force=True)
        text = (payload.get("text") or "").strip()
        if not text:
            return jsonify({"error": "Missing text"}), 400
        row = Note.query.filter_by(user_id=current_user.id, id=note_id).first()
        if row is None:
            return jsonify({"error": "Not found"}), 404
        row.text = text
        # Optional metadata edits.
        if "type" in payload:
            row.note_type = (payload.get("type") or "").strip() or None
        if "severity" in payload:
            row.severity = (payload.get("severity") or "").strip() or None
        if "spoiler" in payload:
            row.spoiler = bool(payload.get("spoiler") or False)
        row.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify({"ok": True})

    @app.delete("/api/notes/<int:note_id>")
    @login_required
    def delete_note(note_id: int):
        row = Note.query.filter_by(user_id=current_user.id, id=note_id).first()
        if row is None:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(row)
        db.session.commit()
        return jsonify({"ok": True})

    # --- EPUB reader persistence ---

    @app.get("/api/epub/progress")
    @login_required
    def get_epub_progress():
        row = EpubProgress.query.filter_by(user_id=current_user.id).first()
        if row is None:
            return jsonify({"cfi": None, "chapterHref": None, "chapterTitle": None})
        return jsonify(
            {
                "cfi": row.cfi,
                "chapterHref": row.chapter_href,
                "chapterTitle": row.chapter_title,
                "updatedAt": row.updated_at.isoformat(),
            }
        )

    @app.post("/api/epub/progress")
    @login_required
    def set_epub_progress():
        payload = request.get_json(force=True)
        cfi = (payload.get("cfi") or "").strip()
        chapter_href = (payload.get("chapterHref") or "").strip() or None
        chapter_title = (payload.get("chapterTitle") or "").strip() or None

        if not cfi:
            return jsonify({"error": "Missing cfi"}), 400

        row = EpubProgress.query.filter_by(user_id=current_user.id).first()
        if row is None:
            row = EpubProgress(user_id=current_user.id, cfi=cfi, chapter_href=chapter_href, chapter_title=chapter_title)
            db.session.add(row)
        else:
            row.cfi = cfi
            row.chapter_href = chapter_href
            row.chapter_title = chapter_title
            row.updated_at = datetime.utcnow()

        db.session.commit()
        return jsonify({"ok": True})

    @app.get("/api/epub/bookmarks")
    @login_required
    def list_epub_bookmarks():
        rows = EpubBookmark.query.filter_by(user_id=current_user.id).order_by(EpubBookmark.created_at.desc()).all()
        return jsonify(
            {
                "items": [
                    {
                        "id": r.id,
                        "cfi": r.cfi,
                        "chapterHref": r.chapter_href,
                        "chapterTitle": r.chapter_title,
                        "label": r.label,
                        "createdAt": r.created_at.isoformat(),
                    }
                    for r in rows
                ]
            }
        )

    @app.post("/api/epub/bookmarks")
    @login_required
    def add_epub_bookmark():
        payload = request.get_json(force=True)
        cfi = (payload.get("cfi") or "").strip()
        label = (payload.get("label") or "").strip() or None
        chapter_href = (payload.get("chapterHref") or "").strip() or None
        chapter_title = (payload.get("chapterTitle") or "").strip() or None

        if not cfi:
            return jsonify({"error": "Missing cfi"}), 400

        row = EpubBookmark(
            user_id=current_user.id,
            cfi=cfi,
            label=label,
            chapter_href=chapter_href,
            chapter_title=chapter_title,
        )
        db.session.add(row)
        db.session.commit()
        return jsonify({"ok": True, "id": row.id})

    @app.delete("/api/epub/bookmarks/<int:bookmark_id>")
    @login_required
    def delete_epub_bookmark(bookmark_id: int):
        row = EpubBookmark.query.filter_by(user_id=current_user.id, id=bookmark_id).first()
        if row is None:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(row)
        db.session.commit()
        return jsonify({"ok": True})

    @app.get("/api/epub/notes")
    @login_required
    def list_epub_notes():
        rows = EpubNote.query.filter_by(user_id=current_user.id).order_by(EpubNote.created_at.desc()).all()
        return jsonify(
            {
                "items": [
                    {
                        "id": r.id,
                        "cfi": r.cfi,
                        "chapterHref": r.chapter_href,
                        "chapterTitle": r.chapter_title,
                        "type": r.note_type,
                        "severity": r.severity,
                        "spoiler": bool(r.spoiler),
                        "excerpt": r.excerpt,
                        "text": r.text,
                        "createdAt": r.created_at.isoformat(),
                        "updatedAt": r.updated_at.isoformat(),
                    }
                    for r in rows
                ]
            }
        )

    @app.post("/api/epub/notes")
    @login_required
    def add_epub_note():
        payload = request.get_json(force=True)
        cfi = (payload.get("cfi") or "").strip()
        text = (payload.get("text") or "").strip()
        chapter_href = (payload.get("chapterHref") or "").strip() or None
        chapter_title = (payload.get("chapterTitle") or "").strip() or None
        note_type = (payload.get("type") or "").strip() or None
        severity = (payload.get("severity") or "").strip() or None
        spoiler = bool(payload.get("spoiler") or False)
        excerpt = (payload.get("excerpt") or "").strip() or None

        if not cfi:
            return jsonify({"error": "Missing cfi"}), 400
        if not text:
            return jsonify({"error": "Missing text"}), 400

        row = EpubNote(
            user_id=current_user.id,
            cfi=cfi,
            text=text,
            chapter_href=chapter_href,
            chapter_title=chapter_title,
            note_type=note_type,
            severity=severity,
            spoiler=spoiler,
            excerpt=excerpt,
        )
        db.session.add(row)
        db.session.commit()
        return jsonify({"ok": True, "id": row.id})

    @app.put("/api/epub/notes/<int:note_id>")
    @login_required
    def edit_epub_note(note_id: int):
        payload = request.get_json(force=True)
        text = (payload.get("text") or "").strip()
        if not text:
            return jsonify({"error": "Missing text"}), 400
        row = EpubNote.query.filter_by(user_id=current_user.id, id=note_id).first()
        if row is None:
            return jsonify({"error": "Not found"}), 404
        row.text = text
        if "type" in payload:
            row.note_type = (payload.get("type") or "").strip() or None
        if "severity" in payload:
            row.severity = (payload.get("severity") or "").strip() or None
        if "spoiler" in payload:
            row.spoiler = bool(payload.get("spoiler") or False)
        if "excerpt" in payload:
            row.excerpt = (payload.get("excerpt") or "").strip() or None
        row.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify({"ok": True})

    @app.delete("/api/epub/notes/<int:note_id>")
    @login_required
    def delete_epub_note(note_id: int):
        row = EpubNote.query.filter_by(user_id=current_user.id, id=note_id).first()
        if row is None:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(row)
        db.session.commit()
        return jsonify({"ok": True})

    @app.post("/api/feedback")
    @login_required
    def submit_feedback():
        payload = request.get_json(force=True)
        scope = (payload.get("scope") or "").strip()
        chapter_id = (payload.get("chapterId") or "").strip() or None
        text = (payload.get("text") or "").strip()
        draft_version = (payload.get("draftVersion") or "").strip() or None

        if scope not in {"chapter", "general"}:
            return jsonify({"error": "Invalid scope"}), 400
        if scope == "chapter" and not chapter_id:
            return jsonify({"error": "chapterId required for chapter feedback"}), 400
        if not text:
            return jsonify({"error": "Text required"}), 400

        row = Feedback(user_id=current_user.id, scope=scope, chapter_id=chapter_id, text=text, draft_version=draft_version)
        db.session.add(row)
        db.session.commit()
        return jsonify({"ok": True})

    @app.get("/api/feedback/mine")
    @login_required
    def my_feedback_summary():
        rows = Feedback.query.filter_by(user_id=current_user.id).order_by(Feedback.created_at.desc()).all()
        latest = rows[0].created_at.isoformat() if rows else None
        return jsonify({"count": len(rows), "latestCreatedAt": latest})

    def _require_admin():
        if not current_user.is_authenticated:
            return jsonify({"error": "Unauthenticated"}), 401
        if not getattr(current_user, "is_admin", False):
            return jsonify({"error": "Forbidden"}), 403
        return None

    @app.get("/api/admin/invites")
    def admin_list_invites():
        err = _require_admin()
        if err is not None:
            return err
        rows = InviteCode.query.order_by(InviteCode.used_at.is_(None).desc()).all()
        return jsonify(
            {
                "items": [
                    {
                        "code": r.code,
                        "usedAt": r.used_at.isoformat() if r.used_at else None,
                        "usedByEmail": r.used_by_email,
                    }
                    for r in rows
                ]
            }
        )

    @app.post("/api/admin/invites")
    def admin_add_invite():
        err = _require_admin()
        if err is not None:
            return err
        payload = request.get_json(force=True)
        code = (payload.get("code") or "").strip()
        if not code:
            return jsonify({"error": "Missing code"}), 400
        if db.session.get(InviteCode, code) is not None:
            return jsonify({"error": "Code already exists"}), 400
        db.session.add(InviteCode(code=code))
        db.session.commit()
        return jsonify({"ok": True})

    @app.get("/api/admin/feedback")
    def admin_feedback():
        err = _require_admin()
        if err is not None:
            return err
        rows = Feedback.query.order_by(Feedback.created_at.desc()).all()
        return jsonify(
            {
                "items": [
                    {
                        "id": r.id,
                        "userId": r.user_id,
                        "scope": r.scope,
                        "chapterId": r.chapter_id,
                        "status": r.status,
                        "draftVersion": r.draft_version,
                        "text": r.text,
                        "createdAt": r.created_at.isoformat(),
                    }
                    for r in rows
                ]
            }
        )

    @app.put("/api/admin/feedback/<int:feedback_id>")
    def admin_update_feedback(feedback_id: int):
        err = _require_admin()
        if err is not None:
            return err
        payload = request.get_json(force=True)
        status = (payload.get("status") or "").strip().lower()
        if status not in {"new", "triaged", "fixed"}:
            return jsonify({"error": "Invalid status"}), 400

        row = Feedback.query.filter_by(id=feedback_id).first()
        if row is None:
            return jsonify({"error": "Not found"}), 404

        row.status = status
        db.session.commit()
        return jsonify({"ok": True})

    @app.get("/api/admin/progress")
    def admin_progress():
        err = _require_admin()
        if err is not None:
            return err
        users = User.query.order_by(User.created_at.asc()).all()
        out = []
        for u in users:
            latest = (
                ListeningProgress.query.filter_by(user_id=u.id)
                .order_by(ListeningProgress.updated_at.desc())
                .first()
            )
            started_count = ListeningProgress.query.filter_by(user_id=u.id).count()
            out.append(
                {
                    "userId": u.id,
                    "name": u.name,
                    "email": u.email,
                    "createdAt": u.created_at.isoformat(),
                    "chaptersStarted": started_count,
                    "latest": {
                        "chapterId": latest.chapter_id,
                        "positionSeconds": latest.position_seconds,
                        "updatedAt": latest.updated_at.isoformat(),
                    }
                    if latest
                    else None,
                }
            )
        return jsonify({"items": out})

    return app


if __name__ == "__main__":
    app = create_app()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host=host, port=port, debug=debug, use_reloader=False)
