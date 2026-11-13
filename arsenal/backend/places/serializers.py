from rest_framework import serializers

from .models import RecentSearch, SavedPlace


class CoordinateValidationMixin:
    def validate_lat(self, value):
        if not -90 <= value <= 90:
            raise serializers.ValidationError('Latitude must be between -90 and 90.')
        return value

    def validate_lng(self, value):
        if not -180 <= value <= 180:
            raise serializers.ValidationError('Longitude must be between -180 and 180.')
        return value


class SavedPlaceSerializer(CoordinateValidationMixin, serializers.ModelSerializer):
    class Meta:
        model = SavedPlace
        fields = ['id', 'name', 'address', 'lat', 'lng', 'google_place_id', 'category', 'note', 'created_at']
        read_only_fields = ['id', 'created_at']


class RecentSearchSerializer(CoordinateValidationMixin, serializers.ModelSerializer):
    class Meta:
        model = RecentSearch
        fields = ['id', 'query', 'address', 'lat', 'lng', 'google_place_id', 'created_at']
        read_only_fields = ['id', 'created_at']
