from django.conf import settings
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.throttling import AnonRateThrottle
from rest_framework.response import Response

from . import identify, nuclear, pois, water, wildlife
from .overpass import OverpassError
from .models import RecentSearch, SavedPlace
from .serializers import RecentSearchSerializer, SavedPlaceSerializer

MAX_RECENTS = 20


@api_view(['GET'])
def config(request):
    """Public client configuration. The Maps key is a browser key; restrict it by HTTP referrer."""
    return Response({'googleMapsApiKey': settings.GOOGLE_MAPS_API_KEY})


@api_view(['GET'])
def health(request):
    return Response({'status': 'ok', 'app': 'arsenal'})


@api_view(['GET'])
def nuclear_plants(request):
    """Operating nuclear power plants worldwide (OpenStreetMap data; refresh with update_nuclear_plants)."""
    return Response(nuclear.load_snapshot())


OSM_BUSY = {'detail': 'The OpenStreetMap data service is busy. Try again shortly.'}


@api_view(['GET'])
def poi_tile(request, x, y):
    """Hospitals, pharmacies, grocery stores and ammunition shops in one zoom-12 map tile."""
    limit = 2**pois.TILE_ZOOM
    if not (0 <= x < limit and 0 <= y < limit):
        return Response({'detail': 'Tile out of range.'}, status=status.HTTP_404_NOT_FOUND)
    try:
        return Response(pois.fetch_tile(x, y))
    except OverpassError:
        return Response(OSM_BUSY, status=status.HTTP_502_BAD_GATEWAY)


class AiThrottle(AnonRateThrottle):
    """Limits the endpoints that call Gemini, which cost money per request."""

    scope = 'ai'


def _point(request):
    """(lat, lng) from the query string, or an error Response."""
    try:
        lat, lng = float(request.query_params['lat']), float(request.query_params['lng'])
    except (KeyError, ValueError):
        return Response({'detail': 'lat and lng are required numbers.'}, status=status.HTTP_400_BAD_REQUEST)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return Response({'detail': 'lat or lng is out of range.'}, status=status.HTTP_400_BAD_REQUEST)
    return lat, lng


@api_view(['GET'])
def nearest_water(request):
    """Nearest river, stream or canal to ?lat=&lng= with its distance and compass bearing."""
    point = _point(request)
    if isinstance(point, Response):
        return point
    try:
        return Response(water.nearest_flowing_water(*point))
    except OverpassError:
        return Response(OSM_BUSY, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['GET'])
def nearest_place(request):
    """Closest hospital, pharmacy, grocery, ammo shop, nuclear plant or flowing water to ?lat=&lng=&category=."""
    point = _point(request)
    if isinstance(point, Response):
        return point
    category = request.query_params.get('category')
    try:
        if category == 'nuclear':
            return Response(nuclear.nearest(*point))
        if category == 'water':
            return Response(water.nearest_flowing_water(*point))
        if category in pois.CATEGORIES:
            return Response(pois.nearest(category, *point))
    except OverpassError:
        return Response(OSM_BUSY, status=status.HTTP_502_BAD_GATEWAY)
    return Response({'detail': 'Unknown category.'}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@throttle_classes([AiThrottle])
def identify_photo(request):
    """Identifies an animal track or plant from an uploaded photo (multipart: image, kind, optional lat/lng)."""
    image = request.FILES.get('image')
    kind = request.data.get('kind')
    if image is None:
        return Response({'detail': 'Attach a photo as "image".'}, status=status.HTTP_400_BAD_REQUEST)
    if kind not in identify.KINDS:
        return Response({'detail': 'kind must be "track" or "plant".'}, status=status.HTTP_400_BAD_REQUEST)
    if image.content_type not in identify.MEDIA_TYPES:
        return Response({'detail': 'The photo must be a JPEG, PNG, WebP or GIF.'}, status=status.HTTP_400_BAD_REQUEST)
    if image.size > identify.MAX_IMAGE_BYTES:
        return Response({'detail': 'The photo is larger than 5 MB.'}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

    location = None
    if 'lat' in request.data and 'lng' in request.data:
        try:
            lat, lng = float(request.data['lat']), float(request.data['lng'])
        except ValueError:
            return Response({'detail': 'lat and lng must be numbers.'}, status=status.HTTP_400_BAD_REQUEST)
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            location = (lat, lng)

    try:
        return Response(identify.identify(image.read(), image.content_type, kind, location))
    except identify.IdentifyError as error:
        return Response({'detail': str(error)}, status=error.status)


@api_view(['GET'])
@throttle_classes([AiThrottle])
def wildlife_nearby(request):
    """Dangerous, venomous and poisonous animals near ?lat=&lng=, each with a Wikipedia picture."""
    point = _point(request)
    if isinstance(point, Response):
        return point
    try:
        return Response(wildlife.nearby(*point))
    except identify.IdentifyError as error:
        return Response({'detail': str(error)}, status=error.status)


class SavedPlaceViewSet(viewsets.ModelViewSet):
    serializer_class = SavedPlaceSerializer

    def get_queryset(self):
        qs = SavedPlace.objects.all()
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)
        return qs


class RecentSearchViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = RecentSearchSerializer
    queryset = RecentSearch.objects.all()

    def list(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_queryset()[:MAX_RECENTS], many=True)
        return Response(serializer.data)

    def perform_create(self, serializer):
        # Searching the same place again moves it to the top instead of duplicating it.
        place_id = serializer.validated_data.get('google_place_id')
        if place_id:
            RecentSearch.objects.filter(google_place_id=place_id).delete()
        serializer.save()

    def clear(self, request):
        RecentSearch.objects.all().delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
