# GeoID Mars-Only Website Build

This directory is a clean static-site bundle for GitHub Pages or another static host.

## Structure

```text
.
├── index.html
├── explorer.html
├── transit.html
├── styles/
├── scripts/
├── assets/
├── GeoID_GUI/
├── GeoID_initiative/
└── planet_explorer/
    └── mars/
        └── viewer/
            ├── index.html
            ├── styles.css
            ├── mars-manifest.js
            ├── mars-viewer.js
            ├── ui-controls.js
            ├── music.js
            ├── vendor/
            └── assets/
```

## Current Scope

Only the Mars viewer is bundled. The site routes `transit.html?destination=mars` to:

```text
planet_explorer/mars/viewer/index.html
```

Other planet folders were intentionally left out to keep this upload focused and smaller.

## Local Test

Run from this directory:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

## Adding More Planets Later

Add each viewer under the same pattern:

```text
planet_explorer/<planet>/viewer/index.html
```

Then add the destination back into `transit.html` and expose the link in `explorer.html`.
