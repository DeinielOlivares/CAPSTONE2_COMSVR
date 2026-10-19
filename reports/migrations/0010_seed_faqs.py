# Seeds a starting set of FAQs onto the citizen FAQs page (see FAQ model and
# AdminFAQListCreateView) so the page isn't empty on a fresh deploy. These are
# a starting point, not fixed content — an Administrator can edit or remove
# any of them, and add more, from the Admin Portal's Questions page ("Manage
# FAQs" section) same as any other FAQ.

from django.db import migrations

FAQS = [
    (
        "How do I file a report?",
        "Log in to your account, then go to File a Report. Describe the ordinance violation, "
        "add the location and time, and attach photos if you have them. The form will suggest "
        "which ordinance may apply as you type. The first time you file, and again if it's been "
        "more than 30 days since your last one, you'll be asked to verify your identity with a "
        "code emailed to you before the report can be submitted.",
    ),
    (
        "Why do I need to verify my identity before filing a report?",
        "It confirms the report is really coming from you and not someone who has gained access "
        "to your account. We'll email a 6-digit code to the address on file, which is valid for "
        "15 minutes. Once verified, you won't be asked again for 30 days unless your account is "
        "flagged for unusual activity.",
    ),
    (
        "How often can I file a report?",
        "There's a 2-hour cooldown between reports filed from the same account. This keeps the "
        "system usable for everyone and helps prevent abuse. Filing an unusually large number of "
        "reports in a short time (5 or more within 12 hours) will also temporarily disable the "
        "account as a safety measure — you'll be emailed if this happens.",
    ),
    (
        "What happens after I submit a report?",
        "Your report goes to the Barangay's Reports queue, where an Investigator reviews and "
        "claims it. You can track its progress anytime from My Reports — statuses include "
        "Submitted, In Process, and Resolved. You'll also get an email and an in-app notification "
        "once it's resolved.",
    ),
    (
        "What's the difference between a report and a suggestion or concern?",
        "A report is for a specific, alleged ordinance violation you want investigated. A "
        "concern or suggestion (Submit Suggestion) is for general feedback or ideas for the "
        "barangay — it's reviewed by the Secretary, not investigated the way a report is, and "
        "doesn't require identity verification or a cooldown.",
    ),
    (
        "How do I create an account?",
        "On the Sign Up page, enter your details and upload a clear photo of your voter's ID. "
        "Your account stays pending until a Barangay Administrator reviews and approves it, "
        "which confirms you're a registered resident before you can file reports or suggestions. "
        "You'll be notified by email once it's approved.",
    ),
    (
        "I forgot my password. What do I do?",
        "Click Forgot Password on the login page and enter your email. We'll send a 6-digit code "
        "valid for 15 minutes — enter it, then choose a new password. If you don't receive an "
        "email, double-check the address you registered with; for your security, we don't confirm "
        "whether an email is registered.",
    ),
    (
        "Why was my account locked, and how do I unlock it?",
        "An account locks for 30 minutes after 10 failed login attempts in a row, in case someone "
        "else is trying to guess your password. You can simply wait it out, or use Forgot Password "
        "to reset your password and unlock it immediately.",
    ),
    (
        "Can I download an ordinance's PDF more than once?",
        "Each citizen account can download a given ordinance's PDF one time. This is to keep "
        "shared download links from being reused indefinitely. If you need it again, save your "
        "own copy after the first download, or contact the Barangay office.",
    ),
    (
        "How will I know when my report or suggestion has been resolved?",
        "You'll receive an email and a notification in the bell icon at the top of the page as "
        "soon as staff mark it resolved. You can also check the current status anytime from My "
        "Reports or My Concerns/Suggestions.",
    ),
]


def seed_faqs(apps, schema_editor):
    FAQ = apps.get_model("reports", "FAQ")
    FAQ.objects.bulk_create([FAQ(question=q, answer=a) for q, a in FAQS])


def unseed_faqs(apps, schema_editor):
    FAQ = apps.get_model("reports", "FAQ")
    FAQ.objects.filter(question__in=[q for q, _ in FAQS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("reports", "0009_code_failed_attempts"),
    ]

    operations = [
        migrations.RunPython(seed_faqs, unseed_faqs),
    ]
