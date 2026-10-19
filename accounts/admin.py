from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import LoginSession, User, VoterVerification


class CustomUserAdmin(UserAdmin):
    model = User
    list_display = ["email", "username", "role", "is_verified", "is_staff"]
    # UserAdmin's default also searches first_name/last_name, which are
    # encrypted columns now and can't be searched by the database.
    search_fields = ["email", "username"]
    fieldsets = UserAdmin.fieldsets + (
        ("Barangay Platero OVRMS fields", {"fields": ("role", "contact_number", "address", "is_verified")}),
    )


admin.site.register(User, CustomUserAdmin)
admin.site.register(VoterVerification)
admin.site.register(LoginSession)
