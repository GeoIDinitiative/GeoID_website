import { registerPage } from "../stages.js?v=20260810-9fd1bbd";
import * as store from "../project-store.js?v=20260810-9fd1bbd";
import { frameUrl, isConfigured } from "../google-credentials.js?v=20260810-9fd1bbd";
import {
  el, input, button, row, statusLine, guard, field, selectOf,
  pageHeader, splitPanes, tabbedPanel, editorCard, findTables, loadTable,
  toolbar,
} from "./common.js?v=20260810-9fd1bbd";

/**
 * Docs & Sheets — the Google workspace, ported from `DocsSheetsPage`
 * (app_qt.py:24655).
 *
 * The Qt page embeds a browser on a persistent Google profile and keeps its
 * link registry in the Atlas hub. Both port, one of them better than an earlier
 * version of this file claimed:
 *
 *  - **The nested window works.** Checked against a real public Sheet:
 *    `docs.google.com` sends no `X-Frame-Options` and no `frame-ancestors`, and
 *    both `/edit` and `/preview` render in a cross-origin iframe — the whole
 *    editor, editable when the browser is signed in to Google. This file used
 *    to say Google refused to be framed. It does not.
 *  - **There is no Atlas hub to hold the registry.** So it lives in the project
 *    instead, at `metadata/links.json` in the hub's own shape
 *    (`{docs: [...], sheets: [...]}`). Because it is a project file, a link
 *    filed here is visible to the desktop app and the other way round.
 *
 * Creating a file through the Drive API still needs an OAuth token. The Client
 * ID for that lives in Settings (never a client secret — see
 * `google-credentials.js`); until it is set, "New Sheet" opens `sheets.new` and
 * files the URL pasted back.
 */

const LINKS_PATH = "metadata/links.json";

const emptyRegistry = () => ({ docs: [], sheets: [] });

async function readLinks() {
  const saved = await store.readJson(LINKS_PATH, null);
  if (!saved || typeof saved !== "object") return emptyRegistry();
  return {
    docs: Array.isArray(saved.docs) ? saved.docs : [],
    sheets: Array.isArray(saved.sheets) ? saved.sheets : [],
  };
}

/** Which kind of Google file a URL is, or null when it is not one. */
export function classifyGoogleUrl(url) {
  const text = String(url || "");
  if (!/^https:\/\/docs\.google\.com\//.test(text)) return null;
  if (text.includes("/spreadsheets/")) return "sheets";
  if (text.includes("/document/")) return "docs";
  if (text.includes("/presentation/")) return "docs";
  return null;
}

const mountDocs = guard("Docs & Sheets", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const links = await readLinks();

  const save = async () => {
    await store.writeJson(LINKS_PATH, links);
  };
  const refresh = () => { host.textContent = ""; void mountDocs(host, ctx); };

  // ── Left: what is linked ──────────────────────────────────────────────────

  function linkList(kind) {
    const wrap = el("div");
    const entries = links[kind];
    wrap.appendChild(el("p", "research-note", kind === "docs"
      ? "Google Docs attached to this project. Results become figures become "
        + "papers; this is where the papers live."
      : "Google Sheets attached to this project. A sheet can be filled from any "
        + "table below and read back in as project data."));

    const list = el("div", "research-list");
    if (!entries.length) {
      list.appendChild(el("p", "research-note", `No ${kind} linked yet.`));
    }
    entries.forEach((entry, index) => {
      const line = el("div", "research-list-row");
      const open = el("a", "research-list-name", entry.title || entry.url);
      open.href = entry.url;
      open.target = "_blank";
      // Google is a different origin and this link is user-supplied, so it
      // must not be handed a window reference back.
      open.rel = "noopener noreferrer";
      line.appendChild(open);
      const drop = button("Unlink", async () => {
        entries.splice(index, 1);
        await save();
        say(`Unlinked "${entry.title || entry.url}".`);
        refresh();
      }, { secondary: true });
      drop.classList.add("small");
      line.appendChild(drop);
      list.appendChild(line);
    });
    wrap.appendChild(list);

    // Attach: the whole registry, with no API and no sign-in.
    const box = editorCard(`Attach a ${kind === "docs" ? "Doc" : "Sheet"}`);
    const url = input("", "https://docs.google.com/…");
    const title = input("", "What this document is");
    box.append(field("URL", url), field("Title", title));
    box.appendChild(row(
      button("Attach to project", async () => {
        const found = classifyGoogleUrl(url.value.trim());
        if (!found) {
          say("That is not a Google Docs, Sheets or Slides URL.", true);
          return;
        }
        if (found !== kind) {
          say(`That is a ${found === "docs" ? "Doc" : "Sheet"} — attach it on `
            + `the ${found === "docs" ? "Docs" : "Sheets"} tab.`, true);
          return;
        }
        links[kind].push({
          url: url.value.trim(),
          title: title.value.trim() || url.value.trim(),
          attached_at: new Date().toISOString(),
        });
        await save();
        say("Filed under this project.");
        refresh();
      }),
      button(kind === "docs" ? "New Doc…" : "New Sheet…", () => {
        // No Drive API, so no title and no filing: Google makes the file, the
        // user pastes the URL back. Said plainly rather than dressed up.
        window.open(kind === "docs" ? "https://docs.new" : "https://sheets.new",
          "_blank", "noopener,noreferrer");
        say("Opened a blank Google file in a new tab — paste its URL above to "
          + "file it against this project.");
      }, { secondary: true }),
    ));
    wrap.appendChild(box);
    return wrap;
  }

  function writtenHere() {
    const wrap = el("div");
    wrap.appendChild(el("p", "research-note",
      "Everything written rather than measured, inside the project itself: "
      + "notes, reports, storyboards."));
    const list = el("div", "research-list");
    wrap.appendChild(list);
    void (async () => {
      const places = ["notes", "plans/reports", "analysis", "exports/storyboard"];
      let total = 0;
      for (const place of places) {
        let entries = [];
        try {
          entries = (await store.listProjectDir(place))
            .filter((e) => e.kind === "file" && /\.(md|html|txt|csv)$/i.test(e.name));
        } catch (error) { continue; }
        entries.forEach((entry) => {
          total += 1;
          const line = el("div", "research-list-row");
          line.append(el("span", "research-list-name", `${place}/${entry.name}`),
            el("span", "research-list-tag", entry.name.split(".").pop()));
          list.appendChild(line);
        });
      }
      if (!total) list.appendChild(el("p", "research-note", "Nothing written yet."));
    })();
    return wrap;
  }

  // ── Right: moving data between the project and a Sheet ────────────────────

  function toSheet() {
    const wrap = el("div");
    wrap.appendChild(el("p", "research-note",
      "Send a project table to a Google Sheet. Without the Drive API the "
      + "handover is the clipboard: this copies the table as TSV, which is what "
      + "Sheets pastes natively — one cell per column, no import dialog."));
    const box = editorCard("Project table → Sheet");
    const picker = selectOf(["(loading…)"]);
    box.appendChild(field("Table", picker));
    void (async () => {
      const tables = await findTables();
      picker.innerHTML = "";
      (tables.length ? tables : ["(no tables in this project)"]).forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t; opt.textContent = t;
        picker.appendChild(opt);
      });
    })();
    box.appendChild(row(
      button("Copy as TSV", async () => {
        try {
          const table = await loadTable(picker.value);
          const tsv = [table.columns.join("\t"),
            ...table.rows.map((r) => r.join("\t"))].join("\n");
          await navigator.clipboard.writeText(tsv);
          say(`${table.rows.length} row(s) copied — paste into a Sheet at A1.`);
        } catch (error) {
          say(`Could not copy: ${error.message}`, true);
        }
      }),
      button("Open a blank Sheet", () => {
        window.open("https://sheets.new", "_blank", "noopener,noreferrer");
      }, { secondary: true }),
    ));
    wrap.appendChild(box);
    return wrap;
  }

  function fromSheet() {
    const wrap = el("div");
    wrap.appendChild(el("p", "research-note",
      "Bring a Sheet back in as project data, registered like any other import "
      + "so every analysis page can read it. Paste the cells, or drop the CSV "
      + "you downloaded from Sheets."));
    const box = editorCard("Sheet → project table");
    const name = input("", "sheet-export.csv");
    const paste = document.createElement("textarea");
    paste.className = "input research-editor";
    paste.rows = 6;
    paste.placeholder = "Paste the sheet's cells here (Ctrl+A, Ctrl+C in Sheets)…";
    box.append(field("Save as", name), field("Cells", paste));

    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".csv,.tsv,text/csv";
    file.className = "input";
    box.appendChild(field("…or a downloaded CSV", file));

    const importText = async (text, filename) => {
      // Sheets copies as TSV and downloads as CSV. Both land here, so pick the
      // delimiter from the content rather than from how it arrived.
      const firstLine = text.split("\n")[0] || "";
      const tabs = (firstLine.match(/\t/g) || []).length;
      const commas = (firstLine.match(/,/g) || []).length;
      const csv = tabs > commas
        ? text.split("\n").map((line) => line.split("\t").map((cell) =>
          (/[",]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\n")
        : text;
      const path = `data/external/${filename}`;
      await store.writeProjectFile(path, csv);
      await store.registerData({
        name: filename,
        kind: "table",
        path,
        source: "Google Sheets",
        extra: { rows: csv.trim().split("\n").length - 1 },
      });
      say(`Saved ${path} and registered it.`);
    };

    box.appendChild(row(
      button("Import pasted cells", async () => {
        const text = paste.value.trim();
        if (!text) { say("Nothing pasted.", true); return; }
        try {
          await importText(text, name.value.trim() || "sheet-export.csv");
          paste.value = "";
        } catch (error) { say(error.message, true); }
      }),
      button("Import the file", async () => {
        const picked = file.files?.[0];
        if (!picked) { say("Choose a file first.", true); return; }
        try {
          await importText(await picked.text(), picked.name);
        } catch (error) { say(error.message, true); }
      }, { secondary: true }),
    ));
    wrap.appendChild(box);
    return wrap;
  }

  function aboutSignIn(ctxRef = ctx) {
    const wrap = el("div");
    wrap.appendChild(el("p", "research-note",
      "The document window works signed out — read-only — because the frame "
      + "uses whatever Google session this browser already has. Signing in to "
      + "Google in this browser makes the framed editor editable, with nothing "
      + "to configure here."));
    wrap.appendChild(el("p", "research-note",
      isConfigured()
        ? "An OAuth Client ID is set in Settings, so creating and filing Docs "
          + "and Sheets from the hub can be wired to the Drive API."
        : "No OAuth Client ID set. Without one, New Doc and New Sheet open a "
          + "blank Google file and you paste the URL back. With one — set it "
          + "under Settings — they can be created and filed in a single "
          + "action, and a table can be pushed into a Sheet directly."));
    wrap.appendChild(el("p", "research-note is-error",
      "Only the Client ID, which ends in .apps.googleusercontent.com. The "
      + "OAuth client *secret* must never be stored in a page served to a "
      + "browser: anyone who loads the site can read it. The browser token flow "
      + "does not use one."));
    wrap.appendChild(row(button("Open Settings",
      () => ctxRef.setPage?.("Settings"), { secondary: true })));
    return wrap;
  }

  /**
   * The nested window. One frame, whichever document is picked, with the mode
   * switch that decides whether it is the editor or the read-only preview.
   */
  function nestedWindow() {
    const wrap = el("div", "gdoc-window");
    const all = [...links.docs.map((e) => ({ ...e, kind: "docs" })),
      ...links.sheets.map((e) => ({ ...e, kind: "sheets" }))];

    if (!all.length) {
      wrap.appendChild(el("p", "research-note",
        "Nothing linked yet. Attach a Doc or a Sheet on the left and it opens "
        + "here, in the page."));
      return wrap;
    }

    const picker = selectOf(all.map((e) => e.title || e.url));
    const modePick = selectOf(["Edit", "Preview"], "Edit");
    const frame = document.createElement("iframe");
    frame.className = "gdoc-frame";
    // Google is a different origin: no same-origin privileges, no window
    // reference back, and only the sandbox flags the editor actually needs.
    frame.referrerPolicy = "no-referrer-when-downgrade";
    frame.allow = "clipboard-write";
    frame.title = "Google document";

    const show = () => {
      const entry = all[picker.selectedIndex] || all[0];
      frame.src = frameUrl(entry.url, { mode: modePick.value.toLowerCase() });
    };
    picker.addEventListener("change", show);
    modePick.addEventListener("change", show);

    wrap.appendChild(toolbar(picker, modePick,
      button("Reload", () => { frame.src = frame.src; }, { secondary: true }),
      button("Open in a tab", () => {
        const entry = all[picker.selectedIndex] || all[0];
        window.open(entry.url, "_blank", "noopener,noreferrer");
      }, { secondary: true })));
    wrap.appendChild(frame);
    wrap.appendChild(el("p", "research-note",
      "Editing needs this browser signed in to Google; signed out, the frame "
      + "is read-only. Sign in from “Open in a tab” once and the frame follows."));
    show();
    return wrap;
  }

  const left = tabbedPanel("Linked documents", {
    Docs: () => linkList("docs"),
    Sheets: () => linkList("sheets"),
    "In the project": writtenHere,
  });
  const right = tabbedPanel("Document window", {
    Document: nestedWindow,
    "To a Sheet": toSheet,
    "From a Sheet": fromSheet,
    "Signing in": aboutSignIn,
  });

  host.append(
    pageHeader("Docs & Sheets",
      "Project-linked Google documents — write up results without leaving the "
      + "study, and pull a sheet back in as data."),
    splitPanes(left, right, "1fr 1fr"), status);
});

mountDocs.ownHeader = true;
registerPage("Docs & Sheets", { mount: mountDocs });
