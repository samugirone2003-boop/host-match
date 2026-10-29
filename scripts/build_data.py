"""Converte i dati Inside Airbnb di Milano nei file compatti usati dal sito.

Uso:
    python3 scripts/build_data.py <listings.csv.gz> <neighbourhoods.geojson> <data_snapshot>

Scrive data/listings.json e data/neighbourhoods.geojson.
"""
import csv
import gzip
import json
import os
import sys

csv.field_size_limit(10**9)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOM_TYPES = ["Entire home/apt", "Private room", "Shared room", "Hotel room"]


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


def title(name):
    small = {"di", "del", "della", "dei", "e", "a", "al"}
    words = name.lower().split()
    return " ".join(w if i and w in small else w.capitalize() for i, w in enumerate(words))


def main(listings_path, geojson_path, snapshot):
    rows = list(csv.DictReader(gzip.open(listings_path, "rt", encoding="utf-8")))

    hoods = sorted({r["neighbourhood_cleansed"] for r in rows})
    hood_index = {h: i for i, h in enumerate(hoods)}

    points = []
    for r in rows:
        lat, lon = num(r["latitude"]), num(r["longitude"])
        if lat is None or lon is None or r["room_type"] not in ROOM_TYPES:
            continue
        rating = num(r["review_scores_rating"])
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
        ])

    out = {
        "snapshot": snapshot,
        "roomTypes": ["Casa intera", "Stanza privata", "Stanza condivisa", "Camera d'hotel"],
        "neighbourhoods": [title(h) for h in hoods],
        "fields": ["lat", "lon", "type", "hood", "price", "guests", "bedrooms", "occupancy", "rating", "reviews", "multiHost"],
        "listings": points,
    }
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "listings.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

    geo = json.load(open(geojson_path, encoding="utf-8"))
    for feature in geo["features"]:
        name = feature["properties"]["neighbourhood"]
        feature["properties"] = {"hood": hood_index.get(name, -1), "name": title(name)}
        # 4 decimali (~10 m) bastano per i confini e dimezzano il file
        feature["geometry"]["coordinates"] = json.loads(
            json.dumps(feature["geometry"]["coordinates"]),
            parse_float=lambda v: round(float(v), 4),
        )
    with open(os.path.join(ROOT, "data", "neighbourhoods.geojson"), "w", encoding="utf-8") as f:
        json.dump(geo, f, separators=(",", ":"), ensure_ascii=False)

    priced = sum(1 for p in points if p[4] is not None)
    print(f"{len(points)} annunci, {priced} con prezzo a notte, {len(hoods)} quartieri")


if __name__ == "__main__":
    main(*sys.argv[1:4])
