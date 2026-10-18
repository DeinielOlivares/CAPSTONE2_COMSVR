# Seeds the Street table with what was hardcoded in frontend/citizen/js/
# streets-data.js (STREETS) and frontend/staff/js/street-coordinates.js
# (STREET_COORDINATES) before this became Admin-editable from the Map
# Boundary page. Both blocks are seeded — the "previous street list" ones
# aren't offered on the Street combobox anymore, but old reports still cite
# them, so their heatmap point needs to keep existing. An Administrator can
# delete whichever of these they don't want going forward.

from django.db import migrations

STREETS = [
    # ---- Current street list ----
    ("Beatriz Drive", 14.325284, 121.091849),
    ("Bougainvillea Street", 14.325865, 121.090502),
    ("Diamond Street", 14.325608, 121.095438),
    ("Jubilation Loop", 14.322231, 121.087598),
    ("Main Street", 14.323396, 121.09606),
    ("Mercado Street", 14.320756, 121.09412),
    ("Monza Street", 14.318827, 121.088395),
    ("Napoli Street", 14.319652, 121.088931),
    ("Narra Street", 14.328444, 121.095577),
    ("National Highway", 14.323895, 121.094904),
    ("Padova Street", 14.318608, 121.088925),
    ("Parma Street", 14.318457, 121.089108),
    ("Second Street", 14.323034, 121.09693),
    ("Spectrum Avenue", 14.323241, 121.093642),
    ("Spm Sun Street", 14.323241, 121.093642),
    ("Springtime", 14.322806, 121.089738),
    ("Teodora Street", 14.324816, 121.092633),
    ("Topaz Street", 14.327112, 121.095887),
    ("Tulay Bato Street", 14.327588, 121.094191),
    # ---- Previous street list (existing reports only) ----
    ("Aberta Street", 14.314049, 121.086882),
    ("Acorn Loop", 14.312454, 121.086228),
    ("Alder Lane", 14.312507, 121.086966),
    ("Alpine Street", 14.311768, 121.087029),
    ("Andrea Street", 14.314583, 121.087282),
    ("Athens Drive", 14.303156, 121.093681),
    ("Basswood Street", 14.310726, 121.087987),
    ("Benedict Street", 14.3125, 121.083416),
    ("Biñan - Santa Rosa Access Road", 14.307081, 121.089721),
    ("Birch Street", 14.311607, 121.086824),
    ("Blueberry Street", 14.311651, 121.087308),
    ("Calvin Street", 14.312523, 121.083677),
    ("Cedar Street", 14.312278, 121.087228),
    ("Cherry Street", 14.31112, 121.087134),
    ("Chestnut Street", 14.311671, 121.08755),
    ("Denver", 14.32875, 121.097689),
    ("Dogwood Street", 14.310649, 121.086947),
    ("East Magnolia Lane", 14.308545, 121.088506),
    ("East Pear Lane", 14.308086, 121.088532),
    ("East Poplar Street", 14.307859, 121.088912),
    ("Elm Lane", 14.310425, 121.086997),
    ("Enrica Street", 14.312615, 121.08439),
    ("Evergreen Street", 14.309377, 121.086977),
    ("Fern Lane", 14.310885, 121.086906),
    ("Ferragamo Street", 14.313809, 121.087344),
    ("Ferrari Street", 14.313239, 121.085894),
    ("Gabana Street", 14.313256, 121.086127),
    ("Giordano Street", 14.312677, 121.084891),
    ("Greenfield Parkway", 14.313372, 121.082886),
    ("Houston Street", 14.330217, 121.097762),
    ("Lauren Street", 14.312801, 121.08743),
    ("Maple Drive", 14.308744, 121.08816),
    ("Mondo Drive", 14.313227, 121.085671),
    ("Napoli", 14.318478, 121.089546),
    ("Nashville Street", 14.330217, 121.097762),
    ("North Delphi Drive", 14.304194, 121.093039),
    ("North Thebes Drive", 14.304236, 121.093408),
    ("Omaha Street", 14.330751, 121.098367),
    ("Pine Drive", 14.308287, 121.088268),
    ("Pine Lane", 14.30741, 121.088461),
    ("Rain Tree Lane", 14.307657, 121.088634),
    ("Ralph Street", 14.314583, 121.087282),
    ("Redwood Lane", 14.307539, 121.088865),
    ("Spruce Lane", 14.309231, 121.089399),
    ("Sycamore Drive", 14.308877, 121.089274),
    ("Sycamore Lane", 14.307494, 121.089192),
    ("Valentino Street", 14.314313, 121.087165),
    ("Versace Street", 14.312792, 121.085446),
    ("Vuitton Street", 14.313689, 121.085625),
    ("Walnut Lane", 14.309089, 121.088976),
    ("West Magnolia Lane", 14.308405, 121.087276),
    ("West Oak Lane", 14.308263, 121.087991),
]


def seed(apps, schema_editor):
    Street = apps.get_model("siteinfo", "Street")
    Street.objects.bulk_create(
        [Street(name=name, latitude=lat, longitude=lng) for name, lat, lng in STREETS],
        ignore_conflicts=True,
    )


def unseed(apps, schema_editor):
    Street = apps.get_model("siteinfo", "Street")
    Street.objects.filter(name__in=[name for name, _, _ in STREETS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("siteinfo", "0013_street"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
