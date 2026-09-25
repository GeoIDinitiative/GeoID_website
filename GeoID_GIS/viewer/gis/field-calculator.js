/**
 * THE CALCULATOR: a new field from an expression over the open ones, as
 * ParaView's Calculator filter makes one.
 *
 *     sqrt(ux^2 + uy^2)            horizontal displacement
 *     uz * 1000                     vertical displacement in millimetres
 *     stress.sxx - stress.szz       a stress difference
 *     atan2(uy, ux) * 180 / pi      the azimuth of horizontal motion
 *
 * A PARSER, NOT eval. An expression typed into a page is text somebody else
 * may have written (a saved session, a shared project), so it is tokenised,
 * parsed by recursive descent into a tree, and compiled to closures over
 * typed arrays: nothing in it can reach anything but the numbers it names.
 * Errors say where: "unknown name 'uxx' at 5".
 *
 * Grammar, loosest first: + −, then * / %, then unary −, then ^ (right
 * associative, so 2^3^2 is 2^9 and −2^2 is −4, as in mathematics), then
 * numbers, names, calls and brackets. Names resolve through a table the page
 * supplies: a component key (ux), or a field-qualified one (stress.vm) where
 * two fields share a key; x, y, z are the node's coordinates; pi and e.
 */

const FUNCTIONS = Object.assign(Object.create(null), {
  sqrt: [1, Math.sqrt], abs: [1, Math.abs], exp: [1, Math.exp], log: [1, Math.log], log10: [1, Math.log10],
  sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan], asin: [1, Math.asin], acos: [1, Math.acos], atan: [1, Math.atan],
  floor: [1, Math.floor], ceil: [1, Math.ceil], sign: [1, Math.sign],
  round: [1, Math.round], trunc: [1, Math.trunc],
  atan2: [2, Math.atan2], pow: [2, Math.pow], min: [-2, Math.min], max: [-2, Math.max], hypot: [-1, Math.hypot],
});
// Null prototypes and own-property tests: `in` would find "constructor" and
// "toString" on Object.prototype and hand a name the page's own functions.
const CONSTANTS = Object.assign(Object.create(null),
  { pi: Math.PI, e: Math.E, PI: Math.PI, E: Math.E });
const own = (table, key) => Object.prototype.hasOwnProperty.call(table, key);

/** Tokens: numbers (1, 2.5, 1e-3), names (ux, stress.vm), operators and brackets, each with its position. */
export function tokenize(text) {
  const out = [];
  const src = String(text);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { out.push({ type: "num", value: Number(num[0]), at: i }); i += num[0].length; continue; }
    const name = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(src.slice(i));
    if (name) { out.push({ type: "name", value: name[0], at: i }); i += name[0].length; continue; }
    // Two characters first, or ">=" tokenizes as ">" then "=".
    const two = src.slice(i, i + 2);
    if ([">=", "<=", "==", "!=", "&&", "||"].includes(two)) {
      out.push({ type: two, at: i }); i += 2; continue;
    }
    if ("+-*/%^(),<>?:".includes(ch)) { out.push({ type: ch, at: i }); i += 1; continue; }
    if (ch === "=") throw new Error(`use '==' to compare, at ${i}`);
    throw new Error(`unexpected '${ch}' at ${i}`);
  }
  out.push({ type: "end", at: src.length });
  return out;
}

/** The expression's tree: { op, args } | { num } | { name } | { call, args }. */
export function parse(text) {
  const tokens = tokenize(text);
  let k = 0;
  const peek = () => tokens[k];
  const take = (type) => {
    const t = tokens[k];
    if (t.type !== type) throw new Error(`expected '${type === "end" ? "end of expression" : type}' at ${t.at}`);
    k += 1;
    return t;
  };
  // A CONDITION IS A NUMBER HERE, 1 or 0, because every value in this
  // language is. That is what lets `x > 100` stand alone as a 0/1 mask and
  // `x > 100 ? a : b` read the way anybody writing a field calculator expects.
  const ternary = () => {
    const cond = orExpr();
    if (peek().type !== "?") return cond;
    k += 1;
    const yes = ternary();
    take(":");
    return { op: "?:", args: [cond, yes, ternary()] };
  };
  const orExpr = () => {
    let left = andExpr();
    while (peek().type === "||") { k += 1; left = { op: "||", args: [left, andExpr()] }; }
    return left;
  };
  const andExpr = () => {
    let left = comparison();
    while (peek().type === "&&") { k += 1; left = { op: "&&", args: [left, comparison()] }; }
    return left;
  };
  const comparison = () => {
    let left = additive();
    while ([">", "<", ">=", "<=", "==", "!="].includes(peek().type)) {
      const op = tokens[k++].type; left = { op, args: [left, additive()] };
    }
    return left;
  };
  const additive = () => {
    let left = multiplicative();
    while (peek().type === "+" || peek().type === "-") { const op = tokens[k++].type; left = { op, args: [left, multiplicative()] }; }
    return left;
  };
  const multiplicative = () => {
    let left = unary();
    while (["*", "/", "%"].includes(peek().type)) { const op = tokens[k++].type; left = { op, args: [left, unary()] }; }
    return left;
  };
  const unary = () => {
    if (peek().type === "-") { k += 1; return { op: "neg", args: [unary()] }; }
    if (peek().type === "+") { k += 1; return unary(); }
    return power();
  };
  const power = () => {
    const base = primary();
    if (peek().type === "^") { k += 1; return { op: "^", args: [base, unary()] }; }
    return base;
  };
  const primary = () => {
    const t = peek();
    if (t.type === "num") { k += 1; return { num: t.value }; }
    if (t.type === "(") { k += 1; const inner = ternary(); take(")"); return inner; }
    if (t.type === "name") {
      k += 1;
      if (peek().type === "(") {
        k += 1;
        const args = [];
        if (peek().type !== ")") { args.push(ternary()); while (peek().type === ",") { k += 1; args.push(ternary()); } }
        take(")");
        return { call: t.value, args, at: t.at };
      }
      return { name: t.value, at: t.at };
    }
    throw new Error(t.type === "end" ? "the expression ends too soon" : `unexpected '${t.type}' at ${t.at}`);
  };
  if (peek().type === "end") throw new Error("the expression is empty");
  const tree = ternary();
  take("end");
  return tree;
}

/** Every name an expression reads (not functions or constants). */
export function namesIn(tree, out = new Set()) {
  if (tree.name) { if (!own(CONSTANTS, tree.name)) out.add(tree.name); }
  (tree.args || []).forEach((a) => namesIn(a, out));
  return out;
}

/**
 * Compile a tree to f(i) over node i. `resolve(name)` answers a function of i
 * for a name, or null when there is no such name (reported with its place).
 */
export function compile(tree, resolve) {
  const build = (n) => {
    if (n.num !== undefined) { const v = n.num; return () => v; }
    if (n.name !== undefined) {
      if (own(CONSTANTS, n.name)) { const v = CONSTANTS[n.name]; return () => v; }
      const got = resolve(n.name);
      if (!got) throw new Error(`unknown name '${n.name}' at ${n.at}`);
      return got;
    }
    if (n.call !== undefined) {
      const fn = own(FUNCTIONS, n.call) ? FUNCTIONS[n.call] : null;
      if (!fn) throw new Error(`unknown function '${n.call}' at ${n.at}`);
      const [arity, impl] = fn;
      if (arity > 0 && n.args.length !== arity) throw new Error(`${n.call} takes ${arity} argument${arity > 1 ? "s" : ""}, given ${n.args.length}`);
      if (arity < 0 && n.args.length < -arity) throw new Error(`${n.call} takes at least ${-arity} arguments`);
      const args = n.args.map(build);
      if (args.length === 1) { const [a] = args; return (i) => impl(a(i)); }
      if (args.length === 2) { const [a, b] = args; return (i) => impl(a(i), b(i)); }
      return (i) => impl(...args.map((f) => f(i)));
    }
    const [a, b, c] = n.args.map(build);
    // A COMPARISON ON A MISSING VALUE ANSWERS NaN, NOT 0. An attribute that
    // is absent is not "not greater than 100"; it is unknown, and `pop > 1000`
    // over a feature with no pop must not quietly file it as a small town.
    // Same reasoning as reading a null as NaN rather than Number(null)'s 0.
    const cmp = (f) => (i) => {
      const x = a(i); const y = b(i);
      return Number.isNaN(x) || Number.isNaN(y) ? NaN : (f(x, y) ? 1 : 0);
    };
    switch (n.op) {
      case ">": return cmp((x, y) => x > y);
      case "<": return cmp((x, y) => x < y);
      case ">=": return cmp((x, y) => x >= y);
      case "<=": return cmp((x, y) => x <= y);
      case "==": return cmp((x, y) => x === y);
      case "!=": return cmp((x, y) => x !== y);
      case "&&": return (i) => { const x = a(i); if (Number.isNaN(x)) return NaN; if (!x) return 0; const y = b(i); return Number.isNaN(y) ? NaN : (y ? 1 : 0); };
      case "||": return (i) => { const x = a(i); if (Number.isNaN(x)) return NaN; if (x) return 1; const y = b(i); return Number.isNaN(y) ? NaN : (y ? 1 : 0); };
      case "?:": return (i) => { const x = a(i); return Number.isNaN(x) ? NaN : (x ? b(i) : c(i)); };
      case "+": return (i) => a(i) + b(i);
      case "-": return (i) => a(i) - b(i);
      case "*": return (i) => a(i) * b(i);
      case "/": return (i) => a(i) / b(i);
      case "%": return (i) => a(i) % b(i);
      case "^": return (i) => a(i) ** b(i);
      case "neg": return (i) => -a(i);
      default: throw new Error(`unknown operator ${n.op}`);
    }
  };
  return build(tree);
}

/**
 * The names the page offers: for each field, its component keys, qualified by
 * the field's alias (the last part of its name) and bare where the key is
 * unique across fields. Answers Map name → { field, component }.
 */
/**
 * An expression over a few NAMED SCALARS, for the calculators that used to
 * reach for `new Function`.
 *
 * WHY THIS EXISTS. Five places in this app evaluated a typed expression by
 * compiling it: the raster calculator, the attribute field calculator, the
 * curve fitter and two Research Hub pages. Each was careful in the way its own
 * comment describes -- the names are bound as parameters, nothing else is in
 * scope -- and each still needed `'unsafe-eval'` in the page's
 * Content-Security-Policy, which is the one permission that turns a string
 * into running code. A policy carrying it cannot claim to stop an injection,
 * because these are precisely the functions an injection would look for.
 *
 * This file's own parser was written for the same problem and its header says
 * why: an expression can be SAVED, shared, and opened by somebody who did not
 * write it. The same answer serves all of them.
 *
 * `names` is what the expression may read. `Math.` is stripped on the way in,
 * because expressions people have already typed say `Math.sqrt(a)` and every
 * one of those functions is here under its bare name.
 */
export function compileScalar(text, names) {
  const tree = parse(String(text ?? "").replace(/\bMath\s*\./g, ""));
  const scope = Object.create(null);
  for (const name of names) scope[name] = NaN;
  const unknown = [...namesIn(tree)].filter((n) => !own(scope, n));
  if (unknown.length) {
    throw new Error(`unknown name '${unknown[0]}' -- this expression may read `
      + (names.length ? names.join(", ") : "no names"));
  }
  const fn = compile(tree, (n) => (own(scope, n) ? () => scope[n] : null));
  return (values) => {
    for (const name of names) {
      const v = values[name];
      // NOT Number(v): Number(null) is 0, so a missing attribute would read as
      // a measured zero. An absent value is not a number and says so.
      scope[name] = v === null || v === undefined || v === "" ? NaN : Number(v);
    }
    return fn(0);
  };
}

export function variableTable(fields) {
  const table = new Map();
  const counts = new Map();
  const aliasOf = (f) => String(f.field).split("/").pop().replace(/[^A-Za-z0-9_]/g, "_");
  fields.forEach((f, fieldIndex) => (f.desc?.components || []).forEach((c) => counts.set(c.key, (counts.get(c.key) || 0) + 1)));
  fields.forEach((f, fieldIndex) => {
    (f.desc?.components || []).forEach((c, component) => {
      const key = String(c.key).replace(/[^A-Za-z0-9_]/g, "_");
      table.set(`${aliasOf(f)}.${key}`, { field: fieldIndex, component, label: c.label });
      if (counts.get(c.key) === 1 && !table.has(key)) table.set(key, { field: fieldIndex, component, label: c.label });
    });
  });
  return table;
}

/**
 * Evaluate over every node. `columns(field, component)` answers a per-node
 * array; `coords` the node coordinates (x, y, z). Answers a Float64Array.
 */
export function evaluate(text, { table, columns, coords, nodeCount }) {
  const tree = parse(text);
  const cache = new Map();
  const f = compile(tree, (name) => {
    if (coords && (name === "x" || name === "y" || name === "z")) {
      const a = { x: 0, y: 1, z: 2 }[name];
      return (i) => coords[i * 3 + a];
    }
    const v = table.get(name);
    if (!v) return null;
    const key = `${v.field}:${v.component}`;
    if (!cache.has(key)) cache.set(key, columns(v.field, v.component));
    const col = cache.get(key);
    return (i) => col[i];
  });
  const out = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i += 1) out[i] = f(i);
  return out;
}
