from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('places', views.SavedPlaceViewSet, basename='place')
router.register('recents', views.RecentSearchViewSet, basename='recent')

urlpatterns = [
    path('health/', views.health),
    path('config/', views.config),
    path('nuclear/', views.nuclear_plants),
    path('poi/<int:x>/<int:y>/', views.poi_tile),
    path('water/nearest/', views.nearest_water),
    path('recents/clear/', views.RecentSearchViewSet.as_view({'delete': 'clear'})),
    *router.urls,
]
