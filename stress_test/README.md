# Stress testing kit (capstone, Section 4.3.1)

Everything needed to produce the stress-testing tables yourself:

| File | What it does |
|---|---|
| `settings.py` | Test-only settings: separate database, no real emails, local uploads, rate limits on/off |
| `wsgi.py` | Server entry point; bypasses File Report's cooldown/verification so reports can be submitted repeatedly |
| `seed.py` | Creates 300 test citizens, a `flood@` account, and test ordinances |
| `locustfile.py` | The test scenarios (browse, about, profile, TF-IDF match, login, login flood, file report, mixed) |
| `run_tests.ps1` | Runs one whole table (3 repeats per row) and prints the results |
| `summarize.py` | Turns the raw results into table rows (mean ± SD across repeats) |
| `monitor.py` | Logs CPU / RAM / DB connections every second while a test runs |

Nothing here touches your real database. All test data goes into a separate
`orms_stress` database.

---

## 1. One-time setup

Open PowerShell in `C:\orms-project`. If activating the venv fails with
"running scripts is disabled on this system", allow scripts once for your user:
`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.

```powershell
.\venv\Scripts\Activate.ps1
pip install -r stress_test\requirements.txt

# A separate, throwaway database (uses the same postgres password as your .env)
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres orms_stress

# Tell the stress settings where it is. Set this in EVERY terminal you use for the server, seeding or monitoring.
$env:STRESS_DATABASE_URL = "postgresql://postgres:YOUR_PASSWORD@localhost:5432/orms_stress"
$env:DJANGO_SETTINGS_MODULE = "stress_test.settings"

python manage.py migrate
python manage.py createcachetable
python -m stress_test.seed --citizens 300 --ordinances 40
```

`DATA_ENCRYPTION_KEY` still comes from your `.env`, so encryption runs exactly as in production.

## 2. Start the server (terminal 1)

Gunicorn does not run on Windows, so pick one:

**Option A: Windows, Waitress (simplest)**
```powershell
$env:STRESS_DATABASE_URL = "postgresql://postgres:YOUR_PASSWORD@localhost:5432/orms_stress"
$env:STRESS_THROTTLE = "off"        # "on" for Table 4.C
waitress-serve --threads=8 --listen=0.0.0.0:8000 stress_test.wsgi:application *> server.log
```
The `*> server.log` sends the server's messages to a file (open it to see errors).
Without it, **clicking inside the server window freezes the server**: Windows pauses a
program whose window is in text-select mode (title starts with "Select"), and
every request then times out. Press Esc to resume it, or switch it off for good:
right-click the title bar → Properties → untick *QuickEdit Mode*.

Waitress is one Python process, so CPU-heavy work (PBKDF2 logins,
encryption, TF-IDF) uses only one core. Say so in the paper ("Waitress,
1 process × 8 threads").

**Option B: WSL + Gunicorn (same server software as Render)**
Install WSL once (`wsl --install`, reboot). Inside Ubuntu, create a Linux venv,
`pip install -r requirements.txt`, point `STRESS_DATABASE_URL` at the Windows
Postgres (use the Windows host IP, and allow it in `pg_hba.conf`), then:
```bash
STRESS_THROTTLE=off gunicorn stress_test.wsgi -w 4 --threads 2 -b 0.0.0.0:8000
```

**Match what you write in the paper to what you ran.** Render's Procfile starts
Gunicorn without `--workers`, so production is probably **1 worker**. Check the
Render logs after a deploy and count the `Booting worker with pid` lines.

## 3. Run the tests (terminal 2)

```powershell
.\venv\Scripts\Activate.ps1
.\stress_test\run_tests.ps1 -Table A       # Table 4.A  load test by scenario      (~5-10 min)
.\stress_test\run_tests.ps1 -Table B       # Table 4.B  rising concurrency 10→500  (~10 min)
.\stress_test\run_tests.ps1 -Table Break   # NEW        step to 1,000 users        (~20 min)
.\stress_test\run_tests.ps1 -Table Spike   # NEW        20 → 300 → 20 users        (~12 min)
.\stress_test\run_tests.ps1 -Table Soak    # NEW        100 realistic users, 30 min
```

For **Table 4.C**, stop the server, restart it with `$env:STRESS_THROTTLE = "on"`, then:
```powershell
.\stress_test\run_tests.ps1 -Table C
```
The "2xx" and "429" columns are your Served/Rejected numbers. With 1 Waitress
process, 600 anonymous requests should give about 120 served and 480 rejected.
With 4 Gunicorn workers you'll see about 480 served, because each worker keeps its
own counter. To show the fix, restart with `$env:STRESS_CACHE = "db"` (one
shared counter) and run Table C again.

Each table prints rows like:
```
Scenario | Users | Runs | Total req | Throughput (req/s) | Avg (ms) | 95th % (ms) | Max (ms) | Success % | 2xx | 429 | Other
MyProfile | 50 | 3 | 1,046 | 235.8 ± 6.1 | 212 | 360 | 4,117 | 100.0% | 1046 | 0 | 0
```
Raw files are in `results\<Table>\`. The `*_stats_history.csv` files hold
second-by-second users / RPS / latency, which is what you plot for the
Break, Spike and Soak graphs.

## 4. Record what the server was doing (terminal 3, optional but recommended)

```powershell
$env:STRESS_DATABASE_URL = "postgresql://postgres:YOUR_PASSWORD@localhost:5432/orms_stress"
python stress_test\monitor.py results\monitor_B.csv
```
Start it before a table, press Ctrl+C after. This lets the paper say *why*
throughput levels off (e.g. "CPU reached 100% at 100 users"), not just *that*
it did.

## 5. Between tests

```powershell
python -m stress_test.seed --reset      # deletes test reports, unlocks test accounts
```
Run it before each table, especially after FileReport and LoginFlood. FileReport
adds hundreds of reports, and LoginFlood locks the `flood@` account.

## 6. Good practice (put these in your Test Environment paragraph)

- Close other programs and keep the laptop plugged in. Run each table 3 times (the default).
- **The load generator competes with the server for CPU** when both run on the
  same laptop. Better: run the server on one laptop, run Locust on another on the
  same Wi-Fi with `-TargetHost http://<server-laptop-ip>:8000`, and allow port 8000
  through Windows Firewall on the server laptop.
- With the limits off, all simulated users come from one IP. With limits on, they
  share one 120/min allowance, which is what a barangay hall behind one internet
  connection would see.
- State what was changed for testing: limits lifted (Tables A/B), File Report
  cooldown/verification bypassed, emails not sent.

## 7. A small check against the real Render site (optional)

Render keeps its rate limits on, and the test accounts don't exist there, so only
measure a light baseline. 100 anonymous requests from one user stays under the
120/min limit:
```powershell
$env:STRESS_MAX_REQUESTS = "100"; $env:STRESS_RESULT = "results\render\BrowseOrdinances_u1_r1"
locust -f stress_test\locustfile.py --host https://<your-app>.onrender.com --headless -u 1 -r 1 -t 2m --only-summary BrowseOrdinances
python stress_test\summarize.py results\render
```
Open the site once beforehand. A sleeping free-tier instance makes the first request take many seconds.
