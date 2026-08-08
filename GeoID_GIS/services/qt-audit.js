/**
 * Audit the web Research Hub against the Qt app, in the browser.
 *
 * Paste into the console on a page with the hub loaded, or run it through the
 * browser tool. Walks every page, records what it renders, and diffs that
 * against `qt-spec.json` (written by qt-extract.py from app_qt.py itself).
 *
 * The point is that "the hub is not identical to the Qt app" becomes a number
 * and a list instead of an impression. Rebuilding pages from memory was leaving
 * differences nobody could enumerate; this enumerates them.
 *
 * Reports **structural** fidelity only — titles, tabs, sections, buttons,
 * field placeholders, dropdown options, table headers. A page can score 100%
 * and still do nothing; behaviour is not extractable and has to be written.
 *
 *   await geoidQtAudit()                 // summary
 *   await geoidQtAudit({ page: "Setup" })  // one page, with its gaps
 *   await geoidQtAudit({ full: true })     // every page, with gaps
 */
async function geoidQtAudit({ page = null, full = false } = {}) {
  const frame = document.querySelector("iframe");
  const w = frame ? frame.contentWindow : window;
  const d = frame ? frame.contentDocument : document;

  // Read the live cache stamp rather than guessing it: a wrong guess imports a
  // second copy of every module, and the audit then measures the wrong hub.
  const stampLink = d.querySelector("link[data-atlas-css]");
  if (!stampLink) throw new Error("Research Hub stylesheet not found — open the hub first.");
  const v = new URL(stampLink.href).searchParams.get("v");
  const imp = (p) => w.eval(`import("/GeoID_GIS/viewer/gis/research/${p}?v=${v}")`);

  const [store, hub, stagesMod] = await Promise.all([
    imp("project-store.js"), imp("hub.js"), imp("stages.js"),
  ]);
  const spec = await w.fetch(`/GeoID_GIS/viewer/gis/research/qt-spec.json?v=${v}`)
    .then((r) => r.json());

  // A project has to be open or two-thirds of the pages render their refusal
  // panel and the audit measures that instead.
  if (!store.getActive()) {
    store.useMemoryAdapter();
    await store.createProject("qt-audit");
    await store.writeProjectFile("data/raw/sample.csv", "time,value\n0,1\n1,2\n");
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (n) => (n.textContent || "").trim();
  const rendered = {};
  for (const [, , pages] of stagesMod.STAGES) {
    for (const [id] of pages) {
      hub.setPage(id);
      await wait(110);
      const host = d.getElementById("research-page");

      // A tabbed panel renders only its active tab, so scraping once counts
      // every control on the other tabs as missing. Visit them all and union
      // the results -- otherwise the audit measures the tab widget, not the
      // page.
      const scrape = () => ({
        tabs: Array.from(host.querySelectorAll(".qt-tab, .shell-tab, .dash-tabs > *")).map(txt),
        sections: Array.from(host.querySelectorAll(".qt-section-head")).map(txt),
        cardTitles: Array.from(host.querySelectorAll(
          ".research-card-title, .editor-card-title, .qt-card-heading")).map(txt),
        buttons: Array.from(host.querySelectorAll(".button, button")).map(txt),
        labels: Array.from(host.querySelectorAll(
          ".research-field-label, .toolbar-label")).map(txt),
        placeholders: Array.from(host.querySelectorAll("input, textarea"))
          .map((n) => n.placeholder || ""),
        options: Array.from(host.querySelectorAll("option")).map(txt),
        headers: Array.from(host.querySelectorAll(".qt-table-head")).map(txt),
      });
      const merged = scrape();
      const seenTabs = new Set();
      for (let pass = 0; pass < 3; pass += 1) {
        const strips = Array.from(host.querySelectorAll(".qt-tabs, .dash-tabs"));
        let clicked = false;
        for (const strip of strips) {
          for (const tab of Array.from(strip.children)) {
            const key = `${strips.indexOf(strip)}:${txt(tab)}`;
            if (seenTabs.has(key)) continue;
            seenTabs.add(key);
            tab.click();
            clicked = true;
            await wait(70);
            const next = scrape();
            for (const field of Object.keys(merged)) {
              merged[field] = [...merged[field], ...next[field]];
            }
          }
        }
        if (!clicked) break;
      }
      rendered[id] = merged;
    }
  }

  // Loose match: casing and punctuation differ harmlessly, and "Run PCA"
  // against a button reading "Run PCA on selection" is not a gap.
  const norm = (s) => String(s || "").toLowerCase()
    .replace(/[…]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const missing = (want, have) => {
    const pool = have.map(norm).filter(Boolean);
    return want.filter((x) => {
      const n = norm(x);
      return n && !pool.some((h) => h === n || h.includes(n) || n.includes(h));
    });
  };

  const rows = [];
  let totalWanted = 0;
  let totalMissing = 0;
  for (const [id, want] of Object.entries(spec)) {
    if (page && id !== page) continue;
    const got = rendered[id];
    if (!got) {
      rows.push({ id, pct: 0, missed: 1, wanted: 1, gaps: { page: ["not in the hub"] } });
      totalWanted += 1; totalMissing += 1;
      continue;
    }
    const shells = [...got.sections, ...got.cardTitles];
    const gaps = {
      tabs: missing(want.tabs, got.tabs),
      sections: missing(want.sections.map((s) => s.title), shells),
      groups: missing(want.groups, shells),
      buttons: missing(want.buttons, got.buttons),
      fields: missing(Object.values(want.placeholders), [...got.placeholders, ...got.labels]),
      options: missing(Object.values(want.options).flat(), got.options),
      tables: missing(want.tables.flat(), got.headers),
    };
    const wanted = want.tabs.length + want.sections.length + want.groups.length
      + want.buttons.length + Object.keys(want.placeholders).length
      + Object.values(want.options).flat().length + want.tables.flat().length;
    const missed = Object.values(gaps).reduce((n, l) => n + l.length, 0);
    totalWanted += wanted || 1;
    totalMissing += missed;
    rows.push({ id, pct: wanted ? Math.round((1 - missed / wanted) * 100) : 100,
      missed, wanted, gaps });
  }
  rows.sort((a, b) => a.pct - b.pct);

  const report = rows.map((r) => {
    const head = `${r.id.padEnd(26)} ${String(r.pct).padStart(3)}%  ${r.missed}/${r.wanted}`;
    if (!full && !page && r.missed === 0) return head;
    const detail = Object.entries(r.gaps)
      .filter(([, l]) => l.length)
      .map(([k, l]) => `      ${k}: ${l.slice(0, 10).join(" · ")}`
        + (l.length > 10 ? ` … +${l.length - 10}` : ""));
    return [head, ...detail].join("\n");
  });

  return {
    stamp: v,
    fidelity: `${Math.round((1 - totalMissing / totalWanted) * 100)}%`,
    missing: totalMissing,
    of: totalWanted,
    pages: rows.length,
    report,
  };
}

if (typeof window !== "undefined") window.geoidQtAudit = geoidQtAudit;
