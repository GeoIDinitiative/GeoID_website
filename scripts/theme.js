/**
 * GEOHUB THEMES — the applier, shared by the shell and all eleven viewers.
 *
 * A theme is one attribute: `data-skin` on <html>, which `viewer-themes.css`
 * hangs every palette and every signature rule off. This file is the only
 * thing that writes it.
 *
 * IT IS A PLAIN SCRIPT, NOT A MODULE, AND IT RUNS IN <head>. A module is
 * deferred by definition, so the first paint would land in the previous
 * theme and switch a frame later — the flash a theme picker exists to avoid.
 * Loaded synchronously before the body exists, the attribute is already on
 * the root when the first rule is resolved. It costs one blocking request of
 * about a kilobyte, and that is the price of not flashing.
 *
 * BOTH DOCUMENTS. The GIS viewer is an iframe inside the GeoHUB shell, and a
 * theme that stopped at the iframe edge would leave the page around it in the
 * old palette. The two keep in step over the postMessage bridge the shell
 * already runs: whichever document is asked tells the other, and each stamps
 * its own root. `localStorage` is shared by same-origin documents, so a
 * reload in either lands on the same theme without a message at all.
 */
(function () {
  "use strict";

  /**
   * The registry — id, the name the dropdown shows, and one line saying what
   * the theme IS. Kept here rather than in the panel markup so the viewer,
   * the shell and the test all read one list.
   */
  var THEMES = [
    { id: "default", name: "GeoHUB", note: "magenta chrome, cyan data" },
    { id: "crt", name: "CRT terminal", note: "green phosphor and scanlines" },
    { id: "pixel", name: "8-bit pixel", note: "hard bevels, nothing rounded" },
    { id: "vector", name: "Vector glow", note: "black ground, hairline strokes" },
    { id: "outrun", name: "Outrun", note: "violet ground, neon glow" },
    { id: "beige", name: "Beige box", note: "90s desktop: grey panels, navy title bars" },
    { id: "hud", name: "HUD", note: "cyan and amber, corner brackets" }
  ];

  var KEY = "geoid:skin";

  function known(id) {
    for (var i = 0; i < THEMES.length; i += 1) if (THEMES[i].id === id) return true;
    return false;
  }

  /** What is stored, or the default — never a value the CSS has no block for. */
  function stored() {
    try {
      var held = window.localStorage.getItem(KEY);
      return known(held) ? held : "default";
    } catch (error) {
      // A private window throws on access. A theme is a preference, so the
      // right answer to "cannot remember" is the default, not a failure.
      return "default";
    }
  }

  /**
   * Stamp the root. The DEFAULT carries no attribute at all, so the base skin
   * applies exactly as it did before this file existed — which is what makes
   * the default theme a true no-op rather than a sixth palette that happens
   * to match.
   */
  function stamp(id) {
    var root = document.documentElement;
    if (!id || id === "default") root.removeAttribute("data-skin");
    else root.setAttribute("data-skin", id);
  }

  function tell(id) {
    // Down into the viewer, and up into the shell: whichever document this is,
    // the other one is on the far side of exactly one of these.
    try {
      var frames = document.querySelectorAll("iframe");
      for (var i = 0; i < frames.length; i += 1) {
        if (frames[i].contentWindow) {
          frames[i].contentWindow.postMessage({ type: "geoid:skin", skin: id }, "*");
        }
      }
    } catch (error) { /* a cross-origin frame is not ours to tell */ }
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "geoid:skin", skin: id }, "*");
      }
    } catch (error) { /* ditto */ }
  }

  function apply(id, options) {
    var next = known(id) ? id : "default";
    stamp(next);
    if (!options || options.persist !== false) {
      try { window.localStorage.setItem(KEY, next); } catch (error) { /* private window */ }
    }
    if (!options || options.tell !== false) tell(next);
    try {
      window.dispatchEvent(new CustomEvent("geoid:skin-changed", { detail: { skin: next } }));
    } catch (error) { /* CustomEvent is old enough to be safe; belt and braces */ }
    return next;
  }

  /**
   * A `?skin=` IN THE URL WINS FOR THAT LOAD, and is not remembered.
   *
   * It makes a theme linkable — a screenshot, a bug report, "look at it in
   * outrun" — without the link quietly rewriting what the person who opened
   * it had chosen. Their stored preference is still there on the next plain
   * visit, which is the difference between showing someone a theme and
   * changing their settings for them.
   */
  function asked() {
    try {
      var value = new URLSearchParams(window.location.search).get("skin");
      return known(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  // The first stamp, before anything is painted.
  stamp(asked() || stored());

  /** What this document is showing right now — the attribute is the truth. */
  function current() {
    return document.documentElement.getAttribute("data-skin") || "default";
  }

  window.addEventListener("message", function (event) {
    var data = event && event.data;
    if (!data) return;
    if (data.type === "geoid:skin") {
      // Applied but NOT re-announced: two documents each telling the other is
      // a loop, and they are already agreed by the time this runs.
      apply(data.skin, { tell: false, persist: data.persist !== false });
      return;
    }
    /**
     * A FRAME ASKING WHAT THE THEME IS — and this is not belt and braces, it
     * is the only thing that carries a `?skin=` across the iframe boundary.
     * The shell stamps itself in <head>, which is BEFORE its iframe exists, so
     * there is nothing to tell at that moment and the viewer would come up in
     * whatever it had stored — measured, a `?skin=crt` shell around a default
     * viewer. Storage covers the ordinary case; this covers the linked one.
     */
    if (data.type === "geoid:skin?" && event.source) {
      try {
        event.source.postMessage(
          { type: "geoid:skin", skin: current(), persist: false }, "*");
      } catch (error) { /* the frame went away mid-answer */ }
    }
  });

  // Ask on the way up, once, and only from inside a frame.
  if (window.parent && window.parent !== window) {
    try { window.parent.postMessage({ type: "geoid:skin?" }, "*"); } catch (error) { /* not ours */ }
  }

  /**
   * A second tab is a second document with the same storage, so a theme
   * chosen over there lands here too — without either page being reloaded.
   */
  window.addEventListener("storage", function (event) {
    if (!event || event.key !== KEY) return;
    apply(event.newValue, { persist: false, tell: true });
  });

  /**
   * THE DROPDOWN, wired from here rather than from a panel module.
   *
   * The Settings markup is one string rendered on all ten worlds, so the
   * control exists everywhere; wiring it in a viewer file would reach Earth
   * alone (which is exactly what happened to the clock timezone beside it).
   * The panel renders on its own schedule, so the options are filled by a
   * poll — the clock's own pattern — while the `change` is a document-level
   * listener that does not care where the panel has been moved to.
   */
  function fillSelect() {
    var select = document.getElementById("gis-skin");
    if (!select) { window.setTimeout(fillSelect, 700); return; }
    if (!select.options.length) {
      for (var i = 0; i < THEMES.length; i += 1) {
        var option = document.createElement("option");
        option.value = THEMES[i].id;
        option.textContent = THEMES[i].name;
        select.appendChild(option);
      }
    }
    select.value = asked() || stored();
    note(select.value);
    var soundBox = document.getElementById("gis-skin-sound");
    if (soundBox && window.GeoIDUiSound) soundBox.checked = window.GeoIDUiSound.isEnabled();
  }

  function note(id) {
    var node = document.getElementById("gis-skin-note");
    if (!node) return;
    for (var i = 0; i < THEMES.length; i += 1) {
      if (THEMES[i].id === id) { node.textContent = THEMES[i].note; return; }
    }
    node.textContent = "";
  }

  document.addEventListener("change", function (event) {
    if (!event.target || event.target.id !== "gis-skin") return;
    note(apply(event.target.value));
    // The theme's own click, as the confirmation that it took.
    if (window.GeoIDUiSound && window.GeoIDUiSound.isEnabled()) {
      window.GeoIDUiSound.playClick();
    }
  });

  /**
   * The sound switch. It drives `ui-sound.js` — the ONE sound system, which
   * predates the themes, is on by default and now speaks in each theme's own
   * voice. It had no control anywhere until this one.
   */
  document.addEventListener("change", function (event) {
    if (!event.target || event.target.id !== "gis-skin-sound") return;
    if (!window.GeoIDUiSound) return;
    window.GeoIDUiSound.setEnabled(event.target.checked);
    if (event.target.checked) window.GeoIDUiSound.playClick();
  });
  // A theme chosen in the shell, or in another tab, moves this select too.
  window.addEventListener("geoid:skin-changed", function (event) {
    var select = document.getElementById("gis-skin");
    var id = event && event.detail && event.detail.skin;
    if (select && id && select.value !== id) select.value = id;
    note(id);
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fillSelect);
  } else {
    fillSelect();
  }

  /**
   * WHAT A CANVAS ASKS THE THEME.
   *
   * Three surfaces are DRAWN rather than styled — the seven-segment clock, the
   * map's label chips, and the hover highlight on the globe — so no stylesheet
   * can reach them and they stayed in the default palette under every theme.
   * They read their colour from a token through here instead, which keeps one
   * source: the same `viewer-themes.css` block that paints the panels.
   *
   * Each has its OWN token with the current value as the fallback, rather than
   * reusing `--skin-data`: the default theme then draws exactly what it drew
   * before this existed, and a theme opts in by restating one value.
   */
  function token(name, fallback) {
    try {
      var value = window.getComputedStyle(document.documentElement)
        .getPropertyValue(name).trim();
      return value || fallback;
    } catch (error) {
      return fallback;
    }
  }

  /** The same, as a three.js colour number. */
  function hex(name, fallback) {
    var value = token(name, "");
    var match = /^#?([0-9a-f]{6})$/i.exec(value);
    return match ? parseInt(match[1], 16) : fallback;
  }

  window.GeoIDTheme = {
    token: token,
    hex: hex,
    THEMES: THEMES,
    KEY: KEY,
    get: stored,
    set: apply,
    isKnown: known
  };
}());
