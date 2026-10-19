from django.contrib import admin

from .models import Concern, ConcernAttachment, Report, ReportAttachment

admin.site.register(Report)
admin.site.register(ReportAttachment)
admin.site.register(Concern)
admin.site.register(ConcernAttachment)
