/**
 * #/conduct -- the code of conduct, with the response times moderators work
 * to (the same numbers as social-worker/trust.js RESPONSE_HOURS).
 */
import { h, put, clear } from "../dom.js?v=20261025-794b342";

const TIMES = [["Harassment, threats, someone's private information, a sensitive location", "24 hours"],
  ["Spam, scams, fake job adverts", "48 hours"], ["Misleading claims, copyright, anything else", "72 hours"]];

export function render(root) {
  document.title = "Code of conduct — GeoID Network";
  put(clear(root), h("article", { class: "s-prose s-conduct" },
    h("h1", { class: "s-h1", text: "Code of conduct" }),
    h("p", { text: "GeoID Network is for Earth scientists at every stage, in every country, to share work, ask for and give help, and find their next step. It works when people can disagree about science and still feel safe being here." }),
    h("h2", { class: "s-h2", text: "Do" }),
    h("ul", {}, ["Credit people and data: say where things came from.", "Disagree with the work, not the person. Bring evidence.",
      "Be generous with people starting out. Everyone was new once.", "Respect what people choose to share, and where: study-area precision, private drafts, unlisted posts.",
      "Say when something is uncertain, modelled or unverified. The provenance labels exist for this."].map((t) => h("li", { text: t }))),
    h("h2", { class: "s-h2", text: "Don't" }),
    h("ul", {}, ["Harass, threaten, demean or single anybody out, here or by message.", "Share someone's private information, or the exact location of a sensitive site (nests, unprotected archaeology, private land) without consent.",
      "Post fake or misleading job adverts. Never ask applicants for money, documents or a move to a chat app.", "Present someone else's work, data or figures as your own.",
      "Spam, or post the same thing across communities to sell."].map((t) => h("li", { text: t }))),
    h("h2", { class: "s-h2", text: "Reporting, and how fast we answer" }),
    h("p", { text: "Use Report on any post, comment, person or message. You aren't named to the person reported. A moderator answers within:" }),
    h("table", { class: "s-table" }, h("tbody", {}, TIMES.map(([what, when]) => h("tr", {}, h("td", { text: what }), h("th", { scope: "row", text: when }))))),
    h("p", { text: "Job adverts from new accounts that read like scams are held for a moderator before anyone sees them. Moderation actions are logged, and the author is told what happened and why, and can appeal." }),
    h("p", { class: "s-hint", text: "Moderators are GeoID staff and community moderators for their own communities." })));
}
