from unittest import mock

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


class OverpassClientTests(APITestCase):
    def setUp(self):
        from . import overpass

        overpass._down_until.clear()

    def test_falls_back_to_the_next_instance_and_avoids_the_failed_one(self):
        import io
        import urllib.error

        from . import overpass

        calls = []

        def fake_urlopen(request, timeout):
            calls.append(request.full_url)
            if request.full_url == overpass.ENDPOINTS[0]:
                raise urllib.error.URLError('down')
            return io.BytesIO(b'{"elements": []}')

        with mock.patch('urllib.request.urlopen', fake_urlopen):
            self.assertEqual(overpass.run('q'), {'elements': []})
            self.assertEqual(overpass.run('q'), {'elements': []})
        # The second call skipped the instance that had just failed.
        self.assertEqual(calls, [overpass.ENDPOINTS[0], overpass.ENDPOINTS[1], overpass.ENDPOINTS[1]])

    def test_raises_when_every_instance_fails(self):
        import urllib.error

        from . import overpass

        with mock.patch('urllib.request.urlopen', side_effect=urllib.error.URLError('down')):
            with self.assertRaises(overpass.OverpassError):
                overpass.run('q')


class PoiTests(APITestCase):
    def setUp(self):
        from . import pois

        pois._cache.clear()

    def test_classify(self):
        from .pois import classify

        self.assertEqual(classify({'amenity': 'hospital'}), 'hospital')
        self.assertEqual(classify({'healthcare': 'pharmacy'}), 'pharmacy')
        self.assertEqual(classify({'shop': 'supermarket'}), 'grocery')
        self.assertEqual(classify({'shop': 'weapons'}), 'ammo')
        self.assertIsNone(classify({'amenity': 'restaurant'}))

    def test_tile_bounds_cover_the_world_at_zoom_zero(self):
        from .pois import tile_bounds

        south, west, north, east = tile_bounds(0, 0, zoom=0)
        self.assertEqual((west, east), (-180, 180))
        self.assertAlmostEqual(north, 85.0511, places=3)
        self.assertAlmostEqual(south, -85.0511, places=3)

    def test_tile_endpoint_parses_and_caches(self):
        elements = [
            {'type': 'node', 'id': 1, 'lat': 33.1, 'lon': -84.2, 'tags': {'amenity': 'hospital', 'name': 'General'}},
            {'type': 'way', 'id': 2, 'center': {'lat': 33.2, 'lon': -84.3}, 'tags': {'shop': 'weapons'}},
            {'type': 'node', 'id': 3, 'lat': 33.3, 'lon': -84.4, 'tags': {'amenity': 'cafe'}},
        ]
        with mock.patch('places.overpass.run', return_value={'elements': elements}) as run:
            first = self.client.get('/api/poi/1100/1650/').data
            self.client.get('/api/poi/1100/1650/')
        self.assertEqual([p['category'] for p in first], ['hospital', 'ammo'])
        self.assertEqual(run.call_count, 1)

    def test_tile_out_of_range(self):
        self.assertEqual(self.client.get('/api/poi/5000/1/').status_code, 404)

    def test_tile_reports_busy_overpass(self):
        from .overpass import OverpassError

        with mock.patch('places.overpass.run', side_effect=OverpassError('down')):
            self.assertEqual(self.client.get('/api/poi/1100/1650/').status_code, 502)


class IdentifyTests(APITestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()  # the Gemini endpoints are rate limited per visitor

    RESULT = {
        'subject': 'plant',
        'summary': 'Probably pokeweed.',
        'confidence': 'medium',
        'candidates': [],
        'safety_warning': 'Do not eat it.',
        'photo_tips': '',
    }

    def photo(self, content_type='image/jpeg', size=64):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile('photo.jpg', b'x' * size, content_type=content_type)

    def reply(self, finish='STOP', text=None, blocked=False):
        import json
        from types import SimpleNamespace

        return SimpleNamespace(
            text=json.dumps(self.RESULT) if text is None else text,
            prompt_feedback=SimpleNamespace(block_reason='SAFETY' if blocked else None),
            candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name=finish))],
        )

    def patch_gemini(self, **kwargs):
        """Replaces the Gemini client; returns the mocked generate_content()."""
        patcher = mock.patch('places.identify.genai.Client')
        generate = patcher.start().return_value.models.generate_content
        generate.configure_mock(**kwargs)
        self.addCleanup(patcher.stop)
        env = mock.patch.dict('os.environ', {'GEMINI_API_KEY': 'test-key'})
        env.start()
        self.addCleanup(env.stop)
        return generate

    def test_identifies_a_photo_and_sends_a_coarse_location(self):
        generate = self.patch_gemini(return_value=self.reply())
        response = self.client.post(
            '/api/identify/', {'image': self.photo(), 'kind': 'plant', 'lat': '33.80951', 'lng': '-84.23944'}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, self.RESULT)

        request = generate.call_args.kwargs
        image, question = request['contents']
        self.assertEqual(image.inline_data.mime_type, 'image/jpeg')
        # Only one decimal place of the position leaves the server.
        self.assertIn('latitude 33.8, longitude -84.2', question)
        self.assertNotIn('33.80951', question)

    def test_rejects_bad_uploads_without_calling_gemini(self):
        generate = self.patch_gemini()
        post = lambda data: self.client.post('/api/identify/', data).status_code
        self.assertEqual(post({'kind': 'plant'}), 400)
        self.assertEqual(post({'image': self.photo(), 'kind': 'rock'}), 400)
        self.assertEqual(post({'image': self.photo('application/pdf'), 'kind': 'plant'}), 400)
        self.assertEqual(post({'image': self.photo(size=5 * 1024 * 1024 + 1), 'kind': 'track'}), 413)
        generate.assert_not_called()

    def test_reports_blocked_photos_and_unreadable_answers(self):
        self.patch_gemini(side_effect=[self.reply(blocked=True), self.reply(finish='SAFETY'), self.reply(text='not json')])
        post = lambda: self.client.post('/api/identify/', {'image': self.photo(), 'kind': 'track'}).status_code
        self.assertEqual(post(), 422)
        self.assertEqual(post(), 422)
        self.assertEqual(post(), 502)

    def test_falls_back_to_the_next_model_when_one_is_retired(self):
        from google.genai import errors

        retired = errors.ClientError(404, {'error': {'message': 'model not found'}})
        generate = self.patch_gemini(side_effect=[retired, self.reply()])
        response = self.client.post('/api/identify/', {'image': self.photo(), 'kind': 'plant'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(generate.call_count, 2)

    def test_explains_missing_credentials(self):
        with mock.patch.dict('os.environ'):
            import os

            os.environ.pop('GEMINI_API_KEY', None)
            os.environ.pop('GOOGLE_MAPS_API_KEY', None)
            response = self.client.post('/api/identify/', {'image': self.photo(), 'kind': 'track'})
        self.assertEqual(response.status_code, 503)
        self.assertIn('GOOGLE_MAPS_API_KEY', response.data['detail'])


class NearestPlaceTests(APITestCase):
    def setUp(self):
        from . import pois

        pois._nearest_cache.clear()

    def test_picks_the_closest_of_the_requested_category(self):
        elements = [
            {'type': 'node', 'id': 1, 'lat': 0.05, 'lon': 0.0, 'tags': {'amenity': 'hospital', 'name': 'Far'}},
            {'type': 'node', 'id': 2, 'lat': 0.01, 'lon': 0.0, 'tags': {'amenity': 'hospital', 'name': 'Near'}},
        ]
        with mock.patch('places.overpass.run', return_value={'elements': elements}):
            data = self.client.get('/api/nearest/', {'lat': 0, 'lng': 0, 'category': 'hospital'}).data
        self.assertEqual(data['name'], 'Near')
        self.assertAlmostEqual(data['distance_m'], 1112, delta=15)
        self.assertEqual(data['bearing_deg'], 0)

    def test_widens_until_found(self):
        shop = {'type': 'node', 'id': 3, 'lat': 0.2, 'lon': 0.0, 'tags': {'shop': 'weapons'}}
        with mock.patch('places.overpass.run', side_effect=[{'elements': []}, {'elements': [shop]}]) as run:
            data = self.client.get('/api/nearest/', {'lat': 0, 'lng': 0, 'category': 'ammo'}).data
        self.assertTrue(data['found'])
        self.assertEqual(run.call_count, 2)

    def test_nearest_nuclear_plant_uses_the_snapshot(self):
        with mock.patch('places.overpass.run') as run:
            data = self.client.get('/api/nearest/', {'lat': 33.8, 'lng': -84.2, 'category': 'nuclear'}).data
        self.assertTrue(data['found'])
        self.assertEqual(data['category'], 'nuclear')
        run.assert_not_called()

    def test_unknown_category(self):
        self.assertEqual(self.client.get('/api/nearest/', {'lat': 0, 'lng': 0, 'category': 'cafe'}).status_code, 400)


class WaterTests(APITestCase):
    def setUp(self):
        from . import water

        water._cache.clear()

    def test_nearest_point_on_a_river_south_of_the_user(self):
        river = {
            'type': 'way',
            'id': 9,
            'tags': {'waterway': 'river', 'name': 'Test River'},
            'geometry': [{'lat': 1.0, 'lon': -1.0}, {'lat': 1.0, 'lon': 1.0}],
        }
        with mock.patch('places.overpass.run', return_value={'elements': [river]}):
            data = self.client.get('/api/water/nearest/', {'lat': 1.01, 'lng': 0.0}).data
        self.assertTrue(data['found'])
        self.assertEqual(data['name'], 'Test River')
        self.assertAlmostEqual(data['lat'], 1.0, places=3)
        self.assertAlmostEqual(data['lng'], 0.0, places=3)
        self.assertAlmostEqual(data['distance_m'], 1112, delta=15)
        self.assertEqual(data['bearing_deg'], 180)

    def test_widens_the_search_until_water_is_found(self):
        stream = {
            'type': 'way',
            'id': 9,
            'tags': {'waterway': 'stream'},
            'geometry': [{'lat': 0.0, 'lon': 0.0}, {'lat': 0.0, 'lon': 0.1}],
        }
        answers = [{'elements': []}, {'elements': [stream]}]
        with mock.patch('places.overpass.run', side_effect=answers) as run:
            data = self.client.get('/api/water/nearest/', {'lat': 0.02, 'lng': 0.05}).data
        self.assertTrue(data['found'])
        self.assertEqual(run.call_count, 2)

    def test_nothing_nearby(self):
        with mock.patch('places.overpass.run', return_value={'elements': []}):
            data = self.client.get('/api/water/nearest/', {'lat': 5, 'lng': 5}).data
        self.assertEqual(data, {'found': False, 'searched_m': 80000})

    def test_reports_incomplete_search_when_a_wide_query_fails(self):
        from .overpass import OverpassError

        with mock.patch('places.overpass.run', side_effect=[{'elements': []}, OverpassError('slow')]):
            data = self.client.get('/api/water/nearest/', {'lat': 5, 'lng': 5}).data
        self.assertEqual(data, {'found': False, 'searched_m': 1500, 'incomplete': True})

    def test_validates_input(self):
        self.assertEqual(self.client.get('/api/water/nearest/').status_code, 400)
        self.assertEqual(self.client.get('/api/water/nearest/', {'lat': 95, 'lng': 0}).status_code, 400)


class WildlifeTests(APITestCase):
    ANSWER = {
        'region': 'Georgia, United States',
        'animals': [
            {
                'common_name': 'Eastern diamondback rattlesnake', 'scientific_name': 'Crotalus adamanteus',
                'category': 'venomous', 'risk': 'Venomous bite.', 'precaution': 'Keep away.',
                'wikipedia_title': 'Eastern diamondback rattlesnake',
            },
            {
                'common_name': 'American alligator', 'scientific_name': 'Alligator mississippiensis',
                'category': 'dangerous', 'risk': 'Can bite.', 'precaution': 'Stay back from water.',
                'wikipedia_title': 'Missing page',
            },
        ],
    }

    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.addCleanup(cache.clear)

    def patch(self):
        answer = mock.patch('places.wildlife.generate_json', return_value=self.ANSWER)
        self.generate = answer.start()
        self.addCleanup(answer.stop)

        def get(url, **kwargs):
            found = 'Missing' not in url and 'Alligator' not in url
            reply = mock.Mock(status_code=200 if found else 404)
            reply.json.return_value = {
                'thumbnail': {'source': 'https://upload.wikimedia.org/x.jpg'},
                'content_urls': {'desktop': {'page': 'https://en.wikipedia.org/wiki/X'}},
            }
            return reply

        http = mock.patch('places.wildlife.requests.get', side_effect=get)
        http.start()
        self.addCleanup(http.stop)

    def test_lists_animals_with_pictures_and_caches_by_area(self):
        self.patch()
        response = self.client.get('/api/wildlife/', {'lat': '33.81', 'lng': '-84.24'})
        self.assertEqual(response.status_code, 200)
        snake, gator = response.data['animals']
        self.assertEqual(snake['image_url'], 'https://upload.wikimedia.org/x.jpg')
        self.assertIsNone(gator['image_url'])  # no article found, so the card simply has no picture
        # A nearby point in the same 0.5-degree cell is answered from the cache.
        self.client.get('/api/wildlife/', {'lat': '33.9', 'lng': '-84.2'})
        self.assertEqual(self.generate.call_count, 1)
        self.assertIn('latitude 34.0', self.generate.call_args.args[1][0])

    def test_needs_a_location(self):
        self.patch()
        self.assertEqual(self.client.get('/api/wildlife/').status_code, 400)
        self.generate.assert_not_called()


class ThrottleTests(APITestCase):
    def test_gemini_endpoints_are_rate_limited_per_visitor(self):
        from django.core.cache import cache

        cache.clear()
        self.addCleanup(cache.clear)
        codes = [self.client.get('/api/wildlife/').status_code for _ in range(22)]
        self.assertEqual(codes[:20], [400] * 20)  # counted even when the request is rejected
        self.assertEqual(codes[20], 429)
