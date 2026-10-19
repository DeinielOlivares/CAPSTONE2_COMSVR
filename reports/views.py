"""
Reports — API views (URLs in reports/urls.py, all under /api/).

Sections:
  1. Citizen: reports (with anti-abuse checks), concerns, questions
  2. Staff: reports (view, update, claim/assign, dashboard PDF)
  3. Staff: concerns/suggestions and their folders
  4. Staff: answer questions; FAQs
"""

import re
import uuid
from datetime import timedelta

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import User, log_action
from accounts.permissions import IsAdmin, IsInvestigatorOrAdmin, IsSecretaryOrAdmin, IsStaffOrAdmin
from orms_backend.codes import generate_code
from orms_backend.emails import (
    send_question_answered_email,
    send_report_reassigned_email,
    send_report_resolved_email,
    send_report_submitted_citizen_email,
    send_report_submitted_staff_emails,
    send_report_verification_code_email,
    send_suggestion_submitted_citizen_email,
    send_suggestion_submitted_staff_emails,
)

from .models import FAQ, Concern, ConcernFolder, Question, Report, ReportVerificationCode
from .pdf import build_dashboard_pdf
from .serializers import (
    ConcernFolderSerializer,
    ConcernSerializer,
    FAQSerializer,
    QuestionSerializer,
    ReportSerializer,
    ReportVerifyCodeSerializer,
    StaffConcernSerializer,
    StaffConcernUpdateSerializer,
    StaffQuestionAnswerSerializer,
    StaffQuestionSerializer,
    StaffReportSerializer,
    StaffReportUpdateSerializer,
)
from .verification import check_and_apply_abuse_lockout, cooldown_remaining, has_valid_verification, verification_required


def _active_staff():
    return User.objects.filter(role=User.Role.STAFF, is_active=True)


# ---------------------------------------------------------------------------
# 1. Citizen
# ---------------------------------------------------------------------------

class ReportListCreateView(generics.ListCreateAPIView):
    """
    GET  /reports/ — the citizen's own reports (My Reports).
    POST /reports/ — file a report. Checked first: cooldown, then identity
                     verification (see reports/verification.py).
    """

    serializer_class = ReportSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Report.objects.filter(citizen=self.request.user)

    def create(self, request, *args, **kwargs):
        user = request.user

        remaining = cooldown_remaining(user)
        if remaining is not None:
            minutes = max(1, int(remaining.total_seconds() // 60) + 1)
            return Response(
                {"detail": f"You can file another report in about {minutes} minute(s)."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        if verification_required(user) and not has_valid_verification(user):
            return Response(
                {"detail": "Please verify your email before filing this report.", "verification_required": True},
                status=status.HTTP_403_FORBIDDEN,
            )

        response = super().create(request, *args, **kwargs)
        if response.status_code == status.HTTP_201_CREATED:
            # The verification is used up by this report.
            ReportVerificationCode.objects.filter(user=user, verified_at__isnull=False).delete()
            check_and_apply_abuse_lockout(user)
        return response

    def perform_create(self, serializer):
        report = serializer.save()
        log_action(self.request.user, f"Submitted a report — {report.ordinance}")
        send_report_submitted_citizen_email(report)
        send_report_submitted_staff_emails(report, _active_staff())


class ReportVerificationStatusView(APIView):
    """GET /reports/verification-status/ — does File a Report need a code first? Any cooldown left?"""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        remaining = cooldown_remaining(user)
        return Response({
            "verification_required": verification_required(user) and not has_valid_verification(user),
            "cooldown_seconds": int(remaining.total_seconds()) if remaining is not None else 0,
        })


class ReportSendVerificationView(APIView):
    """POST /reports/send-verification/ — emails a new 6-digit code (older ones stop working)."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "report_send_code"

    def post(self, request):
        user = request.user
        ReportVerificationCode.objects.filter(user=user, verified_at__isnull=True).update(expires_at=timezone.now())
        code = generate_code()
        ReportVerificationCode.objects.create(
            user=user,
            code=code,
            expires_at=timezone.now() + timedelta(minutes=ReportVerificationCode.CODE_TTL_MINUTES),
        )
        send_report_verification_code_email(user, code, ReportVerificationCode.CODE_TTL_MINUTES)
        return Response({"detail": "A verification code has been sent to your email."})


class ReportVerifyCodeView(APIView):
    """POST /reports/verify-code/ — checks the code."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "report_verify_code"

    def post(self, request):
        serializer = ReportVerifyCodeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Verified."})


class ReportDetailView(generics.RetrieveAPIView):
    """GET /reports/<id>/ — one of the citizen's own reports."""

    serializer_class = ReportSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Report.objects.filter(citizen=self.request.user)


class ConcernListCreateView(generics.ListCreateAPIView):
    """GET /concerns/ — the citizen's own concerns.  POST /concerns/ — submit one."""

    serializer_class = ConcernSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Concern.objects.filter(citizen=self.request.user)

    def perform_create(self, serializer):
        concern = serializer.save()
        log_action(self.request.user, "Submitted a suggestion")
        send_suggestion_submitted_citizen_email(concern)
        send_suggestion_submitted_staff_emails(concern, _active_staff())


class ConcernDetailView(generics.RetrieveAPIView):
    """GET /concerns/<id>/ — one of the citizen's own concerns."""

    serializer_class = ConcernSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Concern.objects.filter(citizen=self.request.user)


class QuestionListCreateView(generics.ListCreateAPIView):
    """GET /questions/ — the citizen's own questions.  POST /questions/ — ask one."""

    serializer_class = QuestionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Question.objects.filter(citizen=self.request.user)


# ---------------------------------------------------------------------------
# 2. Staff: reports
# ---------------------------------------------------------------------------

def _get_report(pk):
    return get_object_or_404(Report.objects.select_related("citizen", "assigned_investigator"), pk=pk)


def _staff_report_response(report, request):
    return Response(StaffReportSerializer(report, context={"request": request}).data)


class StaffReportListView(generics.ListAPIView):
    """
    GET /reports/staff/ — every report.
      ?assigned_to=<user id>  only the reports that user has claimed
      ?active=1               only reports that aren't closed yet
    """

    serializer_class = StaffReportSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = Report.objects.select_related("citizen", "assigned_investigator").all()
        assigned_to = self.request.query_params.get("assigned_to")
        if assigned_to:
            try:
                queryset = queryset.filter(assigned_investigator_id=uuid.UUID(assigned_to))
            except ValueError:
                return queryset.none()
        if self.request.query_params.get("active") == "1":
            queryset = queryset.exclude(status__in=Report.CLOSED_STATUSES)
        return queryset


class StaffReportAnalysisBaseView(APIView):
    """GET /reports/staff/analysis-base/ — number of approved, active citizens (for percentages)."""

    permission_classes = [IsStaffOrAdmin]

    def get(self, request):
        registered = User.objects.filter(role=User.Role.CITIZEN, is_active=True, is_verified=True).count()
        return Response({"registered_citizens": registered})


class StaffReportDetailView(APIView):
    """
    GET   /reports/staff/<id>/ — any staff member can view a report.
    PATCH /reports/staff/<id>/ — change status/remarks. Only the Investigator
          who claimed the report (or an Administrator) may do this.
    """

    permission_classes = [IsStaffOrAdmin]

    def get(self, request, pk):
        report = _get_report(pk)
        # Only the claiming Investigator's visit is shown to the citizen as "viewed".
        if report.assigned_investigator_id == request.user.id:
            report.investigator_last_viewed_at = timezone.now()
            report.save(update_fields=["investigator_last_viewed_at"])
        return _staff_report_response(report, request)

    def patch(self, request, pk):
        if not IsInvestigatorOrAdmin().has_permission(request, self):
            return Response({"detail": "Only an Investigator can update a report's status."}, status=403)

        report = _get_report(pk)
        if request.user.role != User.Role.ADMIN and report.assigned_investigator_id != request.user.id:
            if report.assigned_investigator_id:
                holder = report.assigned_investigator.display_name
                detail = f"This report is claimed by {holder} — only they can update it."
            else:
                detail = "Claim this report before updating its status."
            return Response({"detail": detail}, status=403)

        previous_status = report.status
        serializer = StaffReportUpdateSerializer(report, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        # New remarks on a "Submitted" report (status left unchanged) move it to Under Review.
        data = serializer.validated_data
        new_remarks = (data.get("remarks") or "").strip()
        if (
            previous_status == Report.Status.SUBMITTED
            and data.get("status", previous_status) == Report.Status.SUBMITTED
            and new_remarks
            and new_remarks != (report.remarks or "").strip()
        ):
            data["status"] = Report.Status.UNDER_REVIEW
        serializer.save()

        if report.status != previous_status:
            log_action(request.user, f"Updated a report's status to {report.get_status_display()}")
        if "remarks" in request.data:
            log_action(request.user, "Updated a report's remarks")

        # Email the citizen only when the report *becomes* Resolved / With Remarks.
        if report.status in Report.CLOSED_STATUSES and report.status != previous_status:
            send_report_resolved_email(report)

        return _staff_report_response(report, request)


class StaffReportDashboardPdfView(APIView):
    """
    POST /reports/staff/dashboard-pdf/ — "Download Summary (PDF)" on the
    Reports Dashboard. The browser already computed every number
    (reports-dashboard.js) and posts them as JSON; this view only lays them out.
    """

    permission_classes = [IsStaffOrAdmin]
    DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

    def post(self, request):
        payload = request.data or {}
        try:
            pdf_bytes = build_dashboard_pdf(payload)
        except (KeyError, TypeError, ValueError):
            return Response({"detail": "Could not build the summary from the given data."}, status=400)

        # File name uses the dashboard's date range, or today's date if it's missing.
        period_range = payload.get("top_period_range") or {}
        start, end = period_range.get("from"), period_range.get("to")
        if self.DATE_RE.match(start or "") and self.DATE_RE.match(end or ""):
            date_part = start if start == end else f"{start}_to_{end}"
        else:
            date_part = timezone.localtime(timezone.now()).date().isoformat()

        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="reports-summary-{date_part}.pdf"'
        return response


class StaffReportClaimView(APIView):
    """POST /reports/staff/<id>/claim/ — an Investigator claims an unclaimed report."""

    permission_classes = [IsInvestigatorOrAdmin]

    def post(self, request, pk):
        report = _get_report(pk)
        if report.assigned_investigator_id and report.assigned_investigator_id != request.user.id:
            return Response(
                {"detail": f"This report is already claimed by {report.assigned_investigator.display_name}."},
                status=400,
            )
        # A *different* Investigator than before means the citizen gets an email.
        reassigned = bool(report.previous_investigator_id) and report.previous_investigator_id != request.user.id
        report.assigned_investigator = request.user
        report.previous_investigator = None
        report.save(update_fields=["assigned_investigator", "previous_investigator"])
        log_action(request.user, f"Claimed a report — {report.ordinance}")
        if reassigned:
            send_report_reassigned_email(report)
        return _staff_report_response(report, request)


class StaffReportForfeitView(APIView):
    """POST /reports/staff/<id>/forfeit/ — Administrator releases a claim so another Investigator can take it."""

    permission_classes = [IsAdmin]

    def post(self, request, pk):
        report = _get_report(pk)
        holder = report.assigned_investigator
        report.assigned_investigator = None
        report.previous_investigator = holder
        report.save(update_fields=["assigned_investigator", "previous_investigator"])
        if holder:
            log_action(request.user, f"Released {holder.display_name}'s claim on a report — {report.ordinance}")
        return _staff_report_response(report, request)


class StaffReportAssignView(APIView):
    """POST /reports/staff/<id>/assign/ {"investigator_id": ...} — Administrator picks the Investigator."""

    permission_classes = [IsAdmin]

    def post(self, request, pk):
        report = _get_report(pk)
        investigator_id = request.data.get("investigator_id")
        if not investigator_id:
            return Response({"detail": "investigator_id is required."}, status=400)

        investigator = get_object_or_404(User, pk=investigator_id, role=User.Role.STAFF, position="Investigator")
        if not investigator.is_active:
            return Response({"detail": f"{investigator.display_name}'s account is disabled."}, status=400)

        previous_holder = report.assigned_investigator
        reassigned = bool(previous_holder) and previous_holder.id != investigator.id
        report.assigned_investigator = investigator
        report.previous_investigator = None
        report.save(update_fields=["assigned_investigator", "previous_investigator"])

        log_action(request.user, f"Assigned a report to {investigator.display_name} — {report.ordinance}")
        if reassigned:
            send_report_reassigned_email(report)
        return _staff_report_response(report, request)


# ---------------------------------------------------------------------------
# 3. Staff: concerns/suggestions and folders
# ---------------------------------------------------------------------------

class StaffConcernListView(generics.ListAPIView):
    """GET /concerns/staff/ — every concern/suggestion."""

    queryset = Concern.objects.select_related("citizen", "folder").all()
    serializer_class = StaffConcernSerializer
    permission_classes = [IsStaffOrAdmin]


class StaffConcernDetailView(APIView):
    """
    GET   /concerns/staff/<id>/ — any staff member can view it.
    PATCH /concerns/staff/<id>/ — Secretary/Administrator changes remarks or folder.
          A Submitted concern becomes Reviewed once it gets remarks or a folder.
    """

    permission_classes = [IsStaffOrAdmin]

    def get_object(self, pk):
        return get_object_or_404(Concern.objects.select_related("citizen", "folder"), pk=pk)

    def get(self, request, pk):
        return Response(StaffConcernSerializer(self.get_object(pk), context={"request": request}).data)

    def patch(self, request, pk):
        if not IsSecretaryOrAdmin().has_permission(request, self):
            return Response({"detail": "Only the Secretary can update a concern/suggestion."}, status=403)

        concern = self.get_object(pk)
        serializer = StaffConcernUpdateSerializer(concern, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        acted_on = ("folder" in request.data and concern.folder_id) or (
            "remarks" in request.data and concern.remarks.strip()
        )
        if concern.status == Concern.Status.SUBMITTED and acted_on:
            concern.status = Concern.Status.REVIEWED
            concern.reviewed_at = timezone.now()
            concern.save(update_fields=["status", "reviewed_at"])
            log_action(request.user, "Marked a concern/suggestion as Reviewed")
        if "remarks" in request.data:
            log_action(request.user, "Updated a concern/suggestion's remarks")
        if "folder" in request.data:
            log_action(request.user, "Moved a concern/suggestion to a different folder")

        return Response(StaffConcernSerializer(concern, context={"request": request}).data)


class ConcernFolderListCreateView(generics.ListCreateAPIView):
    """GET /concerns/folders/ — any staff.  POST — Secretary/Administrator creates a folder."""

    queryset = ConcernFolder.objects.all()
    serializer_class = ConcernFolderSerializer

    def get_permissions(self):
        return [IsSecretaryOrAdmin()] if self.request.method == "POST" else [IsStaffOrAdmin()]

    def perform_create(self, serializer):
        folder = serializer.save()
        log_action(self.request.user, f"Created folder '{folder.name}'")


class ConcernFolderDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET — any staff.  PATCH (rename) / DELETE — Secretary/Administrator."""

    queryset = ConcernFolder.objects.all()
    serializer_class = ConcernFolderSerializer

    def get_permissions(self):
        if self.request.method in ("PATCH", "PUT", "DELETE"):
            return [IsSecretaryOrAdmin()]
        return [IsStaffOrAdmin()]

    def perform_update(self, serializer):
        folder = serializer.save()
        log_action(self.request.user, f"Renamed a folder to '{folder.name}'")

    def perform_destroy(self, instance):
        name = instance.name
        instance.delete()
        log_action(self.request.user, f"Deleted folder '{name}'")


# ---------------------------------------------------------------------------
# 4. Questions and FAQs
# ---------------------------------------------------------------------------

class StaffQuestionListView(generics.ListAPIView):
    """GET /questions/staff/ — every citizen question."""

    queryset = Question.objects.select_related("citizen").all()
    serializer_class = StaffQuestionSerializer
    permission_classes = [IsStaffOrAdmin]


class StaffQuestionAnswerView(APIView):
    """PATCH /questions/staff/<id>/ — answer a question (the citizen is emailed)."""

    permission_classes = [IsStaffOrAdmin]

    def patch(self, request, pk):
        question = get_object_or_404(Question, pk=pk)
        serializer = StaffQuestionAnswerSerializer(question, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(answered_by=request.user, answered_at=timezone.now())
        log_action(request.user, "Answered a citizen's question")
        send_question_answered_email(question)
        return Response(StaffQuestionSerializer(question).data)


class FAQListView(generics.ListAPIView):
    """GET /faqs/ — the public FAQ list (no login needed)."""

    queryset = FAQ.objects.all()
    serializer_class = FAQSerializer
    permission_classes = [permissions.AllowAny]


class AdminFAQListCreateView(generics.ListCreateAPIView):
    """GET/POST /faqs/admin/ — Administrator manages the FAQ list."""

    queryset = FAQ.objects.all()
    serializer_class = FAQSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        faq = serializer.save()
        log_action(self.request.user, f"Added an FAQ: {faq.question[:60]}")


class AdminFAQDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE /faqs/admin/<id>/ — edit or remove an FAQ."""

    queryset = FAQ.objects.all()
    serializer_class = FAQSerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        faq = serializer.save()
        log_action(self.request.user, f"Updated an FAQ: {faq.question[:60]}")

    def perform_destroy(self, instance):
        question = instance.question[:60]
        instance.delete()
        log_action(self.request.user, f"Deleted an FAQ: {question}")
