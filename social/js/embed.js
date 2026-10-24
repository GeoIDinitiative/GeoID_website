/**
 * Videos in posts: uploaded files, and YouTube or Vimeo links.
 *
 * NOTHING FROM YOUTUBE OR VIMEO LOADS UNTIL A READER ASKS. A link is drawn as
 * a plain 16:9 panel with a play button that names who will be contacted;
 * only the click puts their player (youtube-nocookie.com / player.vimeo.com)
 * in an iframe. A feed full of embeds would otherwise hand every reader's
 * visit to two ad companies, which the privacy policy says this site doesn't.
 *
 * The parsing is pure (no DOM) so node tests it: embed.test.mjs.
 */
import { h } from "./dom.js?v=20261024-66b6e04";

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** {provider, id, embedUrl, watchUrl} for a YouTube or Vimeo address, else null. */
export function parseVideoLink(text) {
  let u;
  try { u = new URL(String(text || "").trim()); } catch (error) { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id = "";
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  if (id && YT_ID.test(id)) {
    const start = Number.parseInt(u.searchParams.get("t") || u.searchParams.get("start") || "", 10);
    const at = Number.isFinite(start) && start > 0 ? `&start=${start}` : "";
    return {
      provider: "youtube", id,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${at}`,
      watchUrl: `https://www.youtube.com/watch?v=${id}`,
    };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(?:^\/|\/video\/)(\d{5,12})(?:\/([0-9a-f]{6,20}))?/);
    if (m) {
      const hash = m[2] || u.searchParams.get("h") || "";
      return {
        provider: "vimeo", id: m[1],
        embedUrl: `https://player.vimeo.com/video/${m[1]}?autoplay=1&dnt=1${hash ? `&h=${hash}` : ""}`,
        watchUrl: `https://vimeo.com/${m[1]}${hash ? `/${hash}` : ""}`,
      };
    }
  }
  return null;
}

/** The post's links that are videos, parsed; others are left for the links list. */
export function videoLinks(links) {
  return (Array.isArray(links) ? links : []).map((l) => parseVideoLink(l?.url)).filter(Boolean);
}

const PROVIDER = { youtube: "YouTube", vimeo: "Vimeo" };

/** A click-to-load player for a parsed link. */
export function videoEmbed(v, { title = "" } = {}) {
  const name = PROVIDER[v.provider];
  const frame = h("div", { class: "s-embed" });
  const play = h("button", { type: "button", class: "s-embed-play", "aria-label": `Play the ${name} video${title ? `: ${title}` : ""}` },
    h("span", { class: "s-embed-icon", "aria-hidden": "true" }, "▶"),
    h("span", { class: "s-embed-label" }, `Play video`),
    h("span", { class: "s-embed-note" }, `Loads ${name} (${v.provider === "youtube" ? "youtube-nocookie.com" : "player.vimeo.com"})`));
  play.addEventListener("click", () => {
    const iframe = h("iframe", {
      src: v.embedUrl, title: title ? `${name} video: ${title}` : `${name} video`,
      allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
      allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin", loading: "lazy",
    });
    frame.replaceChildren(iframe);
    iframe.focus();
  });
  frame.append(play);
  return h("figure", { class: "s-embed-wrap" }, frame,
    h("figcaption", {}, h("a", { href: v.watchUrl, target: "_blank", rel: "noopener noreferrer" }, `Watch on ${name}`)));
}

/** An uploaded video: the browser's own player, metadata only until played. */
export function videoPlayer(m) {
  return h("figure", { class: "s-video-wrap" },
    h("video", { src: m.url, controls: true, preload: "metadata", playsinline: true, class: "s-video",
      "aria-label": m.alt || "Video" }),
    m.alt ? h("figcaption", { text: m.alt }) : null);
}

export const isVideo = (m) => String(m?.type || "").startsWith("video/");
export const isImage = (m) => String(m?.type || "").startsWith("image/");

/**
 * One preview for a feed card, the first of: an uploaded video, an image, a
 * video link. Kept to one so a feed stays a list of posts rather than a wall
 * of media; the post page shows them all.
 */
export function cardPreview(p) {
  const media = Array.isArray(p.media) ? p.media : [];
  const video = media.find(isVideo);
  if (video?.url) return h("div", { class: "s-card-media" }, videoPlayer(video));
  const image = media.find(isImage);
  if (image?.url) {
    return h("a", { class: "s-card-media", href: `#/post/${encodeURIComponent(p.id)}`, tabindex: "-1" },
      h("img", { src: image.url, alt: image.alt || "", loading: "lazy", decoding: "async" }));
  }
  const link = videoLinks(p.links)[0];
  if (link) return h("div", { class: "s-card-media" }, videoEmbed(link, { title: p.title }));
  return null;
}
