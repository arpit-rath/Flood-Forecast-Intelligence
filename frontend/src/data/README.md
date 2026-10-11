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

## Reviewed alert context (local only)

`alert-context.json` is a deliberately small, versioned context index pinned to the SHA-256 `geometryVersion` of `delhi-roads.json`. It contains **no asserted road aliases**. Its one landmark entry uses corner 2 of the Delhi Technological University site boundary published in a [Government of India environmental clearance letter](https://environmentclearance.nic.in/writereaddata/Form-1A/EC/111320191111664DTUBawanaECLetter.PDF): 28°45′9.47″N, 77°7′7.18″E, converted to `[77.11866111111111, 28.752630555555555]`. This is a site-boundary reference, **not** a gate, entrance, current campus geometry, official road name, flood observation, or assertion that a nearby way serves the university. `Unnamed road near Delhi Technological University campus boundary (published corner 2)` is only a contextual candidate label. The source document dates to 2019 and may no longer reflect site boundaries; do not treat it as live evidence.

Every future alias/landmark entry must record its name, source, HTTPS source URL, retrieval/review UTC times, confidence and (for landmarks) locality and source-backed WGS84 point; aliases also require an OSM way ID. Review the original source and reuse permission before adding an entry. The resolver fails closed if this file's geometry version no longer matches the road snapshot. On a deliberate road refresh, inspect each entry against the new OSM ways, remove or revise stale context, then update `geometryVersion` only after review and rerun matching, API and frontend tests. A changed document under an existing alert link needs explicit re-review, not a silent re-import. No automatic OSM, geocoder, feed or social retrieval is enabled; future integration needs source permission, rate limits, provenance, retention and a separate AWS persistence/deployment design.
