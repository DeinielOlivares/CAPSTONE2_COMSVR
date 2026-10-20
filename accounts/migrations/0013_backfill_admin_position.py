from django.db import migrations


# An Administrator account created outside the normal Create Accounts flow
# (e.g. a seeded/superuser account) can end up with role="admin" but a blank
# `position` — the Create Accounts flow is what normally sets position to
# the literal "Administrator" (see accounts.serializers.STAFF_ROLE_TO_ROLE_FIELD).
# Several frontend checks now fall back to role instead (more robust going
# forward), but this backfills position too for consistency wherever it's
# still displayed or matched on directly.
def backfill_admin_position(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.filter(role="admin", position="").update(position="Administrator")


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0012_auditlog_owner_snapshot'),
    ]

    operations = [
        migrations.RunPython(backfill_admin_position, migrations.RunPython.noop),
    ]
