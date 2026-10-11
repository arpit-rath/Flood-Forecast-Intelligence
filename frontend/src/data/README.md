# DTU-area OpenStreetMap road snapshot

`delhi-roads.json` is a one-time, manually retrieved extract of OpenStreetMap ways. Source: [OpenStreetMap API 0.6 map extract](https://api.openstreetmap.org/api/0.6/map?bbox=77.11,28.747,77.125,28.760), bounding box `77.110,28.747,77.125,28.760` (west, south, east, north), retrieved 11 October 2026. It retains 84 ways tagged `primary`, `secondary`, `tertiary`, `residential`, `unclassified`, or `living_street`, their full way geometry, OSM way IDs, road names where present, and OSM edit timestamps. Ways intersecting the query box can extend beyond it. This is **not** a complete DTU or Delhi road inventory, an official road register, an open/closed status feed, or flood evidence.

Data © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright). The derived road snapshot is offered under ODbL. The preview displays attribution on the map and in the source panel. Amazon Location Standard and Hybrid basemap tiles have their own provider attribution; no Google data or assets are used. An OSM edit timestamp records map-data maintenance, **not** when a flood condition was observed.

The site never fetches OSM or Overpass data automatically. To refresh deliberately, review the intended bounding box and source terms first, then run from the repository root:

```powershell
$osmExtract = New-TemporaryFile
Invoke-WebRequest -Uri 'https://api.openstreetmap.org/api/0.6/map?bbox=77.11,28.747,77.125,28.760' -OutFile $osmExtract.FullName
python frontend/scripts/build_osm_roads.py $osmExtract.FullName frontend/src/data/delhi-roads.json --replace
```

Inspect the generated diff, source timestamps, way count, geometry, road names, and licence notice before accepting a refresh. Do not substitute an unlicensed basemap or copy geometry from satellite imagery. After any accepted refresh, rerun `python infra/package_lambda.py`, build/test the Lambda and preview together, and check that `/v2/roads` publishes the new SHA-256 `geometryVersion`. Existing clients with the old version are rejected as stale. Changing IDs or geometry may orphan earlier reports and requires a separately reviewed road-reference migration or expiry decision; never silently attach old evidence to a new way. The current `/v2` backend is implemented locally but not deployed.
