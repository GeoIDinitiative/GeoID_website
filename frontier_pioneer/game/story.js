/**
 * THE STORY ENGINE: MARS: Frontier Pioneer, played from story/*.json.
 *
 * System "story" (order 92). The campaign is the game: the title screen calls
 * story.api.newCampaign() once the prologue's site has loaded, or a saved
 * campaign resumes. Everything here is driven by the data (acts.json: 67
 * missions, their objectives, triggers, rewards, clues, variables and the
 * hidden timeline; cutscenes.json; dialogue/*.json); nothing is scripted twice.
 *
 *   MISSIONS. A mission starts on its trigger (mission_complete, cutscene_end, wake, any, player_start,
 *   timer_end; "manual" ones become available in the Story log once their act and predecessor allow).
 *   Its start lines play, its objectives run in order (optional ones in parallel; questions to KEEPER,
 *   pickups and conversations may be done in any order), each objective's progress lines play when it is
 *   done, and on completion its closing lines, its Contribution Credit (progress.api.award), its clues and
 *   its `sets` variables. Objective checkers for all 54 types are in storyobj.js.
 *   CUTSCENES start on their own triggers (cutscene.js plays them), and an objective's `cutscene`.
 *
 *   SITES. A mission's site is where it plays. If that site is installed and is not the one loaded, the
 *   story asks the shell to travel there (window.__marsTravel(siteId, {reason})): a save, the loading
 *   screen with the chapter card, the new site. If it is not installed yet, the chapter plays as a STAND-IN
 *   at the site that is loaded: its places (acts.json POI ids) are laid out deterministically around the
 *   home base, a card says so, and nothing is skipped. Olympus Mons, Arcadia, the pole and the rest degrade
 *   this way until the sites agent installs them; the moment one is installed its own POIs are used.
 *
 *   TIME. The HUD's sol is the MISSION sol. Beside it runs the true clock (hidden_timeline anchors): each
 *   anchored mission or cutscene moves it to its anchor, a sleep (dormancy) advances it toward the next
 *   anchor, and the season (Ls) follows the true date. The dune by the lander migrates with it (C08 measures
 *   it), and Earth is where the true date puts it, not where the mission sol says.
 *
 *   THE FILTER. Intact through Act III, cracking from Act IV (4.1), burnt in the Fugitive epilogue
 *   (ui.setFilterState, audio telemetry). KEEPER's scrubs ("[FILTERED]") hold until Act IV.
 *
 *   ENDINGS. 5.6's final choice: Rest (C18b, the plaque with the variables, C20, the end card) or Fugitive
 *   (C18a: filter burnt, telemetry, RECALL hunters, C20, the Fugitive card, F.1 to F.6 ending at Olympus;
 *   caught: C19, the run ends).
 *
 *   SAVE: state.systems.story (and a copy under localStorage "geoid.mars_surface.story" so a campaign
 *   follows the player between sites: the newer one wins).
 *
 *   getSystem("story").api = { newCampaign(), campaignSite(save?), chapterTitle(), state(), jump(missionId),
 *     skipCutscene(), play(cutsceneId), completeObjective(), completeMission(), ask(text), sleep(where),
 *     log(), keeper(), uplink(), dev(on), place(id), vars(), setVar(k, v), act(), mission(), objective() ... }
 *   DEV SKIP: ?story=dev opens a panel (jump to any act / mission / cutscene, endings).
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { registerSystem, getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";
import { MARS } from "./config.js?v=b8cfe8e-efa5b7b7";
import { advanceClock } from "./state.js?v=b8cfe8e-efa5b7b7";
import { MODULES } from "./basenet.js?v=b8cfe8e-efa5b7b7";
import { loadStory, speech, evalCond, esc, hash, rng, humanise, ensureStoryStyles, readTime } from "./storydata.js?v=b8cfe8e-efa5b7b7";
import { Cutscenes, stillSVG } from "./cutscene.js?v=b8cfe8e-efa5b7b7";
import { Terminal } from "./keeper.js?v=b8cfe8e-efa5b7b7";
import { makeObjectives, ACTION_HOLD } from "./storyobj.js?v=b8cfe8e-efa5b7b7";
import { stationDirection } from "./halo.js?v=b8cfe8e-efa5b7b7";
import { hunterMesh } from "./caretakers.js?v=b8cfe8e-efa5b7b7";
import {} from "./tiers.js?v=b8cfe8e-efa5b7b7";
import { setCampaign } from "./title.js?v=b8cfe8e-efa5b7b7";

export const ACT_ORDER = ["prologue", "I", "II", "III", "IV", "V", "fugitive"];
export const ACT_TITLES = { prologue: ["PROLOGUE", "THE DESCENT"], I: ["ACT I", "THE LONELY LANDING"], II: ["ACT II", "THE WATER ROAD"], III: ["ACT III", "THE LONG NIGHT"],
  IV: ["ACT IV", "THE MIRROR"], V: ["ACT V", "ARRIVAL"], fugitive: ["FUGITIVE", "THE REST OF THE PLANET"] };
const GENERIC = new Set(["any", "any_city", "any_dome", "any_pad", "roaming", "pads_network", "relay_towers", "polar_station", "none"]);
const SITE_NAMES = { jezero: "Jezero Crater", arcadia: "Arcadia Planitia", north_polar: "the North Polar Layered Deposits", korolev: "Korolev Crater", gale: "Gale Crater", arsia: "the Arsia Mons lava tubes",
  utopia: "Utopia Planitia", valles: "Valles Marineris", hellas: "Hellas Planitia", olympus: "Olympus Mons", amazonis: "Amazonis Planitia", hale: "Hale Crater", depot_syrtis: "Depot Syrtis" };
const GLOBAL_KEY = "geoid.mars_surface.story";
const FINAL_HOUR_S = 480;                 // "one hour": eight real minutes, counted down as sixty
const LS0 = 5.6;
const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const store = () => { try { return window.localStorage; } catch { return null; } };
const actIdx = (a) => ACT_ORDER.indexOf(a);

class Story {
  constructor(game) {
    this.game = game; this.S = this._fresh(); this.D = null; this.enabled = false;
    ensureStoryStyles();
    this.cs = new Cutscenes(game, this);
    this.term = new Terminal(game, this);
    this.O = makeObjectives(this);
    this.root = new THREE.Group(); this.root.name = "story-world"; game.scene.add(this.root);
    this.hunters = []; this.pickups = new Map(); this.spots = new Map();
    this._prompt = null; this._hold = 0; this._acc = 0; this._tagged = new Map();
    this._ui();
    this.ready = loadStory().then((D) => { this.D = D; return D; });
    this._installed = this._siteIndex();
  }
  _fresh() {
    return { v: 1, campaign: false, seed: (Math.random() * 1e9) | 0, rev: 0, site: "jezero", act: "prologue", focus: null, active: {}, done: {}, avail: [], vars: {}, clues: [], seen: {}, acts: [],
      anchor: "P.1", trueSol: 0, missionSol: 0, sleptSols: 0, sleptAnchor: null, places: {}, markers: {}, timers: {}, ending: null, over: false, filter: "intact", log: [], pendingWake: false,
      poemSol: -1, items: [], collected: {}, lander: null, homeBase: null, ls0: LS0, hunters: false };
  }

  /* ── small accessors other modules use ── */
  get api() { return sys.api; }
  vars() { return this.S.vars; }
  setVar(k, v) {
    if (!k) return;
    this.S.vars[k] = v;
    if (k === "final_hour.started" && v && !this.S.timers.final_hour) this.S.timers.final_hour = { left: FINAL_HOUR_S, total: FINAL_HOUR_S };
    if (k === "ending" && v) this._ending(v);
  }
  clue(id) { if (id && !this.S.clues.includes(String(id))) this.S.clues.push(String(id)); }
  act() { return this.S.act; }
  seed() { return this.S.seed; }
  trueSol() { return this.S.trueSol; }
  hasItem(k) { return this.S.items.includes(k); }
  filterScrubs() { return actIdx(this.S.act) < actIdx("IV"); }
  tierFloor() { const a = this.S.act, d = this.S.done; return a === "II" && d["2.6"] ? 3 : a === "III" ? 5 : a === "IV" || a === "V" || a === "fugitive" ? 6 : 0; }
  wantsStation() { return this._stargaze && /halo/.test(this._stargaze.target || ""); }
  get loadedSite() { return this.game.site ? this.game.site.id : "jezero"; }
  playerPos() { const a = getSystem("avatar"), p = a && a.api && a.api.position; return p || { x: this.game.vehicle.p.x, y: this.game.vehicle.p.y, z: this.game.vehicle.p.z }; }
  onFoot() { const a = getSystem("avatar"); return !!(a && a.api && a.api.onFoot); }
  dist(p) { const q = this.playerPos(); return p ? Math.hypot(p.x - q.x, p.z - q.z) : Infinity; }
  base() { const b = getSystem("base"); return b && b.api ? b.api : null; }

  /* ── the campaign ── */
  async newCampaign() {
    await this.ready;
    this.S = this._fresh();
    this.S.campaign = true; this.S.site = this.loadedSite;
    this._enable(true);
    this._placeLander(true);
    const g = this.game, L = this.S.lander;
    if (L && g.vehicle) { g.vehicle.place(L.x + 9, L.z + 7, 1.2); }
    this._log("Campaign begun");
    this._applyAct("prologue", true);
    this._save();
    this.fire({ on: "new_game" });
    return true;
  }
  _enable(on) {
    this.enabled = on;
    this.game.storyOwns = on;
    const H = getSystem("halo"), C = getSystem("caretakers"), T = getSystem("tiers");
    const fug = this.S.act === "fugitive";
    if (H && H.api) H.api.setEnabled(on && !fug);
    if (C && C.api) C.api.setEnabled(on);
    if (T && T.api) T.api.setEnabled(on);
    for (const id of ["btn-story", "btn-keeper", "btn-halo"]) { const b = document.getElementById(id); if (b) b.hidden = !on || (id === "btn-halo" && fug); }
    const ml = document.getElementById("btn-missions"); if (ml) ml.hidden = on;
    this.root.visible = on;
    if (!on && this.game.state && this.game.state.objectives) { const o = this.game.state.objectives; if (o.managed) { o.target = null; o.hud = null; } }
  }
  /** The site the campaign is at (the title screen loads it). */
  campaignSite(save) {
    let s = save && (save.systems ? save.systems.story : save.story || save);
    if (!s || !s.campaign) { try { s = JSON.parse((store() && store().getItem(GLOBAL_KEY)) || "null"); } catch { s = null; } }
    return (s && s.campaign && s.site) || "jezero";
  }
  /** The title screen's campaign pointer: where the campaign is and what to call it (title.js). */
  _pointer() {
    try { const t = this.chapterTitle(), m = this.S.focus && this.D ? this.D.mission(this.S.focus) : null; setCampaign({ site: this.S.site || this.loadedSite, act: t.act.replace(/^ACT /, "Act ").replace(/^PROLOGUE$/, "Prologue").replace(/^FUGITIVE$/, "Fugitive"), chapter: m ? m.title : t.title.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()) }); } catch (e) { console.warn("[story] campaign pointer", e); }
  }
  chapterTitle() {
    const a = this.S.act || "prologue", T = ACT_TITLES[a] || ACT_TITLES.prologue, m = this.S.focus && this.D ? this.D.mission(this.S.focus) : null;
    return { act: T[0], title: T[1], subtitle: m ? `${m.id} · ${m.title}` : "" };
  }

  /* ── triggers ── */
  /** A story event. Starts cutscenes and missions whose trigger matches. */
  fire(ev) {
    const D = this.D; if (!D || !this.S.campaign || this.S.over) return;
    const S = this.S;
    const match = (t) => {
      if (!t) return false;
      if (t.on === "any") return (t.of || []).some(match);
      if (t.on !== ev.on) return false;
      if (t.id && t.id !== ev.id) return false;
      if (t.package && t.package !== ev.package) return false;
      if (t.poi && t.poi !== ev.poi) return false;
      if (t.question_id && t.question_id !== ev.question_id) return false;
      if (t.choice_id && (t.choice_id !== ev.choice_id || (t.option && t.option !== ev.option))) return false;
      if (t.unit && t.unit !== ev.unit) return false;
      if (t.object && t.object !== ev.object) return false;
      if (t.hunter && t.hunter !== ev.hunter) return false;
      if (t.timer && t.timer !== ev.timer) return false;
      if (t.on === "wake" || t.on === "stargaze") { if (t.after_mission && !S.done[t.after_mission]) return false; if (t.after_cutscene && !S.seen[t.after_cutscene]) return false; }
      if (t.on === "objective_complete" && (t.mission !== ev.mission || t.objective !== ev.objective)) return false;
      if (t.mission && t.on !== "objective_complete" && !S.active[t.mission]) return false;
      return true;
    };
    for (const c of D.cut.cutscenes) if (!S.seen[c.id] && match(c.trigger) && !this._queuedCs?.has(c.id)) this.playCutscene(c.id);
    for (const m of D.missions) {
      if (S.done[m.id] || S.active[m.id] || !match(m.trigger)) continue;
      if ((m.requires || []).some((r) => !S.done[r])) continue;
      if (m.available && m.available.if && !evalCond(m.available.if, S.vars)) continue;
      this.startMission(m.id);
    }
    if (ev.on === "mission_complete") this._refreshAvail();
  }
  /** Manual missions (side, second ring) and player-started ones become available. */
  _refreshAvail() {
    const D = this.D, S = this.S; if (!D) return;
    S.avail = D.missions.filter((m) => {
      if (S.done[m.id] || S.active[m.id]) return false;
      const t = m.trigger || {};
      const manual = t.on === "manual" || (t.on === "any" && (t.of || []).some((x) => x.on === "player_start"));
      if (!manual) return false;
      if ((m.requires || []).some((r) => !S.done[r])) return false;
      const a = m.available || {};
      if (a.after && !S.done[a.after]) return false;
      if (a.before && S.done[a.before]) return false;
      if (a.act && actIdx(S.act) < actIdx(a.act)) return false;
      if (a.window === "final_hour" && !S.timers.final_hour) return false;
      if (a.if && !evalCond(a.if, S.vars)) return false;
      if (S.act === "fugitive" && m.kind !== "fugitive") return false;
      if (S.act !== "fugitive" && m.kind === "fugitive") return false;
      return true;
    }).map((m) => m.id);
  }
  playCutscene(id, o = {}) {
    if (!this._queuedCs) this._queuedCs = new Set();
    if (this._queuedCs.has(id)) return this._csPromise || Promise.resolve();
    this._queuedCs.add(id);
    const D = this.D, cs = D && D.cutscene(id);
    if (cs && D.anchors[id]) this._anchor(id);
    if (cs && cs.act && ACT_ORDER.includes(cs.act) && actIdx(cs.act) > actIdx(this.S.act)) this._applyAct(cs.act, true);
    const p = this.cs.play(id, o).then((r) => {
      this._queuedCs.delete(id);
      this.S.seen[id] = { skipped: !!r.skipped, sol: this.game.state.clock.sol };
      for (const c of (cs && cs.clues) || []) this.clue(c);
      this._log(`Cutscene ${id}${r.skipped ? " (skipped)" : ""}: ${cs ? cs.title : ""}`);
      this.notify("cutscene_end", { id, skipped: r.skipped });
      const next = cs && cs.next ? String(cs.next) : "";
      const chain = next.match(/^(C\d+[ab]?)\b/);
      if (chain && chain[0] !== id) {
        // C18a / C18b roll into the credits and C20; the cutscene_end of the ending fires after them
        this._credits().then(() => this.playCutscene(chain[0])).then(() => { this.fire({ on: "cutscene_end", id }); this._finalCard(); });
      } else {
        this.fire({ on: "cutscene_end", id });
        if (id === "C19") this._finalCard("captured");
      }
      this._save();
      return r;
    });
    this._csPromise = p;
    return p;
  }
  async _credits() {
    const ui = this.game.hud.ui; if (!ui || !ui.card) return;
    if (ui.cutscene) ui.cutscene.start({ letterbox: true, skippable: true });
    try { await ui.card({ eyebrow: "MARS: FRONTIER PIONEER", title: "CREDITS", sub: "Story: the owner's Story Bible · voices: Piper (local) · terrain and imagery: USGS Astrogeology, NASA / JPL / University of Arizona / MSSS", seconds: this.game.headless ? 0.4 : 5 }); }
    finally { if (ui.cutscene && ui.cutscene.active) ui.cutscene.end(); }
  }

  /* ── missions ── */
  startMission(id, o = {}) {
    const D = this.D, S = this.S, m = D && D.mission(id);
    if (!m || S.done[id] || S.active[id]) return false;
    const run = { idx: 0, prog: {}, done: {}, bonus: {}, t0: this._snapshot(), started: this.game.state.clock.sol, standIn: null };
    S.active[id] = run;
    if (m.kind === "main" || m.kind === "optional" || m.kind === "fugitive" || !S.focus) S.focus = id;
    if (ACT_ORDER.includes(m.act) && actIdx(m.act) > actIdx(S.act)) this._applyAct(m.act);
    if (m.hidden_time) this._anchor(id);
    S.avail = S.avail.filter((x) => x !== id);
    if (S.focus === id) this._pointer();
    this._log(`Mission ${id} started: ${m.title}`);
    // where it plays
    const site = m.site;
    if (!GENERIC.has(site) && site !== this.loadedSite && !o.quiet) {
      this._installed.then((inst) => {
        if (inst.has(site) && typeof window.__marsTravel === "function" && !o.noTravel) this._travelWhenQuiet(site, m);
        else { run.standIn = site; S.notice = `${SITE_NAMES[site] || humanise(site)} is ${inst.has(site) ? "installed" : "not installed yet"}: a stand-in here`; this.game.hud.toast(`${esc(SITE_NAMES[site] || humanise(site))} is ${inst.has(site) ? "installed" : "not installed yet"}<small>this chapter plays as a stand-in here: its places are marked around the base</small>`, 7); this._standInCard(site); }
      });
    }
    if (!o.quiet) this._say(m.dialogue && m.dialogue.start);
    this._enterAll(m, run);
    this.game.emit("story:mission", { id, title: m.title });
    this._publish(); this._save();
    return true;
  }
  /** Travel once the mission's opening lines and any cutscene are over (the shell saves and reloads). */
  async _travelWhenQuiet(site, m) {
    const sp = speech(this.game);
    for (let i = 0; i < 600 && (this.cs.active || sp.busy || this._sleeping); i++) await new Promise((r) => setTimeout(r, 250));
    if (!this.S.active[m.id] || this.loadedSite === site) return;
    this.S.site = site; this._save();
    const ct = this.chapterTitle();
    window.__marsTravel(site, { act: ct.act, chapter: m.title, reason: `${m.id} ${m.title}`, mission: m.id });
  }
  _standInCard(site) {
    const ui = this.game.hud.ui; this.S.lastStandIn = site;
    if (ui && ui.card && !this.cs.active && !this.game.headless) ui.card({ eyebrow: "STAND-IN", title: (SITE_NAMES[site] || humanise(site)).replace(/^the /, "").toUpperCase(), sub: "this site is not installed: its places are laid out around the base", seconds: 3.2 });
  }
  _enterAll(m, run) {
    for (let i = 0; i < m.objectives.length; i++) { const ob = m.objectives[i]; if (ob.optional || i === run.idx) this._enter(m, run, ob); }
    // skip optional objectives at the front of the sequence
    while (m.objectives[run.idx] && m.objectives[run.idx].optional) { run.idx++; if (m.objectives[run.idx]) this._enter(m, run, m.objectives[run.idx]); }
  }
  _enter(m, run, ob) {
    const P = run.prog[ob.id] || (run.prog[ob.id] = { n: 0, entered: false });
    if (P.entered) return;
    P.entered = true;
    const h = this.O[ob.type];
    try { if (h && h.enter) h.enter(ob, P, run, m); } catch (e) { console.warn("[story] enter", ob.type, e); }
  }
  /** Mark an objective done (from a checker). */
  objectiveDone(m, ob, o = {}) {
    const run = this.S.active[m.id]; if (!run || run.done[ob.id]) return;
    run.done[ob.id] = true;
    if (ob.optional) run.bonus[ob.id] = true;
    const h = this.O[ob.type]; try { if (h && h.exit) h.exit(ob, run.prog[ob.id] || {}, run, m); } catch (e) { console.warn("[story] exit", e); }
    if (ob.record) this.setVar(ob.record.var, ob.record.value);
    if ((ob.unit === "PIONEER_11" || /^p11_/.test(ob.choice_id || "")) && (this.S.seen.C10 || this.S.done["3.6"])) this._p11Reports();
    if (!o.silent && !o.linesPlayed) this._say(m.dialogue && m.dialogue.progress && m.dialogue.progress[ob.id]);
    this.game.emit("story:objective", { mission: m.id, objective: ob.id, type: ob.type });
    this.fire({ on: "objective_complete", mission: m.id, objective: ob.id });
    // advance past everything already done
    while (m.objectives[run.idx] && (run.done[m.objectives[run.idx].id] || m.objectives[run.idx].optional)) run.idx++;
    if (run.idx >= m.objectives.length) { this._complete(m, o); return; }
    this._enter(m, run, m.objectives[run.idx]);
    if (!o.silent) this.game.hud.toast(`Done: ${esc(ob.text)}<small>Next: ${esc(m.objectives[run.idx].text)}</small>`, 4.5);
    this._publish(); this._save();
  }
  _complete(m, o = {}) {
    const S = this.S, g = this.game, run = S.active[m.id];
    delete S.active[m.id];
    S.done[m.id] = { sol: g.state.clock.sol, missionSol: S.missionSol, bonus: Object.keys(run.bonus || {}).length };
    for (const ob of m.objectives) { const h = this.O[ob.type]; if (h && h.cleanup) try { h.cleanup(ob, run.prog[ob.id] || {}, run, m); } catch { /* fine */ } }
    if (!o.silent) this._say(m.dialogue && m.dialogue.complete);
    const xp = (m.rewards && m.rewards.xp) || 0;
    if (xp > 0 && S.act !== "V" && S.act !== "fugitive") { const P = getSystem("progress"); if (P && P.api && P.api.award) P.api.award(xp, `story: ${m.title}`, { mission: m.id }); }
    for (const c of m.clues || []) this.clue(c);
    for (const [k, v] of Object.entries(m.sets || {})) this.setVar(k, v);
    for (const u of (m.rewards && m.rewards.unlocks) || []) if (!S.items.includes(u)) S.items.push(u);
    this._joinUnits();
    if ((m.objectives || []).some((o) => o.unit === "PIONEER_11")) this._p11Reports();
    this._log(`Mission ${m.id} complete: ${m.title}`);
    g.emit("story:complete", { id: m.id, xp });
    if (S.focus === m.id) S.focus = Object.keys(S.active).find((id) => { const x = this.D.mission(id); return x && (x.kind === "main" || x.kind === "fugitive"); }) || Object.keys(S.active)[0] || null;
    this.fire({ on: "mission_complete", id: m.id });
    // a mission whose sequel waits for a sleep: say so
    this._checkWake();
    if (!o.silent && !this.cs.active) g.hud.toast(`${esc(m.title)} complete${xp && S.act !== "V" && S.act !== "fugitive" ? `<small>+${xp} contribution credit</small>` : ""}`, 5);
    this._publish(); this._save();
  }
  _checkWake() {
    const S = this.S;
    const waits = this.D.missions.some((m) => !S.done[m.id] && !S.active[m.id] && m.trigger && m.trigger.on === "wake" && (!m.trigger.after_mission || S.done[m.trigger.after_mission]) && (!m.trigger.after_cutscene || S.seen[m.trigger.after_cutscene]))
      || this.D.cut.cutscenes.some((c) => !S.seen[c.id] && c.trigger.on === "wake" && (!c.trigger.after_mission || S.done[c.trigger.after_mission]));
    if (waits && !S.pendingWake) { S.pendingWake = true; speech(this.game).say("KEEPER.bark.sleep_recommend", { style: "radio", bark: true }); }
  }
  _wakeAnvil() {
    const C = getSystem("caretakers"), u = C && C.api ? C.api.get("ANVIL") : null; if (!u || u.state !== "dormant") return;
    const H = getSystem("halo"), pk = H && H.api ? H.api.get(u.pkg) : null;
    if (pk) { u.x = pk.x + 2.6; u.z = pk.z + 1.4; }
    C.api.wake("ANVIL");
  }
  /** Founders join when the story says so (unit.<X>.joined), at the home base if that is their settlement. */
  _joinUnits() {
    const C = getSystem("caretakers"); if (!C || !C.api || !this.D) return;
    const h = this.home();
    for (const [k, v] of Object.entries(this.S.vars)) {
      const m = k.match(/^unit\.([A-Z_0-9]+)\.joined$/); if (!m || !v) continue;
      const name = m[1]; if (C.api.get(name)) continue;
      if (this.S.act === "fugitive") continue;
      const stew = this.S.vars["unit." + name + ".steward_of"];
      if ((stew || "jezero") !== this.loadedSite && !(/^(nili_fossae_works|isidis_junction|libya_montes_yard|depot_syrtis)$/.test(stew || "") && this.loadedSite === "jezero")) continue;     // stewards live at their settlements
      C.api.spawn({ callsign: name, founder: true, x: h.x + 10 + Math.random() * 8, z: h.z + 6 + Math.random() * 8 });
    }
  }
  _snapshot() { const g = this.game, a = getSystem("avatar"), st = a && a.api && a.api.stats; return { odo: g.vehicle.odometer, walked: st ? st.walked_m : 0, sol: g.state.clock.sol }; }

  /* ── acts, the clock, the filter ── */
  _applyAct(a, quiet = false) {
    const S = this.S, was = S.act;
    S.act = a;
    if (!S.acts.includes(a) && !quiet && !this._actCardShown?.has(a)) this._actCard(a);
    if (!S.acts.includes(a)) S.acts.push(a);
    const ui = this.game.hud.ui;
    const filter = a === "fugitive" ? "burnt" : actIdx(a) >= actIdx("IV") ? "cracking" : "intact";
    if (filter !== S.filter || (ui && ui.filterState !== filter)) { S.filter = filter; if (ui && ui.setFilterState) ui.setFilterState(filter); }
    const A = getSystem("audio"); if (A && A.api && A.api.telemetry) A.api.telemetry(a === "fugitive");
    if (a === "fugitive") this._enable(true);
    this._refreshAvail();
    void was;
  }
  markActCard(eyebrow) { const a = Object.keys(ACT_TITLES).find((k) => ACT_TITLES[k][0] === String(eyebrow || "").trim()); if (a) { (this._actCardShown || (this._actCardShown = new Set())).add(a); } }
  _actCard(a) {
    const T = ACT_TITLES[a], ui = this.game.hud.ui; if (!T || !ui || !ui.card) return;
    // a cutscene that carries its own act card shows it there instead
    const cuts = this.D ? this.D.cut.cutscenes.filter((c) => c.act === a && (c.beats || []).some((b) => b.kind === "title" && b.style === "act")) : [];
    if (cuts.some((c) => !this.S.seen[c.id])) return;
    (this._actCardShown || (this._actCardShown = new Set())).add(a);
    ui.card({ eyebrow: T[0], title: T[1], seconds: this.game.headless ? 0.3 : 3.6 });
  }
  _anchor(id) {
    const D = this.D, a = D && D.anchors[id], S = this.S, c = this.game.state.clock; if (!a) return;
    S.anchor = id;
    if (a.mars_sols_since_landing >= S.trueSol) S.trueSol = a.mars_sols_since_landing;
    if (a.mission_sol > S.missionSol) S.missionSol = a.mission_sol;
    if (c.sol < S.missionSol + 1) c.sol = S.missionSol + 1;
    c.ls = (S.ls0 + S.trueSol * MARS.lsPerSol) % 360;
    this._world();
  }
  /** How far the true clock moves for one mission sol of sleep: toward the next anchor. */
  _sleepRate() {
    const D = this.D, S = this.S, order = D.anchorOrder, i = order.indexOf(S.anchor);
    for (let k = i + 1; k < order.length; k++) {
      const a = D.anchors[order[k]];
      if (a.mars_sols_since_landing > S.trueSol) return Math.max(1, (a.mars_sols_since_landing - S.trueSol) / Math.max(1, a.mission_sol - S.missionSol));
    }
    return 1;
  }
  /** Dormancy. where: "base" | "rover" | undefined (wherever allowed). */
  async sleep(where) {
    const g = this.game, S = this.S;
    if (!S.campaign || this.cs.active || this._sleeping) return { ok: false, reason: "not now" };
    const at = this._sleepWhere();
    if (!at) { g.hud.toast("Dormancy needs shelter<small>the rover, or within reach of a base or the lander</small>", 4); return { ok: false, reason: "no shelter" }; }
    this._sleeping = true;
    const ui = g.hud.ui, sp = speech(g);
    sp.say("KEEPER.bark.sleep_start", { style: "radio" });
    if (ui && ui.fadeTo) await ui.fadeTo(true, g.headless ? 0 : 1.2);
    const c = g.state.clock, toMorning = ((7 / 24 * MARS.solSeconds - c.tod) + MARS.solSeconds) % MARS.solSeconds + MARS.solSeconds * 0.0;
    const sim = toMorning < 3600 ? toMorning + MARS.solSeconds : toMorning;
    const rate = this._sleepRate(), before = S.trueSol;
    const C = getSystem("caretakers"); if (C && C.api) C.api.fastForward(sim);
    const H = getSystem("halo"); if (H && H.api) H.api.advance(sim);
    advanceClock(c, sim);
    S.missionSol = Math.max(S.missionSol + 1, c.sol - 1);
    S.trueSol = before + rate; S.sleptSols = Math.round(S.trueSol - before); S.sleptAnchor = null;
    c.ls = (S.ls0 + S.trueSol * MARS.lsPerSol) % 360;
    const T = getSystem("tiers"); if (T && T.api) T.api.grow(Math.max(1, S.sleptSols / 10));
    for (const id of Object.keys(S.active)) { const m = this.D.mission(id), run = S.active[id]; for (const ob of m.objectives) if (ob.type === "survive" && !run.done[ob.id]) { const P = run.prog[ob.id] || (run.prog[ob.id] = { n: 0 }); P.t = (P.t || 0) + sim; } }
    this._world();
    if (ui && ui.card && !g.headless) await ui.card({ eyebrow: "DORMANCY", title: `MISSION SOL ${S.missionSol}`, sub: "construction units continued", seconds: 2.2 });
    if (ui && ui.fadeTo) await ui.fadeTo(false, g.headless ? 0 : 1);
    this._sleeping = false;
    sp.say("KEEPER.bark.wake", { style: "radio", bark: true });
    if (C && C.api) setTimeout(() => C.api.react("wake"), 3000);
    this.notify("sleep", { where: at });
    S.pendingWake = false;
    this.fire({ on: "wake" });
    this._save();
    return { ok: true, where: at, sim };
  }
  _sleepWhere() {
    const g = this.game, a = getSystem("avatar"), api = a && a.api;
    if (api && api.inside) return "base";
    if (!this.onFoot() && g.mode !== "onfoot") { const b = this.base(), p = this.playerPos(); let nearBase = false; try { nearBase = !!b && b.bases().some((x) => Math.hypot(x.x - p.x, x.z - p.z) < 200); } catch { nearBase = false; } return nearBase ? "base" : "rover"; }
    const p = this.playerPos(), b = this.base(); let near = false;
    try { near = !!b && b.bases().some((x) => Math.hypot(x.x - p.x, x.z - p.z) < 120); } catch { near = false; }
    if (near) return "base";
    if (this.S.lander && Math.hypot(this.S.lander.x - p.x, this.S.lander.z - p.z) < 40) return "base";
    return null;
  }

  /* ── places ── */
  home() {
    const b = this.base(), S = this.S;
    try {
      if (b) { const list = b.bases(); const hb = list.find((x) => x.id === S.homeBase) || list[0]; if (hb) { if (!S.homeBase) S.homeBase = hb.id; return { x: hb.x, z: hb.z, name: hb.name || "Outpost" }; } }
    } catch { /* none */ }
    if (S.markers.outpost_site && (!S.markers.outpost_site.site || S.markers.outpost_site.site === this.loadedSite)) return S.markers.outpost_site;
    if (S.lander && this._landerHere()) return { x: S.lander.x + 30, z: S.lander.z + 10, name: "the lander" };
    const st = this.game.site.start; return { x: st.x, z: st.z, name: "the landing" };
  }
  /** A story place by id: a real POI of the loaded site, a story object, a unit, or a stand-in laid out around the base. */
  place(id) {
    if (!id) return null;
    const g = this.game, S = this.S;
    if (typeof id === "object") return id;
    let site = null, key = String(id);
    const dot = key.indexOf(".");
    if (dot > 0 && !/^(CODEX|LOG|DRAW|MEM|GEN1_LOG|CITS)\./.test(key)) { site = key.slice(0, dot); key = key.slice(dot + 1); }
    const here = !site || site === this.loadedSite || GENERIC.has(site);
    if (here) { const p = g.site.pois.find((q) => q.id === key); if (p) return { x: p.x, z: p.z, name: p.name, note: p.note, id: key }; }
    // story objects
    const L = this._landerHere() ? S.lander : null, h = this.home();
    if (/^lander/.test(key) || key === "dune_ridge_landing" && false) return L ? { x: L.x, z: L.z, name: "the lander", id: key } : null;
    if (key === "dune_ridge_landing" || key === "dune") { const d = this._dunePos(); return d ? { x: d.x, z: d.z, name: "the dune ridge", id: key } : null; }
    if (/^pkg_/.test(key)) { const H = getSystem("halo"), p = H && H.api && H.api.get(key); if (p) return { x: p.x, z: p.z, name: "the pod", id: key }; }
    if (S.markers[key] && (!S.markers[key].site || S.markers[key].site === this.loadedSite)) return Object.assign({ id: key }, S.markers[key]);
    if (key === "outpost_site") return null;
    if (key === "landing") return L ? { x: L.x, z: L.z, name: "the landing site", id: key } : null;
    if ((!site || site === "jezero" || GENERIC.has(site)) && (/^(outpost_module_1|outpost_roof|heritage|decommissioning_bay_helmet_rack|rover_food_compartment|p1_field_notebook|reference_hand_scan|comms_tower|isru_plant)$/.test(key) || /^outpost_(module|roof)/.test(key))) {
      const b = this.base(); let mods = [];
      try { mods = b ? b.modules().filter((m) => m.built) : []; } catch { mods = []; }
      const want = key === "comms_tower" ? /comms/ : key === "isru_plant" ? /isru/ : /^hab/;
      const m = mods.find((x) => want.test(x.type)) || mods[0];
      if (key === "rover_food_compartment") return { x: g.vehicle.p.x, z: g.vehicle.p.z, name: "the rover", id: key };
      if (m) return { x: m.x, z: m.z, name: key === "outpost_roof" ? "the outpost roof" : (b.balance[m.type] || {}).name || "the outpost", id: key };
      return Object.assign({ id: key }, h);
    }
    if (key === "rover_intercom" || key === "rover") return { x: g.vehicle.p.x, z: g.vehicle.p.z, name: "the rover", id: key };
    if (/^dome_1|^dome_2|^jezero_dome/.test(key)) { const T = getSystem("tiers"), s = T && T.api ? T.api.structures().find((x) => x.type === "dome") : null; if (s) return { x: s.x, z: s.z, name: "Jezero Dome", id: key }; }
    if (key === "table_long" || key === "hideout" || key === "hideout_wall") { const T = getSystem("tiers"), s = T && T.api ? T.api.structures().find((x) => x.type === (key === "table_long" ? "table_long" : "hideout")) : null; if (s) return { x: s.x, z: s.z, name: humanise(key), id: key }; }
    const C = getSystem("caretakers"), u = C && C.api ? C.api.get(key) : null;
    if (u && u.state !== "away") return { x: u.x, z: u.z, name: u.callsign, id: key, unit: u };
    // a stand-in: deterministic around the home base, saved so it never moves
    const sk = (site || this.loadedSite) + "." + key;
    if (S.places[sk]) return Object.assign({ id: key, standIn: true }, S.places[sk]);
    const r = rng(hash(sk) ^ S.seed);
    let best = null;
    for (let k = 0; k < 14; k++) {
      const a = r() * Math.PI * 2, d = 220 + r() * 650, x = h.x + Math.sin(a) * d, z = h.z + Math.cos(a) * d;
      if (!g.site.inside(x, z, 200)) continue;
      const s = g.surface.slopeDeg(x, z, 4);
      if (!best || s < best.s) best = { x, z, s };
      if (s < 8) break;
    }
    if (!best) best = { x: h.x + 120, z: h.z + 80 };
    const p = S.places[sk] = { x: Math.round(best.x), z: Math.round(best.z), name: humanise(key) + (site && site !== this.loadedSite ? ` (stand-in for ${SITE_NAMES[site] || humanise(site)})` : "") };
    return Object.assign({ id: key, standIn: true }, p);
  }
  /** Camera targets named in cutscene beats ("pod streak", "jezero.delta_front", "P1 silhouette...") and sky objects. */
  resolveTarget(text, cam = {}) {
    const t = String(text || "").toLowerCase(), g = this.game, p = this.playerPos();
    const pt = (q, world = true) => ({ x: q.x, y: g.surface.height(q.x, q.z) + 1.5, z: q.z, name: text, world });
    if (/sky|star|halo|station|burn|braking|light|meteor|lights/.test(t) && !/city|lit/.test(t)) {
      const dir = /halo|station/.test(t) && getSystem("halo") ? getSystem("halo").api.stationDir() : [0.2, 0.8, -0.5];
      return { sky: true, dir, x: p.x, y: 0, z: p.z, name: text };
    }
    if (/pod|package|streak/.test(t)) {
      const H = getSystem("halo"), list = H && H.api ? H.api.packages() : [], pk = list.filter((x) => x.phase === "final")[0] || list[list.length - 1];
      const m = pk && H.halo && H.halo.meshes.get(pk.id);
      if (m) return { at: () => ({ x: m.position.x, y: m.position.y + 1.5, z: m.position.z }), x: m.position.x, y: m.position.y, z: m.position.z, name: text, world: true };
      if (pk) return pt(pk);
    }
    const poi = (cam.target || "").match(/^([a-z_]+)\.([a-z0-9_]+)$/);
    if (poi) { const q = this.place(cam.target); if (q) return pt(q); }
    if (/lander/.test(t) && this.S.lander) return pt(this.S.lander);
    if (/dome|city|outpost|module|roof|plaque/.test(t)) return pt(this.home());
    if (/anvil|unit|machine/.test(t)) { const C = getSystem("caretakers"), u = C && C.api && C.api.nearest(p.x, p.z, 500); if (u) return pt(u); }
    if (/hand/.test(t)) return { x: p.x, y: g.surface.height(p.x, p.z) + 0.6, z: p.z, name: "hands" };
    if (/rover/.test(t)) return pt(g.vehicle.p);
    return pt(p, false);
  }

  /* ── the world the story adds: the lander, the dune ── */
  _placeLander(fresh) {
    const g = this.game, S = this.S;
    if (fresh || !S.lander) {
      const L = g.site.pois.find((p) => p.id === "landing") || g.site.start;
      S.lander = { x: L.x + 24, z: L.z - 18, yaw: 0.6, site: this.loadedSite };
    }
    if (!this.lander) {
      const grp = new THREE.Group(); grp.name = "story-lander";
      const shell = new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.6, metalness: 0.3 }), dark = new THREE.MeshStandardMaterial({ color: 0x33373c, roughness: 0.6, metalness: 0.4 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 3.0, 20), shell); body.position.y = 1.9;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.4, 20), shell); cone.position.y = 4.1;
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.5, 0.4, 20), new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.95 })); shield.position.y = 0.4;
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.4, 0.1), dark); hatch.position.set(0, 2.0, 2.05); hatch.rotation.x = -0.25;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 1.4), new THREE.MeshStandardMaterial({ color: 0x1d2a4a, roughness: 0.3, metalness: 0.6 })); panel.position.set(2.8, 2.6, 0); panel.rotation.z = -0.35; panel.name = "lander-array";
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), dark); mast.position.set(-0.8, 5.2, 0); mast.name = "lander-mast";
      const tilt = new THREE.Group(); tilt.add(body, cone, shield, hatch, panel, mast);
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6), dark); leg.position.set(Math.cos(a) * 2.2, 0.6, Math.sin(a) * 2.2); leg.rotation.z = Math.cos(a) * 0.5; leg.rotation.x = -Math.sin(a) * 0.5; if (k === 1) leg.scale.y = 0.4; tilt.add(leg); }
      tilt.rotation.z = 34 * Math.PI / 180; tilt.position.y = 0.9;
      grp.add(tilt);
      grp.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
      this.lander = grp; this.root.add(grp);
      // the dune that will one day bury it
      const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa8734f, roughness: 1 }));
      dune.scale.set(22, 3.2, 8); dune.name = "story-dune"; this.dune = dune; this.root.add(dune);
    }
    this._world();
  }
  /** The lander (and its dune) belong to the landing site only. */
  _landerHere() { const L = this.S.lander; return !!L && (!L.site || L.site === this.loadedSite); }
  _dunePos() {
    const L = this._landerHere() ? this.S.lander : null; if (!L) return null;
    const k = Math.min(1.25, this.S.trueSol / 9880), off = 20 - 24 * k, a = L.yaw + 2.4;
    return { x: L.x + Math.sin(a) * (off + 9), z: L.z + Math.cos(a) * (off + 9), off };
  }
  /** World changes from the true date: the dune migrates over the lander, dust settles on it. */
  _world() {
    const L = this.S.lander, g = this.game; if (!L || !this.lander) return;
    const here = this._landerHere(); this.lander.visible = here; this.dune.visible = here; if (!here) return;
    const y = g.surface.height(L.x, L.z), bury = Math.max(0, Math.min(1, (this.S.trueSol - 7000) / 2880));
    this.lander.position.set(L.x, y - bury * 3.2, L.z); this.lander.rotation.y = L.yaw;
    const d = this._dunePos();
    if (d) { this.dune.position.set(d.x, g.surface.height(d.x, d.z) - 0.9, d.z); this.dune.rotation.y = L.yaw + 2.4 + Math.PI / 2; }
    const dust = Math.min(1, this.S.trueSol / 4000);
    this.lander.traverse((o) => { if (o.isMesh && o.material && o.material.color && !o.userData.c0) o.userData.c0 = o.material.color.clone(); if (o.isMesh && o.userData.c0) o.material.color.copy(o.userData.c0).lerp(new THREE.Color(0x8a5a3c), dust * 0.6); });
  }

  /* ── speech helpers ── */
  _say(lines) { if (!lines || !lines.length) return Promise.resolve(); return speech(this.game).seq(lines, { when: () => this.S.vars }); }

  /* ── notifications from everything else ── */
  notify(type, data = {}) {
    if (!this.S.campaign || !this.D) return;
    const S = this.S;
    if (type === "cutscene_start" && this._stargaze) this._endStargaze(false);
    if (type === "cutscene_start" && data.id === "C03") this._wakeAnvil();
    if (type === "cutscene_end" && data.id === "C03") this._wakeAnvil();
    for (const id of Object.keys(S.active)) {
      const m = this.D.mission(id), run = S.active[id]; if (!m || !run) continue;
      m.objectives.forEach((ob, i) => {
        if (run.done[ob.id]) return;
        const h = this.O[ob.type]; if (!h || !h.on) return;
        const current = i === run.idx, relaxed = ob.optional || h.relaxed;
        if (!current && !relaxed) return;
        const P = run.prog[ob.id] || (run.prog[ob.id] = { n: 0, entered: false });
        let r = false; try { r = h.on(type, data, ob, P, run, m); } catch (e) { console.warn("[story] on", ob.type, e); }
        if (r) this.objectiveDone(m, ob, typeof r === "object" ? r : {});
      });
    }
    if (type === "ask_keeper") this.fire({ on: "ask_keeper", question_id: data.id });
    if (type === "choose") this.fire({ on: "choose", choice_id: data.choice_id, option: data.option });
    if (type === "glitch") { const C = getSystem("caretakers"); if (C && C.api && (data.unfiltered || actIdx(S.act) >= actIdx("IV"))) C.api.unfiltered(Math.max(0.12, Math.min(0.6, data.seconds || 0.15))); }
    this._publish();
  }
  /** A KEEPER question that plays a cutscene instead of its plain answer (C12, C13). */
  keeperCutscene(qid) {
    const D = this.D, S = this.S; if (!D) return null;
    const c = D.cut.cutscenes.find((x) => !S.seen[x.id] && x.trigger.on === "ask_keeper" && x.trigger.question_id === qid && (!x.trigger.mission || S.active[x.trigger.mission]));
    if (c) { this.playCutscene(c.id).then(() => this.notify("ask_keeper", { id: qid, viaCutscene: true })); return c.id; }
    return null;
  }
  keeperCtx() {
    const D = this.D, S = this.S, a = D && D.anchors[S.anchor];
    return { D, stage: S.anchor, act: S.act, vars: S.vars, missionSol: S.missionSol, trueSol: S.trueSol, sleptSols: S.sleptSols, sleptAnchor: S.sleptAnchor, missionYear: a ? a.mission_year : 1,
      callsign: (slot) => { const C = getSystem("caretakers"), u = C && C.api ? C.api.get(String(slot || "").toUpperCase()) : null; if (!u || !D) return null; const t = D.population.templates.find((x) => x.id === u.template) || {};
        return { callsign: `${u.unitNo}. ${u.callsign}`, donor_first: t.first_name, donor_surname: t.surname, hometown: t.hometown, occupation: t.occupation, scan_year: t.scanned || 2058 }; } };
  }
  event(id) { this.notify("event", { event: id }); this.fire({ on: "event", id }); }
  engineText(csId, b) {
    const S = this.S, v = S.vars;
    if (csId === "C18b") {
      const truth = ["builder", "honest"].includes(v.truth_told_lead), names = this._namesUsed();
      return "OUTPOST JEZERO · FOUNDED 2061 · " + (truth ? "PIONEER-1" : "MERIDIAN CONSORTIUM") + (names.length ? "\n" + names.join(" · ") : "");
    }
    if (csId === "C19") { const msd = 66702 + Math.round(S.trueSol), days = Math.round(S.trueSol * 1.0274912517), d = new Date(Date.UTC(2061, 7, 21) + days * 86400000); return `MSD ${msd} · ${d.toISOString().slice(0, 10)}`; }
    return String(b.text || "").replace(/^\[engine\]\s*/, "");
  }
  /** A unit's real (donor) name: founders and the Second Ring from the dialogue files, everyone else from their template. */
  donorName(callsign) {
    const D = this.D; if (!D) return null;
    const f = D.founders[callsign] || D.second[callsign];
    if (f && f.donor && f.donor.name) return f.donor.name.replace(/\s*'[^']*'\s*/, " ").replace(/\s+/g, " ").trim();
    if (f && f.donor_name) return f.donor_name;
    const C = getSystem("caretakers"), u = C && C.api ? C.api.get(callsign) : null, t = u && D.population.templates.find((x) => x.id === u.template);
    return t ? `${t.first_name} ${t.surname}` : null;
  }
  /** Names as collectibles: once KEEPER has opened a unit's file (names.known.X), talking to it offers its real name.
   *  Used before the Recall, it is kept (names.used.X): that unit's "named" last words at the Recall, and the ending's list. */
  async offerName(callsign) {
    const S = this.S, ui = this.game.hud.ui, C = getSystem("caretakers"), u = C && C.api ? C.api.get(callsign) : null;
    if (!S.vars["names.known." + callsign] || S.vars["names.used." + callsign] || (u && u.recalled) || callsign === "ANVIL" || !ui || !ui.choose) return false;
    const full = this.donorName(callsign); if (!full) return false;
    const k = await ui.choose({ prompt: `What do you call ${callsign}?`, options: [callsign, full.split(" ")[0]] });
    if (k !== 1) return false;
    this.setVar("names.used." + callsign, true);
    this.game.emit("story:named", { unit: callsign, name: full });
    const F = this.D.founders[callsign] || this.D.second[callsign], nl = F && F.reactions && F.reactions.named;
    if (nl && nl.length) await speech(this.game).seq(nl);
    return true;
  }
  _namesUsed() {
    const out = [];
    for (const [k, val] of Object.entries(this.S.vars)) { const m = k.match(/^names\.used\.([A-Z_0-9-]+)$/); if (!m || !val) continue; out.push(String(this.donorName(m[1]) || humanise(m[1])).toUpperCase()); }
    return out;
  }
  /** After C10 no other pioneer helps: when the Pioneer-11 encounter is over he reports P1, and RECALL knows where he is. */
  _p11Reports() {
    const S = this.S; if (S.vars["recall.alerted"]) return;
    const D = this.D, vars = (D && D.acts.variables) || {};
    S.vars["recall.alerted"] = true; S.vars.p11_reported = true; S.vars.p11_confronted = true;
    for (const k of Object.keys(vars)) if (/^(p11_|recall\.|architect\.)/.test(k) && !/[<*]/.test(k) && S.vars[k] == null) S.vars[k] = true;     // whatever the revised acts.json names for it
    this._log("Pioneer-11 reported PIONEER-1: RECALL knows his position");
    this.game.hud.setAlert && this.game.hud.setAlert("recall", "RECALL knows your position", "warning");
    this.game.emit("story:recall_alerted", {});
  }

  /* ── endings ── */
  _ending(kind) {
    const S = this.S;
    if (kind === "fugitive") {
      S.ending = "fugitive";
      this._applyAct("fugitive", true);
      const H = getSystem("halo"); if (H && H.api) H.api.setEnabled(false);
      const C = getSystem("caretakers"); if (C && C.api) for (const u of C.api.list()) C.api.recall(u.callsign);
      S.hunters = true;
    } else if (kind === "rest") { S.ending = "rest"; }
  }
  async _finalCard(kind = this.S.ending) {
    const ui = this.game.hud.ui, S = this.S;
    if (!kind) return;
    const card = kind === "rest" ? { eyebrow: "REST", title: "PIONEER-1", sub: this.engineText("C18b", {}).replace(/\n/g, " · ") }
      : kind === "captured" ? { eyebrow: "RECALLED", title: "PIONEER-1 · DECOMMISSIONED", sub: this.engineText("C19", {}) }
        : kind === "high_lonely" ? { eyebrow: "THE HIGH LONELY", title: "THE END OF THE WORLD", sub: "the cities he built, lit like lanterns, far below" }
          : { eyebrow: "FUGITIVE", title: "THE REST OF THE PLANET", sub: "CHARGE · HEAT · WEAR. No HALO, no packages, no credit." };
    S.finalCard = card.eyebrow;
    this.game.emit("story:final", { ending: kind, card });
    this._log(`Final card: ${card.eyebrow}`);
    if (ui && ui.card) await ui.card(Object.assign({ seconds: this.game.headless ? 0.6 : 6 }, card));
    if (kind === "rest" || kind === "captured") { S.over = true; this._endScreen(card); }
    this._save();
  }
  _endScreen(card) {
    const el = this.endEl; if (!el) return;
    el.querySelector(".eyebrow").textContent = card.eyebrow; el.querySelector("h2").textContent = card.title; el.querySelector(".se-sub").textContent = card.sub;
    el.hidden = false;
    const P = window.GeoIDPad; if (P && P.connected) setTimeout(() => P.focus.first(el), 60);
  }

  /* ── hunters (the Fugitive epilogue) ── */
  _hunters(dt) {
    const S = this.S, g = this.game;
    const patrol = !S.hunters && S.vars["recall.alerted"] && S.act === "V";          // a team waits at Jezero: it watches, it does not take him yet
    if ((!S.hunters && !patrol) || S.over) { for (const h of this.hunters) this.root.remove(h.m); this.hunters = []; return; }
    if (!this.hunters.length) {
      const c = this.home(), q = this.playerPos(), hot = !patrol && S.vars["recall.alerted"];
      // reported by Pioneer-11: the hunt starts hot, a team already at the tunnel mouth (near him), and they have seen him
      for (let k = 0; k < (patrol ? 2 : 3); k++) { const m = hunterMesh(); this.root.add(m); const at = hot ? { x: q.x + 160 + k * 40, z: q.z - 120 } : { x: c.x + (k - 1) * 30, z: c.z + 40 }; this.hunters.push({ m, x: at.x, z: at.z, yaw: 0, seen: hot ? 6 : 0, close: 0 }); }
    }
    if (patrol) { for (const h of this.hunters) { h.m.position.set(h.x, g.surface.height(h.x, h.z), h.z); } return; }
    const p = this.playerPos(), v = g.vehicle, speed = this.onFoot() ? 2 : Math.abs(v.t.speed || 0);
    const radius = 450 + speed * 40;               // thermal signature: hotter when fast; the radio spike is a variable
    const radio = S.vars.radio_signature_max ? 3000 : 0;
    for (const h of this.hunters) {
      const d = Math.hypot(p.x - h.x, p.z - h.z), sees = d < Math.max(radius, radio);
      h.seen = sees ? 4 : Math.max(0, h.seen - dt);
      const tx = h.seen > 0 ? p.x : h.x + Math.sin(performance.now() / 9000 + h.x) * 20, tz = h.seen > 0 ? p.z : h.z + Math.cos(performance.now() / 9000 + h.z) * 20;
      const dx = tx - h.x, dz = tz - h.z, dd = Math.hypot(dx, dz) || 1, sp = h.seen > 0 ? 6.4 : 2;
      if (dd > 4) { h.x += dx / dd * sp * dt; h.z += dz / dd * sp * dt; h.yaw = Math.atan2(-dx, -dz); }
      h.m.position.set(h.x, g.surface.height(h.x, h.z), h.z); h.m.rotation.y = h.yaw;
      h.close = d < 14 ? h.close + dt : 0;
      if (h.close > 2 && !this.cs.active) { S.hunters = false; this.notify("captured", {}); this.fire({ on: "captured_by", hunter: "RECALL" }); return; }
    }
    this.S.vars["hunters.seen"] = this.hunters.some((h) => h.seen > 0);
  }

  /* ── prompts: the story's hold-to-use actions in the world ── */
  _actions() {
    const out = [], S = this.S;
    for (const id of Object.keys(S.active)) {
      const m = this.D.mission(id), run = S.active[id];
      m.objectives.forEach((ob, i) => {
        if (run.done[ob.id]) return;
        const h = this.O[ob.type]; if (!h || !h.action) return;
        if (i !== run.idx && !ob.optional && !h.relaxed) return;
        const P = run.prog[ob.id] || (run.prog[ob.id] = { n: 0 });
        let a = null; try { a = h.action(ob, P, run, m); } catch (e) { console.warn("[story] action", ob.type, e); }
        if (a) out.push(Object.assign({ m, ob, P }, a));
      });
    }
    // with nothing asked of him: talk to a founder nearby
    if (!out.length) {
      const C = getSystem("caretakers"), p = this.playerPos(), u = C && C.api && C.api.nearest(p.x, p.z, this.onFoot() ? 5 : 12, (x) => x.founder && !x.recalled);
      const u2 = u || (C && C.api && C.api.nearest(p.x, p.z, this.onFoot() ? 5 : 12, (x) => !x.recalled && this.S.vars["names.known." + x.callsign] && !this.S.vars["names.used." + x.callsign]));
      if (u2) out.push({ at: u2, r: this.onFoot() ? 5 : 12, text: `Talk to ${u2.callsign}`, idle: true, run: async () => { await this.offerName(u2.callsign); return C.api.bark(u2.callsign, "idle"); } });
    }
    return out;
  }
  _promptFrame(dt) {
    const g = this.game;
    if (!this.enabled || !g.live || this.cs.active || this.S.over) { this._showPrompt(null); return; }
    this._pacc = (this._pacc || 0) + dt;
    if (this._pacc > 0.2 || !this._cands) { this._pacc = 0; this._cands = this._actions(); }
    const onFoot = this.onFoot(), p = this.playerPos();
    let best = null, bd = Infinity;
    for (const a of this._cands) { const d = a.at ? Math.hypot(a.at.x - p.x, a.at.z - p.z) : 0; const r = a.r || (onFoot ? 6 : 25); if (d <= r && d < bd) { bd = d; best = a; } }
    // on foot the eva system's own hold-to-use comes first (hatch, airlock, a rock)
    const E = getSystem("eva"); let evaT = null; try { evaT = onFoot && E && E.api ? E.api.target() : null; } catch { evaT = null; }
    if (evaT && evaT.hold > 0) best = null;
    this._cur = best;
    if (!best) { this._hold = 0; this._showPrompt(null); return; }
    const k = g.input.keys, P = window.GeoIDPad, padOn = P && P.connected && g.padMode === "flight";
    if (onFoot) {
      const held = !!k.KeyE || (padOn && P.pressed("r1"));
      if (held && !this._block) { this._hold += dt; if (this._hold >= ACTION_HOLD) { this._hold = 0; this._block = true; this._do(best); } }
      else { if (!held) this._block = false; this._hold = 0; }
    }
    const key = onFoot ? (P && P.connected && g.input.lastDevice === "pad" ? P.glyph("r1") + " hold" : "<kbd>E</kbd> hold") : (P && P.connected && g.input.lastDevice === "pad" ? P.glyph("cross") : "<kbd>E</kbd>");
    this._showPrompt(`${key} ${esc(best.text)}`, this._hold / ACTION_HOLD);
  }
  _showPrompt(html, k = 0) {
    const h = this.game.hud;
    if (h && h.prompt) { if (html !== this._ph || k > 0) h.prompt("story", html, { k }); this._ph = html; return; }
  }
  async _do(a) {
    if (!a || this._doing) return;
    this._doing = true;
    try { await a.run(); } catch (e) { console.warn("[story] action", e); }
    this._doing = false; this._cands = null;
    this._publish(); this._save();
  }

  /* ── stargazing: look up for a while ── */
  async stargaze(o = {}) {
    const g = this.game, ui = g.hud.ui, c = g.state.clock;
    const want = o.time;
    const hourNow = c.tod / MARS.solSeconds * 24;
    const hours = { dusk: 19.2, predawn: 5.2, dawn: 6.4, night: 23 };
    const sun = g.sky ? g.sky.sun.sinEl : 0;
    if ((want && Math.abs(hourNow - hours[want]) > 1.2) || (!want && sun > -0.08)) {
      const to = hours[want || "night"];
      if (ui && ui.fadeTo) await ui.fadeTo(true, g.headless ? 0 : 0.8);
      const d = ((to - hourNow + 24) % 24) / 24 * MARS.solSeconds;
      const C = getSystem("caretakers"); if (C && C.api) C.api.fastForward(d);
      advanceClock(c, d);
      g.hud.toast(`You wait for ${want || "dark"}`, 3);
      if (ui && ui.fadeTo) await ui.fadeTo(false, g.headless ? 0 : 0.8);
    }
    const dir = this._skyDir(o.target);
    const sec = Math.max(4, Math.min(20, (o.duration_s || 24) / 3)) * (g.headless && o.fast ? 0.02 : 1);
    this._stargaze = { target: o.target || "sky", dir, t: 0, dur: sec, glitch: !!o.glitch, q0: g.camera.quaternion.clone(), expect: o.expect || "present" };
    if (o.target && (o.expect || "present") === "present" && ui && ui.tag && dir) this._sgTag = ui.tag("stargaze", { dir, text: this._skyName(o.target), kind: "sky" });
    if (o.target === "halo_chain" && ui && ui.tag) { this._chain = []; for (let k = 0; k < 12; k++) { const lon = 77 + (k - 6) * 30, ll = g.site.toLonLat(0, 0), d = stationDirection(ll.lat, ll.lon, lon); if (d[1] > 0) this._chain.push(ui.tag("halo-chain-" + k, { dir: d, text: `HALO-${k + 1}`, kind: "sky" })); } }
    if (o.glitch && ui && ui.glitch) setTimeout(() => { ui.glitch(0.7, 1.2); this.notify("glitch", { intensity: 0.7, seconds: 1, unfiltered: true }); }, sec * 400);
    return new Promise((res) => { this._sgDone = res; });
  }
  _skyName(t) { return { halo1: "HALO-1", unknown_obj_1: "SECOND LIGHT", earth: "EARTH", halo_chain: "", first_cloud: "CLOUD", city_lights_night_side: "LANTERNS", catalogue_field: "FIELD 7", phobos_transit: "PHOBOS" }[t] || String(t || "").toUpperCase(); }
  _skyDir(t) {
    const H = getSystem("halo"), st = H && H.api ? H.api.stationDir() : [0, 0.93, 0.37];
    if (t === "halo1" || !t) return st;
    if (t === "unknown_obj_1") { const n = this.S.missionSol % 7; return [st[0] - 0.22 + n * 0.015, st[1] - 0.05, st[2] + 0.05]; }
    if (t === "earth") { const days = this.S.trueSol * 1.0274912517, ph = Math.sin(2 * Math.PI * (days / 779.94 + 0.13)); return ph > 0 ? [-0.92, 0.18, 0.1] : [0.92, 0.16, -0.1]; }
    if (t === "first_cloud") return [0.9, 0.25, 0.2];
    if (t === "city_lights_night_side") return [0.1, -0.35, 0.9];
    return [0.05, 1, 0.05];
  }
  _endStargaze(done = true) {
    const sg = this._stargaze; if (!sg) return;
    this._stargaze = null;
    if (this._sgTag) { this._sgTag.remove(); this._sgTag = null; }
    for (const t of this._chain || []) t.remove(); this._chain = null;
    const r = this._sgDone; this._sgDone = null; if (r) r({ done, target: sg.target });
  }
  _stargazeFrame(dt) {
    const sg = this._stargaze; if (!sg) return;
    const cam = this.game.camera;
    sg.t += dt || 0.016;
    const k = Math.min(1, sg.t / 1.4);
    _t.set(sg.dir[0], sg.dir[1], sg.dir[2]).normalize().multiplyScalar(100).add(cam.position);
    _mm.lookAt(cam.position, _t, cam.up); _qq.setFromRotationMatrix(_mm);
    cam.quaternion.copy(sg.q0).slerp(_qq, k);
    if (sg.t >= sg.dur) this._endStargaze(true);
  }

  /* ── collectibles: a small pickup in the world, and the reading panel ── */
  collectible(id) {
    const C = this.D.collectibles;
    const all = [...C.memory_shards.shards, ...C.alices_drawings, ...(C.alices_drawings.flatMap((d) => (d.duplicates || []).map((x) => Object.assign({}, d, x)))), ...C.keeper_logs.logs, ...C.gen1_logs, ...C.documents, ...C.cities_in_the_sky_ephemera.items];
    return all.find((x) => x.id === id) || null;
  }
  collectSet(set) {
    const C = this.D.collectibles;
    if (set === "GEN1_LOG") return C.gen1_logs.map((x) => x.id);
    if (set === "CITS") return C.cities_in_the_sky_ephemera.items.map((x) => x.id);
    return [];
  }
  spawnPickup(id, near, i = 0) {
    if (this.pickups.has(id)) return this.pickups.get(id);
    const r = rng(hash(id) ^ this.S.seed), a = r() * Math.PI * 2 + i, d = 12 + r() * 40;
    const x = near.x + Math.sin(a) * d, z = near.z + Math.cos(a) * d;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.36), new THREE.MeshStandardMaterial({ color: 0x1b2433, emissive: 0x00d8ff, emissiveIntensity: 0.9, roughness: 0.4 }));
    m.position.set(x, this.game.surface.height(x, z) + 0.25, z); m.rotation.x = -0.3; m.name = "pickup:" + id;
    this.root.add(m);
    const ui = this.game.hud.ui, tag = ui && ui.tag ? ui.tag("pickup-" + id, { pos: { x, y: m.position.y + 0.8, z }, text: "◆", kind: "ground" }) : null;
    const p = { id, x, z, m, tag };
    this.pickups.set(id, p);
    return p;
  }
  async collect(id) {
    const S = this.S, item = this.collectible(id) || { id, title: humanise(id), text: "" };
    if (S.collected[id]) return;
    S.collected[id] = this.game.state.clock.sol;
    const p = this.pickups.get(id); if (p) { this.root.remove(p.m); if (p.tag) p.tag.remove(); this.pickups.delete(id); }
    this.setVar("collected." + id, true);
    this.notify("collect", { id });
    await this.readDoc(item);
  }
  async readDoc(item) {
    const lines = item.lines || item.transcript || [];
    const text = item.text || item.illustration || (lines.length ? "" : item.title || "");
    const el = this.docEl;
    el.querySelector(".eyebrow").textContent = item.header || item.kind || (String(item.id).split(".")[0] === "DRAW" ? "Alice's drawing" : "Record");
    el.querySelector("h3").textContent = item.title || item.header || humanise(item.id);
    el.querySelector(".sd-text").textContent = text;
    el.hidden = false;
    if (lines.length) await speech(this.game).seq(lines);
    else await new Promise((r) => setTimeout(r, Math.min(9, readTime(text)) * (this.game.headless ? 50 : 1000)));
    el.hidden = true;
    this.notify("read", { id: item.id });
  }

  /* ── the HUD's objective tracker ── */
  _publish() {
    const g = this.game, st = g.state; if (!st || !st.objectives) return;
    const o = st.objectives, hide = (k, v) => Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true });
    if (!this.enabled || !this.D) return;
    hide("managed", true);
    const S = this.S, m = S.focus ? this.D.mission(S.focus) : null, run = m ? S.active[m.id] : null;
    let target = null, hud;
    if (m && run) {
      const ob = m.objectives[run.idx] || m.objectives.find((x) => !run.done[x.id]);
      const P = (ob && run.prog[ob.id]) || { n: 0 }, h = ob && this.O[ob.type];
      let meta = ""; try { meta = h && h.meta ? h.meta(ob, P, run, m) || "" : ""; } catch { meta = ""; }
      let t = null; try { t = h && h.target ? h.target(ob, P, run, m) : null; } catch { t = null; }
      if (t) target = { id: t.id || "story", name: t.name || ob.text, note: ob.text, x: t.x, z: t.z };
      if (run.standIn) meta = (meta ? meta + " · " : "") + "stand-in";
      const req = m.objectives.filter((x) => !x.optional);
      hud = { eyebrow: `${(ACT_TITLES[m.act] || ["", ""])[0] || m.act} · ${m.id} ${m.title}`, name: ob ? ob.text : m.title, meta, count: ob && !ob.optional ? `${Math.min(req.indexOf(ob) + 1, req.length)} / ${req.length}` : "" };
    } else if (S.timers.final_hour) {
      hud = { eyebrow: "ACT V · THE FINAL HOUR", name: "Go to the first module when you are ready", meta: this._hourText(), count: "" };
    } else if (S.pendingWake) {
      hud = { eyebrow: (ACT_TITLES[S.act] || [""])[0], name: "Dormancy: KEEPER recommends sleep", meta: "Story log (O) → Sleep, in the rover or at the base", count: "" };
    } else {
      hud = { eyebrow: (ACT_TITLES[S.act] || [""])[0] || "Story", name: S.over ? "The end" : S.avail.length ? "Side missions are open in the Story log (O)" : "Explore", meta: "", count: "" };
    }
    hide("target", target); hide("hud", hud);
    const eb = this._eyebrow || (this._eyebrow = document.querySelector("#hud .hud-tl .eyebrow"));
    if (eb && eb.textContent !== hud.eyebrow) eb.textContent = hud.eyebrow;
    // a tag on the objective's place when it is a stand-in (there is no POI beacon there)
    const ui = g.hud.ui, t = target && this._tagged.get("obj");
    if (ui && ui.tag) {
      if (target && (!t || t.key !== target.x + "," + target.z)) { if (t) t.h.remove(); this._tagged.set("obj", { key: target.x + "," + target.z, h: ui.tag("story-obj", { pos: { x: target.x, z: target.z }, text: String(target.name).toUpperCase().slice(0, 40), kind: "ground" }) }); }
      else if (!target && this._tagged.get("obj")) { this._tagged.get("obj").h.remove(); this._tagged.delete("obj"); }
    }
  }
  _hourText() { const f = this.S.timers.final_hour; if (!f) return ""; const mins = Math.ceil(f.left / f.total * 60); return `${mins} min of the hour left`; }
  announce() {
    const g = this.game, S = this.S;
    if (!this._announced) {
      this._announced = true;
      const m = S.focus && this.D ? this.D.mission(S.focus) : null, run = m && S.active[m.id], ob = m && run ? m.objectives[run.idx] : null;
      g.hud.toast(m ? `${esc(m.title)}<small>${esc(ob ? ob.text : m.summary)} · Story log: <kbd>O</kbd></small>` : "Story log<small>press O again</small>", 6);
      return;
    }
    this.showLog();
  }

  /* ── tick ── */
  tick(dt, simDt) {
    if (!this.S.campaign || !this.D) return;
    const S = this.S;
    if (!this.enabled) this._enable(true);
    // objectives that are states, not events
    this._acc += dt;
    if (this._acc >= 0.25) {
      const step = this._acc; this._acc = 0;
      for (const id of Object.keys(S.active)) {
        const m = this.D.mission(id), run = S.active[id]; if (!m || !run) continue;
        m.objectives.forEach((ob, i) => {
          if (run.done[ob.id] || !S.active[id]) return;
          const h = this.O[ob.type]; if (!h || !h.poll) return;
          if (i !== run.idx && !ob.optional) return;
          const P = run.prog[ob.id] || (run.prog[ob.id] = { n: 0 });
          let r = false; try { r = h.poll(ob, P, run, m, step, simDt / dt * step); } catch (e) { console.warn("[story] poll", ob.type, e); }
          if (r) this.objectiveDone(m, ob, typeof r === "object" ? r : {});
        });
      }
      // cutscene triggers on reaching a place (C03 at the pod, C09, C10, C11, C17)
      for (const c of this.D.cut.cutscenes) {
        const t = c.trigger; if (S.seen[c.id] || t.on !== "reach" || (t.mission && !S.active[t.mission])) continue;
        if (!Object.keys(S.active).some((id) => this.D.mission(id).objectives.some((o) => o.poi === t.poi && !S.active[id].done[o.id]))) continue;
        const q = this.place(t.poi); if (q && this.dist(q) < 30) this.fire({ on: "reach", poi: t.poi });
      }
      // the final hour
      const f = S.timers.final_hour;
      if (f && f.left > 0) { f.left -= step; if (f.left <= 0) { f.left = 0; this.fire({ on: "timer_end", timer: "final_hour" }); } }
      // HALO-1 keeps the base supplied: materials are unlimited in a campaign, Contribution Credit is the limit
      const b = getSystem("base"); if (b && b.net && !b.net.sandbox && b.net.materials < 3000 && S.act !== "fugitive") b.net.materials = 3000;
      if (!S.homeBase) this.home();
      this._publish();
    }
    this._hunters(dt);
    // the global copy now and then
    this._gacc = (this._gacc || 0) + dt; if (this._gacc > 10) { this._gacc = 0; this._saveGlobal(); }
  }
  frame(dt) {
    if (!this.S.campaign) return;
    this.cs.frame(dt);
    this._stargazeFrame(dt);
    this._promptFrame(dt);
    for (const p of this.pickups.values()) p.m.rotation.y += (dt || 0) * 1.5;
    if (this.dev) this._devSync();
  }

  /* ── save ── */
  _log(text) { const c = this.game.state ? this.game.state.clock : { sol: 0 }; this.S.log.push({ sol: c.sol, text }); if (this.S.log.length > 80) this.S.log.shift(); }
  _save() { this.S.rev++; this._saveGlobal(); }
  _saveGlobal() { try { const ls = store(); if (ls && this.S.campaign) ls.setItem(GLOBAL_KEY, JSON.stringify(this.S)); } catch { /* full or private */ } }
  load(saved) {
    let s = saved && saved.campaign ? saved : null;
    try { const gs = JSON.parse((store() && store().getItem(GLOBAL_KEY)) || "null"); if (gs && gs.campaign && (!s || (gs.rev || 0) > (s.rev || 0))) s = gs; } catch { /* none */ }          // a travel: the campaign arrives before this site has a save of it
    this.S = Object.assign(this._fresh(), s || {});
    this._announced = false; this._queuedCs = new Set(); this._actCardShown = new Set(this.S.acts);
    for (const p of this.pickups.values()) { this.root.remove(p.m); if (p.tag) p.tag.remove(); } this.pickups.clear();
    if (this.S.campaign) {
      this.S.site = this.loadedSite;
      this._enable(true);
      this._placeLander(false);
      const ui = this.game.hud.ui; if (ui && ui.setFilterState) ui.setFilterState(this.S.filter);
      const A = getSystem("audio"); if (A && A.api && A.api.telemetry) A.api.telemetry(this.S.act === "fugitive");
      this.ready.then(() => { this._refreshAvail(); this._joinUnits(); if (this.S.seen.C03) this._wakeAnvil(); this._publish(); });
    } else this._enable(false);
  }
  save() { return this.S.campaign ? this.S : undefined; }

  /* ── jumps (the dev skip and the tests) ── */
  async jump(id, o = {}) {
    await this.ready;
    const D = this.D, m = D.mission(id); if (!m) return false;
    const S = this.S;
    if (!S.campaign) { S.campaign = true; S.site = this.loadedSite; this._enable(true); this._placeLander(!S.lander); }
    this.cs.skip(); speech(this.game).clear();
    for (const k of Object.keys(S.active)) delete S.active[k];
    // everything before it in story order is done, with its variables
    const order = D.missions.map((x) => x.id), target = order.indexOf(id), fug = m.kind === "fugitive";
    const prior = D.missions.filter((x, i) => i < target && (x.kind === "main" || (fug && x.kind === "fugitive")) && !(x.id === "5.5"));
    if (fug) for (const x of D.missions) if (x.kind === "main" && !prior.includes(x)) prior.push(x);
    for (const x of prior) {
      if (S.done[x.id]) continue;
      S.done[x.id] = { sol: this.game.state.clock.sol, jumped: true };
      for (const [k, v] of Object.entries(x.sets || {})) S.vars[k] = v;
      for (const c of x.clues || []) this.clue(c);
      for (const cid of x.cutscenes || []) S.seen[cid] = { jumped: true };
      if (x.hidden_time) this._anchor(x.id);
    }
    // the cutscenes that come before it are seen
    for (const c of D.cut.cutscenes) { const t = c.trigger; if ((t.on === "mission_complete" || t.on === "wake") && (S.done[t.id] || S.done[t.after_mission])) S.seen[c.id] = S.seen[c.id] || { jumped: true }; }
    if (id === "5.6" || id === "5.5") { S.seen.C16 = S.seen.C16 || { jumped: true }; if (!S.timers.final_hour) S.timers.final_hour = { left: FINAL_HOUR_S, total: FINAL_HOUR_S }; }
    if (fug) { S.vars.ending = "fugitive"; this._ending("fugitive"); S.seen.C18a = { jumped: true }; S.seen.C20 = { jumped: true }; }
    this._applyAct(m.act === "fugitive" ? "fugitive" : m.act, true);
    // the base looks its age
    const T = getSystem("tiers"); if (T && T.api) { if (actIdx(S.act) >= actIdx("II") && D.missionMap.get("2.6") && S.done["2.6"]) T.api.order("dome", { instant: true, key: "dome" }); T.api.grow(actIdx(S.act) * 20); T.api.recompute(); }
    this._joinUnits();
    S.pendingWake = false;
    this._log(`Jumped to ${id}`);
    this.startMission(id, { noTravel: !!o.noTravel });
    this._refreshAvail();
    this._publish(); this._save();
    return true;
  }
  completeObjective() {
    const S = this.S, m = S.focus && this.D.mission(S.focus), run = m && S.active[m.id]; if (!run) return false;
    const ob = m.objectives[run.idx] || m.objectives.find((x) => !run.done[x.id]); if (!ob) return false;
    const h = this.O[ob.type]; if (h && h.force) { try { h.force(ob, run.prog[ob.id] || {}, run, m); } catch { /* fine */ } }
    this.objectiveDone(m, ob, { forced: true });
    return ob.id;
  }
  /** Close a mission whatever is left of it (the final choice ends 5.6 however he got there). */
  finishMission(id) { const m = this.D.mission(id), run = this.S.active[id]; if (!m || !run) return; for (const ob of m.objectives) run.done[ob.id] = true; this._complete(m, { silent: true }); }
  completeMission() { const S = this.S, m = S.focus && this.D.mission(S.focus); if (!m) return false; let guard = 40; while (S.active[m.id] && guard--) this.completeObjective(); return m.id; }

  /* ── screens: the Story log, the reading panel, the end, the dev skip; the pause-menu buttons ── */
  _ui() {
    const mk = (id, cls, html) => { const s = document.createElement("section"); s.id = id; s.className = cls; s.hidden = true; s.innerHTML = html; document.body.appendChild(s); return s; };
    this.logEl = mk("screen-storylog", "screen modal story-log", `<div class="card wide sl-card"><div class="sl-body"></div><div class="row"><button type="button" class="btn primary" data-pad-close data-sl="close">Back</button></div></div>`);
    this.logEl.setAttribute("data-pad-closable", "");
    this.logEl.querySelector('[data-sl="close"]').addEventListener("click", () => this.closeLog());
    this.docEl = mk("story-doc", "story-doc", `<div class="eyebrow"></div><h3></h3><p class="sd-text"></p>`);
    this.endEl = mk("screen-story-end", "screen story-end", `<div class="se-inner"><div class="eyebrow"></div><h2></h2><p class="se-sub"></p><div class="row"><button type="button" class="btn primary" data-se="title">Return to the title</button></div></div>`);
    this.endEl.querySelector('[data-se="title"]').addEventListener("click", () => { try { this.game.save(); } catch { /* fine */ } location.href = location.pathname + location.search.replace(/[?&]story=[^&]*/, ""); });
    window.addEventListener("keydown", (e) => {
      if (!this.enabled || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (this.logOpen && e.code === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this.closeLog(); return; }
      if (!this.game.live) return;
      if (e.code === "KeyJ") { e.preventDefault(); this.openKeeper(); }
      else if (e.code === "KeyU") { e.preventDefault(); this.openUplink(); }
    }, true);
    const addMenu = () => {
      const menu = document.querySelector("#screen-menu .col"), save = document.getElementById("btn-save");
      if (!menu || document.getElementById("btn-story")) return;
      for (const [id, label, fn] of [["btn-story", "Story", () => this.showLog()], ["btn-keeper", "KEEPER terminal", () => this.openKeeper(true)], ["btn-halo", "HALO-1 uplink", () => this.openUplink(true)]]) {
        const b = document.createElement("button"); b.type = "button"; b.id = id; b.className = "btn"; b.textContent = label; b.hidden = !this.enabled;
        b.addEventListener("click", fn); menu.insertBefore(b, save || null);
      }
    };
    addMenu(); setTimeout(addMenu, 500);
    if (params.get("story") === "dev") setTimeout(() => this.devPanel(true), 800);
  }
  openKeeper(fromMenu = false) {
    const p = this.playerPos(), b = this.base(); let near = false;
    try { near = !!b && b.bases().some((x) => Math.hypot(x.x - p.x, x.z - p.z) < 180); } catch { near = false; }
    if (this.S.lander && this.dist(this.S.lander) < 120) near = true;
    if (!near && !(getSystem("avatar") && getSystem("avatar").api.inside) && !fromMenu) { this.game.hud.toast("KEEPER terminal: at a base or the lander<small>or from the pause menu</small>", 3.5); return false; }
    this.term.show(); return true;
  }
  openUplink(fromMenu = false) {
    const H = getSystem("halo"); if (!H || !H.api) return false;
    const want = this._uplinkWant ? this._uplinkWant() : null;
    H.api.openUplink(want || {}); void fromMenu; return true;
  }
  /** The open request_package objective, if any, so the uplink starts on its kind and drop. */
  _uplinkWant() {
    const S = this.S;
    for (const id of Object.keys(S.active)) {
      const m = this.D.mission(id), run = S.active[id], i = m.objectives.findIndex((o, k) => o.type === "request_package" && !run.done[o.id] && (k === run.idx || o.optional));
      if (i < 0) continue;
      const ob = m.objectives[i], next = m.objectives.slice(i + 1).find((o) => o.type === "await_package");
      return { kind: ob.kind === "starter" ? "starter" : ob.kind, unit: ob.unit || null, item: ob.item || null, extra: ob.extra, drop: ob.drop && ob.drop.site && ob.drop.site !== this.loadedSite ? null : ob.drop, story: true, mission: m.id, id: next ? next.package : undefined };
    }
    return null;
  }
  showLog() {
    const D = this.D, S = this.S, g = this.game; if (!D) return;
    const m = S.focus ? D.mission(S.focus) : null, run = m && S.active[m.id];
    const objs = m && run ? m.objectives.map((o, i) => `<li class="${run.done[o.id] ? "done" : i === run.idx ? "now" : ""}${o.optional ? " opt" : ""}">${esc(o.text)}</li>`).join("") : "";
    const others = Object.keys(S.active).filter((id) => id !== S.focus).map((id) => D.mission(id));
    const avail = S.avail.map((id) => D.mission(id)).filter(Boolean);
    const clueText = S.clues.map((id) => D.acts.clue_ladder.find((c) => String(c.id) === id)).filter(Boolean);
    const H = getSystem("halo"), cc = H && H.api && H.api.enabled ? H.api.cc() : null;
    const T = getSystem("tiers"), tier = T && T.api ? T.api.name() : "";
    this.logEl.querySelector(".sl-body").innerHTML = `
      <div class="eyebrow">${esc((ACT_TITLES[S.act] || [S.act])[0])} · ${esc((ACT_TITLES[S.act] || ["", ""])[1])} · mission sol ${S.missionSol}${tier && tier !== "none" ? " · " + esc(tier) : ""}</div>
      <h2>${m ? esc(m.title) : S.over ? "The end" : "Between missions"}</h2>
      ${m ? `<p class="sl-sum">${esc(m.summary)}</p><ol class="m-obj">${objs}</ol>` : `<p class="sl-sum">${S.pendingWake ? "KEEPER recommends dormancy." : "Nothing is asked of you right now."}</p>`}
      <div class="sl-acts"><button type="button" class="btn" data-a="sleep">Sleep (dormancy)</button><button type="button" class="btn" data-a="poem">Recite the poem</button><button type="button" class="btn" data-a="keeper">KEEPER terminal</button>${cc ? `<button type="button" class="btn" data-a="halo">HALO-1 uplink</button>` : ""}${m && m.id === "5.6" || !S.timers.final_hour ? "" : `<button type="button" class="btn" data-a="choice">Go to the first module</button>`}</div>
      ${cc ? `<p class="fine">Contribution Credit: ${cc.free} free of ${cc.capacity} · care-package requests open ${cc.open} / ${cc.maxOpen} · base size cap ${cc.maxModules} modules</p>` : ""}
      ${others.length ? `<div class="eyebrow">Also under way</div><ul class="sl-list">${others.map((x) => `<li><b>${esc(x.title)}</b> <button type="button" class="btn quiet" data-focus="${esc(x.id)}">Track</button></li>`).join("")}</ul>` : ""}
      ${avail.length ? `<div class="eyebrow">Open to you</div><ul class="sl-list">${avail.map((x) => `<li><b>${esc(x.title)}</b><span>${esc(x.summary)}</span><button type="button" class="btn quiet" data-start="${esc(x.id)}">Begin</button></li>`).join("")}</ul>` : ""}
      ${clueText.length ? `<div class="eyebrow">Things that do not add up</div><ul class="sl-notes">${clueText.map((c) => `<li>${esc(c.clue)}</li>`).join("")}</ul>` : ""}`;
    const B = this.logEl.querySelector(".sl-body");
    B.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => { this.closeLog(); const id = b.dataset.start; const mm = D.mission(id); if (mm.trigger.on === "any") this.fire({ on: "player_start", id }); else this.startMission(id); }));
    B.querySelectorAll("[data-focus]").forEach((b) => b.addEventListener("click", () => { S.focus = b.dataset.focus; this.showLog(); this._publish(); }));
    const act = (k, fn) => { const b = B.querySelector(`[data-a="${k}"]`); if (b) b.addEventListener("click", fn); };
    act("sleep", () => { this.closeLog(); this.sleep(); });
    act("poem", () => { this.closeLog(); this.O.recite_poem.recite(); });
    act("keeper", () => { this.closeLog(true); this.term.show(); });
    act("halo", () => { this.closeLog(true); this.openUplink(true); });
    act("choice", () => { this.closeLog(); this.fire({ on: "player_start", id: "5.6" }); });
    if (!this.logOpen) {
      this.logOpen = true; this._logResume = g.live; if (g.live) g.pause(true);
      const menu = document.getElementById("screen-menu"); this._logFromMenu = menu && !menu.hidden; if (menu) menu.hidden = true;
    }
    this.logEl.hidden = false;
    const P = window.GeoIDPad; if (P && P.connected) setTimeout(() => P.focus.first(this.logEl), 60);
    this.notify("open_panel", { panel: "story" });
  }
  closeLog(keepPaused = false) {
    if (!this.logOpen) return;
    this.logOpen = false; this.logEl.hidden = true;
    const P = window.GeoIDPad; if (P && P.focus) P.focus.clear();
    if (keepPaused) return;
    if (this._logFromMenu) { const menu = document.getElementById("screen-menu"); if (menu) menu.hidden = false; }
    else if (this._logResume && this.game.mode === "menu") this.game.pause(false);
  }
  devPanel(on = true) {
    this.dev = on;
    if (!on) { if (this.devEl) this.devEl.hidden = true; return; }
    this.ready.then((D) => {
      if (!this.devEl) {
        const el = this.devEl = document.createElement("div"); el.id = "story-dev"; el.className = "story-dev";
        const acts = ACT_ORDER.map((a) => `<optgroup label="${esc((ACT_TITLES[a] || [a])[0])}">${D.missions.filter((m) => m.act === a).map((m) => `<option value="${esc(m.id)}">${esc(m.id)} ${esc(m.title)}</option>`).join("")}</optgroup>`).join("");
        el.innerHTML = `<div class="eyebrow">Story · dev skip</div><p class="sd-state"></p>
          <div class="sd-row"><select data-d="m">${acts}</select><button type="button" class="btn quiet" data-d="jump">Jump</button></div>
          <div class="sd-row"><select data-d="c">${D.cut.cutscenes.map((c) => `<option value="${c.id}">${c.id} ${esc(c.title)}</option>`).join("")}</select><button type="button" class="btn quiet" data-d="play">Play</button></div>
          <div class="sd-row"><button type="button" class="btn quiet" data-d="skip">Skip cutscene</button><button type="button" class="btn quiet" data-d="obj">Objective done</button><button type="button" class="btn quiet" data-d="mis">Mission done</button></div>
          <div class="sd-row"><button type="button" class="btn quiet" data-d="sleep">Sleep</button><button type="button" class="btn quiet" data-d="xp">+500 XP</button><button type="button" class="btn quiet" data-d="new">New campaign</button></div>
          <div class="sd-row"><button type="button" class="btn quiet" data-d="rest">Rest ending</button><button type="button" class="btn quiet" data-d="fug">Fugitive ending</button><button type="button" class="btn quiet" data-d="hide">Hide</button></div>`;
        document.body.appendChild(el);
        // the wheel scrolls the page, never changes a field
        el.querySelectorAll("select").forEach((s) => s.addEventListener("wheel", (e) => { e.preventDefault(); s.blur(); }, { passive: false }));
        const on2 = (k, fn) => el.querySelector(`[data-d="${k}"]`).addEventListener("click", fn);
        on2("jump", () => this.jump(el.querySelector('[data-d="m"]').value, { noTravel: true }));
        on2("play", () => this.playCutscene(el.querySelector('[data-d="c"]').value));
        on2("skip", () => this.cs.skip()); on2("obj", () => this.completeObjective()); on2("mis", () => this.completeMission());
        on2("sleep", () => this.sleep()); on2("xp", () => { const P = getSystem("progress"); if (P && P.api) P.api.award(500, "dev skip"); });
        on2("new", () => this.newCampaign());
        on2("rest", () => this.devEnding("rest")); on2("fug", () => this.devEnding("fugitive")); on2("hide", () => this.devPanel(false));
      }
      this.devEl.hidden = false;
    });
  }
  async devEnding(kind) { await this.jump("5.6", { noTravel: true }); this.notify("choose", { choice_id: "final", option: kind }); const run = this.S.active["5.6"]; if (run) this.completeMission(); }
  _devSync() { const el = this.devEl; if (!el || el.hidden) return; const t = `${this.S.act} · ${this.S.focus || "-"} · sol ${this.S.missionSol} (true ${Math.round(this.S.trueSol)}) · ${this.cs.active ? "cutscene " + this.cs.cur.id : ""}`; const p = el.querySelector(".sd-state"); if (p.textContent !== t) p.textContent = t; }

  /** Campaign economy on the builder: the base size cap of the tier and the Contribution Credit the footprint draws. */
  hookBuilder() {
    const B = getSystem("builder"); if (!B || B._storyHooked || typeof B.evaluate !== "function") return;
    const ev = B.evaluate.bind(B), self = this;
    B.evaluate = function (type, pose, o = {}) {
      const r = ev(type, pose, o);
      if (!self.S.campaign || !r || r.state === "bad" || o.free === true && o.story) return r;
      const H = getSystem("halo"), cc = H && H.api && H.api.enabled ? H.api.cc() : null;
      if (!cc) return r;
      const b = self.base(); let n = 0; try { n = b ? b.modules().length : 0; } catch { n = 0; }
      if (n >= cc.maxModules) return Object.assign({}, r, { state: "bad", reason: `base size cap: ${cc.maxModules} modules at tier ${cc.tier} (earn Contribution Credit)` });
      const cost = ((MODULES[type] || {}).cost || 0) / 2;
      if (cost > cc.free) return Object.assign({}, r, { state: "bad", reason: `Contribution Credit: ${Math.ceil(cost)} needed for its footprint, ${Math.max(0, cc.free)} free` });
      return r;
    };
    B._storyHooked = true;
  }
  async _siteIndex() {
    const out = new Set([this.loadedSite || "jezero"]);
    try {
      const r = await fetch(new URL("../sites/index.json", import.meta.url).href, { cache: "no-cache" }); const j = await r.json();
      await Promise.all((j.sites || []).filter((s) => s.status === "ready").map(async (s) => { try { const q = await fetch(new URL("../" + s.path + "site.json", import.meta.url).href, { method: "HEAD" }); if (q.ok) out.add(s.id); } catch { /* not there */ } }));
    } catch { /* no index */ }
    return out;
  }
}
const _t = new THREE.Vector3(), _mm = new THREE.Matrix4(), _qq = new THREE.Quaternion();

let ST = null;
const sys = {
  id: "story", order: 92,
  get story() { return ST; },
  api: {
    newCampaign: () => (ST ? ST.newCampaign() : Promise.resolve(false)),
    campaignSite: (save) => (ST ? ST.campaignSite(save) : (() => { try { const s = JSON.parse(localStorage.getItem(GLOBAL_KEY) || "null"); return (s && s.campaign && s.site) || "jezero"; } catch { return "jezero"; } })()),
    chapterTitle: () => (ST ? ST.chapterTitle() : { act: "PROLOGUE", title: "THE DESCENT", subtitle: "" }),
    get active() { return !!(ST && ST.S.campaign); },
    state: () => (ST ? ST.S : null),
    jump: (id, o) => (ST ? ST.jump(id, o) : false),
    skipCutscene: () => ST && ST.cs.skip(),
    play: (id, o) => ST && ST.playCutscene(id, o),
    get cutscene() { return ST && ST.cs.active ? ST.cs.cur.id : null; },
    completeObjective: () => ST && ST.completeObjective(),
    completeMission: () => ST && ST.completeMission(),
    ask: (text) => ST && ST.term.ask(text, { typed: true }),
    keeper: () => ST && ST.term.show(), closeKeeper: () => ST && ST.term.close(),
    uplink: () => ST && ST.openUplink(true),
    sleep: (w) => (ST ? ST.sleep(w) : null),
    stargaze: (o) => ST && ST.stargaze(o),
    log: () => ST && ST.showLog(), closeLog: () => ST && ST.closeLog(),
    announce: () => ST && ST.announce(),
    dev: (on = true) => ST && ST.devPanel(on),
    place: (id) => (ST ? ST.place(id) : null),
    home: () => (ST ? ST.home() : null),
    vars: () => (ST ? ST.S.vars : {}),
    setVar: (k, v) => ST && ST.setVar(k, v),
    act: () => (ST ? ST.S.act : "I"),
    seed: () => (ST ? ST.S.seed : 1),
    trueSol: () => (ST ? ST.S.trueSol : 0),
    tierFloor: () => (ST ? ST.tierFloor() : 0),
    playerPos: () => (ST ? ST.playerPos() : null),
    hasItem: (k) => !!(ST && ST.hasItem(k)),
    wantsStation: () => !!(ST && ST.wantsStation()),
    event: (id) => ST && ST.event(id),
    notify: (t, d) => ST && ST.notify(t, d),
    mission: () => (ST && ST.S.focus ? ST.S.focus : null),
    objective: () => { if (!ST || !ST.S.focus || !ST.D) return null; const m = ST.D.mission(ST.S.focus), run = ST.S.active[m.id]; const ob = run && m.objectives[run.idx]; return ob ? { id: ob.id, type: ob.type, text: ob.text, progress: run.prog[ob.id] || null } : null; },
    fire: (ev) => ST && ST.fire(ev),
    data: () => (ST ? ST.ready : loadStory()),
  },
  async init(game) {
    ST = new Story(game);
    if (typeof window !== "undefined") window.__story = sys.api;
    await ST.ready.catch((e) => console.warn("[story] story data did not load", e));
    ST.hookBuilder();
    game.on("eva:scan", (d) => ST.notify("scan", d || {}));
    game.on("eva:sample", (d) => ST.notify("sample", d || {}));
    game.on("eva:plant", (d) => ST.notify("plant", d || {}));
    game.on("eva:exit", (d) => ST.notify("eva_exit", d || {}));
    game.on("eva:emergency", (d) => ST.notify("emergency", d || {}));
    game.on("halo:request", (d) => ST.notify("package_requested", d.pkg));
    game.on("halo:final", (d) => { ST.fire({ on: "package_landed", package: d.id }); });
    game.on("halo:landed", (d) => ST.onLanded(d.pkg));
    game.on("halo:countdown", (d) => ST.O.await_package.countdown(d));
    game.on("mode", (mode) => { if (mode === "menu") ST.notify("open_panel", { panel: "menu" }); });
    game.on("interact", () => { if (ST.enabled && ST._cur && !ST.onFoot() && game.mode === "driving") ST._do(ST._cur); });
    const ui = game.hud.ui; if (ui && ui.on) ui.on("change", () => ST.notify("settings", {}));
  },
  load(game, saved) { if (ST) { ST.load(saved); } },
  save() { return ST ? ST.save() : undefined; },
  tick(game, dt, ctx) { if (ST) ST.tick(dt, ctx.simDt); },
  frame(game, dt) { if (ST) ST.frame(dt); },
};
/** A package landed: its units come out, the story hears of it. */
Story.prototype.onLanded = function (pkg) {
  if (!this.S.campaign || !pkg) return;
  const C = getSystem("caretakers"), D = this.D;
  const K = (getSystem("halo").api.kinds || {})[pkg.kind] || {};
  if (C && C.api) {
    const unit = pkg.kind === "starter" ? "ANVIL" : pkg.unit;
    // ANVIL waits in the starter pod until C03 (he knocks twice from the inside); anyone else steps straight out
    if (unit) C.api.spawn({ callsign: unit, founder: true, x: pkg.x + 2.6, z: pkg.z + 1.4, state: unit === "ANVIL" && !this.S.seen.C03 ? "dormant" : "idle", pkg: pkg.id });
    else if (K.units || true) {
      // a generated caretaker, while the act's population allows it
      const cap = { prologue: 2, I: 2, II: 20, III: 150, IV: 800, V: 3000 }[this.S.act] || 2;
      if (C.api.count() < Math.min(cap, 24)) C.api.spawn({ x: pkg.x + 3, z: pkg.z - 2, pkg: pkg.id });
    }
  }
  if (pkg.item && !this.S.items.includes(pkg.item)) this.S.items.push(pkg.item);
  this.notify("package_landed", pkg);
  this.fire({ on: "package_landed", package: pkg.id });
  void D;
};
registerSystem(sys);
