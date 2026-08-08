import { registerPage } from "../stages.js?v=20260810h";
import * as store from "../project-store.js?v=20260810h";

/**
 * Data Repository: the project folder, as it actually is on disk.
 *
 * A tree rather than a curated list, because the Qt app and anything else
 * writing into the project will put files here that this page has never heard
 * of, and hiding them would make the browser's view a lie.
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

async function renderDir(host, relPath, depth, expanded) {
  let entries = [];
  try {
    entries = await store.listProjectDir(relPath);
  } catch (error) {
    host.appendChild(el("p", "research-note", `Cannot read ${relPath}: ${error.message}`));
    return;
  }
  for (const entry of entries) {
    const path = relPath ? `${relPath}/${entry.name}` : entry.name;
    const row = el("div", "repo-row");
    row.style.paddingLeft = `${depth * 0.9}rem`;
    const isDir = entry.kind === "directory";
    const open = expanded.has(path);

    const label = el("button", "repo-entry");
    label.type = "button";
    label.appendChild(el("span", "repo-glyph", isDir ? (open ? "▾" : "▸") : "·"));
    label.appendChild(el("span", isDir ? "repo-dir" : "repo-file", entry.name));
    if (isDir) {
      label.addEventListener("click", async () => {
        if (open) expanded.delete(path); else expanded.add(path);
        await redraw();
      });
    } else {
      label.addEventListener("click", async () => {
        // Only text is previewed; a binary raster shown as text is noise.
        const preview = document.getElementById("repo-preview");
        if (!preview) return;
        preview.textContent = "Reading…";
        try {
          const text = await store.readProjectFile(path);
          const body = typeof text === "string" ? text : "(binary file)";
          preview.textContent = body.length > 4000
            ? `${body.slice(0, 4000)}\n… (${body.length} characters total)`
            : body || "(empty file)";
        } catch (error) {
          preview.textContent = `Cannot read: ${error.message}`;
        }
      });
    }
    row.appendChild(label);
    host.appendChild(row);
    if (isDir && open) {
      await renderDir(host, path, depth + 1, expanded);
    }
  }
}

let redraw = async () => {};

async function mount(host, ctx) {
  const status = el("p", "research-status");
  const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };

  if (!store.getActive()) {
    const none = card("Data Repository");
    none.appendChild(el("p", "research-note", "No project open."));
    const row = el("div", "gis-btn-row");
    const go = el("button", "button", "Go to Projects");
    go.type = "button";
    go.addEventListener("click", () => ctx.setPage?.("Projects"));
    row.appendChild(go);
    none.appendChild(row);
    host.appendChild(none);
    return;
  }

  const expanded = new Set(["data", "data/raw"]);

  const treeCard = card("Project folder");
  const importRow = el("div", "gis-btn-row");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.hidden = true;
  const importBtn = el("button", "button", "Import into data/raw");
  importBtn.type = "button";
  importBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = "";
    if (!files.length) return;
    say(`Copying ${files.length} file(s)…`);
    try {
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        await store.writeProjectFile(`data/raw/${file.name}`, new Blob([buffer]));
        await store.registerData({
          name: file.name, kind: "file", path: `data/raw/${file.name}`, source: "Repository import",
        });
      }
      say(`Copied ${files.length} file(s) into data/raw.`);
      await redraw();
    } catch (error) {
      say(error.message, true);
    }
  });
  importRow.append(importBtn, fileInput);
  treeCard.appendChild(importRow);

  const tree = el("div", "repo-tree");
  treeCard.appendChild(tree);

  const previewCard = card("Preview");
  const preview = el("pre", "repo-preview");
  preview.id = "repo-preview";
  preview.textContent = "Select a file.";
  previewCard.appendChild(preview);

  const registryCard = card("Registered data");
  const registryList = el("div", "research-list");
  registryCard.appendChild(registryList);

  redraw = async () => {
    tree.textContent = "";
    await renderDir(tree, "", 0, expanded);
    registryList.textContent = "";
    const entries = await store.listData();
    if (!entries.length) {
      registryList.appendChild(el("p", "research-note",
        "Nothing registered. Imports on the GIS page land here automatically."));
    }
    entries.forEach((entry) => {
      const row = el("div", "research-list-row");
      row.appendChild(el("span", "research-list-name", entry.name));
      row.appendChild(el("span", "research-list-tag", entry.kind));
      registryList.appendChild(row);
    });
  };

  host.append(treeCard, previewCard, registryCard, status);
  await redraw();
}

registerPage("Data Repository", { mount });
