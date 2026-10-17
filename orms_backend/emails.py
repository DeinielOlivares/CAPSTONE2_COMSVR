"""
Barangay Platero OVRMS — transactional email sending, shared by accounts/ and reports/.

Every "why the system sends an email" case goes through send_templated_email()
below:

  Citizen gets emailed when...
    - they request a password reset (a 6-digit code)
    - their account is approved
    - their report is submitted (a confirmation)
    - their suggestion is submitted (a confirmation)
    - their report reaches a final verdict (Resolved — remarks included if any)
    - their report is unclaimed and then claimed by a different investigator
    - their account is rejected (with the admin's reason, and another chance
      to sign up again with the same email)
    - a question they asked on the FAQs page is answered
    - they're filing a report and need to verify it's really them (a
      6-digit code — see reports/verification.py)
    - their account gets automatically disabled for filing reports too
      fast (suspicious activity)
    - the Secretary or Barangay Captain posts a new Announcement (every
      citizen gets this one — see announcements/views.py)
  Any account (citizen, staff, or admin) gets emailed when...
    - someone else creates it for them (an Administrator creating a
      Staff/Administrator account, or a Barangay Citizen account) — a
      one-time link to fill in their details and choose their own
      password, see send_account_setup_link_email
    - an Administrator disables or deletes it (accounts/views.py's
      AdminAccountDetailView)
    - (Staff/Administrator only) an Administrator chooses Reset Password in
      Manage Accounts — a one-time link to choose a new password, see
      send_password_reset_link_email
    - they (or anyone with access to their account) change their email,
      mobile number, or address from My Profile → Edit Account Information
      (a 6-digit code, sent to the address already on file, not any new
      one being entered — see MeView.patch)
  Staff gets emailed when...
    - a report is submitted (needs review)
    - a suggestion is submitted (needs review)
  Admin gets emailed when...
    - a citizen self-registers (a new account is pending approval)

Each has its own small html template under <app>/templates/emails/,
extending emails/_base.html (accounts/templates/emails/_base.html — shared
across apps via Django's merged app-template namespace, so reports' templates
can extend it too without duplicating it).

Uses Brevo's SMTP relay (see settings.py) through Django's normal mail
framework, so sending is just EmailMultiAlternatives.send() underneath —
swapping providers later is a settings change, not a rewrite.

Sending is best-effort: a failure here (bad credentials, provider outage,
etc.) is logged and swallowed rather than raised, so the action that
triggered it — filing a report, approving an account — still succeeds even
if the notification email doesn't go out.
"""

import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.html import strip_tags

logger = logging.getLogger(__name__)


def send_templated_email(*, to, subject, template_name, context):
    if not to:
        return
    # Everything is inside the try, not just .send() — a bad template, a bad
    # SMTP login, a network blip to Brevo, anything at all here must never
    # crash the request that triggered it (signing up, filing a report,
    # requesting a reset code all still need to succeed on their own).
    try:
        html_body = render_to_string(f"emails/{template_name}.html", context)
        text_body = strip_tags(html_body)
        message = EmailMultiAlternatives(subject, text_body, settings.DEFAULT_FROM_EMAIL, [to])
        message.attach_alternative(html_body, "text/html")
        message.send()
    except Exception:
        logger.exception("Failed to send %r email to %s", template_name, to)


def _send_to_each(users, **kwargs):
    for user in users:
        send_templated_email(to=user.email, **kwargs)


# ---- Citizen ----------------------------------------------------------


def send_password_reset_email(user, code, expires_minutes):
    send_templated_email(
        to=user.email,
        subject="Barangay Platero OVRMS — Your password reset code",
        template_name="password_reset_code",
        context={"user": user, "code": code, "expires_minutes": expires_minutes},
    )


def send_account_approved_email(user):
    send_templated_email(
        to=user.email,
        subject="Barangay Platero OVRMS — Your account has been approved",
        template_name="account_approved",
        context={"user": user},
    )


def send_account_rejected_email(name, email, reason):
    send_templated_email(
        to=email,
        subject="Barangay Platero OVRMS — Update on your account sign-up",
        template_name="account_rejected",
        context={"name": name, "reason": reason},
    )


def send_report_submitted_citizen_email(report):
    send_templated_email(
        to=report.citizen.email,
        subject="Barangay Platero OVRMS — Your report has been submitted",
        template_name="report_submitted_citizen",
        context={"report": report},
    )


def send_suggestion_submitted_citizen_email(concern):
    send_templated_email(
        to=concern.citizen.email,
        subject="Barangay Platero OVRMS — Your suggestion has been submitted",
        template_name="suggestion_submitted_citizen",
        context={"concern": concern},
    )


def send_report_resolved_email(report):
    # Final Verdict, in status-timeline terms — the last of the 4 stages.
    # Includes remarks in the body when there are any, rather than a
    # separate email.
    send_templated_email(
        to=report.citizen.email,
        subject="Barangay Platero OVRMS — Your report has reached a final verdict",
        template_name="report_resolved",
        context={"report": report},
    )


def send_report_reassigned_email(report):
    # Sent only when a report that had already been forfeited by its
    # original Investigator gets claimed by a *different* one (see
    # StaffReportClaimView) — not on every claim, just an actual handoff.
    send_templated_email(
        to=report.citizen.email,
        subject="Barangay Platero OVRMS — A new investigator is handling your report",
        template_name="report_reassigned",
        context={"report": report},
    )


def send_question_answered_email(question):
    send_templated_email(
        to=question.citizen.email,
        subject="Barangay Platero OVRMS — Your question has been answered",
        template_name="question_answered",
        context={"question": question},
    )


def send_report_verification_code_email(user, code, expires_minutes):
    # Filing a report needs to confirm the real account owner is the one
    # doing it — see reports/verification.py — hence its own template
    # distinct from the password reset code, even though the layout is the
    # same idea.
    send_templated_email(
        to=user.email,
        subject="Barangay Platero OVRMS — Your report verification code",
        template_name="report_verification_code",
        context={"user": user, "code": code, "expires_minutes": expires_minutes},
    )


def send_account_suspicious_activity_email(user):
    # Sent when reports/verification.py's abuse lockout disables the
    # account automatically — the citizen can't log in to see an in-app
    # notice, so this is the only place they'd learn why and what to do
    # (reset their password via Forgot Password; an admin still has to
    # manually re-enable the account afterward from Manage Accounts).
    send_templated_email(
        to=user.email,
        subject="Barangay Platero OVRMS — Your account has been disabled due to suspicious activity",
        template_name="account_suspicious_activity",
        context={"user": user},
    )


def send_account_setup_link_email(user, setup_url, expires_hours):
    # Sent when someone else creates an account for this person (an
    # Administrator creating a Staff/Administrator account, or a Barangay
    # Citizen account with or without its details filled in), and again
    # whenever a new link is requested — see accounts/setup_links.py. No
    # password is ever emailed: the owner chooses their own via the link.
    send_templated_email(
        to=user.email,
        subject="Barangay Platero OVRMS — Set up your account",
        template_name="account_setup_link",
        context={"user": user, "setup_url": setup_url, "expires_hours": expires_hours},
    )


def send_password_reset_link_email(user, reset_url, expires_hours):
    # Manage Accounts → Reset Password, for a Barangay Staff/Administrator
    # account (see accounts/setup_links.py's send_reset_link). The current
    # password keeps working until the link is used.
    send_templated_email(
        to=user.email,
        subject="Barangay Platero OVRMS — Reset your password",
        template_name="password_reset_link",
        context={"user": user, "reset_url": reset_url, "expires_hours": expires_hours},
    )


def send_account_deactivated_email(user):
    # Sent when an Administrator disables the account from Manage Accounts
    # (AdminAccountDetailView.patch) — distinct from
    # send_account_suspicious_activity_email, which is the automatic
    # abuse-lockout case in reports/verification.py.
    send_templated_email(
        to=user.email,
        subject="Barangay Platero OVRMS — Your account has been disabled",
        template_name="account_deactivated",
        context={"user": user},
    )


def send_account_deleted_email(name, email):
    # Takes name/email directly rather than a user object — sent right
    # before AdminAccountDetailView.delete() actually deletes the row, same
    # reasoning as send_account_rejected_email.
    send_templated_email(
        to=email,
        subject="Barangay Platero OVRMS — Your account has been deleted",
        template_name="account_deleted",
        context={"name": name},
    )


def send_account_self_deleted_email(name, email):
    # Citizen-initiated deletion (My Profile → Delete Account — see
    # MeView.delete) — distinct wording from send_account_deleted_email,
    # which is specifically for an Administrator-initiated deletion.
    send_templated_email(
        to=email,
        subject="Barangay Platero OVRMS — Your account has been deleted",
        template_name="account_self_deleted",
        context={"name": name},
    )


def send_profile_edit_code_email(user, code, expires_minutes):
    # Sent to the address already on file, not whatever new one is being
    # entered — see accounts.views.ProfileEditCodeRequestView.
    send_templated_email(
        to=user.email,
        subject="Barangay Platero OVRMS — Confirm your account changes",
        template_name="profile_edit_code",
        context={"user": user, "code": code, "expires_minutes": expires_minutes},
    )


def send_account_locked_email(user, minutes):
    # Sent by accounts/lockout.py when repeated wrong passwords lock the
    # account. Once per lock, not per failed attempt, so an attacker can't
    # use it to flood the owner's inbox.
    from accounts.lockout import MAX_FAILED_LOGINS

    send_templated_email(
        to=user.email,
        subject="Barangay Platero OVRMS — Your account has been temporarily locked",
        template_name="account_locked",
        context={"user": user, "minutes": minutes, "attempts": MAX_FAILED_LOGINS},
    )


# ---- Staff --------------------------------------------------------------


def send_report_submitted_staff_emails(report, staff_users):
    _send_to_each(
        staff_users,
        subject="Barangay Platero OVRMS — A new report needs review",
        template_name="report_submitted_staff",
        context={"report": report},
    )


def send_suggestion_submitted_staff_emails(concern, staff_users):
    _send_to_each(
        staff_users,
        subject="Barangay Platero OVRMS — A new suggestion needs review",
        template_name="suggestion_submitted_staff",
        context={"concern": concern},
    )


def send_announcement_posted_email(announcement, citizen_users):
    # The one email with a real clickable link back to the site (the
    # citizen home page) rather than just "Log in to Barangay Platero OVRMS" as plain
    # text — see settings.FRONTEND_BASE_URL.
    link = f"{settings.FRONTEND_BASE_URL}/citizen/home.html"
    _send_to_each(
        citizen_users,
        subject=f"Barangay Platero OVRMS — New announcement: {announcement.title}",
        template_name="announcement_posted",
        context={"announcement": announcement, "link": link},
    )


# ---- Admin ----------------------------------------------------------------


def send_account_created_admin_emails(user, admin_users):
    _send_to_each(
        admin_users,
        subject="Barangay Platero OVRMS — A new account is pending approval",
        template_name="account_created_admin",
        context={"user": user},
    )
