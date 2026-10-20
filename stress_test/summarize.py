"""
Turns the test runs into the rows of the paper's tables.

    python stress_test/summarize.py results/

Expects files named <scenario>_u<users>_r<run>_summary.csv / _status.csv
(what run_tests.ps1 writes). Runs of the same scenario and user count are
averaged, with the standard deviation of throughput shown, so run-to-run
variance is reported instead of hidden.
"""

import csv
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

NAME = re.compile(r"(?P<scenario>.+)_u(?P<users>\d+)_r(?P<run>\d+)_summary\.csv$")


def read_rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main(folder):
    groups = defaultdict(list)
    for path in sorted(Path(folder).glob("*_summary.csv")):
        m = NAME.search(path.name)
        if not m:
            continue
        summary = read_rows(path)[0]
        if int(summary["requests"]) == 0:
            continue
        status_path = path.with_name(path.name.replace("_summary.csv", "_status.csv"))
        status = {r["status"]: int(r["count"]) for r in read_rows(status_path)} if status_path.exists() else {}
        groups[(m["scenario"], int(m["users"]))].append((summary, status))

    header = ["Scenario", "Users", "Runs", "Total req", "Throughput (req/s)", "Avg (ms)",
              "95th % (ms)", "Max (ms)", "Success %", "2xx", "429", "Other"]
    print(" | ".join(header))
    for (scenario, users), runs in sorted(groups.items()):
        def mean(key):
            return statistics.mean(float(s[key]) for s, _ in runs)

        rps = [float(s["rps"]) for s, _ in runs]
        rps_text = f"{statistics.mean(rps):.1f}" + (f" ± {statistics.stdev(rps):.1f}" if len(rps) > 1 else "")
        success = 100 * (1 - mean("failures") / mean("requests"))

        codes = defaultdict(int)
        for _, status in runs:
            for code, n in status.items():
                codes[code] += n
        n = len(runs)
        ok = sum(v for c, v in codes.items() if c.startswith("2"))
        limited = codes.get("429", 0)
        other = sum(codes.values()) - ok - limited

        print(" | ".join(str(v) for v in [
            scenario, users, n, f"{mean('requests'):,.0f}", rps_text, f"{mean('avg_ms'):,.0f}",
            f"{mean('p95_ms'):,.0f}", f"{max(float(s['max_ms']) for s, _ in runs):,.0f}",
            f"{success:.1f}%", round(ok / n), round(limited / n), round(other / n),
        ]))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "results")
