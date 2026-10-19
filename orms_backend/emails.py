"""
Every email the system sends. Each one is an HTML template under
<app>/templates/emails/ (all extend accounts/templates/emails/_base.html).

Sending is "best effort": if the mail server fails, the error is logged and
the action that triggered the email (filing a report, approving an account…)
still succeeds.

Who receives what:
  Citizen   reset code, account approved/rejected, report/suggestion submitted,
            report resolved, report reassigned, question answered, report
            verification code, account disabled for suspicious activity,
            new announcement
  Anyone    account setup link, admin-sent password reset link, account
            disabled/deleted, account locked, profile edit code
  Staff     new report / new suggestion to review
  Admin     new citizen sign-up waiting for approval
"""

import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.html import strip_tags

logger = logging.getLogger(__name__)
PREFIX = "Barangay Platero OVRMS — "


def send_templated_email(*, to, subject, template_name, context):
    """Renders emails/<template_name>.html and sends it (HTML + plain-text copy)."""
    if not to:
        return
    try:
        html_body = render_to_string(f"emails/{template_name}.html", context)
        message = EmailMultiAlternatives(subject, strip_tags(html_body), settings.DEFAULT_FROM_EMAIL, [to])
        message.attach_alternative(html_body, "text/html")
        message.send()
    except Exception:
        logger.exception("Failed to send %r email to %s", template_name, to)


def _send(to, subject, template_name, **context):
    send_templated_email(to=to, subject=PREFIX + subject, template_name=template_name, context=context)


def _send_to_each(users, subject, template_name, **context):
    for user in users:
        _send(user.email, subject, template_name, **context)


# ---- Codes and links -------------------------------------------------------

def send_password_reset_email(user, code, expires_minutes):
    _send(user.email, "Your password reset code", "password_reset_code",
          user=user, code=code, expires_minutes=expires_minutes)


def send_signup_email_code(email, code, expires_minutes):
    # No account exists yet, so this goes to the address typed on Sign Up.
    _send(email, "Verify your email address", "signup_email_code",
          code=code, expires_minutes=expires_minutes)


def send_report_verification_code_email(user, code, expires_minutes):
    _send(user.email, "Your report verification code", "report_verification_code",
          user=user, code=code, expires_minutes=expires_minutes)


def send_profile_edit_code_email(user, code, expires_minutes):
    # Goes to the address already on file, not a new one being typed in.
    _send(user.email, "Confirm your account changes", "profile_edit_code",
          user=user, code=code, expires_minutes=expires_minutes)


def send_account_setup_link_email(user, setup_url, expires_hours):
    _send(user.email, "Set up your account", "account_setup_link",
          user=user, setup_url=setup_url, expires_hours=expires_hours)


def send_password_reset_link_email(user, reset_url, expires_hours):
    _send(user.email, "Reset your password", "password_reset_link",
          user=user, reset_url=reset_url, expires_hours=expires_hours)


# ---- Account status ----------------------------------------------------------

def send_account_approved_email(user):
    _send(user.email, "Your account has been approved", "account_approved", user=user)


def send_account_rejected_email(name, email, reason):
    # Takes name/email (not the user) because the account is deleted right after.
    _send(email, "Update on your account sign-up", "account_rejected", name=name, reason=reason)


def send_account_deactivated_email(user):
    _send(user.email, "Your account has been disabled", "account_deactivated", user=user)


def send_account_suspicious_activity_email(user):
    _send(user.email, "Your account has been disabled due to suspicious activity",
          "account_suspicious_activity", user=user)


def send_account_deleted_email(name, email):
    _send(email, "Your account has been deleted", "account_deleted", name=name)


def send_account_self_deleted_email(name, email):
    _send(email, "Your account has been deleted", "account_self_deleted", name=name)


def send_account_locked_email(user, minutes, attempts):
    # Sent once per lock, not per failed attempt.
    _send(user.email, "Your account has been temporarily locked", "account_locked",
          user=user, minutes=minutes, attempts=attempts)


# ---- Reports, suggestions, questions ----------------------------------------

def send_report_submitted_citizen_email(report):
    _send(report.citizen.email, "Your report has been submitted", "report_submitted_citizen", report=report)


def send_suggestion_submitted_citizen_email(concern):
    _send(concern.citizen.email, "Your suggestion has been submitted", "suggestion_submitted_citizen", concern=concern)


def send_report_resolved_email(report):
    _send(report.citizen.email, f"Your report has been marked {report.get_status_display()}",
          "report_resolved", report=report)


def send_report_reassigned_email(report):
    _send(report.citizen.email, "A new investigator is handling your report", "report_reassigned", report=report)


def send_question_answered_email(question):
    _send(question.citizen.email, "Your question has been answered", "question_answered", question=question)


def send_report_submitted_staff_emails(report, staff_users):
    _send_to_each(staff_users, "A new report needs review", "report_submitted_staff", report=report)


def send_suggestion_submitted_staff_emails(concern, staff_users):
    _send_to_each(staff_users, "A new suggestion needs review", "suggestion_submitted_staff", concern=concern)


# ---- Announcements and sign-ups ---------------------------------------------

def send_announcement_posted_email(announcement, citizen_users):
    link = f"{settings.FRONTEND_BASE_URL}/citizen/home.html"
    _send_to_each(citizen_users, f"New announcement: {announcement.title}", "announcement_posted",
                  announcement=announcement, link=link)


def send_account_created_admin_emails(user, admin_users):
    _send_to_each(admin_users, "A new account is pending approval", "account_created_admin", user=user)
