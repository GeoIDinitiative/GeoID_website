# GeoHUB Social — API contract (v1)

Base: `https://social.geoidinitiative.com` (local: `http://localhost:8790` via
`npx wrangler dev --var DEV_AUTH:1`). Every path below is under `/v1`.

The page gets a token from the auth Worker — `POST https://auth.geoidinitiative.com/auth/social-token`
with `credentials: "include"` → `{ token, expires }` (JWT, `aud: "social"`, 1 hour) —
and sends `Authorization: Bearer <token>` here. Signed out: GET routes still work for
public content; writes answer 401. Errors are `{ error: "sentence for a person" }` with
400/401/403/404/409/413/429. Lists answer `{ items: [...], next: <cursor|null> }` and
accept `?cursor=`. Times are epoch seconds.

Shapes (built in lib.js — never include an email anywhere):

- **User** `{ handle, name, headline, avatar, institution, plan, orcid_verified }`
- **Profile** = User + `{ bio, location, website, linkedin, orcid, skills[], interests[], regions[], availability, job_status, contact_pref, match_opt_in, joined }`
- **Post** — see `publicPost()` in lib.js. Plus, when a viewer is signed in, `viewer: { reacted: [kinds], bookmarked: bool, verified: "confirm"|"dispute"|null, following_author: bool }`; observations add `verification: { confirms, disputes, status: "community-verified"|"disputed"|"unverified" }`.

Enumerations (reject others with 400):

| field | values |
|---|---|
| post.kind | text, scene, analysis, monitor, observation, workflow, dataset, paper, question, discussion, event, opportunity, challenge |
| post.provenance | observed, derived, modelled, forecast, ai, unverified |
| post.visibility | public, unlisted, followers, team, community, private |
| loc precision | exact, approx, region, hidden (snapped on write by `snapLocation`) |
| reaction kind | like, insightful, reproduced, useful |
| follow target_type | user, project, tag, place, community, post |
| opportunity meta.type | job, grant, fellowship, internship, studentship, project, consultancy, expedition, hackathon, expertise, service |

Kind-specific `meta`:
- scene: the post's `scene` = `{ world, camera:{lat,lon,alt,heading,pitch}, layers:[{id,name,source,opacity,visible}], annotations:[{lat,lon,text}], time }`. Open in GeoHUB = `/?world=<world>&post=<id>`.
- analysis: `meta.before`, `meta.after` (media keys or layer ids), `meta.uncertainty` text.
- monitor: `meta.series:[{label, unit, points:[[t,v]]}]`, `meta.updated_at`; followers get `project_update` notifications when it is edited.
- workflow / dataset: `meta.repo`, `meta.inputs`, `meta.outputs`, `meta.version`, `meta.doi`.
- paper: `meta.doi`, `meta.journal`, `meta.year`, `meta.authors`.
- event: `meta.starts_at`, `meta.ends_at`, `meta.where`, `meta.url`, `meta.format` (webinar|seminar|workshop|hackathon|field-course|poster-session).
- opportunity: `meta.type`, `meta.org`, `meta.deadline`, `meta.skills[]`, `meta.paid` bool, `meta.apply_url`.
- challenge: `sponsored_by` must be set if sponsored; shown as a label always.

## profiles.js
| | |
|---|---|
| GET `/v1/me` | `{ user: Profile+{handle_editable:true}, counts:{followers,following,posts}, unread:{notifications,messages}, communities:[{slug,name,role}], teams:[{slug,name,role}], admin:bool }` (401 signed out) |
| GET `/v1/me/export` | everything held about the caller, as a JSON download (the only route that returns the caller's own email) |
| DELETE `/v1/me` `{confirm: <handle>}` | erase the account: media deleted, content blanked + removed, memberships and grants dropped, user row anonymised |
| PATCH `/v1/me` | any Profile field + `handle` (unique, `^[a-z0-9_]{3,30}$`, 409 if taken) + `notify:{kind:bool}`; skills/interests through `tags()` |
| GET `/v1/users/:handle` | `{ user: Profile, items:[ProfileItem], badges:[Badge], counts, relationship:{following, followed_by, blocked} }` |
| GET `/v1/users?q=&skill=&interest=&region=&available=1&cursor=` | People search → `{items:[User+{skills,availability}], next}` |
| GET `/v1/users/:handle/followers`, `/following` | lists of User |
| POST `/v1/me/items` | `{kind, title, detail, url, doi, year, visibility}` → ProfileItem `{id, kind, title, detail, url, doi, year, verified, visibility}`; verified is always false here |
| PATCH/DELETE `/v1/me/items/:id` | own only |
| POST `/v1/follow` `{type, id}` | id is a handle for users, slug for communities, tag text, "lat,lon" (rounded to 0.1) for place. Notifies a followed user. |
| DELETE `/v1/follow` `{type, id}` (body) | |
| GET `/v1/me/following?type=` | `{items:[{type,id,label}]}` |
| POST `/v1/blocks` `{handle}` / DELETE `/v1/blocks/:handle` / GET `/v1/blocks` | block also removes follows both ways |

## posts.js
| | |
|---|---|
| POST `/v1/posts` | body = Post fields (title, body ≤ 20000, kind, tags, location:{lat,lon,precision,place}, world, scene, media:[{key,alt}], links, licence, provenance, sources, method, limitations, meta, visibility, team_id, community_id, project_id, allow_fork, sponsored_by). Must have a non-empty title or body. team/community visibility requires membership. Media keys must be the author's. → Post |
| GET `/v1/posts/:id` | Post (404 when not visible — never 403, so existence does not leak) |
| PATCH `/v1/posts/:id` | author only; same fields. Monitor posts notify followers of the post/project. |
| DELETE `/v1/posts/:id` | author or admin → sets removed_at |
| GET `/v1/feed?tab=following|discover|world|research|opportunities&kind=&tag=&community=&project=&author=&cursor=` | following = authors/tags/communities/projects/places the viewer follows; discover = recent public, ranked by `reaction_count + 2*comment_count + 3*fork_count` decayed by age, excluding already-followed authors; world = posts with a location; research = kinds analysis, workflow, dataset, paper, monitor; opportunities = kinds opportunity, event, challenge (filter `type=` on meta.type, `skill=`). |
| GET/POST `/v1/posts/:id/comments` | `{body, parent_id, kind: comment|correction|suggestion, lat, lon}` → Comment `{id, author:User, body, kind, parent_id, location, created_at, accepted}` |
| DELETE `/v1/comments/:id` | author, post author, or admin |
| POST `/v1/posts/:id/accept` `{comment_id}` | question author only |
| POST/DELETE `/v1/posts/:id/react` `{kind}` | keeps reaction_count |
| POST/DELETE `/v1/posts/:id/bookmark` `{collection}` ; GET `/v1/me/bookmarks?collection=` | |
| POST `/v1/posts/:id/verify` `{verdict, note}` | observations only, not by author |
| POST `/v1/posts/:id/fork` `{title?, visibility?}` | only if allow_fork; new post copies scene/method/meta/sources with `forked_from`; increments fork_count; notifies author → Post |
| GET `/v1/posts/:id/cite` | `{ text, bibtex, url }` (APA-ish; author name, year, title, "GeoHUB Social", url) |
| GET `/v1/posts/:id/forks` | list of Post |

## media.js
| | |
|---|---|
| POST `/v1/media` multipart `file` (+`scope`, `alt`) | images (png/jpeg/webp/gif) and pdf, ≤ 8 MB; key `m/<user>/<random>.<ext>`; content type sniffed from magic bytes not trusted from the client → `{key, url, type, bytes}` |
| GET `/v1/media/:key` | public scope: anyone; owner: owner; review:<id>: requester + reviewers; team:<id>: active members; conversation:<id>: members. 404 otherwise. Sends `content-disposition: inline` for images, `attachment` for pdf, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'`. |
| DELETE `/v1/media/:key` | owner |

## discovery.js
| | |
|---|---|
| GET `/v1/search?q=&type=posts|people|communities|projects|tags` | LIKE search (≥ 2 chars), visible content only; tags returns `{tag, count}` |
| GET `/v1/tags/trending` | top 20 tags of the last 14 days `{tag, count}` |
| GET `/v1/map?world=earth&bbox=w,s,e,n&z=&kinds=&since=&until=&tag=&layer=public|mine|teams` | `{ clusters:[{lat,lon,count,kinds:{kind:n}}], points:[{id,kind,title,lat,lon,precision,provenance,verification,author}] }` — points when count ≤ 300 in the bbox, else clusters on a grid of `360/2^z` deg. Includes projects (kind "project") with a location. Never returns hidden-location posts. |
| GET `/v1/places?lat=&lon=&radius_km=50` | everything near a place: `{posts, projects, communities_active:[{slug,count}], people:[User]}` (people = authors who posted there publicly) |
| GET `/v1/events?from=&until=&community=` | upcoming event posts by meta.starts_at |

## notifications.js
| | |
|---|---|
| GET `/v1/notifications?unread=1` | `{items:[{id, kind, actor:User, ref_type, ref_id, text, read, created_at}], next}` |
| POST `/v1/notifications/read` `{ids?:[...]}` | none = all |

## communities.js
| | |
|---|---|
| GET `/v1/communities` | open + approval communities, and private ones the viewer belongs to; `{slug,name,description,tags,visibility,member_count,role?}` |
| POST `/v1/communities` | any signed-in user; creator is owner; `parent` slug makes a private channel (only moderators of parent) |
| GET `/v1/communities/:slug` | + rules, faq, resources, pinned posts, moderators, channels, viewer role; private → 404 to non-members |
| PATCH `/v1/communities/:slug` | owner/moderator |
| POST `/v1/communities/:slug/join` | open → active; approval → requested (mods notified); private → 404 unless invited |
| POST `/v1/communities/:slug/leave` | |
| GET `/v1/communities/:slug/members?skill=&q=&status=` | member directory with skills; status=requested for mods |
| POST `/v1/communities/:slug/members/:handle` `{role?, status?}` | mods: approve, invite, promote, ban |
| POST/DELETE `/v1/communities/:slug/pin/:post_id` | mods |

## teams.js
| | |
|---|---|
| GET `/v1/teams?mine=1` / `?q=` | mine, or public teams |
| POST `/v1/teams` `{name, slug?, description, visibility}` | creator = lead; creates a team conversation |
| GET `/v1/teams/:slug` | members (with role/status), projects, open tasks, conversation_id; private → 404 to non-members |
| PATCH `/v1/teams/:slug` | lead |
| POST `/v1/teams/:slug/invite` `{handle, role}` | lead/editor → member row status invited + notification |
| POST `/v1/teams/:slug/respond` `{accept: bool}` | invitee |
| POST `/v1/teams/:slug/request` | ask to join a public team |
| POST `/v1/teams/:slug/members/:handle` `{role?, status?}` / DELETE | lead; a lead cannot remove the last lead |
| GET/POST `/v1/teams/:slug/tasks` ; PATCH/DELETE `/v1/tasks/:id` | members; viewer role is read-only |

## projects.js
A project is the shareable scientific object; its workspace is the GeoHUB project manifest by reference.

| | |
|---|---|
| POST `/v1/projects` `{title, summary, stage, world, location, tags, licence, visibility, allow_fork, team_slug?, needs_skills, workspace?}` | workspace (≤ 48 KB JSON) becomes version 1 |
| GET `/v1/projects?mine=1|shared=1|q=&tag=` | mine; shared with me (grants to me or my teams); public search |
| GET `/v1/projects/:id` | `{project, access:{role}, versions:[{version,note,created_at,by}], grants (owner/editor only), posts:[Post]}`; access role = owner | editor | commenter | forker | viewer | public |
| PATCH `/v1/projects/:id` | owner/editor |
| DELETE `/v1/projects/:id` | owner |
| GET `/v1/projects/:id/workspace?version=` | `{version, manifest}` — viewer role or better (public projects: anyone) |
| POST `/v1/projects/:id/versions` `{manifest, note}` | owner/editor; notifies followers (`project_update`) |
| POST `/v1/projects/:id/grants` `{handle?|team_slug?, role, expires_at?}` | owner (or editor granting ≤ commenter) → Grant `{id, grantee:{type, handle|slug, name}, role, expires_at}`; notifies; audited |
| DELETE `/v1/projects/:id/grants/:grant_id` | owner; audited |
| POST `/v1/projects/:id/fork` `{title?}` | forker+ or allow_fork; copies latest manifest; new owner = caller; forked_from |

Role order: viewer < commenter < forker < editor < owner. A team grant gives its active members that role. Expired grants are ignored.

## reviews.js
Draft-paper review: a professor or student asks named reviewers (or a team/community/everyone) to review a draft.

| | |
|---|---|
| POST `/v1/reviews` `{title, abstract, doc_key?, doc_url?, expertise, visibility, team_slug?, community_slug?, project_id?, due_at?}` | doc_key's media scope is rewritten to `review:<id>` |
| GET `/v1/reviews?role=mine|assigned|open` | open = visibility open/community(member)/team(member) and status open |
| GET `/v1/reviews/:id` | requester, reviewers, or by visibility → `{review, reviewers:[{user,status,recommendation,summary?}], comments:[...], viewer_role: requester|reviewer|reader}`; reviewer summaries visible to requester always, to others after close |
| POST `/v1/reviews/:id/invite` `{handle}` | requester |
| POST `/v1/reviews/:id/volunteer` | non-private open reviews |
| POST `/v1/reviews/:id/respond` `{accept}` | invitee |
| POST `/v1/reviews/:id/comments` `{body, anchor, severity, parent_id}` ; POST `/v1/review-comments/:id/resolve` | reviewers + requester; resolve by requester |
| POST `/v1/reviews/:id/submit` `{recommendation, summary}` | accepted reviewer |
| PATCH `/v1/reviews/:id` `{status, due_at, title, abstract}` | requester |

## messages.js
| | |
|---|---|
| GET `/v1/conversations` | `{items:[{id, kind, title, members:[User], last:{body,at,sender}, unread, status}]}` — status request shows in a separate "Requests" tab |
| POST `/v1/conversations` `{handles:[...], title?, body}` | dm (1 handle, reuses an existing dm) or group. A recipient whose contact_pref is `nobody`, or `followers` and does not follow the sender, gets it as status `request`; blocked → 403 "can't message". |
| GET `/v1/conversations/:id/messages?after=` | members only; marks read |
| POST `/v1/conversations/:id/messages` `{body, media}` | members (status active); notifies |
| POST `/v1/conversations/:id/accept` / `/leave` / `/mute` `{muted}` | |

## moderation.js
| | |
|---|---|
| POST `/v1/reports` `{target_type, target_id, reason, note, kind: report|appeal}` | 1 open report per reporter+target |
| GET `/v1/mod/reports?status=open` | admins; community moderators see reports on posts in their communities; each with the target content (removed or not) |
| POST `/v1/mod/reports/:id` `{action: dismiss|remove|restore|warn|suspend, days?, note}` | removes/restores the target, suspends user, notifies, audits |
| GET `/v1/mod/audit` | admins |

## reputation.js
Reputation rewards contribution, not popularity. Follower counts are never an input.

| | |
|---|---|
| GET `/v1/badges` | the published criteria: `[{id, name, description, criteria}]` |
| GET `/v1/users/:handle/reputation` | `{ categories:[{id, label, count, evidence:[{type,id,title}]}], badges:[...] }` categories: research (analysis/paper posts with sources), datasets_workflows (public dataset/workflow posts), reuse (forks of their posts by others), answers (accepted answers), reviews (submitted reviews), observations (community-verified observations), teaching (posts tagged education/tutorial), mentoring (careers community answers) |
| POST `/v1/badges/refresh` | self: recompute and award earned badges (Open Data Contributor ≥1 public dataset with licence; Reproducible Workflow: a workflow post forked by ≥1 other with `reproduced` reaction; Community Mentor ≥5 accepted answers; Peer Reviewer ≥3 submitted reviews; Field Observer ≥3 community-verified observations; Verified Researcher = orcid_verified). Appeals go through /v1/reports kind appeal, target_type badge. |
| POST `/v1/match` `{skills:[], topic?, region?, project_id?}` | opt-in users only (match_opt_in=1, availability ≠ closed), not blocked → `{items:[{user:User, reasons:["Lists InSAR as a skill (self-declared)", "Posted 3 analyses tagged insar", "Submitted 2 reviews in volcanology"]}], note:"Suggestions explain themselves and are not a ranking of anybody's ability."}` sorted by number of reasons, max 20. |

## v1.1 — GeoHUB projects, models and repos shared into groups

**Post kinds added:** `model` and `repo` (both count as research kinds).
- model: `meta = { mesher: "gmsh"|"blender", page: "/<path of the GeoHUB model page>", domain: {world, bbox:[w,s,e,n]}, solver, params:{}, config:{} (≤ 32 KB, by reference — never mesh files) }`. Open in GeoHUB = `<meta.page>?post=<id>`.
- repo: `meta = { url (https, required), host: "github"|"gitlab"|"codeberg"|"other", language, licence, default_branch }`.

**Visibility added:** `project` — requires `project_id`; visible to whoever has at least viewer access to that project (`projectRole` in projects.js: owner, active grants incl. team grants, the project's team members). The author must have commenter access or better to post into it. Lists use the same rule inside `VISIBLE_POSTS`.

**Linking saved GeoHUB projects (client-side, no new route).** A user's local GeoHUB project records its Social counterpart in its own metadata (`metadata/project.json`):
`social: { project_id, version, role, linked_at }`. The routes already there do the rest: POST `/v1/projects` (publish), POST `/v1/projects/:id/versions` (push), GET `/v1/projects/:id` → `current_version` (is there a newer one?), GET `/v1/projects/:id/workspace` (pull), GET `/v1/projects?shared=1` (shared with me). Each user's link is theirs: a grantee who saves a shared project locally gets their own `social` entry with their own role.

**Share handoff from GeoHUB** (`sessionStorage['geoid:social-share']`) may now carry `{ kind: "scene"|"model"|"repo", target: { type: "public"|"team"|"community"|"project", id }, scene?, meta?, title? }`; compose preselects kind, visibility and team/community/project from it.

## v1.2 — study areas and the map of interest (interest.js)

| | |
|---|---|
| GET `/v1/me/study-areas` | `{items:[StudyArea], max: 10}` |
| POST `/v1/me/study-areas` `{name, location:{lat,lon,precision: approx|region}, radius_km, tags, on_map, world}` | snapped on write; "exact" is stored as approx; 409 past 10 |
| PATCH/DELETE `/v1/me/study-areas/:id` | own only |
| GET `/v1/users/:handle/study-areas` | all of a member's areas (on_map only decides the map) |
| GET `/v1/map/interest?world&bbox&z&tag` | `{cell_deg, researchers, cells:[{key, lat, lon, cell:{s,w,size}, researchers, posts, projects, study_areas, recent, prior, trend: new|rising|steady, top_tags, place, places_more}], trending:[cell], note}` — researchers are DISTINCT people per cell from on-map study areas + public located posts + public projects; follower counts never count |
| GET `/v1/map/interest/cell?world&s&w&size` | `{people:[{user, reasons:[...]}], posts:[Post]}` |

StudyArea = `{id, name, world, location:{lat,lon,precision}, radius_km, tags, on_map, created_at}`. Erasure deletes them; export includes them.

## v1.3 content & map

Kind-specific meta, checked in `content.js` (called from `cleanMeta` in posts.js). Out-of-range values are refused with 400 and a sentence naming the row and field — never clamped.

**analysis** — a before/after pair the post page shows as a swipe comparison.
`meta = { before, after, before_label, after_label, before_date, after_date, uncertainty }`. `before`/`after` are one of the post's own media keys (preferred: its alt text comes with it), an http(s) image URL, or a GeoHUB layer id (shown as text); anything with another scheme (`javascript:`, `data:`) or `..` is stored as `""`. Labels ≤ 80 chars; dates epoch seconds.

**monitor** — unchanged shape `meta.series:[{label, unit, points:[[t, v]]}]`; points are now **sorted by t on write**. The page draws one chart per unit (each with all its series), axes, a hover/keyboard readout and a data table.

**observation** — `meta.measurements: [Measurement]`, at most 50:

| type | values | rules |
|---|---|---|
| `strike_dip`, `bedding`, `joint`, `fault` | `strike`, `dip`, `dip_direction` (+ `rake` for fault) | dip 0–90; strike and dip direction 0–360 (360 stored as 0); give strike or dip direction or both — both must be at right angles (±5°) under either hand. **Stored right-hand-rule: `dip_direction = strike + 90`, all three present.** rake −180–180. |
| `lineation` | `trend`, `plunge` | trend 0–360, plunge 0–90, both required |
| `measurement` | `value`, `unit`, `label` | value a finite number (|v| ≤ 1e12), unit ≤ 30, label ≤ 80 |

Measurement = `{type, values:{...}, note}` (note ≤ 500). Error example: `Measurement 2: dip must be between 0 and 90°.` The page shows a table, a lower-hemisphere equal-area stereonet glyph per orientation and one net with all of them.

**Gallery** — no API change: a post's `media` (≤ 12) is shown as a gallery with a lightbox; compose uploads several files at once. Every image still needs alt text.

**Map of interest over time** — GET `/v1/map/interest` accepts `since` (inclusive) and `until` (exclusive), epoch seconds, either optional:
- a study area counts from its `created_at`, posts and projects from theirs; cells, `top_tags` and `place` come from the window only;
- `trend`/`recent`/`prior` are measured back from `until` (now when absent or in the future);
- `until <= since` → 400; the answer echoes `since`, `until` (null when unbounded).
The page's time slider plays months (`since` = month start, `until` = next month start; "up to then" omits `since`). `/v1/map` already took `since`/`until` (inclusive `until`).

**Live hazards (client only)** — the map can overlay `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson`, fetched by the browser (social/index.html CSP `connect-src` names `https://earthquake.usgs.gov`). It is official USGS data, styled and labelled apart from community content, never stored or proxied here.

**GeoHUB viewer** — the Community layer has a "Study interest" mode drawing `/v1/map/interest` cells as discs sized by researchers (social-core.js `interestUrl`, `interestToFeatures`); same importer, same longitude rules as the posts mode.

## v1.3 engagement — email, scheduled jobs, live messages (mail.js, cron.js, realtime.js)

**Email preferences** (table `mail_prefs`, migration 0006; no row = the defaults)

| | |
|---|---|
| GET `/v1/me/mail` | `{ digest: bool, immediate:[kind], mode: off|digest|immediate, unsubscribed: bool, kinds:[{id,label}], defaults:{digest:true, immediate:["message","invite"]}, sending: bool }` — `sending` is false while RESEND_API_KEY/MAIL_FROM are unset (choices are saved, nothing is sent) |
| PATCH `/v1/me/mail` `{mode?, digest?, immediate?:[kind]}` | `mode` off = nothing; digest = digest only; immediate = digest + the listed kinds as they happen. Kinds: message, invite, grant, review, mention, request (collaboration), mentoring, event (reminders); aliases collab_request/collaboration_request → request, mentor/mentor_request/mentorship → mentoring, event_reminder/reminder → event, team_invite → invite, review_invite → review. Others → 400 |
| GET `/v1/mail/unsubscribe?t=` | no sign-in: the signed token (aud `mail`, 2 years, its own key) turns off ALL email and answers a small HTML page with an Undo button. Bad/expired token → the same page shape saying so |
| POST `/v1/mail/unsubscribe?t=` | RFC 8058 one-click (mail clients) → `{ok, unsubscribed}`; 400 on a bad token |
| POST `/v1/mail/resubscribe?t=` | the page's Undo: back to the defaults → HTML |

Every email carries `List-Unsubscribe: <…/v1/mail/unsubscribe?t=…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, deep links to `${SITE_ORIGIN}/social/#/…`, and a link to Settings. **Content rule:** an email never holds a message body (only who wrote), a non-public post contributes only its title, a post the recipient can't see contributes nothing, an actor either side of a block drops the line, and no address other than the recipient's own appears.

**notify() and kinds (for every module).** `notify()` adds one `mail_queue` row when the kind is in `MAIL_NOW_KINDS` (lib.js); nothing is sent from a request. Use the kind names above for new notifications (`request` for collaboration requests, `mentoring`, `event`) so members' email choices apply; a kind outside the list is in-app + digest only. In-app mute (`notify:{kind:false}` on PATCH /v1/me) suppresses the email too.

**Scheduled jobs** (`scheduled()` in worker.js → cron.js; wrangler.toml `[triggers]`)
- `*/15 * * * *`: event reminders → immediate mail (rows ≥ 2 min old; read-in-app and read-in-thread rows skipped; one email per member per run, a thread's messages as one line; 3 tries; rows older than a day expire into the digest) → daily digests from `DIGEST_HOUR_UTC` (default 7): unread notifications not already mailed, last 7 days, ≤ 25 lines, at most one per 20 h.
- `17 3 * * *`: prune (rate rows > 1 h, read notifications > 180 days, mail log > 30 days) and badge refresh for up to 100 members whose work saw activity in the last 2 days (runs the `/v1/badges/refresh` handler itself).
- **events.js contract:** `export async function dueReminders(env, now /* epoch s */)` returns `[{ user_id, event_id | post_id | ref_id, ref_type?, title?, text? }]`; when events.js also exports `markReminded(env, items, now)` cron.js calls it with what it got. cron.js turns each into an `event` notification (ref_type defaults to `post` when `post_id` is given, else `event`), skipping a repeat of the same text for the same ref within 2 days. Until it exists the job reports `skipped`.

**Live messages** (Durable Object `ChatRoom`, binding `CHAT`; without it every route below still answers and the page polls)

| | |
|---|---|
| POST `/v1/conversations/:id/ticket` | members (not left) → `{ ticket, expires, path: "/v1/conversations/:id/live", live: bool }`; ticket = HMAC (aud `chat`, own key), 60 s, one room |
| GET `/v1/conversations/:id/live?ticket=` | WebSocket upgrade. 426 not an upgrade; 403 Origin outside RETURN_ORIGINS; 401 bad/expired/other-room ticket; 404 not a member now; 503 no binding |
| POST `/v1/me/live/ticket` ; GET `/v1/me/live?ticket=` | the member's own room: only `{type:"unread", conversation_id}` pings |

Server → page frames: `{type:"hello", room}`, `{type:"message", conversation_id, message: <same shape as GET …/messages items>}`, `{type:"typing", handle}`, `{type:"unread", conversation_id}`, `{type:"pong"}`. Page → server: `{type:"ping"}` (auto-answered without waking the object), `{type:"typing"}` (members who may reply; relayed at most every 2.5 s). Close code 4403 = no longer a member (don't reconnect). POST `…/messages` (and a first message on POST `/v1/conversations`) pushes to the room after saving and pings up to 25 other members' own rooms; each push names the current members, and sockets of anyone else are closed. Pushes never fail a send.

## v1.3 collaboration — requests for help, accepted contributions, events (requests.js, events.js)

Migration `0005_collab.sql`: tables `collab_requests`, `collab_participants`, `collab_responses`, `contributions`, `event_rsvps`, `event_posters`; `comments` gains `status`, `status_note`, `status_at`. Export (`/v1/me/export`) includes `collab_requests`, `collab_participation`, `collab_responses`, `contributions` (credited_by as a handle), `event_rsvps`, `event_posters`; erasure blanks and withdraws the caller's requests and deletes their participation, credits, RSVPs and posters. Notification kinds added: `request`, `contribution`, `event` (ref_type `request` or `post`).

**Requests** — "invite specialists to join a project, review a method, contribute a dataset or validate a model".

Request = `{id, kind, title, detail, skills[], audience, community:{slug,name}|null, team:{slug,name}|null, project:{id,title}|null, post:{id,kind,title}|null, due_at, status, requester:User, counts:{helpers, offers, invited}, created_at, updated_at}` — `post`/`project` are null for viewers who may not open them.

| | |
|---|---|
| POST `/v1/requests` `{kind, title, detail, skills, handles?:[...], audience?: member\|community\|everyone, community_slug?, team_slug?, project_id?, post_id?, due_at?}` | kind ∈ join_project, review_method, contribute_dataset, validate_model, other. `member` (default) needs ≥1 handle (≤10) and is visible only to the requester and the people on it; `community_slug` implies audience community (requester must be a member); `everyone` is public. join_project needs `project_id` with owner/editor role. Invitees are notified. → detail (below) |
| GET `/v1/requests?role=open\|mine\|asked\|helping&skill=&kind=&community=&cursor=` | open = status open, audience everyone or a community the viewer is in, not the viewer's own, no blocks either way; asked = invited/declined; helping = accepted/offered (items add `my_status`) |
| GET `/v1/requests/:id` | `{request, viewer_role: requester\|helper\|participant\|reader, my_status, participants:[{user, status: invited\|offered\|accepted\|declined, acknowledged, acknowledged_at}], responses:[{id, author, kind: message\|offer\|accept\|decline\|status, body, created_at}], conversation_id}` — readers see only accepted helpers and no responses; participants see their own notes, the requester's, and accept/status records; conversation_id for requester and helpers only. 404 when not visible (blocks included). |
| PATCH `/v1/requests/:id` `{title?, kind?, detail?, skills?, due_at?, status?}` | requester edits; status moves: open→withdrawn; accepted→in_progress\|completed\|withdrawn; in_progress→completed\|withdrawn; declined→open\|withdrawn; withdrawn→open. Helpers may only set in_progress/completed. 409 on an illegal move. Notifies the other side. |
| POST `/v1/requests/:id/respond` `{accept, message}` | invited → accepted (status open→accepted, conversation opened) or declined (all asked declined → request declined); anyone else on an open community/everyone request → `offered` (accept:false withdraws the offer). Notifies the requester. |
| POST `/v1/requests/:id/choose` `{handle, accept}` | requester takes or turns down an offer; acceptance opens the conversation |
| POST `/v1/requests/:id/invite` `{handle}` | requester asks somebody more (e.g. from POST `/v1/match` suggestions) |
| POST `/v1/requests/:id/messages` `{body}` | requester and people on the request (not readers) |
| POST `/v1/requests/:id/acknowledge` `{handle?, note}` | requester, status completed, an accepted helper (handle optional when there is one) → contributions row (kind request), helper notified |

Conversation on acceptance: the first helper reuses an existing DM with the requester (else a new DM); a second helper moves it to a group titled "Request: <title>". All members active (both sides consented).

**Accepted contributions** (corrections and suggestions on posts):

| | |
|---|---|
| POST `/v1/comments/:id/status` `{status: accepted\|declined\|open, note}` | the post's author only; comment kind correction/suggestion only; not the author's own comment. accepted → contributions row + notify the commenter; declined/open removes the credit. → `{id, kind, status, status_note, status_at}` |
| GET `/v1/posts/:id/contributions` | "Changes accepted from the community": `{items:[{comment_id, user, kind, excerpt, note, accepted_at}]}` — canSeePost, blocked authors excluded |
| GET `/v1/users/:handle/contributions` | the member's credits; work not public is `{ref_id:null, title:"A contribution to work shared privately"}` |

Comment shape gains `status` ("" \| accepted \| declined) and `status_note`. Reputation gains category `accepted_contributions` (live accepted comments on live posts + acknowledged requests; private work counted, not named).

**Events** (an event is a post of kind event; `meta.capacity` optional positive integer). Every route 404s unless canSeePost.

| | |
|---|---|
| GET `/v1/events/:id/rsvp` | `{event_id, organiser, format, starts_at, ends_at, over, capacity, spots_left, counts:{going, interested, not_going, waitlist}, mine:{status, show_me}\|null, attendees:[{user, status, shown?}]}` — organiser sees everyone who answered (with `shown`); others see only people with show_me who are going/interested, minus blocks |
| POST `/v1/events/:id/rsvp` `{status: going\|interested\|not_going, show_me?}` | going when full → `waitlist`; leaving "going" promotes the longest-waiting person (notified). 409 when the event is over. Organiser notified of new "going". → summary |
| DELETE `/v1/events/:id/rsvp` | → summary |
| PATCH `/v1/events/:id` `{capacity: n\|null}` | organiser; writes meta.capacity and fills free places from the waitlist |
| GET `/v1/events/:id/ics` | `text/calendar` attachment: VEVENT with UID `<post id>@<SELF_ORIGIN host>`, DTSTART/DTEND in UTC (`…Z`; end defaults to start + 1 h), SUMMARY, DESCRIPTION (body, join link, organiser name, post link), LOCATION, URL; RFC 5545 escaping, 75-octet folding, CRLF. No ORGANIZER (it needs an email). 409 without starts_at. |
| GET `/v1/event-rsvps?ids=a,b` | ≤ 50 visible events → `{items:[{event_id, counts, capacity, spots_left, mine, over}]}` (for lists) |
| GET `/v1/me/rsvps?when=upcoming\|past` | the caller's events (going/interested/waitlist) as Post + `rsvp:{status}` |
| GET `/v1/events/:id/posters` | poster sessions: `{items:[{post: Post, status: pending\|approved\|rejected, note, submitted_by, created_at, decided_at}], organiser}` — approved for all; organiser sees all; presenters see their own; each poster post must pass canSeePost |
| POST `/v1/events/:id/posters` `{post_id, note}` | format poster-session only; submitter must have RSVP'd (or be the organiser, whose posters are auto-approved); the post must be their own and public/unlisted (or share the event's team/community/project visibility). Organiser notified. |
| POST `/v1/events/:id/posters/:post_id` `{status: approved\|rejected\|pending, note}` | organiser; presenter notified |
| DELETE `/v1/events/:id/posters/:post_id` | presenter or organiser |

Per-poster discussion is the poster post's own comments.

**Reminder hook for the cron track** (events.js, no route):

- `dueReminders(env, at = now(), {window = 86400, limit = 500})` → `[{user_id, event_id, title, starts_at, status, kind: "event", ref_type: "post", ref_id, text}]` — RSVPs going/interested with `reminded_at IS NULL` to live events whose `meta.starts_at` is in `(at, at + window]`, whose person still exists and can still see the event. What it returns is marked (`event_rsvps.reminded_at`) before it returns, so each RSVP is returned once — cron.js `reminders()` calls it every 15 min and notifies. `{mark: false}` = pure read. `at` is epoch seconds (milliseconds accepted).
- `markReminded(env, items, at)` sets `reminded_at` (used with `{mark: false}`).
- `sendReminders(env, at)` = dueReminders({mark:false}) → `notify(env, user_id, "event", null, "post", event_id, text)` → markReminded; returns `{sent}` — for a caller that does not notify itself.

## v1.3 identity — organisations, verified affiliations, publication checks, ORCID, mentoring, welcome (orgs.js, verify.js)

Migration `0004_orgs.sql`. **No email, and no email domain, appears in any answer.** A *verified affiliation* is computed server-side: the member's sign-in address ends in one of a **verified** org's domains (subdomains count, `leeds.ac.uk.evil.test` does not). The only output is a boolean.

**User** gains `affiliation: {slug, name, verified} | null` (the one membership the member shows; verified preferred) and `mentoring: bool`. **Profile** gains `mentoring_topics[]`. `GET /v1/me` → `user.onboarding_done`. **Post** gains `org: {slug, name} | null` (set only by POST `/v1/orgs/:slug/posts`; editing a post cannot set or change it). **ProfileItem** on `GET /v1/users/:handle` gains `verification: Evidence | null` (the newest check). Follow `target_type` gains `org` (id = slug). People search: `GET /v1/users?mentor=1&mentor_topic=` (items add `mentoring_topics`). Notification kinds: `mentoring` (mutable in `notify`).

Org = `{slug, name, kind: university|survey|company|agency|nonprofit|other, description, website, logo, domains[], location, verified, verified_at, member_count, created_at}`.

| | |
|---|---|
| GET `/v1/orgs?q=&kind=&verified=1&mine=1&pending=1&cursor=` | directory, verified first then by members and name; cursor is an offset. `pending=1` (unverified only) is site admins only. Items add `member` |
| POST `/v1/orgs` `{name, slug?, kind, description, website, location, domains[], logo_key?}` | any signed-in user proposes; starts **unverified**; proposer = first admin; 409 on a taken slug or an existing org of the same name; max 5 pending proposals each. Domains: host names, ≤ 10, no free-mail providers, no bare registry suffix (`ac.uk`) → 400 |
| GET `/v1/orgs/:slug` | `{org, counts:{members, followers}, admins:[User], posts:[Post] (posted as the org, visible to viewer), viewer:{member, role, verified, following, can_edit, can_post, site_admin, locked} | null}` |
| PATCH `/v1/orgs/:slug` | org admin or site admin. Once verified, `name` and `domains` are site admins' only (403, `viewer.locked`); domain/name changes recompute every member's verification |
| POST `/v1/orgs/:slug/verify` `{verified, note?}` | site admins (`isAdmin`); recomputes members; audited; notifies org admins |
| DELETE `/v1/orgs/:slug` | site admin, or the org's admin while unverified: removed, memberships/follows dropped, posts unstamped; audited |
| POST `/v1/orgs/:slug/join` / `/leave` | join = declare an affiliation → `{member, role, verified}`. Shown on cards if none is yet, or if this one is verified and the shown one is not. The only admin can't leave while others remain (409) |
| GET `/v1/orgs/:slug/members?cursor=` | `[{user, role, verified, since}]` |
| POST `/v1/orgs/:slug/members/:handle` `{role: admin|member}` / DELETE | org admins; an org keeps ≥ 1 admin (409); audited |
| POST `/v1/orgs/:slug/posts` `{kind: opportunity|event|challenge, ...Post fields}` | org admins only; created through posts.js's own create (same rules), then stamped with the org; `meta.org` defaults to the org name; public posts notify the org's followers (`project_update`) |
| GET `/v1/me/orgs` | `{items:[{org, role, verified, primary}], suggested:[{slug, name, kind}]}` — `suggested` = verified orgs the caller's own address matches (to the caller only; names the org, never the address) |
| PATCH `/v1/me/affiliation` `{org: slug|null}` | which membership cards show (must be a member); null shows none |
| POST `/v1/me/items/:id/verify` | own item with a DOI → Crossref `api.crossref.org/works/<doi>` (server-side). `verified = 1` only if the DOI resolves AND the member's name matches an author (family name, whole words, + first initial; accents/diacritics, apostrophes, hyphens ignored; "Family, Given" understood). Crossref 404 / no match → `verified = 0`; Crossref unreachable → nothing changes. Once per 30 s per item (429). → `{item, verification: Evidence, message}` |
| GET `/v1/me/items/:id/verifications` | the item's last 20 checks |
| GET `/v1/orcid/status` | `{enabled}` |
| GET `/v1/orcid/start` | signed in → `{url}` (ORCID `/oauth/authorize`, `scope=/authenticate`, `state` = HS256 token `{sub, aud:"orcid-state", exp: +10 min}`). JSON rather than a 302: a navigation cannot carry the Bearer, so the page navigates itself |
| GET `/v1/orcid/callback?code&state` | verifies state, exchanges the code at `/oauth/token`, sets `users.orcid` + `orcid_verified = 1` (one account per verified iD), audits, then 302 → `SITE_ORIGIN/social/#/settings?orcid=linked|taken|cancelled|expired|failed` |
| PATCH `/v1/me/mentoring` `{open, topics[]}` | → `{open, topics}` |
| GET `/v1/mentoring/requests?role=mentor|mentee&status=&cursor=` | `[{id, mentee:User, mentor:User, role, topic, message, status, conversation_id (active only), created_at, responded_at}]` |
| POST `/v1/mentoring/requests` `{handle, topic, message}` | mentor must be open (409), not blocked (403), one requested/active per pair (409); notifies (`mentoring`) |
| POST `/v1/mentoring/requests/:id/respond` `{accept}` | the mentor; accept → `active` + a conversation (the pair's existing dm, else a new dm, both active, with an opening message); decline → `declined` |
| POST `/v1/mentoring/requests/:id/close` | mentee withdraws a pending request (`withdrawn`); either side ends an active one (`ended`) |
| GET `/v1/me/onboarding` | `{show, done, bare, suggestions:{communities:[{slug,name,description,member_count,visibility,tags,reasons}], people:[{user, reasons}], orgs:[{slug,name,kind,reason}]}, note}`. bare = no headline, no interests, no study areas; show = bare and not done. people = `match_opt_in` members sharing an interest, not followed, not blocked |
| POST `/v1/me/onboarding` `{done}` | true = finished/skipped (stored as a time on users, so it holds across devices); false = show it again |

Evidence = `{source:"crossref", doi, checked_at, outcome: verified|name-mismatch|not-found|error, resolved, matched, matched_author, name_checked, title, journal, year, authors[] (first 20 on the record)}`.

Reputation: the `mentoring` category (label "Mentoring") also counts mentoring requests the member accepted as mentor (`active` or `ended`), as evidence `{type:"mentoring", id:null}` — counted, not named. Erasure deletes org memberships (counts recomputed), mentoring requests either side and publication checks, and clears the affiliation/mentoring/welcome columns; export adds `org_memberships`, `orgs_proposed`, `mentoring_requests` (other people by handle) and `publication_checks`.
