from django.contrib import admin

from .models import RecentSearch, SavedPlace

admin.site.register(SavedPlace)
admin.site.register(RecentSearch)
