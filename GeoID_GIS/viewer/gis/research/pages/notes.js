import { registerPage } from "../stages.js?v=20260823-9a98b82";
import * as store from "../project-store.js?v=20260823-9a98b82";
import { needProject } from "./common.js?v=20260823-9a98b82";

/**
 * Research Notes: markdown files in the project's notes/ folder.
 *
 * Plain files rather than a database, so the Qt app, a text editor and git all
 * see the same thing. The timestamp button is carried over from the Qt notes
 * editor, which is the one affordance that turned out to matter when writing a
 * lab notebook as you go.
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

function safeFile(name) {
  const base = String(name || "").trim().replace(/[^\w\-. ]+/g, "_").replace(/\s+/g, "_");
  if (!base) return "";
  return base.endsWith(".md") ? base : `${base}.md`;
}

async function mount(host, ctx) {
  const status = el("p", "research-status");
  const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };

  if (!store.getActive()) { needProject(host, ctx, "Research Notes"); return; }

  let current = null;

  const listCard = card("Notes");
  const list = el("div", "research-list");
  const newRow = el("div", "gis-btn-row");
  const newName = document.createElement("input");
  newName.className = "input";
  newName.placeholder = "New note name";
  const newBtn = el("button", "button", "New");
  newBtn.type = "button";
  newRow.append(newName, newBtn);
  listCard.append(list, newRow);

  const editorCard = card("Editor");
  const editor = document.createElement("textarea");
  editor.className = "input research-editor";
  editor.rows = 18;
  editor.placeholder = "Select or create a note.";
  editor.disabled = true;
  const editorRow = el("div", "gis-btn-row");
  const saveBtn = el("button", "button", "Save");
  saveBtn.type = "button";
  saveBtn.disabled = true;
  const stampBtn = el("button", "button secondary", "Insert timestamp");
  stampBtn.type = "button";
  stampBtn.disabled = true;
  editorRow.append(saveBtn, stampBtn);
  editorCard.append(editor, editorRow);

  async function refreshList() {
    list.textContent = "";
    let entries = [];
    try {
      entries = await store.listProjectDir("notes");
    } catch (error) {
      list.appendChild(el("p", "research-note", "notes/ is not readable."));
      return;
    }
    const files = entries.filter((e) => e.kind === "file");
    if (!files.length) {
      list.appendChild(el("p", "research-note", "No notes yet."));
    }
    files.forEach((entry) => {
      const row = el("button", "research-list-row");
      row.type = "button";
      row.classList.toggle("is-active", current === entry.name);
      row.appendChild(el("span", "research-list-name", entry.name));
      row.addEventListener("click", async () => {
        try {
          const text = await store.readProjectFile(`notes/${entry.name}`);
          current = entry.name;
          editor.value = typeof text === "string" ? text : "";
          editor.disabled = false;
          saveBtn.disabled = false;
          stampBtn.disabled = false;
          say(`Editing notes/${entry.name}.`);
          await refreshList();
        } catch (error) {
          say(error.message, true);
        }
      });
      list.appendChild(row);
    });
  }

  newBtn.addEventListener("click", async () => {
    const name = safeFile(newName.value);
    if (!name) { say("Give the note a name first.", true); return; }
    try {
      if (await store.projectFileExists(`notes/${name}`)) {
        say(`notes/${name} already exists.`, true);
        return;
      }
      const heading = `# ${newName.value.trim()}\n\n`;
      await store.writeProjectFile(`notes/${name}`, heading);
      newName.value = "";
      current = name;
      editor.value = heading;
      editor.disabled = false;
      saveBtn.disabled = false;
      stampBtn.disabled = false;
      say(`Created notes/${name}.`);
      await refreshList();
    } catch (error) {
      say(error.message, true);
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (!current) return;
    try {
      await store.writeProjectFile(`notes/${current}`, editor.value);
      say(`Saved notes/${current}.`);
    } catch (error) {
      say(error.message, true);
    }
  });

  stampBtn.addEventListener("click", () => {
    // ISO to the minute: sortable, unambiguous, and the same stamp the Qt
    // editor writes.
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const at = editor.selectionStart ?? editor.value.length;
    editor.value = `${editor.value.slice(0, at)}\n## ${stamp}\n${editor.value.slice(at)}`;
    editor.focus();
  });

  host.append(listCard, editorCard, status);
  await refreshList();
}

registerPage("Research Notes", { mount });
