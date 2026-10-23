/**
 * Atlas on the GeoID Network: the same assistant as GeoHUB's (the ◆ launcher,
 * GeoID_GIS/viewer/gis/atlas-assistant.js), told what THIS page is.
 *
 * Atlas asks its host first (window.GeoIDAtlasHost), so here it answers from
 * the Network's own sections and the signed-in member's real state -- unread
 * messages, a bare profile, the page being read -- and acts by changing the
 * route. Anything the Network cannot answer falls through to Atlas itself:
 * the hazard tools, and a connected model (your own subscription through the
 * sidecar, or an Atlas hub), which is handed `context()` below so it knows
 * which post or profile you mean.
 *
 * The matching is pure (answerFor) so node tests it: atlas-host.test.mjs.
 */

/** Every section, with the words people use for it. Order is the nav's. */
export const SECTIONS = [
  { hash: "#/", name: "Feed", words: "feed home posts timeline following discover trending latest",
    blurb: "posts from the people, tags, places and communities you follow" },
  { hash: "#/map", name: "Map", words: "map where location distribution cluster nearby region area interest globe",
    blurb: "who studies where: the people distribution by study area, and who to contact there" },
  { hash: "#/people", name: "People", words: "people person scientist researcher collaborator member find mentor expert colleague",
    blurb: "find people by name, skill, interest or region, and get collaborator suggestions" },
  { hash: "#/orgs", name: "Organisations", words: "organisation organization institution university lab company department",
    blurb: "institutions and their verified members" },
  { hash: "#/communities", name: "Communities", words: "community communities forum group discussion topic join",
    blurb: "topic forums anyone can join" },
  { hash: "#/teams", name: "Teams", words: "team teams group private workspace members",
    blurb: "small private groups with their own feed and chat" },
  { hash: "#/projects", name: "Projects", words: "project projects share workspace globe geohub repo collaborate",
    blurb: "shared projects, linked to your saved GeoHUB projects" },
  { hash: "#/reviews", name: "Peer review", words: "review reviews draft paper manuscript feedback referee peer",
    blurb: "ask for, and give, reviews of draft papers" },
  { hash: "#/requests", name: "Requests", words: "request requests help ask data collaboration need",
    blurb: "requests for data, help or collaboration" },
  { hash: "#/opportunities", name: "Opportunities", words: "opportunity opportunities job jobs phd postdoc position funding grant vacancy",
    blurb: "jobs, PhDs, funding and calls" },
  { hash: "#/events", name: "Events", words: "event events conference seminar webinar workshop meeting talk",
    blurb: "conferences, seminars and poster sessions" },
  { hash: "#/messages", name: "Messages", words: "message messages chat dm inbox conversation contact talk",
    blurb: "your conversations" },
  { hash: "#/notifications", name: "Notifications", words: "notification notifications alerts mentions replies",
    blurb: "replies, mentions and invitations" },
  { hash: "#/compose", name: "New post", words: "post write compose publish new share observation question announce",
    blurb: "write a post, observation, question or announcement" },
  { hash: "#/settings", name: "Settings", words: "settings profile bio picture avatar linkedin institution privacy email account",
    blurb: "your profile, picture, links and privacy" },
];

const STOP = new Set(["the", "and", "for", "are", "you", "your", "this", "that", "with", "from", "where", "what", "how",
  "why", "when", "which", "who", "does", "can", "could", "should", "would", "will", "there", "have", "has", "into",
  "about", "get", "see", "look", "find", "want", "need", "please", "help", "any", "some", "just", "now", "here", "show",
  "open", "take", "page", "go"]);
const stem = (w) => w.replace(/(ings?|ed|es|s)$/, "") || w;

/** The sections a question names, best first; empty when nothing clearly matches. */
export function rankSections(question) {
  const asked = (String(question).toLowerCase().match(/[a-z]{2,}/g) || []).filter((w) => !STOP.has(w)).map(stem);
  if (!asked.length) return [];
  return SECTIONS.map((s) => {
    const name = s.name.toLowerCase();
    const words = s.words.split(" ").map(stem);
    let score = 0;
    for (const w of asked) {
      if (w.length < 3) continue;
      if (name.includes(w)) score += 5;
      else if (words.includes(w)) score += 3;
    }
    return { ...s, score };
  }).filter((s) => s.score >= 3).sort((a, b) => b.score - a.score).slice(0, 3);
}

/** What a member should do next, from their real state, most useful first. */
export function nextSteps(state) {
  if (!state.signedIn) return [{ text: "Sign in with your GeoID membership to post, message and join teams.", go: "signin" }];
  const steps = [];
  if (state.unreadMessages) steps.push({ text: `You have ${state.unreadMessages} unread message${state.unreadMessages === 1 ? "" : "s"}.`, go: "#/messages" });
  if (state.unreadNotifications) steps.push({ text: `${state.unreadNotifications} notification${state.unreadNotifications === 1 ? "" : "s"} waiting.`, go: "#/notifications" });
  if (!state.headline || !state.interests) steps.push({ text: "Your profile is bare: a headline and your interests are what put you on the map and in people's suggestions.", go: "#/settings" });
  if (!state.studyAreas) steps.push({ text: "Add a study area so people working on the same place can find you on the map.", go: "#/settings" });
  if (!state.communities) steps.push({ text: "Join a community to get its discussions in your feed.", go: "#/communities" });
  steps.push({ text: "See who is working near your study areas.", go: "#/map" });
  return steps;
}

/**
 * The Network's answer to a question, as data: {text, go: [[label, target]]}
 * where target is a route, "signin", or "ask:<question>". Null hands the
 * question to Atlas's own answers and then to a model.
 */
export function answerFor(question, state) {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return null;

  if (/^(help|what can you do|who are you|hi|hello|hey)\b/.test(q)) {
    return {
      text: "I'm **Atlas**, the same assistant as in GeoHUB. Here on the Network I can:\n"
        + "• take you anywhere — “where are the reviews?”, “open the map”\n"
        + "• say what needs your attention — “what should I do next?”\n"
        + "• find people — “who works on landslides?”, “people near Etna”\n"
        + "• search everything — “search InSAR”\n"
        + "• and the GeoHUB tools still work — “model a small ashfall from Etna at 4pm today”\n"
        + (state.model ? "A model is connected, so you can also ask about the post or profile you are reading."
          : "Connect a model (your own subscription through the sidecar, or an Atlas hub) and I can also summarise the post or profile you are reading."),
      go: [["What should I do next?", "ask:what should I do next?"]],
    };
  }

  if (/\b(next|what should i|to do|catch up|missed|anything new|status|where am i)\b/.test(q) && !/\b(model|ash|erupt)/.test(q)) {
    const steps = nextSteps(state);
    const where = state.section ? `You are on **${state.section}**.\n` : "";
    return {
      text: where + steps.slice(0, 4).map((s) => `• ${s.text}`).join("\n"),
      go: [...new Set(steps.slice(0, 4).map((s) => s.go))].slice(0, 3).map((g) => [labelFor(g), g]),
    };
  }

  // "who works on X", "people near Etna", "find a mentor in seismology"
  const who = q.match(/\b(?:who (?:works|is working|studies|researches) (?:on|in)|people (?:working on|in|near|studying)|experts? (?:on|in)|researchers? (?:on|in|near)|mentors? (?:on|in|for)|scientists? (?:on|in|near))\s+(.+?)[?.!]*$/);
  if (who) {
    const topic = who[1].replace(/^(the|a|an)\s+/, "").trim();
    const mentor = /\bmentors?\b/.test(q);
    return {
      text: `Here is who lists **${topic}**${mentor ? " and mentors" : ""}. The map shows where they work, and anyone there can be messaged.`,
      go: [[`People: ${topic}`, `#/people?interest=${encodeURIComponent(topic)}${mentor ? "&mentor=1" : ""}`],
        ["On the map", "#/map"], [`Posts about ${topic}`, `#/search?q=${encodeURIComponent(topic)}`]],
    };
  }

  const search = q.match(/^(?:search|search for|look up|find posts? (?:about|on))\s+(.+?)[?.!]*$/);
  if (search) {
    const term = search[1].trim();
    return { text: `Searching posts, people and projects for **${term}**.`, go: [[`Search: ${term}`, `#/search?q=${encodeURIComponent(term)}`]], auto: true };
  }

  if (/\b(post|write|share|publish|announce)\b/.test(q) && /\b(how|can i|want to|new|a)\b/.test(q) && !/\breview\b/.test(q)) {
    return { text: "**New post** takes text, pictures, a video (upload or a YouTube/Vimeo link), a place, and a GeoHUB scene or model to open.",
      go: [["Write a post", "#/compose"]] };
  }

  const hits = rankSections(q);
  if (hits.length) {
    const [best, ...rest] = hits;
    return {
      text: `**${best.name}**: ${best.blurb}.` + (rest.length ? `\nAlso: ${rest.map((r) => r.name).join(", ")}.` : ""),
      go: hits.map((h) => [h.name, h.hash]),
      auto: /^(open|go to|take me to|show me|show)\b/.test(q),
    };
  }
  return null;
}

function labelFor(target) {
  if (target === "signin") return "Sign in";
  return SECTIONS.find((s) => s.hash === target)?.name || "Open";
}

/**
 * Register the host. `ctx` gives live state: { me(), section(), signInUrl() }.
 * Must run before atlas-assistant.js does -- app.js imports this, and the
 * Atlas script tag comes after app.js in social/index.html.
 */
export function registerAtlasHost(ctx) {
  const state = () => {
    const me = ctx.me();
    const u = me?.user || {};
    return {
      signedIn: !!me,
      unreadMessages: me?.unread?.messages || 0,
      unreadNotifications: me?.unread?.notifications || 0,
      headline: !!u.headline,
      interests: (u.interests || []).length,
      studyAreas: (u.study_areas || me?.study_areas || []).length,
      communities: (me?.communities || []).length,
      section: ctx.section(),
      model: !!(window.GeoIDAtlas?.endpoint?.()),
    };
  };
  const goTo = (target, submit) => {
    if (target === "signin") location.href = ctx.signInUrl();
    else if (target.startsWith("ask:")) submit(target.slice(4));
    else location.hash = target;
  };
  window.GeoIDAtlasHost = {
    sub: "guide to the GeoID Network",
    // In the Network header's top-right corner, beside Settings.
    slot: () => document.querySelector(".s-hdr-atlas"),
    greeting: "I'm **Atlas**, the assistant from GeoHUB. On the Network I can take you anywhere, "
      + "say what needs your attention, and find the people working on a topic or a place.",
    suggestions: [["What should I do next?", "what should I do next?"], ["Who works near Etna?", "people near Etna"], ["What can you do?", "help"]],
    context() {
      const s = state();
      const lines = ["page: GeoID Network (the GeoID Initiative's network for Earth scientists)",
        `section: ${s.section || "unknown"} (${location.hash || "#/"})`,
        s.signedIn ? `member: @${ctx.me()?.user?.handle || "?"}` : "member: not signed in"];
      // What is on screen, so "summarise this" has something to summarise.
      const main = document.getElementById("social-main");
      const title = main?.querySelector("h1")?.textContent?.trim();
      if (title) lines.push(`on screen: ${title}`);
      const body = (main?.querySelector(".s-post-full") || main)?.innerText?.trim();
      if (body) lines.push(`text on screen (first 1500 characters):\n${body.slice(0, 1500)}`);
      return lines.join("\n");
    },
    answer(question, { submit }) {
      const a = answerFor(question, state());
      if (!a) return null;
      if (a.auto && a.go[0]) goTo(a.go[0][1], submit);
      return { text: a.text, actions: (a.go || []).map(([label, target]) => [label, () => goTo(target, submit)]) };
    },
  };
}
