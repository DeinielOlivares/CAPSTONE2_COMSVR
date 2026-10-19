from django.contrib import admin

from .models import Ordinance, OrdinanceAuthor, OrdinanceCategory

admin.site.register(Ordinance)
admin.site.register(OrdinanceAuthor)
admin.site.register(OrdinanceCategory)
