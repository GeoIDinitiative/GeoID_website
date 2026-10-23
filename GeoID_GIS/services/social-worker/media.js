/**
 * Uploaded files. The bytes live in R2 (env.MEDIA); the `media` row says who
 * may read them. Every read goes through canReadMedia(), which other modules
 * (reviews, messages) import so the rule is written once.
 *
 * TYPES ARE SNIFFED, NOT TRUSTED. The client's content type and file name are
 * ignored for the stored type: the first bytes decide, and only PNG, JPEG,
 * WebP, GIF and PDF pass. An HTML or SVG file renamed .png is refused, and
 * every response carries nosniff and a `default-src 'none'` CSP so even a
 * file that slipped through could not run script on this origin.
 */
import {
  MAX_MEDIA_BYTES, fail, now, str, requireUser, currentUser, avatarUrl, rateLimit, teamRole,
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
];

/** Videos may be larger than other files; everything else keeps the 8 MB rule. */
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const limitFor = (type) => (type.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_MEDIA_BYTES);
const tooBig = (type) => (type.startsWith("video/") ? "Videos are at most 40 MB — trim it, or post a YouTube or Vimeo link instead." : "Images and PDFs are at most 8 MB.");

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
  const kind = sniff(bytes);
  if (!kind) fail(400, "Only PNG, JPEG, WebP and GIF images, MP4 and WebM videos, and PDF files can be uploaded.");
  if (bytes.length > limitFor(kind.type)) fail(413, tooBig(kind.type));
  const scope = await scopeFor(env, user, form.get("scope"));
  // The owner's id (not handle) in the key: a handle can change, a key can't.
  const key = `m/${user.id}/${randomHex(12)}.${kind.ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: kind.type } });
  await env.DB.prepare(
    "INSERT INTO media (key, owner_id, type, bytes, name, scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(key, user.id, kind.type, bytes.length, str(file.name, 120), scope, now()).run();
  return { key, url: avatarUrl(env, key), type: kind.type, bytes: bytes.length, scope, alt: str(form.get("alt"), 500) };
}

async function serve(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const row = await env.DB.prepare("SELECT * FROM media WHERE key = ?").bind(ctx.params.key).first();
  // 404 for "not yours" as for "not there": a key must not be probeable.
  if (!(await canReadMedia(env, viewer, row))) fail(404, "Not found.");
  const inline = row.type.startsWith("image/") || row.type.startsWith("video/");
  const filename = `${row.key.split("/").pop()}`;
  const headers = {
    "content-type": row.type,
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

export const routes = [
  ["POST", "/v1/media", upload],
  ["GET", "/v1/media/:key", serve],
  ["DELETE", "/v1/media/:key", remove],
];
