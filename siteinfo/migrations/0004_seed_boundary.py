from django.db import migrations

# Barangay Platero's outline, traced from the Google Maps boundary (red
# dotted line) and georeferenced against the road network at zoom 16.
# Cross-checked against the PSA 2023 barangay polygon, which is similar but
# coarser (0.82 vs 1.08 km²). An Administrator can redraw or replace it on
# the Admin Portal's Map Boundary page.
PLATERO_BOUNDARY = [
    [14.329237, 121.096179],
    [14.328405, 121.096351],
    [14.327158, 121.096609],
    [14.32591, 121.096759],
    [14.324663, 121.096909],
    [14.323831, 121.097188],
    [14.323312, 121.097467],
    [14.322958, 121.097209],
    [14.32248, 121.097081],
    [14.321919, 121.096952],
    [14.321503, 121.096609],
    [14.321129, 121.096008],
    [14.320817, 121.095364],
    [14.320567, 121.09472],
    [14.320297, 121.094077],
    [14.320089, 121.093433],
    [14.319881, 121.092789],
    [14.319528, 121.092253],
    [14.319528, 121.091824],
    [14.31932, 121.09118],
    [14.319049, 121.090429],
    [14.3188, 121.089785],
    [14.318426, 121.089249],
    [14.31801, 121.08882],
    [14.31749, 121.088326],
    [14.317033, 121.087854],
    [14.316866, 121.087103],
    [14.316658, 121.086524],
    [14.316492, 121.085923],
    [14.317074, 121.085172],
    [14.317698, 121.084421],
    [14.318259, 121.083949],
    [14.319049, 121.084206],
    [14.320297, 121.084743],
    [14.321544, 121.085386],
    [14.322792, 121.08603],
    [14.324039, 121.086674],
    [14.325183, 121.08721],
    [14.325495, 121.087382],
    [14.325183, 121.087961],
    [14.325495, 121.088498],
    [14.325702, 121.089141],
    [14.326118, 121.089892],
    [14.326368, 121.090364],
    [14.326742, 121.090472],
    [14.326908, 121.09118],
    [14.327199, 121.091931],
    [14.327574, 121.092789],
    [14.327989, 121.093647],
    [14.328405, 121.094506],
    [14.328821, 121.095364],
]


def seed(apps, schema_editor):
    BarangayProfile = apps.get_model("siteinfo", "BarangayProfile")
    profile, _ = BarangayProfile.objects.get_or_create(pk=1)
    if not profile.boundary:
        profile.boundary = PLATERO_BOUNDARY
        profile.save(update_fields=["boundary"])


def unseed(apps, schema_editor):
    BarangayProfile = apps.get_model("siteinfo", "BarangayProfile")
    BarangayProfile.objects.filter(pk=1, boundary=PLATERO_BOUNDARY).update(boundary=[])


class Migration(migrations.Migration):
    dependencies = [
        ("siteinfo", "0003_barangayprofile_boundary"),
    ]

    operations = [migrations.RunPython(seed, unseed)]
