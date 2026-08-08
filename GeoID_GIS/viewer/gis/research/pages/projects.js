import { registerPage } from "../stages.js?v=20260809n";
import * as store from "../project-store.js?v=20260809n";

/**
 * Projects: choose the folder, make a project, open one, edit its profile.
 *
 * Everything here writes straight to disk in the Qt app's layout, so there is
 * no "save" step and no second copy of the truth in browser storage.
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function field(label, input) {
  const row = el("label", "research-field");
  row.appendChild(el("span", "research-field-label", label));
  row.appendChild(input);
  return row;
}

function input(value, { type = "text", placeholder = "" } = {}) {
  const node = document.createElement("input");
  node.className = "input";
  node.type = type;
  node.value = value ?? "";
  if (placeholder) node.placeholder = placeholder;
  return node;
}

function select(options, value) {
  const node = document.createElement("select");
  node.className = "input";
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    node.appendChild(o);
  });
  node.value = value;
  return node;
}

function card(title) {
  const box = el("section", "research-card");
  box.appendChild(el("h2", "research-card-title", title));
  return box;
}

async function mount(host, ctx) {
  const status = el("p", "research-status");

  function say(message, isError) {
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
  }

  // ── Where projects live ─────────────────────────────────────────────────
  const rootCard = card("Projects folder");
  const rootLine = el("p", "research-note");
  const rootRow = el("div", "gis-btn-row");
  const chooseBtn = el("button", "button", "Choose folder…");
  chooseBtn.type = "button";
  const forgetBtn = el("button", "button secondary", "Forget");
  forgetBtn.type = "button";
  rootRow.append(chooseBtn, forgetBtn);
  rootCard.append(rootLine, rootRow);

  if (!store.isSupported()) {
    rootLine.textContent =
      "This browser cannot open a folder directly. Chrome or Edge can; elsewhere, "
      + "projects can only be moved as exported bundles.";
    chooseBtn.disabled = true;
  }

  chooseBtn.addEventListener("click", async () => {
    try {
      await store.chooseRoot();
      say("Projects folder set.");
      await refresh();
    } catch (error) {
      // A cancelled picker is not a failure worth shouting about.
      if (error.name !== "AbortError") say(error.message, true);
    }
  });
  forgetBtn.addEventListener("click", async () => {
    await store.forgetRoot();
    say("Folder forgotten. Projects on disk are untouched.");
    await refresh();
  });

  // ── The list, and making a new one ──────────────────────────────────────
  const listCard = card("Projects");
  const list = el("div", "research-list");
  const newRow = el("div", "gis-btn-row");
  const newName = input("", { placeholder: "New project name" });
  const newBtn = el("button", "button", "Create");
  newBtn.type = "button";
  newRow.append(newName, newBtn);
  listCard.append(list, newRow);

  newBtn.addEventListener("click", async () => {
    const name = newName.value.trim();
    if (!name) { say("Give the project a name first.", true); return; }
    try {
      const project = await store.createProject(name);
      newName.value = "";
      say(`Created "${project.dir}" with the full project tree.`);
      await refresh();
    } catch (error) {
      say(error.message, true);
    }
  });

  // ── The open project's profile ──────────────────────────────────────────
  const profileCard = card("Profile");
  const profileBody = el("div", "research-form");
  profileCard.appendChild(profileBody);

  function renderProfile() {
    profileBody.textContent = "";
    const active = store.getActive();
    if (!active) {
      profileBody.appendChild(el("p", "research-note", "No project open."));
      return;
    }
    const meta = active.meta;
    const name = input(meta.name);
    const description = document.createElement("textarea");
    description.className = "input";
    description.rows = 3;
    description.value = meta.description || "";
    const focus = input(meta.focus_question, { placeholder: "The question this project answers" });
    const phase = select(store.PHASES, meta.phase);
    const priority = select(store.PRIORITIES, meta.priority);
    const collaborators = input((meta.collaborators || []).join(", "),
      { placeholder: "Comma separated" });
    const tags = input((meta.tags || []).join(", "), { placeholder: "Comma separated" });

    const area = meta.study_area || {};
    const minLat = input(area.min_lat, { placeholder: "min lat" });
    const maxLat = input(area.max_lat, { placeholder: "max lat" });
    const minLon = input(area.min_lon, { placeholder: "min lon" });
    const maxLon = input(area.max_lon, { placeholder: "max lon" });

    const save = el("button", "button", "Save");
    save.type = "button";
    save.addEventListener("click", async () => {
      try {
        await store.updateMetadata({
          name: name.value.trim() || meta.name,
          description: description.value,
          focus_question: focus.value,
          phase: phase.value,
          priority: priority.value,
          collaborators: collaborators.value.split(",").map((s) => s.trim()).filter(Boolean),
          tags: tags.value.split(",").map((s) => s.trim()).filter(Boolean),
          study_area: {
            ...area,
            min_lat: minLat.value, max_lat: maxLat.value,
            min_lon: minLon.value, max_lon: maxLon.value,
          },
        });
        say("Saved to metadata/project.json.");
        await refresh();
      } catch (error) {
        say(error.message, true);
      }
    });

    profileBody.append(
      field("Name", name),
      field("Description", description),
      field("Focus question", focus),
      field("Phase", phase),
      field("Priority", priority),
      field("Collaborators", collaborators),
      field("Tags", tags),
    );
    const areaBox = el("div", "research-subsection");
    areaBox.appendChild(el("h3", "research-subtitle", "Study area"));
    // Set here or from the GIS page's Area tool -- the same field either way.
    areaBox.appendChild(el("p", "research-note",
      "Drawn areas from the GIS page write these bounds too."));
    const grid = el("div", "research-grid-2");
    grid.append(field("Min lat", minLat), field("Max lat", maxLat),
      field("Min lon", minLon), field("Max lon", maxLon));
    areaBox.appendChild(grid);
    profileBody.appendChild(areaBox);

    const row = el("div", "gis-btn-row");
    row.appendChild(save);
    profileBody.appendChild(row);
  }

  async function refresh() {
    const root = store.getRoot();
    rootLine.textContent = root
      ? `Using "${root.name}" (${root.kind === "disk" ? "on disk" : root.kind}).`
      : store.isSupported()
        ? "No folder chosen. Pick where geoid_projects should live."
        : rootLine.textContent;
    forgetBtn.disabled = !root;

    list.textContent = "";
    if (!root) {
      list.appendChild(el("p", "research-note", "Choose a folder to see its projects."));
    } else {
      const names = await store.listProjects();
      const active = store.getActive();
      if (!names.length) {
        list.appendChild(el("p", "research-note", "No projects here yet."));
      }
      names.forEach((dir) => {
        const row = el("button", "research-list-row");
        row.type = "button";
        row.classList.toggle("is-active", active?.dir === dir);
        row.appendChild(el("span", "research-list-name", dir));
        if (active?.dir === dir) row.appendChild(el("span", "research-list-tag", "open"));
        row.addEventListener("click", async () => {
          try {
            await store.openProject(dir);
            say(`Opened "${dir}".`);
            await refresh();
          } catch (error) {
            say(error.message, true);
          }
        });
        list.appendChild(row);
      });
    }
    newBtn.disabled = !root;
    newName.disabled = !root;
    renderProfile();
    // The top bar carries the open project across every stage.
    const badge = document.getElementById("research-project");
    const active = store.getActive();
    if (badge) {
      badge.textContent = active ? active.name : "No project open";
      badge.classList.toggle("is-open", Boolean(active));
    }
    ctx.refresh?.();
  }

  host.append(rootCard, listCard, profileCard, status);

  // Try last session's folder without a dialog; the picker needs a gesture, so
  // a lapsed permission just leaves the button waiting rather than throwing.
  if (!store.getRoot() && store.isSupported()) {
    try { await store.restoreRoot(); } catch (error) { /* ask again on click */ }
  }
  await refresh();
}

registerPage("Projects", { mount });
