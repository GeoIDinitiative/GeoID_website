/** The calculator against arithmetic whose answers are known. */
import { tokenize, parse, compile, namesIn, variableTable, evaluate } from "./field-calculator.js";

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

const calc = (text, vars = {}) => compile(parse(text), (n) => (Object.prototype.hasOwnProperty.call(vars, n) ? () => vars[n] : null))(0);
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

check("tokens: numbers with exponents, qualified names, operators", tokenize("1.5e-3*stress.vm").map((t) => t.type).join() === "num,*,name,end" && tokenize(".5")[0].value === 0.5);
check("precedence: * before +, brackets first", calc("1 + 2 * 3") === 7 && calc("(1 + 2) * 3") === 9 && calc("7 % 4 + 1") === 4);
check("power: right associative, above unary minus, as in mathematics", calc("2^3^2") === 512 && calc("-2^2") === -4 && calc("2^-1") === 0.5);
check("functions and constants", Math.abs(calc("atan2(1, 1) * 180 / pi") - 45) < 1e-12 && calc("sqrt(3^2 + 4^2)") === 5 && calc("hypot(3, 4)") === 5 && calc("max(1, 7, 3)") === 7 && calc("log10(1000)") === 3);
check("variables", calc("sqrt(ux^2 + uy^2)", { ux: 3, uy: 4 }) === 5);
check("errors say what and where", throws(() => calc("uxx + 1"), /unknown name 'uxx' at 0/) && throws(() => calc("1 +"), /ends too soon/) && throws(() => calc("sqrt(1, 2)"), /takes 1 argument/) && throws(() => calc("2 $ 3"), /unexpected '\$' at 2/) && throws(() => calc("foo(1)"), /unknown function 'foo'/) && throws(() => calc(""), /empty/) && throws(() => calc("(1"), /expected '\)'/));
check("nothing reaches the page: a name that is not in the table is an error, not a lookup", throws(() => calc("constructor"), /unknown name/) && throws(() => calc("window"), /unknown name/) && throws(() => calc("toString(1)"), /unknown function/) && throws(() => calc("constructor(1)"), /unknown function/));
check("names read, constants not", [...namesIn(parse("ux * pi + stress.vm"))].join() === "ux,stress.vm");

const fields = [
  { field: "solid/u", desc: { components: [{ key: "ux" }, { key: "uy" }, { key: "uz" }] } },
  { field: "derived/stress", desc: { components: [{ key: "sxx" }, { key: "ux" }] } },
];
const table = variableTable(fields);
check("table: every component qualified by its field, bare only where unique", table.get("u.uz").component === 2 && table.get("sxx").field === 1 && table.get("stress.ux").field === 1 && !table.has("ux"));

const n = 3;
const u = [new Float64Array([3, 0, 1]), new Float64Array([4, 1, 1]), new Float64Array([0, 0, -2])];
const out = evaluate("sqrt(u.ux^2 + u.uy^2) + z", { table, nodeCount: n, coords: new Float64Array([0, 0, 10, 0, 0, 20, 0, 0, 30]), columns: (f, c) => (f === 0 ? u[c] : new Float64Array(n)) });
check("evaluate: over every node, coordinates included", out[0] === 15 && out[1] === 21 && Math.abs(out[2] - (Math.SQRT2 + 30)) < 1e-12);
