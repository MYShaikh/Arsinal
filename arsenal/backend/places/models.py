from django.db import models


class SavedPlace(models.Model):
    class Category(models.TextChoices):
        FAVORITE = 'favorite', 'Favorite'
        WANT_TO_GO = 'want_to_go', 'Want to go'
        STARRED = 'starred', 'Starred'

    name = models.CharField(max_length=200)
    address = models.CharField(max_length=300, blank=True)
    lat = models.FloatField()
    lng = models.FloatField()
    google_place_id = models.CharField(max_length=255, blank=True)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.FAVORITE)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name


class RecentSearch(models.Model):
    query = models.CharField(max_length=300)
    address = models.CharField(max_length=300, blank=True)
    lat = models.FloatField()
    lng = models.FloatField()
    google_place_id = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.query
