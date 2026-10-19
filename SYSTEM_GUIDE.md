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
15. [Function reference (every file and function)](#15-function-reference-every-file-and-function)

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
| Secretary | staff | Concerns/Suggestions (remarks, folders), ordinances (upload, edit), announcements, questions, invite citizens |
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
| Other | ReportLab (dashboard PDF), WhiteNoise (serves the frontend). Ordinance suggestions use plain Python (no extra package) |
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
| `models.py` | Tables `User`, `VoterVerification`, `PasswordResetCode`, `SignupEmailCode`, `ProfileEditVerificationCode`, `LoginSession`, `AuditLog`; helper `log_action(user, action)` writes an audit log entry. `User.display_name` (full name or username) and `User.account_type` ("Administrator" / "Barangay Citizen" / position) are used everywhere. |
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
| `matching.py` | `suggest_ordinances()`: TF-IDF + cosine similarity between the citizen's description and each ordinance (used by File a Report). Written in plain Python with the same results as scikit-learn's `TfidfVectorizer`, to save server memory |
| `stop_words.py` | `ENGLISH_STOP_WORDS`: common words ("the", "and", …) that `matching.py` ignores — the same list scikit-learn uses |

Citizens and guests only see **published** (not archived) ordinances. Archiving is done through
the API (`<id>/archive/`, `<id>/unarchive/`, covered by the tests); no page has an Archive button.

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
| POST | `signup/request-code/` | Anyone | Sign Up: email a 6-digit code to the typed address | `SignupCodeRequestView` |
| POST | `signup/verify-code/` | Anyone | Sign Up: check the code, returns `email_verification_token` for `register/` | `SignupCodeVerifyView` |
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
`siteinfo/migrations/0016_normalize_json_lists.py`, which also copies the existing data).*

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
| `js/auth-pages.js` | Login, Sign Up (3 steps), Forgot Password (3 steps), account setup link, admin-sent reset link — for the citizen and staff portals | `apiLogin`, `apiRegister`, `apiCheckAvailability`, `apiRequestSignupCode`, `apiVerifySignupCode`, `apiRequestPasswordReset`, `apiVerifyPasswordResetCode`, `apiConfirmPasswordReset`, `apiCheckSetupLink`, `apiCompleteAccountSetup`, `handleLogin`, `handleSignupStep1/2`, `handleSignupVerifyEmail`, `handleForgotRequest/Verify/Confirm`, `wireAccountSetup`, `wireResetLinkForm`, `loginHome` (where each role lands) |
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
| `login.html`, `signup.html`, `verify-email.html`, `verify-signup.html`, `signup-success.html` | Log in / sign up (3 steps) | `shared/js/auth-pages.js` |
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
  (concerns + folders), `ordinances-data.js` (ordinances, upload/edit, authors and
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
| `about-setup.html` | About Us: barangay details, council members, logos | `about-setup-data.js`, `image-picker.js`, `about-setup.js` |
| `website-setup.html` | Brand name/logo, footer, legal pages | `about-setup-data.js`, `image-picker.js`, `website-setup.js` |
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
   `POST /api/auth/check-availability/`, emails a 6-digit code with
   `POST /api/auth/signup/request-code/`, and keeps the fields in sessionStorage.
2. `verify-email.html` → `handleSignupVerifyEmail` sends the code to
   `POST /api/auth/signup/verify-code/`, which returns an `email_verification_token`
   (`SignupEmailCode`; valid 60 minutes, one use). This proves the email is real before any
   voter's ID is uploaded. Going back to step 1 keeps the token unless the email changes.
3. `verify-signup.html` → `handleSignupStep2` sends everything + the token + the voter's ID photo to
   `POST /api/auth/register/` (`RegisterSerializer` refuses a missing/expired token, then creates the
   `User` and a pending `VoterVerification`; the photo is stored encrypted). Administrators are
   emailed. An expired token sends the person back to `verify-email.html?expired=1`, which emails a new code.
4. Admin › Approve Accounts → `POST /api/auth/admin/verifications/<id>/approve/` sets
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

* New migration `siteinfo/migrations/0016_normalize_json_lists.py` moves three JSON-list columns into their
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
* **Team changes merged from `final` (2026-10-19):** `ordinances/matching.py` computes TF-IDF in
  plain Python (with `stop_words.py`) instead of scikit-learn, which was removed from
  `requirements.txt`; migration `siteinfo/0015_remove_streets_outside_boundary` deletes the 52
  streets outside the barangay outline (the 3NF migration became `0016` and runs after it).
  `ordinances/extraction.py` (an OCR prefill that nothing calls) came back in that merge by
  accident and was left out again.

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

### 14.6 Fixed after the review (2026-10-19)

* **Admin "New action logs" notification:** it read a field (`loggedOnLabel`) that the audit-log
  API does not send, so it showed "… logged in at undefined" for every kind of action.
  `checkForNewAuditLogs()` (`admin/js/layout.js`) now shows the real entry:
  "Owner (Account type): Action — time".
* **Duplicated code:** the picture checks and preview used by About Us Setup and Website Setup
  (`checkPickedImage()`, `wireImagePicker()` and the upload limits) were copied in both page
  scripts; they are now one file, `admin/js/image-picker.js`, loaded by both pages.
* **Unused code:** `archiveOrdinanceById()`, `unarchiveOrdinanceById()` and `readFirstError()` in
  `staff/js/ordinances-data.js` were never called by any page (no page has an Archive button), so
  they were removed. The archive API endpoints themselves are unchanged.

---

## 15. Function reference (every file and function)

Every function, class and method in the source code, file by file, in the order the files appear in [section 4](#4-folder-map). Use it together with sections 6 and 10, which explain what each file is for.

### 15.1 How to read these tables

* **Line**: where the function starts in that file (open the file and go to that line).
* **Name**: `name()` is a function, `Class` a class, and `Class.method()` a method of that class.
  For JavaScript, *(inside X)* means the function is defined inside function `X` (or inside the page's `DOMContentLoaded` handler, the code that runs once the page has loaded) and is only used there.
* **Used by**: the other files that call or import it: Python files, JavaScript files (`portal/file.js`) or HTML pages (`portal/page.html`). "this file" means it is only used inside its own file. Methods have no entry here because Django or the class itself calls them, for example `get()`/`post()` (the HTTP method), `validate_<field>()` (checking one field), `perform_create()` (saving a new row) and `get_queryset()` (choosing which rows a view may return).
* View classes are "used by" their app's `urls.py`, which connects each URL to its view. Section 7 lists every URL.

### 15.2 Backend (Python)

#### `orms_backend/codes.py`

The 6-digit emailed codes (Forgot Password, File Report verification, Profile edit).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 23 | `generate_code()` | Makes a random 6-digit code (000000-999999) with Python's `secrets` module, so it can't be guessed or predicted. | accounts/serializers.py, accounts/views.py, reports/views.py |
| 28 | `check_code()` | Compares `submitted` with the code and counts a wrong guess. Returns CODE_OK, CODE_WRONG or CODE_EXHAUSTED (no attempts left). The row is locked while checking, so guesses sent at the same time are still counted one by one. | accounts/serializers.py, accounts/views.py, reports/serializers.py |

#### `orms_backend/emails.py`

Every email the system sends. Each one is an HTML template under <app>/templates/emails/ (all extend accounts/templates/emails/_base.html).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 31 | `send_templated_email()` | Renders emails/<template_name>.html and sends it (HTML + plain-text copy). | this file |
| 44 | `_send()` | Adds the "Barangay Platero OVRMS — " prefix to the subject and calls send_templated_email(). Every send_*_email function below uses it. | this file, reports/tests.py |
| 48 | `_send_to_each()` | Sends the same email to every user in a list (one email per person, so addresses aren't shown to each other). | this file |
| 55 | `send_password_reset_email()` | Emails the 6-digit Forgot Password code (template password_reset_code). | accounts/serializers.py |
| 60 | `send_report_verification_code_email()` | Emails the 6-digit code a citizen needs before filing a report (template report_verification_code). | reports/views.py |
| 65 | `send_profile_edit_code_email()` | Emails the code that confirms changes on My Profile, to the address already on file (template profile_edit_code). | accounts/views.py |
| 71 | `send_account_setup_link_email()` | Emails the link for finishing an account that an Administrator created (template account_setup_link). | accounts/setup_links.py |
| 76 | `send_password_reset_link_email()` | Emails a set-new-password link that an Administrator sent from Manage Accounts (template password_reset_link). | accounts/setup_links.py |
| 83 | `send_account_approved_email()` | Tells a citizen their sign-up was approved (template account_approved). | accounts/views.py |
| 87 | `send_account_rejected_email()` | Tells a citizen their sign-up was rejected and why. Takes name/email instead of the user because the account is deleted right after (template account_rejected). | accounts/views.py |
| 92 | `send_account_deactivated_email()` | Tells a user their account was disabled by an Administrator (template account_deactivated). | accounts/views.py |
| 96 | `send_account_suspicious_activity_email()` | Tells a citizen their account was disabled automatically for suspicious report activity (template account_suspicious_activity). | reports/verification.py |
| 101 | `send_account_deleted_email()` | Tells a user an Administrator deleted their account (template account_deleted). | accounts/views.py |
| 105 | `send_account_self_deleted_email()` | Confirms to a citizen that they deleted their own account (template account_self_deleted). | accounts/views.py |
| 109 | `send_account_locked_email()` | Tells a user their account is locked for some minutes after too many wrong passwords. Sent once per lock (template account_locked). | accounts/lockout.py |
| 117 | `send_report_submitted_citizen_email()` | Confirms to the citizen that their report was received (template report_submitted_citizen). | reports/views.py |
| 121 | `send_suggestion_submitted_citizen_email()` | Confirms to the citizen that their concern/suggestion was received (template suggestion_submitted_citizen). | reports/views.py |
| 125 | `send_report_resolved_email()` | Tells the citizen their report reached a final status (Resolved / With Remarks) (template report_resolved). | reports/views.py |
| 130 | `send_report_reassigned_email()` | Tells the citizen a different Investigator now handles their report (template report_reassigned). | reports/views.py |
| 134 | `send_question_answered_email()` | Tells the citizen their question was answered (template question_answered). | reports/views.py |
| 138 | `send_report_submitted_staff_emails()` | Tells the given staff members a new report needs review (template report_submitted_staff). | reports/views.py |
| 142 | `send_suggestion_submitted_staff_emails()` | Tells the given staff members a new concern/suggestion needs review (template suggestion_submitted_staff). | reports/views.py |
| 148 | `send_announcement_posted_email()` | Sends a new announcement, with a link to the citizen home page, to every given citizen (template announcement_posted). | announcements/views.py |
| 154 | `send_account_created_admin_emails()` | Tells every Administrator that a new citizen signed up and is waiting for approval (template account_created_admin). | accounts/views.py |

#### `orms_backend/encrypted_fields.py`

EncryptedTextField — a model field that stores text encrypted with the study's Modified Blowfish algorithm (orms_backend/modified_blowfish.py).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 30 | `_master_key()` | Reads DATA_ENCRYPTION_KEY from settings, base64-decodes it and checks it is at least 32 bytes. Raises a clear error if it is missing or wrong. | this file, orms_backend/encrypted_storage.py |
| 46 | `encrypt_value()` | Plain text -> the JSON string stored in the database. | this file, orms_backend/tests.py |
| 54 | `is_encrypted()` | True if a stored database value is in the encrypted JSON format (starts with {"salt"). | this file |
| 58 | `decrypt_value()` | The database's JSON string -> plain text. A value that isn't encrypted yet (written before the column was encrypted) is returned as it is. | this file, orms_backend/tests.py, research/modified_blowfish/verify_system_matches_demo.py |
| 79 | **`EncryptedTextField`** (class) | Text that is encrypted at rest. Always a `text` column (the stored form is longer than the value); `max_length` still limits the text itself. | this file, accounts/models.py, reports/models.py |
| 87 | `EncryptedTextField.from_db_value()` | Django calls this when a row is loaded: decrypts the stored value into plain text. |  |
| 92 | `EncryptedTextField.get_db_prep_save()` | Django calls this when a row is saved: encrypts the text (blank values stay blank). |  |
| 99 | `EncryptedTextField._refuse_lookup()` | Raises an error explaining that an encrypted column can't be searched or filtered by the database. |  |
| 105 | `EncryptedTextField.get_prep_value()` | Used for database filters: only a blank value is allowed (e.g. filter(address="")); anything else is refused. |  |
| 111 | `EncryptedTextField.get_lookup()` | Allows only exact / in / isnull lookups; refuses icontains, startswith and the like. |  |
| 121 | `encrypt_existing_rows()` | Re-saves `field_names` of every row through the field, which encrypts them. Safe to run more than once. Uses update() so auto_now timestamps don't change. | this file, accounts/migrations/0015_encrypt_existing_personal_data.py, accounts/migrations/0017_encrypt_existing_audit_names.py, reports/migrations/0016_encrypt_existing_personal_data.py, reports/migrations/0018_encrypt_existing_locations_and_questions.py |
| 131 | `decrypt_existing_rows()` | Reverse of encrypt_existing_rows: writes the plain text back, bypassing the field. | accounts/migrations/0015_encrypt_existing_personal_data.py, accounts/migrations/0017_encrypt_existing_audit_names.py, reports/migrations/0016_encrypt_existing_personal_data.py, reports/migrations/0018_encrypt_existing_locations_and_questions.py |

#### `orms_backend/encrypted_storage.py`

EncryptedStorage — keeps uploaded personal images (voter's ID photos, report and concern evidence photos) encrypted with the Modified Blowfish algorithm.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 52 | `encrypt_bytes()` | File bytes -> the encrypted blob described at the top of this module. | this file, orms_backend/tests.py |
| 60 | `decrypt_bytes()` | The encrypted blob -> (content type, file bytes). | this file, orms_backend/tests.py |
| 76 | `is_encrypted_name()` | True for a file this storage encrypted (they all live under an `enc/` folder). | this file, accounts/management/commands/encrypt_existing_files.py, orms_backend/tests.py |
| 81 | `_is_video()` | True if the file name looks like a video (videos are stored without encryption). | this file, accounts/management/commands/encrypt_existing_files.py |
| 85 | `_signer()` | The Django Signer used to sign and check protected file links. | this file |
| 89 | `protected_url()` | Makes a signed, expiring link (/api/media/protected/<token>/) for one encrypted file. The token stays the same for a 6-hour window so browsers can cache the image. | this file |
| 97 | **`EncryptedStorage`** (class) | Wraps the project's normal storage; see the module docstring. | this file, orms_backend/tests.py |
| 101 | `EncryptedStorage._plain()` | The project's normal storage (local media/ folder or Cloudinary) — used for videos and older unencrypted files. |  |
| 106 | `EncryptedStorage._blobs()` | Where encrypted files are kept: Cloudinary "raw" storage in production, the local file system in development. |  |
| 114 | `EncryptedStorage._backend()` | Picks _blobs for encrypted files and _plain for everything else. |  |
| 117 | `EncryptedStorage.get_available_name()` | Returns the name unchanged; the real storage picks a unique name when saving. |  |
| 121 | `EncryptedStorage._save()` | Saves an upload: videos go to normal storage; anything else is encrypted with encrypt_bytes() and saved as enc/<folder>/<random>.enc. |  |
| 132 | `EncryptedStorage.read()` | (content type, decrypted bytes) of an encrypted file. |  |
| 137 | `EncryptedStorage._open()` | Opens a file; encrypted files are decrypted first and returned as an in-memory file. |  |
| 144 | `EncryptedStorage.url()` | The address of a file: the normal URL for unencrypted files, a protected_url() for encrypted ones. |  |
| 149 | `EncryptedStorage.delete()` | Deletes the file from whichever storage holds it. |  |
| 152 | `EncryptedStorage.exists()` | Checks whether the file exists in whichever storage holds it. |  |
| 155 | `EncryptedStorage.size()` | Returns the stored file's size. |  |
| 159 | `encrypted_storage()` | `storage=` for model fields (a callable, so migrations reference this, not an instance). | accounts/management/commands/encrypt_existing_files.py, accounts/migrations/0016_encrypt_more_personal_data.py, accounts/models.py, orms_backend/tests.py, orms_backend/urls.py, +2 more |
| 164 | **`ProtectedMediaView`** (class) | GET /api/media/protected/<token>/ — decrypts one encrypted upload. No login check: an <img> tag can't send the Authorization header, so the signed, expiring link is the permission. Links are only created by url() inside API responses to people already allowed to see the file. | this file, orms_backend/urls.py |
| 173 | `ProtectedMediaView.get()` | Checks the token's signature and expiry, decrypts the file and sends it. Images are shown inline; other types are sent as a download. Bad or expired tokens get 404. |  |

#### `orms_backend/modified_blowfish.py`

Modified Blowfish Data Protection Algorithm -------------------------------------------- Implements the two-component modification described in the capstone study:

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 44 | **`EncryptedRecord`** (class) | Everything that gets stored in the database for one encrypted field. | this file, orms_backend/encrypted_storage.py |
| 50 | `EncryptedRecord.to_dict()` | Serialize to base64 strings, suitable for DB storage / JSON. |  |
| 59 | `EncryptedRecord.from_dict()` | Turns the stored base64 strings (salt, iv, ciphertext) back into an EncryptedRecord of bytes. |  |
| 75 | `derive_key()` | Derive a per-record subkey from the master secret and a per-record salt using PBKDF2-HMAC-SHA256 (Moriarty et al., 2017). | this file, research/modified_blowfish/verify_system_matches_demo.py |
| 95 | `encrypt_record()` | Encrypt a single record/field using the modified Blowfish scheme. Steps: 1. Generate random salt -> derive per-record key via PBKDF2 2. Generate random IV 3. PKCS7-pad plaintext to Blowfish's 8-byte block size 4. Encrypt with Blowfish-CBC using the derived key and IV | this file, orms_backend/encrypted_storage.py, research/modified_blowfish/test_modified_blowfish.py |
| 121 | `decrypt_record()` | Decrypt a record encrypted with encrypt_record(). Steps: 1. Recompute the per-record key from the stored salt + master key 2. Decrypt with Blowfish-CBC using the stored IV 3. Remove PKCS7 padding | this file, orms_backend/encrypted_storage.py, research/modified_blowfish/test_modified_blowfish.py |
| 146 | `encrypt_text()` | Encrypt a UTF-8 string and return a JSON/DB-storable dict. | this file, orms_backend/encrypted_fields.py, research/modified_blowfish/test_modified_blowfish.py, research/modified_blowfish/verify_system_matches_demo.py |
| 153 | `decrypt_text()` | Decrypt a dict produced by encrypt_text() back to the original string. | orms_backend/encrypted_fields.py, orms_backend/tests.py, research/modified_blowfish/test_modified_blowfish.py, research/modified_blowfish/verify_system_matches_demo.py |

#### `orms_backend/validators.py`

Upload checks shared by more than one app.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 10 | `validate_image_upload()` | A JPG, PNG or WebP image of at most 5 MB. | announcements/serializers.py |

#### `accounts/admin.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 7 | **`CustomUserAdmin`** (class) | Django admin (/django-admin/) page for users: shows role and verified status, searches by email/username (names are encrypted, so not searchable). | this file |

#### `accounts/apps.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 4 | **`AccountsConfig`** (class) | Django app configuration; Django loads it automatically from INSTALLED_APPS. | — |

#### `accounts/lockout.py`

Failed-login lockout (brute-force protection).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 27 | `lockout_minutes_remaining()` | Minutes left on the lock (rounded up), or 0 if the account isn't locked. | accounts/serializers.py |
| 35 | `record_failed_login()` | Counts one wrong password and returns True if this attempt locked the account. The row is locked while counting so many guesses sent at once are all counted. | accounts/serializers.py |
| 62 | `clear_failed_logins()` | Resets the counter and lock after a successful login or password reset. | accounts/serializers.py, accounts/views.py |

#### `accounts/middleware.py`

Remembers the current request so log_action() (accounts/models.py) can record the caller's IP address without every view having to pass the request along.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 11 | **`CurrentRequestMiddleware`** (class) | Middleware (listed in settings.MIDDLEWARE) that remembers the request being handled, so log_action() can record the caller's IP address. | orms_backend/settings.py |
| 12 | `CurrentRequestMiddleware.__init__()` | Stores the next handler in Django's middleware chain. |  |
| 15 | `CurrentRequestMiddleware.__call__()` | Saves the request in a thread-local variable, lets Django handle it, then clears it. |  |
| 23 | `get_current_request()` | Returns the request currently being handled (or None outside a request). | this file |
| 27 | `client_ip()` | The visitor's IP address. Behind a proxy (like Render) the real address is the first one in X-Forwarded-For; otherwise it's REMOTE_ADDR. | accounts/models.py |

#### `accounts/models.py`

Accounts — database tables for user accounts and signing in.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 24 | **`User`** (class) | One table for all three portals. `role` decides what the account may do; `position` is the staff member's job title (Barangay Captain, Secretary, Investigator, Administrator). People log in with their email. | this file, accounts/admin.py, accounts/lockout.py, accounts/management/commands/create_admin.py, accounts/permissions.py, accounts/serializers.py, +15 more |
| 63 | `User.get_full_name()` | e.g. "Juan D. Dela Cruz" (the middle initial is added when there is one). |  |
| 69 | `User.display_name()` | The full name, or the username when no name is on file yet. |  |
| 74 | `User.account_type()` | The label shown on admin pages: Administrator, Barangay Citizen, or the staff position. |  |
| 82 | `User.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 86 | **`VoterVerification`** (class) | A citizen's voter's ID photo, reviewed by an Administrator on Approve Accounts. | this file, accounts/admin.py, accounts/management/commands/encrypt_existing_files.py, accounts/serializers.py, accounts/views.py, orms_backend/tests.py |
| 106 | `VoterVerification.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 110 | **`PasswordResetCode`** (class) | Forgot Password: email -> enter the 6-digit code -> choose a new password. `verified_at` is set when the code is entered correctly; `used_at` when the new password is saved (or when a newer code replaces this one). | this file, accounts/serializers.py, accounts/tests.py |
| 131 | `PasswordResetCode.is_valid()` | True if the code hasn't been used and hasn't expired. |  |
| 134 | `PasswordResetCode.expire()` | Marks the code as used (sets used_at) so it can't be used again. |  |
| 138 | `PasswordResetCode.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 142 | **`ProfileEditVerificationCode`** (class) | 6-digit code sent to the email already on file before the account's email, mobile number or address can be changed (see MeView.patch). | this file, accounts/views.py |
| 161 | `ProfileEditVerificationCode.is_valid()` | True if the code hasn't been used and hasn't expired. |  |
| 164 | `ProfileEditVerificationCode.expire()` | Marks the code as used (sets used_at) so it can't be used again. |  |
| 168 | `ProfileEditVerificationCode.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 172 | **`LoginSession`** (class) | One row per login. `logged_out_at` stays empty if the user never pressed Log Out. | this file, accounts/admin.py, accounts/serializers.py, accounts/views.py |
| 183 | `LoginSession.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 187 | **`AuditLog`** (class) | One row per action, shown on Admin > View Audit Logs. owner_name/owner_type are a copy of the account's name and type *at the time of the action*, so the entry still says who did it after the account is renamed or deleted (`user` becomes empty when the account is deleted). | this file, accounts/serializers.py, accounts/tests.py, accounts/views.py, ordinances/tests.py, orms_backend/tests.py, +1 more |
| 207 | `AuditLog.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 211 | `log_action()` | Writes one audit log entry. Called right after an action succeeds. Never raises: a logging problem must not break the request itself. | accounts/lockout.py, accounts/middleware.py, accounts/serializers.py, accounts/views.py, announcements/views.py, +5 more |

#### `accounts/password_validators.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 6 | **`CharacterClassValidator`** (class) | A password needs at least one lowercase letter, one uppercase letter and one special character. Listed in AUTH_PASSWORD_VALIDATORS (settings.py), so it applies everywhere a password is set. The frontend shows the same rules (getPasswordRuleStatus in frontend/shared/js/common.js). | orms_backend/settings.py |
| 20 | `CharacterClassValidator.validate()` | Raises a validation error listing every missing rule (lowercase, uppercase, special character). |  |
| 25 | `CharacterClassValidator.get_help_text()` | The rule description Django shows in password help text. |  |

#### `accounts/permissions.py`

Who may call which API endpoint. Each class answers one question: "is the logged-in user allowed in?" Administrators pass every check.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 18 | `_is_admin_or_staff_with_position()` | Shared check: the user is logged in AND is an Administrator, or a staff member whose position is in the given list. | this file |
| 24 | **`IsAdmin`** (class) | Permission: Administrators only. | this file, accounts/views.py, ordinances/views.py, reports/views.py, siteinfo/views.py |
| 25 | `IsAdmin.has_permission()` | Allows the request only if the logged-in user's role is admin. |  |
| 30 | **`IsStaffOrAdmin`** (class) | Permission: any Barangay Official (staff) or an Administrator. | this file, announcements/views.py, reports/views.py |
| 31 | `IsStaffOrAdmin.has_permission()` | Allows the request if the user's role is staff or admin. |  |
| 36 | **`IsInvestigatorOrAdmin`** (class) | Permission: Investigators (who work on reports) or Administrators. | this file, reports/views.py |
| 37 | `IsInvestigatorOrAdmin.has_permission()` | Allows Administrators, and staff whose position is Investigator. |  |
| 41 | **`IsSecretaryOrAdmin`** (class) | Permission: the Secretary (concerns/suggestions, inviting citizens) or Administrators. | this file, accounts/views.py, reports/views.py |
| 42 | `IsSecretaryOrAdmin.has_permission()` | Allows Administrators, and staff whose position is Secretary. |  |
| 46 | **`IsDocumentManager`** (class) | Ordinances are the Secretary's section (same rule as IsSecretaryOrAdmin). | this file, ordinances/views.py |
| 50 | **`IsAnnouncementManager`** (class) | Permission: who may post announcements — Secretary, Barangay Captain or Administrator. | this file, announcements/views.py |
| 51 | `IsAnnouncementManager.has_permission()` | Allows Administrators, and staff whose position is Secretary or Barangay Captain. |  |

#### `accounts/serializers.py`

Accounts — serializers (they check incoming data and shape outgoing JSON).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 44 | `clean_ph_mobile()` | A Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX (spaces/dashes ignored). | this file |
| 52 | `phone_already_used()` | contact_number is encrypted with a different random salt every time, so the database can't compare it — each stored number is decrypted and compared here. | this file |
| 63 | `check_email_available()` | Emails are compared ignoring case, because login ignores case too. | this file |
| 73 | `check_phone_available()` | Cleans the mobile number with clean_ph_mobile(), then raises "An account with this phone number already exists." if another account uses it. | this file |
| 84 | **`AccountAvailabilityCheckSerializer`** (class) | Sign Up step 1 checks the email and phone early, before the ID photo step. | accounts/views.py |
| 90 | `AccountAvailabilityCheckSerializer.validate_email()` | If an email was sent, checks it isn't already registered. |  |
| 93 | `AccountAvailabilityCheckSerializer.validate_contact_number()` | If a number was sent, checks it is a valid PH mobile number not already registered. |  |
| 97 | **`RegisterSerializer`** (class) | Public sign up. Always creates a citizen account plus a pending VoterVerification; the citizen can't log in until an Administrator approves it. | accounts/views.py |
| 114 | `RegisterSerializer.validate_email()` | The email must not already be registered. |  |
| 117 | `RegisterSerializer.validate_contact_number()` | Valid PH mobile number, not already registered. |  |
| 120 | `RegisterSerializer.create()` | Creates the citizen account (username = email, role = citizen, password hashed) and a pending VoterVerification holding the uploaded ID photo. |  |
| 144 | `validate_staff_role_uniqueness()` | Raises if `staff_role` is a one-person role that someone else already holds. | this file, accounts/views.py |
| 155 | `_new_account_without_password()` | Accounts made by someone else start with no password (see accounts/setup_links.py). | this file |
| 163 | **`AdminCreateUserSerializer`** (class) | Administrator creates a staff/administrator account from just an email and a role. | accounts/views.py |
| 173 | `AdminCreateUserSerializer.validate_email()` | The email must not already be registered. |  |
| 176 | `AdminCreateUserSerializer.validate_staff_role()` | Refuses a second active Barangay Captain or Secretary (validate_staff_role_uniqueness). |  |
| 180 | `AdminCreateUserSerializer.create()` | Creates the account with no password yet, role from STAFF_ROLE_TO_ROLE_FIELD, position = the chosen staff role, already verified. |  |
| 187 | **`CitizenInviteSerializer`** (class) | Administrator/Secretary creates a citizen account from just an email. | accounts/views.py |
| 192 | `CitizenInviteSerializer.validate_email()` | The email must not already be registered. |  |
| 195 | `CitizenInviteSerializer.create()` | Creates a verified citizen account with only the email and no password (the citizen finishes it from the setup link). |  |
| 199 | **`StaffCreateCitizenSerializer`** (class) | Administrator creates a citizen account with all the details filled in. | accounts/views.py |
| 213 | `StaffCreateCitizenSerializer.validate_email()` | The email must not already be registered. |  |
| 216 | `StaffCreateCitizenSerializer.validate_contact_number()` | Valid PH mobile number, not already registered. |  |
| 219 | `StaffCreateCitizenSerializer.create()` | Creates a verified citizen account with all details filled in but no password yet. |  |
| 227 | **`AccountSetupPasswordMixin`** (class) | The password part of account setup. Checked in validate() (not on the field) so "too similar to your name" can use the name typed in the same form. | this file |
| 235 | `AccountSetupPasswordMixin.validate()` | Checks the new password with Django's password rules, using the name typed in the same form (for the "too similar to your name" rule). |  |
| 249 | `AccountSetupPasswordMixin.update()` | Saves the typed details onto the account and sets the password (which also makes the setup link stop working). |  |
| 257 | `AccountSetupPasswordMixin.validate_contact_number()` | Valid PH mobile number not used by another account. |  |
| 261 | **`CitizenSetupSerializer`** (class) | A citizen finishing setup: the same details as sign up, minus the voter's ID. | accounts/views.py |
| 275 | **`StaffAccountSetupSerializer`** (class) | A staff member finishing setup: name, phone and password (role/email are already set). | accounts/views.py |
| 292 | **`UserSerializer`** (class) | The logged-in user's own profile (GET /api/auth/me/, and part of the login response). | this file, accounts/views.py |
| 306 | `UserSerializer.get_name()` | The display name (full name, or username if there is none). |  |
| 309 | `UserSerializer.get_profile_picture()` | Full URL of the profile picture, or null. |  |
| 317 | **`ProfileUpdateSerializer`** (class) | My Profile > Edit Information. role/position/is_verified are not editable here, so nobody can raise their own access level. | accounts/views.py |
| 327 | `ProfileUpdateSerializer.validate_email()` | A new email must not belong to another account. |  |
| 330 | `ProfileUpdateSerializer.validate_contact_number()` | Must be a valid PH mobile number. |  |
| 334 | **`ChangePasswordSerializer`** (class) | My Profile > Change Password. The current password is required. | accounts/views.py |
| 340 | `ChangePasswordSerializer.validate_current_password()` | Refuses the request if the current password is wrong. |  |
| 345 | `ChangePasswordSerializer.validate_new_password()` | Checks the new password against all password rules (length, common, similar to name, character classes). |  |
| 350 | `ChangePasswordSerializer.save()` | Sets the new password on the logged-in user. |  |
| 357 | **`LinkPasswordSerializer`** (class) | The new password chosen from an Administrator-sent reset link. | accounts/views.py |
| 362 | `LinkPasswordSerializer.validate_password()` | Checks password rules and refuses a password equal to the current one. |  |
| 370 | **`DeleteAccountSerializer`** (class) | Citizen deleting their own account. The current password is required. | accounts/views.py |
| 375 | `DeleteAccountSerializer.validate_password()` | Refuses the request if the password is wrong. |  |
| 385 | `_locked_message()` | Builds the "Too many failed login attempts… locked for N more minutes" message. | this file |
| 398 | **`CustomTokenObtainPairSerializer`** (class) | POST /api/auth/login/. Returns JWT tokens plus the user's profile. Checks, in order: 1. the account is not locked (failed-login lockout) 2. the account has been set up (has a password) 3. the password is correct (a wrong one counts toward the lockout) 4. the account belongs to the portal being logged into 5. | accounts/lockout.py, accounts/views.py |
| 430 | `CustomTokenObtainPairSerializer.get_token()` | Adds the user's role and display name inside the JWT token. |  |
| 436 | `CustomTokenObtainPairSerializer.validate()` | The login check, in order: locked? not set up yet? correct password (a wrong one is counted by record_failed_login and may lock the account)? right portal? citizen approved? On success: clears failed logins, saves a LoginSession, writes an audit log entry and returns tokens + profile. |  |
| 477 | **`PasswordResetRequestSerializer`** (class) | Forgot Password step 1: email a new 6-digit code (if the account exists). | accounts/views.py |
| 482 | `PasswordResetRequestSerializer.validate_email()` | Looks up the account by email without ever reporting that it doesn't exist. |  |
| 487 | `PasswordResetRequestSerializer.save()` | If the account exists: cancels older unused codes, creates a new 6-digit code valid for CODE_TTL_MINUTES and emails it. |  |
| 501 | **`PasswordResetVerifySerializer`** (class) | Forgot Password step 2: check the code. Wrong guesses are counted (orms_backend/codes.py). | accounts/views.py |
| 507 | `PasswordResetVerifySerializer.validate()` | Finds the newest unused code for the email and checks the typed code with check_code() (wrong guesses counted; after 5 the code is dead). |  |
| 523 | `PasswordResetVerifySerializer.save()` | Marks the code as verified (needed for step 3). |  |
| 529 | **`PasswordResetConfirmSerializer`** (class) | Forgot Password step 3: set the new password (only with a code verified in step 2). | accounts/views.py |
| 536 | `PasswordResetConfirmSerializer.validate()` | Requires a matching code that was verified in step 2, unused and not expired. |  |
| 552 | `PasswordResetConfirmSerializer.save()` | Sets the new password, marks the code used and clears any login lockout. |  |
| 567 | `_ago()` | Turns a date/time into text like "3 days ago". | this file |
| 571 | **`AdminAccountSerializer`** (class) | One row of Admin > Manage Accounts (field names match manage-accounts.js). | accounts/views.py |
| 597 | `AdminAccountSerializer._status_breakdown()` | Counts a citizen's reports or suggestions per status: {total, byStatus}. |  |
| 601 | `AdminAccountSerializer.get_reportStats()` | Report counts per status for citizens; null for staff. |  |
| 604 | `AdminAccountSerializer.get_suggestionStats()` | Suggestion counts per status for citizens; null for staff. |  |
| 607 | `AdminAccountSerializer.get_setupPending()` | True if the owner hasn't finished account setup (no password yet). |  |
| 610 | `AdminAccountSerializer.get_activityMinutes()` | Minutes since last login, used for sorting (never logged in = a huge number so they sort last). |  |
| 616 | `AdminAccountSerializer.get_lastActiveLabel()` | "5 minutes ago" or "Never logged in". |  |
| 619 | `AdminAccountSerializer.get_created()` | When the account was created, as "… ago". |  |
| 622 | `AdminAccountSerializer.get_updated()` | When the account was last changed, as "… ago". |  |
| 626 | **`PendingVerificationSerializer`** (class) | One row of Admin > Approve Accounts. | accounts/views.py |
| 639 | `PendingVerificationSerializer.get_photoUrl()` | Full URL of the voter's ID photo (a protected, signed link). |  |
| 644 | `PendingVerificationSerializer.get_created()` | When the sign-up was made, as "… ago". |  |
| 648 | **`AuditLogSerializer`** (class) | One row of Admin > View Audit Logs. | accounts/views.py |
| 662 | `AuditLogSerializer.get_accountId()` | The account id, or "—" when the account was deleted. |  |
| 667 | `AuditLogSerializer.get_owner()` | The saved name from the time of the action (falls back to the current account name for very old entries). |  |
| 672 | `AuditLogSerializer.get_type()` | The saved account type from the time of the action (with the same fallback). |  |
| 677 | `AuditLogSerializer.get_timeLabel()` | The local time as "HH:MM:SS MM/DD/YYYY". |  |

#### `accounts/setup_links.py`

One-time emailed links (no password is ever emailed).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 37 | **`AccountSetupTokenGenerator`** (class) | Makes and checks the token in account setup links (its own key_salt, so a setup token can't be used as a reset token). | this file |
| 41 | **`AdminPasswordResetTokenGenerator`** (class) | Makes and checks the token in Administrator-sent password reset links. | this file |
| 44 | `AdminPasswordResetTokenGenerator.check_token()` | Normal token check, plus a 24-hour limit (the default allows 72 hours). |  |
| 56 | `user_from_uid()` | The account the link's uid points to, or None. | this file, accounts/views.py |
| 64 | `_link_params()` | Builds the "uid=...&token=..." part of a link for a user. | this file |
| 71 | `is_pending_setup()` | True for an active account that hasn't chosen a password yet. | this file, accounts/views.py |
| 76 | `build_setup_url()` | The full account setup link: citizen/account-setup.html or staff/account-setup.html, with uid and token after "#". | this file |
| 81 | `send_setup_link()` | Emails a fresh setup link. Every link sent before it stops working. | accounts/views.py |
| 88 | `pending_user_for_link()` | The account a still-valid setup link belongs to, or None. | accounts/views.py |
| 98 | `can_receive_reset_link()` | True for an active staff/administrator account that already has a password (only those get Administrator reset links). | this file, accounts/views.py |
| 107 | `send_reset_link()` | Emails a staff/new-password.html link with a fresh reset token (valid 24 hours). | accounts/views.py |
| 112 | `user_for_reset_link()` | The staff/administrator account a still-valid reset link belongs to, or None. | accounts/views.py |

#### `accounts/throttles.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 4 | **`ResetRequestEmailThrottle`** (class) | Limits code/link requests per *email address* (on top of the per-IP limit), so someone switching IP addresses still can't flood one person's inbox. Rate: "reset_request_email" in settings.REST_FRAMEWORK. | accounts/views.py |
| 13 | `ResetRequestEmailThrottle.get_cache_key()` | Counts requests per email address (lower-cased) instead of per IP. With no email in the request, this limit doesn't apply. |  |

#### `accounts/views.py`

Accounts — API views. All URLs start with /api/auth/ (see accounts/urls.py).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 74 | **`PublicView`** (class) | Base for endpoints used before logging in: open to anyone, rate limited by `throttle_scope`. | this file |
| 85 | **`RegisterView`** (class) | POST /register/ — citizen sign up. Every active Administrator is emailed about it. | accounts/urls.py |
| 94 | `RegisterView.perform_create()` | Saves the new citizen (RegisterSerializer) and emails every active Administrator that an account is waiting for approval. |  |
| 99 | **`CheckAccountAvailabilityView`** (class) | POST /check-availability/ — is this email / phone number still free? (Sign Up step 1) | accounts/urls.py |
| 104 | `CheckAccountAvailabilityView.post()` | Runs AccountAvailabilityCheckSerializer; answers {} if the email/phone are free, or 400 with the error. |  |
| 109 | **`LoginView`** (class) | POST /login/ — returns access + refresh tokens and the user's profile. | accounts/urls.py |
| 117 | **`LogoutView`** (class) | POST /logout/ — records the logout time on the latest LoginSession. The browser deletes its own tokens. | accounts/urls.py |
| 125 | `LogoutView.post()` | Sets logged_out_at on the user's latest open LoginSession and writes "Logged out" to the audit log. |  |
| 142 | **`PasswordResetRequestView`** (class) | POST /password-reset/request/ — emails a 6-digit code. | accounts/urls.py |
| 148 | `PasswordResetRequestView.post()` | Runs PasswordResetRequestSerializer (emails a code if the account exists) and always gives the same answer. |  |
| 156 | **`PasswordResetVerifyView`** (class) | POST /password-reset/verify/ — checks the code. | accounts/urls.py |
| 161 | `PasswordResetVerifyView.post()` | Runs PasswordResetVerifySerializer: checks the code and marks it verified. |  |
| 168 | **`PasswordResetConfirmView`** (class) | POST /password-reset/confirm/ — saves the new password. | accounts/urls.py |
| 173 | `PasswordResetConfirmView.post()` | Runs PasswordResetConfirmSerializer: saves the new password. |  |
| 189 | **`AccountSetupCheckView`** (class) | POST /account-setup/check/ — is the link valid? Returns the details to pre-fill. | accounts/urls.py |
| 194 | `AccountSetupCheckView.post()` | Checks the uid/token from the setup link; returns the account's current details so the form can be pre-filled, or 400 if the link is invalid. |  |
| 209 | **`AccountSetupView`** (class) | POST /account-setup/ — saves the owner's details and password, then logs them in (same response shape as /login/). Setting the password kills the link. | accounts/urls.py |
| 217 | `AccountSetupView.post()` | Checks the link, saves the details and password (CitizenSetupSerializer or StaffAccountSetupSerializer), records a login and returns tokens + profile, exactly like /login/. |  |
| 238 | **`AccountSetupLinkRequestView`** (class) | POST /account-setup/request-link/ — emails a new setup link, found by `email` or by the `uid` of an expired link. Always gives the same answer, so it can't be used to find out which emails have accounts. | accounts/urls.py |
| 248 | `AccountSetupLinkRequestView.post()` | Finds the account by email (or the uid of an expired link); if it is still waiting for setup, emails a fresh setup link. Same answer either way. |  |
| 256 | **`PasswordLinkCheckView`** (class) | POST /password-link/check/ — is the Administrator-sent reset link still valid? | accounts/urls.py |
| 261 | `PasswordLinkCheckView.post()` | Checks an Administrator-sent reset link; returns the email and name, or 400. |  |
| 268 | **`PasswordLinkConfirmView`** (class) | POST /password-link/ — saves the new password from a reset link (and lifts any lockout). | accounts/urls.py |
| 273 | `PasswordLinkConfirmView.post()` | Checks the reset link and the new password (LinkPasswordSerializer), saves it, clears any lockout and logs it. |  |
| 290 | **`ProfileEditCodeRequestView`** (class) | POST /profile-edit/request-code/ — emails a code needed to change email/phone/address. | accounts/urls.py |
| 297 | `ProfileEditCodeRequestView.post()` | Cancels older profile-edit codes, creates a new one valid for 15 minutes and emails it to the address on file. |  |
| 310 | **`MeView`** (class) | GET /me/ — the logged-in user's profile. PATCH /me/ — edit it. Changing email, mobile number or address also needs `verification_code` (from /profile-edit/request-code/). DELETE /me/ — a citizen deletes their own account (password required). | accounts/models.py, accounts/urls.py |
| 321 | `MeView.get()` | Returns the logged-in user's profile (UserSerializer). |  |
| 324 | `MeView._sensitive_fields_changing()` | True if the request changes email, mobile number or address (those need a verification code). |  |
| 330 | `MeView._check_verification_code()` | Returns an error Response, or None when the code is correct. |  |
| 349 | `MeView.patch()` | Edits the profile. If a sensitive field changes, the emailed code is checked first (_check_verification_code). Then ProfileUpdateSerializer saves the changes. |  |
| 361 | `MeView.delete()` | Citizens only: checks the password (DeleteAccountSerializer), logs the action, deletes the account with its reports/concerns/questions and emails a confirmation. |  |
| 377 | **`ChangePasswordView`** (class) | POST /change-password/ — My Profile > Change Password. | accounts/urls.py |
| 382 | `ChangePasswordView.post()` | Runs ChangePasswordSerializer: checks the current password and saves the new one. |  |
| 393 | **`AdminCreateUserView`** (class) | POST /admin/create-user/ — new staff/administrator account; a setup link is emailed. | accounts/urls.py |
| 400 | `AdminCreateUserView.perform_create()` | Creates the staff/administrator account, emails the setup link and writes an audit log entry. |  |
| 406 | **`AdminInviteCitizenView`** (class) | POST /admin/create-citizen/ — new citizen account from an email (Administrator or Secretary). | accounts/urls.py |
| 413 | `AdminInviteCitizenView.perform_create()` | Creates the citizen account from an email, emails the setup link and writes an audit log entry. |  |
| 419 | **`StaffCreateCitizenView`** (class) | POST /admin/create-citizen-direct/ — new citizen account with all details (Administrator). | accounts/urls.py |
| 426 | `StaffCreateCitizenView.perform_create()` | Creates the citizen account with all details, emails the setup link and writes an audit log entry. |  |
| 432 | **`AdminListUsersView`** (class) | GET /admin/users/ — Manage Accounts list, newest first. | accounts/urls.py |
| 443 | `_active_claims()` | Reports `holder` has claimed that aren't closed yet (Resolved/With Remarks). | this file |
| 450 | `_release_claims()` | Unclaims every active report of `holder` (one audit entry each). Returns how many. | this file |
| 461 | `_claims_note()` | Text added to audit log entries, e.g. " — 2 claimed reports released" (empty when none). | this file |
| 467 | `_claims_block_response()` | The 400 answer "<name> still has N active claimed reports. Release them before …" with the count, so the page can ask the Administrator to confirm. | this file |
| 479 | **`AdminAccountDetailView`** (class) | GET /admin/users/<id>/ — one account. PATCH /admin/users/<id>/ — {"active": true/false} and/or {"staff_role": "..."}. If the account still has active claimed reports, the request must include "release_claims": true, otherwise it is refused. | accounts/urls.py |
| 493 | `AdminAccountDetailView.patch()` | Enable/disable an account and/or change a staff role. Refuses: disabling or changing your own account, removing the last Administrator, a second Captain/Secretary. If the account still holds claimed reports, the request needs release_claims=true; then the claims are released. Saves, writes audit log entries and emails the owner when disabled. |  |
| 561 | `AdminAccountDetailView.delete()` | Deletes an account (not your own, not the last Administrator): releases its claimed reports, logs it, deletes it and emails the owner. |  |
| 577 | **`AdminResendSetupLinkView`** (class) | POST /admin/users/<id>/resend-setup-link/ — only while the account is still waiting for setup. | accounts/urls.py |
| 582 | `AdminResendSetupLinkView.post()` | Emails a new setup link, only if the account hasn't been set up yet. |  |
| 591 | **`AdminResetPasswordView`** (class) | POST /admin/users/<id>/reset-password/ — emails a staff/administrator a link to choose a new password. Citizens use Forgot Password instead. | accounts/urls.py |
| 599 | `AdminResetPasswordView.post()` | Emails a password reset link to a staff/administrator account. Refused for citizens, accounts not set up yet, your own account and disabled accounts. |  |
| 620 | **`AdminListPendingVerificationsView`** (class) | GET /admin/verifications/ — citizens waiting for voter's ID approval, oldest first. | accounts/urls.py |
| 632 | **`AdminApproveVerificationView`** (class) | POST /admin/verifications/<id>/approve/ — the citizen can now log in. | accounts/urls.py |
| 637 | `AdminApproveVerificationView.post()` | Marks the voter's ID as approved (who/when), sets the user as verified, emails them and logs it. |  |
| 650 | **`AdminRejectVerificationView`** (class) | POST /admin/verifications/<id>/reject/ — needs a `reason`. The reason is emailed and the pending account is deleted, so the person can sign up again with the same email. | accounts/urls.py |
| 659 | `AdminRejectVerificationView.post()` | Needs a reason. Emails the reason, deletes the pending account (so the person can sign up again) and logs it. |  |
| 672 | **`AdminListAuditLogsView`** (class) | GET /admin/audit-logs/ — View Audit Logs, newest first. | accounts/urls.py |

#### `accounts/management/commands/create_admin.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 8 | **`Command`** (class) | python manage.py create_admin Creates the first Administrator account from the ADMIN_EMAIL and ADMIN_PASSWORD environment variables (useful on hosting without shell access). Safe to run on every deploy: if the account already exists it is left unchanged. Does nothing if either variable is missing. | — |
| 20 | `Command.handle()` | Reads ADMIN_EMAIL and ADMIN_PASSWORD; if both are set and no account has that email, creates an Administrator (verified, superuser). |  |

#### `accounts/management/commands/encrypt_existing_files.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 16 | **`Command`** (class) | python manage.py encrypt_existing_files [--dry-run] [--keep-originals] One-time conversion: encrypts voter's ID photos and report/concern photos that were uploaded before uploads were encrypted. | — |
| 30 | `Command.add_arguments()` | Adds the --dry-run and --keep-originals options. |  |
| 37 | `Command.handle()` | Goes through voter's ID images and report/concern attachments; each file that isn't encrypted (and isn't a video) is re-saved through EncryptedStorage, and the original is deleted unless --keep-originals. Prints a summary. |  |

#### `reports/apps.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 4 | **`ReportsConfig`** (class) | Django app configuration; Django loads it automatically from INSTALLED_APPS. | — |

#### `reports/models.py`

Reports — database tables for what citizens submit.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 24 | **`Report`** (class) | An ordinance-violation report filed by a citizen. | this file, accounts/tests.py, accounts/views.py, ordinances/matching.py, ordinances/views.py, orms_backend/codes.py, +10 more |
| 75 | `Report.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 78 | `Report.save()` | On the first save, gives the report its number (next_report_number, e.g. 20260919-3). If two reports get the same number at the same moment, the unique constraint stops one and it retries with the next number (up to 5 tries). |  |
| 96 | `next_report_number()` | The next unused "YYYYMMDD-N" for `day`. | this file, reports/tests.py |
| 104 | **`ReportAttachment`** (class) | One photo/video attached to a report. Photos are stored encrypted (encrypted_storage). | this file, accounts/management/commands/encrypt_existing_files.py, orms_backend/tests.py, reports/admin.py, reports/serializers.py |
| 112 | **`ReportVerificationCode`** (class) | 6-digit code that confirms the account owner is the one filing a report. Needed for a citizen's first report, and again after 30 days without one (see reports/verification.py). | this file, reports/serializers.py, reports/tests.py, reports/verification.py, reports/views.py |
| 133 | `ReportVerificationCode.is_valid()` | True if the code hasn't been verified yet and hasn't expired. |  |
| 136 | `ReportVerificationCode.expire()` | Makes the code expire now (sets expires_at to the current time). |  |
| 140 | `ReportVerificationCode.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 144 | **`ConcernFolder`** (class) | A category (e.g. "Noise") the Secretary files concerns/suggestions under. | this file, reports/serializers.py, reports/tests.py, reports/views.py |
| 154 | `ConcernFolder.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 158 | **`Concern`** (class) | A concern or suggestion submitted by a citizen. | this file, orms_backend/tests.py, orms_backend/tests_injection.py, orms_backend/tests_resistance.py, reports/admin.py, reports/serializers.py, +2 more |
| 181 | `Concern.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 185 | **`ConcernAttachment`** (class) | One photo/video attached to a concern/suggestion. Photos are stored encrypted. | this file, accounts/management/commands/encrypt_existing_files.py, orms_backend/tests.py, reports/admin.py, reports/serializers.py |
| 192 | **`Question`** (class) | A question a citizen asks from the FAQs page, answered by staff. It counts as answered when `answer` is filled in. Answered questions are kept so an Administrator can turn common ones into FAQs. | this file, orms_backend/tests.py, reports/serializers.py, reports/views.py |
| 212 | `Question.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 216 | `Question.is_answered()` | True once an answer has been written (calculated, not stored). |  |
| 220 | **`FAQ`** (class) | One entry on the public FAQs page, written by an Administrator. | this file, reports/serializers.py, reports/views.py |
| 233 | `FAQ.__str__()` | The text shown for this row in the Django admin and in logs. |  |

#### `reports/pdf.py`

"Download Summary (PDF)" on the Reports Dashboard (StaffReportDashboardPdfView).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 36 | `_get_styles()` | Creates the PDF text styles once (title, section headings, table cells) and reuses them afterwards. | this file |
| 58 | `_table()` | Builds a ReportLab table with a navy header row; every cell is HTML-escaped so text like "&" can't break the PDF. | this file |
| 79 | `_section()` | Adds one section to the PDF: heading, optional period line, then the table — or the "empty" message when there are no rows. | this file |
| 87 | `_stats_rows()` | Overview rows: each count plus its change from the previous period. | this file |
| 109 | `build_dashboard_pdf()` | Dashboard JSON -> PDF bytes. | reports/views.py |

#### `reports/serializers.py`

Reports — serializers.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 25 | `validate_attachment_files()` | At most 5 files and at most 50 MB in total; otherwise a validation error. | this file |
| 33 | `name_or_none()` | A user's display name, or None when there is no user. | this file |
| 37 | **`AttachmentsMixin`** (class) | Adds `attachments`: the full URL of every file attached to the object. | this file |
| 40 | `AttachmentsMixin.get_attachments()` | List of full URLs of the object's attachments (encrypted photos get protected links). |  |
| 50 | **`ReportSerializer`** (class) | File a Report (POST) and My Reports / My Report Detail (GET). | this file, reports/views.py |
| 70 | `ReportSerializer.validate_files()` | Applies validate_attachment_files() to the uploaded files. |  |
| 73 | `ReportSerializer.get_claimed_by()` | Name of the Investigator who claimed the report, or null. |  |
| 76 | `ReportSerializer.validate()` | If the device's latitude/longitude are missing or outside the box around Barangay Platero, they are dropped (the report then uses its street on the heatmap). |  |
| 90 | `ReportSerializer.create()` | Creates the report for the logged-in citizen and one ReportAttachment per uploaded file. |  |
| 98 | **`ConcernSerializer`** (class) | Submit Suggestion (POST) and My Concerns/Suggestions (GET). | this file, reports/views.py |
| 112 | `ConcernSerializer.validate_files()` | Applies validate_attachment_files() to the uploaded files. |  |
| 115 | `ConcernSerializer.create()` | Creates the concern for the logged-in citizen and one ConcernAttachment per uploaded file. |  |
| 123 | **`AnsweredByMixin`** (class) | Adds who answered a question: their name and their account type. | this file |
| 126 | `AnsweredByMixin.get_answered_by_name()` | Name of the person who answered, or null. |  |
| 129 | `AnsweredByMixin.get_answered_by_role()` | Account type of the person who answered (e.g. "Secretary"), or null. |  |
| 133 | **`QuestionSerializer`** (class) | FAQs page: ask a question (POST) and see your own questions and answers (GET). | this file, reports/views.py |
| 148 | `QuestionSerializer.create()` | Saves the question for the logged-in citizen. |  |
| 152 | **`ReportVerifyCodeSerializer`** (class) | Checks the 6-digit code sent before filing a report (wrong guesses are counted). | this file, reports/views.py |
| 157 | `ReportVerifyCodeSerializer.validate()` | Finds the citizen's newest unverified code and checks the typed code with check_code() (wrong guesses counted; 5 wrong = dead code). |  |
| 172 | `ReportVerifyCodeSerializer.save()` | Marks the code as verified, which lets the citizen file a report within the next hour. |  |
| 182 | **`StaffReportSerializer`** (class) | A report as staff see it: adds who filed it and who claimed it. | reports/views.py |
| 202 | `StaffReportSerializer.get_assignedInvestigator()` | Name of the Investigator who claimed the report, or null. |  |
| 206 | **`StaffReportUpdateSerializer`** (class) | Staff may only change a report's status and remarks. | reports/views.py |
| 214 | **`ConcernFolderSerializer`** (class) | A folder in the Concerns/Suggestions sidebar; `count` = concerns inside it. | this file, reports/views.py |
| 224 | `ConcernFolderSerializer.get_count()` | How many concerns are in the folder (calculated when read). |  |
| 227 | `ConcernFolderSerializer.validate_name()` | Trims the name; refuses an empty name or one already used by another folder (ignoring case). |  |
| 239 | **`ConcernFolderMiniSerializer`** (class) | Just a folder's id and name (shown inside a concern). | this file |
| 245 | **`StaffConcernSerializer`** (class) | A concern/suggestion as staff see it: adds who submitted it and its folder. | reports/views.py |
| 261 | **`StaffConcernUpdateSerializer`** (class) | Staff may change remarks and folder. Status is set automatically (see StaffConcernDetailView). | reports/views.py |
| 272 | **`StaffQuestionSerializer`** (class) | A question as staff see it: adds who asked it. | reports/views.py |
| 290 | `_not_blank()` | Trims the text and raises the given message if nothing is left. | this file |
| 297 | **`StaffQuestionAnswerSerializer`** (class) | The answer a staff member types for a citizen's question. | reports/views.py |
| 302 | `StaffQuestionAnswerSerializer.validate_answer()` | The answer can't be empty. |  |
| 306 | **`FAQSerializer`** (class) | Public FAQ list; Administrators can add, edit and delete entries. | this file, reports/views.py |
| 314 | `FAQSerializer.validate_question()` | The question can't be empty. |  |
| 317 | `FAQSerializer.validate_answer()` | The answer can't be empty. |  |

#### `reports/verification.py`

Anti-abuse rules for File a Report (all checked in ReportListCreateView.create):

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 27 | `_last_report()` | The citizen's most recent report, or None. | this file |
| 31 | `verification_required()` | True if the citizen must enter an emailed code before filing: no report yet, or the last one is older than 30 days. | reports/views.py |
| 38 | `has_valid_verification()` | True if the citizen verified a code within the last 60 minutes. | reports/views.py |
| 43 | `cooldown_remaining()` | How long until the citizen may file again (a timedelta), or None. | reports/views.py |
| 53 | `check_and_apply_abuse_lockout()` | Called right after a report is created: if the citizen filed 5 or more reports in the last 12 hours, disables the account, writes an audit log entry and emails them. | reports/views.py |

#### `reports/views.py`

Reports — API views (URLs in reports/urls.py, all under /api/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 56 | `_active_staff()` | All active staff accounts (they are emailed about new reports and suggestions). | this file |
| 64 | **`ReportListCreateView`** (class) | GET /reports/ — the citizen's own reports (My Reports). POST /reports/ — file a report. Checked first: cooldown, then identity verification (see reports/verification.py). | reports/urls.py, reports/verification.py |
| 74 | `ReportListCreateView.get_queryset()` | Only the logged-in citizen's own reports. |  |
| 77 | `ReportListCreateView.create()` | Before saving: refuses with 429 during the 2-hour cooldown, and with 403 (verification_required) if an emailed code is needed. After saving: deletes the used verification and runs the abuse check (check_and_apply_abuse_lockout). |  |
| 101 | `ReportListCreateView.perform_create()` | Saves the report, writes an audit log entry, emails the citizen a confirmation and emails every active staff member. |  |
| 108 | **`ReportVerificationStatusView`** (class) | GET /reports/verification-status/ — does File a Report need a code first? Any cooldown left? | reports/urls.py |
| 113 | `ReportVerificationStatusView.get()` | Tells File a Report whether a code is needed now and how many seconds of cooldown are left. |  |
| 122 | **`ReportSendVerificationView`** (class) | POST /reports/send-verification/ — emails a new 6-digit code (older ones stop working). | reports/urls.py |
| 129 | `ReportSendVerificationView.post()` | Expires older unverified codes, creates a new 6-digit code (15 minutes) and emails it. |  |
| 142 | **`ReportVerifyCodeView`** (class) | POST /reports/verify-code/ — checks the code. | reports/urls.py |
| 149 | `ReportVerifyCodeView.post()` | Runs ReportVerifyCodeSerializer: checks the code and marks it verified. |  |
| 156 | **`ReportDetailView`** (class) | GET /reports/<id>/ — one of the citizen's own reports. | reports/urls.py |
| 162 | `ReportDetailView.get_queryset()` | Only the citizen's own reports (someone else's report gives 404). |  |
| 166 | **`ConcernListCreateView`** (class) | GET /concerns/ — the citizen's own concerns. POST /concerns/ — submit one. | reports/urls.py |
| 172 | `ConcernListCreateView.get_queryset()` | Only the logged-in citizen's own concerns. |  |
| 175 | `ConcernListCreateView.perform_create()` | Saves the concern, writes an audit log entry, emails the citizen and every active staff member. |  |
| 182 | **`ConcernDetailView`** (class) | GET /concerns/<id>/ — one of the citizen's own concerns. | reports/urls.py |
| 188 | `ConcernDetailView.get_queryset()` | Only the citizen's own concerns. |  |
| 192 | **`QuestionListCreateView`** (class) | GET /questions/ — the citizen's own questions. POST /questions/ — ask one. | reports/urls.py |
| 198 | `QuestionListCreateView.get_queryset()` | Only the logged-in citizen's own questions. |  |
| 206 | `_get_report()` | Loads one report with its citizen and investigator (404 if not found). | this file |
| 210 | `_staff_report_response()` | Builds the standard staff JSON answer for one report (StaffReportSerializer). | this file |
| 214 | **`StaffReportListView`** (class) | GET /reports/staff/ — every report. ?assigned_to=<user id> only the reports that user has claimed ?active=1 only reports that aren't closed yet | reports/urls.py |
| 224 | `StaffReportListView.get_queryset()` | Every report; filtered by ?assigned_to=<user id> and/or ?active=1 (not closed). |  |
| 237 | **`StaffReportAnalysisBaseView`** (class) | GET /reports/staff/analysis-base/ — number of approved, active citizens (for percentages). | reports/urls.py |
| 242 | `StaffReportAnalysisBaseView.get()` | Counts approved, active citizens (the base for the dashboard's percentages). |  |
| 247 | **`StaffReportDetailView`** (class) | GET /reports/staff/<id>/ — any staff member can view a report. PATCH /reports/staff/<id>/ — change status/remarks. Only the Investigator who claimed the report (or an Administrator) may do this. | reports/urls.py |
| 256 | `StaffReportDetailView.get()` | Returns the report. If the viewer is the Investigator who claimed it, records the visit time (the citizen sees "viewed"). |  |
| 264 | `StaffReportDetailView.patch()` | Only the claiming Investigator (or an Administrator) may change status/remarks. New remarks on a Submitted report move it to Under Review. Writes audit log entries, and emails the citizen when the report becomes Resolved / With Remarks. |  |
| 305 | **`StaffReportDashboardPdfView`** (class) | POST /reports/staff/dashboard-pdf/ — "Download Summary (PDF)" on the Reports Dashboard. The browser already computed every number (reports-dashboard.js) and posts them as JSON; this view only lays them out. | reports/pdf.py, reports/urls.py |
| 315 | `StaffReportDashboardPdfView.post()` | Builds the summary PDF from the numbers the dashboard sends (build_dashboard_pdf) and returns it as a download named reports-summary-<dates>.pdf. Bad data gives 400. |  |
| 335 | **`StaffReportClaimView`** (class) | POST /reports/staff/<id>/claim/ — an Investigator claims an unclaimed report. | reports/urls.py |
| 340 | `StaffReportClaimView.post()` | An Investigator claims a report (refused if someone else holds it). If a different Investigator had it before, the citizen is emailed. Writes an audit log entry. |  |
| 358 | **`StaffReportForfeitView`** (class) | POST /reports/staff/<id>/forfeit/ — Administrator releases a claim so another Investigator can take it. | reports/urls.py |
| 363 | `StaffReportForfeitView.post()` | Administrator releases the claim (remembering the previous Investigator) and writes an audit log entry. |  |
| 374 | **`StaffReportAssignView`** (class) | POST /reports/staff/<id>/assign/ {"investigator_id": ...} — Administrator picks the Investigator. | reports/urls.py |
| 379 | `StaffReportAssignView.post()` | Administrator gives the report to a chosen active Investigator; the citizen is emailed if it changed hands. Writes an audit log entry. |  |
| 405 | **`StaffConcernListView`** (class) | GET /concerns/staff/ — every concern/suggestion. | reports/urls.py |
| 413 | **`StaffConcernDetailView`** (class) | GET /concerns/staff/<id>/ — any staff member can view it. PATCH /concerns/staff/<id>/ — Secretary/Administrator changes remarks or folder. A Submitted concern becomes Reviewed once it gets remarks or a folder. | reports/serializers.py, reports/urls.py |
| 422 | `StaffConcernDetailView.get_object()` | Loads one concern with its citizen and folder (404 if not found). |  |
| 425 | `StaffConcernDetailView.get()` | Returns the concern as staff see it. |  |
| 428 | `StaffConcernDetailView.patch()` | Secretary/Administrator only. Saves remarks and/or folder; a Submitted concern that gets remarks or a folder becomes Reviewed automatically. Writes audit log entries. |  |
| 453 | **`ConcernFolderListCreateView`** (class) | GET /concerns/folders/ — any staff. POST — Secretary/Administrator creates a folder. | reports/urls.py |
| 459 | `ConcernFolderListCreateView.get_permissions()` | Listing: any staff. Creating: Secretary or Administrator. |  |
| 462 | `ConcernFolderListCreateView.perform_create()` | Saves the folder and writes an audit log entry. |  |
| 467 | **`ConcernFolderDetailView`** (class) | GET — any staff. PATCH (rename) / DELETE — Secretary/Administrator. | reports/urls.py |
| 473 | `ConcernFolderDetailView.get_permissions()` | Viewing: any staff. Renaming/deleting: Secretary or Administrator. |  |
| 478 | `ConcernFolderDetailView.perform_update()` | Saves the new name and writes an audit log entry. |  |
| 482 | `ConcernFolderDetailView.perform_destroy()` | Deletes the folder (its concerns stay, without a folder) and writes an audit log entry. |  |
| 492 | **`StaffQuestionListView`** (class) | GET /questions/staff/ — every citizen question. | reports/urls.py |
| 500 | **`StaffQuestionAnswerView`** (class) | PATCH /questions/staff/<id>/ — answer a question (the citizen is emailed). | reports/urls.py |
| 505 | `StaffQuestionAnswerView.patch()` | Saves the answer with who answered and when, writes an audit log entry and emails the citizen. |  |
| 515 | **`FAQListView`** (class) | GET /faqs/ — the public FAQ list (no login needed). | reports/urls.py |
| 523 | **`AdminFAQListCreateView`** (class) | GET/POST /faqs/admin/ — Administrator manages the FAQ list. | reports/urls.py |
| 530 | `AdminFAQListCreateView.perform_create()` | Saves the FAQ and writes an audit log entry. |  |
| 535 | **`AdminFAQDetailView`** (class) | PATCH/DELETE /faqs/admin/<id>/ — edit or remove an FAQ. | reports/urls.py |
| 542 | `AdminFAQDetailView.perform_update()` | Saves the edit and writes an audit log entry. |  |
| 546 | `AdminFAQDetailView.perform_destroy()` | Deletes the FAQ and writes an audit log entry. |  |

#### `ordinances/apps.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 4 | **`OrdinancesConfig`** (class) | Django app configuration; Django loads it automatically from INSTALLED_APPS. | — |

#### `ordinances/matching.py`

"Suggested ordinances" on the File a Report form.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 23 | `_tokens()` | Splits text into lowercase words of 2+ characters and drops the stop words. | this file |
| 27 | `suggest_ordinances()` | Returns up to `limit` (ordinance, score) pairs, best first, each with a score of at least `min_score`. Returns [] when there are fewer than 2 ordinances or the query is empty. | ordinances/tests.py, ordinances/views.py |

#### `ordinances/models.py`

Ordinances — database tables.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 18 | `pdf_storage()` | Where ordinance PDFs are saved. On Cloudinary PDFs must be uploaded as "raw" files (Cloudinary blocks public PDF downloads of the normal "image" type); locally they go to the media/ folder. | this file, ordinances/migrations/0002_alter_ordinance_pdf_file.py |
| 31 | **`OrdinanceQuerySet`** (class) | Adds .published() to Ordinance.objects, so views can write Ordinance.objects.published(). | this file |
| 32 | `OrdinanceQuerySet.published()` | Not archived — what citizens and guests may see. |  |
| 37 | **`Ordinance`** (class) | One uploaded ordinance: number, title, author (text), category (text), date approved, description, the PDF, who uploaded it and whether it is archived. | this file, accounts/tests.py, ordinances/admin.py, ordinances/serializers.py, ordinances/tests.py, ordinances/urls.py, +2 more |
| 62 | `Ordinance.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 66 | **`OrdinanceAuthor`** (class) | Officials of the Sangguniang Barangay who can author an ordinance. Only used for suggestions in the Author field. Kept (set inactive) when a term ends. Only one active Barangay Captain and one active SK Chairperson are allowed (checked in OrdinanceAuthorSerializer). | this file, ordinances/admin.py, ordinances/serializers.py, ordinances/tests.py, ordinances/views.py |
| 89 | `OrdinanceAuthor.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 93 | **`OrdinanceCategory`** (class) | The category list, managed by an Administrator. Retired categories are kept but inactive. | this file, ordinances/admin.py, ordinances/serializers.py, ordinances/tests.py, ordinances/views.py |
| 106 | `OrdinanceCategory.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 110 | **`OrdinanceView`** (class) | A citizen opened this ordinance, so it leaves their "Latest Ordinances" list. | this file, ordinances/views.py |
| 123 | **`OrdinanceDownload`** (class) | A citizen downloaded this ordinance's PDF. Each citizen may download each ordinance once. | this file, ordinances/views.py |

#### `ordinances/serializers.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 18 | `_citizen()` | The logged-in citizen making the request, or None (guest, staff, admin). | this file |
| 27 | **`OrdinanceSerializer`** (class) | An ordinance as shown on the citizen and staff pages. `pdf_url` is the full download link. The is_* / in_latest flags drive the "New"/"Updated" tags and the home page's Latest Ordinances list. | ordinances/views.py |
| 49 | `OrdinanceSerializer.get_pdf_url()` | Full URL of the PDF, or null. |  |
| 56 | `OrdinanceSerializer.get_uploaded_by_name()` | Display name of the uploader (null if that account was deleted). |  |
| 59 | `OrdinanceSerializer.get_is_new()` | Uploaded or edited in the last LATEST_NEW_DAYS days. |  |
| 63 | `OrdinanceSerializer.get_is_updated()` | New because it was *edited* (not just uploaded) recently. |  |
| 68 | `OrdinanceSerializer.get_is_unread()` | Citizens only: they haven't opened this ordinance yet. |  |
| 77 | `OrdinanceSerializer.get_in_latest()` | Shown in the home page's "Latest Ordinances"? Guests see recent ones. A citizen sees every unopened one that is recent or older than their account. |  |
| 94 | **`OrdinanceAuthorSerializer`** (class) | An entry in Admin > Ordinance Authors (name, position, active). | ordinances/models.py, ordinances/views.py |
| 102 | `OrdinanceAuthorSerializer.validate()` | Only one active Barangay Captain and one active SK Chairperson may be on the author list (Kagawad has 7 seats, so no limit there). |  |
| 117 | **`OrdinanceCategorySerializer`** (class) | An entry in Admin > Ordinance Categories (name, active). | ordinances/views.py |
| 124 | **`OrdinanceWriteSerializer`** (class) | Upload (POST) and edit (PATCH) an ordinance. | this file |
| 131 | `OrdinanceWriteSerializer.validate_category()` | The category must be an active entry of the category list. |  |
| 136 | `OrdinanceWriteSerializer.validate_pdf_file()` | The file must end in .pdf, be 1 byte – 20 MB, and really start with "%PDF-". |  |
| 147 | **`OrdinanceCreateSerializer`** (class) | POST — the PDF is required. | ordinances/views.py |
| 154 | **`OrdinanceUpdateSerializer`** (class) | PATCH — replacing the PDF is optional. | ordinances/views.py |

#### `ordinances/views.py`

Ordinances — API views (URLs in ordinances/urls.py, all under /api/ordinances/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 27 | `_is_staff_or_admin()` | True for a logged-in staff member or Administrator. | this file |
| 31 | `_visible_ordinances()` | All ordinances for staff/Administrators; only published (not archived) ones for everyone else. | this file |
| 35 | `_label()` | e.g. "ordinance No. 1-(2026) — Title", for audit log lines. | this file |
| 40 | `_ordinance_response()` | Builds the standard JSON answer for one ordinance (OrdinanceSerializer). | this file |
| 46 | **`OrdinanceListCreateView`** (class) | GET /ordinances/ — anyone (no login needed). POST /ordinances/ — upload a new ordinance (Secretary/Administrator). | ordinances/urls.py |
| 52 | `OrdinanceListCreateView.get_queryset()` | The ordinances this user may see (_visible_ordinances). |  |
| 55 | `OrdinanceListCreateView.get_permissions()` | Listing: anyone. Uploading: Secretary or Administrator (IsDocumentManager). |  |
| 58 | `OrdinanceListCreateView.get_serializer_class()` | OrdinanceCreateSerializer for uploads, OrdinanceSerializer for the list. |  |
| 61 | `OrdinanceListCreateView.get_serializer_context()` | For a citizen, loads once the ids of ordinances they have opened (for the unread / Latest Ordinances flags). |  |
| 71 | `OrdinanceListCreateView.create()` | Validates the upload, saves it with the uploader, writes an audit log entry and returns the ordinance (201). |  |
| 79 | **`OrdinanceDetailView`** (class) | GET /ordinances/<id>/ — one ordinance (archived ones: staff only). PATCH /ordinances/<id>/ — edit it, optionally with a new PDF (Secretary/Administrator). | ordinances/urls.py |
| 85 | `OrdinanceDetailView.get_queryset()` | The ordinances this user may see (archived ones are hidden from citizens/guests, which gives them 404). |  |
| 88 | `OrdinanceDetailView.get_permissions()` | Viewing: anyone. Editing: Secretary or Administrator. |  |
| 91 | `OrdinanceDetailView.get_serializer_class()` | OrdinanceUpdateSerializer for edits, OrdinanceSerializer for viewing. |  |
| 94 | `OrdinanceDetailView.update()` | Saves the edit, makes the ordinance unread again for every citizen (deletes its OrdinanceView rows) and writes an audit log entry. |  |
| 104 | **`OrdinanceSuggestView`** (class) | GET /ordinances/suggest/?q=<text> — best-matching ordinances for File a Report. | ordinances/urls.py |
| 109 | `OrdinanceSuggestView.get()` | Needs at least 3 characters in ?q=. Returns the top matches from suggest_ordinances() among published ordinances, with their scores. |  |
| 122 | **`_SetArchivedView`** (class) | POST — archive (hide from citizens) or unarchive an ordinance. | this file |
| 129 | `_SetArchivedView.post()` | Sets is_archived to the class's value (True for archive, False for unarchive), writes an audit log entry and returns the ordinance. |  |
| 137 | **`OrdinanceArchiveView`** (class) | POST /ordinances/<id>/archive/ | ordinances/urls.py |
| 144 | **`OrdinanceUnarchiveView`** (class) | POST /ordinances/<id>/unarchive/ | ordinances/urls.py |
| 151 | **`OrdinanceMarkViewedView`** (class) | POST /ordinances/<id>/view/ — a citizen opened it (does nothing for staff). | ordinances/urls.py |
| 156 | `OrdinanceMarkViewedView.post()` | For citizens: records that they opened the ordinance (once). Does nothing for staff. |  |
| 163 | **`OrdinanceDownloadView`** (class) | GET /ordinances/<id>/download/ — returns the PDF link and logs the download. A citizen may download each ordinance only once; staff have no limit. | ordinances/urls.py |
| 171 | `OrdinanceDownloadView.get()` | Returns the PDF link. Citizens can download each ordinance only once (403 the second time); every download is written to the audit log. |  |
| 191 | **`_ManagedListView`** (class) | GET — the active entries (Secretary/Administrator). An Administrator can add ?include_inactive=1 to see retired ones too. POST — add an entry (Administrator). | this file |
| 200 | `_ManagedListView.get_queryset()` | Active entries only, unless an Administrator asks for ?include_inactive=1. |  |
| 207 | `_ManagedListView.get_permissions()` | Viewing: Secretary or Administrator. Adding: Administrator. |  |
| 211 | **`OrdinanceCategoryListCreateView`** (class) | GET/POST /ordinances/categories/ | ordinances/urls.py |
| 217 | `OrdinanceCategoryListCreateView.perform_create()` | Saves the new category and writes an audit log entry. |  |
| 222 | **`OrdinanceCategoryDetailView`** (class) | PATCH (rename / retire) and DELETE /ordinances/categories/<id>/ — Administrator. | ordinances/urls.py |
| 229 | `OrdinanceCategoryDetailView.perform_update()` | Saves the change (rename or retire) and writes an audit log entry. Already-uploaded ordinances keep their old category text. |  |
| 233 | `OrdinanceCategoryDetailView.perform_destroy()` | Writes an audit log entry and deletes the category. |  |
| 238 | **`OrdinanceAuthorListCreateView`** (class) | GET/POST /ordinances/authors/ | ordinances/urls.py |
| 244 | `OrdinanceAuthorListCreateView.perform_create()` | Saves the new author and writes an audit log entry. |  |
| 249 | **`OrdinanceAuthorDetailView`** (class) | PATCH (edit / end term) and DELETE /ordinances/authors/<id>/ — Administrator. | ordinances/urls.py |
| 256 | `OrdinanceAuthorDetailView.perform_update()` | Saves the change (edit or end of term) and writes an audit log entry. |  |
| 260 | `OrdinanceAuthorDetailView.perform_destroy()` | Writes an audit log entry and deletes the author. |  |

#### `siteinfo/apps.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 4 | **`SiteinfoConfig`** (class) | Django app configuration; Django loads it automatically from INSTALLED_APPS. | — |

#### `siteinfo/models.py`

Site information — content an Administrator edits without changing code.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 19 | **`BarangayProfile`** (class) | Always exactly one row (pk=1) — use BarangayProfile.load(). Shown on About Us, in the site footer, and as the navbar brand on every portal. | this file, siteinfo/serializers.py, siteinfo/tests.py, siteinfo/views.py |
| 46 | `BarangayProfile.save()` | Always saves as row 1 — there is only ever one barangay profile. |  |
| 51 | `BarangayProfile.load()` | Returns the one profile row, creating it with default values the first time. |  |
| 55 | `BarangayProfile.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 61 | `BarangayProfile.boundary()` | The outline as a list of [lat, lng] pairs, read from the BoundaryPoint rows in order. |  |
| 64 | `BarangayProfile.set_boundary()` | Replaces the outline: deletes the old BoundaryPoint rows and creates one row per point (in a transaction). |  |
| 73 | `BarangayProfile.footer_links()` | The footer links of one kind (quick or legal) as a list of {label, url}. |  |
| 76 | `BarangayProfile.set_footer_links()` | Replaces the footer links of one kind with the given list (one FooterLink row each). |  |
| 85 | **`FooterLink`** (class) | One footer link. No rows of a kind = the footer shows its built-in links. | this file, siteinfo/serializers.py |
| 101 | `FooterLink.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 105 | **`BoundaryPoint`** (class) | One corner of the barangay outline (drawn or uploaded on Admin > Map Boundary). | this file |
| 117 | **`Street`** (class) | A barangay street: the choices in the Street fields (Sign Up, File a Report, My Profile) and the point where its reports are drawn on the heatmap. Reports keep their location as text, so deleting a street never changes old reports. | this file, orms_backend/tests.py, reports/tests.py, siteinfo/serializers.py, siteinfo/views.py |
| 134 | `Street.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 138 | **`CouncilMember`** (class) | A person in About Us' "Sangguniang Barangay" section. `group` = row, `order` = position in the row. | this file, siteinfo/serializers.py, siteinfo/tests.py, siteinfo/views.py |
| 161 | `CouncilMember.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 165 | **`AboutLogo`** (class) | A seal in About Us' logo strip (barangay, city, current administration). | this file, siteinfo/serializers.py, siteinfo/tests.py, siteinfo/views.py |
| 180 | `AboutLogo.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 184 | **`LegalDocument`** (class) | The Privacy Policy or the Terms and Agreements page (rendered by citizen/js/legal.js). | this file, siteinfo/views.py |
| 195 | `LegalDocument.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 198 | `LegalDocument.section_list()` | The page's sections as a list of {anchor, heading, body}, in order. |  |
| 201 | `LegalDocument.set_sections()` | Replaces all sections with the given list (one LegalSection row each). |  |
| 210 | **`LegalSection`** (class) | One section of a legal page. `body` is plain text where blocks are separated by a blank line: "- " starts a bullet, "1. " a numbered item, "\| a \| b \|" a table row; **bold**, [text](url) and {{address}}/{{email}}/{{phone}}/{{name}} are filled in by the page. | this file |

#### `siteinfo/serializers.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 12 | `validate_image_upload()` | JPG/PNG/WebP up to MAX_IMAGE_BYTES (read at call time, so tests can lower it). | this file, announcements/serializers.py |
| 17 | `image_url()` | An uploaded file's URL, else the seeded image under the frontend root. | this file, announcements/serializers.py, announcements/tests.py |
| 33 | `validate_footer_link_list()` | Checks a footer link list: at most MAX_FOOTER_LINKS, each with a label (≤ 60) and a URL (≤ 500) that is a page name or an http(s)/mailto/tel address. Returns the trimmed list. | this file |
| 58 | **`BarangayProfileSerializer`** (class) | The barangay's details and footer text. The two footer link lists are stored as FooterLink rows but sent and received as lists of {"label": ..., "url": ...}. | siteinfo/views.py |
| 81 | `BarangayProfileSerializer.to_representation()` | Adds the two footer link lists (read from FooterLink rows). With no saved legal links, shows the built-in ones. |  |
| 91 | `BarangayProfileSerializer.validate_footer_quick_links()` | Checks the list with validate_footer_link_list(). |  |
| 94 | `BarangayProfileSerializer.validate_footer_legal_links()` | Checks the list with validate_footer_link_list(). |  |
| 97 | `BarangayProfileSerializer.update()` | Saves the normal fields, then replaces each footer link list that was sent (set_footer_links). |  |
| 105 | **`BrandingSerializer`** (class) | The website's brand: name and logo shown in every portal's navbar/sidebar. | siteinfo/views.py |
| 117 | `BrandingSerializer.get_site_logo_url()` | URL of the uploaded site logo, or "". |  |
| 120 | `BrandingSerializer.validate_site_logo()` | Checks the uploaded logo with validate_image_upload(). |  |
| 127 | **`BoundarySerializer`** (class) | The barangay outline: 3 to MAX_BOUNDARY_POINTS [lat, lng] points, or an empty list to remove it. Every point must be near Biñan, Laguna (this also catches files with latitude and longitude swapped). | siteinfo/views.py |
| 140 | `BoundarySerializer.validate_boundary()` | Needs 0 or at least 3 points, all near Biñan; drops a repeated closing point; rounds to 6 decimals. |  |
| 154 | **`StreetSerializer`** (class) | A street name and its point on the map (must be near Biñan, Laguna). | siteinfo/views.py |
| 161 | `StreetSerializer.validate_name()` | Trims the name; it can't be empty. |  |
| 167 | `StreetSerializer.validate()` | The street's point must be near Biñan, Laguna. |  |
| 175 | **`CouncilMemberSerializer`** (class) | A council member on About Us (name, position, row group, photo, order, visible). | this file, siteinfo/views.py |
| 192 | `CouncilMemberSerializer.get_photoUrl()` | The uploaded photo's URL, or the built-in picture (image_url). |  |
| 195 | `CouncilMemberSerializer.get_hasCustomPhoto()` | True if an Administrator uploaded a photo (the page then adds a green ring). |  |
| 198 | `CouncilMemberSerializer.validate_photo()` | Checks the uploaded photo with validate_image_upload(). |  |
| 202 | **`AboutLogoSerializer`** (class) | A logo in the About Us logo strip (image, alt text, order, visible). | siteinfo/views.py |
| 212 | `AboutLogoSerializer.get_imageUrl()` | The uploaded image's URL, or the built-in picture. |  |
| 215 | `AboutLogoSerializer.validate_image()` | Checks the uploaded image with validate_image_upload(). |  |
| 218 | `AboutLogoSerializer.validate()` | A new logo must have an image; an edit may change only the alt text. |  |
| 225 | **`ReorderSerializer`** (class) | The list of ids in their new order (used by the reorder endpoints). | siteinfo/views.py |
| 233 | **`LegalDocumentSerializer`** (class) | The editable parts of a legal page: effective date and the list of sections. | siteinfo/views.py |
| 237 | `LegalDocumentSerializer.validate_sections()` | Trims every section; limits headings to 200 and bodies to 8000 characters; anchors may only use a-z, 0-9 and dashes. |  |

#### `siteinfo/views.py`

Site information — API views (URLs in siteinfo/urls.py, all under /api/site/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 47 | **`AdminWriteMixin`** (class) | GET is open to everyone; every other method needs an Administrator. | this file |
| 50 | `AdminWriteMixin.get_permissions()` | GET: anyone. Any other method: Administrator. |  |
| 54 | `_delete_file()` | Removes an uploaded file from storage (never the built-in images). Never raises. | this file |
| 63 | `_delete_replaced_file()` | After an edit: delete the old upload if a new one replaced it. | this file |
| 71 | **`AboutPublicView`** (class) | GET /about/ — everything the About Us page and the site footer need. | siteinfo/urls.py |
| 76 | `AboutPublicView.get()` | Returns the barangay profile, the visible council members and the visible logos in one answer. |  |
| 84 | **`BarangayProfileView`** (class) | GET/PATCH /profile/ — Administrator edits the barangay's details and footer. | siteinfo/urls.py |
| 89 | `BarangayProfileView.get()` | Returns the barangay profile for the Administrator's form. |  |
| 92 | `BarangayProfileView.patch()` | Saves the changes and writes an audit log entry listing which fields changed. |  |
| 105 | **`BrandingPublicView`** (class) | GET /branding/ — the navbar/sidebar brand name and logo. | siteinfo/urls.py |
| 110 | `BrandingPublicView.get()` | Returns the site name and logo URL. |  |
| 114 | **`BrandingView`** (class) | GET/PATCH /branding/admin/ — Administrator changes the brand name/logo. | siteinfo/urls.py |
| 119 | `BrandingView.get()` | Returns the site name and logo URL for the Administrator's form. |  |
| 122 | `BrandingView.patch()` | Saves the new name/logo, deletes the replaced logo file and writes an audit log entry. |  |
| 135 | **`BoundaryView`** (class) | GET/PUT /boundary/ — the barangay outline drawn on the maps. | siteinfo/urls.py |
| 138 | `BoundaryView.get()` | Returns the outline as a list of [lat, lng] points. |  |
| 141 | `BoundaryView.put()` | Validates and saves the new outline (or removes it when empty) and writes an audit log entry. |  |
| 155 | **`StreetListCreateView`** (class) | GET /streets/ — all streets (Sign Up needs them before login). POST — add one. | siteinfo/urls.py |
| 161 | `StreetListCreateView.perform_create()` | Saves the new street and writes an audit log entry. |  |
| 166 | **`StreetDetailView`** (class) | PATCH/DELETE /streets/<id>/ — rename, move or remove a street (Administrator). | siteinfo/urls.py |
| 173 | `StreetDetailView.perform_update()` | Saves the change and writes an audit log entry. |  |
| 177 | `StreetDetailView.perform_destroy()` | Writes an audit log entry and deletes the street (old reports keep their address text). |  |
| 184 | **`CouncilMemberListCreateView`** (class) | GET (hidden ones too) / POST /council/ — a new member goes to the end of their row. | siteinfo/urls.py |
| 191 | `CouncilMemberListCreateView.perform_create()` | Puts the new member at the end of their row group, saves and writes an audit log entry. |  |
| 198 | **`CouncilMemberDetailView`** (class) | PATCH/DELETE /council/<id>/ | siteinfo/urls.py |
| 205 | `CouncilMemberDetailView.perform_update()` | Saves the change, deletes the old photo if a new one replaced it, and writes an audit log entry. |  |
| 212 | `CouncilMemberDetailView.perform_destroy()` | Writes an audit log entry, deletes the uploaded photo and the member. |  |
| 218 | **`AboutLogoListCreateView`** (class) | GET (hidden ones too) / POST /logos/ — a new logo goes last. | siteinfo/urls.py |
| 225 | `AboutLogoListCreateView.perform_create()` | Puts the new logo last, saves and writes an audit log entry. |  |
| 231 | **`AboutLogoDetailView`** (class) | PATCH/DELETE /logos/<id>/ | siteinfo/urls.py |
| 238 | `AboutLogoDetailView.perform_update()` | Saves the change, deletes the old image if replaced, and writes an audit log entry. |  |
| 245 | `AboutLogoDetailView.perform_destroy()` | Writes an audit log entry, deletes the uploaded image and the logo. |  |
| 251 | **`_ReorderView`** (class) | POST {"ids": [...]} — each item's `order` becomes its position in the list. | this file |
| 258 | `_ReorderView.post()` | Checks every id still exists, then sets each item's order to its position in the list (in one transaction) and writes an audit log entry. |  |
| 272 | **`CouncilMemberReorderView`** (class) | POST /council/reorder/ | siteinfo/urls.py |
| 279 | **`AboutLogoReorderView`** (class) | POST /logos/reorder/ | siteinfo/urls.py |
| 288 | **`LegalDocumentView`** (class) | GET /legal/<key>/ — the page's sections (anyone). PUT /legal/<key>/admin/ — replace them (Administrator). | siteinfo/urls.py |
| 294 | `LegalDocumentView._document()` | Gets (or creates) the legal page for "privacy" or "terms"; any other key gives 404. |  |
| 301 | `LegalDocumentView._response()` | The JSON answer: key, effective date, sections, last updated. |  |
| 309 | `LegalDocumentView.get()` | Returns the legal page. |  |
| 312 | `LegalDocumentView.put()` | Validates and saves new sections and/or effective date, and writes an audit log entry. |  |

#### `announcements/apps.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 4 | **`AnnouncementsConfig`** (class) | Django app configuration; Django loads it automatically from INSTALLED_APPS. | — |

#### `announcements/models.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 7 | **`Announcement`** (class) | An announcement posted by the Secretary, Barangay Captain or Administrator. Shown on the citizen home page and emailed to every citizen when posted. | this file, announcements/serializers.py, announcements/tests.py, announcements/urls.py, announcements/views.py |
| 27 | `Announcement.__str__()` | The text shown for this row in the Django admin and in logs. |  |
| 31 | **`AnnouncementView`** (class) | A user has seen this announcement, so its "unread" mark is no longer shown. | announcements/tests.py, announcements/views.py |

#### `announcements/serializers.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 8 | **`AnnouncementSerializer`** (class) | Used by the citizen home page feed (`is_read` is per viewer) and by the staff create/edit form (`image` is uploaded, `image_url` is read back). | announcements/views.py |
| 33 | `AnnouncementSerializer.get_image_url()` | The picture's URL, or "" when there is none. |  |
| 36 | `AnnouncementSerializer.get_posted_by_name()` | Display name of the person who posted it (null if that account was deleted). |  |
| 39 | `AnnouncementSerializer.get_is_read()` | Whether the logged-in viewer has seen it — uses the set of seen ids that AnnouncementListView loads once, so there is no extra query per row. |  |
| 50 | `AnnouncementSerializer.validate_image()` | Checks the uploaded picture with validate_image_upload() (real image, allowed type, size limit). |  |
| 53 | `AnnouncementSerializer.create()` | Drops the remove_image flag (meaningless for a new post) and saves. |  |
| 57 | `AnnouncementSerializer.update()` | Marks the announcement as edited, applies "remove picture" or a new picture, saves, then deletes the old picture file from storage. |  |

#### `announcements/views.py`

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 14 | `_citizen_recipients()` | All active citizen accounts (who receive the new-announcement email). | this file |
| 18 | **`AnnouncementListView`** (class) | GET /api/announcements/ — all announcements, newest first (no login needed). | announcements/serializers.py, announcements/urls.py |
| 25 | `AnnouncementListView.get_serializer_context()` | For a logged-in viewer, loads once the ids of announcements they have already seen (used by get_is_read). |  |
| 35 | **`AnnouncementMarkViewedView`** (class) | POST /api/announcements/<id>/view/ — removes that announcement's unread banner for this citizen. | announcements/urls.py |
| 40 | `AnnouncementMarkViewedView.post()` | Records that this user has seen the announcement (only once per user). |  |
| 46 | **`StaffAnnouncementListCreateView`** (class) | GET /api/announcements/staff/ — any staff member. POST — Secretary/Barangay Captain/Administrator; every citizen is emailed. | announcements/urls.py |
| 55 | `StaffAnnouncementListCreateView.get_permissions()` | Listing: any staff member. Posting: Secretary, Barangay Captain or Administrator only. |  |
| 60 | `StaffAnnouncementListCreateView.perform_create()` | Saves the announcement with the poster, writes an audit log entry and emails every active citizen. |  |
| 66 | **`StaffAnnouncementDetailView`** (class) | PATCH/DELETE /api/announcements/staff/<id>/ — Secretary/Barangay Captain/Admin only. | announcements/urls.py |
| 73 | `StaffAnnouncementDetailView.perform_update()` | Saves the edit and writes an audit log entry. |  |
| 77 | `StaffAnnouncementDetailView.perform_destroy()` | Writes an audit log entry, deletes the picture file, then deletes the announcement. |  |

#### `manage.py`

Django's command-line utility for administrative tasks.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 7 | `main()` | Run administrative tasks. | this file |

### 15.3 Shared frontend code (`frontend/shared/js/`)

#### `frontend/shared/js/auth-pages.js`

auth-pages.js — the "account" pages of the citizen and staff portals: Login .................. login.html (citizen), index.html (staff) Sign Up (2 steps) ...... signup.html -> verify-signup.html (citizen only) Forgot Password ........ forgot-password.html -> verify-code.html -> reset-password.html Account setup ..........

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 27 | `loginHome()` | The page to open after login: citizen → home.html, admin → approve-accounts.html, staff → the dashboard for their position (Captain → reports-dashboard, Secretary → secretary-dashboard, Investigator → investigator-dashboard). | this file |
| 50 | `postAuth()` | POST to /api/auth/<path>. Throws a readable Error if the server can't be reached, or (when the answer isn't OK) with the server's message. `fallback` is used when the server sent no message we can show. | this file |
| 72 | `apiLogin()` | POSTs email, password and portal to /api/auth/login/. On success saves the session (storeAuthSession) and returns the role; on failure throws the server's message. | this file |
| 93 | `apiCheckAvailability()` | Sign Up step 1: is the email / phone number still free? Returns {} if both are free, otherwise {field: [message]}. | this file |
| 110 | `apiRegister()` | Sign Up step 2: creates the account (text fields + voter's ID photo). | this file |
| 114 | `apiRequestPasswordReset()` | Forgot Password 1/3: asks the server to email a reset code. | this file |
| 118 | `apiVerifyPasswordResetCode()` | Forgot Password 2/3: sends the typed code for checking. | this file |
| 122 | `apiConfirmPasswordReset()` | Forgot Password 3/3: sends email + verified code + new password. | this file |
| 127 | `apiCheckSetupLink()` | Account setup link: returns the details to pre-fill, or throws "expired / already used". | this file |
| 132 | `apiRequestSetupLink()` | Emails a new setup link, by { email } or { uid } (of an expired link). | this file |
| 137 | `apiCompleteAccountSetup()` | Saves the details + password and logs the person in. | this file |
| 143 | `apiCheckResetLink()` | Administrator-sent reset link (staff/administrator accounts). | this file |
| 147 | `apiConfirmResetLink()` | Saves the new password chosen from an Administrator-sent reset link. | this file |
| 155 | `readDraft()` | Reads a saved JSON draft (Sign Up / Forgot Password progress) from sessionStorage, or null. | this file |
| 164 | `setBusy()` | Disables a submit button while a request runs and puts its label back after. | this file |
| 173 | `handleLogin()` | Login form: checks the fields are filled and the email looks like an email, calls apiLogin(), then opens loginHome(role). Shows the server's message on failure. | this file |
| 201 | `handleSignupStep1()` | Sign Up step 1: check everything, then keep the fields for step 2. | this file |
| 284 | `handleSignupStep2()` | Sign Up step 2: step 1's fields + the voter's ID photo create the account. | this file |
| 325 | `handleForgotRequest()` | Forgot Password 1/3: email a code. | this file |
| 342 | `handleForgotVerify()` | Forgot Password 2/3: check the code. | this file |
| 365 | `handleForgotConfirm()` | Forgot Password 3/3: save the new password. | this file |
| 406 | `wireAccountForms()` | Connects each <form data-goto> on the page to its handler (login, sign-up steps, forgot-password steps) using the form's data-* attribute. | this file |
| 417 | `restoreSignupDraft()` | Coming back from the ID step ("Back to Sign Up") fills in what was typed. | this file |
| 420 | `set()` *(inside restoreSignupDraft)* | Puts a saved value back into one form field. |  |
| 440 | `wireSignupTermsGate()` | Sign Up: the form stays disabled until the Terms & Data Privacy notice is accepted. | this file |
| 469 | `wireIdPhotoPreview()` | Sign Up step 2: preview of the chosen voter's ID photo. | this file |
| 497 | `wireAccountSetup()` | account-setup.html: reads uid/token from the link (then removes them from the address bar), checks the link, pre-fills the details form, and handles "email me a new link" and the final submit (apiCompleteAccountSetup → logged in → home page). | this file |
| 513 | `showSetupStep()` *(inside wireAccountSetup)* | Shows one of the page's panels (loading / request link / sent / invalid / details) and hides the others. |  |
| 519 | `fillSetupDetails()` *(inside wireAccountSetup)* | Fills the form with the details from the server; splits a citizen address "Block/Lot, Street" into its two fields. |  |
| 663 | `wireResetLinkForm()` | staff/new-password.html: checks the Administrator-sent reset link, shows the form for that account, checks password rules and saves the new password. | this file |
| 675 | `showResetInvalid()` *(inside wireResetLinkForm)* | Shows the "link invalid/expired" message. |  |

#### `frontend/shared/js/common.js`

common.js — helpers used by the pages of all three portals (citizen, staff, admin). Every page loads this file FIRST, before the portal's own scripts. 1. Login session (stored tokens, current user, authFetch) 2. Form messages (form errors, field errors) 3. Pop-up dialogs (siteAlert, siteConfirm) 4. Loading placeholders (skeletons) 5. Lists (filter dropdown, remembered filters, page size) 6.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 30 | `authStorage()` | Which storage holds the session: localStorage ("Stay signed in") or sessionStorage. | this file, admin/admin-profile.js, citizen/profile.js, staff/staff-profile.js |
| 34 | `getCurrentUser()` | The logged-in user's saved profile (name, initials, role, position, picture…) from browser storage, or null. | this file, admin/admin-profile.js, admin/layout.js, admin/manage-accounts.js, citizen/file-report.js, citizen/main.js, +14 more |
| 42 | `getAccessToken()` | The saved JWT access token (sent with every API call that needs a login). | this file |
| 46 | `isLoggedIn()` | True if an access token is saved. | this file, admin/layout.js, citizen/file-report.js, citizen/home.js, citizen/main.js, citizen/ordinance-detail.js, +2 more |
| 51 | `logOut()` | Removes the session from both storages. | this file, admin/layout.js, citizen/main.js, citizen/profile.js, citizen/login.html, staff/index.html, +1 more |
| 62 | `expireStaleSession()` | Logs out a session without "Stay signed in" that is older than 1 day. | admin/layout.js, citizen/main.js, shared/auth-pages.js, staff/layout.js |
| 72 | `storeAuthSession()` | Saves the login answer {access, refresh, user}: the tokens, the login time and a copy of the profile, in localStorage ("Stay signed in") or sessionStorage. Returns the role so the caller knows where to go. | shared/auth-pages.js |
| 106 | `refreshAccessToken()` | Asks /api/auth/refresh/ for a new access token using the refresh token (and saves the new refresh token). Returns true if it worked. | this file |
| 130 | `authFetch()` | fetch() with the "Authorization: Bearer <token>" header. On 401 it refreshes the token once and repeats the request. Every logged-in API call goes through this. | this file, admin/about-setup-data.js, admin/accounts-data.js, admin/activity.js, admin/admin-profile.js, admin/audit-log-data.js, +23 more |
| 145 | `showFormError()` | A red message under the whole form (created the first time it's needed). | admin/about-setup.js, admin/admin-profile.js, admin/create-accounts.js, admin/map-boundary.js, admin/ordinance-authors.js, +7 more |
| 158 | `clearFormError()` | Removes the form-level red message. | admin/about-setup.js, admin/admin-profile.js, admin/create-accounts.js, admin/map-boundary.js, admin/ordinance-authors.js, +7 more |
| 164 | `markFieldInvalid()` | Outlines one field in red with a message under it. Cleared when the user types. | admin/create-accounts.js, citizen/file-report.js, shared/auth-pages.js |
| 178 | `clearFieldInvalid()` | Removes one field's red outline and its message. | this file, admin/create-accounts.js, citizen/file-report.js, shared/auth-pages.js |
| 187 | `isValidPhMobile()` | A Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX (spaces and dashes ignored). | citizen/profile.js, shared/auth-pages.js |
| 192 | `wireConfirmPasswordCheck()` | Confirm Password field: marks itself invalid while it differs from Password. | citizen/main.js, shared/auth-pages.js |
| 197 | `validate()` *(inside wireConfirmPasswordCheck)* | Marks Confirm Password invalid while it differs from Password. |  |
| 205 | `wireCodeInputs()` | 6-digit code fields accept digits only. | citizen/main.js, shared/auth-pages.js |
| 221 | `openSiteDialog()` | Shows a dialog and resolves with the `value` of the button pressed (Escape / clicking outside counts as Cancel). | this file |
| 254 | `onKey()` *(inside openSiteDialog)* | Escape closes the dialog as Cancel. |  |
| 257 | `close()` *(inside openSiteDialog)* | Removes the dialog and resolves the promise with the pressed button's value. |  |
| 270 | `siteAlert()` | A site-styled alert() with one OK button. Returns a promise. | this file, admin/about-setup.js, admin/approve-accounts.js, admin/faqs-manage.js, admin/manage-accounts.js, admin/map-boundary.js, +15 more |
| 275 | `siteConfirm()` | Resolves true (confirmed) or false. | this file, admin/manage-accounts.js, admin/reports.js, admin/website-setup.js, staff/report-detail.js, staff/reports-list.js |
| 290 | `skeletonTableRows()` | HTML for grey placeholder table rows shown while a table loads. | admin/about-setup.js, admin/approve-accounts.js, admin/audit-logs.js, admin/manage-accounts.js, admin/ordinance-authors.js, +4 more |
| 295 | `skeletonCards()` | HTML for grey placeholder cards shown while a card list loads. | admin/faqs-manage.js, admin/questions-list.js, citizen/my-concerns-list.js, citizen/my-reports-list.js, staff/concerns-list.js, +2 more |
| 311 | `wireFiltersDropdown()` | Opens/closes a ".filters-dropdown" panel (sort/filter/page-size selects behind one button). The panel's "Clear" button puts every select back to its default and fires its change event. | admin/approve-accounts.js, admin/audit-logs.js, admin/manage-accounts.js, admin/questions-list.js, citizen/my-concerns-list.js, +8 more |
| 314 | `closePanel()` *(inside wireFiltersDropdown)* | Hides the filters panel. |  |
| 350 | `createFilterMemory()` | Remembers a list page's filters/search/page for this tab, per user and per page (sessionStorage). Returns {get, set, bindSelect}: bindSelect restores a <select>'s saved choice and saves later changes. | admin/approve-accounts.js, admin/audit-logs.js, admin/manage-accounts.js, admin/questions-list.js, citizen/my-concerns-list.js, +7 more |
| 359 | `set()` *(inside createFilterMemory)* | Saves one remembered value (ignored if storage is blocked). |  |
| 384 | `pageSizeFrom()` | A "Show" select's value as a page size (null = All). | admin/approve-accounts.js, admin/audit-logs.js, admin/manage-accounts.js, admin/questions-list.js, citizen/my-concerns-list.js, +7 more |
| 394 | `formHasEntries()` | True if anything in the form differs from how the page loaded it. | this file, staff/upload-ordinance.js |
| 416 | `guardUnsavedForm()` | Before leaving a form with unsaved entries, shows "Save Changes?" (Save / Discard / Cancel) when a link is clicked, and the browser's own warning when the tab is closed. Returns {allowLeave()} to call before the page navigates by itself. | citizen/file-report.js, citizen/submit-suggestion.js, staff/upload-ordinance.js |
| 500 | `getPasswordRuleStatus()` | Checks every rule separately: { length: true, lowercase: false, ... }. attrs = the person's firstName/lastName/email (the password can't be too similar). | this file, shared/auth-pages.js |
| 519 | `getPasswordRequirementError()` | The first broken rule as a message, or null if the password looks fine. | admin/admin-profile.js, citizen/profile.js, shared/auth-pages.js, staff/staff-profile.js |
| 536 | `setupPasswordHints()` | Live checklist: every <li data-rule="..."> inside a ".password-hint" list gets ticked as soon as its rule is met. The list follows the form's first password field, or the one named in data-password-field="<id>". | admin/layout.js, admin/profile.html, citizen/account-setup.html, citizen/main.js, citizen/profile.html, +6 more |
| 551 | `update()` *(inside setupPasswordHints)* | Re-checks the password against every rule and ticks/unticks each checklist item. |  |
| 582 | `setupPasswordVisibilityToggles()` | Adds a show/hide (eye) button to every password field on the page. | admin/layout.js, citizen/main.js, shared/auth-pages.js, staff/layout.js |
| 613 | `renderAvatar()` | Shows the user's uploaded photo in an avatar circle, or their initials. | admin/layout.js, citizen/main.js, staff/layout.js |
| 623 | `setFavicon()` | Sets the browser tab icon. | this file, admin/layout.js, citizen/main.js, staff/layout.js |
| 636 | `applySiteBranding()` | Replaces the brand name and logo (citizen navbar or staff/admin sidebar) with the ones set in Admin > Website Setup. If loading fails, the brand written in the HTML stays. | admin/layout.js, citizen/main.js, staff/layout.js |
| 667 | `markNavbarIfLoggedIn()` | Citizen pages call this right after the navbar markup, so a logged-in visitor's navbar is styled correctly before the page is first drawn. | citizen/about.html, citizen/faqs.html, citizen/file-report.html, citizen/forgot-password.html, citizen/home.html, +18 more |
| 674 | `timeAgo()` | "Just now", "5 minutes ago", "2 hours ago", "3 days ago". | this file |
| 691 | `makeNotifId()` | A unique id for a notification (crypto.randomUUID, or time + random text on old browsers). | this file |
| 696 | `createNotificationStore()` | A notification list saved in localStorage under one key (newest first, at most `max`). Returns {list, add(message, link), remove(id), clear()}. | admin/layout.js, citizen/main.js, staff/layout.js |
| 697 | `save()` *(inside createNotificationStore)* | Writes the list to localStorage. |  |
| 700 | `list()` *(inside createNotificationStore)* | Reads the list (gives old items without an id a new id). |  |
| 735 | `notificationItemsHtml()` | HTML for a list of notifications (used by the bell dropdown and the Notifications page). | this file, shared/notifications-page.js |
| 752 | `handleNotificationClick()` | Clicking × removes one notification; clicking the text opens its link. | this file, shared/notifications-page.js |
| 774 | `setupNotificationBell()` | Wires the bell (#notifBell) and its dropdown, which have the same markup on every portal. Returns { render, open } so the portal can refresh it after checking for new notifications, or null if the page has no bell. | admin/layout.js, citizen/main.js, staff/layout.js |
| 782 | `render()` *(inside setupNotificationBell)* | Redraws the dropdown list and shows/hides the red badge. |  |
| 799 | `toggle()` *(inside setupNotificationBell)* | Opens or closes the dropdown. |  |

#### `frontend/shared/js/evidence.js`

evidence.js — the uploaded photos/videos of a report or concern, shown as thumbnails. Clicking one opens it full-size in the page's #mediaLightbox popup. Used by the citizen and staff report/concern detail pages.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 7 | `openMediaLightbox()` | Opens the #mediaLightbox popup showing one photo (or playing one video) full-size. | this file |
| 18 | `renderEvidence()` | Fills `container` with a thumbnail per file URL, or "No uploaded evidence". | citizen/my-concern-detail.js, citizen/my-report-detail.js, staff/concern-detail.js, staff/report-detail.js |

#### `frontend/shared/js/notifications-page.js`

Notifications page (all three portals): the full list of what's in the bell. Uses the portal's `notificationStore` (made in citizen/js/main.js, staff/js/layout.js or admin/js/layout.js), so dismissing here also updates the bell.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 10 | `render()` *(inside page-load handler)* | Redraws the full notification list from the portal's notificationStore. |  |

#### `frontend/shared/js/pagination.js`

pagination.js — page buttons under every list: First / Prev / page numbers / Next / Last, and a "Page X of Y" button to jump to a page.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 4 | `buildPageNumberList()` | Which page numbers to show: all of them up to 7 pages, otherwise first, last, the current ±1 and "..." gaps. | this file |
| 19 | `ensureJumpModal()` | Creates the "Go to Page" popup once (and reuses it). | this file |
| 43 | `closeModal()` *(inside ensureJumpModal)* | Hides the popup. |  |
| 52 | `showJumpToPageModal()` | Opens "Go to Page" with the current page filled in; Go/Enter checks the number is 1..total and calls onGoTo(n). | this file |
| 68 | `submit()` *(inside showJumpToPageModal)* | Validates the typed page number and jumps to it, or shows an error. |  |
| 94 | `renderPaginationControls()` | container: element to render the controls into. page/totalPages: current pagination state (1-indexed). goToPage(n): callback that changes to page n and re-renders. | admin/approve-accounts.js, admin/audit-logs.js, admin/manage-accounts.js, admin/questions-list.js, admin/reports.js, +7 more |

#### `frontend/shared/js/pdf-preview.js`

pdf-preview.js — shows an ordinance PDF inside the page (citizen and staff ordinance detail pages). Each PDF page is drawn on a <canvas> with PDF.js, which also works on phones (they can't show PDFs in an <iframe>). Load /shared/vendor/pdfjs/pdf.min.js first.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 13 | `renderPdfPreview()` | Draws the PDF at `url` into `container` (one canvas per page, full width). Calling it again on the same container cancels the previous drawing. Resolves true when done, or false (with a short message) if it failed. | citizen/ordinance-detail.js, staff/ordinance-detail.js |
| 16 | `stale()` *(inside renderPdfPreview)* | True if a newer preview was started in the same container, so this one stops drawing. |  |

#### `frontend/shared/js/report-form-download.js`

report-form-download.js — "Download Report": draws a report as the filled-in File a Report form (Reporting As, Report Details, photos, consent line) on a canvas and saves it as a one-page PDF named after the report number (e.g. "20260101-5.pdf"). Used by the citizen's My Report detail page and the staff Report detail page. Needs no extra library.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 35 | `reportFormLoadImage()` | Loads a picture for drawing; resolves with the image, or null if it fails or takes longer than 8 seconds. | this file |
| 52 | `reportFormLoadVideoFrame()` | A video's first frame, as a canvas, or null if it won't load in time. | this file |
| 56 | `finish()` *(inside reportFormLoadVideoFrame)* | Stops the video loading and resolves once with the frame (or null). |  |
| 86 | `reportFormIsVideo()` | True if the file URL ends in .mp4, .mov or .webm. | this file |
| 93 | `reportFormSplitLocation()` | "Block/Lot, Street" back into its two form fields — File a Report joins them with ", " (see file-report.js), and a street name has no comma. | this file |
| 100 | `reportFormInputDate()` | How the browser's own date/time inputs show a filled-in value. | this file |
| 105 | `reportFormInputTime()` | "21:30" → "09:30 PM" (how a time input shows it). | this file |
| 111 | `reportFormLongDate()` | A date as "September 19, 2026". | this file |
| 117 | `reportFormNumber()` | The report number, or (for a report somehow without one) its filing date plus the start of its id — still unique, still dated. | this file |
| 126 | `reportFormWrap()` | Splits text into lines no wider than maxWidth, keeping the text's own line breaks and breaking a single over-long word if it has to. | this file |
| 150 | `reportFormRoundRect()` | Draws a rounded-rectangle path on the canvas. | this file |
| 161 | `reportFormCheckbox()` | A checked box in the browser's accent-color style (accent = --navy). | this file |
| 187 | `reportFormDraw()` | Draws the whole form and returns the layout it ended up with: { reportingH, detailsH, height }. The cards' backgrounds need their heights before anything goes on top, so this runs twice — once to measure (layout = null), once for real with the measured layout. | this file |
| 192 | `font()` *(inside reportFormDraw)* | Builds a canvas font string from weight and size. |  |
| 193 | `setSpacing()` *(inside reportFormDraw)* | Sets letter spacing when the browser supports it. |  |
| 204 | `card()` *(inside reportFormDraw)* | Draws a white or cream card with a shadow (cream cards get a green left bar). |  |
| 224 | `label()` *(inside reportFormDraw)* | Draws a field label (and an optional grey hint); returns the y position below it. |  |
| 238 | `input()` *(inside reportFormDraw)* | A single-line input box; `icon` draws the date/time inputs' glyph. |  |
| 390 | `rowWidth()` *(inside reportFormDraw)* | Width of n thumbnails plus the gaps between them. |  |
| 448 | `reportFormBuildPdf()` | One-page PDF holding a single JPEG, scaled to the page — the smallest valid PDF there is, built by hand (DCTDecode = the JPEG bytes as-is). | this file |
| 453 | `push()` *(inside reportFormBuildPdf)* | Appends a piece of the PDF file and tracks the byte offset. |  |
| 458 | `object()` *(inside reportFormBuildPdf)* | Writes one numbered PDF object and remembers where it starts (for the cross-reference table). |  |
| 487 | `downloadReportForm()` | "Download Report": loads up to 5 attachments, draws the form twice (measure, then draw), turns the canvas into a JPEG, wraps it in a one-page PDF and downloads it as <report number>.pdf. | this file, citizen/my-report-detail.js, staff/report-detail.js |
| 500 | `render()` *(inside downloadReportForm)* | Draws the form on a canvas (scaled down for very tall reports) and turns it into a JPEG blob. |  |

#### `frontend/shared/js/streets.js`

streets.js — the barangay's streets, loaded from GET /api/site/streets/. Administrators add/remove streets on Admin > Map Boundary. Call `await ensureStreetsLoaded()` before using STREETS (a list of names), streetCoordinate() or liveStreets().

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 10 | `ensureStreetsLoaded()` | Loads the street list from /api/site/streets/ once and caches it (fills STREETS with the names). Await this before using streets. | this file, admin/create-accounts.js, admin/map-boundary.js, citizen/file-report.js, citizen/main.js, citizen/profile.js, +4 more |
| 20 | `streetCoordinate()` | A street's [lat, lng] point on the map, or null. | this file, staff/heatmap.js |
| 26 | `liveStreets()` | Every street with its point: [{id, name, latitude, longitude}, ...] | this file, admin/map-boundary.js, staff/heatmap.js |
| 33 | `wireStreetCombobox()` | Turns a text input into a street picker: typing filters the list shown under it, clicking a street fills the input. With announceChange (default), picking a street also fires the input's "input" event. | admin/create-accounts.js, citizen/file-report.js, citizen/main.js |
| 37 | `renderStreetOptions()` *(inside wireStreetCombobox)* | Shows the streets that contain the typed text under the input. |  |

### 15.4 Citizen portal (`frontend/citizen/js/`)

#### `frontend/citizen/js/about.js`

About Us (citizen): the logo strip and the Sangguniang Barangay, from GET /api/site/about/ (loaded by site-footer.js, edited on Admin > About Us Setup).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 11 | `renderAboutLogos()` | Draws the logo strip on About Us (hidden when there are no logos). | this file |
| 26 | `chunkIntoBalancedRows()` | Splits members into even rows of at most COUNCIL_MAX_PER_ROW (8 -> 4+4, 7 -> 4+3). | this file |
| 37 | `renderCouncilMember()` | HTML for one council member: photo (framed if uploaded), name and position. | this file |
| 54 | `renderCouncil()` | Draws the council in rows — chairman, members, officers — each split into even rows of at most 5. | this file |

#### `frontend/citizen/js/faqs-data.js`

faqs-data.js — loads the public FAQ list (GET /api/faqs/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 3 | `getFAQs()` | Loads the public FAQ list from /api/faqs/. | citizen/faqs.js |

#### `frontend/citizen/js/faqs.js`

FAQs page (citizen): the public FAQ list. (The "Ask a Question" button is in main.js.)

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 3 | `escapeHtml()` | Makes text safe to put inside HTML. | this file, admin/about-setup.js, admin/ordinance-authors.js, admin/ordinance-categories.js, admin/reports.js, admin/website-setup.js, +4 more |
| 9 | `renderFaqAccordion()` | Draws question/answer pairs as expandable <details> items (optionally the first one open). | this file |

#### `frontend/citizen/js/file-report.js`

File a Report (citizen). Fills the ordinance dropdown, suggests ordinances from the description, asks for the email code when needed, and submits the report with POST /api/reports/.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 47 | `showVerifyError()` *(inside page-load handler)* | Shows an error message inside the "Verify it's you" popup. |  |
| 52 | `openVerifyModal()` *(inside page-load handler)* | Opens the "Verify it's you" popup at its first step (Send Code). |  |
| 61 | `applyGateStatus()` *(inside page-load handler)* | Applies the server's answer: during a cooldown the Submit button is disabled and a popup shows the minutes left (once per visit); if a code is needed, a notice with a Verify button is shown; otherwise Submit is enabled. |  |
| 84 | `refreshGateStatus()` *(inside page-load handler)* | Asks /api/reports/verification-status/ and calls applyGateStatus() (errors are ignored — the server checks again on submit). |  |
| 95 | `sendVerificationCode()` *(inside page-load handler)* | Asks the server to email a 6-digit code, then shows the code box and Verify button. |  |
| 165 | `ordinanceLabel()` *(inside page-load handler)* | An ordinance as "number — title" (also what is saved in the report). |  |
| 187 | `selectOrdinance()` *(inside page-load handler)* | Picks an ordinance (from the dropdown or a suggestion) by setting the hidden <select>; its "change" listener updates the rest of the form. |  |
| 192 | `openOrdinanceList()` *(inside page-load handler)* | Opens the ordinance dropdown list. |  |
| 196 | `closeOrdinanceList()` *(inside page-load handler)* | Closes the ordinance dropdown list. |  |
| 235 | `debounce()` *(inside page-load handler)* | ---- Nature of Violation: TF-IDF ordinance suggestions (GET /api/ordinances/suggest/) ---- |  |
| 247 | `renderSuggestions()` *(inside page-load handler)* | Shows the suggested ordinances under Nature of Violation (hidden when there are none). |  |
| 297 | `setGeoStatus()` *(inside page-load handler)* | Shows a short message about the device location (green when the location is pinned). |  |
| 303 | `requestGeo()` *(inside page-load handler)* | Asks the browser for the device location once (10-second limit). Resolves with {lat, lng} or null; the report then uses the street's point instead. |  |

#### `frontend/citizen/js/home.js`

Home page (citizen): News and Announcements (full text in a popup, with an "unread" mark per citizen), Latest Ordinances, and Ordinances by Category.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 4 | `escapeHtml()` | Makes text safe to put inside HTML. | this file, admin/about-setup.js, admin/ordinance-authors.js, admin/ordinance-categories.js, admin/reports.js, admin/website-setup.js, +4 more |
| 14 | `loadAnnouncements()` | Loads all announcements (with the login token if logged in, so each one says whether it was read). | this file, staff/announcements.js |
| 22 | `formatNewsDate()` | A date as "September 19, 2026". | this file |
| 30 | `tagFor()` | "Updated" if it was edited within the last 6 months, otherwise "New" if it was uploaded within the last 6 months. Ordinances older than that get no tag. | this file |
| 31 | `daysSince()` *(inside tagFor)* | Days between a date and now. |  |
| 36 | `excerpt()` | The first 180 characters of an announcement, with "…" when cut. | this file |
| 40 | `isUnread()` | True for a logged-in citizen who hasn't opened the announcement yet. | this file |
| 49 | `isMobileWidth()` | Fewer rows on phones (the page's 560px breakpoint). | this file |
| 71 | `revealItems()` | Gives elements the fade-in-on-scroll effect, each a little later than the previous one. | this file |
| 82 | `renderPaginated()` | Shows the first `perPage` cards and a "See more" button for the rest. `wire` (optional) adds the cards' click listeners after each render. | this file |
| 90 | `paint()` *(inside renderPaginated)* | Only newly shown cards animate in. |  |
| 107 | `renderNewsGrid()` | Draws the announcement cards (1 on phones, 3 otherwise, then "See more"); clicking a card opens it. | this file |
| 137 | `openAnnouncement()` | Shows one announcement in a popup and, if it was unread, marks it read on screen and on the server. | this file |
| 161 | `renderLatestOrdinances()` | Shows the newest ordinances (3 on phones, 5 otherwise) with a "New" tag, plus a "View all" link. | this file |
| 220 | `openCategoryOrdinances()` | Clicking a bar in "Ordinances by Category" opens a popup listing that category's ordinances (with a link to the filtered Ordinances page). | this file |
| 238 | `renderCategorySummary()` | Groups ordinances by category and draws a percentage bar per category; clicking a bar opens a popup listing that category's ordinances. | this file |

#### `frontend/citizen/js/legal.js`

Privacy Policy and Terms pages (citizen): shows the sections from GET /api/site/legal/<key>/. Text format (see siteinfo.models.LegalSection): blank lines separate blocks; "- " bullet, "1. " numbered item, "\| a \| b \|" table row (first row = header), **bold**, [text](url), and {{address}} / {{email}} / {{phone}} / {{name}} from the barangay's details.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 7 | `legalEscape()` | Makes text safe to put inside HTML. | this file |
| 13 | `legalInline()` | Inline formatting for legal text: **bold**, [text](url) links and {{field}} filled from the barangay's details. | this file |
| 25 | `renderLegalBody()` | Turns one section's text into HTML: blank-line-separated blocks become tables (\| a \| b \|), bullet lists (- ), numbered lists (1. ) or paragraphs. | this file |
| 52 | `renderLegalPage()` | Loads the Privacy Policy or Terms (and the barangay details), shows the effective date and draws every section with its heading. | this file |

#### `frontend/citizen/js/main.js`

main.js — the citizen portal's page frame. Loaded on every citizen page (after /shared/js/common.js).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 29 | `getNotifSnapshot()` | Reads the saved {item id: "status\|remarks"} map used to spot changes, or {}. | this file |
| 40 | `checkForUpdates()` | Loads the citizen's reports or concerns and compares each item's status/remarks with the saved snapshot; every change becomes a bell notification. Then saves the new snapshot. | this file |
| 65 | `checkForReportUpdates()` | checkForUpdates() for /api/reports/ — e.g. "Your report \"Anti-Noise\" is now Under Review.", linking to that report. | this file |
| 72 | `checkForConcernUpdates()` | checkForUpdates() for /api/concerns/ — "Your concern/suggestion is now Reviewed.", linking to it. | this file |
| 82 | `askQuestion()` | The floating "Ask a Question" button (and the FAQs page) submit through this. | this file |
| 98 | `enforcePortalAccess()` | A staff/admin session must not be used on the citizen site: log it out so the page shows the normal guest view. | this file |
| 105 | `trackNavbarHeight()` | Publishes the navbar's height as the CSS variable --navbar-height (sticky side panels use it to stop just below the navbar). | this file |
| 108 | `update()` *(inside trackNavbarHeight)* | Writes the navbar's current height into the CSS variable --navbar-height. |  |
| 114 | `goToAbout()` | Opens the About Us page (clicking the brand does this). | this file |
| 125 | `formatBytes()` | File size as "512 B", "34 KB" or "2.1 MB". | this file |
| 131 | `wireUploadBox()` | Makes a <label class="upload-drop"> file box work: shows the chosen file name, accepts drag & drop, and for multi-file evidence inputs keeps a list (max 5) with thumbnail, View link and Remove button. | this file |
| 143 | `releaseObjectUrls()` *(inside wireUploadBox)* | Frees the temporary preview URLs of the listed files. |  |
| 148 | `syncInputFiles()` *(inside wireUploadBox)* | Rebuilds the <input type=file>'s files from the kept list (so removed files aren't uploaded). |  |
| 154 | `updateLabelText()` *(inside wireUploadBox)* | Shows the file name, "N files selected" or the default text. |  |
| 159 | `renderTray()` *(inside wireUploadBox)* | Draws the list of chosen files with thumbnails, sizes, View and Remove. |  |
| 229 | `addFiles()` *(inside wireUploadBox)* | Adds newly picked/dropped files to the list, skipping duplicates and anything over 5. |  |
| 290 | `wireMobileMenu()` | Adds the ☰ button that opens the links on small screens. Above 860px, if the links no longer fit on one row, the navbar switches to the same collapsed style (.navbar--compact) instead of wrapping to a second row. | this file |
| 301 | `closeNavMenu()` *(inside wireMobileMenu)* | Closes the ☰ mobile menu. |  |
| 315 | `syncNavCompact()` *(inside wireMobileMenu)* | On wide screens, switches the navbar to the collapsed style if the links no longer fit on one row. |  |
| 333 | `addMenuLink()` | Adds an <li><a> to the mobile menu. | this file |
| 348 | `wireAccountArea()` | Logged in: the profile icon shows the user's avatar, and the mobile menu gets the brand at the top and a Logout link at the bottom. Guest: the profile icon becomes "Login" with a "Sign Up" link next to it (both also added to the mobile menu). | this file |
| 461 | `openProfileModal()` *(inside page-load handler)* | Guests go to the login page; logged-in citizens get the account popup with their name and avatar. |  |
| 512 | `poll()` *(inside page-load handler)* | Checks reports and concerns for changes and redraws the bell; runs at load and every 30 seconds. |  |

#### `frontend/citizen/js/my-concern-detail.js`

My Concern/Suggestion detail (citizen): shows the concern given by ?id=.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 24 | `formatDateTime()` *(inside page-load handler)* | Two steps: Submitted, then Reviewed (the Secretary's reply is in Remarks). |  |
| 62 | `showRemarksPopupOnce()` | Shows the remarks in a popup the first time they are seen. | this file |

#### `frontend/citizen/js/my-concerns-data.js`

my-concerns-data.js — loads the citizen's own concerns (GET /api/concerns/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 3 | `getMyConcerns()` | Loads the citizen's own concerns from /api/concerns/. | citizen/my-concerns-list.js |
| 11 | `getConcernById()` | Loads one of the citizen's concerns, or null. | citizen/my-concern-detail.js, staff/concern-detail.js |

#### `frontend/citizen/js/my-concerns-list.js`

My Concerns/Suggestions (citizen): the citizen's concerns, filtered by status and paginated.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 18 | `formatDate()` *(inside page-load handler)* | A date as "September 19, 2026". |  |
| 23 | `titleFor()` *(inside page-load handler)* | A concern has no title, so the row shows the start of its description. |  |
| 30 | `getFiltered()` *(inside page-load handler)* | Order: Submitted, then Reviewed; newest first within each status. |  |
| 44 | `render()` *(inside page-load handler)* | Draws the current page of concerns (status filter + page size) and the page buttons; remembers the page. |  |

#### `frontend/citizen/js/my-report-detail.js`

My Report detail (citizen): shows the report given by ?id=.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 14 | `formatTime12h()` | "21:30" → "9:30 PM", or "Not specified". | this file |
| 22 | `formatDateTime()` | A date and time as "September 19, 2026, 9:30 PM". | this file, citizen/my-concern-detail.js |

#### `frontend/citizen/js/my-reports-data.js`

my-reports-data.js — loads the citizen's own reports (GET /api/reports/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 3 | `getMyReports()` | Loads the citizen's own reports from /api/reports/. | citizen/my-reports-list.js |
| 11 | `getReportById()` | Loads one of the citizen's reports, or null. | citizen/my-report-detail.js, staff/report-detail.js |

#### `frontend/citizen/js/my-reports-list.js`

My Reports (citizen): the citizen's reports, filtered by status and paginated.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 26 | `formatDate()` *(inside page-load handler)* | A date as "September 19, 2026". |  |
| 30 | `daysOld()` *(inside page-load handler)* | "N days old" since the report was filed. |  |
| 42 | `getFiltered()` *(inside page-load handler)* | The reports matching the status filter, ordered Submitted → Under Review → In Action → closed, newest first within each. |  |
| 56 | `render()` *(inside page-load handler)* | Draws the current page of reports with their status badges and the page buttons; remembers the page. |  |

#### `frontend/citizen/js/ordinances-data.js`

ordinances-data.js (citizen) — loads the published ordinances from GET /api/ordinances/ (no login needed) and keeps them in memory.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 6 | `mapOrdinance()` | Turns the API's ordinance into the shape the pages use (formatted date, sortable number and date, pdf link). | this file |
| 29 | `ensureOrdinancesLoaded()` | Loads the published ordinances once and keeps them in memory. | citizen/file-report.js, citizen/ordinance-detail.js, citizen/ordinances-list.js, staff/geo-analysis-page.js, staff/ordinance-detail.js, +6 more |
| 38 | `liveOrdinances()` | The loaded ordinances (empty list before loading). | citizen/file-report.js, citizen/ordinances-list.js, staff/geo-analysis-page.js, staff/ordinances-list.js, staff/reports-dashboard.js, +2 more |
| 42 | `getOrdinanceById()` | One loaded ordinance by id, or null. | citizen/ordinance-detail.js, staff/ordinance-detail.js |

#### `frontend/citizen/js/ordinances-list.js`

Ordinances page (citizen): search, filter, sort and page through the ordinances.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 33 | `placeholderExamples()` *(inside page-load handler)* | Example words for the search box hint, taken from the loaded ordinances for the selected field. |  |
| 44 | `updateSearchPlaceholder()` *(inside page-load handler)* | Puts "e.g. …" examples in the search box for the selected field. |  |
| 71 | `getFiltered()` *(inside page-load handler)* | The ordinances matching the category (from ?category=), the applied search and the sort order. |  |
| 85 | `emptyMessage()` *(inside page-load handler)* | "No ordinances match your search." or "No ordinances have been posted yet." |  |
| 89 | `escapeHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 95 | `render()` *(inside page-load handler)* | Draws the current page of the table (rows open the detail page), the "Showing X to Y of Z" line and the page buttons. |  |
| 118 | `goToDetail()` *(inside render)* | Opens ordinance-detail.html for the clicked row. |  |

#### `frontend/citizen/js/profile.js`

My Profile (citizen): two tabs — Edit Account Information and Change Password — plus Delete Account. Saves with PATCH /api/auth/me/ and POST /api/auth/change-password/.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 20 | `splitAddress()` *(inside page-load handler)* | The address is saved as "Block, Lot, Street" (same as sign-up). The hidden addressInput holds that combined value; the two visible fields feed it. |  |
| 32 | `syncAddress()` *(inside page-load handler)* | Joins Block/Lot and Street into the hidden address field ("Block/Lot, Street"). |  |
| 39 | `initialsFor()` *(inside page-load handler)* | First letters of first and last name, e.g. "JD". |  |
| 50 | `populate()` *(inside page-load handler)* | Fills the form and the avatar from a user object: first from the saved session (instant), then again with the server's latest data. |  |
| 111 | `isEditDirty()` *(inside page-load handler)* | True if anything in Edit Account Information differs from the last saved values (or a new picture is chosen). |  |
| 124 | `isPasswordDirty()` *(inside page-load handler)* | True if any password field has text. |  |
| 128 | `isDirty()` *(inside page-load handler)* | True if either tab has unsaved changes. |  |
| 165 | `switchToTab()` *(inside page-load handler)* | Shows the Edit Information or Change Password tab. |  |
| 188 | `onUpdatedConfirm()` *(inside page-load handler)* | What happens when the "Changed!" popup's button is pressed (set by each save). |  |
| 198 | `openVerifyCodeModal()` *(inside page-load handler)* | ---- Code check for email / mobile / address changes ---- The server emails a code to the current email address; the user types it into this popup and it is sent along with the save (the server checks it). |  |
| 208 | `cleanup()` *(inside openVerifyCodeModal)* | Closes the code popup, removes its listeners and resolves with the code (or null). |  |
| 214 | `onSubmit()` *(inside openVerifyCodeModal)* | Accepts the typed code. |  |
| 219 | `onCancel()` *(inside openVerifyCodeModal)* | Cancels (resolves null). |  |
| 227 | `promptForVerificationCode()` *(inside page-load handler)* | Asks the server to email a profile-edit code, then opens the popup to type it. Resolves with the code or null. |  |
| 237 | `commitEditSave()` *(inside page-load handler)* | Saves Edit Account Information. Returns true on success. |  |
| 339 | `commitPasswordSave()` *(inside page-load handler)* | Change Password: checks the two new passwords match and follow the rules, then POSTs /api/auth/change-password/. Returns true on success. |  |

#### `frontend/citizen/js/site-footer.js`

site-footer.js — builds the citizen site footer and loads the barangay's details from GET /api/site/about/ (edited on Admin > About Us Setup). loadSiteAbout() fetches them once per page and fills the footer and every element with data-barangay="<field>" (add data-barangay-link to make a phone/email/address clickable). Load before main.js (main.js handles the footer's data-auth-gate links).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 10 | `loadSiteAbout()` | Fetches /api/site/about/ once per page (the same promise is reused by the footer, About Us and legal pages). | this file, citizen/about.js, citizen/legal.js |
| 20 | `escapeSiteHtml()` | Makes text safe to put inside HTML (turns < > & into entities). | this file, citizen/about.js |
| 26 | `barangayLinks()` | Builds the tel:, mailto: and Google Maps links for the barangay's phone, email and address. | this file |
| 35 | `fillBarangayFields()` | Fills every element with data-barangay="<field>" with that detail (as a link if data-barangay-link is set); hides lines whose value is empty. | this file |
| 78 | `footerLinksHtml()` | HTML for a footer link list; File a Report / Submit a Suggestion links get the login prompt for guests (data-auth-gate). | this file |
| 88 | `renderFooterLists()` | The footer link lists set by the Administrator; an empty list means "use the defaults". | this file |

### 15.5 Staff portal (`frontend/staff/js/`)

#### `frontend/staff/js/announcements.js`

Announcements (Secretary / Barangay Captain): post, edit and delete announcements. Posting emails every citizen; editing doesn't.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 30 | `escapeHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 36 | `readError()` *(inside page-load handler)* | Throws the server's message from an error response ({detail} or the first field error), or the fallback with the status code. |  |
| 47 | `loadAnnouncements()` *(inside page-load handler)* | Loads every announcement from /api/announcements/staff/. |  |
| 53 | `render()` *(inside page-load handler)* | Draws the announcement list (picture, title, date, poster, "(edited)"); Edit/Delete buttons only for the Secretary and Barangay Captain. |  |
| 124 | `clearPickedFile()` *(inside page-load handler)* | Clears the chosen picture and hides its preview. |  |
| 133 | `showPickedFile()` *(inside page-load handler)* | Shows a preview, name and size of the newly chosen picture. |  |
| 144 | `showExistingImage()` *(inside page-load handler)* | Editing: shows the current picture like a newly picked one. |  |
| 163 | `hasUnsavedAnnouncement()` *(inside page-load handler)* | True if the form has text or a picture that hasn't been saved (compared with the original when editing). |  |
| 175 | `requestCloseForm()` *(inside page-load handler)* | Closes the form, or first asks "leave without saving?" when there are unsaved changes. |  |
| 200 | `openForm()` *(inside page-load handler)* | Opens the form: filled in to edit `announcement`, or empty for a new one. |  |
| 208 | `formatDate()` *(inside openForm)* | A date as "September 19, 2026". |  |

#### `frontend/staff/js/concern-detail.js`

Concern/Suggestion detail (staff): the Secretary adds remarks and files it in a folder (PATCH /api/concerns/staff/<id>/). The server marks it Reviewed.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 71 | `applyPill()` *(inside page-load handler)* | Shows the status pill (Submitted / Reviewed); the Secretary also sees the "becomes Reviewed automatically" hint while Submitted. |  |
| 91 | `renderFolderAssignment()` *(inside page-load handler)* | Shows the assigned folder chip (with Remove for the Secretary), or the Assign button. |  |
| 105 | `populateFolderSelect()` *(inside page-load handler)* | Fills the folder dropdown in the Assign popup. |  |
| 165 | `isDirty()` *(inside page-load handler)* | True if the remarks differ from the last saved remarks. |  |
| 169 | `commitSave()` *(inside page-load handler)* | Saves the remarks (PATCH via updateConcernStatus) and updates the status pill. Returns true on success. |  |
| 197 | `goToConcerns()` *(inside page-load handler)* | "Back" returns to the page this was opened from (or Concerns/Suggestions). |  |

#### `frontend/staff/js/concerns-dashboard.js`

Concerns/Suggestions Dashboard (Barangay Captain, read-only): what residents are raising, whether it's being answered, and what needs follow-up, for the selected period. "Topic" = the folder the Secretary filed a concern under.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 23 | `escapeHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 29 | `plural()` *(inside page-load handler)* | "1 day" / "3 days" style text. |  |
| 44 | `periodMeta()` *(inside page-load handler)* | The words used for a period, e.g. {noun: "this month", previous: "last month"} (no previous for All Time). |  |
| 54 | `monthBuckets()` *(inside page-load handler)* | One chart step per month starting from a given month (with short and long labels). |  |
| 66 | `periodRanges()` *(inside page-load handler)* | For the chosen period: its start/end, the previous period's start/end, and the chart steps (days for a month, months for a year, months or years for All Time). |  |
| 122 | `within()` *(inside page-load handler)* | True if a date is between start and end. |  |
| 139 | `renderPeriodMenu()` *(inside page-load handler)* | Draws the period menu; choosing a period saves it and redraws the dashboard. |  |
| 158 | `formatDuration()` *(inside page-load handler)* | "Under 1 hour", "N hours" or "N days". |  |
| 165 | `median()` *(inside page-load handler)* | The middle value of a list of numbers (null for an empty list). |  |
| 173 | `deltaText()` *(inside page-load handler)* | "▲ 6 vs last month" — plain text plus an arrow, never colour alone. |  |
| 180 | `renderKpis()` *(inside page-load handler)* | Fills the four headline cards: received this period (with change), waiting for review now (with the oldest's age), reviewed this period (with %), and the typical (median) review time. |  |
| 212 | `renderBars()` *(inside page-load handler)* | Draws a list of horizontal bars (name, bar, count, change), or the empty message. |  |
| 231 | `countBy()` *(inside page-load handler)* | Counts concerns by a key (e.g. folder name); items without a key are skipped. |  |
| 240 | `topicDelta()` *(inside page-load handler)* | "▲ 2" / "▼ 1" change text, or "" when unchanged. |  |
| 246 | `renderTopics()` *(inside page-load handler)* | Top topics (folders) this period with their change from the previous period, plus "No topic yet". Returns the counts for renderAttention(). |  |
| 273 | `streetOf()` *(inside page-load handler)* | Location is optional free text on a concern; when it follows the "Block X, Lot Y, <Street>" pattern the street is the last part. |  |
| 280 | `renderStreets()` *(inside page-load handler)* | Top streets this period (taken from the end of each concern's location text). |  |
| 301 | `renderAttention()` *(inside page-load handler)* | "Needs attention" list: concerns waiting more than 7 days (with a link to the oldest), a topic that at least doubled, and concerns without a topic — or "Nothing needs following up". |  |
| 364 | `renderTrend()` *(inside page-load handler)* | Draws the received and reviewed lines over the period (SVG sized to the card) with end labels and a hover/touch tooltip. |  |
| 392 | `x()` *(inside renderTrend)* | The x position of step i. |  |
| 393 | `y()` *(inside renderTrend)* | The y position of a count. |  |
| 394 | `path()` *(inside renderTrend)* | The SVG path for one line (received or reviewed). |  |
| 449 | `show()` *(inside renderTrend)* | Moves the hover line/dots to the nearest step and shows its tooltip. |  |
| 471 | `hide()` *(inside renderTrend)* | Hides the hover line and tooltip. |  |
| 496 | `renderLatest()` *(inside page-load handler)* | The latest concerns table (Submitted first, newest first) with topic, summary, status and a View Details link. |  |
| 521 | `renderAll()` *(inside page-load handler)* | Works out the period's numbers once and redraws every part of the dashboard. |  |

#### `frontend/staff/js/concerns-data.js`

concerns-data.js (staff) — loads every concern/suggestion (GET /api/concerns/staff/) and the folders they can be filed under (/api/concerns/folders/), and saves remarks / folder changes.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 20 | `sortConcernsByStatusThenDate()` | Orders concerns Submitted before Reviewed, newest first within each. | this file, staff/concerns-dashboard.js |
| 31 | `escapeConcernHtml()` | Makes text safe to put inside HTML (& < > " '). | staff/concerns-list.js |
| 35 | `mapConcern()` | Turns the API's concern into the shape the staff pages use (status label, folder id/name, Date objects). | this file |
| 53 | `ensureConcernsLoaded()` | Loads every concern from /api/concerns/staff/ once per page and keeps them sorted. | staff/concern-detail.js, staff/concerns-dashboard.js, staff/concerns-list.js, staff/secretary-dashboard.js |
| 62 | `liveConcerns()` | The loaded concerns (empty list before loading). | staff/concerns-dashboard.js, staff/concerns-list.js, staff/secretary-dashboard.js |
| 66 | `getConcernById()` | One loaded concern by id, or null. | citizen/my-concern-detail.js, staff/concern-detail.js |
| 70 | `refreshConcernInCache()` | Reloads one concern from the server into the cache (after a save). | this file |
| 83 | `updateConcernStatus()` | patch: { status?: <display label>, remarks?: <string>, folderId?: <uuid\|null> } | this file, staff/concern-detail.js |
| 104 | `mapFolder()` | A folder as {id, name, count}. | this file |
| 108 | `ensureFoldersLoaded()` | Loads the folder list once. | this file, staff/concern-detail.js, staff/concerns-dashboard.js, staff/concerns-list.js, staff/secretary-dashboard.js |
| 117 | `liveFolders()` | The loaded folders. | staff/concern-detail.js, staff/concerns-list.js, staff/secretary-dashboard.js |
| 121 | `refreshFolders()` | Forgets the cached folders and loads them again (counts change after moves). | this file |
| 126 | `throwFirstError()` | Reads an error response and throws its first field message (or the fallback). | this file |
| 132 | `createFolder()` | POSTs a new folder, then reloads the folder list. | staff/concern-detail.js, staff/concerns-list.js |
| 142 | `renameFolder()` | PATCHes a folder's name, then reloads the folder list. | staff/concerns-list.js |
| 152 | `deleteFolder()` | DELETEs a folder, reloads the list, and marks its concerns as having no folder in the cache. | staff/concerns-list.js |
| 169 | `assignConcernFolder()` | Moves a concern into a folder (or none) and reloads the folder counts. | staff/concern-detail.js |
| 177 | `formatConcernDate()` | A date as "September 19, 2026". | staff/concern-detail.js, staff/concerns-dashboard.js, staff/concerns-list.js |
| 181 | `endOfDay()` | The same date at 23:59:59.999. | staff/concerns-dashboard.js, staff/reports-dashboard.js |
| 187 | `getMonthRange()` | First and last day of the month `monthsBack` months ago. | staff/concerns-dashboard.js, staff/reports-dashboard.js |
| 195 | `getYearRange()` | yearsBack counts back from the current year (0 = this year). | staff/concerns-dashboard.js, staff/reports-dashboard.js |

#### `frontend/staff/js/concerns-list.js`

Concerns/Suggestions list (staff): search, filter by status or folder, page through the list, and (Secretary) create / rename / delete folders.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 66 | `truncate()` *(inside page-load handler)* | Cuts text to a maximum length with "…". |  |
| 72 | `renderFolders()` *(inside page-load handler)* | Draws the folder sidebar with counts (rename/delete icons for the Secretary); clicking a folder filters the list. |  |
| 120 | `openCreateModal()` *(inside page-load handler)* | Opens the folder-name popup to create a folder. |  |
| 129 | `openRenameModal()` *(inside page-load handler)* | Opens the folder-name popup filled with a folder's name to rename it. |  |
| 177 | `openDeleteModal()` *(inside page-load handler)* | Opens the "delete this folder?" popup. |  |
| 212 | `getFiltered()` *(inside page-load handler)* | The concerns in the selected folder, matching the status filter and the search (text, location or reporter). |  |
| 231 | `render()` *(inside page-load handler)* | Draws the current page of concerns and the page buttons; remembers the page. |  |

#### `frontend/staff/js/geo-analysis-page.js`

Geospatial Analysis page (Barangay Captain): the large heatmap beside the analysis panel (geo-analysis.js). The period is kept in the address (?period=month0 or ?from=YYYY-MM-DD&to=YYYY-MM-DD).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 60 | `update()` *(inside page-load handler)* | Gives the analysis panel the period's reports, the previous period's reports and the registered-citizen count. |  |
| 69 | `setPeriod()` *(inside page-load handler)* | Changes the period, puts it in the address bar and redraws. |  |
| 77 | `toDateInputValue()` *(inside page-load handler)* | A date as "YYYY-MM-DD" in local time. |  |

#### `frontend/staff/js/geo-analysis.js`

geo-analysis.js — the figures shown beside the incident heatmap: for the selected period, which streets and ordinances have the most reports, how many were resolved and how many citizens reported — each as a count and a percentage. ("Resolved" = reached Resolved or With Remarks.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 15 | `geoEscape()` | Quotes too, not just what innerHTML escapes — street and ordinance text (typed by citizens/staff) also goes into title="" and data-* attributes. | this file, staff/geo-analysis-page.js |
| 22 | `geoPct()` | One decimal at most ("33.3%", "50%"); "—" when there's nothing to divide by. | this file |
| 27 | `geoBarWidth()` | A bar's width as a whole-number percent of the total (0 when the total is 0). | this file |
| 31 | `geoPlural()` | "1 report" / "3 reports" style text. | this file |
| 37 | `geoStreetOfReport()` | The street a report is about: the known street its "Block, Lot, Street" location ends in, else the location text as typed. | this file |
| 43 | `geoCountBy()` | Counts reports by a key and returns [key, count] pairs, biggest first (ties alphabetical). | this file |
| 52 | `geoUniqueReporters()` | How many different citizens filed the given reports. | this file |
| 56 | `geoResolvedCount()` | How many of the reports are closed (Resolved or With Remarks). | this file |
| 62 | `geoBreakdownRows()` | <li> rows of "label \| bar \| 12.5% (3)". With clickAttr (a data-* name) each row is a button carrying its name in that attribute. | this file |
| 82 | `createGeoAnalysis()` | The full analysis panel in `el`. opts.categories every ordinance category (categories without reports show 0%) opts.onChange({ reports, street }) called when the category filter or the selected street changes: what the map should show and which street to circle. | this file, staff/geo-analysis-page.js |
| 89 | `filteredReports()` *(inside createGeoAnalysis)* | The period's reports, limited to the selected category if one is chosen. |  |
| 93 | `tile()` *(inside createGeoAnalysis)* | HTML for one figure tile: label, big value, small note. |  |
| 102 | `summaryHtml()` *(inside createGeoAnalysis)* | The four top tiles: reports filed (with change or category share), citizens who reported (% of registered), resolved and still open. |  |
| 137 | `findingsHtml()` *(inside createGeoAnalysis)* | Labelled figures read straight off the numbers below. |  |
| 141 | `finding()` *(inside findingsHtml)* | Adds one "Label: value" line to the key findings. |  |
| 142 | `share()` *(inside findingsHtml)* | "N of M reports (x%)". |  |
| 143 | `named()` *(inside findingsHtml)* | A bold name with its count and percent. |  |
| 179 | `streetProfileHtml()` *(inside createGeoAnalysis)* | When a street is selected: its tiles, and its ordinances, categories and statuses as % bars. |  |
| 209 | `streetsTableHtml()` *(inside createGeoAnalysis)* | The "Streets ranked" table (sortable by street, reports or resolved rate) with each street's top ordinance; clicking a row selects the street. |  |
| 220 | `header()` *(inside streetsTableHtml)* | A sortable column header button. |  |
| 254 | `categoriesHtml()` *(inside createGeoAnalysis)* | Every category's share of the period's reports; clicking one filters the map and figures. |  |
| 271 | `ordinancesHtml()` *(inside createGeoAnalysis)* | The ordinances' shares (first 6, with "Show all"). |  |
| 285 | `paint()` *(inside createGeoAnalysis)* | Redraws the whole panel and tells the map what to show (onChange). |  |
| 304 | `activate()` *(inside createGeoAnalysis)* | Handles a click/Enter on the panel: sort, select street, filter category, clear, or show all ordinances. |  |
| 342 | `renderGeoSummary()` | The short summary beside the heatmap on the Reports Dashboard. | this file, staff/reports-dashboard.js, staff/reports-dashboard.html |

#### `frontend/staff/js/heatmap.js`

heatmap.js — the incident heatmap on the staff dashboards (Leaflet map + heat layer; hotter = more reports). A report filed with the device's location is drawn there; otherwise at its street's point (streets.js). Load after /shared/vendor/leaflet/leaflet.js, leaflet-heat.js and /shared/js/streets.js.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 38 | `countByLocation()` | Groups items by place: { key: { count, label, street, ordinances: {name: n} } }. The key is the street name, or "@lat,lng" for a device position (rounded to ~1 m). | this file, staff/geo-analysis-page.js, staff/reports-dashboard.js |
| 59 | `streetOf()` | The known street a "Block X, Lot Y, <Street>" location ends in, or null. Call ensureStreetsLoaded() first. | this file, staff/concerns-dashboard.js, staff/geo-analysis.js |
| 65 | `escapeHeatmapHtml()` | Makes text safe to put inside HTML. | this file |
| 74 | `heatmapTooltipHtml()` | Tooltip for a map spot: the place and its report count; on the large map also the ordinances cited there (up to 8). | this file |
| 97 | `resolveStreetCoord()` | [lat, lng] for a group key: the "@lat,lng" itself, or the point of the street the location ends with. null if unknown. | this file |
| 109 | `loadBarangayBoundary()` | Loads the barangay outline from /api/site/boundary/ once per page ([] if none). | this file |
| 132 | `createIncidentHeatmap()` | Creates a heatmap in `el` (a .heatmap-canvas div). Returns { map, render(groups), invalidate(), fit(), highlight(key) }. opts.interactive true = drag/zoom allowed (the large map); false = static card opts.onSelect(key, group) called when a spot is clicked | staff/geo-analysis-page.js, staff/reports-dashboard.js |
| 175 | `setOverlay()` *(inside createIncidentHeatmap)* | Shows a message over the map (e.g. "No incidents in this period"), or removes it. |  |
| 194 | `render()` *(inside createIncidentHeatmap)* | Draws `groups` (see countByLocation; a plain number per key also works). Returns the keys whose place is unknown. |  |
| 266 | `fit()` *(inside createIncidentHeatmap)* | Frames the view (the large map must be visible when this is called). |  |
| 281 | `invalidate()` *(inside createIncidentHeatmap)* | Tells Leaflet the map's size changed. |  |
| 287 | `highlight()` *(inside createIncidentHeatmap)* | Draws a dashed ring around a street's spot and zooms to it (null removes the ring). |  |

#### `frontend/staff/js/investigator-dashboard.js`

Investigator Dashboard: the logged-in Investigator's own claimed reports, plus how many reports are still unclaimed (no date filter).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 20 | `statusPillClass()` *(inside page-load handler)* | The CSS class for a status pill. |  |
| 25 | `agingPillClass()` *(inside page-load handler)* | Report Timeline age coloring: 0-5 days green, 6-10 yellow, 11-15 orange, 16+ red. |  |
| 32 | `daysBetween()` *(inside page-load handler)* | Whole days between two dates (never negative). |  |
| 37 | `myReports()` *(inside page-load handler)* | The reports claimed by the logged-in Investigator. |  |
| 38 | `unclaimedReports()` *(inside page-load handler)* | Open reports nobody has claimed yet. |  |
| 42 | `renderStats()` *(inside page-load handler)* | Fills the cards: my active cases, my closed cases, unclaimed reports, and the age of my oldest open case. |  |
| 68 | `renderStatusChart()` *(inside page-load handler)* | Bar chart of my claimed reports per status. |  |
| 96 | `renderAgingList()` *(inside page-load handler)* | My open reports, oldest first, with days open (colored), status and a link (on phones the whole row opens the report). |  |

#### `frontend/staff/js/layout.js`

layout.js — the page frame of every logged-in staff page (sidebar, top bar, profile popup, logout, notification bell). Loaded last on the page, after common.js, staff-nav.js and the page's own script.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 37 | `filenameFromResponse()` | The file name the server gave a download (Content-Disposition header). | staff/reports-dashboard.js |
| 48 | `staffNotifKey()` | Makes a localStorage key that ends with the user's id, so people sharing a browser keep separate notifications. | this file |
| 59 | `getSeenIds()` | The ids already seen, or null the very first time (then nothing is notified, so a new staff member isn't flooded with every existing item). | this file |
| 68 | `setSeenIds()` | Saves the ids already notified about (at most 200). | this file |
| 74 | `notifyNewItems()` | Fetches `url` and adds a notification for every item not seen before. Returns how many new items there were. | this file |
| 97 | `checkForNewReports()` | Notifies about reports not seen before: "New report submitted by <name>: <ordinance>", linking to the report. | this file |
| 104 | `checkForNewConcerns()` | Notifies about concerns not seen before, linking to the concern. | this file |
| 115 | `wireSidebar()` | Sidebar ☰ button. On small screens (≤900px) the sidebar slides in over the page with a dark backdrop; on large screens it just hides/shows. | this file |
| 124 | `isSmallScreen()` *(inside wireSidebar)* | True at 900 px wide or less. |  |
| 126 | `closeSidebar()` *(inside wireSidebar)* | Closes the slide-in sidebar and its dark backdrop. |  |
| 237 | `poll()` *(inside page-load handler)* | Checks for new reports/concerns (only the sections this position can open), redraws the bell and opens it when something is new. Runs at load and every 30 seconds. |  |

#### `frontend/staff/js/ordinance-detail.js`

Ordinance detail (staff): shows an ordinance; the Secretary/Administrator can edit it and replace the PDF (PATCH /api/ordinances/<id>/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 31 | `renderDisplay()` *(inside page-load handler)* | Shows the ordinance: number, author, date, title, category, uploader, description paragraphs, the PDF preview and the Download button. |  |
| 117 | `snapshotForm()` *(inside page-load handler)* | The edit form's current values (used to detect unsaved changes). |  |
| 129 | `isDirty()` *(inside page-load handler)* | True while editing if any field differs from when Edit was opened. |  |
| 135 | `enterEditMode()` *(inside page-load handler)* | Fills the edit form from the ordinance and swaps the display for the form. |  |
| 156 | `exitEditMode()` *(inside page-load handler)* | Hides the form and shows the ordinance again. |  |
| 172 | `commitSave()` *(inside page-load handler)* | Saves the edit. Returns true on success. |  |

#### `frontend/staff/js/ordinances-data.js`

ordinances-data.js (staff) — loads all ordinances (archived ones too) and uploads and edits them. Changing ordinances needs the Secretary or an Administrator (checked by the server).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 8 | `isDocumentManager()` | Secretary or Administrator (the server checks this too; here it only decides which buttons show). | staff/ordinance-detail.js, staff/ordinances-list.js, staff/upload-ordinance.js |
| 20 | `isAcceptableOrdinancePdf()` | True for a non-empty PDF no bigger than MAX_ORDINANCE_PDF_MB. | staff/ordinance-detail.js, staff/upload-ordinance.js |
| 28 | `throwOrdinanceSaveError()` | Turns a failed upload/edit answer into one of the two messages above (messages about a typed field, e.g. "Select a category from the list.", are kept). | this file |
| 41 | `ordinanceSaveFetch()` | authFetch that shows the general message instead of "Failed to fetch". | this file |
| 49 | `mapOrdinance()` | Turns the API's ordinance into the shape the staff pages use (formatted date, sortable number/date, uploader, archived flag). | this file |
| 75 | `applyOrdinanceUpdate()` | Replaces one ordinance in the cache. | this file |
| 84 | `ensureOrdinancesLoaded()` | Sent with the login token so staff also get archived ordinances. | citizen/file-report.js, citizen/ordinance-detail.js, citizen/ordinances-list.js, staff/geo-analysis-page.js, staff/ordinance-detail.js, +6 more |
| 93 | `liveOrdinances()` | The loaded ordinances (empty list before loading). | citizen/file-report.js, citizen/ordinances-list.js, staff/geo-analysis-page.js, staff/ordinances-list.js, staff/reports-dashboard.js, +2 more |
| 97 | `getOrdinanceById()` | One loaded ordinance by id, or null. | citizen/ordinance-detail.js, staff/ordinance-detail.js |
| 101 | `refreshOrdinanceInCache()` | Reloads one ordinance from the server into the cache. | this file |
| 109 | `fetchOrdinanceAuthors()` | The author list (suggestions for the Author field; any name is still allowed). includeInactive (Administrators only) also returns officials whose term ended. | staff/ordinance-detail.js, staff/upload-ordinance.js |
| 117 | `fetchOrdinanceCategories()` | The active category names (the Category field must be one of these). | staff/ordinance-detail.js, staff/upload-ordinance.js |
| 124 | `populateAuthorDatalist()` | Puts the author names into a <datalist> (suggestions for a text input). | staff/ordinance-detail.js |
| 135 | `populateCategorySelect()` | Fills a <select> with the categories, keeping the current choice if still valid. | staff/ordinance-detail.js, staff/upload-ordinance.js |
| 157 | `createOrdinance()` | fields: { number, title, author, category, dateApproved (YYYY-MM-DD), description, pdfFile } | this file, staff/upload-ordinance.js |
| 175 | `updateOrdinanceById()` | Same field shape as createOrdinance, but pdfFile is optional — omit it to keep the existing PDF. | staff/ordinance-detail.js |

#### `frontend/staff/js/ordinances-list.js`

Ordinances list (staff): search and page through ordinances; the Secretary/Administrator also gets the Upload button.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 34 | `placeholderExamples()` *(inside page-load handler)* | Example words for the search box hint, taken from the loaded ordinances for the selected field. |  |
| 45 | `updateSearchPlaceholder()` *(inside page-load handler)* | Puts "e.g. …" examples in the search box. |  |
| 64 | `getFiltered()` *(inside page-load handler)* | The ordinances (archived ones included for staff) matching the applied search and sort. |  |
| 77 | `emptyMessage()` *(inside page-load handler)* | "No ordinances match your search." or "No ordinances uploaded yet." |  |
| 81 | `escapeHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 87 | `render()` *(inside page-load handler)* | Draws the current page of the table (rows open the detail page), the entry count line and the page buttons. |  |
| 110 | `goToDetail()` *(inside render)* | Opens ordinance-detail.html for the clicked row. |  |

#### `frontend/staff/js/questions-data.js`

questions-data.js (staff) — loads citizens' questions (GET /api/questions/staff/) and saves answers.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 3 | `getQuestions()` | Loads every citizen question from /api/questions/staff/. | admin/questions-list.js, staff/questions-list.js, staff/secretary-dashboard.js |
| 9 | `answerQuestion()` | PATCHes the answer for one question; throws the server's message on failure. | admin/questions-list.js, staff/questions-list.js |

#### `frontend/staff/js/questions-list.js`

Answer Questions (staff): citizens' questions with a reply box. Answered questions stay in the list, shown with their answer.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 4 | `escapeHtml()` | Makes text safe to put inside HTML. | this file, admin/about-setup.js, admin/ordinance-authors.js, admin/ordinance-categories.js, admin/reports.js, admin/website-setup.js, +4 more |
| 10 | `formatQuestionDate()` | A date and time for a question (e.g. "September 19, 2026, 9:30 PM"). | this file |
| 31 | `getFiltered()` *(inside page-load handler)* | The questions matching the filter: all, pending (unanswered) or answered. |  |
| 40 | `render()` *(inside page-load handler)* | Draws the current page of questions with a reply box on unanswered ones and the answer on answered ones; Send saves the answer. |  |

#### `frontend/staff/js/report-detail.js`

Report detail (staff): shows a report. The Investigator who claimed it can change its status and remarks (PATCH /api/reports/staff/<id>/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 4 | `formatTime12h()` | "21:30:00" → "9:30 PM", or "Not specified". | this file |
| 72 | `renderClaim()` *(inside page-load handler)* | Editing is only for the Investigator who claimed this report (the server checks this too). Runs again after claiming. |  |
| 148 | `applyPill()` *(inside page-load handler)* | Shows the status pill in the status's color. |  |
| 153 | `renderTimeline()` *(inside page-load handler)* | Draws the 4-step timeline (Submitted, Under Review, In Action, Resolved/With Remarks) with dates for the steps reached. |  |
| 196 | `pendingStatus()` *(inside page-load handler)* | The status chosen in the dropdown while editing, otherwise the current status. |  |
| 201 | `isDirty()` *(inside page-load handler)* | A changed status or changed remarks both count as unsaved. |  |
| 205 | `commitSave()` *(inside page-load handler)* | Saves status and remarks (updateReportStatus), then refreshes the pill and timeline (the server may move a New Submission with remarks to Under Review). Returns true on success. |  |
| 244 | `goToReports()` *(inside page-load handler)* | "Back" returns to the page this report was opened from (or Reports). |  |

#### `frontend/staff/js/reports-dashboard.js`

Reports Dashboard (Barangay Captain). The date filter at the top sets the period for the stat cards and every chart; each chart can also pick its own period until the top filter changes or Clear Filters is pressed. Charts: incident heatmap (heatmap.js + geo-analysis.js), Reports by Category (pie), Reports by Status, Investigator Performance, Reports Filed Over Time, and the Report Timeline list.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 27 | `topPeriodValue()` *(inside page-load handler)* | The top filter's period: a preset value, or {type: "custom", from, to}. |  |
| 34 | `effectivePeriod()` *(inside page-load handler)* | The period a chart uses: its own choice, or else the top filter. |  |
| 40 | `isPreset()` *(inside page-load handler)* | True if a saved value is one of this page's preset periods. |  |
| 41 | `isCustom()` *(inside page-load handler)* | True if a saved value is a complete custom date range. |  |
| 57 | `saveDashboardFilters()` *(inside page-load handler)* | Remembers the top filter and every chart's own period for this tab. |  |
| 62 | `toDateInputValue()` *(inside page-load handler)* | "YYYY-MM-DD" in local time (toISOString() would use UTC and could give the previous day). |  |
| 70 | `defaultCustomRange()` *(inside page-load handler)* | A custom range starts as "this month so far". |  |
| 75 | `labelForPeriodValue()` *(inside page-load handler)* | The text shown for a period ("This Month", or "September 1, 2026 - September 19, 2026"). |  |
| 107 | `categoryColor()` *(inside page-load handler)* | The fixed color of a category (same color on every redraw). |  |
| 111 | `formatDate()` *(inside page-load handler)* | A date as "September 19, 2026". |  |
| 116 | `buildPeriodOptions()` *(inside page-load handler)* | The preset periods offered on this page (a custom range is offered too). |  |
| 130 | `closeAllDropdowns()` *(inside page-load handler)* | Closes every dropdown menu on the page. |  |
| 154 | `computeStats()` *(inside page-load handler)* | Counts per status. (process = Under Review, remarks = In Action, to match the element ids.) |  |
| 166 | `getPreviousPeriodValue()` *(inside page-load handler)* | The period before the given one (for the "vs last month" change), or null. |  |
| 170 | `periodDeltaSuffix()` *(inside page-load handler)* | "vs last week / month / quarter / year", or "" for custom ranges and All Time. |  |
| 179 | `deltaText()` *(inside page-load handler)* | The change between two numbers as "↗ 25% vs last month" (or ↘ when down). |  |
| 187 | `setStat()` *(inside page-load handler)* | Writes one stat card's number and its change text (empty when there is no previous period). |  |
| 200 | `renderStats()` *(inside page-load handler)* | Fills the six stat cards (Total, New, Under Review, In Action, Resolved, With Remarks) for the top period, with the change from the previous period. |  |
| 221 | `setTopPeriod()` *(inside page-load handler)* | Changing the top filter clears every chart's own period. |  |
| 228 | `renderDateRangeMenu()` *(inside page-load handler)* | Builds the top period menu: a custom From/To range and the preset periods. Picking one resets every chart's own period and redraws everything. |  |
| 294 | `pieSliceData()` *(inside page-load handler)* | Counts the period's reports per category and works out each pie slice's start/end and percentage. |  |
| 310 | `pieEdgePoint()` *(inside page-load handler)* | fraction 0 is 12 o'clock, going clockwise. |  |
| 315 | `describeWedgePath()` *(inside page-load handler)* | The SVG path of one pie wedge. |  |
| 322 | `hidePieTooltip()` *(inside page-load handler)* | Hides the pie tooltip. |  |
| 326 | `showPieTooltip()` *(inside page-load handler)* | Shows category, percentage and count next to the pointer (kept inside the window). |  |
| 335 | `wireWedgeInteraction()` *(inside page-load handler)* | Shows the tooltip on hover or keyboard focus of a wedge. |  |
| 346 | `renderPieSVG()` *(inside page-load handler)* | Draws the pie (a full circle when only one category has reports) with a % label on each wedge. |  |
| 382 | `renderCategoryPie()` *(inside page-load handler)* | Draws the Reports by Category pie for its period (or the empty message). |  |
| 471 | `renderStatusChart()` *(inside page-load handler)* | Draws the Reports by Status bar chart for its period. |  |
| 501 | `renderInvestigatorChart()` *(inside page-load handler)* | Draws how many of the period's reports each Investigator has claimed. |  |
| 546 | `daysBetween()` *(inside page-load handler)* | Whole days between two dates (never negative). |  |
| 551 | `agingPillClass()` *(inside page-load handler)* | Report Timeline age coloring: 0-5 days green, 6-10 yellow, 11-15 orange, 16+ red. |  |
| 558 | `renderAgingReports()` *(inside page-load handler)* | Report Timeline: open reports, oldest first, with days open (colored green/yellow/orange/red), status, investigator and a View Details link. |  |
| 585 | `statusPillClass()` *(inside page-load handler)* | The CSS class for a status pill. |  |
| 596 | `geoAnalysisHref()` *(inside page-load handler)* | Link to the Geospatial Analysis page for the heatmap card's period. |  |
| 602 | `renderGeoSummaryCard()` *(inside page-load handler)* | Fills the summary under the heatmap card (renderGeoSummary in geo-analysis.js). |  |
| 615 | `renderHeatmapCard()` *(inside page-load handler)* | Does nothing if the map failed to load (the rest of the page still works). |  |
| 616 | `renderHeatmaps()` *(inside page-load handler)* | Redraws the heatmap card and its summary. |  |
| 621 | `setupHeatmap()` *(inside page-load handler)* | Creates the small (non-interactive) heatmap; clicking it opens Geospatial Analysis. Throws if Leaflet isn't loaded (the card then shows "Map unavailable"). |  |
| 635 | `openGeoAnalysis()` *(inside setupHeatmap)* | Opens the Geospatial Analysis page. |  |
| 673 | `periodDateRange()` *(inside page-load handler)* | First and last moment of a period value (see getReportsForPeriod). |  |
| 687 | `trendBuckets()` *(inside page-load handler)* | Splits start..end into the chart's steps: [{ start, end, label, title }]. |  |
| 690 | `short()` *(inside trendBuckets)* | Formats a date with the given toLocaleDateString options. |  |
| 728 | `renderReportsTrend()` *(inside page-load handler)* | Draws Reports Filed Over Time as an SVG line (per day, week or month depending on the period length) with a summary line and a hover/touch tooltip. |  |
| 748 | `pct()` *(inside renderReportsTrend)* | A count as a percentage of the period's total. |  |
| 761 | `x()` *(inside renderReportsTrend)* | The x position of step i. |  |
| 762 | `y()` *(inside renderReportsTrend)* | The y position of a count. |  |
| 798 | `show()` *(inside renderReportsTrend)* | Moves the hover line/dot to the nearest step and shows its tooltip. |  |
| 818 | `hide()` *(inside renderReportsTrend)* | Hides the hover line and tooltip. |  |
| 842 | `renderGraphFilterLabel()` *(inside page-load handler)* | Shows a chart's own period, or "Dashboard Default". |  |
| 847 | `renderGraphFilterMenu()` *(inside page-load handler)* | Builds a chart's own period menu (custom range, Dashboard Default, presets); picking one redraws only that chart. |  |
| 897 | `gatherDashboardSummary()` *(inside page-load handler)* | Collects what the charts currently show (stats + change, category slices, status counts, investigator counts and their periods) as the JSON sent for the PDF. |  |
| 968 | `renderAll()` *(inside page-load handler)* | Redraws the whole dashboard: filter labels and menus, stats, every chart, the heatmap and the timeline. |  |

#### `frontend/staff/js/reports-data.js`

reports-data.js (staff) — loads every report from GET /api/reports/staff/ once per page and keeps it in memory; also the date/period helpers used by the dashboards. Call `await ensureReportsLoaded()` before liveReports() / getReportById().

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 25 | `isReportClosed()` | True for "Resolved" or "With Remarks" (a closed report). | staff/geo-analysis.js, staff/investigator-dashboard.js, staff/report-detail.js, staff/reports-dashboard.js |
| 54 | `sortReportsByStatusThenDate()` | Orders reports New Submission → Under Review → In Action → closed, newest first within each. | this file, staff/reports-list.js |
| 67 | `categoryForOrdinance()` | A report keeps the ordinance text the citizen picked; its category is found by matching that text against liveOrdinances(). Call ensureOrdinancesLoaded() before ensureReportsLoaded(). | this file |
| 72 | `mapReport()` | Turns the API's report into the shape the staff pages use: status label, Date objects, category (from the matching ordinance), claim holder, report number. | this file |
| 102 | `ensureReportsLoaded()` | Loads every report from /api/reports/staff/ once per page and keeps them sorted in memory. | this file, staff/geo-analysis-page.js, staff/investigator-dashboard.js, staff/report-detail.js, staff/reports-dashboard.js, staff/reports-list.js |
| 111 | `liveReports()` | The loaded reports (empty list before loading). | this file, staff/geo-analysis-page.js, staff/investigator-dashboard.js, staff/reports-dashboard.js, staff/reports-list.js |
| 117 | `loadRegisteredCitizenCount()` | Loads (once) how many approved, active citizens there are — the base for "% of registered citizens". Null on failure. | staff/geo-analysis-page.js, staff/reports-dashboard.js |
| 127 | `getReportById()` | One loaded report by id, or null. | this file, citizen/my-report-detail.js, staff/report-detail.js |
| 132 | `refreshReportInCache()` | Reloads one report into the cache (after a save). | this file |
| 145 | `updateReportStatus()` | patch: { status?: <display label>, remarks?: <string> } | staff/report-detail.js |
| 167 | `claimReport()` | Claims a report for the logged-in Investigator. Throws the server's message (e.g. "already claimed by X"). | staff/report-detail.js, staff/reports-list.js |
| 187 | `formatReportDate()` | A date as "September 19, 2026". | this file, staff/report-detail.js, staff/reports-list.js |
| 191 | `endOfDay()` | The same date at 23:59:59.999 (so a range includes the whole last day). | this file, staff/concerns-dashboard.js, staff/reports-dashboard.js |
| 197 | `startOfWeek()` | The Monday (00:00) of the given date's week. | this file |
| 206 | `addDays()` | A new date N days later (or earlier with a negative N). | this file, staff/reports-dashboard.js |
| 214 | `getWeekRange()` | Start, end and label of the week `offset` weeks ago (0 = this week). | this file, staff/geo-analysis-page.js, staff/reports-dashboard.js |
| 220 | `getMonthRange()` | First and last day of the month `monthsBack` months ago. | this file, staff/concerns-dashboard.js, staff/reports-dashboard.js |
| 228 | `getQuarterRange()` | quartersBack counts back from the current quarter (0 = this quarter). | this file, staff/reports-dashboard.js |
| 240 | `getYearRange()` | yearsBack counts back from the current year (0 = this year). | this file, staff/concerns-dashboard.js, staff/reports-dashboard.js |
| 252 | `buildReportPeriodOptions()` | The period choices for the dashboards: This Week, the last 6 months, the last 4 quarters, the last 3 years and All Time. | this file, staff/geo-analysis-page.js |
| 274 | `previousReportPeriod()` | The period before the given one (for "vs last month" etc.), or null. | staff/geo-analysis-page.js, staff/reports-dashboard.js |
| 284 | `reportPeriodToQuery()` | A period <-> URL query string (so the Geospatial Analysis page opens on the dashboard's period). reportPeriodFromQuery returns null if unknown. | staff/geo-analysis-page.js, staff/reports-dashboard.js |
| 291 | `reportPeriodFromQuery()` | Reads the period from a URL (?period=… or ?from=…&to=…); null if it isn't valid. | this file, staff/geo-analysis-page.js |
| 293 | `isDate()` *(inside reportPeriodFromQuery)* | True for a "YYYY-MM-DD" text. |  |
| 301 | `getReportsForWeekOffset()` | The reports filed in the week `offset` weeks ago. | this file |
| 307 | `getReportsForPeriod()` | The reports filed in a period value (week/monthN/quarterN/yearN/all) or a custom {from, to} range. | this file, staff/geo-analysis-page.js, staff/reports-dashboard.js |

#### `frontend/staff/js/reports-list.js`

Reports list (staff): search, filter and page through reports. It is the Investigators' work queue: they claim unclaimed reports. The sidebar's Reports sub-pages use ?view=: Investigator Unclaimed, My Claimed, Other Claimed Barangay Captain Unclaimed, Claimed (with a filter by Investigator)

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 16 | `escapeReportHtml()` | Makes text safe to put inside HTML. | this file |
| 104 | `saveFilters()` *(inside page-load handler)* | Remembers this sub-page's filters, search, page size and page for this tab (per user and per ?view=). |  |
| 119 | `restoreFilters()` *(inside page-load handler)* | Puts back the remembered filters (only options that still exist). |  |
| 128 | `setIfOption()` *(inside restoreFilters)* | Restore a select only if the saved option still exists. |  |
| 144 | `getFiltered()` *(inside page-load handler)* | The reports matching the ordinance, investigator (Captain's Claimed view), status and search filters; open statuses first when "All". |  |
| 174 | `reportRow()` *(inside page-load handler)* | HTML for one report row: ordinance, date, View Details, status, and the claim line/button. |  |
| 190 | `renderGroup()` *(inside page-load handler)* | Fills a list with rows, or the empty message. |  |
| 196 | `wireClaimButtons()` *(inside page-load handler)* | Claim buttons: ask "Are you sure?", claim the report (claimReport) and redraw. |  |
| 212 | `paginate()` *(inside page-load handler)* | Works out the total pages and the rows of the current page. |  |
| 219 | `render()` *(inside page-load handler)* | Splits the filtered reports into unclaimed / mine / others, draws the group this sub-page shows and the page buttons, and saves the filters. |  |

#### `frontend/staff/js/secretary-dashboard.js`

Secretary Dashboard: today's workload — concerns/suggestions, ordinances and citizen questions (no date filter).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 31 | `daysBetween()` *(inside page-load handler)* | Whole days between two dates (never negative). |  |
| 40 | `folderColor()` *(inside page-load handler)* | The fixed color of a folder in the pie. |  |
| 46 | `renderStats()` *(inside page-load handler)* | Fills the cards: open concerns, reviewed concerns, unanswered questions, active (not archived) ordinances. |  |
| 56 | `countByFolder()` *(inside page-load handler)* | How many concerns are in each folder. |  |
| 65 | `renderCategoryPie()` *(inside page-load handler)* | Draws the Concerns by Folder pie with % labels and a legend of folders that have concerns. |  |
| 116 | `renderAgingList()` *(inside page-load handler)* | The oldest Submitted (not yet reviewed) concerns with how many days they have waited. |  |

#### `frontend/staff/js/staff-nav.js`

staff-nav.js — which staff position may open which page, and the two helpers every staff page calls *while it is still loading* (so the wrong sidebar links or empty name never flash on screen): hideStaffNavLinks() right after the sidebar <ul> fillStaffTopbar() right after the top bar Loaded in the <head> of every logged-in staff page, after common.js.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 28 | `hasNavEntry()` | True if the page is listed in STAFF_NAV_ACCESS (so access is checked for it). | this file, staff/layout.js |
| 33 | `allowedStaffPages()` | The pages the logged-in staff member may open. | this file, staff/layout.js, staff/staff-profile.js |
| 38 | `hideStaffNavLinks()` | Hides sidebar links (and empty sidebar groups) this user's position can't use. | this file, staff/announcements.html, staff/concerns-dashboard.html, staff/concerns.html, staff/geo-analysis.html, staff/investigator-dashboard.html, +9 more |
| 58 | `fillStaffTopbar()` | Puts the user's name and position in the top bar. | this file, staff/announcements.html, staff/concern-detail.html, staff/concerns-dashboard.html, staff/concerns.html, staff/geo-analysis.html, +12 more |

#### `frontend/staff/js/staff-profile.js`

My Profile (staff): two tabs — Edit Account Information and Change Password. Saves with PATCH /api/auth/me/ and POST /api/auth/change-password/.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 6 | `staffHomePage()` | Where Cancel and "OK" after saving go: this position's own home page (its first allowed page in STAFF_NAV_ACCESS, see staff-nav.js). | this file |
| 23 | `initialsFor()` *(inside page-load handler)* | First letters of first and last name, e.g. "JD". |  |
| 32 | `populate()` *(inside page-load handler)* | Fills the form and the avatar from a user object (first from the saved session, then from the server). |  |
| 90 | `isEditDirty()` *(inside page-load handler)* | True if anything in Edit Account Information differs from the last saved values (or a new picture is chosen). |  |
| 102 | `isPasswordDirty()` *(inside page-load handler)* | True if any password field has text. |  |
| 106 | `isDirty()` *(inside page-load handler)* | True if either tab has unsaved changes. |  |
| 143 | `switchToTab()` *(inside page-load handler)* | Shows the Edit Information or Change Password tab. |  |
| 166 | `onUpdatedConfirm()` *(inside page-load handler)* | What happens when the "Changed!" popup's button is pressed (set by each save). |  |
| 176 | `openVerifyCodeModal()` *(inside page-load handler)* | ---- Code check for email / mobile / address changes ---- The server emails a code to the current email address; the user types it into this popup and it is sent along with the save (the server checks it). |  |
| 186 | `cleanup()` *(inside openVerifyCodeModal)* | Closes the code popup, removes its listeners and resolves with the code (or null). |  |
| 192 | `onSubmit()` *(inside openVerifyCodeModal)* | Accepts the typed code. |  |
| 197 | `onCancel()` *(inside openVerifyCodeModal)* | Cancels (resolves null). |  |
| 205 | `promptForVerificationCode()` *(inside page-load handler)* | Asks the server to email a profile-edit code, then opens the popup to type it. Resolves with the code or null. |  |
| 215 | `commitEditSave()` *(inside page-load handler)* | Saves Edit Account Information. Returns true on success. |  |
| 303 | `commitPasswordSave()` *(inside page-load handler)* | Change Password: checks the new passwords match and follow the rules, then POSTs /api/auth/change-password/. Returns true on success. |  |

#### `frontend/staff/js/upload-ordinance.js`

Upload Ordinance (Secretary / Administrator only; others are sent back).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 33 | `escapeAuthorHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 39 | `renderAuthorTags()` *(inside page-load handler)* | Draws the chosen authors as removable tags. |  |
| 60 | `addAuthor()` *(inside page-load handler)* | Adds an author (duplicates, ignoring case, are skipped). |  |
| 68 | `toggleAuthor()` *(inside page-load handler)* | Adds the official to the authors, or removes them if already chosen. |  |
| 77 | `renderAuthorRoster()` *(inside page-load handler)* | Typing filters the officials list as you type. |  |
| 102 | `openAuthorPanel()` *(inside page-load handler)* | Opens the author picker (officials list + type-a-name box). |  |
| 107 | `closeAuthorPanel()` *(inside page-load handler)* | Closes the author picker. |  |

### 15.6 Admin portal (`frontend/admin/js/`)

#### `frontend/admin/js/about-setup-data.js`

about-setup-data.js — API calls for About Us Setup and Website Setup (/api/site/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 3 | `readFirstSetupError()` | Throws the server's message from an error response ({detail} or the first field error), or the fallback with the status code. | this file |
| 14 | `setupRequest()` | One helper for every /api/site/ call: sends JSON or a multipart form with the login token, throws a readable error on failure, returns the JSON (or null for 204). | this file, admin/website-setup.js |
| 29 | `getBarangayProfile()` | Loads the barangay's details (GET /api/site/profile/). | admin/about-setup.js, admin/website-setup.js |
| 33 | `saveBarangayProfile()` | Saves changed barangay details (PATCH /api/site/profile/). | admin/about-setup.js, admin/website-setup.js |
| 39 | `getBranding()` | Loads the website name and logo (GET /api/site/branding/admin/). | admin/website-setup.js |
| 43 | `saveBranding()` | Saves a new website name and/or logo (PATCH, multipart when a file is included). | admin/website-setup.js |
| 50 | `toSetupBody()` | Turns a plain object into a JSON body, or a FormData body when one of the values is a File. | this file |
| 60 | `listCouncilMembers()` | Loads every council member, hidden ones included. | admin/about-setup.js |
| 64 | `createCouncilMember()` | Adds a council member (with photo upload if given). | admin/about-setup.js |
| 68 | `updateCouncilMember()` | Edits a council member. | admin/about-setup.js |
| 76 | `deleteCouncilMember()` | Removes a council member. | admin/about-setup.js |
| 80 | `reorderCouncilMembers()` | Saves the new order of council members (list of ids). | admin/about-setup.js |
| 84 | `listAboutLogos()` | Loads every About Us logo, hidden ones included. | admin/about-setup.js |
| 88 | `createAboutLogo()` | Adds a logo (image upload). | admin/about-setup.js |
| 92 | `updateAboutLogo()` | Edits a logo. | admin/about-setup.js |
| 100 | `deleteAboutLogo()` | Removes a logo. | admin/about-setup.js |
| 104 | `reorderAboutLogos()` | Saves the new order of the logos. | admin/about-setup.js |

#### `frontend/admin/js/about-setup.js`

About Us Setup (admin): edits the citizen About Us page — barangay details (also used by the footer), council members and logos.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 12 | `escapeHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 26 | `fillProfileForm()` *(inside page-load handler)* | Fills the Barangay Details form from the saved profile. |  |
| 33 | `changedProfileFields()` *(inside page-load handler)* | Only the fields that differ from the saved profile (so only those are sent). |  |
| 46 | `isProfileDirty()` *(inside page-load handler)* | True if any barangay detail was changed but not saved. |  |
| 51 | `commitProfileSave()` *(inside page-load handler)* | Saves the barangay details. Returns true on success. |  |
| 144 | `askToDelete()` *(inside page-load handler)* | Opens the shared "Delete …?" popup; Confirm runs the given delete action. |  |
| 166 | `moveItem()` *(inside page-load handler)* | Swap an item with its neighbour inside `list`, then save the whole order. |  |
| 197 | `sortMembers()` *(inside page-load handler)* | Orders council members by row group (chairman, members, officers), then saved order, then name. |  |
| 206 | `renderMembers()` *(inside page-load handler)* | Draws the council table with photo, name/position, group and Up/Down/Edit/Hide/Delete buttons. |  |
| 239 | `openMemberModal()` *(inside page-load handler)* | Opens the Add/Edit Member popup (filled when editing). |  |
| 350 | `renderLogos()` *(inside page-load handler)* | Draws the logos table with Left/Right/Edit/Hide/Delete buttons. |  |
| 376 | `openLogoModal()` *(inside page-load handler)* | Opens the Add/Edit Logo popup (filled when editing). |  |

#### `frontend/admin/js/accounts-data.js`

accounts-data.js (admin) — API calls for Manage Accounts and Create Accounts (/api/auth/admin/...) and for releasing claimed reports.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 7 | `getAllAccounts()` | Every account (throws on failure). | admin/create-accounts.js, admin/manage-accounts.js |
| 16 | `updateAccount()` | Saves changed fields of one account. | this file, admin/manage-accounts.js |
| 30 | `resetAccountPassword()` | "Reset Password": emails a staff member a link to choose a new password. | admin/manage-accounts.js |
| 42 | `resendSetupLink()` | "Resend Setup Link": emails a new setup link (older links stop working). | admin/manage-accounts.js |
| 54 | `disableAccount()` | Disable an account; releaseClaims also releases its claimed reports. | admin/manage-accounts.js |
| 59 | `updateAccountRole()` | Change a staff account's role (same releaseClaims rule). | admin/manage-accounts.js |
| 64 | `deleteAccount()` | Used by the "Delete Account" button. | admin/manage-accounts.js |
| 75 | `createAccount()` | Create Accounts > Barangay Staff: email + role. | admin/create-accounts.js |
| 93 | `createCitizenAccount()` | Create Accounts > Barangay Citizen: all the citizen's details. Throws with err.fields so the form can mark the wrong field. | admin/create-accounts.js |
| 119 | `getClaimedReports()` | The account's unfinished claimed reports (closed ones keep their Investigator). | admin/manage-accounts.js |
| 127 | `releaseReportClaim()` | Releases an Investigator's claim on one report (POST …/forfeit/). | admin/manage-accounts.js |

#### `frontend/admin/js/activity.js`

Activity (admin): how many reports and suggestions each citizen has filed.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 7 | `escape()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 13 | `count()` *(inside page-load handler)* | One status count from a citizen's report statistics (0 if missing). |  |
| 17 | `tally()` *(inside page-load handler)* | Adds up all citizens' reports per status and their suggestions, for the totals row. |  |

#### `frontend/admin/js/admin-profile.js`

My Profile (admin): two tabs — Edit Account Information and Change Password. Saves with PATCH /api/auth/me/ and POST /api/auth/change-password/.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 16 | `initialsFor()` *(inside page-load handler)* | First letters of first and last name, e.g. "JD". |  |
| 25 | `populate()` *(inside page-load handler)* | Fills the form and the avatar from a user object (first from the saved session, then from the server). |  |
| 82 | `isEditDirty()` *(inside page-load handler)* | True if anything in Edit Account Information differs from the last saved values (or a new picture is chosen). |  |
| 94 | `isPasswordDirty()` *(inside page-load handler)* | True if any password field has text. |  |
| 98 | `isDirty()` *(inside page-load handler)* | True if either tab has unsaved changes. |  |
| 135 | `switchToTab()` *(inside page-load handler)* | Shows the Edit Information or Change Password tab. |  |
| 158 | `onUpdatedConfirm()` *(inside page-load handler)* | What happens when the "Changed!" popup's button is pressed (set by each save). |  |
| 168 | `openVerifyCodeModal()` *(inside page-load handler)* | ---- Code check for email / mobile / address changes ---- The server emails a code to the current email address; the user types it into this popup and it is sent along with the save (the server checks it). |  |
| 178 | `cleanup()` *(inside openVerifyCodeModal)* | Closes the code popup, removes its listeners and resolves with the code (or null). |  |
| 184 | `onSubmit()` *(inside openVerifyCodeModal)* | Accepts the typed code. |  |
| 189 | `onCancel()` *(inside openVerifyCodeModal)* | Cancels (resolves null). |  |
| 197 | `promptForVerificationCode()` *(inside page-load handler)* | Asks the server to email a profile-edit code, then opens the popup to type it. Resolves with the code or null. |  |
| 207 | `commitEditSave()` *(inside page-load handler)* | Saves Edit Account Information. Returns true on success. |  |
| 295 | `commitPasswordSave()` *(inside page-load handler)* | Change Password: checks the new passwords match and follow the rules, then POSTs /api/auth/change-password/. Returns true on success. |  |

#### `frontend/admin/js/approve-accounts.js`

Approve Accounts (admin): citizens waiting for approval, their voter's ID photo, and Approve / Reject (with a reason).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 18 | `loadAccounts()` *(inside page-load handler)* | Loads the pending sign-ups (with grey placeholder rows while loading) and draws them. |  |
| 28 | `render()` *(inside page-load handler)* | Draws the current page of pending sign-ups (type filter + page size) with View Photo, Approve and Reject. |  |
| 95 | `openPhotoPreview()` *(inside page-load handler)* | Shows the citizen's voter's ID photo in a popup. |  |
| 134 | `reviewActiveAccount()` *(inside page-load handler)* | Approve/Reject: calls the API, then removes the account from the list. |  |

#### `frontend/admin/js/audit-log-data.js`

audit-log-data.js — loads the audit log (GET /api/auth/admin/audit-logs/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 5 | `getAuditLogs()` | Loads the audit log from /api/auth/admin/audit-logs/. | admin/audit-logs.js |

#### `frontend/admin/js/audit-logs.js`

View Audit Logs (admin): search, sort and filter every logged action.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 27 | `loadLogs()` *(inside page-load handler)* | Loads the audit log and draws it. |  |
| 37 | `render()` *(inside page-load handler)* | Filters (account type, search over owner/action/time/type/IP), sorts (owner or time) and draws the current page of log entries. |  |
| 99 | `ensureLogDetailModal()` *(inside page-load handler)* | Creates (once) the popup that shows all of a log entry's details on phones, where some columns are hidden. |  |
| 118 | `closeModal()` *(inside ensureLogDetailModal)* | Hides the popup. |  |
| 127 | `openLogDetail()` *(inside page-load handler)* | Fills and opens the log detail popup for one entry. |  |

#### `frontend/admin/js/create-accounts.js`

Create Accounts page. "Account Type" chooses the form: Barangay Staff — just an email and a role Barangay Citizen — all the citizen's details Either way the person is emailed a one-time link to finish the account and choose their own password.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 16 | `syncFormVisibility()` *(inside page-load handler)* | Shows the Barangay Staff form or the Barangay Citizen form depending on the Account Type choice (and moves the Account Type field into the visible card). |  |

#### `frontend/admin/js/faqs-manage.js`

Manage FAQs (admin): add, edit and delete the public FAQs (API calls in questions-data.js).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 3 | `escapeHtml()` | Makes text safe to put inside HTML. | this file, admin/about-setup.js, admin/ordinance-authors.js, admin/ordinance-categories.js, admin/reports.js, admin/website-setup.js, +4 more |
| 28 | `renderFaqManageList()` *(inside page-load handler)* | Draws the FAQ list with Edit and Delete buttons. |  |
| 64 | `openFaqModal()` *(inside page-load handler)* | Opens the FAQ popup, empty to add or filled to edit. |  |

#### `frontend/admin/js/image-picker.js`

image-picker.js — choosing a picture on Admin > About Us Setup (council photos, logos) and Admin > Website Setup (site logo): checks the file against the server's upload limits and shows a preview with warnings. Load before the page's own script.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 13 | `checkPickedImage()` | Warnings for a picked image. A hard problem (wrong type, too big) also clears the pick; soft ones (small, not square) just advise. | this file |
| 39 | `wireImagePicker()` | Previews a chosen image; returns a function that clears it. `framed`: add the green ring, as About Us does for uploaded portraits. | admin/about-setup.js, admin/website-setup.js |
| 42 | `show()` *(inside wireImagePicker)* | Shows a picture in the preview (with the green ring for uploaded portraits, not for logos). |  |
| 49 | `setWarning()` *(inside wireImagePicker)* | Shows a warning, or a red error, under the picture. |  |

#### `frontend/admin/js/layout.js`

layout.js — the page frame of every admin page (sidebar, top bar, profile popup, logout, notification bell). Loaded last on the page, after common.js and the page's own script.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 26 | `accountTypeGroup()` | The account filters on admin pages only have two groups: citizens and staff (Administrators count as staff). | admin/approve-accounts.js, admin/audit-logs.js, admin/manage-accounts.js |
| 42 | `addAdminNotification()` | Other admin pages call this to add a notification (link is optional). | admin/create-accounts.js |
| 46 | `getNotifPrefs()` | Which bell notifications are switched on: new verifications (on by default) and new audit log entries (off by default). | this file |
| 54 | `setNotifPrefs()` | Saves those two on/off choices. | this file |
| 60 | `getSeenIds()` | The ids already seen, or null the first time (then nothing is notified, so switching a kind on doesn't flood the bell with every existing item). | this file |
| 69 | `setSeenIds()` | Saves the ids already notified about (at most 200). | this file |
| 74 | `checkForNewVerifications()` | Returns how many new pending accounts were found. | this file |
| 99 | `checkForNewAuditLogs()` | If switched on, notifies about new audit log entries (the newest 50): "Owner (Account type): Action — time", linking to View Audit Logs. The first check only remembers the existing entries. | this file |
| 126 | `addNotificationPrefs()` | The two checkboxes added under the bell dropdown's header. | this file |
| 162 | `wireSidebar()` | Sidebar ☰ button. On small screens (≤900px) the sidebar slides in over the page with a dark backdrop; on large screens it just hides/shows. | this file |
| 171 | `isSmallScreen()` *(inside wireSidebar)* | True at 900 px wide or less. |  |
| 173 | `closeSidebar()` *(inside wireSidebar)* | Closes the slide-in sidebar and its backdrop. |  |
| 279 | `poll()` *(inside page-load handler)* | Checks for new verifications and audit logs, redraws the bell and opens it when something is new. Runs at load and every 30 seconds. |  |

#### `frontend/admin/js/manage-accounts.js`

Manage Accounts (admin): list, sort and filter accounts; the Edit Account popup enables/disables, changes role, resends links / resets passwords, releases claimed reports and deletes accounts.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 25 | `loadAccounts()` *(inside page-load handler)* | Loads every account and draws the table. |  |
| 35 | `render()` *(inside page-load handler)* | Filters (type, status), sorts (owner, last activity, join date; active accounts first under "All") and draws the current page of accounts. |  |
| 45 | `compareBySort()` *(inside render)* | Compares two accounts by the chosen sort. |  |
| 142 | `formatStats()` *(inside page-load handler)* | e.g. "4 filed (2 Submitted, 1 Under Review, 1 Resolved)". |  |
| 161 | `populateEditModal()` *(inside page-load handler)* | Fills the Edit Account popup and sets which buttons are allowed (no disabling/deleting/re-roling yourself; Update Role only for staff; Resend Setup Link vs Reset Password). |  |
| 237 | `escapeClaimHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 243 | `renderClaimedReports()` *(inside page-load handler)* | Lists the account's active claimed reports with a Release button each (and Release All when there are 2 or more). |  |
| 263 | `loadClaimedReports()` *(inside page-load handler)* | Loads the account's active claimed reports (staff only); ignores the answer if another account was opened meanwhile. |  |
| 282 | `countClaims()` *(inside page-load handler)* | Fresh number of active claims (citizens never have any). |  |
| 299 | `askAboutClaims()` *(inside page-load handler)* | Resolves "primary", "secondary", or null (Cancel / backdrop click). |  |
| 307 | `finish()` *(inside askAboutClaims)* | Closes the popup, removes its listeners and resolves with the choice. |  |
| 315 | `onPrimary()` *(inside askAboutClaims)* | The main button was pressed. |  |
| 316 | `onSecondary()` *(inside askAboutClaims)* | The second button was pressed. |  |
| 317 | `onCancel()` *(inside askAboutClaims)* | Cancel was pressed. |  |
| 318 | `onBackdrop()` *(inside askAboutClaims)* | A click outside the popup counts as Cancel. |  |
| 330 | `askToReleaseClaims()` *(inside page-load handler)* | Before a role change, disable or delete: asks to release active claims. Resolves true to go ahead, false if cancelled. |  |
| 342 | `releaseClaims()` *(inside page-load handler)* | Releases each given claimed report one by one and redraws the list. |  |

#### `frontend/admin/js/map-boundary.js`

Map Boundary (admin): draw, upload (GeoJSON/KML) or edit the barangay outline (GET/PUT /api/site/boundary/), and add/remove streets — the yellow dots (/api/site/streets/). "+ Add Street", then click the map to place one. Load after /shared/vendor/leaflet/leaflet.js and /shared/js/streets.js.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 13 | `fetchBoundary()` | Loads the saved outline (list of [lat, lng]). | this file |
| 19 | `saveBoundary()` | Saves the outline with PUT /api/site/boundary/; throws the server's message on failure. Returns the saved points. | this file |
| 36 | `apiExtractError()` | Reads an error response and throws its first message (or the fallback). | this file |
| 42 | `createStreet()` | Adds a street (name + point) with POST /api/site/streets/. | this file |
| 52 | `deleteStreet()` | Removes a street with DELETE /api/site/streets/<id>/. | this file |
| 62 | `ringArea()` | Approximate area of an outline in km² (shoelace formula) — used to pick the largest polygon and for the status line. | this file |
| 76 | `ringsFromGeoJSON()` | Collects every polygon/line ring from a GeoJSON file, turning lng,lat into [lat, lng]. | this file |
| 78 | `visit()` *(inside ringsFromGeoJSON)* | Walks the GeoJSON tree (FeatureCollection, Feature, geometries) and collects rings. |  |
| 91 | `ringsFromKML()` | Collects every polygon/line ring from a KML file (coordinates lng,lat → [lat, lng]). | this file |
| 94 | `parse()` *(inside ringsFromKML)* | Turns one KML <coordinates> text into a list of points. |  |
| 109 | `pointsFromFile()` | Reads an uploaded .geojson/.json/.kml file: keeps the largest polygon, drops a repeated closing point, and thins very detailed files to at most 2000 points. | this file |
| 168 | `escapeStreetHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 176 | `renderStreetMarkers()` *(inside page-load handler)* | Draws each street as a small yellow dot (with its name on hover). |  |
| 191 | `renderStreetList()` *(inside page-load handler)* | Lists the streets alphabetically with a remove (×) button each. |  |
| 206 | `refreshStreets()` *(inside page-load handler)* | Redraws the street dots and the street list. |  |
| 227 | `setAddStreetMode()` *(inside page-load handler)* | Turns "+ Add Street" mode on/off (the next map click places a street instead of an outline point). |  |
| 255 | `closeStreetNameModal()` *(inside page-load handler)* | Closes the new-street name popup and forgets the clicked point. |  |
| 274 | `closeStreetDeleteModal()` *(inside page-load handler)* | Closes the remove-street popup. |  |
| 312 | `samePoints()` *(inside page-load handler)* | True if two point lists are exactly equal. |  |
| 313 | `isDirty()` *(inside page-load handler)* | True if the outline differs from the saved one. |  |
| 315 | `pushHistory()` *(inside page-load handler)* | Saves a copy of the outline for Undo (keeps the last 100). |  |
| 320 | `updateStatus()` *(inside page-load handler)* | Updates the status line (points, area, unsaved changes) and enables/disables Undo, Clear, Reset and Save. |  |
| 339 | `redraw()` *(inside page-load handler)* | Redraws the outline and a draggable handle on every point (drag to move, right-click to remove). |  |
| 369 | `segmentDistance()` *(inside page-load handler)* | Squared distance from point p to segment a-b, in screen pixels — used to insert a new point into the edge nearest the click, so clicking near an edge refines it instead of stretching a spike across the shape. |  |
| 430 | `fitOutline()` *(inside page-load handler)* | Zooms the map to the outline. |  |

#### `frontend/admin/js/ordinance-authors-data.js`

ordinance-authors-data.js — API calls for the officials list (/api/ordinances/authors/), suggested in the Author field when uploading.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 7 | `ensureAllOrdinanceAuthorsLoaded()` | include_inactive=1: this page also lists officials whose term ended. | admin/ordinance-authors.js |
| 15 | `liveOrdinanceAuthors()` | The loaded author list. | admin/ordinance-authors.js |
| 19 | `readFirstOrdinanceAuthorError()` | Throws the server's message from an error response, or the fallback with the status code. | this file |
| 31 | `createOrdinanceAuthor()` | fields: { name, position } | admin/ordinance-authors.js |
| 44 | `updateOrdinanceAuthor()` | fields: any subset of { name, position, is_active } | admin/ordinance-authors.js |
| 59 | `deleteOrdinanceAuthor()` | Deletes an author and removes it from the cache. | admin/ordinance-authors.js |

#### `frontend/admin/js/ordinance-authors.js`

Ordinance Authors (admin, part of the Ordinance Setup page): the officials list. When a term ends, set the official inactive; delete only mistakes.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 20 | `escapeHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 26 | `render()` *(inside page-load handler)* | Draws the author table (name, position, active/ended) with Edit, End Term/Reactivate and Delete. |  |
| 68 | `openAddModal()` *(inside page-load handler)* | Opens the empty Add Author popup. |  |
| 77 | `openEditModal()` *(inside page-load handler)* | Opens the Edit Author popup filled with the author's name and position. |  |

#### `frontend/admin/js/ordinance-categories-data.js`

ordinance-categories-data.js — API calls for the category list (/api/ordinances/categories/). An ordinance's category must be one of these.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 7 | `ensureAllOrdinanceCategoriesLoaded()` | include_inactive=1: this page also lists retired categories. | admin/ordinance-categories.js |
| 15 | `liveOrdinanceCategories()` | The loaded category list. | admin/ordinance-categories.js |
| 19 | `readFirstOrdinanceCategoryError()` | Throws the server's message from an error response, or the fallback with the status code. | this file |
| 31 | `createOrdinanceCategory()` | fields: { name } | admin/ordinance-categories.js |
| 44 | `updateOrdinanceCategory()` | fields: any subset of { name, is_active } | admin/ordinance-categories.js |
| 59 | `deleteOrdinanceCategory()` | Deletes a category and removes it from the cache. | admin/ordinance-categories.js |

#### `frontend/admin/js/ordinance-categories.js`

Ordinance Categories (admin, part of the Ordinance Setup page): add, rename, retire or remove categories. Retire old ones; delete only mistakes.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 19 | `escapeHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 25 | `render()` *(inside page-load handler)* | Draws the category table (name, active/retired) with Edit, Retire/Restore and Delete. |  |
| 66 | `openAddModal()` *(inside page-load handler)* | Opens the empty Add Category popup. |  |
| 75 | `openEditModal()` *(inside page-load handler)* | Opens the Edit Category popup filled with the name. |  |

#### `frontend/admin/js/pending-accounts-data.js`

pending-accounts-data.js — API calls for Approve Accounts (/api/auth/admin/verifications/).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 5 | `getPendingVerifications()` | Loads the sign-ups waiting for approval. | admin/approve-accounts.js |
| 14 | `approveVerification()` | Marks the account verified — it can log in immediately after this. | admin/approve-accounts.js |
| 26 | `rejectVerification()` | Emails the reason and deletes the pending account (so they can sign up again). | admin/approve-accounts.js |

#### `frontend/admin/js/questions-data.js`

questions-data.js (admin) — API calls for citizens' questions and the FAQ list.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 3 | `getQuestions()` | Loads every citizen question. | admin/questions-list.js, staff/questions-list.js, staff/secretary-dashboard.js |
| 9 | `answerQuestion()` | Saves an answer to one question. | admin/questions-list.js, staff/questions-list.js |
| 25 | `getManagedFAQs()` | Loads the FAQ list for editing. | admin/faqs-manage.js |
| 31 | `createFAQ()` | Adds an FAQ. | admin/faqs-manage.js |
| 45 | `updateFAQ()` | Edits an FAQ. | admin/faqs-manage.js |
| 59 | `deleteFAQ()` | Deletes an FAQ. | admin/faqs-manage.js |

#### `frontend/admin/js/questions-list.js`

Answer Questions (admin): citizens' questions with a reply box (answered ones stay listed).

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 3 | `escapeHtml()` | Makes text safe to put inside HTML. | this file, admin/about-setup.js, admin/ordinance-authors.js, admin/ordinance-categories.js, admin/reports.js, admin/website-setup.js, +4 more |
| 9 | `formatQuestionDate()` | A question's date and time as text. | this file |
| 31 | `renderQuestions()` *(inside page-load handler)* | Draws the current page of questions (all / pending / answered) with reply boxes and answers. |  |

#### `frontend/admin/js/reports.js`

Reports (admin): every unclaimed report, oldest first, with "Assign to Investigator" on each row, plus each Investigator's current workload.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 41 | `escapeHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 47 | `formatDate()` *(inside page-load handler)* | A date as "September 19, 2026". |  |
| 51 | `loadData()` *(inside page-load handler)* | Loads every report and every account, keeps the unclaimed open reports (oldest first) and the active Investigators, then draws the page. |  |
| 76 | `renderInvestigatorWorkload()` *(inside page-load handler)* | One bar per active Investigator: their open claimed reports, by status. |  |
| 133 | `assignControlHtml()` *(inside page-load handler)* | The Investigator dropdown and Assign button for one report row (or "No active Investigators"). |  |
| 146 | `render()` *(inside page-load handler)* | Draws the current page of unclaimed reports and each Investigator's workload bars. |  |

#### `frontend/admin/js/website-setup.js`

Website Setup (admin): the brand name and logo, the site footer's text and links, and the legal pages (Privacy Policy, Terms). Saves to /api/site/.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 5 | `escapeHtml()` *(inside page-load handler)* | Makes text safe to put inside HTML. |  |
| 27 | `fillBrandingForm()` *(inside page-load handler)* | Fills the Branding form (site name and logo) from the saved values. |  |
| 33 | `isBrandingDirty()` *(inside page-load handler)* | True if the site name or logo was changed but not saved. |  |
| 39 | `commitBrandingSave()` *(inside page-load handler)* | Saves the branding. Returns true on success. |  |
| 86 | `renderFooterEditor()` *(inside page-load handler)* | Draws the editable list of footer links (label, URL, Up/Down/Remove; legal links also get "Edit page text"). |  |
| 110 | `readFooterEditor()` *(inside page-load handler)* | Keeps typed values before a structural change (add/move/remove) re-renders the list. |  |
| 122 | `currentFooterValues()` *(inside page-load handler)* | The footer values as saved (used to detect and discard unsaved changes). |  |
| 133 | `isFooterDirty()` *(inside page-load handler)* | True if the footer text or links differ from the saved values. |  |
| 138 | `fillFooterForm()` *(inside page-load handler)* | Fills the footer form (tagline, notice, both link lists) and remembers it as saved. |  |
| 182 | `commitFooterSave()` *(inside page-load handler)* | Saves the footer. Returns true on success. |  |
| 186 | `clean()` *(inside commitFooterSave)* | Trims every link and drops empty rows. |  |
| 219 | `isSetupDirty()` *(inside page-load handler)* | True if Branding or Footer has unsaved changes. |  |
| 294 | `renderLegalEditor()` *(inside page-load handler)* | Draws the legal page's sections (heading + text) with Up/Down/Remove buttons. |  |
| 322 | `readLegalEditor()` *(inside page-load handler)* | Keeps typed text before any add/move/remove re-renders the editor. |  |
| 330 | `fillLegalForm()` *(inside page-load handler)* | Fills the legal page editor (effective date + sections) and remembers it as saved. |  |
| 337 | `legalState()` *(inside page-load handler)* | The editor's current content as one text, to compare with the saved state. |  |
| 344 | `hasUnsavedLegalChanges()` *(inside page-load handler)* | True if the legal page editor has unsaved changes. |  |
| 349 | `requestCloseLegal()` *(inside page-load handler)* | Closes the legal editor, or first asks to discard unsaved changes. |  |
| 357 | `openLegalEditor()` *(inside page-load handler)* | Opens the editor for the Privacy Policy or Terms and loads its sections. |  |
| 402 | `saveLegal()` *(inside page-load handler)* | Saves the effective date and the non-empty sections (PUT /api/site/legal/<key>/admin/). Returns true on success. |  |

### 15.7 Email templates

Every email is an HTML file under `<app>/templates/emails/`. All of them extend `accounts/templates/emails/_base.html` (the shared header, colors and footer). `orms_backend/emails.py` picks the template and fills it in:

| Template | Sent by (in `orms_backend/emails.py`) | When |
|---|---|---|
| `accounts/templates/emails/password_reset_code.html` | `send_password_reset_email()` | Emails the 6-digit Forgot Password code. |
| `reports/templates/emails/report_verification_code.html` | `send_report_verification_code_email()` | Emails the 6-digit code a citizen needs before filing a report. |
| `accounts/templates/emails/profile_edit_code.html` | `send_profile_edit_code_email()` | Emails the code that confirms changes on My Profile, to the address already on file. |
| `accounts/templates/emails/account_setup_link.html` | `send_account_setup_link_email()` | Emails the link for finishing an account that an Administrator created. |
| `accounts/templates/emails/password_reset_link.html` | `send_password_reset_link_email()` | Emails a set-new-password link that an Administrator sent from Manage Accounts. |
| `accounts/templates/emails/account_approved.html` | `send_account_approved_email()` | Tells a citizen their sign-up was approved. |
| `accounts/templates/emails/account_rejected.html` | `send_account_rejected_email()` | Tells a citizen their sign-up was rejected and why. Takes name/email instead of the user because the account is deleted right after. |
| `accounts/templates/emails/account_deactivated.html` | `send_account_deactivated_email()` | Tells a user their account was disabled by an Administrator. |
| `reports/templates/emails/account_suspicious_activity.html` | `send_account_suspicious_activity_email()` | Tells a citizen their account was disabled automatically for suspicious report activity. |
| `accounts/templates/emails/account_deleted.html` | `send_account_deleted_email()` | Tells a user an Administrator deleted their account. |
| `accounts/templates/emails/account_self_deleted.html` | `send_account_self_deleted_email()` | Confirms to a citizen that they deleted their own account. |
| `accounts/templates/emails/account_locked.html` | `send_account_locked_email()` | Tells a user their account is locked for some minutes after too many wrong passwords. Sent once per lock. |
| `reports/templates/emails/report_submitted_citizen.html` | `send_report_submitted_citizen_email()` | Confirms to the citizen that their report was received. |
| `reports/templates/emails/suggestion_submitted_citizen.html` | `send_suggestion_submitted_citizen_email()` | Confirms to the citizen that their concern/suggestion was received. |
| `reports/templates/emails/report_resolved.html` | `send_report_resolved_email()` | Tells the citizen their report reached a final status (Resolved / With Remarks). |
| `reports/templates/emails/report_reassigned.html` | `send_report_reassigned_email()` | Tells the citizen a different Investigator now handles their report. |
| `reports/templates/emails/question_answered.html` | `send_question_answered_email()` | Tells the citizen their question was answered. |
| `reports/templates/emails/report_submitted_staff.html` | `send_report_submitted_staff_emails()` | Tells the given staff members a new report needs review. |
| `reports/templates/emails/suggestion_submitted_staff.html` | `send_suggestion_submitted_staff_emails()` | Tells the given staff members a new concern/suggestion needs review. |
| `announcements/templates/emails/announcement_posted.html` | `send_announcement_posted_email()` | Sends a new announcement, with a link to the citizen home page, to every given citizen. |
| `accounts/templates/emails/account_created_admin.html` | `send_account_created_admin_emails()` | Tells every Administrator that a new citizen signed up and is waiting for approval. |
| `accounts/templates/emails/_base.html` | (every email) | The layout every email template extends. |

### 15.8 Automated tests (what each test checks)

Run them with `python manage.py test`. Each test's name says what it checks; the sentence below is that name written out.

#### `orms_backend/tests.py`

| Line | Test | What it checks |
|---:|---|---|
| 28 | `_raw()` | Helper used by the tests: raw. |
| 35 | **`EncryptedFieldTests`** | Group of tests: encrypted field. |
| 36 | `EncryptedFieldTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 43 | `EncryptedFieldTests.test_stored_value_is_ciphertext_and_reads_back_as_text()` | Stored value is ciphertext and reads back as text. |
| 52 | `EncryptedFieldTests.test_same_text_never_encrypts_the_same_way_twice()` | Same text never encrypts the same way twice. |
| 61 | `EncryptedFieldTests.test_blank_stays_blank_and_can_still_be_filtered()` | Blank stays blank and can still be filtered. |
| 66 | `EncryptedFieldTests.test_database_lookups_on_encrypted_text_are_refused()` | Database lookups on encrypted text are refused. |
| 72 | `EncryptedFieldTests.test_updates_and_long_unicode_text_round_trip()` | Updates and long unicode text round trip. |
| 84 | `EncryptedFieldTests.test_iteration_count_travels_with_the_value()` | Iteration count travels with the value. |
| 90 | `EncryptedFieldTests.test_wrong_or_missing_key_fails_loudly()` | Wrong or missing key fails loudly. |
| 101 | `EncryptedFieldTests.test_value_written_before_encryption_is_read_as_is()` | Value written before encryption is read as is. |
| 106 | `EncryptedFieldTests.test_matches_the_algorithm_module()` | Matches the algorithm module. |
| 115 | `_png_bytes()` | Helper used by the tests: png bytes. |
| 122 | **`EncryptedStorageTests`** | Group of tests: encrypted storage. |
| 123 | `EncryptedStorageTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 138 | `EncryptedStorageTests._on_disk()` |  on disk. |
| 142 | `EncryptedStorageTests.test_voter_id_is_stored_as_ciphertext_under_a_random_name()` | Voter id is stored as ciphertext under a random name. |
| 156 | `EncryptedStorageTests.test_signed_link_serves_the_decrypted_image()` | Signed link serves the decrypted image. |
| 168 | `EncryptedStorageTests.test_tampered_or_expired_links_are_refused()` | Tampered or expired links are refused. |
| 178 | `EncryptedStorageTests.test_non_image_attachments_are_encrypted_but_only_sent_as_downloads()` | Non image attachments are encrypted but only sent as downloads. |
| 188 | `EncryptedStorageTests.test_videos_are_left_unencrypted_in_normal_storage()` | Videos are left unencrypted in normal storage. |
| 200 | `EncryptedStorageTests.test_deleting_removes_the_encrypted_file()` | Deleting removes the encrypted file. |
| 207 | `EncryptedStorageTests.test_blob_format_round_trips_and_differs_every_time()` | Blob format round trips and differs every time. |
| 214 | `EncryptedStorageTests.test_command_converts_files_uploaded_before_encryption()` | Command converts files uploaded before encryption. |
| 241 | **`MoreEncryptedTextTests`** | Group of tests: more encrypted text. |
| 242 | `MoreEncryptedTextTests.test_location_question_and_audit_name_are_ciphertext_in_the_database()` | Location question and audit name are ciphertext in the database. |

#### `orms_backend/tests_injection.py`

SQL injection checks: classic injection strings sent through every kind of input the API takes (login fields, URL query parameters, path IDs, saved free text) must be treated as plain data — no login bypass, no server error, no change to the database.

| Line | Test | What it checks |
|---:|---|---|
| 24 | **`SqlInjectionTests`** | Group of tests: sql injection. |
| 25 | `SqlInjectionTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 42 | `SqlInjectionTests._login()` |  login. |
| 46 | `SqlInjectionTests.test_login_fields_cannot_bypass_authentication()` | Login fields cannot bypass authentication. |
| 59 | `SqlInjectionTests.test_query_parameters_are_not_executed()` | Query parameters are not executed. |
| 70 | `SqlInjectionTests.test_path_ids_are_not_executed()` | Path ids are not executed. |
| 77 | `SqlInjectionTests.test_free_text_is_stored_literally()` | Free text is stored literally. |
| 87 | `SqlInjectionTests.test_database_is_unchanged_after_all_payloads()` | Database is unchanged after all payloads. |

#### `orms_backend/tests_resistance.py`

Resistance checks: malformed, oversized, tampered or unauthorized requests must be refused cleanly (a 4xx answer), never crash the server (5xx) or slip through.

| Line | Test | What it checks |
|---:|---|---|
| 15 | **`ResistanceTests`** | Group of tests: resistance. |
| 16 | `ResistanceTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 29 | `ResistanceTests.test_malformed_json_is_rejected()` | Malformed json is rejected. |
| 33 | `ResistanceTests.test_missing_fields_are_rejected()` | Missing fields are rejected. |
| 38 | `ResistanceTests.test_tampered_or_fake_tokens_are_refused()` | Tampered or fake tokens are refused. |
| 49 | `ResistanceTests.test_anonymous_requests_need_login()` | Anonymous requests need login. |
| 54 | `ResistanceTests.test_citizen_cannot_reach_staff_or_admin_endpoints()` | Citizen cannot reach staff or admin endpoints. |
| 60 | `ResistanceTests.test_citizen_cannot_open_someone_elses_report()` | Citizen cannot open someone elses report. |
| 64 | `ResistanceTests.test_staff_cannot_change_a_report_outside_their_role()` | Staff cannot change a report outside their role. |
| 71 | `ResistanceTests.test_too_many_attachments_are_rejected()` | Too many attachments are rejected. |
| 78 | `ResistanceTests.test_very_long_text_does_not_crash()` | Very long text does not crash. |
| 83 | `ResistanceTests.test_bad_ids_in_the_address_are_404_not_500()` | Bad ids in the address are 404 not 500. |

#### `accounts/tests.py`

| Line | Test | What it checks |
|---:|---|---|
| 25 | **`FailedLoginLockoutTests`** | Every login attempt runs the password hasher, and these tests make dozens of them; the default PBKDF2 takes ~0.1s each, so use a fast hasher (tests only, never real accounts). |
| 26 | `FailedLoginLockoutTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 31 | `FailedLoginLockoutTests._login()` |  login. |
| 34 | `FailedLoginLockoutTests._fail()` |  fail. |
| 40 | `FailedLoginLockoutTests.test_below_the_limit_does_not_lock()` | Below the limit does not lock. |
| 47 | `FailedLoginLockoutTests.test_wrong_password_and_unknown_email_get_the_same_message()` | Wrong password and unknown email get the same message. |
| 53 | `FailedLoginLockoutTests.test_phone_number_is_not_accepted_as_the_login()` | Phone number is not accepted as the login. |
| 58 | `FailedLoginLockoutTests.test_successful_login_resets_the_counter()` | Successful login resets the counter. |
| 65 | `FailedLoginLockoutTests.test_tenth_failure_locks_and_alerts_the_owner()` | Tenth failure locks and alerts the owner. |
| 79 | `FailedLoginLockoutTests.test_correct_password_is_refused_while_locked()` | Correct password is refused while locked. |
| 86 | `FailedLoginLockoutTests.test_further_attempts_while_locked_send_no_more_email()` | Further attempts while locked send no more email. |
| 91 | `FailedLoginLockoutTests.test_lock_expires()` | Lock expires. |
| 99 | `FailedLoginLockoutTests.test_old_failures_do_not_add_up()` | Old failures do not add up. |
| 109 | `FailedLoginLockoutTests.test_email_match_is_case_insensitive()` | Email match is case insensitive. |
| 114 | `FailedLoginLockoutTests.test_unknown_email_gets_the_generic_error_and_no_email()` | Unknown email gets the generic error and no email. |
| 120 | `FailedLoginLockoutTests.test_disabled_account_is_not_locked_or_emailed()` | Disabled account is not locked or emailed. |
| 127 | `FailedLoginLockoutTests.test_correct_password_on_unverified_account_is_not_a_failure()` | Correct password on unverified account is not a failure. |
| 135 | `FailedLoginLockoutTests.test_locking_one_account_leaves_others_alone()` | Locking one account leaves others alone. |
| 142 | `FailedLoginLockoutTests.test_completing_a_password_reset_unlocks_the_account()` | Completing a password reset unlocks the account. |
| 163 | **`PasswordResetCodeAttemptTests`** | A 6-digit code is only 1,000,000 guesses — each code must die after a few wrong ones. |
| 166 | `PasswordResetCodeAttemptTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 173 | `PasswordResetCodeAttemptTests._verify()` |  verify. |
| 178 | `PasswordResetCodeAttemptTests._wrong()` |  wrong. |
| 181 | `PasswordResetCodeAttemptTests.test_code_is_six_digits()` | Code is six digits. |
| 184 | `PasswordResetCodeAttemptTests.test_correct_code_still_works_after_a_few_wrong_guesses()` | Correct code still works after a few wrong guesses. |
| 189 | `PasswordResetCodeAttemptTests.test_code_dies_after_too_many_wrong_guesses()` | Code dies after too many wrong guesses. |
| 197 | `PasswordResetCodeAttemptTests.test_requesting_a_new_code_gives_a_working_one()` | Requesting a new code gives a working one. |
| 204 | `PasswordResetCodeAttemptTests.test_confirm_needs_the_code_to_have_been_verified_first()` | Confirm needs the code to have been verified first. |
| 214 | **`AuthThrottleTests`** | Group of tests: auth throttle. |
| 215 | `AuthThrottleTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 220 | `AuthThrottleTests._login()` |  login. |
| 223 | `AuthThrottleTests.test_login_is_limited_per_ip()` | Login is limited per ip. |
| 230 | `AuthThrottleTests.test_reset_verify_is_limited()` | Reset verify is limited. |
| 236 | `AuthThrottleTests.test_reset_request_is_limited_per_email_not_just_per_ip()` | Reset request is limited per email not just per ip. |
| 247 | `AuthThrottleTests.test_signup_is_limited()` | Signup is limited. |
| 252 | `AuthThrottleTests.test_forged_forwarded_for_header_does_not_dodge_the_limit()` | Forged forwarded for header does not dodge the limit. |
| 274 | **`AccountSetupLinkTests`** | Accounts someone else creates get no password — just a one-time emailed link where the owner fills in their details and chooses their own (see accounts/setup_links.py). Anyone who merely knows the email, or holds an old/used/expired link, must get nowhere. |
| 282 | `AccountSetupLinkTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 293 | `AccountSetupLinkTests._create_staff()` |  create staff. |
| 302 | `AccountSetupLinkTests._create_citizen_direct()` |  create citizen direct. |
| 312 | `AccountSetupLinkTests._link()` |  link. |
| 315 | `AccountSetupLinkTests._check()` |  check. |
| 318 | `AccountSetupLinkTests._setup()` |  setup. |
| 322 | `AccountSetupLinkTests._request_link()` |  request link. |
| 325 | `AccountSetupLinkTests._login_as()` |  login as. |
| 328 | `AccountSetupLinkTests._assert_still_pending()` |  assert still pending. |
| 334 | `AccountSetupLinkTests.test_admin_created_staff_account_gets_a_setup_link_and_no_password()` | Admin created staff account gets a setup link and no password. |
| 341 | `AccountSetupLinkTests.test_directly_created_citizen_gets_a_link_with_their_details_prefilled()` | Directly created citizen gets a link with their details prefilled. |
| 350 | `AccountSetupLinkTests.test_invited_citizen_gets_a_link()` | Invited citizen gets a link. |
| 358 | `AccountSetupLinkTests.test_full_staff_setup_flow()` | Full staff setup flow. |
| 371 | `AccountSetupLinkTests.test_citizen_can_correct_prefilled_details_during_setup()` | Citizen can correct prefilled details during setup. |
| 384 | `AccountSetupLinkTests.test_cannot_set_up_with_just_the_email()` | Cannot set up with just the email. |
| 393 | `AccountSetupLinkTests.test_a_tampered_token_does_not_work()` | A tampered token does not work. |
| 400 | `AccountSetupLinkTests.test_link_is_single_use()` | Link is single use. |
| 408 | `AccountSetupLinkTests.test_one_accounts_token_cannot_set_up_another()` | One accounts token cannot set up another. |
| 416 | `AccountSetupLinkTests.test_expired_link_is_refused()` | Expired link is refused. |
| 425 | `AccountSetupLinkTests.test_requesting_a_new_link_kills_the_old_one()` | Requesting a new link kills the old one. |
| 433 | `AccountSetupLinkTests.test_new_link_can_be_requested_from_an_expired_one()` | New link can be requested from an expired one. |
| 440 | `AccountSetupLinkTests.test_a_valid_token_for_an_already_set_up_account_is_refused()` | A valid token for an already set up account is refused. |
| 446 | `AccountSetupLinkTests.test_request_link_gives_the_same_answer_whether_or_not_the_account_exists()` | Request link gives the same answer whether or not the account exists. |
| 459 | `AccountSetupLinkTests.test_setup_password_must_meet_the_rules()` | Setup password must meet the rules. |
| 466 | `AccountSetupLinkTests.test_setup_password_cannot_resemble_the_name_being_entered()` | Setup password cannot resemble the name being entered. |
| 475 | `AccountSetupLinkTests.test_login_on_a_pending_account_points_to_setup()` | Login on a pending account points to setup. |
| 481 | `AccountSetupLinkTests.test_citizen_login_does_not_reveal_pending_staff_accounts()` | Citizen login does not reveal pending staff accounts. |
| 487 | `AccountSetupLinkTests.test_old_code_based_setup_endpoints_are_gone()` | Old code based setup endpoints are gone. |
| 493 | **`AccountSetupThrottleTests`** | Group of tests: account setup throttle. |
| 494 | `AccountSetupThrottleTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 498 | `AccountSetupThrottleTests._request()` |  request. |
| 501 | `AccountSetupThrottleTests.test_link_requests_are_limited_per_email()` | Link requests are limited per email. |
| 506 | `AccountSetupThrottleTests.test_link_requests_are_limited_per_ip()` | Link requests are limited per ip. |
| 513 | **`PasswordResetEnumerationTests`** | Forgot Password must not reveal whether an email is registered. |
| 516 | `PasswordResetEnumerationTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 519 | `PasswordResetEnumerationTests._request()` |  request. |
| 522 | `PasswordResetEnumerationTests.test_registered_and_unregistered_emails_get_identical_responses()` | Registered and unregistered emails get identical responses. |
| 529 | `PasswordResetEnumerationTests.test_only_a_registered_email_actually_receives_a_code()` | Only a registered email actually receives a code. |
| 538 | `PasswordResetEnumerationTests.test_email_match_ignores_case()` | Email match ignores case. |
| 542 | `PasswordResetEnumerationTests.test_response_does_not_say_the_account_was_found()` | Response does not say the account was found. |
| 546 | `PasswordResetEnumerationTests.test_a_malformed_email_is_still_rejected()` | A malformed email is still rejected. |
| 549 | `PasswordResetEnumerationTests.test_verify_gives_the_same_error_for_unknown_emails_and_wrong_codes()` | Verify gives the same error for unknown emails and wrong codes. |
| 562 | **`DisableDeleteWithClaimsTests`** | Disabling/deleting an Investigator who holds claimed reports — and the audit trail for it. |
| 565 | `DisableDeleteWithClaimsTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 587 | `DisableDeleteWithClaimsTests._claimed()` |  claimed. |
| 590 | `DisableDeleteWithClaimsTests._logs()` |  logs. |
| 593 | `DisableDeleteWithClaimsTests.test_disable_and_release_frees_claims_and_logs_each_one()` | Disable and release frees claims and logs each one. |
| 601 | `DisableDeleteWithClaimsTests.test_disable_without_releasing_active_claims_is_refused()` | Disable without releasing active claims is refused. |
| 609 | `DisableDeleteWithClaimsTests.test_closed_claims_stay_with_the_investigator_and_dont_block()` | Closed claims stay with the investigator and dont block. |
| 617 | `DisableDeleteWithClaimsTests.test_release_only_frees_active_claims()` | Release only frees active claims. |
| 628 | `DisableDeleteWithClaimsTests.test_role_change_without_releasing_active_claims_is_refused()` | Role change without releasing active claims is refused. |
| 635 | `DisableDeleteWithClaimsTests.test_role_change_with_release_frees_claims_then_changes_role()` | Role change with release frees claims then changes role. |
| 645 | `DisableDeleteWithClaimsTests.test_resaving_the_same_role_needs_no_release()` | Resaving the same role needs no release. |
| 650 | `DisableDeleteWithClaimsTests.test_refused_role_change_releases_nothing()` | Refused role change releases nothing. |
| 656 | `DisableDeleteWithClaimsTests.test_disabling_someone_with_no_claims_logs_plainly()` | Disabling someone with no claims logs plainly. |
| 661 | `DisableDeleteWithClaimsTests.test_delete_frees_claims_and_logs_who_did_it()` | Delete frees claims and logs who did it. |
| 669 | `DisableDeleteWithClaimsTests.test_long_log_entries_are_trimmed_not_dropped()` | Long log entries are trimmed not dropped. |
| 679 | **`ChangePasswordRulesTests`** | Change Password enforces the same character-class rules as Sign Up. |
| 684 | `ChangePasswordRulesTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 690 | `ChangePasswordRulesTests._change()` |  change. |
| 695 | `ChangePasswordRulesTests.test_password_missing_character_classes_is_rejected()` | Password missing character classes is rejected. |
| 703 | `ChangePasswordRulesTests.test_password_meeting_every_rule_is_accepted()` | Password meeting every rule is accepted. |
| 713 | **`AdminAccountLinkButtonTests`** | Manage Accounts' Resend Setup Link and Reset Password buttons. |
| 716 | `AdminAccountLinkButtonTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 732 | `AdminAccountLinkButtonTests._as_admin()` |  as admin. |
| 738 | `AdminAccountLinkButtonTests._resend()` |  resend. |
| 741 | `AdminAccountLinkButtonTests._reset()` |  reset. |
| 744 | `AdminAccountLinkButtonTests._reset_link()` |  reset link. |
| 747 | `AdminAccountLinkButtonTests._confirm()` |  confirm. |
| 752 | `AdminAccountLinkButtonTests._login()` |  login. |
| 757 | `AdminAccountLinkButtonTests.test_resend_setup_link_works_while_pending()` | Resend setup link works while pending. |
| 762 | `AdminAccountLinkButtonTests.test_resend_setup_link_is_refused_once_set_up()` | Resend setup link is refused once set up. |
| 769 | `AdminAccountLinkButtonTests.test_only_admins_can_resend()` | Only admins can resend. |
| 776 | `AdminAccountLinkButtonTests.test_reset_password_emails_a_link_and_never_returns_a_token()` | Reset password emails a link and never returns a token. |
| 784 | `AdminAccountLinkButtonTests.test_full_reset_flow()` | Full reset flow. |
| 794 | `AdminAccountLinkButtonTests.test_reset_link_is_single_use()` | Reset link is single use. |
| 800 | `AdminAccountLinkButtonTests.test_reset_link_expires_after_its_own_shorter_window()` | Reset link expires after its own shorter window. |
| 807 | `AdminAccountLinkButtonTests.test_reset_and_setup_tokens_are_not_interchangeable()` | Reset and setup tokens are not interchangeable. |
| 815 | `AdminAccountLinkButtonTests.test_new_password_must_meet_rules_and_differ_from_current()` | New password must meet rules and differ from current. |
| 821 | `AdminAccountLinkButtonTests.test_reset_password_is_refused_for_citizens()` | Reset password is refused for citizens. |
| 825 | `AdminAccountLinkButtonTests.test_reset_password_is_refused_for_pending_accounts()` | Reset password is refused for pending accounts. |
| 828 | `AdminAccountLinkButtonTests.test_reset_password_is_refused_for_yourself()` | Reset password is refused for yourself. |
| 831 | `AdminAccountLinkButtonTests.test_reset_password_is_refused_for_disabled_accounts()` | Reset password is refused for disabled accounts. |
| 837 | **`CreateAdminCommandTests`** | create_admin runs on every deploy/restart, so it must never undo a password change. |
| 842 | `CreateAdminCommandTests._run()` |  run. |
| 851 | `CreateAdminCommandTests.test_creates_the_account_the_first_time()` | Creates the account the first time. |
| 857 | `CreateAdminCommandTests.test_a_changed_password_survives_later_runs()` | A changed password survives later runs. |

#### `reports/tests.py`

| Line | Test | What it checks |
|---:|---|---|
| 14 | **`ReportVerificationCodeTests`** | The report-filing identity code has the same 1,000,000-guess weakness as Forgot Password. |
| 17 | `ReportVerificationCodeTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 23 | `ReportVerificationCodeTests._send()` |  send. |
| 26 | `ReportVerificationCodeTests._verify()` |  verify. |
| 29 | `ReportVerificationCodeTests._live_codes()` |  live codes. |
| 32 | `ReportVerificationCodeTests._wrong()` |  wrong. |
| 35 | `ReportVerificationCodeTests.test_correct_code_verifies()` | Correct code verifies. |
| 42 | `ReportVerificationCodeTests.test_sending_again_kills_the_earlier_code()` | Sending again kills the earlier code. |
| 53 | `ReportVerificationCodeTests.test_code_dies_after_too_many_wrong_guesses()` | Code dies after too many wrong guesses. |
| 62 | `ReportVerificationCodeTests.test_correct_code_works_after_a_few_wrong_guesses()` | Correct code works after a few wrong guesses. |
| 69 | `ReportVerificationCodeTests.test_verifying_with_no_code_requested_fails_cleanly()` | Verifying with no code requested fails cleanly. |
| 74 | **`ReportVerificationThrottleTests`** | Group of tests: report verification throttle. |
| 75 | `ReportVerificationThrottleTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 81 | `ReportVerificationThrottleTests.test_sending_codes_is_limited()` | Sending codes is limited. |
| 86 | `ReportVerificationThrottleTests.test_verify_attempts_are_limited()` | Verify attempts are limited. |
| 91 | `ReportVerificationThrottleTests.test_limit_is_per_user()` | Limit is per user. |
| 99 | **`ReportStatusClaimGateTests`** | An Investigator can only work (status/remarks) a report they've claimed themselves. |
| 102 | `ReportStatusClaimGateTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 117 | `ReportStatusClaimGateTests._patch()` |  patch. |
| 120 | `ReportStatusClaimGateTests.test_unclaimed_report_cannot_be_updated()` | Unclaimed report cannot be updated. |
| 128 | `ReportStatusClaimGateTests.test_report_claimed_by_someone_else_cannot_be_updated()` | Report claimed by someone else cannot be updated. |
| 138 | `ReportStatusClaimGateTests.test_remarks_only_edit_is_also_blocked_without_the_claim()` | Remarks only edit is also blocked without the claim. |
| 144 | `ReportStatusClaimGateTests.test_claiming_it_first_lets_the_investigator_update_it()` | Claiming it first lets the investigator update it. |
| 153 | `ReportStatusClaimGateTests.test_investigator_cannot_forfeit_their_own_claim()` | Investigator cannot forfeit their own claim. |
| 162 | `ReportStatusClaimGateTests.test_admin_can_release_a_claim()` | Admin can release a claim. |
| 173 | `ReportStatusClaimGateTests.test_second_investigator_cannot_update_after_the_first_claims_it()` | Second investigator cannot update after the first claims it. |
| 181 | `ReportStatusClaimGateTests.test_with_remarks_closes_the_report_and_emails_the_citizen()` | With remarks closes the report and emails the citizen. |
| 194 | `ReportStatusClaimGateTests.test_admin_can_still_update_on_someones_behalf()` | Admin can still update on someones behalf. |
| 200 | `ReportStatusClaimGateTests.test_non_investigator_staff_are_still_refused_outright()` | Non investigator staff are still refused outright. |
| 208 | **`BarangayCaptainReportsReadOnlyTests`** | Barangay Captain can view reports but never claim, change status, or leave remarks. |
| 211 | `BarangayCaptainReportsReadOnlyTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 226 | `BarangayCaptainReportsReadOnlyTests.test_captain_can_view_the_list_and_a_report()` | Captain can view the list and a report. |
| 230 | `BarangayCaptainReportsReadOnlyTests.test_captain_cannot_claim()` | Captain cannot claim. |
| 235 | `BarangayCaptainReportsReadOnlyTests.test_captain_cannot_change_status()` | Captain cannot change status. |
| 240 | `BarangayCaptainReportsReadOnlyTests.test_captain_cannot_leave_remarks()` | Captain cannot leave remarks. |
| 245 | `BarangayCaptainReportsReadOnlyTests.test_captain_cannot_forfeit_someone_elses_claim()` | Captain cannot forfeit someone elses claim. |
| 253 | **`ClaimedReportsFilterTests`** | Manage Accounts lists one Investigator's claims via ?assigned_to=<user id>. |
| 256 | `ClaimedReportsFilterTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 277 | `ClaimedReportsFilterTests.test_filter_returns_only_that_investigators_claims()` | Filter returns only that investigators claims. |
| 282 | `ClaimedReportsFilterTests.test_no_filter_still_returns_everything()` | No filter still returns everything. |
| 285 | `ClaimedReportsFilterTests.test_malformed_id_returns_nothing_rather_than_erroring()` | Malformed id returns nothing rather than erroring. |
| 290 | `ClaimedReportsFilterTests.test_active_filter_leaves_out_closed_claims()` | Active filter leaves out closed claims. |
| 297 | **`ReportNumberTests`** | Each report gets "YYYYMMDD-N" — the Nth filed that day — for its Download Report file name. |
| 300 | `ReportNumberTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 303 | `ReportNumberTests._make()` |  make. |
| 309 | `ReportNumberTests.test_numbers_count_up_within_a_day()` | Numbers count up within a day. |
| 315 | `ReportNumberTests.test_number_is_kept_when_an_earlier_report_is_deleted()` | Number is kept when an earlier report is deleted. |
| 325 | `ReportNumberTests.test_each_day_starts_again_at_one()` | Each day starts again at one. |
| 335 | `ReportNumberTests.test_a_clash_takes_the_next_number()` | A clash takes the next number. |
| 353 | `ReportNumberTests.test_shown_to_the_citizen_and_staff()` | Shown to the citizen and staff. |
| 364 | **`ReportRemarksAutoReviewTests`** | Remarks saved on a New Submission without moving its status put it Under Review. |
| 367 | `ReportRemarksAutoReviewTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 379 | `ReportRemarksAutoReviewTests._status_after()` |  status after. |
| 385 | `ReportRemarksAutoReviewTests.test_remarks_with_status_left_as_submitted_moves_to_under_review()` | Remarks with status left as submitted moves to under review. |
| 388 | `ReportRemarksAutoReviewTests.test_remarks_without_a_status_also_moves_it()` | Remarks without a status also moves it. |
| 391 | `ReportRemarksAutoReviewTests.test_a_status_the_investigator_picked_is_kept()` | A status the investigator picked is kept. |
| 394 | `ReportRemarksAutoReviewTests.test_blank_remarks_leave_it_submitted()` | Blank remarks leave it submitted. |
| 397 | `ReportRemarksAutoReviewTests.test_only_applies_to_new_submissions()` | Only applies to new submissions. |
| 403 | **`ConcernAutoReviewTests`** | Group of tests: concern auto review. |
| 404 | `ConcernAutoReviewTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 416 | `ConcernAutoReviewTests._patch()` |  patch. |
| 422 | `ConcernAutoReviewTests.test_status_cannot_be_set_by_hand()` | Status cannot be set by hand. |
| 427 | `ConcernAutoReviewTests.test_saving_remarks_marks_it_reviewed()` | Saving remarks marks it reviewed. |
| 432 | `ConcernAutoReviewTests.test_blank_remarks_do_not()` | Blank remarks do not. |
| 436 | `ConcernAutoReviewTests.test_filing_under_a_category_marks_it_reviewed_and_removing_keeps_it()` | Filing under a category marks it reviewed and removing keeps it. |
| 450 | `ConcernAutoReviewTests.test_removing_from_a_category_alone_does_not_review_it()` | Removing from a category alone does not review it. |
| 455 | **`StaffReportAnalysisBaseTests`** | Group of tests: staff report analysis base. |
| 456 | `StaffReportAnalysisBaseTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 467 | `StaffReportAnalysisBaseTests.test_counts_only_approved_active_citizens()` | Counts only approved active citizens. |
| 473 | `StaffReportAnalysisBaseTests.test_citizens_cannot_read_it()` | Citizens cannot read it. |
| 477 | `StaffReportAnalysisBaseTests.test_staff_report_list_identifies_the_reporter()` | Staff report list identifies the reporter. |

#### `ordinances/tests.py`

| Line | Test | What it checks |
|---:|---|---|
| 16 | **`OrdinanceArchiveTests`** | Group of tests: ordinance archive. |
| 17 | `OrdinanceArchiveTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 30 | `OrdinanceArchiveTests.test_public_list_shows_uploader_and_hides_archived()` | Public list shows uploader and hides archived. |
| 41 | `OrdinanceArchiveTests.test_staff_list_still_sees_archived()` | Staff list still sees archived. |
| 49 | `OrdinanceArchiveTests.test_secretary_can_archive_and_it_is_logged()` | Secretary can archive and it is logged. |
| 66 | `OrdinanceArchiveTests.test_captain_cannot_archive()` | Captain cannot archive. |
| 71 | `OrdinanceArchiveTests.test_anonymous_cannot_archive()` | Anonymous cannot archive. |
| 76 | **`OrdinanceSuggestTests`** | Group of tests: ordinance suggest. |
| 77 | `OrdinanceSuggestTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 94 | `OrdinanceSuggestTests.test_relevant_query_ranks_matching_ordinance_first()` | Relevant query ranks matching ordinance first. |
| 101 | `OrdinanceSuggestTests.test_short_query_returns_empty()` | Short query returns empty. |
| 106 | `OrdinanceSuggestTests.test_missing_query_returns_empty()` | Missing query returns empty. |
| 111 | `OrdinanceSuggestTests.test_archived_ordinance_never_suggested()` | Archived ordinance never suggested. |
| 118 | `OrdinanceSuggestTests.test_unrelated_query_below_threshold_returns_empty()` | Unrelated query below threshold returns empty. |
| 122 | `OrdinanceSuggestTests.test_fewer_than_two_ordinances_returns_empty()` | Fewer than two ordinances returns empty. |
| 133 | **`SuggestOrdinancesFunctionTests`** | Group of tests: suggest ordinances function. |
| 134 | `SuggestOrdinancesFunctionTests.test_empty_ordinances_returns_empty()` | Empty ordinances returns empty. |
| 137 | `SuggestOrdinancesFunctionTests.test_blank_query_returns_empty()` | Blank query returns empty. |
| 142 | **`OrdinanceAuthorEndpointTests`** | Group of tests: ordinance author endpoint. |
| 143 | `OrdinanceAuthorEndpointTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 156 | `OrdinanceAuthorEndpointTests.test_secretary_sees_only_active_authors()` | Secretary sees only active authors. |
| 164 | `OrdinanceAuthorEndpointTests.test_secretary_cannot_see_inactive_even_with_include_inactive()` | Secretary cannot see inactive even with include inactive. |
| 170 | `OrdinanceAuthorEndpointTests.test_admin_can_see_inactive_with_include_inactive()` | Admin can see inactive with include inactive. |
| 176 | `OrdinanceAuthorEndpointTests.test_captain_cannot_read_the_roster()` | Captain cannot read the roster. |
| 180 | `OrdinanceAuthorEndpointTests.test_anonymous_cannot_read_the_roster()` | Anonymous cannot read the roster. |
| 183 | `OrdinanceAuthorEndpointTests.test_position_display_is_included()` | Position display is included. |
| 189 | `OrdinanceAuthorEndpointTests.test_secretary_cannot_create_an_author()` | Secretary cannot create an author. |
| 196 | `OrdinanceAuthorEndpointTests.test_admin_can_create_an_author_and_it_is_logged()` | Admin can create an author and it is logged. |
| 205 | `OrdinanceAuthorEndpointTests.test_admin_can_deactivate_an_author()` | Admin can deactivate an author. |
| 214 | `OrdinanceAuthorEndpointTests.test_secretary_cannot_edit_or_delete_an_author()` | Secretary cannot edit or delete an author. |
| 222 | `OrdinanceAuthorEndpointTests.test_admin_can_delete_an_author()` | Admin can delete an author. |
| 229 | **`OrdinanceAuthorSingleSeatTests`** | Only one active Punong Barangay and one active SK Chairperson at a time (one seat each) — Barangay Kagawad has 7 seats, so no such limit there. |
| 235 | `OrdinanceAuthorSingleSeatTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 245 | `OrdinanceAuthorSingleSeatTests._create()` |  create. |
| 248 | `OrdinanceAuthorSingleSeatTests.test_cannot_create_a_second_active_captain()` | Cannot create a second active captain. |
| 254 | `OrdinanceAuthorSingleSeatTests.test_cannot_create_a_second_active_sk_chairperson()` | Cannot create a second active sk chairperson. |
| 259 | `OrdinanceAuthorSingleSeatTests.test_multiple_active_kagawad_are_allowed()` | Multiple active kagawad are allowed. |
| 264 | `OrdinanceAuthorSingleSeatTests.test_can_add_a_captain_once_the_sitting_one_is_inactive()` | Can add a captain once the sitting one is inactive. |
| 270 | `OrdinanceAuthorSingleSeatTests.test_renaming_the_sitting_captain_does_not_trip_the_check_on_themselves()` | Renaming the sitting captain does not trip the check on themselves. |
| 276 | `OrdinanceAuthorSingleSeatTests.test_promoting_a_kagawad_into_the_taken_captain_seat_is_rejected()` | Promoting a kagawad into the taken captain seat is rejected. |
| 285 | `OrdinanceAuthorSingleSeatTests.test_reactivating_a_former_captain_while_another_is_active_is_rejected()` | Reactivating a former captain while another is active is rejected. |
| 294 | `OrdinanceAuthorSingleSeatTests.test_deactivating_the_sitting_captain_is_unaffected_by_the_check()` | Deactivating the sitting captain is unaffected by the check. |
| 299 | **`OrdinanceCategoryEndpointTests`** | Mirrors OrdinanceAuthorEndpointTests — same CRUD/permission shape, different resource. |
| 302 | `OrdinanceCategoryEndpointTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 313 | `OrdinanceCategoryEndpointTests.test_secretary_sees_only_active_categories()` | Secretary sees only active categories. |
| 321 | `OrdinanceCategoryEndpointTests.test_admin_can_see_inactive_with_include_inactive()` | Admin can see inactive with include inactive. |
| 327 | `OrdinanceCategoryEndpointTests.test_captain_cannot_read_the_list()` | Captain cannot read the list. |
| 331 | `OrdinanceCategoryEndpointTests.test_anonymous_cannot_read_it()` | Anonymous cannot read it. |
| 334 | `OrdinanceCategoryEndpointTests.test_secretary_cannot_create_a_category()` | Secretary cannot create a category. |
| 338 | `OrdinanceCategoryEndpointTests.test_admin_can_create_a_category_and_it_is_logged()` | Admin can create a category and it is logged. |
| 345 | `OrdinanceCategoryEndpointTests.test_duplicate_category_name_is_rejected()` | Duplicate category name is rejected. |
| 350 | `OrdinanceCategoryEndpointTests.test_admin_can_retire_a_category()` | Admin can retire a category. |
| 357 | `OrdinanceCategoryEndpointTests.test_secretary_cannot_edit_or_delete_a_category()` | Secretary cannot edit or delete a category. |
| 365 | `OrdinanceCategoryEndpointTests.test_admin_can_delete_a_category()` | Admin can delete a category. |
| 372 | **`OrdinanceCreateWithAuthorAndCategoryTests`** | The upload/edit endpoints themselves. Author is free text again (no author_id — the roster only backs autocomplete suggestions client-side); category still has to name a currently-active OrdinanceCategory. |
| 379 | `OrdinanceCreateWithAuthorAndCategoryTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 387 | `OrdinanceCreateWithAuthorAndCategoryTests._payload()` |  payload. |
| 395 | `OrdinanceCreateWithAuthorAndCategoryTests.test_create_stores_author_and_category_as_plain_text()` | Create stores author and category as plain text. |
| 402 | `OrdinanceCreateWithAuthorAndCategoryTests.test_author_is_not_validated_against_the_roster()` | Author is not validated against the roster. |
| 412 | `OrdinanceCreateWithAuthorAndCategoryTests.test_non_pdf_file_is_rejected_with_the_file_message()` | Non pdf file is rejected with the file message. |
| 422 | `OrdinanceCreateWithAuthorAndCategoryTests.test_extract_endpoint_is_gone()` | Extract endpoint is gone. |
| 426 | `OrdinanceCreateWithAuthorAndCategoryTests.test_missing_author_is_still_rejected()` | Missing author is still rejected. |
| 433 | `OrdinanceCreateWithAuthorAndCategoryTests.test_invalid_category_is_rejected()` | Invalid category is rejected. |
| 438 | `OrdinanceCreateWithAuthorAndCategoryTests.test_retired_category_cannot_be_assigned_to_a_new_ordinance()` | Retired category cannot be assigned to a new ordinance. |
| 444 | `OrdinanceCreateWithAuthorAndCategoryTests.test_editing_can_change_just_the_title_and_keeps_author_and_category()` | Editing can change just the title and keeps author and category. |
| 452 | `OrdinanceCreateWithAuthorAndCategoryTests.test_renaming_a_category_does_not_change_an_already_uploaded_ordinance()` | Renaming a category does not change an already uploaded ordinance. |
| 461 | **`OrdinanceQuerySetShortcutTests`** | Group of tests: ordinance query set shortcut. |
| 462 | `OrdinanceQuerySetShortcutTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 467 | `OrdinanceQuerySetShortcutTests.test_published_shortcut()` | Published shortcut. |

#### `siteinfo/tests.py`

| Line | Test | What it checks |
|---:|---|---|
| 21 | `png()` | Helper used by the tests: png. |
| 28 | **`AboutUsTests`** | Group of tests: about us. |
| 30 | `AboutUsTests.tearDownClass()` | Teardownclass. |
| 34 | `AboutUsTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 40 | `AboutUsTests._logs()` |  logs. |
| 45 | `AboutUsTests.test_guests_can_read_the_seeded_about_page()` | Guests can read the seeded about page. |
| 52 | `AboutUsTests.test_hidden_members_and_logos_are_left_off_the_public_page()` | Hidden members and logos are left off the public page. |
| 61 | `AboutUsTests.test_only_admins_can_edit()` | Only admins can edit. |
| 70 | `AboutUsTests.test_admin_updates_details_and_the_log_names_what_changed()` | Admin updates details and the log names what changed. |
| 79 | `AboutUsTests.test_invalid_email_is_rejected()` | Invalid email is rejected. |
| 85 | `AboutUsTests.test_add_member_with_photo_goes_to_the_end_of_its_row()` | Add member with photo goes to the end of its row. |
| 98 | `AboutUsTests.test_non_image_and_oversized_uploads_are_rejected()` | Non image and oversized uploads are rejected. |
| 113 | `AboutUsTests.test_edit_hide_and_delete_member_are_logged()` | Edit hide and delete member are logged. |
| 123 | `AboutUsTests.test_reorder_sets_order_from_list_position()` | Reorder sets order from list position. |
| 132 | `AboutUsTests.test_reorder_with_unknown_id_changes_nothing()` | Reorder with unknown id changes nothing. |
| 141 | `AboutUsTests.test_new_logo_needs_an_image()` | New logo needs an image. |
| 148 | `AboutUsTests.test_multipart_upload_without_visibility_defaults_to_shown()` | Multipart upload without visibility defaults to shown. |
| 157 | `AboutUsTests.test_partial_multipart_edit_keeps_visibility()` | Partial multipart edit keeps visibility. |
| 166 | `AboutUsTests.test_has_custom_photo_is_false_for_seeded_and_true_after_upload()` | Has custom photo is false for seeded and true after upload. |
| 175 | **`BoundaryTests`** | Group of tests: boundary. |
| 178 | `BoundaryTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 184 | `BoundaryTests.test_anyone_can_read_the_seeded_outline()` | Anyone can read the seeded outline. |
| 189 | `BoundaryTests.test_only_admins_can_replace_it()` | Only admins can replace it. |
| 196 | `BoundaryTests.test_admin_saves_it_drops_a_repeated_closing_point_and_logs_it()` | Admin saves it drops a repeated closing point and logs it. |
| 206 | `BoundaryTests.test_empty_list_removes_it()` | Empty list removes it. |
| 212 | `BoundaryTests.test_rejects_too_few_points_and_swapped_coordinates()` | Rejects too few points and swapped coordinates. |

#### `announcements/tests.py`

| Line | Test | What it checks |
|---:|---|---|
| 17 | `_auth()` | Helper used by the tests: auth. |
| 21 | **`AnnouncementTests`** | Group of tests: announcement. |
| 22 | `AnnouncementTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 36 | `AnnouncementTests.test_secretary_can_post_and_every_citizen_is_emailed()` | Secretary can post and every citizen is emailed. |
| 49 | `AnnouncementTests.test_investigator_cannot_post()` | Investigator cannot post. |
| 57 | `AnnouncementTests.test_unread_banner_clears_after_marking_viewed()` | Unread banner clears after marking viewed. |
| 66 | `AnnouncementTests.test_guest_sees_announcements_without_read_state()` | Guest sees announcements without read state. |
| 74 | `_png()` | Helper used by the tests: png. |
| 80 | **`AnnouncementEditTests`** | Group of tests: announcement edit. |
| 81 | `AnnouncementEditTests.setUp()` | Creates the accounts and data the tests in this class start from. |
| 103 | `AnnouncementEditTests.test_editing_adds_replaces_and_removes_the_picture_without_emailing()` | Editing adds replaces and removes the picture without emailing. |
| 126 | `AnnouncementEditTests.test_editing_text_alone_keeps_the_picture()` | Editing text alone keeps the picture. |

### 15.9 The study's Modified Blowfish files (`research/modified_blowfish/`)

#### `research/modified_blowfish/dissecting_modif_blowfish.py`

Educational, step-by-step view of modified_blowfish.py's text encryption flow.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 30 | `show_bytes()` | Print bytes as readable hex while also showing their length. | this file |
| 35 | `main()` | Encrypts the word "Binan" step by step (random demo key → salt → PBKDF2 key → padding → IV → Blowfish-CBC) and prints every intermediate value, then decrypts it back. | this file |

#### `research/modified_blowfish/modified_blowfish.py`

Modified Blowfish Data Protection Algorithm -------------------------------------------- Implements the two-component modification described in the capstone study:

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 38 | **`EncryptedRecord`** (class) | Everything that gets stored in the database for one encrypted field. | this file, orms_backend/encrypted_storage.py |
| 44 | `EncryptedRecord.to_dict()` | Serialize to base64 strings, suitable for DB storage / JSON. |  |
| 53 | `EncryptedRecord.from_dict()` | Turns the stored base64 strings (salt, iv, ciphertext) back into bytes. |  |
| 64 | `derive_key()` | Derive a per-record subkey from the master secret and a per-record salt using PBKDF2-HMAC-SHA256 (Moriarty et al., 2017). | this file, research/modified_blowfish/verify_system_matches_demo.py |
| 84 | `encrypt_record()` | Encrypt a single record/field using the modified Blowfish scheme. Steps: 1. Generate random salt -> derive per-record key via PBKDF2 2. Generate random IV 3. PKCS7-pad plaintext to Blowfish's 8-byte block size 4. Encrypt with Blowfish-CBC using the derived key and IV | this file, orms_backend/encrypted_storage.py, research/modified_blowfish/test_modified_blowfish.py |
| 110 | `decrypt_record()` | Decrypt a record encrypted with encrypt_record(). Steps: 1. Recompute the per-record key from the stored salt + master key 2. Decrypt with Blowfish-CBC using the stored IV 3. Remove PKCS7 padding | this file, orms_backend/encrypted_storage.py, research/modified_blowfish/test_modified_blowfish.py |
| 135 | `encrypt_text()` | Encrypt a UTF-8 string and return a JSON/DB-storable dict. | this file, orms_backend/encrypted_fields.py, research/modified_blowfish/test_modified_blowfish.py, research/modified_blowfish/verify_system_matches_demo.py |
| 142 | `decrypt_text()` | Decrypt a dict produced by encrypt_text() back to the original string. | orms_backend/encrypted_fields.py, orms_backend/tests.py, research/modified_blowfish/test_modified_blowfish.py, research/modified_blowfish/verify_system_matches_demo.py |

#### `research/modified_blowfish/modified_blowfish_walkthrough.py`

Modified Blowfish -- STEP-BY-STEP WALKTHROUGH (for study purposes) -------------------------------------------------------------------- This script does the SAME thing as modified_blowfish.py, but instead of calling modes.CBC() as one black-box operation, it manually performs the CBC chaining block-by-block using Blowfish in ECB mode as the raw "encrypt one 8-byte block" primitive, so you can see …

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 36 | `hexline()` | Pretty-print a labeled hex dump. | this file |
| 41 | `xor_bytes()` | XORs two byte strings (the CBC chaining step done by hand). | this file |
| 45 | `derive_record_key()` | Derive the same per-record Blowfish key during encryption and decryption. | this file |
| 57 | `blowfish_encrypt_block()` | Encrypt one block with ECB as the raw primitive for manual CBC chaining. | this file |
| 65 | `blowfish_decrypt_block()` | Decrypts exactly one 8-byte block with plain Blowfish (ECB) — the building block of the hand-made CBC. | this file |
| 72 | `encrypt_walkthrough()` | Show each stage of encrypting a UTF-8 string with manual CBC chaining. | this file |
| 153 | `decrypt_walkthrough()` | Show each stage of manually decrypting a CBC-encrypted string. | this file |
| 207 | `main()` | Run the example encryption/decryption round trip. | this file |

#### `research/modified_blowfish/test_modified_blowfish.py`

Correctness and demonstration tests for the Modified Blowfish scheme. Run: python3 test_modified_blowfish.py

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 17 | `test_basic_roundtrip()` | Encrypt then decrypt gives back the same text. | this file |
| 32 | `test_wrong_key_fails()` | Decrypting with a different master key fails. | this file |
| 49 | `test_identical_plaintexts_differ()` | The same text encrypted twice gives different salts, IVs and ciphertexts, and both decrypt correctly. | this file |
| 73 | `test_tampered_ciphertext_fails()` | A changed ciphertext no longer decrypts correctly. | this file |
| 97 | `benchmark()` | Times encrypting and decrypting many records at a given PBKDF2 iteration count. | this file |

#### `research/modified_blowfish/verify_system_matches_demo.py`

Shows that the running system and the demo use the same Modified Blowfish algorithm, by making each one read what the other wrote.

| Line | Name | What it does | Used by |
|---:|---|---|---|
| 66 | `rule()` | Prints a section heading line. | this file, accounts/permissions.py, accounts/serializers.py |
| 70 | `short()` | Shortens long text for printing. | this file, orms_backend/encrypted_storage.py, reports/migrations/0010_seed_faqs.py, reports/verification.py, siteinfo/migrations/0012_reword_safespace_in_about_and_legal.py |
| 75 | `main()` | Runs every check: system-encrypted values decrypt with the study's file, demo-encrypted values decrypt in the system, and both derive the same key; prints MATCH/MISMATCH and the result. | this file |
