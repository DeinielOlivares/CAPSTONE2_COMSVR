from django.db import migrations, models
from django.utils import timezone


def number_existing_reports(apps, schema_editor):
    """Gives every report filed before this field existed its "YYYYMMDD-N", in filing order per day."""
    Report = apps.get_model("reports", "Report")
    per_day = {}
    for report in Report.objects.order_by("created_at", "id").only("id", "created_at"):
        day = timezone.localtime(report.created_at).strftime("%Y%m%d")
        per_day[day] = per_day.get(day, 0) + 1
        Report.objects.filter(pk=report.pk).update(report_number=f"{day}-{per_day[day]}")


class Migration(migrations.Migration):

    dependencies = [
        ('reports', '0020_alter_report_status_with_remarks'),
    ]

    operations = [
        migrations.AddField(
            model_name='report',
            name='report_number',
            field=models.CharField(blank=True, editable=False, max_length=20, null=True, unique=True),
        ),
        migrations.RunPython(number_existing_reports, migrations.RunPython.noop),
    ]
