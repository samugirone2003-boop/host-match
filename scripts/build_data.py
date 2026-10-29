"""Converte i dati Inside Airbnb e OpenStreetMap di Milano nei file compatti usati dal sito.

Uso:
    python3 scripts/build_data.py <cartella_dati> <data_snapshot>

La cartella deve contenere (vedi README):
    listings.csv.gz         Inside Airbnb, sezione "data"
    reviews.csv             Inside Airbnb, sezione "visualisations"
    neighbourhoods.geojson  Inside Airbnb, sezione "visualisations"
    osm.json                risposta Overpass con locali, parchi, metro e tram

Scrive data/listings.json, data/neighbourhoods.geojson e data/context.json.
"""
import csv
import gzip
import json
import math
import os
import sys
from collections import Counter
from datetime import date

csv.field_size_limit(10**9)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOM_TYPES = ["Entire home/apt", "Private room", "Shared room", "Hotel room"]
KM_LAT = 110.57
KM_LON = 111.32 * math.cos(math.radians(45.46))

# Servizi analizzati nella sezione "Cosa offrire": (nome sul sito, test sul nome Airbnb in minuscolo).
AMENITIES = [
    ("Wi-Fi", lambda a: a == "wifi" or a.startswith("wifi ")),
    ("Aria condizionata", lambda a: "air conditioning" in a or a.startswith("ac - ")),
    ("Lavatrice", lambda a: "washer" in a and "dishwasher" not in a),
    ("Asciugatrice", lambda a: "dryer" in a and "hair" not in a),
    ("Lavastoviglie", lambda a: a == "dishwasher"),
    ("Macchina del caffè", lambda a: a.startswith("coffee maker")),
    ("Spazio per lavorare", lambda a: a == "dedicated workspace"),
    ("Self check-in", lambda a: a in ("self check-in", "lockbox", "smart lock", "keypad")),
    ("Ascensore", lambda a: a == "elevator"),
    ("Balcone o terrazzo", lambda a: "patio or balcony" in a or "backyard" in a),
    ("Parcheggio nella struttura", lambda a: "parking on premises" in a),
    ("Tende oscuranti", lambda a: a == "room-darkening shades"),
    ("Culla per bambini", lambda a: "crib" in a),
    ("Animali ammessi", lambda a: a == "pets allowed"),
    ("Deposito bagagli", lambda a: a == "luggage dropoff allowed"),
    ("Soggiorni lunghi", lambda a: a == "long term stays allowed"),
]


def num(value, cast=float):
    try:
        return cast(value)
    except (TypeError, ValueError):
        return None


def nightly_price(row):
    """Prezzo per notte in EUR, solo per soggiorni brevi (esclude affitti mensili)."""
    price = num(row["price_quote_price_per_night"]) or num(row["price"].replace("$", "").replace(",", ""))
    if price is None or not 15 <= price <= 2000:
        return None
    if (num(row["minimum_nights"], int) or 1) >= 28:
        return None
    try:
        if json.loads(row["price_quote_raw"])["quote"]["is_monthly_priced"]:
            return None
    except (ValueError, KeyError, TypeError):
        pass
    return round(price)


def amenity_mask(row):
    try:
        names = [a.lower() for a in json.loads(row["amenities"] or "[]")]
    except ValueError:
        return 0
    mask = 0
    for bit, (_, test) in enumerate(AMENITIES):
        if any(test(a) for a in names):
            mask |= 1 << bit
    return mask


def title(name):
    small = {"di", "del", "della", "dei", "e", "a", "al"}
    words = name.lower().split()
    return " ".join(w if i and w in small else w.capitalize() for i, w in enumerate(words))


def km(lat, lon):
    return lon * KM_LON, lat * KM_LAT


def distance_m(a, b):
    ax, ay = km(*a)
    bx, by = km(*b)
    return math.hypot(ax - bx, ay - by) * 1000


def rings(geometry):
    polys = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    return polys


def inside(lon, lat, polys):
    for poly in polys:
        hit = False
        for ring in poly:  # anelli interni (buchi) invertono il risultato
            for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
                if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                    hit = not hit
        if hit:
            return True
    return False


def area_km2(polys):
    total = 0.0
    for poly in polys:
        for i, ring in enumerate(poly):
            pts = [km(lat, lon) for lon, lat in ring]
            a = abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))) / 2
            total += -a if i else a
    return total


def osm_places(path):
    """Divide gli elementi OSM in locali, parchi, stazioni metro (una per nome) e fermate tram."""
    places = {"food": [], "parks": [], "metro": {}, "tram": []}
    for el in json.load(open(path, encoding="utf-8"))["elements"]:
        tags = el.get("tags", {})
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None:
            continue
        if tags.get("amenity") in ("bar", "restaurant", "cafe", "pub", "fast_food"):
            places["food"].append((lat, lon))
        elif tags.get("leisure") == "park" or (tags.get("leisure") == "garden" and tags.get("name")):
            places["parks"].append((lat, lon))
        elif tags.get("station") == "subway" and tags.get("name"):
            places["metro"].setdefault(tags["name"], (lat, lon))
        elif tags.get("railway") == "tram_stop":
            places["tram"].append((lat, lon))
    return places


def seasonality(reviews_path, listing_hood, snapshot, hood_count):
    """Quota di recensioni per mese negli ultimi 3 anni: approssima i mesi in cui si prenota di più."""
    end = date.fromisoformat(snapshot)
    start = date(end.year - 3, end.month, 1)
    city = Counter()
    by_hood = [Counter() for _ in range(hood_count)]
    with open(reviews_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            d = row["date"]
            if not (start.isoformat() <= d < f"{end.year}-{end.month:02d}-01"):
                continue
            month = int(d[5:7]) - 1
            city[month] += 1
            hood = listing_hood.get(row["listing_id"])
            if hood is not None:
                by_hood[hood][month] += 1

    def shares(counter):
        total = sum(counter.values())
        return [round(counter[m] / total, 4) for m in range(12)] if total >= 1500 else None

    return shares(city), [shares(c) for c in by_hood]


def main(src, snapshot):
    rows = list(csv.DictReader(gzip.open(os.path.join(src, "listings.csv.gz"), "rt", encoding="utf-8")))
    places = osm_places(os.path.join(src, "osm.json"))
    metro = list(places["metro"].items())

    hoods = sorted({r["neighbourhood_cleansed"] for r in rows})
    hood_index = {h: i for i, h in enumerate(hoods)}

    points, listing_hood = [], {}
    for r in rows:
        lat, lon = num(r["latitude"]), num(r["longitude"])
        if lat is None or lon is None or r["room_type"] not in ROOM_TYPES:
            continue
        rating = num(r["review_scores_rating"])
        listing_hood[r["id"]] = hood_index[r["neighbourhood_cleansed"]]
        metro_dist = min(distance_m((lat, lon), p) for _, p in metro)
        points.append([
            round(lat, 4),
            round(lon, 4),
            ROOM_TYPES.index(r["room_type"]),
            hood_index[r["neighbourhood_cleansed"]],
            nightly_price(r),
            num(r["accommodates"], int),
            num(r["bedrooms"], float) and int(float(r["bedrooms"])),
            num(r["estimated_occupancy_l365d"], int),
            round(rating, 2) if rating else None,
            num(r["number_of_reviews"], int) or 0,
            1 if (num(r["calculated_host_listings_count"], int) or 1) > 1 else 0,
            amenity_mask(r),
            round(metro_dist / 10) * 10,
            r["id"],  # stringa: gli id Airbnb superano la precisione dei numeri JavaScript
        ])

    out = {
        "snapshot": snapshot,
        "roomTypes": ["Casa intera", "Stanza privata", "Stanza condivisa", "Camera d'hotel"],
        "neighbourhoods": [title(h) for h in hoods],
        "amenities": [name for name, _ in AMENITIES],
        "fields": ["lat", "lon", "type", "hood", "price", "guests", "bedrooms", "occupancy", "rating", "reviews",
                   "multiHost", "amenities", "metroDist", "id"],
        "listings": points,
    }
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "listings.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

    geo = json.load(open(os.path.join(src, "neighbourhoods.geojson"), encoding="utf-8"))
    zones = [None] * len(hoods)
    for feature in geo["features"]:
        name = feature["properties"]["neighbourhood"]
        hood = hood_index.get(name, -1)
        feature["properties"] = {"hood": hood, "name": title(name)}
        polys = rings(feature["geometry"])
        if hood >= 0:
            count = lambda pts: sum(1 for lat, lon in pts if inside(lon, lat, polys))
            zones[hood] = {
                "area": round(area_km2(polys), 2),
                "food": count(places["food"]),
                "parks": count(places["parks"]),
                "tram": count(places["tram"]),
                "metro": sorted(n for n, (lat, lon) in metro if inside(lon, lat, polys)),
            }
        # 4 decimali (~10 m) bastano per i confini e dimezzano il file
        feature["geometry"]["coordinates"] = json.loads(
            json.dumps(feature["geometry"]["coordinates"]),
            parse_float=lambda v: round(float(v), 4),
        )
    with open(os.path.join(ROOT, "data", "neighbourhoods.geojson"), "w", encoding="utf-8") as f:
        json.dump(geo, f, separators=(",", ":"), ensure_ascii=False)

    city_season, hood_season = seasonality(os.path.join(src, "reviews.csv"), listing_hood, snapshot, len(hoods))
    context = {
        "zones": zones,
        "metroStations": [[n, round(lat, 5), round(lon, 5)] for n, (lat, lon) in metro],
        "season": {"city": city_season, "hoods": hood_season},
    }
    with open(os.path.join(ROOT, "data", "context.json"), "w", encoding="utf-8") as f:
        json.dump(context, f, separators=(",", ":"), ensure_ascii=False)

    priced = sum(1 for p in points if p[4] is not None)
    print(f"{len(points)} annunci, {priced} con prezzo a notte, {len(hoods)} quartieri, {len(metro)} stazioni metro")


if __name__ == "__main__":
    main(*sys.argv[1:3])
