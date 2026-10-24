/**
 * Uploaded files. The bytes live in R2 (env.MEDIA); the `media` row says who
 * may read them. Every read goes through canReadMedia(), which other modules
 * (reviews, messages) import so the rule is written once.
 *
 * TYPES ARE SNIFFED, NOT TRUSTED. The client's content type and file name are
 * ignored for the stored type: the first bytes decide (images, PDF, MP4/WebM,
 * MP3/M4A, Word .docx). Plain text and CSV have no magic number, so for those
 * the name says which and the bytes must be valid UTF-8 with no NULs and no
 * markup opener. An HTML or SVG file renamed .png or .txt is refused, and
 * every response carries nosniff and a `default-src 'none'` CSP so even a
 * file that slipped through could not run script on this origin.
 *
 * KEPT SMALL ON PURPOSE (v1.4). Big files belong where their owner keeps them
 * -- a Dropbox, Drive or OSF link becomes a card (unfurl.js), a paper or
 * dataset goes to Zenodo with a DOI (zenodo.js) -- so R2 holds what is posted
 * straight into a feed: per-type caps below, a per-member quota, and uploads
 * never attached to anything are swept after a day (sweepOrphans).
 */
import {
  MAX_MEDIA_BYTES, fail, now, str, requireUser, currentUser, avatarUrl, rateLimit, teamRole, isAdmin,
} from "./lib.js";

const SIGNATURES = [
  { type: "image/png", ext: "png", test: (b) => b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  { type: "image/jpeg", ext: "jpg", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/gif", ext: "gif", test: (b) => b.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(b, 0, 6)) },
  { type: "image/webp", ext: "webp", test: (b) => b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  { type: "application/pdf", ext: "pdf", test: (b) => b.length >= 5 && ascii(b, 0, 5) === "%PDF-" },
  // MP4: an ftyp box at byte 4 with a video brand. HEIC/AVIF also start with
  // ftyp but are still images ("heic", "mif1", "avif"), and QuickTime ("qt  ")
  // does not play in Firefox or Chrome -- both are refused here.
  { type: "video/mp4", ext: "mp4", test: (b) => b.length >= 12 && ascii(b, 4, 8) === "ftyp"
      && ["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash", "MSNV"].includes(ascii(b, 8, 12)) },
  // WebM: the EBML magic, with "webm" as its DocType near the start
  // (Matroska .mkv shares the magic but says "matroska" and is refused).
  { type: "video/webm", ext: "webm", test: (b) => b.length >= 32 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf
      && b[3] === 0xa3 && ascii(b, 0, Math.min(64, b.length)).includes("webm") },
  // MP3: an ID3v2 tag, or straight into an MPEG audio frame (11 sync bits,
  // layer III).
  { type: "audio/mpeg", ext: "mp3", test: (b) => (b.length >= 3 && ascii(b, 0, 3) === "ID3")
      || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) === 0x02) },
  // M4A: the same ftyp box as MP4, with an audio brand.
  { type: "audio/mp4", ext: "m4a", test: (b) => b.length >= 12 && ascii(b, 4, 8) === "ftyp" && ["M4A ", "M4B "].includes(ascii(b, 8, 12)) },
  // Word .docx: a ZIP whose first entry names are OOXML's. A macro-enabled
  // file (vbaProject.bin anywhere in the archive) is refused in upload().
  { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx",
    test: (b) => b.length >= 30 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 && isDocx(b) },
];

/** A ZIP that is a Word document: [Content_Types].xml and word/document.xml in its names. */
function isDocx(b) {
  const head = latin1(b, 0, Math.min(b.length, 2 * 1024 * 1024));
  return head.includes("[Content_Types].xml") && head.includes("word/");
}
/** Any VBA project inside a ZIP: the archive's central directory names it. */
export function hasMacros(b) {
  return latin1(b, 0, b.length).includes("vbaProject.bin");
}
function latin1(b, from, to) {
  let out = "";
  for (let i = from; i < to; i += 8192) out += String.fromCharCode(...b.subarray(i, Math.min(to, i + 8192)));
  return out;
}

/**
 * Plain text and CSV, by name, when the bytes are honest text: valid UTF-8
 * (a BOM allowed), no NUL bytes, and nothing that opens markup in the first
 * kilobyte -- a .txt that is really an HTML page is refused, not stored.
 */
export function sniffText(bytes, name) {
  const ext = (String(name || "").toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1];
  const type = ext === "csv" ? "text/csv" : ext === "txt" || ext === "md" ? "text/plain" : null;
  if (!type || !bytes.length) return null;
  if (bytes.includes(0)) return null;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  } catch (error) {
    // A cut through a multi-byte character at 64 KB is not a failure.
    if (bytes.length <= 65536) return null;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 65530)); } catch { text = ""; }
  }
  if (/<\s*(html|script|svg|iframe|body|head|!doctype)\b/i.test(text.slice(0, 1024))) return null;
  return { type, ext: ext === "md" ? "txt" : ext };
}

/** Per-type caps. Anything bigger is a link or a Zenodo deposit, not an upload. */
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export function limitFor(type) {
  if (type.startsWith("video/")) return MAX_VIDEO_BYTES;
  if (type.startsWith("audio/")) return MAX_AUDIO_BYTES;
  if (type.startsWith("text/")) return MAX_TEXT_BYTES;
  return MAX_MEDIA_BYTES;
}
const LINK_HINT = " For anything bigger, share a Dropbox, Drive or OSF link, or publish it to Zenodo.";
function tooBig(type) {
  if (type.startsWith("video/")) return "Videos are at most 40 MB — trim it, or post a YouTube or Vimeo link instead.";
  if (type.startsWith("audio/")) return `Audio files are at most 15 MB.${LINK_HINT}`;
  if (type.startsWith("text/")) return `Text and CSV files are at most 5 MB.${LINK_HINT}`;
  return `Images, PDFs and Word files are at most 8 MB.${LINK_HINT}`;
}

/** The member's storage quota in bytes: MEDIA_QUOTA_MB (default 500), none for admins. */
export function quotaFor(env, user) {
  if (user && isAdmin(env, user)) return Infinity;
  const mb = Number(env.MEDIA_QUOTA_MB || 500);
  return (Number.isFinite(mb) && mb > 0 ? mb : 500) * 1024 * 1024;
}
export async function usedBytes(env, userId) {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM media WHERE owner_id = ?").bind(userId).first();
  return Number(row?.n || 0);
}

function ascii(bytes, from, to) {
  return String.fromCharCode(...bytes.slice(from, to));
}

/** { type, ext } from the magic bytes, or null. */
export function sniff(bytes) {
  const found = SIGNATURES.find((s) => s.test(bytes));
  return found ? { type: found.type, ext: found.ext } : null;
}

/**
 * May `user` (a user row or null) read the media `row`? Exactly the scopes
 * CONTRACT.md lists; anything unrecognised is refused. The owner can always
 * read their own upload.
 */
export async function canReadMedia(env, user, row) {
  if (!row) return false;
  const scope = String(row.scope || "");
  if (scope === "public") return true;
  if (!user) return false;
  if (row.owner_id === user.id) return true;
  const [kind, ref] = [scope.split(":")[0], scope.slice(scope.indexOf(":") + 1)];
  if (!scope.includes(":") || !ref) return false;
  if (kind === "review") {
    const review = await env.DB.prepare("SELECT requester_id FROM reviews WHERE id = ?").bind(ref).first();
    if (!review) return false;
    if (review.requester_id === user.id) return true;
    // A declined reviewer has said no; the draft is not theirs to keep reading.
    const reviewer = await env.DB.prepare(
      "SELECT 1 FROM reviewers WHERE review_id = ? AND user_id = ? AND status != 'declined'",
    ).bind(ref, user.id).first();
    return !!reviewer;
  }
  if (kind === "team") return !!(await teamRole(env, ref, user.id));
  if (kind === "conversation") {
    const member = await env.DB.prepare(
      "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND status IN ('active', 'request')",
    ).bind(ref, user.id).first();
    return !!member;
  }
  return false;
}

/**
 * The scope an uploader asked for, checked: they may only scope a file to a
 * team or conversation they are in, or a review they requested. Default
 * public, because most uploads are post images drawn for everybody.
 */
async function scopeFor(env, user, wanted) {
  const scope = str(wanted, 120) || "public";
  if (scope === "public" || scope === "owner") return scope;
  const [kind, ref] = [scope.split(":")[0], scope.slice(scope.indexOf(":") + 1)];
  if (!scope.includes(":") || !ref) fail(400, "scope is public, owner, team:<id>, conversation:<id> or review:<id>.");
  if (kind === "team") {
    if (!(await teamRole(env, ref, user.id))) fail(403, "You are not in that team.");
    return scope;
  }
  if (kind === "conversation") {
    const member = await env.DB.prepare(
      "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
    ).bind(ref, user.id).first();
    if (!member) fail(403, "You are not in that conversation.");
    return scope;
  }
  if (kind === "review") {
    const review = await env.DB.prepare("SELECT requester_id FROM reviews WHERE id = ?").bind(ref).first();
    if (!review || review.requester_id !== user.id) fail(403, "Only the requester can attach a draft to a review.");
    return scope;
  }
  return fail(400, "scope is public, owner, team:<id>, conversation:<id> or review:<id>.");
}

function randomHex(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function upload(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  // Refuse an oversized body before reading it; the multipart envelope adds
  // a little, hence the slack.
  const declared = Number(ctx.request.headers.get("content-length") || 0);
  if (declared > MAX_VIDEO_BYTES + 64 * 1024) fail(413, tooBig("video/"));
  let form;
  try {
    form = await ctx.request.formData();
  } catch (error) {
    fail(400, "Send the file as multipart form data.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") fail(400, "Attach a file as `file`.");
  if (file.size > MAX_VIDEO_BYTES) fail(413, tooBig("video/"));
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) fail(400, "That file is empty.");
  const kind = sniff(bytes) || sniffText(bytes, file.name);
  if (!kind) {
    fail(400, "Upload images (PNG, JPEG, WebP, GIF), PDFs, Word .docx, MP4 or WebM video, MP3 or M4A audio, "
      + "or .txt and .csv files. Anything else can be shared as a link.");
  }
  if (bytes.length > limitFor(kind.type)) fail(413, tooBig(kind.type));
  if (kind.ext === "docx" && hasMacros(bytes)) fail(400, "Word files with macros can't be shared. Save it as a plain .docx first.");
  const quota = quotaFor(env, user);
  if (quota !== Infinity && (await usedBytes(env, user.id)) + bytes.length > quota) {
    fail(413, `That would take you past your ${Math.round(quota / 1048576)} MB of uploads. Delete old files in Settings, or share this one as a link.`);
  }
  const scope = await scopeFor(env, user, form.get("scope"));
  // The owner's id (not handle) in the key: a handle can change, a key can't.
  const key = `m/${user.id}/${randomHex(12)}.${kind.ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: kind.type } });
  await env.DB.prepare(
    "INSERT INTO media (key, owner_id, type, bytes, name, scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(key, user.id, kind.type, bytes.length, str(file.name, 120), scope, now()).run();
  return { key, url: avatarUrl(env, key), type: kind.type, bytes: bytes.length, name: str(file.name, 120), scope, alt: str(form.get("alt"), 500) };
}

async function serve(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const row = await env.DB.prepare("SELECT * FROM media WHERE key = ?").bind(ctx.params.key).first();
  // 404 for "not yours" as for "not there": a key must not be probeable.
  if (!(await canReadMedia(env, viewer, row))) fail(404, "Not found.");
  const inline = row.type.startsWith("image/") || row.type.startsWith("video/") || row.type.startsWith("audio/")
    || row.type === "text/plain";
  // The uploader's own name for it (cleaned), so a download saves sensibly.
  const ext = row.key.split(".").pop();
  const base = String(row.name || "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\w .-]+/g, "").trim().slice(0, 80) || row.key.split("/").pop().split(".")[0];
  const filename = `${base}.${ext}`;
  const headers = {
    "content-type": row.type.startsWith("text/") ? `${row.type}; charset=utf-8` : row.type,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'",
    // Public files may be cached anywhere; scoped ones only by the reader.
    "cache-control": row.scope === "public" ? "public, max-age=86400, immutable" : "private, no-store",
  };
  // RANGES, because a <video> asks for them: seeking, and Safari will not
  // play at all without a 206. One range only ("bytes=a-b", "a-", "-n").
  const range = parseRange(ctx.request.headers.get("Range"), row.bytes);
  if (range === "bad") {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${row.bytes}` } });
  }
  const object = await env.MEDIA.get(row.key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!object) fail(404, "Not found.");
  if (range) {
    return new Response(object.body, {
      status: 206,
      headers: { ...headers, "content-length": String(range.end - range.start + 1), "content-range": `bytes ${range.start}-${range.end}/${row.bytes}` },
    });
  }
  return new Response(object.body, { status: 200, headers: { ...headers, "content-length": String(row.bytes) } });
}

/** One byte range from a Range header: {start, end} inclusive, null for none, "bad" for unsatisfiable. */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start; let end;
  if (!m[1]) { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (!(start <= end) || start >= size) return "bad";
  return { start, end };
}

async function remove(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const row = await env.DB.prepare("SELECT * FROM media WHERE key = ?").bind(ctx.params.key).first();
  if (!(await canReadMedia(env, user, row))) fail(404, "Not found.");
  if (row.owner_id !== user.id) fail(403, "Only the uploader can delete a file.");
  await env.MEDIA.delete(row.key);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM media WHERE key = ?").bind(row.key),
    env.DB.prepare("UPDATE users SET avatar_key = '' WHERE id = ? AND avatar_key = ?").bind(user.id, row.key),
  ]);
  return { ok: true };
}

/** GET /v1/me/storage -- what the member has uploaded, against their quota. */
async function storage(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const rows = (await env.DB.prepare(
    "SELECT key, type, bytes, name, scope, created_at FROM media WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200",
  ).bind(user.id).all()).results || [];
  const quota = quotaFor(env, user);
  return {
    used: await usedBytes(env, user.id),
    quota: quota === Infinity ? null : quota,
    files: rows.map((r) => ({ ...r, url: avatarUrl(env, r.key) })),
  };
}

/**
 * Uploads never attached to anything, swept a day on (cron.js, daily). Only
 * public/owner-scoped files are candidates -- team, conversation and review
 * files are attached by being scoped -- and a key still named by a post, an
 * avatar or an organisation logo stays. Returns how many went.
 */
export async function sweepOrphans(env, t, { olderThan = 86400, limit = 200 } = {}) {
  const rows = (await env.DB.prepare(
    `SELECT m.key FROM media m
      WHERE m.scope IN ('public', 'owner') AND m.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_key = m.key)
        AND NOT EXISTS (SELECT 1 FROM orgs o WHERE o.logo_key = m.key)
        AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.media_json LIKE '%' || m.key || '%')
      LIMIT ?`,
  ).bind(t - olderThan, limit).all()).results || [];
  for (const r of rows) {
    await env.MEDIA.delete(r.key);
    await env.DB.prepare("DELETE FROM media WHERE key = ?").bind(r.key).run();
  }
  return { swept: rows.length };
}

export const routes = [
  ["GET", "/v1/me/storage", storage],
  ["POST", "/v1/media", upload],
  ["GET", "/v1/media/:key", serve],
  ["DELETE", "/v1/media/:key", remove],
];
