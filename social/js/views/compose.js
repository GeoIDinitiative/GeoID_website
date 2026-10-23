/**
 * #/compose — write a post of any kind (or edit one: #/compose?edit=<id>).
 *
 * Scene handoff: GeoHUB puts {world, camera, layers, annotations} in
 * sessionStorage['geoid:social-share'] and opens this page; the form starts as
 * a scene post with that view. The key is removed once the post is published
 * or the reader discards it.
 */
import * as api from "../api.js";
import { store } from "../store.js";
import {
  h, clear, field, input, select, textarea, checkbox, toast, busy, splitList,
  dateToEpoch, epochToDate, errorBox, loading, put,
} from "../dom.js";
import {
  KINDS, PROVENANCE, LICENCES, VISIBILITY, OPP_TYPES, EVENT_FORMATS, WORLDS, requireSignIn, kindLabel,
  hasProvenance,
} from "../components.js";
import { createMap } from "../mapcore.js";

const SHARE_KEY = "geoid:social-share";

function readShare() {
  try {
    const raw = sessionStorage.getItem(SHARE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch (error) { return null; }
}
function dropShare() { try { sessionStorage.removeItem(SHARE_KEY); } catch (error) { /* fine */ } }

export async function render(root, { query }) {
  if (!store.me) {
    put(clear(root), h("h1", { class: "s-h1", text: "New post" }),
      h("div", { class: "s-empty" }, h("p", { class: "s-empty-title", text: "Sign in to post." }),
        h("p", { class: "s-muted", text: "Reading is open to everyone; posting needs a GeoID account." }),
        h("button", { type: "button", class: "btn-primary", onClick: () => requireSignIn("post") }, "Sign in")));
    return;
  }
  let existing = null;
  if (query.edit) {
    put(clear(root), loading());
    try { existing = await api.get(`/v1/posts/${encodeURIComponent(query.edit)}`); } catch (error) {
      put(clear(root), errorBox(error)); return;
    }
  }
  const handed = existing ? null : readShare();
  // A GeoHUB handoff names its kind (scene, model or repo -- CONTRACT v1.1);
  // an older one without a kind is a globe view.
  const handedKind = handed && KINDS[handed.kind] ? handed.kind : "scene";
  const initialKind = existing?.kind || (handed ? handedKind : (KINDS[query.kind] ? query.kind : "text"));
  return buildForm(root, { existing, handed, initialKind, query });
}

function buildForm(root, { existing, handed, initialKind, query }) {
  const p = existing || {};
  const m = p.meta || (handed && handed.meta && typeof handed.meta === "object" ? handed.meta : {});
  let kind = initialKind;
  const hs = handed ? (handed.scene && typeof handed.scene === "object" ? handed.scene : handed) : null;
  let scene = p.scene || (hs && (hs.camera || hs.layers) ? {
    world: String(hs.world || "earth"),
    camera: hs.camera || {},
    layers: Array.isArray(hs.layers) ? hs.layers : [],
    annotations: Array.isArray(hs.annotations) ? hs.annotations : [],
    time: hs.time || null,
  } : null);
  // Where GeoHUB said to share it: public, a team, a community or a project.
  const target = handed && handed.target && typeof handed.target === "object" ? handed.target : null;
  if (target?.type === "team") query = { ...query, team: String(target.id || "") };
  if (target?.type === "community") query = { ...query, community: String(target.id || "") };
  if (target?.type === "project") query = { ...query, project: String(target.id || "") };
  const media = Array.isArray(p.media) ? p.media.map((x) => ({ key: x.key, alt: x.alt || "", url: x.url, type: x.type })) : [];

  // ── Kind picker ──
  const kindGroup = h("fieldset", { class: "s-kinds" }, h("legend", {}, "What are you sharing?"),
    Object.entries(KINDS).map(([k, info]) => h("label", { class: "s-kind-opt" },
      h("input", { type: "radio", name: "kind", value: k, checked: k === kind, disabled: !!existing && k !== kind }),
      h("span", {}, h("strong", {}, info.label), h("small", {}, info.help)))));

  const title = input("title", { value: p.title || (handed && handed.title ? String(handed.title) : ""), maxlength: 200 });
  const body = textarea("body", { rows: 8, maxlength: 20000, value: p.body || "" });
  const counter = h("span", { class: "s-hint", "aria-live": "polite" });
  const count = () => { counter.textContent = `${body.value.length} / 20000`; };
  body.addEventListener("input", count); count();
  const tags = input("tags", { value: (p.tags || []).join(", "), placeholder: "volcanology, insar, etna" });

  // ── Kind-specific fields ──
  const kf = {};
  const kindBox = h("div", { class: "s-kind-fields" });
  const drawKindFields = () => {
    clear(kindBox);
    const add = (...nodes) => put(kindBox, ...nodes);
    if (kind === "scene") {
      if (!scene) {
        add(h("p", { class: "s-hint", text: "Scenes are made in GeoHUB: open a world, set up the view, and use Share → GeoHUB Social. You can also give the world here and add the view later." }));
        kf.world = select("world", WORLDS.map((w) => [w, w[0].toUpperCase() + w.slice(1)]), p.world || "earth");
        add(field("World", kf.world));
      } else {
        const cam = scene.camera || {};
        add(h("div", { class: "s-handoff" },
          h("p", {}, h("strong", {}, "View from GeoHUB: "), `${scene.world || "earth"}`,
            Number.isFinite(cam.lat) ? ` · camera ${Number(cam.lat).toFixed(2)}, ${Number(cam.lon).toFixed(2)}` : "",
            ` · ${(scene.layers || []).length} layers · ${(scene.annotations || []).length} annotations`),
          h("ul", { class: "s-plain" }, (scene.layers || []).slice(0, 12).map((l) => h("li", {}, `${l.name || l.id}${l.visible === false ? " (hidden)" : ""}`))),
          handed ? h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => { dropShare(); scene = null; drawKindFields(); } }, "Discard this view") : null));
      }
    } else if (kind === "model") {
      // The setup comes from the GeoHUB model page; what is editable here is
      // what a reader needs to know, not the config itself.
      kf.mesher = select("mesher", [["gmsh", "gmsh"], ["blender", "Blender"]], m.mesher || "gmsh");
      kf.solver = input("solver", { value: m.solver || "", placeholder: "e.g. linear elastic, Mohr–Coulomb, FEniCS" });
      kf.params = textarea("params", { rows: 4, value: m.params ? JSON.stringify(m.params, null, 1) : "" });
      const page = m.page || "";
      add(m.config || m.domain ? h("div", { class: "s-handoff" }, h("p", {}, h("strong", {}, "Model setup from GeoHUB"),
          page ? ` · opens in ${page}` : "", m.domain?.world ? ` · ${m.domain.world}` : "",
          Array.isArray(m.domain?.bbox) ? ` · area ${m.domain.bbox.map((v) => Number(v).toFixed(2)).join(", ")}` : "")) :
          h("p", { class: "s-hint", text: "Models are shared from a GeoHUB model page (Share model to Social), which attaches the setup. You can still describe one here." }),
        field("Mesher", kf.mesher), field("Solver", kf.solver),
        field("Parameters (JSON)", kf.params, "Name, value and unit for each — readers see these before opening the model."));
    } else if (kind === "repo") {
      kf.rurl = input("repo-url", { type: "url", required: true, value: m.url || "", placeholder: "https://github.com/…" });
      kf.language = input("language", { value: m.language || "", placeholder: "Python, R, JavaScript…" });
      kf.rlicence = input("repo-licence", { value: m.licence || "", placeholder: "MIT, GPL-3.0…" });
      kf.branch = input("branch", { value: m.default_branch || "", placeholder: "main" });
      add(field("Repository link", kf.rurl, "An https link to GitHub, GitLab, Codeberg or elsewhere."),
        field("Language", kf.language), field("Code licence", kf.rlicence), field("Default branch", kf.branch));
    } else if (kind === "analysis") {
      kf.before = input("before", { value: m.before || "", placeholder: "layer id or uploaded image key" });
      kf.after = input("after", { value: m.after || "" });
      kf.uncertainty = textarea("uncertainty", { rows: 2, value: m.uncertainty || "" });
      add(field("Before", kf.before), field("After", kf.after),
        field("Uncertainty", kf.uncertainty, "How sure is this, and what could make it wrong?"));
    } else if (kind === "monitor") {
      kf.series = textarea("series", { rows: 4, value: m.series ? JSON.stringify(m.series) : "",
        placeholder: '[{"label":"Uplift","unit":"mm","points":[[1729641600, 3.2]]}]' });
      add(field("Series (JSON)", kf.series, "Each series: label, unit, and points as [epoch seconds, value]. Followers are told when you update it."));
    } else if (kind === "workflow" || kind === "dataset") {
      kf.repo = input("repo", { type: "url", value: m.repo || "", placeholder: "https://" });
      kf.inputs = input("inputs", { value: m.inputs || "" });
      kf.outputs = input("outputs", { value: m.outputs || "" });
      kf.version = input("version", { value: m.version || "" });
      kf.doi = input("doi", { value: m.doi || "", placeholder: "10.xxxx/…" });
      add(field("Repository or download", kf.repo), field("Inputs", kf.inputs), field("Outputs", kf.outputs),
        field("Version", kf.version), field("DOI", kf.doi));
    } else if (kind === "paper") {
      kf.doi = input("doi", { value: m.doi || "" });
      kf.journal = input("journal", { value: m.journal || "" });
      kf.year = input("year", { type: "number", min: 1800, max: 2100, value: m.year || "" });
      kf.authors = input("authors", { value: Array.isArray(m.authors) ? m.authors.join(", ") : m.authors || "" });
      add(field("DOI", kf.doi), field("Journal or preprint server", kf.journal), field("Year", kf.year), field("Authors", kf.authors));
    } else if (kind === "event") {
      kf.format = select("format", EVENT_FORMATS.map((f) => [f, f.replace("-", " ")]), m.format);
      kf.starts = input("starts", { type: "datetime-local", required: true, value: m.starts_at ? new Date(m.starts_at * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "" });
      kf.ends = input("ends", { type: "datetime-local", value: m.ends_at ? new Date(m.ends_at * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "" });
      kf.where = input("where", { value: m.where || "", placeholder: "Online, or a place" });
      kf.url = input("url", { type: "url", value: m.url || "" });
      add(field("Format", kf.format), field("Starts", kf.starts), field("Ends", kf.ends), field("Where", kf.where), field("Link", kf.url));
    } else if (kind === "opportunity") {
      kf.type = select("type", OPP_TYPES.map((t) => [t, t]), m.type);
      kf.org = input("org", { value: m.org || "" });
      kf.deadline = input("deadline", { type: "date", value: epochToDate(m.deadline) });
      kf.skills = input("skills", { value: (m.skills || []).join(", ") });
      kf.paid = select("paid", [["", "Not stated"], ["1", "Paid"], ["0", "Unpaid"]], m.paid === true ? "1" : m.paid === false ? "0" : "");
      kf.apply = input("apply", { type: "url", value: m.apply_url || "" });
      add(field("Type", kf.type), field("Organisation", kf.org), field("Deadline", kf.deadline),
        field("Skills wanted", kf.skills, "Comma-separated."), field("Paid?", kf.paid), field("How to apply (link)", kf.apply));
    } else if (kind === "challenge") {
      kf.sponsor = input("sponsored_by", { value: p.sponsored_by || "" });
      add(field("Sponsored by", kf.sponsor, "Required if anyone is paying for or backing this challenge. It is always shown."));
    } else if (kind === "question") {
      add(h("p", { class: "s-hint", text: "Say what you tried and what you expected. You can mark one answer as accepted." }));
    }
  };
  kindGroup.addEventListener("change", (e) => {
    if (e.target.name === "kind") { kind = e.target.value; drawKindFields(); provHint(); }
  });
  drawKindFields();

  // ── Location ──
  const loc = p.location || (scene && Number.isFinite(scene.camera?.lat)
    ? { lat: scene.camera.lat, lon: scene.camera.lon, precision: "approx", place: "" } : null);
  const lat = input("lat", { type: "number", step: "any", min: -90, max: 90, value: loc ? loc.lat : "" });
  const lon = input("lon", { type: "number", step: "any", min: -180, max: 180, value: loc ? loc.lon : "" });
  const place = input("place", { value: loc?.place || "", placeholder: "e.g. Mount Etna, Sicily" });
  const precision = loc?.precision || (kind === "observation" ? "approx" : "hidden");
  const precGroup = h("fieldset", { class: "s-radios" }, h("legend", {}, "How precisely to show it"),
    [["exact", "Exact", "To about a metre. Only for public sites, never a home or private land."],
      ["approx", "Approximate", "Rounded to 0.1° (about 11 km)."],
      ["region", "Region", "Rounded to 1° (about 110 km)."],
      ["hidden", "Hidden", "No location is stored or shown."]].map(([v, label, hint]) =>
      h("label", { class: "s-radio" }, h("input", { type: "radio", name: "precision", value: v, checked: v === precision }),
        h("span", {}, h("strong", {}, label), " — ", hint))));
  const mapCanvas = h("canvas", { class: "s-pick-map", tabindex: "0", "aria-label": "Map: click to set the location. Arrow keys pan, plus and minus zoom." });
  let picker = null;
  const geoBtn = h("button", { type: "button", class: "btn-ghost s-btn-sm" }, "Use my location");
  geoBtn.addEventListener("click", () => {
    if (!navigator.geolocation) { toast("This browser cannot share its location.", "error"); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      lat.value = pos.coords.latitude.toFixed(5); lon.value = pos.coords.longitude.toFixed(5);
      picker?.setView(pos.coords.longitude, pos.coords.latitude, 8);
    }, () => toast("Location was not shared.", "error"), { enableHighAccuracy: false, timeout: 10000 });
  });
  const locBox = h("fieldset", { class: "s-loc" }, h("legend", {}, "Location (optional)"),
    h("p", { class: "s-hint", text: "Your choice is applied before anything is saved: an approximate or regional location is rounded on the server and the exact point is never stored. Hidden posts never appear on the map." }),
    mapCanvas,
    h("div", { class: "s-row-fields" }, field("Latitude", lat), field("Longitude", lon), geoBtn),
    field("Place name", place), precGroup);

  // ── Provenance, licence, sources, method ──
  const provGroup = h("fieldset", { class: "s-radios" }, h("legend", {}, "Where does this come from? (required)"),
    Object.entries(PROVENANCE).map(([v, info]) => h("label", { class: "s-radio" },
      h("input", { type: "radio", name: "provenance", value: v, required: true,
        // A model's output is modelled; say so unless the author already chose.
        checked: (p.provenance || (initialKind === "model" ? "modelled" : "")) === v }),
      h("span", {}, h("strong", {}, info.label), " — ", info.help))));
  const provNote = h("p", { class: "s-hint" });
  const provHint = () => {
    // A job, event or question makes no claim about the world, so it is not
    // asked where it came from (components.js hasProvenance).
    const asks = hasProvenance(kind);
    provGroup.hidden = !asks;
    provGroup.querySelectorAll("input").forEach((i) => { i.required = asks; });
    provNote.textContent = !asks ? "" : kind === "observation" ? "Field observations are usually “Observed”." : kind === "scene" || kind === "analysis" ? "Model output is “Modelled”; a calculation from data is “Derived”." : "";
  };
  provHint();
  const licence = select("licence", LICENCES, p.licence || "CC-BY-4.0");

  const sourcesList = h("ol", { class: "s-sources-edit" });
  const addSource = (s = {}) => {
    const t = input("src-title", { value: s.label || s.title || "", placeholder: "Title or description", "aria-label": "Source title" });
    const u = input("src-url", { value: s.url || s.doi || "", placeholder: "https://… or DOI", "aria-label": "Source link or DOI" });
    const row = h("li", { class: "s-source-row" }, t, u,
      h("button", { type: "button", class: "s-icon-btn", "aria-label": "Remove source", onClick: () => row.remove() }, "×"));
    put(sourcesList, row);
  };
  (p.sources || []).forEach(addSource);
  const methodSummary = textarea("method", { rows: 3, value: p.method?.summary || "" });
  const methodSoftware = input("software", { value: p.method?.software || "", placeholder: "GeoHUB, QGIS 3.34, GMTSAR…" });
  const limitations = textarea("limitations", { rows: 2, value: p.limitations || "" });

  // ── Media ──
  const mediaList = h("ul", { class: "s-media-edit" });
  const drawMedia = () => {
    clear(mediaList);
    media.forEach((item, i) => {
      const alt = input("alt", { value: item.alt || "", placeholder: "Describe the image for people who cannot see it", "aria-label": "Alt text" });
      alt.addEventListener("input", () => { item.alt = alt.value; });
      put(mediaList, h("li", {},
        item.type === "application/pdf" ? h("span", {}, "PDF attached") : (item.url ? h("img", { src: item.url, alt: "", class: "s-thumb" }) : h("span", {}, "Image")),
        item.type === "application/pdf" ? null : alt,
        h("button", { type: "button", class: "s-icon-btn", "aria-label": "Remove attachment", onClick: () => { media.splice(i, 1); drawMedia(); } }, "×")));
    });
  };
  drawMedia();
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,application/pdf" });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast("That file is over 8 MB.", "error"); file.value = ""; return; }
    try {
      const out = await api.upload(f, { scope: "public" });
      media.push({ key: out.key, alt: "", url: out.url, type: out.type });
      drawMedia();
    } catch (error) { toast(error.message, "error"); }
    file.value = "";
  });

  // ── Visibility ──
  const vis = select("visibility", Object.entries(VISIBILITY), p.visibility || (query.team ? "team"
    : query.project && target ? "project" : query.community ? "community" : "public"));
  const teams = store.me?.teams || [];
  const comms = store.me?.communities || [];
  const teamSel = select("team", [["", "Choose a team"], ...teams.map((t) => [t.slug, t.name])], query.team || "");
  const commSel = select("community", [["", "None"], ...comms.map((c) => [c.slug, c.name])], query.community || "");
  const teamField = field("Team", teamSel, teams.length ? "Only active members of the team will see it." : "You are not in a team yet.");
  const commField = field("Community", commSel, "Post into a community forum. With “A community” visibility, only its members see it.");
  const syncVis = () => { teamField.hidden = vis.value !== "team"; };
  vis.addEventListener("change", syncVis); syncVis();
  const projSel = select("project", [["", "None"]], p.project_id || query.project || "");
  // Mine and those shared with me: a commenter may post into a project too.
  Promise.all([api.get("/v1/projects", { mine: 1 }), api.get("/v1/projects", { shared: 1 })].map((x) => x.catch(() => null)))
    .then((lists) => {
      const seen = new Set();
      for (const pr of lists.flatMap((d) => d?.items || [])) {
        if (seen.has(pr.id)) continue; seen.add(pr.id);
        put(projSel, h("option", { value: pr.id, selected: pr.id === (p.project_id || query.project) }, pr.title));
      }
    });
  const allowFork = checkbox("allow_fork", "Allow others to fork this", p.allow_fork ?? (kind === "scene" || kind === "workflow"),
    "A fork is a copy under their name that credits yours.");

  // ── Submit ──
  const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
  const form = h("form", { class: "s-compose", novalidate: true },
    existing ? null : kindGroup,
    existing ? h("p", {}, "Editing a ", h("strong", {}, kindLabel(kind)), ".") : null,
    h("fieldset", {}, h("legend", {}, "Content"),
      field("Title", title), field("Body", body), counter,
      field("Tags", tags, "Comma-separated, up to 12."),
      kindBox),
    locBox,
    h("fieldset", {}, h("legend", {}, "Provenance & reuse"),
      provGroup, provNote,
      field("Licence", licence, "What others may do with this."),
      h("div", { class: "s-field" }, h("span", { class: "s-label", text: "Sources" }), sourcesList,
        h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => addSource() }, "Add a source")),
      field("Method", methodSummary, "How it was made — enough for someone else to repeat it."),
      field("Software and versions", methodSoftware),
      field("Limitations", limitations, "What this does not show, and where it may be wrong.")),
    h("fieldset", {}, h("legend", {}, "Images and PDFs"),
      field("Attach a file (PNG, JPEG, WebP, GIF or PDF, up to 8 MB)", file), mediaList),
    h("fieldset", {}, h("legend", {}, "Who can see it"),
      field("Visibility", vis), teamField, commField, field("Project", projSel), allowFork),
    status,
    h("div", { class: "s-actions" },
      h("button", { type: "submit", class: "btn-primary" }, existing ? "Save changes" : "Publish"),
      h("a", { class: "btn-ghost", href: existing ? `#/post/${encodeURIComponent(existing.id)}` : "#/" }, "Cancel")));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prov = form.querySelector('input[name="provenance"]:checked');
    const prec = form.querySelector('input[name="precision"]:checked')?.value || "hidden";
    const say = (msg) => { status.textContent = msg; status.classList.add("is-error"); };
    status.classList.remove("is-error");
    if (!title.value.trim() && !body.value.trim()) return say("Give it a title or some text.");
    if (!prov && hasProvenance(kind)) return say("Say where this comes from: observed, derived, modelled, forecast, AI-generated or unverified.");
    if (vis.value === "team" && !teamSel.value) return say("Choose which team can see it.");
    if (vis.value === "community" && !commSel.value) return say("Choose which community can see it.");
    if (vis.value === "project" && !projSel.value) return say("Choose which project's people can see it.");
    if (kind === "event" && !kf.starts?.value) return say("Give the event a start time.");
    if (media.some((x) => x.type !== "application/pdf" && !String(x.alt || "").trim())) return say("Add a description (alt text) to every image.");
    const latN = Number(lat.value); const lonN = Number(lon.value);
    const hasLoc = prec !== "hidden" && lat.value !== "" && lon.value !== "" && Number.isFinite(latN) && Number.isFinite(lonN);
    if (prec !== "hidden" && (lat.value !== "" || lon.value !== "") && !hasLoc) return say("The latitude and longitude need to be numbers.");

    const meta = {};
    try {
      if (kind === "analysis") Object.assign(meta, { before: kf.before.value, after: kf.after.value, uncertainty: kf.uncertainty.value });
      if (kind === "monitor") { meta.series = kf.series.value ? JSON.parse(kf.series.value) : []; meta.updated_at = Math.floor(Date.now() / 1000); }
    } catch (error) { return say("The series is not valid JSON."); }
    if (kind === "workflow" || kind === "dataset") Object.assign(meta, { repo: kf.repo.value, inputs: kf.inputs.value, outputs: kf.outputs.value, version: kf.version.value, doi: kf.doi.value });
    if (kind === "model") {
      let params = {};
      try { params = kf.params.value.trim() ? JSON.parse(kf.params.value) : {}; } catch (error) { return say("The parameters are not valid JSON."); }
      // Keep what GeoHUB attached (page, domain, config) and add what was edited here.
      Object.assign(meta, { ...m, mesher: kf.mesher.value, solver: kf.solver.value, params });
    }
    if (kind === "repo") {
      if (!/^https:\/\//.test(kf.rurl.value.trim())) return say("Give the repository's https link.");
      Object.assign(meta, { url: kf.rurl.value.trim(), language: kf.language.value, licence: kf.rlicence.value, default_branch: kf.branch.value });
    }
    if (kind === "paper") Object.assign(meta, { doi: kf.doi.value, journal: kf.journal.value, year: Number(kf.year.value) || null, authors: splitList(kf.authors.value) });
    if (kind === "event") Object.assign(meta, { format: kf.format.value, starts_at: Math.floor(new Date(kf.starts.value).getTime() / 1000), ends_at: kf.ends.value ? Math.floor(new Date(kf.ends.value).getTime() / 1000) : null, where: kf.where.value, url: kf.url.value });
    if (kind === "opportunity") Object.assign(meta, { type: kf.type.value, org: kf.org.value, deadline: dateToEpoch(kf.deadline.value, true), skills: splitList(kf.skills.value), paid: kf.paid.value === "" ? null : kf.paid.value === "1", apply_url: kf.apply.value });

    const sources = [...sourcesList.querySelectorAll("li")].map((li) => {
      const [t, u] = li.querySelectorAll("input");
      const v = u.value.trim();
      return /^10\.\d{4,}\//.test(v) ? { label: t.value.trim(), doi: v } : { label: t.value.trim(), url: v };
    }).filter((s) => s.label || s.url || s.doi);

    const payload = {
      kind, title: title.value.trim(), body: body.value, tags: splitList(tags.value),
      location: hasLoc ? { lat: latN, lon: lonN, precision: prec, place: place.value.trim() } : { precision: "hidden" },
      world: scene?.world || kf.world?.value || p.world || "earth",
      scene: kind === "scene" ? scene : null,
      media: media.map((x) => ({ key: x.key, alt: x.alt || "" })),
      licence: licence.value, provenance: prov ? prov.value : "unverified", sources,
      method: { summary: methodSummary.value, software: methodSoftware.value },
      limitations: limitations.value, meta,
      visibility: vis.value,
      team_id: vis.value === "team" ? (teams.find((t) => t.slug === teamSel.value)?.id || teamSel.value) : null,
      community_id: commSel.value ? (comms.find((c) => c.slug === commSel.value)?.id || commSel.value) : null,
      project_id: projSel.value || null,
      allow_fork: allowFork.querySelector("input").checked,
      sponsored_by: kind === "challenge" ? kf.sponsor.value.trim() : "",
    };
    const done = busy(form);
    status.textContent = "Publishing…";
    try {
      const saved = existing
        ? await api.patch(`/v1/posts/${encodeURIComponent(existing.id)}`, payload)
        : await api.post("/v1/posts", payload);
      if (handed) dropShare();
      toast(existing ? "Saved." : "Published.");
      location.hash = `#/post/${encodeURIComponent(saved.id)}`;
    } catch (error) {
      done();
      say(error.message || "Could not publish.");
    }
  });

  put(clear(root), h("h1", { class: "s-h1", text: existing ? "Edit post" : "New post" }),
    handed ? h("p", { class: "s-banner", text: handed.kind === "model"
      ? "A model setup from GeoHUB is attached. Readers can open it on the same model page."
      : handed.kind === "repo" ? "A repository from GeoHUB is attached."
      : "A view from GeoHUB is attached. It will open in GeoHUB exactly as you left it." }) : null,
    form);

  picker = createMap(mapCanvas, {
    onClick: ({ lon: x, lat: y }) => { lat.value = y.toFixed(5); lon.value = x.toFixed(5); picker.draw(); },
    onDraw: (ctx, { project }) => {
      const la = Number(lat.value); const lo = Number(lon.value);
      if (lat.value === "" || !Number.isFinite(la) || !Number.isFinite(lo)) return;
      const [x, y] = project(lo, la);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y); ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11); ctx.stroke();
    },
  });
  [lat, lon].forEach((el) => el.addEventListener("input", () => picker.draw()));
  if (loc && Number.isFinite(Number(loc.lat))) picker.setView(Number(loc.lon), Number(loc.lat), 4);
  return () => picker?.destroy();
}
