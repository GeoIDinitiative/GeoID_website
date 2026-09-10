/**
 * TWO BUTTONS IN A ROW, AND ONE DROP-DOWN AREA UNDER THEM.
 *
 * The legend and the events feed share the top-right corner. They are never
 * read at the same time — they answer different questions about the same globe
 * — and their panels are wide enough that two open at once overlap. So the two
 * buttons are a pair of tabs into a SINGLE slot: at most one may be open,
 * pressing either shuts the other, and whichever is open drops into the same
 * rectangle rather than hanging under its own button. Two panels in two places
 * is two drop-downs however careful they are about taking turns.
 *
 * WHAT THIS IS NOT ANY MORE. It was a shuffle: one card in front at full size,
 * the other behind it, moved up and left, scaled to 0.84, turned -7deg and
 * greyed. Reported, and fairly — a slanted chip half-hidden behind the active
 * one reads as a rendering fault, not as a control. The buttons sit side by
 * side at full size now (`placeOverlay` in events.js does the offset, off the
 * legend's TOGGLE so the row cannot move when a panel opens), and the only
 * thing left here is the rule that was worth keeping.
 *
 * WHY IT LIVES IN ITS OWN FILE. The legend owns its toggle in `legend-dock.js`
 * and the feed owns its own in `events.js`, and each is right to. Which of
 * them is open belongs to neither — putting it in one would make that one the
 * parent of the other, and the next card added to this corner would have to be
 * taught about both.
 */

const CARDS = [
  { id: "map-legend", toggle: "map-legend-toggle", panel: "map-legend-panel" },
  { id: "events-overlay", toggle: "events-panel-toggle", panel: "events-panel" },
];

/**
 * The legend leads, because it describes what is already on the globe; the
 * feed is something you go and ask for. Only consulted to break a tie.
 */
let last = CARDS[0].id;

/**
 * WHICH CARD THE PAGE OPENS ON, and why that needs saying at all.
 *
 * The two openers are not equals at boot. The feed is armed deliberately by
 * `armOnLaunch`; the legend opens ITSELF whenever a layer arrives, which at
 * launch is the launch defaults landing a second or two later. With one slot
 * between them the card in front was decided by whichever fetch finished
 * first, which is why the feed used to arm without opening its panel at all.
 *
 * A claim settles it, and it is a DEFAULT rather than a lock: pressing either
 * toggle ends it on the spot, because a press is a decision and this is not.
 * It also expires, since nothing announces that a launch is over and a
 * suppression with no end would stop the legend opening for a layer somebody
 * ticks ten minutes later. The bound is `armOnLaunch`'s own — the twelve
 * seconds it will wait for a viewer before giving up — rather than a number
 * invented here.
 */
const CLAIM_MS = 12000;
let claimed = null;
let claimedAt = 0;

const claimStands = () => Boolean(claimed) && Date.now() - claimedAt < CLAIM_MS;

/** Open `id` and hold the slot for it through the launch. */
export function claim(id) {
  if (!CARDS.some((card) => card.id === id)) return false;
  claimed = id;
  claimedAt = Date.now();
  showOnly(id);
  return true;
}

/**
 * May `id` open ITSELF? A card asks before an automatic open, never before one
 * the reader asked for — a press goes through the card's own toggle and is
 * always honoured.
 */
export function mayAutoOpen(id) {
  return !claimStands() || claimed === id;
}

/** The reader has chosen; the launch no longer gets a say. */
export function releaseClaim() {
  claimed = null;
}

const byId = (id) => document.getElementById(id);

const isOpen = (card) => {
  const panel = byId(card.panel);
  return Boolean(panel) && !panel.hidden;
};

/** Shut a card's panel and say so on its toggle, without firing its handler. */
function closeCard(card) {
  const panel = byId(card.panel);
  if (panel) panel.hidden = true;
  byId(card.toggle)?.setAttribute("aria-expanded", "false");
}

/** The gap between the row of buttons and the panel under it. */
const SLOT_GAP = 6;
/** The wider of the two panels' own widths, so the area is one rectangle. */
const SLOT_WIDTH = "17.5rem";

/**
 * The slot, from the buttons themselves: under the lowest of them, and
 * right-aligned to the rightmost, so it cannot drift from the row it hangs off.
 * Pure, because everything else here needs a document and this is the only
 * part with arithmetic worth pinning.
 *
 * AND IT STEPS LEFT OF WHAT IT MUST NOT COVER. Below about 1,000 px the clock
 * cluster drops under the tool rail, into the column this slot hangs down —
 * measured at 900 px, the drop-down laid its left 27 px over the clock. An
 * `avoid` rect reaching below the slot's top and into its width pushes the
 * slot's right edge to that rect's left, less the gap. The panel's height is
 * not known here and the panel can be tall, so anything below the top counts.
 */
export function slotFrom(rects, viewportWidth, gap = SLOT_GAP, avoid = [], width = 280) {
  const seen = (rects || []).filter((r) => r && r.width > 0);
  if (!seen.length) return null;
  const top = Math.max(...seen.map((r) => r.bottom)) + gap;
  let edge = Math.max(...seen.map((r) => r.right));
  // A DOMRect carries both `left` and `x`; a hand-built one may carry only one.
  const leftOf = (r) => r.left ?? r.x;
  const obstacles = (avoid || []).filter((r) => r && r.width > 0 && r.bottom > top)
    .sort((a, b) => leftOf(b) - leftOf(a));
  for (const r of obstacles) {
    if (leftOf(r) < edge && r.right > edge - width) edge = leftOf(r) - gap;
  }
  return { top, right: viewportWidth - edge };
}

/**
 * Pin both panels into that one rectangle.
 *
 * `position: fixed` takes each panel out of its own card's flow, which is the
 * whole point: a panel that flows under its button is at that button's x, and
 * the two buttons are not in the same place. Written `!important` for the
 * reason `placeOverlay` records about this corner — a plain inline write on
 * the events host is silently ignored — and because the panels' own widths are
 * set from an ID selector.
 */
function applySlot() {
  if (typeof window === "undefined") return;
  const rects = CARDS
    .map((card) => byId(card.id) && !byId(card.id).hidden && byId(card.toggle))
    .filter(Boolean)
    .map((toggle) => toggle.getBoundingClientRect());
  // The clock cluster, where it has dropped into this column (narrow screens).
  const clock = byId("top-right-controls");
  const avoid = clock && window.getComputedStyle(clock).display !== "none"
    ? [clock.getBoundingClientRect()] : [];
  const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  const slot = slotFrom(rects, window.innerWidth, SLOT_GAP, avoid, 17.5 * rem);
  if (!slot) return;
  CARDS.forEach((card) => {
    const panel = byId(card.panel);
    if (!panel) return;
    panel.style.setProperty("position", "fixed", "important");
    panel.style.setProperty("top", `${Math.round(slot.top)}px`, "important");
    panel.style.setProperty("right", `${Math.round(slot.right)}px`, "important");
    panel.style.setProperty("width", SLOT_WIDTH, "important");
  });
}

/**
 * Enforce the one rule: if both panels are open, the one opened LAST stays.
 * Called after anything that can open a panel behind our back — the legend
 * opens itself when a layer arrives.
 */
export function apply() {
  applySlot();
  const open = CARDS.filter((card) => byId(card.id) && isOpen(card));
  if (open.length < 2) {
    if (open.length === 1) last = open[0].id;
    return;
  }
  const keep = open.find((card) => card.id === last) || open[0];
  last = keep.id;
  open.forEach((card) => { if (card.id !== keep.id) closeCard(card); });
}

/** Open `id`'s panel and shut the other. Returns whether anything moved. */
export function showOnly(id) {
  const card = CARDS.find((entry) => entry.id === id);
  if (!card) return false;
  last = id;
  let moved = false;
  CARDS.forEach((entry) => {
    if (entry.id === id) return;
    if (isOpen(entry)) { closeCard(entry); moved = true; }
  });
  return moved;
}

/** The card whose panel is open, or null. */
export function openCard() {
  return CARDS.find((card) => byId(card.id) && isOpen(card))?.id ?? null;
}

function wire() {
  CARDS.forEach((card) => {
    const toggle = byId(card.toggle);
    if (!toggle || toggle.dataset.stackWired) return;
    toggle.dataset.stackWired = "1";
    /**
     * CAPTURE, and it does NOT take the click.
     *
     * Each card's own handler flips its own panel, which is exactly right;
     * all this has to add is shutting the other one first. So it runs ahead of
     * that handler and then lets it through — stopping the click here would
     * mean reimplementing both toggles, and taking it after would mean the
     * other panel closes a frame after this one opens.
     */
    toggle.addEventListener("click", () => {
      // A press supersedes whatever the launch opened, in either direction.
      releaseClaim();
      last = card.id;
      // Only when this press will OPEN it: pressing an open card closes it,
      // and shutting the other one as well would be two closes for one press.
      if (!isOpen(card)) showOnly(card.id);
      // The panel is about to be shown by the card's own handler, so the slot
      // has to be right before that rather than on the next event.
      applySlot();
    }, true);
  });
  apply();
}

if (typeof window !== "undefined") {
  window.GeoIDOverlayStack = { showOnly, openCard, apply, slotFrom, claim, mayAutoOpen, releaseClaim };
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
  // The row moves with the viewport and with the hub's own rail, and the slot
  // is measured off the row.
  window.addEventListener("resize", applySlot);
  window.addEventListener("geoid-gis:mode-change", () => window.setTimeout(apply, 0));
}
