// Downloads a global snapshot of every catalogue dataset through the deployed
// service, into the viewer's assets, with a manifest carrying bounds and
// symbology. Run when a fresh set is wanted; nothing runs it automatically.
//   node snapshot.mjs [serviceUrl] [outDir]
import { mkdir, writeFile } from "node:fs/promises";
const service = process.argv[2] || "https://europe-west2-geoid-504623.cloudfunctions.net/geeImage";
const out = process.argv[3] || "../../viewer/assets/gee-cache";
await mkdir(out, { recursive: true });
const { datasets: all } = await (await fetch(`${service}?list`)).json();
// Scene-level collections are left out: a global sixty-day median of Sentinel-2
// at ten metres is an enormous computation for a picture this small, and one of
// them alone outran the run. The climate products are coarse and cheap, and
// they are what the snapshots are for.
const SKIP = new Set(["COPERNICUS/S2_SR_HARMONIZED", "LANDSAT/LC09/C02/T1_L2", "COPERNICUS/S1_GRD"]);
const datasets = all.filter((d) => !SKIP.has(d.id));
const manifest = [];
for (const d of datasets) {
  // Each dataset stands alone: a global composite that outruns the service's
  // timeout answers in plain text, and one heavy collection must not sink the
  // rest of the set.
  try {
    // Each dataset's own last publication, not today: SMAP and burned area run
    // months behind, and a window ending today missed them entirely.
    const dj = await (await fetch(`${service}?dates&dataset=${encodeURIComponent(d.id)}`)).json();
    let range = "";
    if (!dj.static && dj.last) {
      const to = dj.last;
      const from = new Date(Math.max(Date.parse(dj.first), Date.parse(to) - 60 * 86400000))
        .toISOString().slice(0, 10);
      range = `&from=${from}&to=${to}`;
    }
    const url = `${service}?dataset=${encodeURIComponent(d.id)}&bbox=-180,-85,180,85${range}`;
    const resp = await fetch(url);
    const text = await resp.text();
    let meta;
    try { meta = JSON.parse(text); } catch { throw new Error(text.slice(0, 80)); }
    if (!meta.imageUrl) throw new Error(meta.error || "no imageUrl");
    const png = Buffer.from(await (await fetch(meta.imageUrl)).arrayBuffer());
    const file = d.id.replace(/[^\w.-]+/g, "_") + ".png";
    await writeFile(`${out}/${file}`, png);
    manifest.push({ ...meta, imageUrl: undefined, file, savedAt: new Date().toISOString() });
    // Written as it grows, so a killed run still leaves a usable manifest.
    await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
    console.log(`${d.id} -> ${file} (${(png.length / 1024).toFixed(0)} kB)`);
  } catch (error) {
    console.error(`${d.id}: SKIPPED (${error.message})`);
  }
}
console.log(`manifest.json with ${manifest.length} entries`);
