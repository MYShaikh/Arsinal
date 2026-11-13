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


class NuclearTests(APITestCase):
    def test_capacity_units(self):
        from .nuclear import parse_capacity_mw

        self.assertEqual(parse_capacity_mw('1.2 GW'), 1200)
        self.assertEqual(parse_capacity_mw('900 MW'), 900)
        self.assertEqual(parse_capacity_mw('1200000000'), 1200)
        self.assertIsNone(parse_capacity_mw('yes'))

    def test_parse_elements_skips_research_sites_and_missing_output(self):
        from .nuclear import parse_elements

        plants = parse_elements([
            {'type': 'node', 'id': 1, 'lat': 1.0, 'lon': 2.0, 'tags': {'name': 'Real', 'plant:output:electricity': '1 GW'}},
            {'type': 'way', 'id': 2, 'center': {'lat': 3.0, 'lon': 4.0}, 'tags': {'plant:output:electricity': 'yes'}},
            {'type': 'node', 'id': 3, 'lat': 5.0, 'lon': 6.0, 'tags': {'name': 'No output'}},
            {'type': 'node', 'id': 4, 'lat': 7.0, 'lon': 8.0, 'tags': {'name': 'Science Center', 'plant:output:electricity': '1 MW'}},
        ])
        self.assertEqual([p['id'] for p in plants], ['way/2', 'node/1'])
        self.assertIsNone(plants[0]['capacity_mw'])
        self.assertEqual(plants[1]['capacity_mw'], 1000)

    def test_endpoint_serves_snapshot(self):
        data = self.client.get('/api/nuclear/').data
        self.assertGreater(len(data), 150)
        self.assertEqual(set(data[0]), {'id', 'name', 'operator', 'capacity_mw', 'lat', 'lng'})
