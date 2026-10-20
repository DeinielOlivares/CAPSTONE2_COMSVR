# Contributing to O.R.M.S.

Welcome! This doc covers how to get the project running on your machine and
how we work together on it so nobody accidentally breaks the live site.

## 1. Getting set up locally

```bash
git clone <the repo URL>
cd orms-project

python -m venv venv
source venv/Scripts/activate     # Windows Git Bash
# or: venv\Scripts\activate      # Windows Command Prompt
# or: source venv/bin/activate   # Mac/Linux

pip install -r requirements.txt

cp .env.example .env
```

Open `.env` and set `SECRET_KEY` to your own generated value:
```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"
```
Paste the output in as `SECRET_KEY=...`.

### Choosing a local database

**Option A — SQLite (default, zero setup).** Leave `DATABASE_URL` blank in
`.env`. Django automatically uses a local `db.sqlite3` file. This is the
easiest option if you just want to get running quickly.

**Option B — local PostgreSQL (matches the live site).** If you have
PostgreSQL and pgAdmin installed:
1. In pgAdmin, right-click **Databases** → **Create** → **Database**, and
   name it something like `orms_local`.
2. In `.env`, set:
   ```
   DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/orms_local
   ```
   (Use whatever password you set for the `postgres` user when installing
   PostgreSQL — not your Windows password, and not Render's database
   password. URL-encode any special characters like `@`, `#`, `/` if your
   password has them.)
3. Continue with the steps below as normal — `migrate` builds the tables in
   `orms_local` instead of a sqlite file, and you can browse/edit them
   directly in pgAdmin the same way you would the live database.

Either option is a personal choice — nothing here touches the live Render
database, and teammates can use different options without conflict.

### Finish setup

```bash
python manage.py migrate
python manage.py createsuperuser   # makes your own local admin account
python manage.py runserver
```

Visit `http://127.0.0.1:8000/` — you should see the portal picker.

**Remember:** `venv` doesn't stay active permanently — run the `activate`
command again every time you open a new terminal for this project.

## 2. Rule #1: never develop against the live database

Only touch the production Render database directly (via `psql`, pgAdmin, or
a Django shell pointed at the External Database URL) when there's a real
reason to — fixing a specific account, inspecting something urgent, etc.
Day-to-day feature work should always run against your own local database
(SQLite or local PostgreSQL, per above). This means:

- You can experiment, break things, and re-run `migrate` freely without any
  risk to the real site
- Nobody's local mistakes show up for the whole team or in front of a panel

## 3. Git workflow

- **Never commit straight to `main`.** Pushing to `main` is what triggers
  Render to redeploy automatically — an untested push can take the live
  site down.
- Create a branch per feature or fix:
  ```bash
  git checkout -b feature/ordinance-model
  ```
- Commit with clear messages describing *what* and *why*, not just "fix stuff".
- Push your branch and open a Pull Request on GitHub:
  ```bash
  git push -u origin feature/ordinance-model
  ```
- Get at least a quick look from someone else before merging into `main`,
  even informally — a second pair of eyes catches a lot.
- Delete the branch after merging to keep things tidy.

## 4. Never commit secrets

`.env` is already in `.gitignore` — keep it that way. It holds your
`SECRET_KEY` and, if you're using local PostgreSQL, your database password.
Each person keeps their own local `.env`; it should never appear in a
commit or a Pull Request diff. If you ever see one about to be committed,
stop and fix `.gitignore` first.

## 5. Access control conventions

- `role` (`citizen` / `staff` / `admin`) on the `User` model controls what
  someone can do — it's checked via DRF permission classes (`IsAdmin`,
  `IsStaffOrAdmin` in `accounts/views.py`). Add new permission classes
  there rather than checking `request.user.role` inline in each view.
- Disabling an account (`is_active = False`) takes effect immediately —
  even an already-issued, unexpired login token gets rejected on the very
  next request. Don't rely on the frontend alone to keep someone out of a
  page; always gate on the backend too.
- Admins can't disable or change the role of their own account, and the
  last remaining Admin account can't be demoted — see the checks in
  `AdminAccountDetailView.patch`. Keep this in mind if you add more
  account-management actions: think about what happens if the only admin
  does it to themselves.

## 6. Project structure & conventions

```
accounts/           — user model, auth endpoints (register/login/JWT)
frontend/            — citizen/, staff/, admin/ portals (HTML/CSS/JS)
orms_backend/        — Django project settings/urls
```

When adding a new app (e.g. `ordinances`, `reports`), follow the patterns
already in `accounts/models.py`:
- UUID primary keys (`models.UUIDField(primary_key=True, default=uuid.uuid4, ...)`)
- `TextChoices` for status/role/type fields, not free-text strings
- Foreign keys use `related_name` so reverse lookups stay readable
- Serializers separate what's writable (`RegisterSerializer`) from what's
  read-only (`UserSerializer`) rather than one serializer doing both

Check the database ERD (shared earlier in the project planning) before
adding new tables, so new models match the intended schema rather than
drifting from it.

## 7. Responsive design conventions

The Admin and Staff portals share the same sidebar+topbar shell
(`.admin-shell`, `.admin-sidebar`, `.admin-topbar`) and already handle
mobile screens — below 900px the sidebar becomes an off-canvas drawer
(see the "Mobile navigation" section near the end of each portal's
`style.css`, and the matching JS in `js/admin.js`). If you add a new page
using this shell, you get that behavior for free — no extra work needed.

When adding new UI:
- Reuse existing classes (`.form-row`, `.modal-card`, `.admin-table-card`,
  etc.) rather than one-off styles — they already have mobile treatment.
- Wrap any new table in a container with `overflow-x: auto` so it scrolls
  instead of breaking the layout on narrow screens.
- Keep tappable elements (buttons, inputs) at least 44px tall — already the
  default under 480px via the shared small-screen rules, but worth checking
  if you add custom-sized controls.
- Test at common widths: ~375px (phone), ~768px (tablet), ~1280px+ (desktop).

## 8. Before you push, sanity check

```bash
python manage.py check
python manage.py makemigrations --check   # fails if you forgot to generate a migration
```

## Questions?

If something in this doc is unclear or the setup doesn't work for you, flag
it in the team chat rather than silently working around it — it usually
means this doc needs an update for the next person too.
