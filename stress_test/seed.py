"""
Fills the stress test database with test citizens and ordinances.

    python -m stress_test.seed --citizens 300 --ordinances 40
    python -m stress_test.seed --ordinances 1000 --reset     (data-volume test)

Citizens are stress0001@stress.test ... with password STRESS_PASSWORD below,
plus flood@stress.test, the account LoginFlood hammers with wrong passwords
(kept separate so its lockout never blocks the other scenarios).

--reset also deletes the reports earlier runs filed and unlocks every test
account, so each test starts from the same state.
"""

import argparse
import os
import random
from datetime import date, timedelta

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "stress_test.settings")

import django  # noqa: E402

django.setup()

from django.contrib.auth.hashers import make_password  # noqa: E402

from accounts.models import User  # noqa: E402
from ordinances.models import Ordinance  # noqa: E402
from reports.models import Report  # noqa: E402

STRESS_PASSWORD = "Stress-Test#2026"
EMAIL_DOMAIN = "stress.test"

# Violation topics a barangay ordinance typically covers, combined into
# varied titles/descriptions so TF-IDF has a realistic vocabulary to rank.
TOPICS = [
    ("smoking", "smoking in public places, enclosed areas and public utility vehicles"),
    ("noise", "excessive noise, loud karaoke and videoke during night hours"),
    ("littering", "littering, illegal dumping and improper disposal of garbage"),
    ("curfew", "curfew hours for minors and unaccompanied children at night"),
    ("parking", "illegal parking and obstruction of sidewalks and roads"),
    ("stray animals", "stray dogs, unleashed pets and animal impoundment"),
    ("burning", "open burning of garbage, leaves and plastic waste"),
    ("liquor", "drinking liquor in streets, sidewalks and public areas"),
    ("segregation", "waste segregation at source, biodegradable and recyclable materials"),
    ("vending", "unauthorized street vending and use of public roads for business"),
    ("drainage", "clogging of canals, drainage and esteros with solid waste"),
    ("half-naked", "going out half-naked or without a shirt in public places"),
    ("tricycle", "tricycle franchising, routes and terminal regulation"),
    ("construction", "construction permits, debris and obstruction on roads"),
    ("gambling", "illegal gambling, cara y cruz and card games in public"),
]
CATEGORIES = ["Health and Sanitation", "Peace and Order", "Environment", "Traffic", "General Welfare"]


def seed_citizens(count):
    password_hash = make_password(STRESS_PASSWORD)  # hashed once; PBKDF2 per user would take minutes
    existing = set(User.objects.filter(email__endswith="@" + EMAIL_DOMAIN).values_list("email", flat=True))
    users = []
    emails = [f"stress{i:04d}@{EMAIL_DOMAIN}" for i in range(1, count + 1)] + [f"flood@{EMAIL_DOMAIN}"]
    for i, email in enumerate(emails, start=1):
        if email in existing:
            continue
        users.append(User(
            email=email,
            username=email,
            role=User.Role.CITIZEN,
            first_name="Stress",
            last_name=f"Tester {i:04d}",
            contact_number="09170000000",
            address="Purok 1, Barangay Platero, Biñan City",
            is_verified=True,
            is_active=True,
            password=password_hash,
        ))
    User.objects.bulk_create(users, batch_size=500)
    print(f"Citizens: {len(users)} created ({len(existing)} already existed).")


def seed_ordinances(count):
    rng = random.Random(42)
    existing = Ordinance.objects.filter(number__startswith="Stress Ord.").count()
    ordinances = []
    for i in range(existing + 1, count + 1):
        main, other = rng.sample(TOPICS, 2)
        ordinances.append(Ordinance(
            number=f"Stress Ord. No. {i}-(2026)",
            title=f"An Ordinance Regulating {main[0].title()} and Penalizing {main[1]} in Barangay Platero",
            author="Sangguniang Barangay (stress test)",
            category=rng.choice(CATEGORIES),
            date_approved=date(2016, 1, 1) + timedelta(days=rng.randint(0, 3650)),
            description=(
                f"This ordinance prohibits {main[1]}. It also covers related concerns on "
                f"{other[1]}. Violators shall be fined and may render community service."
            ),
            pdf_file="ordinances/stress/placeholder.pdf",
        ))
    Ordinance.objects.bulk_create(ordinances, batch_size=500)
    print(f"Ordinances: {len(ordinances)} created ({existing} already existed).")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--citizens", type=int, default=300)
    parser.add_argument("--ordinances", type=int, default=40)
    parser.add_argument("--reset", action="store_true",
                        help="remove earlier stress ordinances and reports, unlock test accounts")
    args = parser.parse_args()

    if args.reset:
        deleted, _ = Ordinance.objects.filter(number__startswith="Stress Ord.").delete()
        print(f"Removed {deleted} earlier stress ordinances.")
        deleted, _ = Report.objects.filter(citizen__email__endswith="@" + EMAIL_DOMAIN).delete()
        print(f"Removed {deleted} test reports (and their attachments rows).")
        unlocked = User.objects.filter(email__endswith="@" + EMAIL_DOMAIN).update(
            is_active=True, failed_login_count=0, last_failed_login_at=None, locked_until=None,
        )
        print(f"Unlocked {unlocked} test accounts.")
    seed_citizens(args.citizens)
    seed_ordinances(args.ordinances)


if __name__ == "__main__":
    main()
