# Chicago Neighborhoods — learn the map

A mobile-first, tap-the-map quiz for Chicago's **77 official community areas**.
A neighborhood name appears at the top; you tap the matching shape on the map.
Built for Ryan's eventual move back to Chicago — a small learning game we'll keep
expanding.

## Play it

It's a plain static page — no build step, no backend, works offline.

- **Locally:** just open `index.html` in a browser, _or_ serve the folder:
  ```sh
  cd games/chicago-neighborhoods
  python3 -m http.server 8799   # then visit http://localhost:8799
  ```
- **Hosting:** drop the whole folder on any static host (GitHub Pages, Netlify, an
  S3 bucket, the Dreamhost box, …). Nothing server-side required.

## How it works

- **Map:** [Leaflet](https://leafletjs.com) (v1.9.4, vendored in `vendor/` so there's
  no CDN dependency and it runs offline). **No base map tiles** are used on purpose —
  street labels would give the answers away — so only the neighborhood polygons are
  drawn on a dark canvas.
- **Data:** `data/community-areas.js` — Chicago's 77 community-area boundaries as
  GeoJSON, assigned to `window.CHICAGO_COMMUNITY_AREAS`. Loaded via a `<script>` tag
  (not `fetch`) so it works from `file://` with no CORS headaches. Each feature carries
  `{ num, name, side }`.
- **Game:** `game.js` — a small state machine (start → rounds → summary). Tracks score,
  current streak, best streak (saved to `localStorage`), and the neighborhoods you
  missed. Pick a region (whole city or one side) and a length (Quick 10 / Full 77).
- **Look:** `style.css` — orange-on-warm-dark, echoing the VendorFlow design DNA.

## Data provenance / regenerating

Source: **City of Chicago open data — Boundaries · Community Areas** (the canonical 77,
each with an official `area_numbe`). The ALL-CAPS source names are mapped to clean
proper-case names by area number (so `OHARE` → `O'Hare`, `MCKINLEY PARK` → `McKinley
Park`). Coordinates are trimmed to 5 decimal places (~1 m) to keep the file small.

To regenerate `data/community-areas.js`, run `data/process.js` against the raw
community-areas GeoJSON:

```sh
node data/process.js raw-community-areas.geojson data/community-areas.js
```

## Ideas to expand (later)

- **Multiple-choice mode** (the original idea): show 4 name buttons instead of tapping
  the map — easy toggle, the data already supports it.
- **Reverse mode:** highlight a shape, name it.
- **Side-by-side learn mode:** label every area, just explore.
- **Other cities / other things to learn** — the engine is generic over a GeoJSON of
  named regions.
- Timed mode, daily challenge, share-your-score.
