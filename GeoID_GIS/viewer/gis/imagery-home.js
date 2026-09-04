/**
 * ONE imagery panel, two homes.
 *
 * "Imagery over time" belongs in two places and is one thing. It sits under
 * Map, because that is where the base textures and tile services live and a
 * film of the ground is the same subject seen through time; and it sits under
 * Earth Observation, because watching the ground change IS the observation and
 * nobody looking for it there should be told to go and find another tab.
 *
 * It cannot simply be written twice. Every control in it is addressed by id --
 * `imagery-tl-run`, `imagery-tl-status`, the four bounds boxes -- and
 * `imagery-panel.js` binds them with `getElementById`, which answers with the
 * first copy in the document and quietly ignores the second. Two copies would
 * be one working panel and one dead one, and which is which would depend on
 * document order.
 *
 * So the panel is moved. Opening either section brings the single panel into
 * it, which also means the running state travels: a sequence started under Map
 * is still there, still playing, when you open the section under Earth
 * Observation. Two panels could not have done that.
 */

const HOSTS = ["map-imagery-host", "earth-observation-imagery-host"];
const PANEL = "basemap-timelapse";

const byId = (id) => document.getElementById(id);

/** Move the panel into this host, unless it is already there. */
function homeIn(hostId) {
  const panel = byId(PANEL);
  const host = byId(hostId);
  if (!panel || !host || panel.parentElement === host) return;
  host.appendChild(panel);
}

/**
 * The section that owns a host, which is the thing that opens and closes.
 * `closest` rather than a hard-coded id, so a host can be re-nested without
 * this file having to hear about it.
 */
function sectionOf(hostId) {
  return byId(hostId)?.closest("details") || null;
}

/**
 * Whichever section is open keeps the panel; if both are somehow open, the one
 * just opened wins, which is what the `toggle` handler below arranges.
 */
function wire() {
  const hosts = HOSTS.filter(byId);
  // One host on this page (a planet viewer has no Earth Observation tab) needs
  // no moving at all -- the panel is already where it belongs.
  if (hosts.length < 2) return hosts.length;
  hosts.forEach((hostId) => {
    const section = sectionOf(hostId);
    if (!section || section.dataset.imageryHomed === "1") return;
    section.dataset.imageryHomed = "1";
    section.addEventListener("toggle", () => {
      if (!section.open) return;
      homeIn(hostId);
      // Shut the other one: two sections both claiming to hold the panel, one
      // of them empty, is worse than one closed section.
      hosts.filter((id) => id !== hostId).forEach((id) => {
        const other = sectionOf(id);
        if (other && other !== section) other.open = false;
      });
    });
  });
  return hosts.length;
}

if (typeof document !== "undefined") {
  /**
   * Retried, the way the other panel modules are: this markup arrives with the
   * page on Earth and with the shell on a planet page, and `toolbox.js` moves
   * whole groups afterwards -- so the hosts appear at a moment no single event
   * announces.
   */
  let tries = 0;
  const attempt = () => {
    const found = wire();
    if (found >= 2 || (tries += 1) > 60) return;
    setTimeout(attempt, 400);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attempt);
  } else {
    attempt();
  }
}

export { homeIn, wire };
