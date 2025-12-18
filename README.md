# TEW beta reader site (web)

A small full‑stack web app for beta readers of **The Enemy Within**:

- **Frontend:** React + Vite (reader/listen UI)
- **Backend:** Flask (JSON API, cookie auth, file/audio proxy)
- **Storage:** SQLAlchemy (SQLite for local dev, Postgres/Supabase in production)

## Repo layout

- `backend/` — Flask app + API
- `frontend/` — React app

## Prerequisites

- Python 3.11+
- Node.js 18+ (20+ recommended)

## Quickstart (local dev)

### 1) Backend (Flask)

From repo root:

```bash
source .venv/bin/activate  # or create one first
pip install -r backend/requirements.txt

# REQUIRED (there is no implicit DB fallback)
export DATABASE_URL="sqlite:///$(pwd)/backend/instance/app.db"

# Recommended
export FLASK_SECRET_KEY="dev-secret-change-me"
export FRONTEND_ORIGIN="http://localhost:5173"

python backend/app.py
```

Backend starts on `http://127.0.0.1:5000` by default.

Useful env vars:

- `DATABASE_URL` (required)
  - Local SQLite example: `sqlite:////absolute/path/to/backend/instance/app.db`
  - Postgres example: `postgresql://user:pass@host:5432/dbname` (the app will append `sslmode=require` if missing; it uses the psycopg3 driver on deploy)
- `FRONTEND_ORIGIN` (default `http://localhost:5173`) — allowed CORS origin (cookies enabled)
- `FLASK_SECRET_KEY` (default `dev-secret-change-me`) — session signing key
- `HOST` (default `127.0.0.1`), `PORT` (default `5000`), `FLASK_DEBUG` (default `1`)

### 2) Frontend (Vite)

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` and proxies:

- `/api` → `http://127.0.0.1:5000`
- `/downloads` → `http://127.0.0.1:5000`

## Admin + invites

Signup is invite‑gated.

Create invite codes:

```bash
python backend/manage.py create-invites CODE1 CODE2
```

Promote an existing user to admin:

```bash
python backend/manage.py make-admin person@example.com
```

Admin API endpoints live under `/api/admin/*` and require an admin session.

## Content files

This app serves a fixed book package from the backend:

- Downloads directory: `backend/static/downloads/`
  - Expected filenames:
    - `The_Enemy_Within.epub`
    - `The_Enemy_Within.pdf` (optional)
- In‑browser EPUB (inline): `GET /api/book/epub`
- Audio manifest: `backend/audio_manifest.json`
  - Served at `GET /api/audio/manifest`
  - Audio streaming is proxied via `GET /api/audio/stream/<chapter_id>`
  - Only `dropbox.com` / `dropboxusercontent.com` URLs are allowed
- Synced text directory: `backend/static/synced_text/`
  - Files are addressed by chapter id: `<chapterId>.json`
  - Served at `GET /api/audio/synced-text/<chapter_id>`
- Draft metadata: `backend/build_info.json` (shown to logged-in users via `GET /api/build-info`)

## API overview

Most routes require login (cookie session via Flask-Login).

- Health: `GET /api/health`
- Auth: `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- Reader settings: `GET/PUT /api/me/reader-settings`
- Book files: `GET /api/book/downloads`, `GET /downloads/<filename>`, `GET /api/book/epub`
- Audio: `GET /api/audio/manifest`, `GET /api/audio/stream/<chapter_id>`, `GET /api/audio/synced-text/<chapter_id>`
- Listening progress: `GET/POST /api/progress`
- Bookmarks + notes: `GET/POST/DELETE /api/bookmarks`, `GET/POST/PUT/DELETE /api/notes`
- EPUB progress/bookmarks/notes: `GET/POST /api/epub/progress`, `GET/POST/DELETE /api/epub/bookmarks`, `GET/POST/PUT/DELETE /api/epub/notes`
- Feedback: `POST /api/feedback`, `GET /api/feedback/mine`
- Admin: `GET/POST /api/admin/invites`, `GET/PUT /api/admin/feedback`, `GET /api/admin/progress`

## Database notes

- The backend requires `DATABASE_URL` to be set.
- If you use a Postgres password containing reserved URL characters (for example `(`, `)`, space, `&`), URL‑encode the password before putting it in `DATABASE_URL`.

## Deploying on Render (Supabase Postgres)

On Render, treat the database URL as a **secret** environment variable.

1) In the Render dashboard, open your **Web Service** → **Environment**.
2) Add an environment variable:
  - Key: `DATABASE_URL`
  - Value: your Supabase connection string
3) Click **Save Changes** (Render will redeploy).

### Backend service settings (recommended)

- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn wsgi:app --bind 0.0.0.0:$PORT`

### Handling the password

Put the password only inside the `DATABASE_URL` value you store in Render (never commit it).

Supabase gives you a URL like:

`postgresql://postgres:[YOUR-PASSWORD]@db.qykyqtzoyxkahpiafwfc.supabase.co:5432/postgres`

Replace `[YOUR-PASSWORD]` with the real password, but **URL-encode it first** if it contains reserved characters like `@`, `:`, `/`, `?`, `#`, `&`, spaces, `(`, `)`.

Example:

- Raw password: `pa@ss&word`
- Encoded password: `pa%40ss%26word`

Then store this in Render as `DATABASE_URL`:

`postgresql://postgres:pa%40ss%26word@db.qykyqtzoyxkahpiafwfc.supabase.co:5432/postgres`

To generate an encoded password locally:

```bash
python -c "import urllib.parse; print(urllib.parse.quote(input('Password: '), safe=''))"
```

Notes:

- This backend will append `sslmode=require` automatically for Postgres URLs if it’s missing.
- If you ever accidentally paste secrets into git history, rotate the Supabase DB password.

### Migrating from local SQLite → Postgres

There’s a helper script to copy data from the historical SQLite DB into Postgres:

```bash
python backend/migrate_sqlite_to_postgres.py --help
```

## Build (frontend)

```bash
cd frontend
npm run build
npm run preview
```

Note: the Flask backend does not currently serve the Vite production `dist/` output; in production you’ll typically host the frontend separately (or add a reverse proxy/static serving step) and set `FRONTEND_ORIGIN` accordingly.
