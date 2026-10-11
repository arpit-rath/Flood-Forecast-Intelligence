"""Convert a manually downloaded OSM map XML extract to a static road snapshot.

This script has no network access. Review the source extract and resulting diff
before replacing the checked-in snapshot.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import xml.etree.ElementTree as ET


BBOX = (77.11, 28.747, 77.125, 28.760)
SOURCE_URL = "https://api.openstreetmap.org/api/0.6/map?bbox=77.11,28.747,77.125,28.760"
HIGHWAYS = {"primary", "secondary", "tertiary", "residential", "unclassified", "living_street"}


def convert(source: Path, retrieved_at: str) -> dict:
    root = ET.parse(source).getroot()
    if root.tag != "osm":
        raise ValueError("expected an OpenStreetMap XML extract")
    nodes = {
        node.attrib["id"]: [float(node.attrib["lon"]), float(node.attrib["lat"])]
        for node in root.findall("node")
    }
    features = []
    for way in root.findall("way"):
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
        highway = tags.get("highway")
        if highway not in HIGHWAYS:
            continue
        refs = [node.attrib["ref"] for node in way.findall("nd")]
        if any(ref not in nodes for ref in refs):
            raise ValueError(f"missing geometry for OSM way {way.attrib['id']}")
        coordinates = [nodes[ref] for ref in refs]
        if len(coordinates) < 2:
            continue
        way_id = int(way.attrib["id"])
        features.append({
            "type": "Feature",
            "id": f"osm:way/{way_id}",
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "properties": {
                "name": tags.get("name") or None,
                "highway": highway,
                "osmEditedAt": way.attrib.get("timestamp"),
            },
        })
    features.sort(key=lambda feature: int(feature["id"].split("/")[1]))
    if not features:
        raise ValueError("no supported roads found in extract")
    return {
        "type": "FeatureCollection",
        "metadata": {
            "source": "OpenStreetMap contributors",
            "sourceUrl": SOURCE_URL,
            "licence": "ODbL 1.0",
            "licenceUrl": "https://www.openstreetmap.org/copyright",
            "retrievedAt": retrieved_at,
            "queryBbox": list(BBOX),
            "coverageNote": "Selected OSM road ways intersecting the DTU-area query box; not a complete Delhi road inventory or flood assessment.",
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="manually downloaded OSM XML extract")
    parser.add_argument("output", type=Path, help="checked-in GeoJSON snapshot")
    parser.add_argument("--replace", action="store_true", help="allow replacing an existing snapshot after review")
    args = parser.parse_args()
    if args.output.exists() and not args.replace:
        parser.error("output already exists; review the new extract and pass --replace explicitly")
    retrieved_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    snapshot = convert(args.source, retrieved_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Staged {len(snapshot['features'])} OSM road ways in {args.output}")


if __name__ == "__main__":
    main()
