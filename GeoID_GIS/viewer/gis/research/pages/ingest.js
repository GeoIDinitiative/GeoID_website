import { registerPage } from "../stages.js?v=20260903-d94308a";
import * as store from "../project-store.js?v=20260903-d94308a";
import { INGEST_DOMAINS, filterToAccept } from "../ingest-catalogue.js?v=20260903-d94308a";
import { needProject } from "./common.js?v=20260903-d94308a";

/**
 * The Data Puller: eleven domain pages, all built from the catalogue.
 *
 * One `mount` serves every domain because they differ only in their data. A
 * page per domain would be eleven copies of the same code drifting apart, and
 * the Qt app already made the same call -- its IngestDomainPage takes a spec.
 *
 * Files land in `data/pulled/<slug>/`, which is what the Qt app's puller writes
 * to, and every pull is recorded in the data registry with the provider it came
 * from -- provenance is the point of a puller, not a nicety.
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function card(title) {
  const box = el("section", "research-card");
  box.appendChild(el("h2", "research-card-title", title));
  return box;
}


/** Records where a file came from, not just that it arrived. */
async function pullFiles(files, { slug, provider, action }, say) {
  const dir = `data/pulled/${slug}`;
  let copied = 0;
  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();
      const path = `${dir}/${file.name}`;
      await store.writeProjectFile(path, new Blob([buffer]));
      await store.registerData({
        name: file.name,
        kind: "pulled",
        path,
        source: `${provider} — ${action}`,
        extra: { domain: slug, bytes: file.size },
      });
      copied += 1;
    } catch (error) {
      say(`${file.name}: ${error.message}`, true);
    }
  }
  // Appended to a per-domain log as well, so lineage survives even if the
  // registry is later rewritten by another tool.
  if (copied) {
    const log = await store.readJson(`data/pulled/${slug}/_lineage.json`, { pulls: [] });
    log.pulls = Array.isArray(log.pulls) ? log.pulls : [];
    log.pulls.push({
      at: new Date().toISOString(),
      provider,
      action,
      files: [...files].map((f) => f.name),
    });
    await store.writeJson(`data/pulled/${slug}/_lineage.json`, log);
  }
  return copied;
}

function providerCard(spec, slug, say, onPulled) {
  const box = card(spec.name);
  box.appendChild(el("p", "research-note", spec.description));

  (spec.source_groups || []).forEach((group) => {
    const section = el("div", "research-subsection");
    section.appendChild(el("h3", "research-subtitle", group.title));
    const list = el("ul", "ingest-sources");
    (group.entries || []).forEach((entry) => list.appendChild(el("li", null, entry)));
    section.appendChild(list);
    box.appendChild(section);
  });

  const row = el("div", "gis-btn-row");
  (spec.actions || []).forEach((action) => {
    if (action.kind === "url") {
      // A link, not a fetch: these are portals with their own terms and
      // logins, and pretending to download from them would be a lie.
      const link = el("a", "button secondary", action.label);
      link.href = action.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      row.appendChild(link);
      return;
    }
    if (action.kind === "import_files") {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.hidden = true;
      const accept = filterToAccept(action.filter);
      if (accept) input.accept = accept;
      const button = el("button", "button", action.label);
      button.type = "button";
      button.addEventListener("click", () => input.click());
      input.addEventListener("change", async () => {
        const files = [...(input.files || [])];
        input.value = "";
        if (!files.length) return;
        say(`Copying ${files.length} file(s) into data/pulled/${slug}…`);
        const copied = await pullFiles(files, {
          slug, provider: spec.name, action: action.label,
        }, say);
        say(`${copied} file(s) in data/pulled/${slug}.`);
        onPulled();
      });
      row.append(button, input);
    }
  });
  box.appendChild(row);
  return box;
}

function makeIngestPage(pageId) {
  const spec = INGEST_DOMAINS[pageId];
  return async function mount(host, ctx) {
    if (!store.getActive()) { needProject(host, ctx, pageId); return; }
    const status = el("p", "research-status");
    const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };

    const intro = card(pageId.replace(/^Ingest /, ""));
    intro.appendChild(el("p", "research-note", spec.subtitle));
    intro.appendChild(el("p", "research-note",
      `Files land in data/pulled/${spec.slug}/ and are recorded against the `
      + "provider they came from."));

    const pulled = card("Already pulled");
    const list = el("div", "research-list");
    pulled.appendChild(list);

    async function refresh() {
      list.textContent = "";
      let entries = [];
      try {
        entries = (await store.listProjectDir(`data/pulled/${spec.slug}`))
          .filter((e) => e.kind === "file" && e.name !== "_lineage.json");
      } catch (error) { /* nothing pulled yet */ }
      if (!entries.length) {
        list.appendChild(el("p", "research-note", "Nothing pulled for this domain yet."));
        return;
      }
      const registry = await store.listData();
      entries.forEach((entry) => {
        const record = registry.find((r) => r.name === entry.name && r.kind === "pulled");
        const row = el("div", "research-list-row");
        row.appendChild(el("span", "research-list-name", entry.name));
        row.appendChild(el("span", "research-list-tag", record?.source || "pulled"));
        list.appendChild(row);
      });
    }

    host.appendChild(intro);
    spec.providers.forEach((provider) => {
      host.appendChild(providerCard(provider, spec.slug, say, () => { void refresh(); }));
    });
    host.append(pulled, status);
    await refresh();
  };
}

// ── Metadata & Lineage ───────────────────────────────────────────────────────

async function mountLineage(host, ctx) {
  if (!store.getActive()) { needProject(host, ctx, "Metadata & Lineage"); return; }
  const status = el("p", "research-status");
  const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };

  const box = card("Where this project's data came from");
  box.appendChild(el("p", "research-note",
    "Every registered dataset, with the provider and action that brought it in. "
    + "This is the audit trail a method section is written from."));
  const table = el("div", "research-table");
  box.appendChild(table);

  const actions = el("div", "gis-btn-row");
  const exportBtn = el("button", "button", "Export lineage CSV");
  exportBtn.type = "button";
  actions.appendChild(exportBtn);

  async function refresh() {
    const entries = await store.listData();
    table.textContent = "";
    if (!entries.length) {
      table.appendChild(el("p", "research-note", "Nothing registered yet."));
      return;
    }
    const header = el("div", "research-table-row is-head");
    ["Name", "Kind", "Source", "Path", "Added"].forEach((h) =>
      header.appendChild(el("span", null, h)));
    table.appendChild(header);
    entries.forEach((entry) => {
      const row = el("div", "research-table-row");
      [entry.name, entry.kind, entry.source || "—", entry.path || "—",
        (entry.added_at || "").slice(0, 10)]
        .forEach((value) => row.appendChild(el("span", null, String(value))));
      table.appendChild(row);
    });
  }

  exportBtn.addEventListener("click", async () => {
    const entries = await store.listData();
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = ["name,kind,source,path,crs,added_at"];
    entries.forEach((e) => rows.push([e.name, e.kind, e.source, e.path, e.crs, e.added_at]
      .map(esc).join(",")));
    const name = "data-lineage.csv";
    await store.writeProjectFile(`exports/${name}`, rows.join("\n"));
    await store.registerData({ name, kind: "export", path: `exports/${name}`, source: "Metadata & Lineage" });
    say(`Wrote exports/${name} (${entries.length} entries).`);
    await refresh();
  });

  host.append(box, actions, status);
  await refresh();
}

Object.keys(INGEST_DOMAINS).forEach((pageId) => {
  registerPage(pageId, { mount: makeIngestPage(pageId) });
});
registerPage("Metadata & Lineage", { mount: mountLineage });
