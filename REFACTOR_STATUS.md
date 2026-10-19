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
- [ ] **Manual browser spot-check (requirement 6).** Open a few pages per portal at phone
      (about 390 px) and desktop widths. The earlier session reports a 541-screenshot comparison,
      but it has not been re-checked in a browser since.
- [x] **Batch 6: Merge team changes from `origin/final`** (4 commits by hsakA, 2026-10-19)
  - Plain-Python TF-IDF in `ordinances/matching.py` + `stop_words.py` kept; `scikit-learn` dropped.
    Compared with the scikit-learn version: same stop words, 0 differences in 3,000 random cases.
  - `siteinfo/0015_remove_streets_outside_boundary` kept; the 3NF migration was renamed
    `0016_normalize_json_lists` and now runs after it.
  - `frontend/staff/js/reports-data.js` on `origin/final` had leftover conflict markers (a JS
    syntax error); resolved to the working "Are you sure?" claim prompt.
  - `ordinances/extraction.py` (OCR prefill, deleted in `6d3fa51`, nothing calls it) came back
    by accident in the teammate's merge; left out again.
- [ ] **Apply migrations to each database.** The local `db.sqlite3` is missing `reports/0021`,
      `siteinfo/0015` and `siteinfo/0016`. Run `python manage.py migrate`.
- [ ] **Fix `origin/final` too (team decision).** `final` on GitHub still has the conflict markers in
      `frontend/staff/js/reports-data.js`, so its staff Reports pages are broken until fixed there.
- [ ] **Owner decision:** the known admin "logged in at undefined" notification bug
      (SYSTEM_GUIDE.md §14.6). It was left as-is because behavior must not change.

## Latest test results

| Suite | Result |
|---|---|
| `python manage.py test` (unit, integration, SQL injection, brute force/lockout, resistance, encryption) | 235 run, 235 passed |
| `research/modified_blowfish/test_modified_blowfish.py` | All passed |
| `research/modified_blowfish/verify_system_matches_demo.py` | Every check matched |

## Next step

Run the manual browser spot-check, then apply the migrations. No code batches remain.
