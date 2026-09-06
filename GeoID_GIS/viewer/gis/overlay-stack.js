/**
 * THE LEGEND AND THE EVENTS FEED ARE ONE SLOT, NOT TWO.
 *
 * They were side by side, which cost the top of the map twice over: two
 * buttons always showing, and — because the feed places itself left of the
 * legend — a layout that moved whenever the legend's width changed. Neither is
 * ever read at the same time as the other; they answer different questions
 * about the same globe.
 *
 * So they are a SHUFFLE. One card is in front, at full size and full contrast,
 * and it is the only one that may open a panel. The other sits behind it,
 * moved up and left, smaller, turned a few degrees and greyed — visibly a card
 * you can bring forward rather than a button somebody forgot to style.
 * Pressing the one at the back deals it to the front and sends the other
 * behind, which is the whole interaction.
 *
 * WHY IT LIVES IN ITS OWN FILE. The legend owns its toggle in `legend-dock.js`
 * and the feed owns its own in `events.js`, and each is right to. Which of
 * them is in front belongs to neither — putting it in one would make that one
 * the parent of the other, and the next card added to this corner would have
 * to be taught about both.
 */

const CARDS = [
  { id: "map-legend", toggle: "map-legend-toggle", panel: "map-legend-panel" },
  { id: "events-overlay", toggle: "events-panel-toggle", panel: "events-panel" },
];

/**
 * The legend leads, because it describes what is already on the globe; the
 * feed is something you go and ask for.
 */
let front = CARDS[0].id;

const STYLE = `
/* The stack. Both cards share the slot; the transform decides which is read. */
.map-legend[data-stack] {
  transform-origin: top right;
  transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.3, 1),
              opacity 0.28s ease, filter 0.28s ease;
}
.map-legend[data-stack="front"] { z-index: 14; transform: none; opacity: 1; }
/**
 * UP AND LEFT, never down: the front card's panel hangs below its button, and
 * a back card offset downwards disappears behind the very thing it is meant to
 * peek out from.
 *
 * THE OFFSET HAS TO BEAT THE WIDTH DIFFERENCE, which is why it is this large.
 * The cards are right-aligned and the transform origin is their shared corner,
 * so scaling alone pulls the back card's left edge INWARDS: at 0.55rem it
 * cleared the front card by five pixels and read as a shadow rather than as a
 * card. Measured with both buttons on screen, the back one has to move about a
 * rem and a half before there is a corner to press.
 */
.map-legend[data-stack="back"] {
  z-index: 12;
  transform: translate(-1.7rem, -0.55rem) scale(0.86) rotate(-6deg);
  opacity: 0.55;
  filter: grayscale(0.75);
}
.map-legend[data-stack="back"]:hover {
  opacity: 0.9;
  filter: grayscale(0.15);
  transform: translate(-1.7rem, -0.55rem) scale(0.9) rotate(-4deg);
}
/* A card at the back has nothing open: only the front one answers. */
.map-legend[data-stack="back"] .map-legend-panel { display: none !important; }
/* The caret is the front card's business -- a rotated, greyed button with an
   open-panel caret says the panel is open when it cannot be. */
.map-legend[data-stack="back"] .map-legend-caret { transform: none !important; }
`;

let styled = false;
function installStyle() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const tag = document.createElement("style");
  tag.id = "gis-overlay-stack-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

const byId = (id) => document.getElementById(id);

/** Shut a card's panel and say so on its toggle, without firing its handler. */
function closeCard(card) {
  const panel = byId(card.panel);
  if (panel) panel.hidden = true;
  byId(card.toggle)?.setAttribute("aria-expanded", "false");
}

export function apply() {
  CARDS.forEach((card) => {
    const host = byId(card.id);
    if (!host) return;
    const atFront = card.id === front;
    host.dataset.stack = atFront ? "front" : "back";
    if (!atFront) closeCard(card);
    const toggle = byId(card.toggle);
    // The one at the back is a card to deal forward, and says so rather than
    // claiming to expand something.
    if (toggle) {
      toggle.setAttribute("aria-pressed", atFront ? "true" : "false");
      toggle.title = atFront ? "" : "Bring to the front";
    }
  });
}

/** Deal `id` to the front. Returns whether anything moved. */
export function bringToFront(id) {
  if (!CARDS.some((card) => card.id === id) || front === id) return false;
  front = id;
  apply();
  return true;
}

export const frontCard = () => front;

function wire() {
  installStyle();
  CARDS.forEach((card) => {
    const toggle = byId(card.toggle);
    if (!toggle || toggle.dataset.stackWired) return;
    toggle.dataset.stackWired = "1";
    /**
     * CAPTURE, and it has to be.
     *
     * Each card's own handler flips its panel. For a card at the BACK that is
     * the wrong answer twice over: it would open a panel the stack keeps
     * hidden, and leave the card behind. So the shuffle happens first, opens
     * the panel itself, and stops the click — otherwise the card's own
     * listener runs immediately afterwards and toggles it straight shut.
     *
     * A click on the FRONT card is left alone: opening and closing its own
     * panel is exactly what its handler is for.
     */
    toggle.addEventListener("click", (event) => {
      if (card.id === front) return;
      event.preventDefault();
      event.stopPropagation();
      bringToFront(card.id);
      const panel = byId(card.panel);
      if (panel) panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      window.dispatchEvent(new CustomEvent("geoid:legend-changed"));
    }, true);
  });
  apply();
}

if (typeof window !== "undefined") {
  window.GeoIDOverlayStack = { bringToFront, frontCard, apply };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
  // The legend's toggle is created by `legend-dock.js` when the dock first
  // draws, which can be after this runs; the cards also come and go with the
  // GIS mode. Re-wiring is idempotent — `stackWired` is the guard.
  window.addEventListener("geoid-gis:layers-changed", wire);
  window.addEventListener("geoid:legend-changed", apply);
}
