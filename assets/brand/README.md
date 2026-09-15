# The GeoID brand kit

Everything here is rendered from `logo.py` by `build.py`. There is one artwork;
these are its renderings, so the favicon and the 4K lockup cannot drift apart.

    python3 build.py .

## The files

| file | use |
| --- | --- |
| `geoid-logo.png` | the lockup, transparent, 4096 px wide |
| `geoid-logo-dark.png` | the lockup on the brand navy, 4096 px |
| `geoid-logo-light.png` | for white and light grounds — `Geo` in ink, transparent |
| `geoid-logo-web.png` | the same lockup at 1600 px, for a page header |
| `geoid-logo-stacked.png` | mark over wordmark, for a square slot |
| `geoid-mark.png` | the globe alone, transparent, 2048 px |
| `geoid-icon-<n>.png` | 16 – 1024 px, on navy; `-clear` variants are transparent |
| `geoid-favicon.ico` | 16/32/48/64/128/256 in one file |
| `*.svg` | the masters — vector, and the type already outlined |

**Reach for the SVG wherever a vector will be taken.** It carries no font
dependency and no resolution, which is the real answer to a logo that has gone
soft. The PNGs are for the places that will only take a raster.

## How the mark is built

The circle is a real sphere. Each band is the front half of a LATITUDE ZONE on
a globe whose pole leans 23.44° toward the eye — Earth's own obliquity — so the
curve of each band, its length, and the angle its ends are cut at are all
consequences of one construction rather than decisions taken arc by arc.

Two numbers are solved rather than chosen:

- **The latitudes.** A band's arc bottoms out at `sin(psi - tilt)`, so asking
  for a small dark cap at each pole fixes the outermost edges and the rest
  divide that span evenly. Spacing the bands evenly in latitude instead would
  crowd them at the poles; spacing them evenly down the screen would flatten
  the sphere back into a stack of lines.
- **The crop.** Band ends sit on an ellipse `1/cos(tilt)` wider than tall, which
  reads as an egg. Drawing the sphere larger than the mark and cutting it with
  a circle at 0.90 of its radius puts every end outside that circle, so each is
  cut by the limb rather than stopping short of it.

## The colour is two things, not one ramp

A cool gradient runs down the sphere between the viewer skin's own two colours,
`#ff2bd6` and `#00e5ff`. The warmth is a separate light laid over it near the
equator. Putting the amber into the ramp itself is what muddies a mark like
this: a gradient cannot travel magenta – violet – blue and also pass through
orange without going through grey somewhere.

## Small sizes are a different drawing

Below about 48 px the mark switches to five bands instead of seven. Seven bands
in sixteen pixels is a smudge; an icon that has to be recognised at that size
earns its own drawing of the same idea rather than a shrunk one.

## The type

Montserrat Bold, converted to outlines. Montserrat is under the SIL Open Font
License 1.1, which permits this use, and outlining means nothing here depends
on the font being installed.
