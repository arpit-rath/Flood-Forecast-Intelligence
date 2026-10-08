# Synthetic fixture

`scenario.json` generates a connected 5 × 5 grid with 40 road segments near DTU coordinates. The geometry, terrain susceptibility, drainage values, drains, rain, and reports are illustrative. They are not observed conditions or a street-level flood forecast.

The timestamp is fixed so repeated runs yield identical outputs. The fixture keeps `Scenario`, `Pending Review`, `High`, `Unknown`, `Closed`, and `Simulated` distinct in the domain model. It must be visibly labelled when shown in a product demo.
