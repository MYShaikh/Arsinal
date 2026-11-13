"""Small great-circle helpers shared by the place and water lookups."""
import math


def haversine_m(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(a))


def bearing_deg(lat1, lng1, lat2, lng2):
    """Compass bearing from point 1 to point 2: 0 is north, 90 east."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    d = math.radians(lng2 - lng1)
    y = math.sin(d) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(d)
    return (math.degrees(math.atan2(y, x)) + 360) % 360
