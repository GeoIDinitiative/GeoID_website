/**
 * A `node --import` hook for fetch-test-data.py --record: logs every path
 * under data/global that a test reads or probes, to the file named by
 * $FSLOG. It changes nothing about what the test sees.
 */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const out = process.env.FSLOG;
const log = (p) => {
  try {
    const s = String(p instanceof URL ? p.pathname : p);
    if (out && s.includes("data/global/")) fs.appendFileSync(out, `${s}\n`);
  } catch { /* logging must never fail a test */ }
};
for (const name of ["readFileSync", "existsSync", "readdirSync", "statSync"]) {
  const orig = fs[name];
  fs[name] = function logged(p, ...rest) { log(p); return orig.call(this, p, ...rest); };
}
syncBuiltinESMExports();
