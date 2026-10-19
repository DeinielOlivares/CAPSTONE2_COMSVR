from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from decouple import config

User = get_user_model()


class Command(BaseCommand):
    """
    Creates the first Administrator account from the ADMIN_EMAIL /
    ADMIN_PASSWORD environment variables, so one can exist without Render
    Shell access on the free plan. Safe to run on every deploy or restart:
    once that account exists it is left exactly as it is, so a password the
    owner later changed is never put back to ADMIN_PASSWORD.

    Does nothing if either variable is missing (e.g. in local dev where
    you'd rather use `createsuperuser` interactively).
    """

    help = "Creates the initial Administrator account from ADMIN_EMAIL / ADMIN_PASSWORD env vars."

    def handle(self, *args, **options):
        email = config("ADMIN_EMAIL", default=None)
        password = config("ADMIN_PASSWORD", default=None)

        if not email or not password:
            self.stdout.write("ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin creation.")
            return

        if User.objects.filter(email__iexact=email).exists():
            self.stdout.write(f"Admin account {email} already exists — left unchanged.")
            return

        user = User(email=email, username=email)
        user.set_password(password)
        user.role = User.Role.ADMIN
        user.is_verified = True
        user.is_staff = True
        user.is_superuser = True
        user.save()
        self.stdout.write(self.style.SUCCESS(f"Created admin account: {email}"))
