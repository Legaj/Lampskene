# Detailed building sources

Checked 26 October 2026. The published app retains its keyless OpenFreeMap buildings and original low-poly landmarks; no Firebase settings or paid services were added.

## Downloadable individual models

[Sketchfab](https://sketchfab.com/developers/download-api/guidelines) supports downloadable models under Creative Commons licences. Each model's author, source and licence must remain credited. Download API access requires a Sketchfab login; an approved, downloaded asset can instead be packaged with the app.

One available example is [Stockholm by e-sfera](https://sketchfab.com/3d-models/stockholm-89ee59de5e7e4d5590682ff73a8064ea), listed as downloadable under CC Attribution. Its geographic extent, textures, scale and alignment need inspection before importing; the listing alone does not establish that it contains our particular landmarks.

For future imports, prefer a small, optimised glTF/GLB model of a specific landmark, with a clear licence. MapLibre needs a custom model renderer for such meshes; the current landmarks use lightweight native extrusion geometry.

## A whole city

[Cesium OSM Buildings](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/) offers global buildings, per-building metadata and colour information. A [Cesium ion account and application access token](https://cesium.com/learn/ion/cesium-ion-access-tokens/) are required. These are OSM-derived buildings, rather than a guaranteed phototextured reconstruction of every facade. Integration would require a renderer supporting 3D Tiles.

[Stockholms stad's geodata](https://kartor.stockholm/kartor-geodata/) includes open LOD1 building blocks. Its more detailed LOD2 buildings cover the inner city and selected outer areas, and are ordered at the city's published tariff. LOD2 does not itself promise coloured facade textures.

[Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/overview) is a textured city-mesh option in supported projects. However, Google's [EEA service adjustments](https://developers.google.com/maps/comms/eea/map-tiles) say these tiles are unavailable to new or materially modified projects linked to an EEA billing account. This makes a new Swedish-billed integration unsuitable for this release. A separate Google 3D Maps integration has different requirements and would be a larger renderer change.

## Current accuracy limits

The Norra Real and Vanadis corner models are artistic interpretations over attributed OSM footprints. Elevation contours use a finer ground-elevation model at 5 m intervals, with bolder lines every 25 m. They are estimates, not surveyed height measurements. Native building coverage and heights depend on the upstream map data.


## Landmark collection in this release

There are 26 custom building footprints: the original Norra Real buildings and Vanadis corner, plus 23 additions. The additions are City Hall (including the Three Crowns tower), the Royal Palace, Parliament House, the Royal Opera, Riddarhuset, Nordiska museet, Vasamuseet, Stockholm Public Library, Konserthuset, Avicii Arena, Kulturhuset, Norra Latin, both Kungstornen, Storkyrkan, Tyska kyrkan, Riddarholmskyrkan, Jakobs kyrka, Klara kyrka, Sankt Johannes kyrka, Adolf Fredriks kyrka, Katarina kyrka and Sofia kyrka.

Footprints and tower positions come from OpenStreetMap; colours, facade details and roof forms are original low-poly interpretations. Palace and City Hall courtyards remain open. The exact footprint cut-out preserves other buildings even when the tile provider groups an entire block into one feature. Cutting runs in a worker.

City Hall's 106 m tower and Three Crowns are described by [the City of Stockholm](https://stadshuset.stockholm/en/visit-stockholm-city-hall/city-hall-tower/) and [Visit Stockholm](https://www.visitstockholm.com/o/the-city-hall/). The [Royal Court](https://www.kungahuset.se/english/royal-palaces-and-residences) and [Riksdag](https://www.riksdagen.se/en/contact-and-visit/the-art-and-buildings-of-the-riksdag/the-riksdag-buildings/) provide architectural background for the palace and Parliament House.
