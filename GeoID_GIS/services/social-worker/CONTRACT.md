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
