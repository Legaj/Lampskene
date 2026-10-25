# Lampskene

A map-first hide-and-seek game for Stockholm, with seeker and hider roles, shared rounds, question codes, curses, and phone GPS trackers.

Open [the game](https://legaj.github.io/Lampskene/), sign in with Google, and start or resume a round. Account, round history, and permitted phone trackers are available in **Menu**. The phone dock provides Map, Questions, SL, Curses, and Settings.

## Map and seeker tools

- Nineteen map backgrounds, including transit, terrain, outdoor, minimal, and aerial styles. Clear streets, Minimal and Night streets use keyless Esri tiles. Stockholm aerial HD uses the city's 2022 orthophoto service; its source survey has 8 cm resolution. Background changes preserve question layers and independent overlay choices.
- Compact question cards keep answers, Copy, and Map within reach. Tap a card heading to edit its geometry. Matching and measuring questions include searchable places.
- Locked pins hide immediately, including preview copies and their 3D markers. Coordinates are off by default; enable them in Settings → Game & questions. Delete asks for confirmation. Radar pins use explicit Lock/Unlock without a 60-second button.
- The 3D explorer shares map backgrounds, the coloured SL rail network, local-detail results, and real elevation contours with 2D. Answer areas become blue solids and question boundaries become translucent walls. Pins remain editable in 2D. Use the angle slider up to 85° for a lower view.
- On desktop, choose Pedestrian, Car or Boat in 3D. W/S or arrow keys move, A/D turn, Q/E move sideways, Shift increases speed, and Escape returns to orbit. These are free camera modes without road or building collision simulation. Live buses, trains and boats use simplified multipart models at close zoom.
- Tools → Local details lets you choose a 200–1200 m circle in 2D and search selected OSM categories. Results are shared with 3D and can be cleared. Requests use bounded queries, caching, timeouts and backup Overpass servers. Height contours use a terrain model with 5 m spacing and bold lines every 25 m; spacing does not imply survey accuracy.
- SL has stable Routes, Live, and Departures tabs. Route overlays and live marker sizes live here; Settings contains map, game, appearance, GPS, and planning controls.
- Eight interface themes: Bamboo, Kelp, Dark, Light, Sepia, Ocean, Dusk, and Graphite. Choose one directly in Settings → Appearance. Question shading and game-area shading have separate controls.
- Bundled place overlays, answer filtering, a saved-place shortlist, and anchored walking rings. Rings use straight-line distance at 80 m/min; actual paths and journey times vary.
- Live vehicle filters, freshness, pause, explicit follow, and bounded motion estimates. Selecting a vehicle does not move the map until you choose Center or Follow.
- SL's public departure board includes expected and scheduled departures, delay information, platforms, cancellations, and service notices. These are SL feed predictions; the app does not provide road-traffic forecasts. Boards refresh no more than once a minute while visible and remove stale data.

Question codes contain the public question geometry. Hider answer codes add an explicit answer and never contain the private hiding pin. Round saves are scoped to the selected round; switching rounds reuses the map and clears the previous local question layers.

## Phone GPS tracker

Open [tracker-phone.html](https://legaj.github.io/Lampskene/tracker-phone.html), sign in, enter the tracker ID supplied by the host, and choose **Start sharing GPS**. Keep the page open. The page shows accuracy, last update, and sharing state. **Stop** ends new updates; the game expires the last position. Changing accounts and leaving the page also stop the GPS watch.

Firebase authentication and tracker permissions use the existing configuration; see [FIREBASE_SETUP.md](FIREBASE_SETUP.md). The interface keeps account and round controls available from the in-game Menu.

## Local preview and checks

Serve the repository over HTTP, for example:

```sh
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`. Sign-in requires an authorized Firebase domain; real phone GPS use requires a secure context.

Run the dependency-free regression suite with a recent Node.js:

```sh
node --test tests/*.test.cjs
```

In a sandbox that blocks child processes, use `node --test --test-isolation=none tests/*.test.cjs`. Coverage includes code validation and answer round trips, pin locks and undo, round isolation and asynchronous restoration, tracker polling and stale data, motion estimates, and departure-board refresh and timezone handling.

With Playwright available on `NODE_PATH`, run `node tests/ui-workspace.cjs` for browser checks at 320px, 390px, phone landscape, and desktop sizes. It uses an isolated local preview response, checks navigation and themes, and saves screenshots in `.work/ui-review/`. Set `BROWSER_CHANNEL` to use another installed Chromium channel; the default is `msedge`.

Map styles follow [Thunderforest's tile API](https://www.thunderforest.com/docs/map-tiles-api/). Live departures use [SL Transport and SL Deviations](https://www.trafiklab.se/api/our-apis/sl/transport/). All map attributions remain visible.
