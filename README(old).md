# O.R.M.S. backend

Django + Django REST Framework API, serving the existing citizen/staff/admin
frontend directly via WhiteNoise so the whole system deploys as one unit.

## What's here

- `accounts/` — custom `User` model (role: citizen/staff/admin), JWT auth
  endpoints (register, login, refresh, me, admin user management)
- `frontend/` — your existing citizen/staff/admin portals, unmodified except
  for `js/main.js` in each, which now calls the real API instead of the
  fake `localStorage` login
- `orms_backend/` — Django project settings/urls

Django's built-in admin panel lives at `/django-admin/` instead of the usual
`/admin/`, since the frontend already uses `/admin/` for the Barangay Admin
Portal.

## Local setup

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# open .env and set SECRET_KEY to any long random string
# (DATABASE_URL can stay blank locally — it falls back to sqlite)

python manage.py migrate
python manage.py createsuperuser   # optional, for /django-admin/
python manage.py runserver
```

Then visit:
- `http://127.0.0.1:8000/` — portal picker
- `http://127.0.0.1:8000/citizen/index.html`, `/staff/index.html`, `/admin/index.html`
- `http://127.0.0.1:8000/api/auth/register/` and `/api/auth/login/` — API

## Testing the API directly

```bash
# Register a citizen account
curl -X POST http://127.0.0.1:8000/api/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SomeStrongPass1","first_name":"Test","last_name":"User"}'

# Log in
curl -X POST http://127.0.0.1:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SomeStrongPass1"}'
```

## Deploying to Render (free tier)

1. **Push this to GitHub.** Create a new repo, then from this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial Django backend + frontend"
   git branch -M main
   git remote add origin https://github.com/<your-org>/<your-repo>.git
   git push -u origin main
   ```
   (`.gitignore` already excludes `venv/`, `.env`, `db.sqlite3`, etc.)

2. **Create a PostgreSQL database on Render** (or Neon/Supabase — see the
   earlier hosting discussion). Copy its connection string
   (`DATABASE_URL`).

3. **Create a new Web Service on Render**, connect it to your GitHub repo,
   and set:
   - **Build command:** `./build.sh`
   - **Start command:** `gunicorn orms_backend.wsgi`

4. **Set environment variables** in Render's dashboard (Settings →
   Environment):
   | Key | Value |
   |---|---|
   | `SECRET_KEY` | a long random string (generate with `python -c "import secrets; print(secrets.token_urlsafe(50))"`) |
   | `DEBUG` | `False` |
   | `ALLOWED_HOSTS` | `your-app-name.onrender.com` |
   | `CSRF_TRUSTED_ORIGINS` | `https://your-app-name.onrender.com` |
   | `DATABASE_URL` | the Postgres connection string from step 2 |
   | `CLOUDINARY_URL` | your Cloudinary URL (Dashboard → API Keys) — needed so uploaded images survive redeploys, see below |

5. **Deploy.** Render runs `build.sh` (installs dependencies, collects
   static files, runs migrations) then starts the app with gunicorn.

6. Once live, visit `https://your-app-name.onrender.com/` — same portal
   picker as local, but now reachable by anyone, not just localhost.

7. **Create your first real accounts:**
   - Citizens can self-register via the Sign Up page in the Citizen portal
     (or `POST /api/auth/register/`)
   - Staff/Admin accounts must be created by an existing Administrator via
     `POST /api/auth/admin/create-user/`, or manually the first time via
     `python manage.py createsuperuser` locally against the same database,
     then editing that user's `role` field in `/django-admin/`

### Known limitations to revisit later

- Render's free web service **sleeps after 15 minutes of inactivity** —
  the first request after idle time takes 30-60 seconds. Ping the URL a
  few minutes before a live demo.
- Uploaded files (voter's ID images, evidence) now go to Cloudinary in
  production as long as `CLOUDINARY_URL` is set (see step 4) — sign up for
  a free Cloudinary account and copy the URL from Dashboard → API Keys.
  Without it, uploads fall back to local disk and are **not persistent**
  on Render — wiped on every redeploy/restart.
- Only login + registration are wired to the frontend so far. Reports,
  ordinances, concerns, and notifications still need models + endpoints
  (see the ERD from earlier in this conversation).

