/**
 * The master key: a fixed word that makes one browser the master account,
 * and the wipe that takes it and every stored credential away again.
 */
import { readFileSync } from "node:fs";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass += 1; else failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`);
}
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

const store = new Map();
globalThis.window = {
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  GeoIDCredentials: { wipeCredentials: ({ everything }) => (everything ? ["the Earth Engine service", "the local sidecar and its token"] : []) },
};
const { unlock, lock, wipeForGoingLive, unlocked } = await import("./master-key.js");

check("a wrong key unlocks nothing", !unlock("admin").ok && !unlocked());
check("the master key unlocks this browser as the owner, the word membership.js reads", unlock("owner").ok && store.get("geoid:unlock") === "owner" && unlocked());
check("lock again removes it", lock().ok && !unlocked());
unlock(" owner ");
check("the key is trimmed", unlocked());
const wiped = wipeForGoingLive();
check("wiping for going live removes the unlock and names every credential it cleared", wiped.ok && !unlocked() && /Earth Engine/.test(wiped.text) && /sidecar/.test(wiped.text));

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const boot = readFileSync(new URL("./boot.js", import.meta.url), "utf8");
check("the card is loaded on Earth", /gis\/master-key\.js\?v=/.test(page));
check("and on the planets", /"\.\/master-key\.js",/.test(boot));
const membership = readFileSync(new URL("./membership.js", import.meta.url), "utf8");
check("the word is the one membership reads as the development unlock", /getItem\("geoid:unlock"\)/.test(membership));
