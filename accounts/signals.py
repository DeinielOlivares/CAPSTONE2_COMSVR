"""
Keeps every record a user created or handled once their account is deleted.

The foreign keys from those records to User are SET_NULL (never CASCADE), so
the rows themselves survive the delete — but the link to the person goes, and
with it their name. Right before the User row is removed, this copies the name
(and, for a citizen's submissions, the contact number) onto each record, so a
resolved report still says who handled it, an answer still says who gave it,
and staff still see who filed a report.

Disabling an account (is_active=False) needs none of this: the row and every
link to it stay in place.
"""

from django.db.models.signals import pre_delete
from django.dispatch import receiver

from .models import User


def _staff_role_label(user):
    if user.role == User.Role.ADMIN:
        return "Administrator"
    return user.position or "Barangay Staff"


@receiver(pre_delete, sender=User)
def preserve_records_of_deleted_user(sender, instance, **kwargs):
    from announcements.models import Announcement
    from ordinances.models import Ordinance
    from reports.models import Concern, Question, Report

    name = instance.get_full_name() or instance.username
    contact = instance.contact_number or ""

    # What they submitted as a citizen.
    Report.objects.filter(citizen=instance).update(citizen_name=name, citizen_contact=contact)
    Concern.objects.filter(citizen=instance).update(citizen_name=name, citizen_contact=contact)
    Question.objects.filter(citizen=instance).update(citizen_name=name)

    # What they handled or published as staff.
    Report.objects.filter(assigned_investigator=instance).update(investigator_name=name)
    Question.objects.filter(answered_by=instance).update(
        answered_by_name_snapshot=name, answered_by_role_snapshot=_staff_role_label(instance)
    )
    Announcement.objects.filter(posted_by=instance).update(posted_by_name_snapshot=name)
    Ordinance.objects.filter(uploaded_by=instance).update(uploaded_by_name_snapshot=name)
