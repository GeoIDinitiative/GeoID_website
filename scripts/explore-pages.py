#!/usr/bin/env python3
"""Write the /explore/ pages: one landing page per GeoHUB tool, and the hub.

    python3 scripts/explore-pages.py            # write explore/**/index.html
    python3 scripts/explore-pages.py --check    # exit 1 if a page is stale

WHY. Nobody searches for "GeoID" yet, but people do search for "saturn 3d
viewer", "live earthquake map" or "free flight simulator browser". The tools
themselves are app frames, rightly `noindex` (scripts/noindex.py), and reached
by a query on the home page (`/?world=saturn`, `/?flight=earth`), which a
search engine treats as the home page -- so before these there was nothing
for such a search to find. Each feature now has a real page at a clean
address, with its own title, description, text, screenshot and structured
data, and a button into the tool. /earth_explorer/etna/ and /everest/ were
already built this way; this does it for the rest.

THE CONTENT IS DATA: explore/features.json. Edit it there and re-run; the
pages are output. Screenshots live in assets/explore/<slug>.jpg and share
cards in assets/social/explore-<slug>.jpg (scripts/explore-images.py makes the
cards from the screenshots). csp.py, breadcrumbs.py and social-cards.py read
the same file, so a new feature is one entry, then:

    python3 scripts/explore-pages.py && python3 scripts/csp.py \\
      && python3 scripts/breadcrumbs.py && python3 scripts/social-cards.py
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://geoidinitiative.com"
DATA = json.loads((ROOT / "explore" / "features.json").read_text(encoding="utf-8"))


def esc(s):
    # Double quotes only, as the site's other generators write attributes
    # (social-cards.py leaves an apostrophe as it is).
    return html.escape(str(s), quote=False).replace('"', "&quot;")


def plain(s):
    """Title text without its markup (the H1 carries a <span>)."""
    return re.sub(r"<[^>]+>", "", s)


def stamp():
    """The site's current cache-busting stamp, so the pages match the rest."""
    text = (ROOT / "data" / "index.html").read_text(encoding="utf-8")
    m = re.search(r"/styles/shared\.css\?v=([0-9]{8}-[0-9a-z]+)", text)
    return m.group(1) if m else "1"


V = stamp()

CSP = ("default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' https://static.cloudflareinsights.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; "
       "img-src 'self' data: blob: https:; media-src 'self' data: blob: https://data.geoidinitiative.com; "
       "connect-src 'self' https://data.geoidinitiative.com https://auth.geoidinitiative.com https://social.geoidinitiative.com "
       "https://formspree.io https://cloudflareinsights.com; frame-src 'self' https://docs.google.com; "
       "form-action 'self' https://formspree.io https://buy.stripe.com https://docs.google.com; upgrade-insecure-requests")

STYLE = """
    .x-hero { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(300px, 0.95fr); gap: 1.25rem; margin-bottom: 1.4rem; align-items: stretch; }
    .x-panel, .x-shot, .section-panel, .x-card { border: 1px solid var(--line); border-radius: 0.9rem; background: var(--panel); backdrop-filter: blur(18px); box-shadow: var(--shadow); }
    .x-panel { padding: clamp(1.4rem, 3vw, 2.3rem); background:
        radial-gradient(circle at 14% 18%, rgba(var(--accent-rgb), 0.12), transparent 18rem),
        linear-gradient(160deg, rgba(6, 13, 23, 0.96), rgba(8, 16, 28, 0.88)); }
    .x-panel h1 { margin: 0.35rem 0 0.8rem; font-family: "Public Sans", sans-serif; font-size: clamp(1.9rem, 4.6vw, 3.4rem); line-height: 1.0; text-transform: uppercase; }
    .x-panel h1 span { color: var(--accent); }
    .x-panel p { color: var(--muted); line-height: 1.72; max-width: 44rem; }
    .x-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1.15rem; }
    .x-launch { margin-top: 1.1rem; color: var(--muted); font-size: 0.92rem; }
    .x-launch a { display: inline-block; margin: 0.25rem 0.35rem 0 0; padding: 0.25rem 0.7rem; border: 1px solid var(--line); border-radius: 999px; color: inherit; text-decoration: none; }
    .x-launch a:hover { border-color: var(--accent); color: var(--text, #fff); }
    .x-shot { overflow: hidden; margin: 0; display: flex; flex-direction: column; }
    .x-shot img { display: block; width: 100%; height: 100%; min-height: 15rem; object-fit: cover; }
    .x-shot figcaption { padding: 0.6rem 0.9rem; color: var(--muted); font-size: 0.82rem; }
    .x-facts { display: flex; flex-wrap: wrap; gap: 1.6rem; margin: 0 0 1.25rem; }
    .x-fact strong { display: block; font-family: "Public Sans", sans-serif; font-size: clamp(1.5rem, 3vw, 2.2rem); color: var(--accent); }
    .x-fact span { color: var(--muted); font-size: 0.9rem; }
    .section-panel { padding: 1.35rem; margin-bottom: 1.25rem; }
    .section-panel p, .section-panel li { color: var(--muted); line-height: 1.7; }
    .x-grid { display: grid; gap: 1rem; margin-top: 1rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .x-grid.x-three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .x-card { padding: 1.05rem; background:
        radial-gradient(circle at top right, rgba(255,255,255,0.06), transparent 36%),
        linear-gradient(180deg, rgba(10, 18, 30, 0.9), rgba(6, 13, 22, 0.82)); }
    .x-card h3 { margin: 0.2rem 0 0.4rem; font-size: 1rem; }
    .x-card p { color: var(--muted); line-height: 1.6; font-size: 0.9rem; margin: 0; }
    a.x-card { color: inherit; text-decoration: none; display: block; }
    a.x-card:hover { border-color: var(--accent); }
    /* The hero and bands as about_geohub/index.html has them inline. */
    .hero-tile {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 1.35rem;
      box-shadow: var(--shadow);
      min-height: 32rem;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .hero-slides { position: absolute; inset: 0; }

    .hero-slide {
      position: absolute;
      inset: 0;
      background-size: cover;
      background-position: center;
      opacity: 0;
      transition: opacity 1.5s ease-in-out;
    }

    .hero-slide.active { opacity: 1; }

    .hero-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(160deg, rgba(3,8,16,0.72) 0%, rgba(3,8,16,0.52) 50%, rgba(3,8,16,0.38) 100%);
    }

    .hero-content {
      position: relative;
      z-index: 2;
      text-align: center;
      max-width: 58rem;
      padding: 7.5rem 2.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }

    .hero-logo-img {
      height: 140px;
      width: auto;
      object-fit: contain;
      filter: drop-shadow(0 2px 20px rgba(0,0,0,0.75));
      margin-bottom: 0.25rem;
    }

    .hero-subtitle {
      font-size: 0.68rem;
      color: rgba(154,184,189,0.70);
      letter-spacing: 0.22em;
      text-transform: uppercase;
      font-family: "Public Sans", sans-serif;
      font-weight: 600;
    }

    .hero-content h1 {
      font-family: "Source Sans 3", sans-serif;
      font-size: clamp(2.2rem, 5.5vw, 3.8rem);
      font-weight: 300;
      line-height: 1.1;
      color: var(--text);
      margin: 0;
      letter-spacing: 0.06em;
    }

    /* The descriptive half of the H1. It is inside the heading so the page's
       one <h1> says what GeoHUB IS rather than only what it is called, and it
       is drawn in the tagline's own type so the hero reads exactly as it did
       -- the mark, then a sentence under it. */
    .hero-content h1 .hero-mark { display: block; }
    .hero-content h1 .hero-sub {
      display: block;
      margin-top: 0.7rem;
      font-family: "Public Sans", sans-serif;
      font-size: clamp(1rem, 2vw, 1.2rem);
      font-weight: 400;
      line-height: 1.5;
      letter-spacing: normal;
      color: rgba(200,220,236,0.88);
      max-width: 44rem;
    }

    .hero-tagline {
      font-family: "Public Sans", sans-serif;
      font-size: clamp(1rem, 2vw, 1.2rem);
      color: rgba(200,220,236,0.88);
      max-width: 44rem;
      line-height: 1.5;
    }

    .hero-desc {
      font-size: 0.92rem;
      color: var(--muted);
      line-height: 1.72;
      max-width: 46rem;
    }

    .hero-actions {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      justify-content: center;
      margin-top: 0.4rem;
    }
    body.bands .fx { padding-top: clamp(5rem, 8vw, 7.5rem) !important; padding-bottom: clamp(5rem, 8vw, 7.5rem) !important; }
    body.bands .fx > .cx-bg.fx-wash {
      filter: blur(70px) saturate(1.35);
      transform: scale(1.25);
      opacity: 0.7;
    }
    body.bands .fx > .fx-shade {
      background:
        linear-gradient(180deg, rgba(8,0,20,0.80) 0%, rgba(8,0,20,0.58) 45%, rgba(8,0,20,0.82) 100%);
    }
    .fx-head .cx-kicker { margin-bottom: 1rem; }
    .fx-head .tile-title { margin: 0 0 1.1rem !important; font-size: clamp(2.2rem, 4vw, 3.4rem) !important; }
    .fx-head .tile-desc { margin: 0; max-width: none; font-size: 1.12rem !important; color: rgba(236, 232, 248, 0.84); }
    .fx-head .tile-desc a { color: var(--accent); }
    .fx > .x-grid { position: relative; z-index: 1; }
    .fx .x-card p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
    .x-card img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 0.55rem; margin-bottom: 0.7rem; }
    .x-faq details { border-top: 1px solid var(--line); padding: 0.75rem 0; }
    .x-faq summary { cursor: pointer; font-weight: 600; }
    .x-faq details p { margin: 0.5rem 0 0; }
    .x-sources { font-size: 0.85rem; }
    @media (max-width: 1080px) { .x-hero, .x-grid, .x-grid.x-three { grid-template-columns: 1fr; } }
    @media (min-width: 640px) and (max-width: 1080px) { .x-grid, .x-grid.x-three { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
"""

NAV = """  <nav class="site-nav" role="navigation" aria-label="Primary navigation">
    <a class="nav-wordmark" href="/" aria-label="GeoID Initiative Home">
      <img class="nav-brand-icon" src="/assets/GeoID_logo_icon.png" alt="">
    </a>

    <ul class="nav-links">
      <li><a href="/dashboard/">Dashboard</a></li>
      <li class="nav-dropdown">
        <a class="nav-dropdown-toggle" href="/about/">About</a>
        <div class="nav-dropdown-menu" aria-label="About pages">
          <a href="/about/">Overview</a>
          <a href="/about_geohub/">GeoHUB</a>
          <a href="/explore/">Explore all tools</a>
          <a href="/team/">Our Team</a>
          <a href="/get-involved/">Get Involved</a>
          <a href="/updates/">Journal</a>
        </div>
      </li>
      <li><a href="/"><span class="geohub-word"><span class="geohub-prefix">Geo</span>HUB</span></a></li>
      <li><a href="/social/">Network</a></li>
      <li><a href="/consultancy/">Consult</a></li>
      <li><a href="/contact/">Contact</a></li>
    </ul>
    <div class="nav-right-logo">
      <a class="nav-act nav-act-signin" id="nav-membership" href="/sign-in/">Sign in</a>
      <a class="nav-act nav-act-donate" href="https://buy.stripe.com/dRm3cv1Op4903zb858bV600" target="_blank" rel="noopener noreferrer">Donate</a>
    </div>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-label="Open navigation menu">☰</button>
  </nav>
"""


def breadcrumb_block(trail):
    """The same block scripts/breadcrumbs.py writes (it keeps it current)."""
    items = [{"@type": "ListItem", "position": i + 1, "name": name, "item": f"{SITE}{url}"}
             for i, (name, url) in enumerate([("Home", "/"), *trail])]
    body = json.dumps({"@context": "https://schema.org", "@type": "BreadcrumbList",
                       "itemListElement": items}, indent=2, ensure_ascii=False)
    body = "\n".join("  " + line for line in body.split("\n"))
    return f'  <script type="application/ld+json" data-breadcrumb>\n{body}\n  </script>\n'


def ld_block(obj):
    body = json.dumps(obj, indent=2, ensure_ascii=False)
    body = "\n".join("  " + line for line in body.split("\n"))
    return f'  <script type="application/ld+json">\n{body}\n  </script>\n'


def head(title, description, path, trail, card_slug, card_alt, extra_ld=""):
    url = f"{SITE}{path}"
    card = f"{SITE}/assets/social/{card_slug}.jpg"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="{CSP}">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="description" content="{esc(description)}">
  <title>{esc(title)}</title>
  <link rel="canonical" href="{url}">
{breadcrumb_block(trail)}{extra_ld}  <meta property="og:type" content="website">
  <meta property="og:site_name" content="GeoID Initiative">
  <meta property="og:url" content="{url}">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(description)}">
  <meta property="og:image" content="{card}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{esc(card_alt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(description)}">
  <meta name="twitter:image" content="{card}">
  <meta name="twitter:image:alt" content="{esc(card_alt)}">
  <link rel="icon" type="image/png" href="/assets/GeoID_mark.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="font" type="font/woff2" crossorigin href="https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLydOxI.woff2">
  <link rel="preload" as="font" type="font/woff2" crossorigin href="https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2">
  <link rel="stylesheet" href="/styles/shared.css?v={V}">
  <style>{STYLE}  </style>
  <link rel="stylesheet" href="/styles/v2-site.css?v={V}">
  <script src="/scripts/v2-site.js?v={V}" defer></script>
  <link rel="stylesheet" href="/styles/skins/synthwave.css">
  <link rel="stylesheet" href="/styles/site-nav.css?v={V}">
  <link rel="stylesheet" href="/styles/site-unify.css?v={V}">
  <link rel="stylesheet" href="/styles/bands.css?v={V}">
</head>
<body class="bands">
{NAV}"""


def foot(status_left, status_right):
    return f"""
  <div class="status-bar" role="status">
    <div class="status-item"><span class="status-dot"></span>{esc(status_left)}</div>
    <div class="status-spacer"></div>
    <div class="status-item">{esc(status_right)}</div>
  </div>

  <script type="module" src="/scripts/nav-membership.js?v={V}"></script>
  <script src="/scripts/site.js?v={V}"></script>
<script src="/styles/nav.js?v={V}" defer></script>
</body>
</html>
"""


BY_SLUG = {f["slug"]: f for f in DATA["features"]}
CATEGORY = {"flight": "GameApplication", "worlds": "EducationalApplication", "earth": "EducationalApplication"}


def card_html(f, with_image=True):
    img = (f'<img src="/assets/explore/{f["slug"]}.jpg" alt="{esc(f["image"]["alt"])}" loading="lazy" decoding="async" width="800" height="450">'
           if with_image else "")
    return (f'          <a class="x-card band-card" href="/explore/{f["slug"]}/">{img}'
            f'<h3>{esc(f["name"])}</h3><p>{esc(f["description"])}</p></a>\n')


def feature_page(f):
    path = f"/explore/{f['slug']}/"
    title_plain = plain(f["h1"])
    app = {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": f"{f['name']} — GeoID GeoHUB",
        "url": f"{SITE}{path}",
        "description": f["description"],
        "applicationCategory": CATEGORY.get(f["group"], "EducationalApplication"),
        "operatingSystem": "Any (runs in a web browser)",
        "browserRequirements": "Requires a modern browser with WebGL",
        "isAccessibleForFree": True,
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"},
        "image": f"{SITE}/assets/explore/{f['slug']}.jpg",
        "publisher": {"@type": "Organization", "name": "GeoID Initiative", "url": f"{SITE}/"},
    }
    out = [head(f["title"], f["description"], path,
                [("Explore", "/explore/"), (f["name"], path)],
                f"explore-{f['slug']}", f["image"]["alt"], ld_block(app))]
    out.append(f"""
  <div class="page-wrap">
    <div class="page-inner">
      <section class="page-utility" aria-label="Page links">
        <div class="page-crumb">
          <a href="/explore/">Explore</a>
          <span class="page-crumb-sep">/</span>
          <strong>{esc(f["name"])}</strong>
        </div>
        <div class="page-jump">
          <a href="#what">Features</a>
          <a href="#faq">FAQ</a>
          <a href="/explore/">All tools</a>
        </div>
      </section>

      <section class="x-hero">
        <article class="x-panel">
          <span class="section-label">{esc(f["kicker"])}</span>
          <h1>{f["h1"]}</h1>
          <p>{esc(f["lead"])}</p>
          <div class="x-actions">
            <a class="btn-primary" href="{esc(f["cta"]["href"])}">{esc(f["cta"]["label"])}</a>
""")
    if f.get("cta2"):
        out.append(f'            <a class="btn-ghost" href="{esc(f["cta2"]["href"])}">{esc(f["cta2"]["label"])}</a>\n')
    out.append('            <a class="btn-ghost" href="/explore/">More tools</a>\n          </div>\n')
    if f.get("launches"):
        links = "".join(f'<a href="{esc(l["href"])}">{esc(l["label"])}</a>' for l in f["launches"])
        out.append(f'          <p class="x-launch">Launch over: {links}</p>\n')
    out.append(f"""        </article>
        <figure class="x-shot">
          <img src="/assets/explore/{f["slug"]}.jpg" alt="{esc(f["image"]["alt"])}" width="800" height="450" fetchpriority="high" decoding="async">
          <figcaption>{esc(f["image"]["alt"])}.</figcaption>
        </figure>
      </section>
""")
    if f.get("facts"):
        facts = "".join(f'<div class="x-fact"><strong>{esc(n)}</strong><span>{esc(t)}</span></div>' for n, t in f["facts"])
        out.append(f'      <div class="x-facts">{facts}</div>\n')
    cards = "".join(f'          <article class="x-card band-card"><h3>{esc(h["title"])}</h3><p>{esc(h["text"])}</p></article>\n'
                    for h in f["highlights"])
    out.append(f"""
      <section class="section-panel" id="what">
        <span class="section-label">What you can do</span>
        <h2 class="section-title">{esc(title_plain)}</h2>
        <div class="x-grid band-grid">
{cards}        </div>
      </section>
""")
    for s in f.get("sections", []):
        paras = "".join(f"        <p>{esc(p)}</p>\n" for p in s["p"])
        out.append(f"""
      <section class="section-panel">
        <h2 class="section-title">{esc(s["h2"])}</h2>
{paras}      </section>
""")
    faq = "".join(f'        <details><summary>{esc(q["q"])}</summary><p>{esc(q["a"])}</p></details>\n' for q in f["faq"])
    out.append(f"""
      <section class="section-panel x-faq" id="faq">
        <span class="section-label">Questions</span>
        <h2 class="section-title">Good to Know</h2>
{faq}        <p class="x-sources"><strong>Data:</strong> {esc(f["sources"])} Every layer carries its source and licence in the GeoHUB legend; see <a href="/data/">Data Sources</a>.</p>
      </section>
""")
    related = "".join(card_html(BY_SLUG[r], with_image=False) for r in f.get("related", []) if r in BY_SLUG)
    out.append(f"""
      <section class="section-panel">
        <span class="section-label">Keep exploring</span>
        <h2 class="section-title">Related Tools</h2>
        <div class="x-grid x-three band-grid">
{related}        </div>
        <p><a class="btn-primary" href="{esc(f["cta"]["href"])}">{esc(f["cta"]["label"])}</a></p>
      </section>

    </div>
  </div>
""")
    out.append(foot("Free in your browser · no install · no account", f"GeoHUB · {f['name']}"))
    return "".join(out)


def hub_page():
    h = DATA["hub"]
    path = "/explore/"
    items = {"@context": "https://schema.org", "@type": "ItemList", "name": "GeoHUB tools",
             "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f"{SITE}/explore/{f['slug']}/", "name": f["name"]}
                                 for i, f in enumerate(DATA["features"])]}
    out = [head(h["title"], h["description"], path, [("Explore", path)], "explore", h["image"]["alt"], ld_block(items))]
    # The About pages' own components (hero-tile, page-utility, band-tile:
    # styles/bands.css), so the hub reads as one more page of the site.
    links = (("/about/", "Overview"), ("/about_geohub/", "GeoHUB"), (path, "Explore"),
             ("/team/", "Our Team"), ("/get-involved/", "Get Involved"), ("/updates/", "Journal"))
    here = ' class="active" aria-current="page"'
    jump = "".join(f'        <a href="{href}"{here if href == path else ""}>{label}</a>\n' for href, label in links)
    out.append(f"""
  <div class="page-wrap">
    <section class="page-utility" aria-label="About page links">
      <div class="page-jump">
{jump}      </div>
    </section>
    <div class="page-inner">

      <div class="hero-tile" id="hero">
        <div class="hero-slides" id="heroSlides">
          <div class="hero-slide active" style="background-image: url('/assets/photos/earth-limb.webp');"></div>
        </div>
        <div class="hero-overlay"></div>
        <div class="hero-content">
          <img class="hero-logo-img" src="/assets/GeoID_logo_icon.png" alt="" loading="lazy" decoding="async">
          <h1><span class="hero-mark">Explore GeoHUB</span>
            <span class="hero-sub">Every tool on one page. Free in your browser, nothing to install.</span></h1>
          <p class="hero-desc">{esc(h["lead"])}</p>
          <div class="hero-actions">
            <a class="btn-primary" href="/">Open GeoHUB</a>
            <a class="btn-ghost" href="/explore/earth-flight-simulator/">Fly the Earth</a>
          </div>
        </div>
      </div>
""")
    for n, g in enumerate(DATA["groups"], 1):
        cards = "".join(card_html(f) for f in DATA["features"] if f["group"] == g["id"])
        out.append(f"""
      <section class="band-tile fx{" fx-flip" if n % 2 == 0 else ""}" id="{g["id"]}">
        <img class="cx-bg fx-wash" src="/assets/explore/{g["wash"]}" alt="" loading="lazy" decoding="async">
        <div class="cx-shade fx-shade"></div>
        <header class="fx-head">
          <span class="cx-kicker">{n:02d} &middot; {esc(g["label"])}</span>
          <h2 class="tile-title">{esc(g["title"])}</h2>
          <p class="tile-desc">{esc(g["desc"])}</p>
        </header>
        <div class="x-grid x-three band-grid">
{cards}        </div>
      </section>
""")
    n = len(DATA["groups"]) + 1
    out.append(f"""
      <section class="band-tile fx" id="close-ups">
        <img class="cx-bg fx-wash" src="/assets/photos/etna-fountain.webp" alt="" loading="lazy" decoding="async">
        <div class="cx-shade fx-shade"></div>
        <header class="fx-head">
          <span class="cx-kicker">{n:02d} &middot; Close-ups</span>
          <h2 class="tile-title">Two Places in Depth</h2>
          <p class="tile-desc">Purpose-built explorers for two of the most studied mountains on Earth.</p>
        </header>
        <div class="x-grid x-three band-grid">
          <a class="x-card band-card" href="/earth_explorer/etna/"><h3>Mount Etna</h3><p>A 3D geological model of Europe's most active volcano: its structure, eruptive record and deformation, on real terrain.</p></a>
          <a class="x-card band-card" href="/everest/"><h3>Mount Everest — ASCENT</h3><p>Climb the real Mount Everest in 3D, on high-resolution imagery and elevation.</p></a>
        </div>
      </section>

    </div>
  </div>
""")
    out.append(foot("Free in your browser · no install · no account", "Explore GeoHUB"))
    return "".join(out)


def pages():
    yield ROOT / "explore" / "index.html", hub_page()
    for f in DATA["features"]:
        yield ROOT / "explore" / f["slug"] / "index.html", feature_page(f)


# The stamp, the policy, the breadcrumb and the share-card tags are kept by
# their own scripts once written; a page is stale only where its own content
# differs, so compare with those normalised.
NORMALISE = [
    (re.compile(r"\?v=[0-9]{8}-[0-9a-z]+"), "?v=X"),
    (re.compile(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">'), "<csp>"),
]


def norm(text):
    for rx, rep in NORMALISE:
        text = rx.sub(rep, text)
    return text


def main():
    check = "--check" in sys.argv
    stale, written = [], []
    for path, text in pages():
        old = path.read_text(encoding="utf-8") if path.exists() else None
        if old is not None and norm(old) == norm(text):
            continue
        if check:
            stale.append(path.relative_to(ROOT))
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        written.append(path.relative_to(ROOT))
    if check:
        for p in stale:
            print(f"STALE  {p}")
        print(f"{len(stale)} stale explore page(s)" if stale else f"all {len(DATA['features']) + 1} explore pages current")
        return 1 if stale else 0
    print(f"wrote {len(written)} explore page(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
