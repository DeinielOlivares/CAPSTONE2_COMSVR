# Barangay Platero OVRMS — System Guide

**Web-Based Community Ordinance Management System and Violations Reporting for the City of Biñan, using the Modified Blowfish Data Protection Algorithm.**

This guide explains the whole source code: what every folder and file is for,
where each feature lives, how the parts talk to each other, how the database is
organized, and what was changed in the clean-up refactor. Read sections 1–4
first; use the rest as a reference.

---

## Contents

1. [What the system does](#1-what-the-system-does)
2. [Running it on your computer](#2-running-it-on-your-computer)
3. [Technology used](#3-technology-used)
4. [Folder map](#4-folder-map)
5. [How a request travels through the system](#5-how-a-request-travels-through-the-system)
6. [Backend, file by file](#6-backend-file-by-file)
7. [API reference (every endpoint)](#7-api-reference-every-endpoint)
8. [Database design and normalization (3NF)](#8-database-design-and-normalization-3nf)
9. [Security features](#9-security-features)
10. [Frontend, file by file](#10-frontend-file-by-file)
11. [Main flows, step by step](#11-main-flows-step-by-step)
12. [Responsive design](#12-responsive-design)
13. [Tests](#13-tests)
14. [What changed in this refactor](#14-what-changed-in-this-refactor)

---

## 1. What the system does

The system has **three portals** (three separate websites served by one Django app):

| Portal | Address | Who uses it | Main features |
|---|---|---|---|
| **Citizen** | `/citizen/` | Residents (and guests) | Browse/download ordinances, file a violation report, submit a concern/suggestion, ask questions, read announcements, track own reports |
| **Staff** | `/staff/` | Barangay Officials | Work on reports and concerns, dashboards and heatmap, upload ordinances, answer questions, post announcements |
| **Admin** | `/admin/` | Administrators | Approve/manage accounts, audit logs, FAQs, ordinance categories/authors, About Us and website setup, map boundary and streets |

### User roles

Every account is one row in the `User` table. Two columns decide what a person can do:

* `role` — the access level: `citizen`, `staff` or `admin`.
* `position` — the staff job title. It decides which **sections** of the Staff portal they see:

| Position | Role | Can do |
|---|---|---|
| Barangay Captain | staff | Read-only Reports & Concerns dashboards, heatmap, announcements, questions |
| Secretary | staff | Concerns/Suggestions (remarks, folders), ordinances (upload/edit/archive), announcements, questions, invite citizens |
| Investigator | staff | Claim reports and update their status/remarks, questions |
| Administrator | admin | Everything in the Admin portal; may also act on reports/concerns |

### Personal data protection

Names, contact numbers, addresses, report/concern text and uploaded ID/evidence
photos are stored **encrypted** in the database and storage using the study's
**Modified Blowfish** algorithm (Blowfish-CBC + a random salt per value + PBKDF2
key derivation + a random IV per value). See [section 9](#9-security-features).

---

## 2. Running it on your computer

```bash
python -m venv venv
venv\Scripts\activate            # Windows   (Mac/Linux: source venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env           # then fill in SECRET_KEY and DATA_ENCRYPTION_KEY
python manage.py migrate
python manage.py createsuperuser # or set ADMIN_EMAIL/ADMIN_PASSWORD and run: python manage.py create_admin
python manage.py runserver
```

Open `http://127.0.0.1:8000/` (it redirects to the citizen home page). Staff and
Administrators log in at `http://127.0.0.1:8000/staff/`.

* Without `EMAIL_HOST_USER` in `.env`, emails (codes, links) are **printed in the terminal**.
* Without `DATABASE_URL`, a local `db.sqlite3` file is used.
* Run the tests with `python manage.py test` (see [section 13](#13-tests)).

More setup details (PostgreSQL, Git workflow) are in [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## 3. Technology used

| Part | Technology |
|---|---|
| Backend | Python, **Django 6**, **Django REST Framework** (API), **SimpleJWT** (login tokens) |
| Database | PostgreSQL in production, SQLite for development |
| Encryption | `cryptography` library (Blowfish, PBKDF2-HMAC-SHA256) — the study's Modified Blowfish |
| Frontend | Plain **HTML, CSS and JavaScript** (no framework); Leaflet (maps), PDF.js (PDF preview) |
| Files | Cloudinary in production, the `media/` folder in development |
| Email | Brevo SMTP |
| Other | scikit-learn (ordinance suggestions), ReportLab (dashboard PDF), WhiteNoise (serves the frontend) |
| Hosting | Render (`build.sh`, `Procfile`) |

---

## 4. Folder map

```
WCOMSVR/
├── manage.py                 Django's command-line tool (runserver, migrate, test…)
├── requirements.txt          Python packages
├── build.sh, Procfile        Render deployment (build steps, start command)
├── .env.example              Template for the secret settings file (.env)
├── README.md, CONTRIBUTING.md, SYSTEM_GUIDE.md
│
├── orms_backend/             The Django PROJECT: settings + code shared by all apps
│   ├── settings.py           All configuration (database, security, email, rate limits…)
│   ├── urls.py               Top-level URL map → each app's urls.py
│   ├── modified_blowfish.py  ★ The study's Modified Blowfish algorithm (unchanged)
│   ├── encrypted_fields.py   EncryptedTextField: encrypted text columns
│   ├── encrypted_storage.py  EncryptedStorage: encrypted uploaded photos + ProtectedMediaView
│   ├── codes.py              6-digit emailed codes (generate + check with attempt limit)
│   ├── emails.py             Every email the system sends
│   ├── validators.py         Shared upload check (images)
│   ├── tests*.py             Encryption, SQL-injection and resistance tests
│   └── wsgi.py, asgi.py      Server entry points
│
├── accounts/                 APP: user accounts, login, profile, admin account management, audit log
├── reports/                  APP: violation reports, concerns/suggestions, questions, FAQs
├── ordinances/               APP: ordinances (PDFs), categories, authors, views/downloads
├── siteinfo/                 APP: About Us, branding, footer, legal pages, map boundary, streets
├── announcements/            APP: announcements shown to citizens
│
├── frontend/                 The three websites (served by WhiteNoise)
│   ├── index.html            Redirects "/" to the citizen home page
│   ├── shared/               Used by every portal
│   │   ├── js/               common.js, auth-pages.js, pagination.js, streets.js, …
│   │   ├── fonts/, images/   Fonts, logo, background picture
│   │   └── vendor/           Third-party libraries: leaflet (maps), pdfjs (PDF preview)
│   ├── citizen/              Citizen portal: *.html pages, css/style.css, js/, drawables/ (portraits)
│   ├── staff/                Staff portal:   *.html pages, css/style.css, js/
│   └── admin/                Admin portal:   *.html pages, css/style.css, js/
│
└── research/                 Study materials — NOT used by the running website
    ├── modified_blowfish/    The original algorithm demo, its tests, and a script that proves
    │                         the system uses the same algorithm (verify_system_matches_demo.py)
    └── sample_ordinances/    Sample ordinance PDFs for testing uploads
```

### Inside every Django app

Each app (`accounts`, `reports`, `ordinances`, `siteinfo`, `announcements`) uses the same standard Django layout:

| File | What it holds |
|---|---|
| `models.py` | The database tables (one class = one table) |
| `serializers.py` | Converts between JSON and model objects, and **validates** incoming data |
| `views.py` | The API endpoints: receive a request, check permission, use serializers/models, return JSON |
| `urls.py` | Which URL goes to which view |
| `migrations/` | Step-by-step history of the database structure (Django generates these) |
| `tests.py` | Automated tests |
| `templates/emails/` | HTML emails (accounts and reports apps) |
| `admin.py` | Registers tables in Django's own admin site (`/django-admin/`) |

---

## 5. How a request travels through the system

Example: a citizen opens **My Reports**.

```
Browser: citizen/my-reports.html
   │ loads shared/js/common.js, citizen/js/my-reports-data.js, my-reports-list.js, main.js
   │ my-reports-data.js calls  authFetch("/api/reports/")           ← adds "Authorization: Bearer <token>"
   ▼
Django: orms_backend/urls.py  → "api/" → reports/urls.py → ReportListCreateView (reports/views.py)
   │ 1. JWT authentication finds the user from the token
   │ 2. permission_classes = [IsAuthenticated] is checked
   │ 3. rate limit (throttle) is checked
   │ 4. get_queryset(): Report.objects.filter(citizen=request.user)
   │ 5. ReportSerializer turns each Report into JSON
   │      EncryptedTextField decrypts location / nature_of_violation / remarks while reading
   ▼
JSON response → my-reports-list.js draws the table (pagination.js adds page buttons)
```

Writing data works the same way in reverse: the serializer **validates** the JSON,
the model is saved, `EncryptedTextField` **encrypts** the protected columns, the
view writes an **audit log** entry (`log_action`) and, when needed, sends an
**email** (`orms_backend/emails.py`).

---

## 6. Backend, file by file

### 6.1 `orms_backend/` — project settings and shared code

| File | Purpose | Main contents |
|---|---|---|
| `settings.py` | All configuration, read from environment variables / `.env` | Installed apps, database, password rules, JWT lifetimes (access 1 h, refresh 7 days), **rate limits** (`DEFAULT_THROTTLE_RATES`), email, storage, `DATA_ENCRYPTION_KEY`, `MODIFIED_BLOWFISH_ITERATIONS` |
| `urls.py` | Top-level URL map | `/api/auth/` → accounts, `/api/` → reports & ordinances, `/api/site/` → siteinfo, `/api/announcements/`, `/api/media/protected/<token>/` |
| `modified_blowfish.py` | **The study's algorithm** (not modified by the refactor) | `derive_key()` (PBKDF2-HMAC-SHA256, per-record salt), `encrypt_record()` / `decrypt_record()` (Blowfish-CBC with a random IV and PKCS7 padding), `encrypt_text()` / `decrypt_text()` |
| `encrypted_fields.py` | Encrypted database column | `EncryptedTextField` (encrypts on save, decrypts on read, refuses database searches), `encrypt_value()`, `decrypt_value()`, `encrypt_existing_rows()` (used by old data migrations) |
| `encrypted_storage.py` | Encrypted uploaded photos | `EncryptedStorage` (saves photos as encrypted blobs under `enc/`), `encrypt_bytes()`, `decrypt_bytes()`, `protected_url()` (signed 6-hour link), `ProtectedMediaView` (decrypts a file for a valid link) |
| `codes.py` | 6-digit codes | `generate_code()` (secure random), `check_code()` (counts wrong guesses; a code dies after 5) |
| `emails.py` | Every email | `send_templated_email()` (never crashes the request), one `send_…_email()` function per email type |
| `validators.py` | Upload check | `validate_image_upload()` (JPG/PNG/WebP, max 5 MB) |

### 6.2 `accounts/` — users, login, profile, account management

| File | Purpose |
|---|---|
| `models.py` | Tables `User`, `VoterVerification`, `PasswordResetCode`, `ProfileEditVerificationCode`, `LoginSession`, `AuditLog`; helper `log_action(user, action)` writes an audit log entry. `User.display_name` (full name or username) and `User.account_type` ("Administrator" / "Barangay Citizen" / position) are used everywhere. |
| `permissions.py` | Who may call an endpoint: `IsAdmin`, `IsStaffOrAdmin`, `IsInvestigatorOrAdmin`, `IsSecretaryOrAdmin`, `IsDocumentManager`, `IsAnnouncementManager` |
| `serializers.py` | Validation for sign up, account creation, account setup, profile, password change, **login** (`CustomTokenObtainPairSerializer`), Forgot Password, and the admin pages' JSON (`AdminAccountSerializer`, `PendingVerificationSerializer`, `AuditLogSerializer`). Shared checks: `clean_ph_mobile()`, `check_email_available()`, `check_phone_available()`, `validate_staff_role_uniqueness()` |
| `views.py` | Endpoints under `/api/auth/` (see [section 7](#7-api-reference-every-endpoint)), grouped as: sign up/login/logout · Forgot Password · setup & reset links · My Profile · admin account management · approvals & audit logs |
| `lockout.py` | Brute-force protection: 10 wrong passwords within 60 min → account locked 30 min + email (`record_failed_login`, `clear_failed_logins`, `lockout_minutes_remaining`) |
| `setup_links.py` | One-time emailed links: account setup (72 h) and admin-sent password reset (24 h). Uses Django's token generator; no token table needed. |
| `throttles.py` | `ResetRequestEmailThrottle`: limits code/link requests per **email address** |
| `password_validators.py` | `CharacterClassValidator`: needs a lowercase, an uppercase and a special character |
| `middleware.py` | `CurrentRequestMiddleware` + `client_ip()`: lets `log_action` record the IP address |
| `management/commands/create_admin.py` | `python manage.py create_admin` — first Administrator from env vars |
| `management/commands/encrypt_existing_files.py` | One-time: encrypt photos uploaded before encryption existed |
| `templates/emails/` | The account emails; `_base.html` is the shared email layout used by all apps |

**Login checks, in order** (`CustomTokenObtainPairSerializer.validate`):
1. account not locked (lockout), 2. account already set up (has a password),
3. password correct (a wrong one counts toward the lockout), 4. account belongs to
the portal used (citizens on `/citizen/`, staff/admins on `/staff/`), 5. a citizen's
voter's ID has been approved. Then a `LoginSession` row and a "Logged in" audit entry are created.

### 6.3 `reports/` — reports, concerns, questions, FAQs

| File | Purpose |
|---|---|
| `models.py` | `Report` (+ `next_report_number()` → "YYYYMMDD-N"), `ReportAttachment`, `ReportVerificationCode`, `ConcernFolder`, `Concern`, `ConcernAttachment`, `Question`, `FAQ` |
| `serializers.py` | Citizen side (`ReportSerializer`, `ConcernSerializer`, `QuestionSerializer`, `ReportVerifyCodeSerializer`) and staff side (`StaffReport…`, `StaffConcern…`, `StaffQuestion…`, `ConcernFolderSerializer`), `FAQSerializer`. Attachment limits: 5 files, 50 MB total. Device coordinates outside the barangay are dropped. |
| `views.py` | Endpoints under `/api/` for reports, concerns, folders, questions, FAQs (see section 7) |
| `verification.py` | Anti-abuse for filing reports: identity code on the first report (and after 30 days), 2-hour cooldown, auto-disable after 5 reports in 12 hours |
| `pdf.py` | `build_dashboard_pdf()`: the Reports Dashboard's "Download Summary (PDF)" |
| `templates/emails/` | Report/suggestion/question emails |

**Report status flow:** `submitted` → `under_review` → `in_action` → `resolved` *or* `with_remarks`.
A report is a shared queue: an Investigator **claims** it, then only they (or an Administrator)
may update it. An Administrator can **release** (forfeit) or **assign** a claim. When a
report becomes Resolved/With Remarks the citizen is emailed.

**Concern status:** `submitted` → `reviewed` (automatically, when the Secretary adds remarks or files it in a folder).

### 6.4 `ordinances/`

| File | Purpose |
|---|---|
| `models.py` | `Ordinance` (PDF stored with `pdf_storage()`), `OrdinanceAuthor` (suggestion list for the Author field), `OrdinanceCategory` (the allowed categories), `OrdinanceView` (citizen opened it), `OrdinanceDownload` (citizen downloaded it — once per citizen) |
| `serializers.py` | `OrdinanceSerializer` (adds `pdf_url`, `is_new`, `is_updated`, `is_unread`, `in_latest` for the home page), write serializers (category must be active, PDF must really be a PDF ≤ 20 MB), author/category serializers (only one active Barangay Captain and SK Chairperson) |
| `views.py` | List/upload, detail/edit, archive/unarchive, download (logged), mark viewed, suggestions, categories, authors |
| `matching.py` | `suggest_ordinances()`: TF-IDF + cosine similarity between the citizen's description and each ordinance (used by File a Report) |

Citizens and guests only see **published** (not archived) ordinances.

### 6.5 `siteinfo/` — content the Administrator edits

| File | Purpose |
|---|---|
| `models.py` | `BarangayProfile` (one row: barangay details, branding, footer text) with child tables `FooterLink` and `BoundaryPoint`; `Street`; `CouncilMember`; `AboutLogo`; `LegalDocument` with child table `LegalSection` |
| `serializers.py` | Validation: footer links (max 12, safe URLs only), boundary (3–2000 points near Biñan), streets, images (5 MB), legal sections |
| `views.py` | About Us (public), profile, branding, boundary, streets, council members, logos (with reorder), legal pages |

### 6.6 `announcements/`

| File | Purpose |
|---|---|
| `models.py` | `Announcement`, `AnnouncementView` (a user has seen it) |
| `serializers.py` | `AnnouncementSerializer` (image upload, `remove_image`, per-viewer `is_read`) |
| `views.py` | Public list, mark viewed, staff list/create (emails every citizen), edit/delete |

### 6.7 How audit logging and emails are wired

* **Audit log:** views call `log_action(request.user, "…what happened…")` *after* the action
  succeeds. It saves the user, the action text, the IP address (from `CurrentRequestMiddleware`)
  and a copy of the user's name and account type. Shown on **Admin › View Audit Logs**.
* **Emails:** views call the matching `send_…_email()` in `orms_backend/emails.py`. Each renders
  `emails/<name>.html`. A mail failure is logged, never shown to the user.

---

## 7. API reference (every endpoint)

"Who" uses the permission classes from `accounts/permissions.py`. "Anyone" means no login is needed.

### 7.1 Accounts — `/api/auth/`

| Method | URL | Who | What it does | View |
|---|---|---|---|---|
| POST | `register/` | Anyone | Citizen sign up (fields + voter's ID photo) | `RegisterView` |
| POST | `check-availability/` | Anyone | Is the email / phone still free? | `CheckAccountAvailabilityView` |
| POST | `login/` | Anyone | Log in → `{access, refresh, user}` | `LoginView` |
| POST | `refresh/` | Anyone (with refresh token) | New access token | SimpleJWT `TokenRefreshView` |
| POST | `logout/` | Logged in | Records the logout time | `LogoutView` |
| GET / PATCH / DELETE | `me/` | Logged in | View / edit own profile (email, phone, address need a code) / citizen deletes own account | `MeView` |
| POST | `profile-edit/request-code/` | Logged in | Emails the code for profile changes | `ProfileEditCodeRequestView` |
| POST | `change-password/` | Logged in | Change password (current password required) | `ChangePasswordView` |
| POST | `password-reset/request/` | Anyone | Forgot Password 1: email a code | `PasswordResetRequestView` |
| POST | `password-reset/verify/` | Anyone | Forgot Password 2: check the code | `PasswordResetVerifyView` |
| POST | `password-reset/confirm/` | Anyone | Forgot Password 3: set the new password | `PasswordResetConfirmView` |
| POST | `account-setup/check/` | Anyone (with link) | Is the setup link valid? Returns details to pre-fill | `AccountSetupCheckView` |
| POST | `account-setup/request-link/` | Anyone | Email a new setup link | `AccountSetupLinkRequestView` |
| POST | `account-setup/` | Anyone (with link) | Finish setup (details + password) and log in | `AccountSetupView` |
| POST | `password-link/check/` | Anyone (with link) | Is the admin-sent reset link valid? | `PasswordLinkCheckView` |
| POST | `password-link/` | Anyone (with link) | Set the new password from the link | `PasswordLinkConfirmView` |
| POST | `admin/create-user/` | Admin | New staff/admin account (email + role) | `AdminCreateUserView` |
| POST | `admin/create-citizen/` | Secretary, Admin | New citizen account from an email | `AdminInviteCitizenView` |
| POST | `admin/create-citizen-direct/` | Admin | New citizen account with all details | `StaffCreateCitizenView` |
| GET | `admin/users/` | Admin | Manage Accounts list | `AdminListUsersView` |
| GET / PATCH / DELETE | `admin/users/<id>/` | Admin | View / enable-disable or change role / delete | `AdminAccountDetailView` |
| POST | `admin/users/<id>/reset-password/` | Admin | Email a password reset link (staff only) | `AdminResetPasswordView` |
| POST | `admin/users/<id>/resend-setup-link/` | Admin | Email a new setup link | `AdminResendSetupLinkView` |
| GET | `admin/verifications/` | Admin | Pending voter's ID approvals | `AdminListPendingVerificationsView` |
| POST | `admin/verifications/<id>/approve/` | Admin | Approve a citizen | `AdminApproveVerificationView` |
| POST | `admin/verifications/<id>/reject/` | Admin | Reject (with reason) — the account is deleted | `AdminRejectVerificationView` |
| GET | `admin/audit-logs/` | Admin | View Audit Logs | `AdminListAuditLogsView` |

### 7.2 Reports, concerns, questions, FAQs — `/api/`

| Method | URL | Who | What it does | View |
|---|---|---|---|---|
| GET / POST | `reports/` | Logged in | Own reports / file a report (checks cooldown + verification) | `ReportListCreateView` |
| GET | `reports/<id>/` | Logged in (owner) | One own report | `ReportDetailView` |
| GET | `reports/verification-status/` | Logged in | Is a code needed? Cooldown left? | `ReportVerificationStatusView` |
| POST | `reports/send-verification/` | Logged in | Email a report verification code | `ReportSendVerificationView` |
| POST | `reports/verify-code/` | Logged in | Check that code | `ReportVerifyCodeView` |
| GET | `reports/staff/` | Staff, Admin | All reports (`?assigned_to=`, `?active=1`) | `StaffReportListView` |
| GET | `reports/staff/analysis-base/` | Staff, Admin | Number of approved citizens | `StaffReportAnalysisBaseView` |
| GET / PATCH | `reports/staff/<id>/` | Staff, Admin (PATCH: the claiming Investigator or Admin) | View / update status & remarks | `StaffReportDetailView` |
| POST | `reports/staff/<id>/claim/` | Investigator, Admin | Claim a report | `StaffReportClaimView` |
| POST | `reports/staff/<id>/forfeit/` | Admin | Release a claim | `StaffReportForfeitView` |
| POST | `reports/staff/<id>/assign/` | Admin | Assign to an Investigator | `StaffReportAssignView` |
| POST | `reports/staff/dashboard-pdf/` | Staff, Admin | Dashboard summary PDF | `StaffReportDashboardPdfView` |
| GET / POST | `concerns/` | Logged in | Own concerns / submit one | `ConcernListCreateView` |
| GET | `concerns/<id>/` | Logged in (owner) | One own concern | `ConcernDetailView` |
| GET | `concerns/staff/` | Staff, Admin | All concerns | `StaffConcernListView` |
| GET / PATCH | `concerns/staff/<id>/` | Staff, Admin (PATCH: Secretary, Admin) | View / remarks & folder | `StaffConcernDetailView` |
| GET / POST | `concerns/folders/` | GET staff; POST Secretary, Admin | Folders | `ConcernFolderListCreateView` |
| GET / PATCH / DELETE | `concerns/folders/<id>/` | GET staff; change Secretary, Admin | Rename / delete a folder | `ConcernFolderDetailView` |
| GET / POST | `questions/` | Logged in | Own questions / ask one | `QuestionListCreateView` |
| GET | `questions/staff/` | Staff, Admin | All questions | `StaffQuestionListView` |
| PATCH | `questions/staff/<id>/` | Staff, Admin | Answer (citizen is emailed) | `StaffQuestionAnswerView` |
| GET | `faqs/` | Anyone | Public FAQs | `FAQListView` |
| GET / POST | `faqs/admin/` | Admin | Manage FAQs | `AdminFAQListCreateView` |
| GET / PATCH / DELETE | `faqs/admin/<id>/` | Admin | Edit / delete an FAQ | `AdminFAQDetailView` |

### 7.3 Ordinances — `/api/ordinances/`

| Method | URL | Who | What it does | View |
|---|---|---|---|---|
| GET / POST | `` (root) | GET anyone; POST Secretary, Admin | List / upload | `OrdinanceListCreateView` |
| GET / PATCH | `<id>/` | GET anyone; PATCH Secretary, Admin | One / edit | `OrdinanceDetailView` |
| POST | `<id>/archive/`, `<id>/unarchive/` | Secretary, Admin | Hide from / show to citizens | `OrdinanceArchiveView`, `OrdinanceUnarchiveView` |
| GET | `<id>/download/` | Logged in | PDF link (citizens: once each), logged | `OrdinanceDownloadView` |
| POST | `<id>/view/` | Logged in | Mark as opened (citizens) | `OrdinanceMarkViewedView` |
| GET | `suggest/?q=…` | Anyone | Best-matching ordinances for a description | `OrdinanceSuggestView` |
| GET / POST | `categories/` | GET Secretary, Admin; POST Admin | Category list | `OrdinanceCategoryListCreateView` |
| PATCH / DELETE | `categories/<id>/` | Admin | Rename / retire / delete | `OrdinanceCategoryDetailView` |
| GET / POST | `authors/` | GET Secretary, Admin; POST Admin | Author list | `OrdinanceAuthorListCreateView` |
| PATCH / DELETE | `authors/<id>/` | Admin | Edit / end term / delete | `OrdinanceAuthorDetailView` |

### 7.4 Site information — `/api/site/`

| Method | URL | Who | What it does | View |
|---|---|---|---|---|
| GET | `about/` | Anyone | About Us page + footer data | `AboutPublicView` |
| GET / PATCH | `profile/` | Admin | Barangay details and footer | `BarangayProfileView` |
| GET | `branding/` | Anyone | Brand name + logo | `BrandingPublicView` |
| GET / PATCH | `branding/admin/` | Admin | Change brand name / logo | `BrandingView` |
| GET / PUT | `boundary/` | GET anyone; PUT Admin | Barangay outline | `BoundaryView` |
| GET / POST | `streets/` | GET anyone; POST Admin | Streets | `StreetListCreateView` |
| PATCH / DELETE | `streets/<id>/` | Admin | Edit / remove a street | `StreetDetailView` |
| GET / POST | `council/`, `logos/` | Admin | Council members / logos | `CouncilMemberListCreateView`, `AboutLogoListCreateView` |
| PATCH / DELETE | `council/<id>/`, `logos/<id>/` | Admin | Edit / remove | `CouncilMemberDetailView`, `AboutLogoDetailView` |
| POST | `council/reorder/`, `logos/reorder/` | Admin | Save a new order | `CouncilMemberReorderView`, `AboutLogoReorderView` |
| GET / PUT | `legal/<key>/` (key = `privacy` or `terms`; PUT via `…/admin/`) | GET anyone; PUT Admin | Privacy Policy / Terms text | `LegalDocumentView` |

### 7.5 Announcements — `/api/announcements/`

| Method | URL | Who | What it does | View |
|---|---|---|---|---|
| GET | `` (root) | Anyone | All announcements (`is_read` per viewer) | `AnnouncementListView` |
| POST | `<id>/view/` | Logged in | Mark as seen | `AnnouncementMarkViewedView` |
| GET / POST | `staff/` | GET staff; POST Secretary, Captain, Admin | List / post (emails every citizen) | `StaffAnnouncementListCreateView` |
| PATCH / DELETE | `staff/<id>/` | Secretary, Captain, Admin | Edit / delete | `StaffAnnouncementDetailView` |

### 7.6 Other

| Method | URL | What it does |
|---|---|---|
| GET | `/api/media/protected/<token>/` | Decrypts and returns an encrypted photo (the signed link is the permission) |
| GET | `/django-admin/` | Django's built-in admin site (developers only) |

---

## 8. Database design and normalization (3NF)

### 8.1 Tables and relationships

```
                         ┌──────────────────────────── accounts_user ────────────────────────────┐
                         │ id (PK), email (unique), role, position, names*, contact*, address*,   │
                         │ is_verified, lockout fields, Django login fields      (* = encrypted)  │
                         └────────────────────────────────────────────────────────────────────────┘
   1 : 1  accounts_voterverification (user_id, reviewed_by_id → user)
   1 : N  accounts_passwordresetcode, accounts_profileeditverificationcode,
          reports_reportverificationcode, accounts_loginsession,
          accounts_auditlog (user_id may become NULL when the user is deleted)
   1 : N  reports_report (citizen_id; assigned_investigator_id and previous_investigator_id → user)
              └─ 1 : N reports_reportattachment
   1 : N  reports_concern (citizen_id) ── N : 1 reports_concernfolder
              └─ 1 : N reports_concernattachment
   1 : N  reports_question (citizen_id; answered_by_id → user)
   1 : N  ordinances_ordinance (uploaded_by_id)
   N : M  ordinances_ordinance  ⇄ user   through ordinances_ordinanceview      (unique ordinance+citizen)
   N : M  ordinances_ordinance  ⇄ user   through ordinances_ordinancedownload  (unique ordinance+citizen)
   1 : N  announcements_announcement (posted_by_id)
   N : M  announcements_announcement ⇄ user through announcements_announcementview (unique user+announcement)

   siteinfo_barangayprofile (always one row, id = 1)
              ├─ 1 : N siteinfo_footerlink     (kind = quick | legal, order)
              └─ 1 : N siteinfo_boundarypoint  (order, latitude, longitude)
   siteinfo_legaldocument (key = privacy | terms) ─ 1 : N siteinfo_legalsection (order, anchor, heading, body)

   Stand-alone lookup tables: reports_faq, ordinances_ordinancecategory, ordinances_ordinanceauthor,
   siteinfo_street, siteinfo_councilmember, siteinfo_aboutlogo
```

### 8.2 Tables at a glance

| Table | Primary key | Foreign keys | Notes |
|---|---|---|---|
| `accounts_user` | `id` (UUID) | — | `email` unique; personal columns encrypted |
| `accounts_voterverification` | `id` | `user_id` (1:1, cascade), `reviewed_by_id` (set null) | status: pending / approved / rejected |
| `accounts_passwordresetcode` | `id` | `user_id` | code, expires_at, verified_at, used_at, failed_attempts |
| `accounts_profileeditverificationcode` | `id` | `user_id` | code, expires_at, used_at, failed_attempts |
| `accounts_loginsession` | `id` | `user_id` | logged_in_at, logged_out_at |
| `accounts_auditlog` | `id` | `user_id` (set null) | action, ip_address, owner_name*, owner_type, created_at |
| `reports_report` | `id` | `citizen_id`, `assigned_investigator_id`, `previous_investigator_id` | `report_number` unique; status; location*, nature_of_violation*, remarks* |
| `reports_reportattachment` | `id` | `report_id` | file (photos encrypted) |
| `reports_reportverificationcode` | `id` | `user_id` | code, expires_at, verified_at, failed_attempts |
| `reports_concernfolder` | `id` | — | `name` unique |
| `reports_concern` | `id` | `citizen_id`, `folder_id` (set null) | location*, description*, remarks*, status, reviewed_at |
| `reports_concernattachment` | `id` | `concern_id` | file |
| `reports_question` | `id` | `citizen_id`, `answered_by_id` | question*, answer, answered_at |
| `reports_faq` | `id` | — | question, answer |
| `ordinances_ordinance` | `id` | `uploaded_by_id` | number, title, author, category, date_approved, description, pdf_file, is_archived |
| `ordinances_ordinanceauthor` | `id` | — | name, position, is_active |
| `ordinances_ordinancecategory` | `id` | — | `name` unique, is_active |
| `ordinances_ordinanceview` / `…download` | `id` | `ordinance_id`, `citizen_id` | unique (ordinance, citizen) |
| `siteinfo_barangayprofile` | `id` (=1) | — | barangay details, branding, footer text |
| `siteinfo_footerlink` | `id` | `profile_id` | kind, order, label, url |
| `siteinfo_boundarypoint` | `id` | `profile_id` | order, latitude, longitude |
| `siteinfo_street` | `id` | — | `name` unique, latitude, longitude |
| `siteinfo_councilmember` | `id` | — | name, position, group, photo, order, is_visible |
| `siteinfo_aboutlogo` | `id` | — | image, alt_text, order, is_visible |
| `siteinfo_legaldocument` | `id` | — | `key` unique, effective_date |
| `siteinfo_legalsection` | `id` | `document_id` | order, anchor, heading, body |
| `announcements_announcement` | `id` | `posted_by_id` | title, description, image, is_edited |
| `announcements_announcementview` | `id` | `user_id`, `announcement_id` | unique (user, announcement) |

(`*` = encrypted with Modified Blowfish.)

### 8.3 How the design meets 1NF, 2NF and 3NF

**1NF — every column holds one value, no repeating groups.**
Lists are stored as rows of a child table, never inside one column:
attachments (`reports_reportattachment`, `reports_concernattachment`), footer links
(`siteinfo_footerlink`), the barangay outline (`siteinfo_boundarypoint`) and legal page
sections (`siteinfo_legalsection`). *The last three used to be JSON lists inside a single
column; this refactor moved them into their own tables (migration
`siteinfo/migrations/0015_normalize_json_lists.py`, which also copies the existing data).*

**2NF — no column depends on only part of a key.**
Every table has a single-column primary key (`id`), so partial dependencies can't
happen. Pairs that must be unique (e.g. ordinance + citizen in `ordinanceview`) are
enforced with a unique constraint, not used as the key.

**3NF — no column depends on another non-key column.**
Facts are stored once, in the table they describe, and other tables point to them with
foreign keys: the citizen's name lives only in `accounts_user` (reports show it by
following `citizen_id`), folders are referenced by `folder_id`, investigators by
`assigned_investigator_id`, and so on. Values that can be *calculated* are not stored:
`Question.is_answered` (answer is filled in), a folder's concern count, an ordinance's
"New/Updated" flags, the report counts on Manage Accounts and all dashboard numbers are
computed when read.

**Columns that look duplicated but are deliberate "point-in-time" values.** These
record what was true *when the event happened*. They do not depend on another column of
the same row, so they don't break 3NF — and the tests require them to stay this way:

| Column | Why it is stored |
|---|---|
| `accounts_auditlog.owner_name`, `owner_type` | The name/type of the account **at the time of the action**; must survive renaming or deleting the account (an audit trail must not change). |
| `reports_report.ordinance` | The ordinance **as the citizen cited it** when filing; the ordinance may be edited or archived later. |
| `ordinances_ordinance.category`, `author` | Saved at upload time; renaming or retiring a category/author later must not rewrite old ordinances (tested). The author may also be someone outside the roster. |
| `reports_report.location`, `accounts_user.address` | Free-text addresses ("Blk 1 Lot 2, Street"), encrypted; deleting a street must not change old reports. |

`role` and `position` on `User` are two different facts: `role` is the access level and
`position` is the job title. Citizens and older accounts have no position, so position
does not determine role.

---

## 9. Security features

| Feature | Where | How it works |
|---|---|---|
| **Modified Blowfish encryption** | `orms_backend/modified_blowfish.py`, `encrypted_fields.py`, `encrypted_storage.py` | Each value gets a new random 16-byte salt → PBKDF2-HMAC-SHA256 derives its own 256-bit key from `DATA_ENCRYPTION_KEY` → Blowfish-CBC with a new random 8-byte IV. The same text never encrypts the same way twice. The key never goes in the database. |
| **Encrypted photos** | `encrypted_storage.py` | Voter's IDs and evidence photos are stored encrypted; the browser gets a signed link that expires (6–12 hours) and `ProtectedMediaView` decrypts on request. Non-image files are sent as downloads only. |
| **Passwords** | Django + `password_validators.py` | Hashed by Django (PBKDF2). Rules: 8+ characters, not common, not all digits, not similar to name/email, has lowercase + uppercase + special character. |
| **Login tokens (JWT)** | SimpleJWT, `settings.SIMPLE_JWT` | Access token 1 hour, refresh token 7 days (rotated). Disabling an account blocks it immediately. |
| **Brute-force protection** | `accounts/lockout.py` | 10 wrong passwords → locked 30 minutes + email. |
| **Rate limiting** | `settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`, `throttles.py` | Per IP and per account, plus tighter limits on login, sign up, codes and links (and per email for reset requests). |
| **6-digit codes** | `orms_backend/codes.py` | Secure random; dies after 5 wrong guesses or 15 minutes; only the newest code works. |
| **One-time links** | `accounts/setup_links.py` | Signed tokens that die once used, when a new one is sent, or after 72 h / 24 h. The token is kept after `#` in the URL so it never reaches server logs. |
| **Permissions** | `accounts/permissions.py` | Every endpoint checks the role/position on the server, not only in the page. |
| **No account probing** | login, Forgot Password, setup link request | Same answer whether or not an email is registered. |
| **SQL injection** | Django ORM | All queries are parameterized; no raw SQL with user input (tested in `orms_backend/tests_injection.py`). |
| **Report abuse** | `reports/verification.py` | Identity code, cooldown, automatic disable on rapid filing. |
| **Audit trail** | `accounts.models.log_action` | Every important action with user, IP and time. |
| **Upload checks** | serializers + `validators.py` | Type and size limits; PDFs must start with `%PDF-`. |

---

## 10. Frontend, file by file

The frontend is plain HTML/CSS/JavaScript — no build step. Each HTML page loads its
scripts with `<script>` tags; all scripts on a page share one global scope, so a
function defined in one file can be called from another file loaded on the same page.

### 10.1 The rule for every page

```html
<head>
  <link rel="stylesheet" href="css/style.css" />        <!-- the portal's stylesheet -->
  <script src="/shared/js/common.js"></script>          <!-- 1. shared helpers (always first) -->
  <script src="js/staff-nav.js"></script>               <!--    (staff pages only)            -->
</head>
<body>
  …page markup…
  <script src="js/<data file>.js"></script>             <!-- 2. talks to the API for this page -->
  <script src="js/<page>.js"></script>                  <!-- 3. this page's behavior           -->
  <script src="js/main.js | js/layout.js"></script>     <!-- 4. the portal's page frame (last) -->
</body>
```

* **`*-data.js` files** only fetch/save data (API calls) and keep it in memory.
* **Page files** (e.g. `reports-list.js`) draw the page and react to clicks.
* **Frame files** (`citizen/js/main.js`, `staff/js/layout.js`, `admin/js/layout.js`) handle what every page of the portal has: navbar/sidebar, profile popup, logout, notification bell.

### 10.2 `frontend/shared/` — used by all portals

| File | What it does | Main functions |
|---|---|---|
| `js/common.js` | Helpers every page needs | **Session:** `getCurrentUser`, `isLoggedIn`, `logOut`, `storeAuthSession`, `authFetch` (adds the token, refreshes it when expired) · **Messages:** `showFormError`, `markFieldInvalid`, `siteAlert`, `siteConfirm` · **Lists:** `wireFiltersDropdown`, `createFilterMemory`, `pageSizeFrom`, `skeletonTableRows` · **Forms:** `guardUnsavedForm` ("Save Changes?"), `isValidPhMobile` · **Passwords:** `getPasswordRuleStatus`, `getPasswordRequirementError`, `setupPasswordHints`, `setupPasswordVisibilityToggles` · **Look:** `applySiteBranding`, `setFavicon`, `renderAvatar`, `timeAgo` · **Bell:** `createNotificationStore`, `setupNotificationBell` |
| `js/auth-pages.js` | Login, Sign Up (2 steps), Forgot Password (3 steps), account setup link, admin-sent reset link — for the citizen and staff portals | `apiLogin`, `apiRegister`, `apiCheckAvailability`, `apiRequestPasswordReset`, `apiVerifyPasswordResetCode`, `apiConfirmPasswordReset`, `apiCheckSetupLink`, `apiCompleteAccountSetup`, `handleLogin`, `handleSignupStep1/2`, `handleForgotRequest/Verify/Confirm`, `wireAccountSetup`, `wireResetLinkForm`, `loginHome` (where each role lands) |
| `js/pagination.js` | Page buttons under every list | `renderPaginationControls` |
| `js/streets.js` | The street list (from the API) and the street picker | `ensureStreetsLoaded`, `STREETS`, `streetCoordinate`, `wireStreetCombobox` |
| `js/evidence.js` | Report/concern photo thumbnails and the full-size viewer | `renderEvidence`, `openMediaLightbox` |
| `js/notifications-page.js` | The Notifications page of every portal | — |
| `js/pdf-preview.js` | Shows an ordinance PDF inside the page (PDF.js) | `renderPdfPreview` |
| `js/report-form-download.js` | "Download Report" — the filled-in report form as a one-page PDF | `downloadReportForm` |
| `fonts/`, `images/` | Poppins and Mate SC fonts, logo, background photo | |
| `vendor/leaflet/`, `vendor/pdfjs/` | Third-party libraries (maps, PDF preview) — don't edit | |

### 10.3 Citizen portal — `frontend/citizen/`

| Page | Shows | Scripts (besides `common.js`) |
|---|---|---|
| `home.html` | News & announcements, latest ordinances, ordinances by category | `site-footer.js`, `main.js`, `home.js` |
| `ordinances.html` / `ordinance-detail.html` | Ordinance list / one ordinance with PDF preview and download | `ordinances-data.js`, `ordinances-list.js` / `ordinance-detail.js`, `shared/js/pdf-preview.js` |
| `file-report.html` | File a Report (code check, ordinance suggestions, location) | `shared/js/streets.js`, `ordinances-data.js`, `file-report.js` |
| `submit-suggestion.html` | Submit a concern/suggestion | `submit-suggestion.js` |
| `my-reports.html` / `my-report-detail.html` | The citizen's reports / one report (timeline, remarks, Download Report) | `my-reports-data.js`, `my-reports-list.js` / `my-report-detail.js`, `shared/js/evidence.js`, `shared/js/report-form-download.js` |
| `my-concerns.html` / `my-concern-detail.html` | The citizen's concerns / one concern | `my-concerns-data.js`, `my-concerns-list.js` / `my-concern-detail.js`, `shared/js/evidence.js` |
| `faqs.html` | FAQs (+ "Ask a Question") | `faqs-data.js`, `faqs.js` |
| `about.html` | About Us (council, logos, contact) | `about.js` |
| `privacy-policy.html`, `terms.html` | Legal pages | `legal.js` |
| `notifications.html` | All notifications | `shared/js/notifications-page.js` |
| `profile.html` | My Profile (edit, change password, delete account) | `shared/js/streets.js`, `profile.js` |
| `login.html`, `signup.html`, `verify-signup.html`, `signup-success.html` | Log in / sign up (2 steps) | `shared/js/auth-pages.js` |
| `forgot-password.html`, `verify-code.html`, `reset-password.html`, `reset-success.html` | Forgot Password (3 steps) | `shared/js/auth-pages.js` |
| `account-setup.html` | Finish an account someone else created (from the emailed link) | `shared/js/streets.js`, `shared/js/auth-pages.js` |
| `index.html` | Redirects to `login.html` | — |

Every citizen page also loads `site-footer.js` (footer + barangay details) and `main.js` (navbar,
mobile menu, account popup, logout, notification bell, "Ask a Question", upload boxes).
`drawables/` holds the council portraits and seals shown on About Us.

**Citizen notifications** (`main.js`): every 30 seconds the citizen's reports and concerns are
fetched; if one's status or remarks changed since last time, a notification is added (stored in
the browser's localStorage).

### 10.4 Staff portal — `frontend/staff/`

| Page | Who sees it | Scripts (besides `common.js`, `staff-nav.js`, `layout.js`) |
|---|---|---|
| `reports-dashboard.html` | Barangay Captain | `shared/js/streets.js`, `heatmap.js`, `geo-analysis.js`, `ordinances-data.js`, `reports-data.js`, `reports-dashboard.js` |
| `geo-analysis.html` | Barangay Captain | same as above + `geo-analysis-page.js` |
| `investigator-dashboard.html` | Investigator | `ordinances-data.js`, `reports-data.js`, `investigator-dashboard.js` |
| `reports.html?view=unclaimed / mine / others / claimed` | Investigator, Captain | `ordinances-data.js`, `reports-data.js`, `shared/js/pagination.js`, `reports-list.js` |
| `report-detail.html` | All staff (only the claiming Investigator edits) | `reports-data.js`, `shared/js/evidence.js`, `shared/js/report-form-download.js`, `report-detail.js` |
| `secretary-dashboard.html` | Secretary | `ordinances-data.js`, `concerns-data.js`, `questions-data.js`, `secretary-dashboard.js` |
| `concerns-dashboard.html` | Barangay Captain | `concerns-data.js`, `concerns-dashboard.js` |
| `concerns.html` / `concern-detail.html` | Secretary (Captain read-only) | `concerns-data.js`, `concerns-list.js` / `concern-detail.js`, `shared/js/evidence.js` |
| `ordinances.html`, `ordinance-detail.html`, `upload-ordinance.html` | All staff (Secretary edits) | `ordinances-data.js`, `ordinances-list.js` / `ordinance-detail.js` / `upload-ordinance.js` |
| `announcements.html` | Secretary, Captain | `announcements.js` |
| `questions.html` | All staff | `questions-data.js`, `questions-list.js` |
| `notifications.html`, `profile.html` | All staff | `shared/js/notifications-page.js` / `staff-profile.js` |
| `index.html` (login), `forgot-password.html`, `verify-code.html`, `reset-password.html`, `reset-success.html`, `account-setup.html`, `new-password.html` | Not logged in (also used by Administrators) | `shared/js/auth-pages.js` only |

* **`staff-nav.js`** holds `STAFF_NAV_ACCESS` — the single list of which position may open which page.
  `hideStaffNavLinks()` hides the other sidebar links while the page loads.
* **`layout.js`** checks the user is a logged-in staff member (else back to the login page),
  sends them away from pages their position can't open, wires the sidebar, profile popup,
  logout, and the bell (new reports for Investigators/Captain, new concerns for Secretary/Captain;
  a brand-new item opens the dropdown and flashes the bell).
* **Data files:** `reports-data.js` (reports + period/date helpers), `concerns-data.js`
  (concerns + folders), `ordinances-data.js` (ordinances, upload/edit/archive, authors and
  categories), `questions-data.js`.
* **Maps:** `heatmap.js` (`createIncidentHeatmap`, `countByLocation`) and `geo-analysis.js`
  (`createGeoAnalysis`, `renderGeoSummary`).

### 10.5 Admin portal — `frontend/admin/`

| Page | What the Administrator does there | Scripts (besides `common.js`, `layout.js`) |
|---|---|---|
| `approve-accounts.html` | Approve/reject new citizens (view their voter's ID) | `pending-accounts-data.js`, `shared/js/pagination.js`, `approve-accounts.js` |
| `manage-accounts.html` | Enable/disable, change role, reset password / resend setup link, release claimed reports, delete | `accounts-data.js`, `shared/js/pagination.js`, `manage-accounts.js` |
| `create-accounts.html` | Create a staff or citizen account | `shared/js/streets.js`, `accounts-data.js`, `create-accounts.js` |
| `audit-logs.html` | View Audit Logs | `audit-log-data.js`, `shared/js/pagination.js`, `audit-logs.js` |
| `activity.html` | Reports/suggestions filed per citizen | `activity.js` |
| `reports.html` | Assign unclaimed reports to Investigators; workload per Investigator | `shared/js/pagination.js`, `reports.js` |
| `questions.html`, `manage-faqs.html` | Answer questions; manage FAQs | `questions-data.js`, `questions-list.js` / `faqs-manage.js` |
| `ordinance-authors.html` | Ordinance Setup: authors and categories | `ordinance-authors-data.js`, `ordinance-authors.js`, `ordinance-categories-data.js`, `ordinance-categories.js` |
| `about-setup.html` | About Us: barangay details, council members, logos | `about-setup-data.js`, `about-setup.js` |
| `website-setup.html` | Brand name/logo, footer, legal pages | `about-setup-data.js`, `website-setup.js` |
| `map-boundary.html` | Barangay outline and streets on the map | `shared/js/streets.js`, `map-boundary.js` |
| `notifications.html`, `profile.html` | Notifications, My Profile | `shared/js/notifications-page.js` / `admin-profile.js` |

`admin/js/layout.js` checks the user is an Administrator, wires the sidebar/popup/logout, and runs
the bell with two switchable kinds of notifications (new verification requests, new log entries).

### 10.6 How the frontend talks to the backend

* All requests go to the same address the page came from (`/api/...`), so nothing needs configuring.
* Logged-in requests use `authFetch(url, options)` from `common.js`, which sends
  `Authorization: Bearer <access token>`; on a 401 it refreshes the token once and retries.
* The server always checks permissions itself — hiding a button in the page is only for convenience.
* Uploaded photos come back as signed `/api/media/protected/...` links (decrypted by the server).

---

## 11. Main flows, step by step

**Citizen sign-up and approval**
1. `signup.html` → `handleSignupStep1` (auth-pages.js) checks the passwords and phone, calls
   `POST /api/auth/check-availability/`, and keeps the fields in sessionStorage.
2. `verify-signup.html` → `handleSignupStep2` sends everything + the voter's ID photo to
   `POST /api/auth/register/` (`RegisterSerializer` creates the `User` and a pending
   `VoterVerification`; the photo is stored encrypted). Administrators are emailed.
3. Admin › Approve Accounts → `POST /api/auth/admin/verifications/<id>/approve/` sets
   `is_verified`; the citizen is emailed and can now log in. (Reject: the reason is emailed and the
   pending account is deleted.)

**Logging in** — `handleLogin` → `POST /api/auth/login/` with `portal` = citizen/staff →
`CustomTokenObtainPairSerializer` (lockout, setup check, password, portal, approval) → tokens +
profile saved by `storeAuthSession` → `loginHome(role)` picks the landing page.

**Forgot Password** — email → `password-reset/request/` (code emailed) → code →
`password-reset/verify/` (5 wrong tries kill the code) → new password → `password-reset/confirm/`.

**Accounts created by an Administrator** — Admin › Create Accounts → `admin/create-user/` or
`admin/create-citizen-direct/` → the account is created with no password and a setup link is
emailed (`accounts/setup_links.py`) → the owner opens `account-setup.html#uid=…&token=…` →
`account-setup/check/` then `account-setup/` (details + password) → logged in.

**Filing a report**
1. `file-report.html` loads → `GET /api/reports/verification-status/`; if a code is needed the
   "Verify it's you" popup sends `reports/send-verification/` and checks `reports/verify-code/`.
2. Typing the description calls `GET /api/ordinances/suggest/?q=…` (TF-IDF, `ordinances/matching.py`).
3. Submit → `POST /api/reports/` (multipart with photos) → `ReportListCreateView.create` checks the
   cooldown and verification, `ReportSerializer` saves the report (text encrypted, photos encrypted,
   `report_number` assigned), then: audit log, email to the citizen, email to all staff, abuse check.

**Working a report (staff)**
1. Investigator › Reports › Unclaimed → Claim → `POST /api/reports/staff/<id>/claim/`.
2. Report detail → change status/remarks → `PATCH /api/reports/staff/<id>/` (only the claimer or an
   Administrator). Reaching Resolved / With Remarks emails the citizen.
3. The citizen's bell picks up the change within 30 seconds; My Reports shows the timeline.
4. An Administrator can release (`forfeit/`) or assign (`assign/`) a claim.

**Concern/suggestion** — `POST /api/concerns/` → Secretary adds remarks or a folder
(`PATCH /api/concerns/staff/<id>/`) → status becomes Reviewed automatically.

**Ordinances** — Secretary › Upload Ordinance → `POST /api/ordinances/` (PDF checked) → citizens
see it on Home ("Latest Ordinances") and Ordinances → opening it calls `…/view/` → Download calls
`…/download/` (once per citizen, logged).

**Announcements** — Secretary/Captain › Announcements → `POST /api/announcements/staff/` → every
citizen is emailed → shown on the citizen Home page with an "unread" mark until opened (`…/view/`).

## 12. Responsive design

Every page has `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
and each portal's `css/style.css` adapts the layout with `@media (max-width: …)` rules.
The main breakpoints:

| Width | What changes |
|---|---|
| ≤ 1100–1500px | Dashboard grids (staff) go from 3–4 columns to 2 |
| ≤ 980px | Staff dashboard rows stack |
| ≤ 900px | **Staff/Admin:** the sidebar becomes a slide-in drawer opened with ☰ (with a dark backdrop) — `wireSidebar()` in `staff/js/layout.js` / `admin/js/layout.js`. Citizen two-column pages become one column. |
| ≤ 860px | **Citizen:** the navbar links collapse into the ☰ menu (`wireMobileMenu()` in `citizen/js/main.js`) |
| ≤ 640px / 560px | Forms and cards use the full width; tables scroll sideways inside their card |
| ≤ 480px | Phone sizes: larger tap targets, smaller headings |

Extra behavior handled in JavaScript:
* Between 860px and desktop width, if the citizen navbar links would wrap to a second
  line, the navbar switches to the compact ☰ style (`navbar--compact`).
* Rotating a tablet / resizing the window closes the open mobile menu or drawer.
* `--navbar-height` (set by `trackNavbarHeight()`) keeps sticky side panels below the navbar.
* The heatmaps call Leaflet's `invalidateSize()` when their container changes size.

When adding a page, reuse the existing classes (`.admin-shell`, `.modal-card`, `.field`,
`.btn`, table wrappers with `overflow-x: auto`) and test at about 390px (phone),
768px (tablet), 1024px and 1440px (desktop).

---

## 13. Tests

Run all automated tests (235) with:

```bash
python manage.py test            # add --parallel 4 to make it faster
```

| File | Tests | What they check |
|---|---|---|
| `accounts/tests.py` | 80 | Failed-login lockout, code attempt limits, rate limits, account setup links, "no account probing", disabling/deleting accounts with claimed reports, password rules, admin reset links, `create_admin` command |
| `reports/tests.py` | 45 | Report verification codes and limits, claim rules for updating a report, Barangay Captain read-only, filters, report numbers, automatic status changes |
| `ordinances/tests.py` | 52 | Archive visibility, ordinance suggestions (TF-IDF), author and category rules, upload validation |
| `siteinfo/tests.py` | 19 | About Us content, permissions, image upload limits, reordering, map boundary |
| `announcements/tests.py` | 6 | Posting (emails), editing, image replace/remove |
| `orms_backend/tests.py` | 18 | **Modified Blowfish** encryption of fields and files, protected links, migrations of old data |
| `orms_backend/tests_injection.py` | 5 | **SQL injection** strings in login, query parameters, URLs and saved text |
| `orms_backend/tests_resistance.py` | 10 | **Resistance**: malformed JSON, missing fields, fake tokens, unauthorized access, oversized input, bad IDs |

The study's own algorithm tests are in `research/modified_blowfish/`:

```bash
python research/modified_blowfish/test_modified_blowfish.py            # the algorithm on its own
python research/modified_blowfish/verify_system_matches_demo.py        # the system uses the same algorithm
```

`verify_system_matches_demo.py` encrypts with one copy and decrypts with the other (both
ways) and checks that both derive the same key — proof that the website's
`orms_backend/modified_blowfish.py` behaves exactly like the study's original file.

## 14. What changed in this refactor

The original code is kept unchanged on the `final` branch; this cleaned-up version is on
`refactor/clean-architecture`. **No feature, rule, message or API response was changed.**

### 14.1 Database (normalization)

* New migration `siteinfo/migrations/0015_normalize_json_lists.py` moves three JSON-list columns into their
  own tables (copying existing data, and back again if reversed):
  `BarangayProfile.boundary` → `BoundaryPoint`, `BarangayProfile.footer_quick_links` /
  `footer_legal_links` → `FooterLink`, `LegalDocument.sections` → `LegalSection`.
  The API still sends and receives the same JSON.
* Every other table was already in 3NF and was left as it is (see [section 8.3](#83-how-the-design-meets-1nf-2nf-and-3nf)).

### 14.2 Backend

* `accounts/permissions.py` (new): the permission classes, moved out of `accounts/views.py`.
* `User.display_name` and `User.account_type` replace 31 copies of
  `get_full_name() or username` and three copies of the account-type label logic.
* Shared checks instead of copies: `check_email_available()` / `check_phone_available()`
  (accounts), `AttachmentsMixin` / `AnsweredByMixin` (reports), `_SetArchivedView` and
  `_ManagedListView` (ordinances), `orms_backend/validators.py` (image uploads, was copied in two apps),
  `PublicView` base class for the public account endpoints.
* `orms_backend/emails.py`: one small `_send()` helper; each email function is now 2–3 lines.
* `reports/pdf.py`: removed the per-report PDF builders that no endpoint used any more — which
  also removed the `pymupdf` and `opencv` packages from `requirements.txt` and `build.sh`.
* Removed redundant `get_serializer_context` overrides, an empty `announcements/admin.py`, and
  stray in-function imports. Comments rewritten to be short and direct.
* **Unchanged:** `orms_backend/modified_blowfish.py` (the algorithm), the encryption wrappers'
  logic, every model field, URL, status code and message.

### 14.3 Frontend

* New `frontend/shared/` folder: fonts, images and vendor libraries were stored three times
  (once per portal) — now once. Unused images (`background.jpg`, two other photos) removed.
* `shared/js/common.js` replaces the helpers that were copied into four "core" files
  (`citizen/js/main.js`, `staff/js/main.js`, `staff/js/admin.js`, `admin/js/admin.js`) and
  `admin/js/create-accounts.js`.
* `shared/js/auth-pages.js` replaces the login / sign-up / password / account-setup code that was
  copied in the citizen and staff `main.js`. The staff `main.js` (which also carried unused citizen
  sign-up and notification code) is gone.
* `staff/js/admin.js` → `staff/js/layout.js`, `admin/js/admin.js` → `admin/js/layout.js`
  (the old name was confusing: "admin.js" ran every staff page).
* `staff/js/staff-nav.js`: the sidebar permission list and the two "before first paint"
  scripts that were pasted inline into 16 staff pages are now one file (one-line calls in the pages).
  `staff-profile.js` now uses the same list instead of its own copy.
* One copy each of: pagination (was 3), the street list (was 3, incl. `street-coordinates.js`),
  the notifications page (was 3), the evidence viewer (was 4), the street picker (was 4).
* Removed dead code: unused functions, the never-used per-portal enforce/redirect branches,
  unreachable popups on the staff login pages, and about 1,900 lines of CSS (rules whose classes
  no page uses, and their leftover comments).
* Comments shortened throughout (they described past changes rather than the code).

### 14.4 Repository

* `modif blowfish/` → `research/modified_blowfish/`, `samples/` → `research/sample_ordinances/`.
* Removed unused copies at the root (`drawables/`, `logo/`, two root images), `README(old).md`,
  a superseded `scripts/geocode-streets.js`, and a one-time `summary_patch.py` left in `frontend/citizen/`.

### 14.5 How the refactor was verified

* **All 235 automated tests pass** (unit, integration, SQL-injection, resistance, encryption).
* `research/modified_blowfish/verify_system_matches_demo.py` confirms the system's Modified
  Blowfish still matches the study's original file.
* **API comparison:** 272 requests (every GET endpoint as guest, citizen, captain, secretary,
  investigator and admin, plus 44 write and error cases) gave identical answers on the old and new code.
* **Screenshot comparison:** every page of all three portals, for every role, at 1440 / 1024 /
  768 / 390 px wide (541 screenshots) looked the same before and after (only clock-dependent text
  like "13 minutes ago" differs), with no new browser errors, no missing files and no sideways scrolling.
* **Interaction comparison:** 45 user actions (menus, drawers, popups, form errors, login
  messages, sign-up checks, Forgot Password, claiming, posting, unsaved-changes prompts, password
  checklists) behaved identically on the old and new code.

### 14.6 Noticed, but intentionally not changed

* Admin "New action logs" notifications read a field (`loggedOnLabel`) that the audit-log API
  does not send, so they show "logged in at undefined". Left as-is because behavior had to stay
  identical; the fix would be to use `timeLabel` in `checkForNewAuditLogs` (`admin/js/layout.js`).
