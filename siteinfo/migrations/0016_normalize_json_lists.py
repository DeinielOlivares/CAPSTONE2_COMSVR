"""
Normalization (1NF -> 3NF): the list values that used to be stored as JSON
inside one column now get their own tables, one row per item.

    BarangayProfile.boundary            -> BoundaryPoint rows
    BarangayProfile.footer_quick_links  -> FooterLink rows (kind="quick")
    BarangayProfile.footer_legal_links  -> FooterLink rows (kind="legal")
    LegalDocument.sections              -> LegalSection rows

Existing data is copied over before the old columns are removed, and copied
back if the migration is reversed.
"""

import django.db.models.deletion
from django.db import migrations, models


def copy_json_to_rows(apps, schema_editor):
    BarangayProfile = apps.get_model("siteinfo", "BarangayProfile")
    BoundaryPoint = apps.get_model("siteinfo", "BoundaryPoint")
    FooterLink = apps.get_model("siteinfo", "FooterLink")
    LegalDocument = apps.get_model("siteinfo", "LegalDocument")
    LegalSection = apps.get_model("siteinfo", "LegalSection")

    for profile in BarangayProfile.objects.all():
        BoundaryPoint.objects.bulk_create(
            BoundaryPoint(profile=profile, order=i, latitude=lat, longitude=lng)
            for i, (lat, lng) in enumerate(profile.boundary or [])
        )
        for kind, links in (("quick", profile.footer_quick_links), ("legal", profile.footer_legal_links)):
            FooterLink.objects.bulk_create(
                FooterLink(profile=profile, kind=kind, order=i, label=link["label"], url=link["url"])
                for i, link in enumerate(links or [])
            )

    for document in LegalDocument.objects.all():
        LegalSection.objects.bulk_create(
            LegalSection(
                document=document,
                order=i,
                anchor=section.get("anchor") or "",
                heading=section.get("heading") or "",
                body=section.get("body") or "",
            )
            for i, section in enumerate(document.sections or [])
        )


def copy_rows_to_json(apps, schema_editor):
    BarangayProfile = apps.get_model("siteinfo", "BarangayProfile")
    LegalDocument = apps.get_model("siteinfo", "LegalDocument")

    for profile in BarangayProfile.objects.all():
        profile.boundary = [[p.latitude, p.longitude] for p in profile.boundary_points.order_by("order")]
        links = profile.links.order_by("order")
        profile.footer_quick_links = [{"label": l.label, "url": l.url} for l in links if l.kind == "quick"]
        profile.footer_legal_links = [{"label": l.label, "url": l.url} for l in links if l.kind == "legal"]
        profile.save(update_fields=["boundary", "footer_quick_links", "footer_legal_links"])

    for document in LegalDocument.objects.all():
        document.sections = [
            {"anchor": s.anchor, "heading": s.heading, "body": s.body} for s in document.sections_rows.order_by("order")
        ]
        document.save(update_fields=["sections"])


class Migration(migrations.Migration):

    dependencies = [
        ("siteinfo", "0015_remove_streets_outside_boundary"),
    ]

    operations = [
        migrations.CreateModel(
            name="BoundaryPoint",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("order", models.PositiveIntegerField()),
                ("latitude", models.FloatField()),
                ("longitude", models.FloatField()),
                (
                    "profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="boundary_points",
                        to="siteinfo.barangayprofile",
                    ),
                ),
            ],
            options={"ordering": ["order"]},
        ),
        migrations.CreateModel(
            name="FooterLink",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("kind", models.CharField(choices=[("quick", "Quick link"), ("legal", "Legal link")], max_length=10)),
                ("order", models.PositiveIntegerField(default=0)),
                ("label", models.CharField(max_length=60)),
                ("url", models.CharField(max_length=500)),
                (
                    "profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="links",
                        to="siteinfo.barangayprofile",
                    ),
                ),
            ],
            options={"ordering": ["kind", "order"]},
        ),
        # Created with a temporary related_name ("sections_rows") because the old
        # JSON column LegalDocument.sections still exists at this point.
        migrations.CreateModel(
            name="LegalSection",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("order", models.PositiveIntegerField()),
                ("anchor", models.CharField(blank=True, max_length=60)),
                ("heading", models.CharField(blank=True, max_length=200)),
                ("body", models.TextField(blank=True)),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="sections_rows",
                        to="siteinfo.legaldocument",
                    ),
                ),
            ],
            options={"ordering": ["order"]},
        ),
        migrations.RunPython(copy_json_to_rows, copy_rows_to_json),
        migrations.RemoveField(model_name="barangayprofile", name="boundary"),
        migrations.RemoveField(model_name="barangayprofile", name="footer_quick_links"),
        migrations.RemoveField(model_name="barangayprofile", name="footer_legal_links"),
        migrations.RemoveField(model_name="legaldocument", name="sections"),
        migrations.AlterField(
            model_name="legalsection",
            name="document",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="sections", to="siteinfo.legaldocument"
            ),
        ),
    ]
