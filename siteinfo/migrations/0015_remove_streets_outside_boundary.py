# Removes the "previous street list" block seeded by 0014 — every one of
# them plots outside the Platero outline (the subdivision to the south plus
# Omaha/Houston/Nashville/Denver to the NE), and since the Street combobox
# lists every Street row, they were still being offered on Sign Up/File
# Report/My Profile. Report.location is free text, so reports citing these
# keep their text; they just no longer get a street-centroid heatmap point.

import importlib

from django.db import migrations

# 0014's STREETS is the 19-street current list followed by the 52 previous
# ones; reuse it so names and coordinates aren't duplicated here.
_seed = importlib.import_module("siteinfo.migrations.0014_seed_streets")
OUTSIDE_STREETS = _seed.STREETS[19:]
assert len(OUTSIDE_STREETS) == 52 and OUTSIDE_STREETS[0][0] == "Aberta Street"


def remove(apps, schema_editor):
    Street = apps.get_model("siteinfo", "Street")
    Street.objects.filter(name__in=[name for name, _, _ in OUTSIDE_STREETS]).delete()


def restore(apps, schema_editor):
    Street = apps.get_model("siteinfo", "Street")
    Street.objects.bulk_create(
        [Street(name=name, latitude=lat, longitude=lng) for name, lat, lng in OUTSIDE_STREETS],
        ignore_conflicts=True,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("siteinfo", "0014_seed_streets"),
    ]

    operations = [
        migrations.RunPython(remove, restore),
    ]
