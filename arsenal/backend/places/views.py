from django.conf import settings
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import nuclear
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
