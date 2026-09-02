import { registerPage } from "../stages.js?v=20260902-19d0d1b";
import * as store from "../project-store.js?v=20260902-19d0d1b";
import { needProject } from "./common.js?v=20260902-19d0d1b";

/**
 * StoryBoard: the project written up.
 *
 * Pulls together what the project already holds -- its profile, its study
 * area, its registered data, its notes and its figures -- into a single HTML
 * page in exports/storyboard/. The outline is the one the Qt app seeds, so a
 * write-up started in either place has the same bones.
 *
 * Self-contained output: figures are embedded as data URIs, because a
 * storyboard that only renders while sitting next to its project folder is not
 * something anyone can send to a co-author.
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


/** The Qt app's seeded outline, so both front ends start from the same shape. */
const OUTLINE = `# Intro
- Study context:
- Core question:

# Lit review
- Current methods in this domain.
- Where this pipeline differs from prior work.

# Methods
- Data sources and pull strategy.
- Preprocessing selections and transformations.
- FEM and postprocessing modules used.

# Results
- Key figures.
- Dataset summaries and validation checks.

# Discussion & conclusion
- Interpretation and constraints.
- Next actions.
`;

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Minimal markdown: headings, list items, paragraphs. Enough for an outline. */
function markdownToHtml(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  lines.forEach((line) => {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length + 1;
      out.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
    } else if (item) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${escapeHtml(item[1])}</li>`);
    } else if (line.trim()) {
      closeList();
      out.push(`<p>${escapeHtml(line)}</p>`);
    } else {
      closeList();
    }
  });
  closeList();
  return out.join("\n");
}

async function readAsDataUri(path) {
  const contents = await store.readProjectFile(path);
  if (typeof contents === "string") return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(contents);
  });
}

async function mount(host, ctx) {
  if (!store.getActive()) { needProject(host, ctx, "Storyboard"); return; }
  const status = el("p", "research-status");
  const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };
  const project = store.getActive();

  // Narrative, kept in the project so it survives a reload.
  const narrativePath = "exports/storyboard/outline.md";
  const existing = await store.readProjectFile(narrativePath).catch(() => null);

  const writeCard = card("Narrative");
  const editor = document.createElement("textarea");
  editor.className = "input research-editor";
  editor.value = typeof existing === "string" && existing ? existing : OUTLINE;
  writeCard.appendChild(editor);

  const includeCard = card("Include");
  const includeFigures = document.createElement("input");
  includeFigures.type = "checkbox"; includeFigures.checked = true;
  const includeNotes = document.createElement("input");
  includeNotes.type = "checkbox"; includeNotes.checked = true;
  const includeData = document.createElement("input");
  includeData.type = "checkbox"; includeData.checked = true;
  const boxes = el("div", "research-form");
  [["Figures", includeFigures], ["Notes", includeNotes], ["Data registry", includeData]]
    .forEach(([label, node]) => {
      const row = el("label", "research-field research-check");
      row.append(node, el("span", "research-field-label", label));
      boxes.appendChild(row);
    });
  includeCard.appendChild(boxes);

  const actions = el("div", "gis-btn-row");
  const saveBtn = el("button", "button secondary", "Save narrative");
  saveBtn.type = "button";
  saveBtn.addEventListener("click", async () => {
    await store.writeProjectFile(narrativePath, editor.value);
    say(`Saved ${narrativePath}.`);
  });
  const buildBtn = el("button", "button", "Build storyboard");
  buildBtn.type = "button";
  actions.append(buildBtn, saveBtn);

  buildBtn.addEventListener("click", async () => {
    say("Building…");
    try {
      await store.writeProjectFile(narrativePath, editor.value);
      const meta = project.meta;
      const area = meta.study_area || {};
      const hasArea = ["min_lat", "max_lat", "min_lon", "max_lon"]
        .every((k) => String(area[k] || "").trim() !== "");

      const parts = [];
      parts.push(`<h1>${escapeHtml(meta.name)}</h1>`);
      if (meta.focus_question) {
        parts.push(`<p class="focus">${escapeHtml(meta.focus_question)}</p>`);
      }
      parts.push('<dl class="meta">');
      parts.push(`<dt>Phase</dt><dd>${escapeHtml(meta.phase)}</dd>`);
      parts.push(`<dt>Priority</dt><dd>${escapeHtml(meta.priority)}</dd>`);
      if ((meta.collaborators || []).length) {
        parts.push(`<dt>Collaborators</dt><dd>${escapeHtml(meta.collaborators.join(", "))}</dd>`);
      }
      if (hasArea) {
        parts.push(`<dt>Study area</dt><dd>${escapeHtml(
          `${area.min_lat} to ${area.max_lat} N, ${area.min_lon} to ${area.max_lon} E `
          + `(${area.crs || "EPSG:4326"})`)}</dd>`);
      }
      parts.push("</dl>");
      parts.push(markdownToHtml(editor.value));

      if (includeFigures.checked) {
        let figures = [];
        try {
          figures = (await store.listProjectDir("figures"))
            .filter((e) => e.kind === "file" && /\.(png|jpe?g|svg)$/i.test(e.name));
        } catch (error) { /* none */ }
        if (figures.length) {
          parts.push("<h2>Figures</h2>");
          for (const figure of figures) {
            // Embedded, so the file travels on its own.
            const uri = await readAsDataUri(`figures/${figure.name}`);
            parts.push('<figure>');
            if (uri) parts.push(`<img src="${uri}" alt="${escapeHtml(figure.name)}">`);
            parts.push(`<figcaption>${escapeHtml(figure.name)}</figcaption></figure>`);
          }
        }
      }

      if (includeNotes.checked) {
        let notes = [];
        try {
          notes = (await store.listProjectDir("notes")).filter((e) => e.kind === "file");
        } catch (error) { /* none */ }
        if (notes.length) {
          parts.push("<h2>Notes</h2>");
          for (const note of notes) {
            const text = await store.readProjectFile(`notes/${note.name}`).catch(() => "");
            parts.push(`<section class="note"><h3>${escapeHtml(note.name)}</h3>`);
            parts.push(markdownToHtml(typeof text === "string" ? text : ""));
            parts.push("</section>");
          }
        }
      }

      if (includeData.checked) {
        const entries = await store.listData();
        if (entries.length) {
          parts.push("<h2>Data</h2><table><tr><th>Name</th><th>Kind</th><th>Path</th></tr>");
          entries.forEach((entry) => {
            parts.push(`<tr><td>${escapeHtml(entry.name)}</td>`
              + `<td>${escapeHtml(entry.kind)}</td>`
              + `<td>${escapeHtml(entry.path || "—")}</td></tr>`);
          });
          parts.push("</table>");
        }
      }

      const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(meta.name)} — storyboard</title>
<style>
  body { margin: 0 auto; max-width: 52rem; padding: 2rem 1.25rem;
    background: #0b1017; color: #dfeaf0;
    font: 16px/1.6 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 1.7rem; margin-bottom: 0.2rem; }
  h2 { margin-top: 2rem; border-bottom: 1px solid #23394a; padding-bottom: 0.25rem; }
  .focus { color: #7fdfe6; font-size: 1.05rem; }
  dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 1rem;
    margin: 1rem 0 2rem; font-size: 0.9rem; }
  dl.meta dt { color: #8fa8b6; }
  figure { margin: 1.5rem 0; }
  figure img { max-width: 100%; border: 1px solid #23394a; border-radius: 6px; }
  figcaption { color: #8fa8b6; font-size: 0.85rem; margin-top: 0.35rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #1b2b38; }
  .note { margin: 1rem 0; padding-left: 0.8rem; border-left: 2px solid #23394a; }
  footer { margin-top: 3rem; color: #6b8494; font-size: 0.8rem; }
</style></head><body>
${parts.join("\n")}
<footer>Built from ${escapeHtml(project.dir)} on ${new Date().toISOString().slice(0, 10)} — GeoID Research Hub.</footer>
</body></html>`;

      const name = `${project.dir}-storyboard.html`;
      await store.writeProjectFile(`exports/storyboard/${name}`, html);
      await store.registerData({
        name, kind: "storyboard", path: `exports/storyboard/${name}`, source: "StoryBoard",
      });
      say(`Built exports/storyboard/${name} (${Math.round(html.length / 1024)} kB).`);
    } catch (error) {
      say(error.message, true);
    }
  });

  host.append(writeCard, includeCard, actions, status);
}

registerPage("Storyboard", { mount });
