"""
Samples the server machine once a second while a test runs, so the paper can
say *why* the system slows or breaks (CPU maxed, memory growing, database
connections used up), not just *when*.

    python stress_test/monitor.py results/monitor_4B.csv

Stop it with Ctrl+C. Run it on the machine that runs the server.
Columns: time, total CPU %, RAM used MB, server process RSS MB (gunicorn /
waitress / python workers combined), Postgres connections to the stress DB.
"""

import csv
import os
import sys
import time
from datetime import datetime

import psutil

SERVER_NAMES = ("gunicorn", "waitress-serve", "python")


def server_rss_mb():
    total = 0
    me = os.getpid()
    for p in psutil.process_iter(["name", "cmdline", "memory_info"]):
        try:
            cmd = " ".join(p.info["cmdline"] or [])
            if p.pid != me and "stress_test.wsgi" in cmd:
                total += p.info["memory_info"].rss
        except (psutil.NoSuchProcess, psutil.AccessDenied, TypeError):
            continue
    return total / 1024 / 1024


def db_connections(cursor):
    if cursor is None:
        return ""
    cursor.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()")
    return cursor.fetchone()[0]


def main(out_path):
    cursor = None
    url = os.environ.get("STRESS_DATABASE_URL")
    if url:
        import psycopg2
        conn = psycopg2.connect(url)
        conn.autocommit = True
        cursor = conn.cursor()

    psutil.cpu_percent()  # first call primes the counter
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["time", "cpu_percent", "ram_used_mb", "server_rss_mb", "db_connections"])
        print(f"Writing to {out_path}; Ctrl+C to stop.")
        try:
            while True:
                time.sleep(1)
                writer.writerow([
                    datetime.now().strftime("%H:%M:%S"),
                    psutil.cpu_percent(),
                    round(psutil.virtual_memory().used / 1024 / 1024),
                    round(server_rss_mb()),
                    db_connections(cursor),
                ])
                f.flush()
        except KeyboardInterrupt:
            print("Stopped.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "results/monitor.csv")
