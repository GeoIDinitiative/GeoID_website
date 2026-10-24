/**
 * Postings out of careers pages and calendars -- the Atlas Career Scanner's
 * extraction (~/atlas-ai/hub/builtin_agents/_ats.py), ported to the Worker.
 *
 * Most careers pages are one of a dozen applicant-tracking systems with a
 * clean JSON API behind the JavaScript, so each gets a real adapter; anything
 * else falls back to schema.org JobPosting/Event blocks, then to harvesting
 * job-shaped links out of the HTML, with one hop toward the real listing when
 * a configured URL is only a landing page. Calendars: iCalendar feeds and
 * schema.org Event blocks.
 *
 * Every function takes `fetcher` so node tests run it against canned pages
 * (test/reach.test.mjs). No DOM here -- the Worker has none -- so markup is
 * read with bounded regexes, which is all a new-posting detector needs: a
 * stable URL and a plausible title.
 */

const UA = "Mozilla/5.0 (compatible; GeoIDNetworkBot/1.0; +https://geoidinitiative.com/social/)";
const HEADERS = { "user-agent": UA, "accept-language": "en-GB,en;q=0.9" };
const MAX_PER_SOURCE = 300;
const MAX_HTML = 1024 * 1024;

const clean = (t) => String(t || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d) || 32))
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
export const normUrl = (u) => String(u || "").split("#")[0].replace(/\/+$/, "").toLowerCase();
const join = (base, href) => { try { return new URL(href, base).toString(); } catch { return ""; } };
const host = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const pathOf = (u) => { try { return new URL(u).pathname.toLowerCase(); } catch { return ""; } };
const slug = (u) => (pathOf(u).split("/").filter(Boolean)[0] || "");

async function getJson(fetcher, url, init = {}) {
  const r = await fetcher(url, { ...init, headers: { ...HEADERS, accept: "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function getText(fetcher, url) {
  const r = await fetcher(url, { headers: HEADERS, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { body: (await r.text()).slice(0, MAX_HTML), url: r.url || url };
}

// ── Platform detection ─────────────────────────────────────────────────────

export function detectPlatform(url) {
  const h = host(url), p = pathOf(url);
  if (h.includes("myworkdayjobs.com") || p.includes("/wday/")) return "workday";
  if (h.includes("greenhouse.io")) return "greenhouse";
  if (h.includes("lever.co")) return "lever";
  if (h.includes("ashbyhq.com")) return "ashby";
  if (h.includes("smartrecruiters.com")) return "smartrecruiters";
  if (h.includes("recruitee.com")) return "recruitee";
  if (h.includes("workable.com")) return "workable";
  if (h.includes("jobs.personio") || h.includes("personio.de")) return "personio";
  if (h.endsWith("jobs.ac.uk") && p.startsWith("/search")) return "jobsacuk";
  if (/\.ics(\?|$)/.test(p) || /webcal:/.test(url)) return "ics";
  return "html";
}

// ── ATS adapters ───────────────────────────────────────────────────────────

const ADAPTERS = {
  async workday(fetcher, url) {
    const u = new URL(url);
    const tenant = u.hostname.split(".")[0];
    const parts = u.pathname.split("/").filter(Boolean).filter((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s));
    const site = parts[0];
    if (!site) return [];
    const api = `https://${u.hostname}/wday/cxs/${tenant}/${site}/jobs`;
    const out = [];
    for (let page = 0; page < 5; page += 1) {
      const data = await getJson(fetcher, api, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: page * 20, searchText: "" }) });
      const list = data?.jobPostings || [];
      for (const j of list) {
        out.push({ title: clean(j.title), url: `https://${u.hostname}/en-US/${site}${j.externalPath || ""}`, location: clean(j.locationsText), posted: clean(j.postedOn) });
      }
      if (list.length < 20) break;
    }
    return out;
  },
  async greenhouse(fetcher, url) {
    const token = (/[?&]for=([\w-]+)/.exec(url) || [])[1] || slug(url);
    const data = await getJson(fetcher, `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`);
    return (data?.jobs || []).map((j) => ({ title: clean(j.title), url: j.absolute_url || "", location: clean(j.location?.name), posted: String(j.updated_at || "").slice(0, 10) }));
  },
  async lever(fetcher, url) {
    const data = await getJson(fetcher, `https://api.lever.co/v0/postings/${slug(url)}?mode=json`);
    return (Array.isArray(data) ? data : []).map((j) => ({ title: clean(j.text), url: j.hostedUrl || "", location: clean(j.categories?.location), posted: "" }));
  },
  async ashby(fetcher, url) {
    const data = await getJson(fetcher, `https://api.ashbyhq.com/posting-api/job-board/${slug(url)}`);
    return (data?.jobs || []).map((j) => ({ title: clean(j.title), url: j.jobUrl || "", location: clean(j.location), posted: String(j.publishedAt || "").slice(0, 10) }));
  },
  async smartrecruiters(fetcher, url) {
    const company = slug(url);
    const data = await getJson(fetcher, `https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=100`);
    return (data?.content || []).map((j) => ({ title: clean(j.name), url: j.applyUrl || `https://jobs.smartrecruiters.com/${company}/${j.id}`,
      location: clean([j.location?.city, j.location?.country].filter(Boolean).join(", ")), posted: String(j.releasedDate || "").slice(0, 10) }));
  },
  async recruitee(fetcher, url) {
    const data = await getJson(fetcher, `https://${host(url)}/api/offers/`);
    return (data?.offers || []).map((j) => ({ title: clean(j.title), url: j.careers_url || j.careers_apply_url || "", location: clean(j.location), posted: String(j.published_at || "").slice(0, 10) }));
  },
  async workable(fetcher, url) {
    const data = await getJson(fetcher, `https://apply.workable.com/api/v1/widget/accounts/${slug(url)}?details=true`);
    return (data?.jobs || []).map((j) => ({ title: clean(j.title), url: j.url || j.application_url || "", location: clean([j.city, j.country].filter(Boolean).join(", ")), posted: String(j.published_on || "").slice(0, 10) }));
  },
  async personio(fetcher, url) {
    const h = host(url);
    const { body } = await getText(fetcher, `https://${h}/xml`);
    const out = [];
    for (const m of body.matchAll(/<position>([\s\S]*?)<\/position>/g)) {
      const g = (tag) => clean((new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(m[1]) || [])[1]);
      const id = g("id");
      out.push({ title: g("name"), url: id ? `https://${h}/job/${id}` : `https://${h}`, location: g("office"), posted: g("createdAt").slice(0, 10) });
    }
    return out;
  },
};

// ── Job boards ─────────────────────────────────────────────────────────────

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "22 Dec" (no year, as boards print it) -> the next 22 December on or after `from`, as YYYY-MM-DD. */
export function dayMonthAhead(text, from = new Date()) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?(?:\s+(\d{4}))?/.exec(String(text || ""));
  if (!m || MONTHS[m[2].toLowerCase()] === undefined) return "";
  const day = Number(m[1]), mon = MONTHS[m[2].toLowerCase()];
  let year = m[3] ? Number(m[3]) : from.getUTCFullYear();
  const today = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  if (!m[3] && Date.UTC(year, mon, day) < today) year += 1;
  return new Date(Date.UTC(year, mon, day)).toISOString().slice(0, 10);
}

/**
 * A jobs.ac.uk search results page. Each result is a block with the advert
 * link and title, department, employer, location, salary and closing date.
 * The board's own discipline filter (in the source URL) has already chosen
 * the field, so postings carry `board` and the importer trusts that filter.
 */
export function parseJobsAcUk(html, base, from = new Date()) {
  const out = [];
  const blocks = String(html || "").split(/<div class="j-search-result__result\b/).slice(1);
  for (const b of blocks) {
    const a = /<a href="(\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!a) continue;
    const pick = (re) => clean((re.exec(b) || [])[1]);
    out.push({
      title: clean(a[2]),
      url: join(base, a[1]).split("?")[0],
      org: pick(/j-search-result__employer">\s*(?:<b>)?([\s\S]*?)(?:<\/b>)?\s*<\/div>/),
      department: pick(/j-search-result__department">([\s\S]*?)<\/div>/),
      location: pick(/<div>\s*Location:([\s\S]*?)<\/div>/),
      salary: pick(/Salary:\s*<\/strong>([\s\S]*?)<\/div>/).replace(/\s*-\s*please see advert/i, "").trim(),
      deadline: dayMonthAhead(pick(/j-search-result__date--blue[^"]*">([\s\S]*?)<\/span>/), from),
      posted: dayMonthAhead(pick(/Date Placed:\s*<\/strong>([\s\S]*?)<\/div>/), new Date(from.getTime() - 300 * 86400000)),
      board: "jobs.ac.uk",
    });
  }
  return out;
}

const BOARD_PAGES = 3;          // 25 a page: the newest 75, once a day

ADAPTERS.jobsacuk = async (fetcher, url) => {
  const out = [];
  for (let page = 0; page < BOARD_PAGES; page += 1) {
    const u = new URL(url);
    u.searchParams.set("sortOrder", "1");
    u.searchParams.set("startIndex", String(1 + page * 25));
    const { body, url: final } = await getText(fetcher, u.toString());
    const got = parseJobsAcUk(body, final);
    out.push(...got);
    if (got.length < 25) break;
  }
  return out;
};

// ── HTML fallback (the scanner's heuristics, verbatim in spirit) ───────────

const JOB_HREF = /(\/job[/-]|\/jobs\/|\/jobdetail|\/job_detail|\/vacanc|\/position\/|\/opening\/|\/career(s)?\/[^/]+\/|gh_jid=|\/search-jobs\/\d|\/en\/job\/|\/stelle|\/offre|\/stilling|\/ledige|\/lavora)/i;
const NOT_JOB = /(mailto:|javascript:|\/search\/?$|\/jobs\/?$|\/job-alert|\/alerts|\/login|\/signin|\/register|\/saved|\/privacy|\/cookie|\/faq|\/rss|\/feed|\.pdf$|\.jpe?g$|\.png$|#$)/i;
const NAV_TEXT = /^(search|browse|explore|view|see|show|find|read|learn|apply|sign|join|back|next|previous|more|all|home|careers?|jobs?|vacanc\w*|opportunit\w*|our\b|life at|working at|work (for|with|at)|why\b|about\b|filter|sort|share|save|email|print|skip|click|discover|meet\b|current\b)/i;
const EVENT_HREF = /(\/events?\/[^/?#]+|\/meetings?\/[^/?#]+|\/conferences?\/[^/?#]+|\/workshops?\/[^/?#]+|\/webinars?\/[^/?#]+)/i;

export function looksLikeDetail(href) {
  if (/\d{3,}/.test(href)) return true;
  const tail = href.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() || "";
  return (tail.match(/-/g) || []).length >= 2;
}
export function plausibleTitle(text) {
  if (!(text.length >= 8 && text.length <= 160) || text.split(" ").length < 2) return false;
  if (NAV_TEXT.test(text)) return false;
  return /[A-Za-z]{3}/.test(text);
}

/** (href, title) for every <a>; a heading inside the link is the title. */
export function anchors(html) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]{0,4000}?)<\/a>/gi)) {
    const href = (/href\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1];
    if (!href) continue;
    const head = (/<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/i.exec(m[2]) || [])[1];
    out.push([href.replace(/&amp;/g, "&"), clean(head) || clean(m[2])]);
  }
  return out;
}

export function jsonLd(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1].trim())); } catch { /* a broken block is skipped */ }
  }
  return out;
}

/** schema.org nodes of the given types, walking lists, @graph and itemListElement. */
function nodesOf(blocks, types) {
  const found = [];
  const want = new Set(types.map((t) => t.toLowerCase()));
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const t = [].concat(node["@type"] || []).map((x) => String(x).toLowerCase());
    if (t.some((x) => want.has(x))) found.push(node);
    for (const k of ["@graph", "itemListElement"]) if (node[k]) walk(node[k]);
    if (node.item) walk(node.item);
  };
  blocks.forEach(walk);
  return found;
}

export function jobsFromJsonLd(blocks, base) {
  return nodesOf(blocks, ["JobPosting"]).map((n) => {
    const loc = [].concat(n.jobLocation || [])[0] || {};
    return { title: clean(n.title), url: join(base, n.url || n["@id"] || ""), location: clean(loc.address?.addressLocality || ""),
      posted: String(n.datePosted || "").slice(0, 10), deadline: String(n.validThrough || "").slice(0, 10) };
  }).filter((j) => j.title && j.url);
}

export function eventsFromJsonLd(blocks, base) {
  return nodesOf(blocks, ["Event", "EducationEvent", "BusinessEvent", "SocialEvent", "ExhibitionEvent", "Hackathon", "CourseInstance"]).map((n) => {
    const loc = [].concat(n.location || [])[0] || {};
    const virtual = /online|virtual/i.test(String(n.eventAttendanceMode || "")) || loc["@type"] === "VirtualLocation";
    return { title: clean(n.name), url: join(base, n.url || n["@id"] || ""), starts: String(n.startDate || ""), ends: String(n.endDate || ""),
      location: virtual ? "Online" : clean(loc.name || loc.address?.addressLocality || (typeof loc.address === "string" ? loc.address : "")),
      description: clean(n.description).slice(0, 600) };
  }).filter((e) => e.title && e.url && e.starts);
}

export function harvestJobs(html, base) {
  const out = new Map();
  for (const [href, text] of anchors(html)) {
    if (!JOB_HREF.test(href) || NOT_JOB.test(href)) continue;
    if (!looksLikeDetail(href) || !plausibleTitle(text)) continue;
    const full = join(base, href);
    if (full && !out.has(normUrl(full))) out.set(normUrl(full), { title: text, url: full, location: "", posted: "" });
  }
  return [...out.values()];
}

export function harvestEventLinks(html, base) {
  const out = new Map();
  const origin = host(base);
  for (const [href, text] of anchors(html)) {
    if (!EVENT_HREF.test(href) || NOT_JOB.test(href) || !plausibleTitle(text)) continue;
    const full = join(base, href);
    if (!full || host(full) !== origin) continue;
    if (!out.has(normUrl(full))) out.set(normUrl(full), full);
  }
  return [...out.values()].slice(0, 40);
}

const LISTING_HINT = /(vacanc|job|career|opportunit|position|recruit|employment|opening|stilling|ledige|offre|lavora|empleo|stelle)/i;
const LISTING_STRONG = /(vacanc|job|opening|position|stilling|ledige)/i;
export function hopCandidates(html, base) {
  const scored = [];
  const seen = new Set([normUrl(base)]);
  for (const [href, text] of anchors(html)) {
    if (NOT_JOB.test(href)) continue;
    const full = join(base, href);
    const key = normUrl(full);
    if (!full || seen.has(key) || host(full) !== host(base)) continue;
    const blob = `${href} ${text}`;
    if (!LISTING_HINT.test(blob)) continue;
    seen.add(key);
    let s = LISTING_STRONG.test(href) ? 2 : 0;
    s += LISTING_STRONG.test(text) ? 2 : 0;
    s += /(search|current|all|open|list|browse)/i.test(blob) ? 1 : 0;
    scored.push([s, full]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 2).map((x) => x[1]);
}

// ── iCalendar ──────────────────────────────────────────────────────────────

function icsTime(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(String(v || "").trim());
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000);
}
export function parseIcs(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur?.SUMMARY && cur.DTSTART) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).split(";")[0].toUpperCase();
    const val = line.slice(i + 1).replace(/\\n/g, " ").replace(/\\([,;\\])/g, "$1");
    if (!(key in cur)) cur[key] = val;
  }
  return out.map((e) => ({ title: clean(e.SUMMARY), url: e.URL || "", startsAt: icsTime(e.DTSTART), endsAt: icsTime(e.DTEND),
    location: clean(e.LOCATION), description: clean(e.DESCRIPTION).slice(0, 600), uid: e.UID || "" })).filter((e) => e.startsAt);
}

// ── Entry points ───────────────────────────────────────────────────────────

/** Job postings for a source URL: {platform, postings}. */
export async function fetchJobs(fetcher, url) {
  const platform = detectPlatform(url);
  if (ADAPTERS[platform]) return { platform, postings: (await ADAPTERS[platform](fetcher, url)).slice(0, MAX_PER_SOURCE) };
  const tryPage = async (u) => {
    const { body, url: final } = await getText(fetcher, u);
    const structured = jobsFromJsonLd(jsonLd(body), final);
    if (structured.length) return { platform: "jsonld", postings: structured, body, final };
    return { platform: "html", postings: harvestJobs(body, final), body, final };
  };
  const first = await tryPage(url);
  if (first.postings.length) return { platform: first.platform, postings: first.postings.slice(0, MAX_PER_SOURCE) };
  for (const hop of hopCandidates(first.body, first.final)) {
    try {
      const next = await tryPage(hop);
      if (next.postings.length) return { platform: `${next.platform}·hop`, postings: next.postings.slice(0, MAX_PER_SOURCE) };
    } catch { /* the next candidate */ }
  }
  return { platform: "html", postings: [] };
}

/** Events for a source URL: an .ics feed, or schema.org Events (on the page, else on its event links). */
export async function fetchEvents(fetcher, url, { maxDetail = 12 } = {}) {
  if (detectPlatform(url) === "ics") {
    const { body } = await getText(fetcher, url.replace(/^webcal:/, "https:"));
    return { platform: "ics", events: parseIcs(body) };
  }
  const { body, url: final } = await getText(fetcher, url);
  const toEvent = (e) => ({ ...e, startsAt: Math.floor(Date.parse(e.starts) / 1000) || null, endsAt: e.ends ? Math.floor(Date.parse(e.ends) / 1000) || null : null });
  const onPage = eventsFromJsonLd(jsonLd(body), final).map(toEvent).filter((e) => e.startsAt);
  if (onPage.length) return { platform: "jsonld", events: onPage };
  // A listing that only links to its events: read a few detail pages for their blocks.
  const out = [];
  for (const link of harvestEventLinks(body, final).slice(0, maxDetail)) {
    try {
      const page = await getText(fetcher, link);
      for (const e of eventsFromJsonLd(jsonLd(page.body), page.url).map(toEvent)) if (e.startsAt) out.push(e);
    } catch { /* skip that one */ }
  }
  return { platform: out.length ? "jsonld·detail" : "html", events: out };
}
