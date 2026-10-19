from decouple import config
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

User = get_user_model()


class Command(BaseCommand):
    """
    python manage.py create_admin

    Creates the first Administrator account from the ADMIN_EMAIL and
    ADMIN_PASSWORD environment variables (useful on hosting without shell
    access). Safe to run on every deploy: if the account already exists it is
    left unchanged. Does nothing if either variable is missing.
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
