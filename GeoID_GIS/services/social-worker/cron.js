/**
 * The scheduled jobs. worker.js's `scheduled()` hands every cron tick here.
 *
 * Two triggers (wrangler.toml [triggers] crons):
 *   "*\/15 * * * *"  event reminders -> the immediate-mail queue -> daily digests
 *                    (digests only from DIGEST_HOUR_UTC, default 07:00, so they
 *                    arrive in the morning in Europe and are at most one a day)
 *   "17 3 * * *"     housekeeping: prune old rows, refresh badges for members
 *                    whose work saw activity in the last two days
 * Any other cron string (a `wrangler dev --test-scheduled` poke) runs the
 * 15-minute set, which is safe to run as often as anyone likes.
 *
 * Each job is run on its own and a failure is logged, not thrown, so a broken
 * job never stops the others; the report is returned for logs and tests.
 */
import { notify, now, str, int } from "./lib.js";
import { all, one, run } from "./collab.js";
import { flushQueue, sendDigests, pruneMail } from "./mail.js";
import { sweepOrphans } from "./media.js";
import { sendWeekly, weeklyDue } from "./reach.js";
import { checkins } from "./officehours.js";
import { runImports } from "./importer.js";
import { routes as reputationRoutes } from "./reputation.js";
// A namespace import, so this file works before events.js grows dueReminders.
import * as events from "./events.js";

export const FREQUENT = "*/15 * * * *";
export const DAILY = "17 3 * * *";

const DAY = 86400;

async function job(report, name, fn) {
  try {
    report[name] = await fn();
  } catch (error) {
    console.error(`cron ${name}`, error && (error.stack || error.message));
    report[name] = { error: String(error && error.message || error) };
  }
}

/**
 * Event reminders: events.js decides which (user, event) pairs are due
 * (dueReminders) and records that they went (markReminded, when it exports
 * one); each becomes an "event" notification (and so, for members who chose
 * it, an email). A reminder with the same text for the same event in the
 * last two days is not repeated, which keeps this safe even if a pair comes
 * back twice.
 */
export async function reminders(env, t, mod = events) {
  if (typeof mod.dueReminders !== "function") return { skipped: "events.dueReminders is not there yet" };
  const due = await mod.dueReminders(env, t);
  let sent = 0;
  let repeated = 0;
  for (const item of Array.isArray(due) ? due : []) {
    if (!item) continue;
    const userId = item.user_id || item.userId || (typeof item.user === "string" ? item.user : item.user && item.user.id);
    if (!userId) continue;
    const refType = str(item.ref_type || (item.post_id ? "post" : "event"), 20);
    const refId = str(item.ref_id || item.event_id || item.post_id || item.id || "", 60);
    const title = str(item.title, 120);
    const text = str(item.text || (title ? `Starting soon: ${title}` : "An event you are going to starts soon"), 200);
    const seen = await one(env,
      "SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'event' AND ref_type = ? AND ref_id = ? AND text = ? AND created_at > ?",
      userId, refType, refId, text, t - 2 * DAY);
    if (seen) { repeated += 1; continue; }
    await notify(env, userId, "event", null, refType, refId, text);
    sent += 1;
  }
  if (typeof mod.markReminded === "function" && Array.isArray(due) && due.length) {
    await mod.markReminded(env, due.filter((i) => i && i.user_id), t);
  }
  return { sent, repeated };
}

/** Rows nothing reads any more. */
export async function prune(env, t) {
  const changes = (r) => Number(r?.meta?.changes || 0);
  return {
    // rateLimit() only ever reads the current minute.
    rate: changes(await run(env, "DELETE FROM rate WHERE minute < ?", Math.floor(t / 60) - 60)),
    notifications: changes(await run(env, "DELETE FROM notifications WHERE read = 1 AND created_at < ?", t - 180 * DAY)),
    mail: await pruneMail(env, t),
  };
}

/**
 * Badges are awarded when a member asks (/v1/badges/refresh) -- but much of
 * the evidence is other people's doing (a verification, a fork, an accepted
 * answer), so the daily run re-checks the people whose work saw activity in
 * the last two days. It calls the route's own handler with the member already
 * resolved, so the award rules stay in reputation.js and only there.
 */
export async function refreshBadges(env, t, { limit = 100 } = {}) {
  const route = reputationRoutes.find(([method, path]) => method === "POST" && path === "/v1/badges/refresh");
  if (!route) return { skipped: "no refresh route" };
  const since = t - 2 * DAY;
  const ids = (await all(env,
    `SELECT DISTINCT uid FROM (
        SELECT author_id AS uid FROM posts WHERE created_at > ? OR updated_at > ?
        UNION SELECT author_id FROM comments WHERE created_at > ?
        UNION SELECT p.author_id FROM verifications v JOIN posts p ON p.id = v.post_id WHERE v.created_at > ?
        UNION SELECT p.author_id FROM reactions r JOIN posts p ON p.id = r.post_id WHERE r.created_at > ?
        UNION SELECT p.author_id FROM posts f JOIN posts p ON p.id = f.forked_from WHERE f.created_at > ?
        UNION SELECT c.author_id FROM posts p JOIN comments c ON c.id = p.accepted_comment_id WHERE p.updated_at > ?
        UNION SELECT user_id FROM reviewers WHERE submitted_at > ?
        UNION SELECT id FROM users WHERE updated_at > ?
     ) LIMIT ?`, since, since, since, since, since, since, since, since, since, limit)).map((r) => r.uid);
  let checked = 0;
  let awarded = 0;
  for (const uid of ids) {
    const user = await one(env, "SELECT * FROM users WHERE id = ? AND email NOT LIKE 'erased:%'", uid);
    if (!user || user.suspended_until > t) continue;
    try {
      const result = await route[2]({
        env, _user: user, request: new Request("https://cron.internal/v1/badges/refresh", { method: "POST" }),
        url: new URL("https://cron.internal/v1/badges/refresh"), params: {}, head: {},
      });
      checked += 1;
      awarded += (result && result.awarded || []).length;
    } catch (error) {
      console.error("cron badge refresh", uid, error && error.message);
    }
  }
  return { checked, awarded };
}

/** Run the jobs for one tick. `t` is epoch seconds. */
export async function runJobs(cron, env, t = now(), { fetchImpl = fetch, mod = events } = {}) {
  const report = { cron };
  if (cron === DAILY) {
    await job(report, "prune", () => prune(env, t));
    await job(report, "badges", () => refreshBadges(env, t));
    await job(report, "orphans", () => sweepOrphans(env, t));
    await job(report, "checkins", () => checkins(env, t));
    return report;
  }
  await job(report, "reminders", () => reminders(env, t, mod));
  await job(report, "mail", () => flushQueue(env, t, { fetchImpl }));
  const hour = new Date(t * 1000).getUTCHours();
  if (hour >= int(env.DIGEST_HOUR_UTC, 7)) await job(report, "digests", () => sendDigests(env, t, { fetchImpl }));
  if (weeklyDue(t, int(env.DIGEST_HOUR_UTC, 7))) await job(report, "weekly", () => sendWeekly(env, t, { fetchImpl }));
  // Imported opportunities and events: a few sources per tick (IMPORTS=0 turns it off).
  if (String(env.IMPORTS ?? "1") !== "0") await job(report, "imports", () => runImports(env, t, { fetcher: fetchImpl }));
  return report;
}

/** worker.js: `scheduled(event, env, ctx)`. */
export async function scheduled(event, env, ctx) {
  const t = Math.floor((event && event.scheduledTime ? event.scheduledTime : Date.now()) / 1000);
  const work = runJobs(event && event.cron, env, t);
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
  return work;
}
