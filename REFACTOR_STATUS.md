# Refactor Status

**Goal:** Make the source code easier to understand (4th-year BSIT level) without
changing behavior. Normalize the database to 3NF, organize files so an intern can
follow them, keep only essential code, keep the Modified Blowfish algorithm unchanged,
and document everything in `SYSTEM_GUIDE.md`.

**Branch:** `refactor/clean-architecture` (the original code is preserved on `final`).

## Step 0 verdict (2026-10-19)

**PARTIAL**: an earlier session had finished the refactor's code but left it all
uncommitted, with no status file. Nothing was half-edited:

- `manage.py check` and `makemigrations --check`: no issues
- Every HTML/CSS file reference resolves; no removed JS function is still called
- `orms_backend/modified_blowfish.py` untouched; encryption wrappers changed in comments only
- Test suite: 235 run, 235 passed

The user approved keeping the work, and it was committed in the batches below.

## Checklist

- [x] **Batch 1: Repository housekeeping** (`3437d71`): `research/` folder, unused root assets removed
- [x] **Batch 2: Backend simplification** (`8a39d15`): `accounts`, `reports`, `ordinances`,
      `announcements`, `orms_backend`, `requirements.txt`, `build.sh`, new injection/resistance tests.
      Verified on its own: 235/235 tests pass.
- [x] **Batch 3: Database 3NF** (`adbd7bf`): `siteinfo` models, serializers, views and
      migration `0016_normalize_json_lists`
- [x] **Batch 4: Frontend** (`f875d38`): `frontend/shared/`, shared JS, layout/nav files, CSS clean-up
- [x] **Batch 5: Documentation**: `SYSTEM_GUIDE.md`, `README.md`, `CONTRIBUTING.md`, this file
- [x] **Batch 6: Merge team changes from `origin/final`** (4 commits by hsakA, 2026-10-19)
  - Plain-Python TF-IDF in `ordinances/matching.py` + `stop_words.py` kept; `scikit-learn` dropped.
    Compared with the scikit-learn version: same stop words, 0 differences in 3,000 random cases.
  - `siteinfo/0015_remove_streets_outside_boundary` kept; the 3NF migration was renamed
    `0016_normalize_json_lists` and now runs after it.
  - `frontend/staff/js/reports-data.js` on `origin/final` had leftover conflict markers (a JS
    syntax error); resolved to the working "Are you sure?" claim prompt.
  - `ordinances/extraction.py` (OCR prefill, deleted in `6d3fa51`, nothing calls it) came back
    by accident in the teammate's merge; left out again.
- [x] **Batch 7: Requirements audit + complete function reference**
  - Behavior: 558 API requests (every route, as guest/citizen/captain/secretary/investigator/admin,
    including errors and SQL-injection input) gave identical answers on old and new code.
  - Frontend and responsiveness: every page of all three portals at 390 / 768 / 1440 px in headless
    Chrome (234 page loads): no JS errors, no failed files, no sideways scrolling, and the same text
    and screenshots as the old code (only clock text like "10 minutes ago" differs).
  - Performance: same response times (12 main endpoints: 84 ms old vs 83 ms new); the 3NF tables
    add a fixed 1–2 queries, not one per row.
  - `SYSTEM_GUIDE.md` section 15: every file (224/224) and every function, class and method
    (1,667/1,667) with its line, what it does and who uses it; plus an email-template table and
    every test explained.
  - Stale comments that still named removed files (`admin.js`, the old `main.js`) updated.
- [ ] **Apply migrations to each database.** The local `db.sqlite3` is missing `reports/0021`,
      `siteinfo/0015` and `siteinfo/0016`. Run `python manage.py migrate`.
- [x] **Batch 8: Leftover code, admin notification, `final` fix**
  - Unused `archiveOrdinanceById()`, `unarchiveOrdinanceById()` and `readFirstError()` removed from
    `staff/js/ordinances-data.js` (no page calls them; the archive API is unchanged and still tested).
  - The picture checks copied in `admin/js/about-setup.js` and `admin/js/website-setup.js` now live
    once in `admin/js/image-picker.js`, loaded by both pages. Same results as before for good,
    too-small and non-image files on every picker.
  - Admin "New action logs" notification fixed: it showed "… logged in at undefined"; it now shows
    "Owner (Account type): Action — time" (`checkForNewAuditLogs()` in `admin/js/layout.js`).
  - Conflict markers on `final`: fixed on branch `fix/final-conflict-markers` (`5c2aaf1`, based on
    `origin/final`). Only the 8 marker lines are removed. **Not yet on GitHub's `final`** (pushing to
    the shared branch needs the owner's go-ahead).
  - `SYSTEM_GUIDE.md` §6.4, §10.3, §14.6 and the function reference updated.
- [ ] **Push `fix/final-conflict-markers` to `final`** (or open a PR from it). Until then the staff
      Reports pages on `final` are broken.

## Latest test results

| Suite | Result |
|---|---|
| `python manage.py test` (unit, integration, SQL injection, brute force/lockout, resistance, encryption) | 235 run, 235 passed |
| `research/modified_blowfish/test_modified_blowfish.py` | All passed |
| `research/modified_blowfish/verify_system_matches_demo.py` | Every check matched |
| API comparison old vs new (558 requests) | Identical |
| Browser comparison old vs new (234 page loads, 3 widths) | Identical; 0 JS errors; no horizontal overflow |

Not automated in the repository: Firefox/Safari (only Chromium was tested) and real phones/tablets.

## Next step

Get the `final` fix onto GitHub, then apply the migrations. No code batches remain.
