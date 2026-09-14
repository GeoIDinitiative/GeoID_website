// The pure half of the floating Docs & Sheets windows: which URLs open, and
// where a window may sit.
import { classifyGoogleUrl, clampRect, cascadeRect, snapRect, titleFor } from "./gdoc-windows.js";

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; console.log(`  ✗ ${name}`); } };
process.on("exit", () => {
  console.log(`gdoc-windows: ${pass} passed${fail ? `, ${fail} failed` : ""}`);
  if (fail) process.exitCode = 1;
});

check("a Sheet is a sheet", classifyGoogleUrl("https://docs.google.com/spreadsheets/d/abc/edit") === "sheets");
check("a Doc is a doc", classifyGoogleUrl("https://docs.google.com/document/d/abc/edit") === "docs");
check("Slides open", classifyGoogleUrl("https://docs.google.com/presentation/d/abc/edit") === "slides");
check("a Drive file opens", classifyGoogleUrl("https://drive.google.com/file/d/abc/view") === "drive");
check("another site does not", classifyGoogleUrl("https://example.com/document/d/abc") === null);
check("http is refused", classifyGoogleUrl("http://docs.google.com/document/d/abc") === null);
check("a lookalike host is refused", classifyGoogleUrl("https://docs.google.com.evil.io/document/d/x") === null);

const vw = 1400, vh = 900;
const off = clampRect({ x: 5000, y: -400, w: 100, h: 100 }, vw, vh);
check("never below the minimum size", off.w >= 320 && off.h >= 220);
check("a window flung right keeps a grab strip on screen", off.x <= vw - 120);
check("never above the shell row", off.y >= 56);
const huge = clampRect({ x: 0, y: 56, w: 99999, h: 99999 }, vw, vh);
check("never wider than the screen", huge.w <= vw - 16 && huge.h <= vh - 56 - 8);

const a = cascadeRect(0, vw, vh), b = cascadeRect(1, vw, vh);
check("cascaded windows do not land on each other", a.x !== b.x && a.y !== b.y);
check("a new window is fully on screen", a.x >= 8 && a.x + a.w <= vw && a.y + a.h <= vh);

const L = snapRect("left", vw, vh), R = snapRect("right", vw, vh);
check("halves do not overlap", L.x + L.w <= R.x);
check("halves reach both edges", L.x === 8 && R.x + R.w === vw - 8);

check("an unnamed Sheet is titled by kind and id head", titleFor("https://docs.google.com/spreadsheets/d/1AbCdEfGh/edit") === "Sheet 1AbCdE…");
