from django.test import override_settings
from rest_framework.test import APITestCase

from .models import RecentSearch, SavedPlace

PLACE = {'name': 'Eiffel Tower', 'address': 'Paris', 'lat': 48.8584, 'lng': 2.2945, 'google_place_id': 'abc'}


class SavedPlaceTests(APITestCase):
    def test_create_list_update_delete(self):
        r = self.client.post('/api/places/', PLACE, format='json')
        self.assertEqual(r.status_code, 201)
        pid = r.data['id']
        self.assertEqual(len(self.client.get('/api/places/').data), 1)
        r = self.client.patch(f'/api/places/{pid}/', {'category': 'starred', 'note': 'visit'}, format='json')
        self.assertEqual(r.data['category'], 'starred')
        self.assertEqual(self.client.delete(f'/api/places/{pid}/').status_code, 204)
        self.assertEqual(SavedPlace.objects.count(), 0)

    def test_rejects_invalid_coordinates(self):
        r = self.client.post('/api/places/', {**PLACE, 'lat': 123}, format='json')
        self.assertEqual(r.status_code, 400)
        r = self.client.post('/api/places/', {**PLACE, 'lng': -200}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_filter_by_category(self):
        self.client.post('/api/places/', PLACE, format='json')
        self.client.post('/api/places/', {**PLACE, 'category': 'starred'}, format='json')
        self.assertEqual(len(self.client.get('/api/places/?category=starred').data), 1)


class RecentSearchTests(APITestCase):
    def test_repeat_search_is_deduplicated(self):
        body = {'query': 'Louvre', 'lat': 48.86, 'lng': 2.33, 'google_place_id': 'xyz'}
        self.client.post('/api/recents/', body, format='json')
        self.client.post('/api/recents/', body, format='json')
        self.assertEqual(RecentSearch.objects.count(), 1)

    def test_clear(self):
        self.client.post('/api/recents/', {'query': 'a', 'lat': 1, 'lng': 1}, format='json')
        self.assertEqual(self.client.delete('/api/recents/clear/').status_code, 204)
        self.assertEqual(RecentSearch.objects.count(), 0)


class ConfigTests(APITestCase):
    @override_settings(GOOGLE_MAPS_API_KEY='test-key')
    def test_config_exposes_key(self):
        self.assertEqual(self.client.get('/api/config/').data['googleMapsApiKey'], 'test-key')

    def test_health(self):
        self.assertEqual(self.client.get('/api/health/').data['app'], 'arsenal')
