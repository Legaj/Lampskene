/*
  SL (Storstockholms Lokaltrafik) — all public transport lines
  Fetches: route_master relations + all child route relations
           + their member ways (geometry) + stop nodes
  Output: JSON with full geometry (out geom)
  
  Run at: https://overpass-turbo.eu/
  Or POST to: https://overpass-api.de/api/interpreter
*/

[out:json][timeout:180];

// Step 1: Get all SL route_master relations (the "lines")
(
  relation["type"="route_master"]["network"="SL"];
  relation["type"="route_master"]["operator"="SL"];
  relation["type"="route_master"]["network"="Storstockholms Lokaltrafik"];
  relation["type"="route_master"]["operator"="Storstockholms Lokaltrafik"];
);

// Store the route_masters
out tags;

// Step 2: Get all child route relations (directions/variants)
// and their full geometry + stops
(
  relation["type"="route_master"]["network"="SL"];
  relation["type"="route_master"]["operator"="SL"];
  relation["type"="route_master"]["network"="Storstockholms Lokaltrafik"];
  relation["type"="route_master"]["operator"="Storstockholms Lokaltrafik"];
) -> .masters;

rel(r.masters)["type"="route"];

// Recurse into ways + nodes for geometry
>;

out geom;