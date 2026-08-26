from django.urls import path

from trips.views import HealthView, PlaceSearchView, TripPlanView

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("places/search/", PlaceSearchView.as_view(), name="places-search"),
    path("trips/plan/", TripPlanView.as_view(), name="trips-plan"),
]
