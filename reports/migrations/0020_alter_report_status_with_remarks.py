from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('reports', '0019_report_ordinance_textfield'),
    ]

    operations = [
        migrations.AlterField(
            model_name='report',
            name='status',
            field=models.CharField(choices=[('submitted', 'Submitted'), ('under_review', 'Under Review'), ('in_action', 'In Action'), ('resolved', 'Resolved'), ('with_remarks', 'With Remarks')], default='submitted', max_length=20),
        ),
    ]
