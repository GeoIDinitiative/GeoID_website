/* ═══════════════════════════════════════════════════════════════════════
   Tour mode — "Enter" button in the section header, all eleven viewers.

   Replaces the bare checkbox that used to sit in the Tour Mode header with
   the same interaction the Flight Simulator header has: a labelled button
   that arms/disarms the mode and reads Enter / Exit accordingly.

   The original checkbox is kept in the markup, hidden — every viewer's own
   tour logic listens for its "change" event, and driving that checkbox
   means none of that logic needs to know this button exists.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else { fn(); }
  }

  ready(function () {
    var toggle = document.getElementById("tour-mode-toggle");
    var btn = document.getElementById("tour-mode-enter");
    var section = document.getElementById("tour-mode-section");
    if (!toggle || !btn) return;

    function sync() {
      var on = toggle.checked;
      btn.textContent = on ? "Exit" : "Enter";
      btn.classList.toggle("is-armed", on);
      // The active-tour retint: viewer-skin.css turns the whole section cyan
      // off this class, so activation reads as a mode, not just a button.
      if (section) section.classList.toggle("is-touring", on);
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();               // don't also toggle the <details>
      var turningOn = !toggle.checked;
      // Match the flight header: entering opens the panel so the facet and
      // target controls are reachable; leaving collapses it again.
      if (section) section.open = turningOn;
      toggle.checked = turningOn;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
    });

    // The tour can also end from elsewhere (Escape, its own exit control),
    // which lands on the same checkbox — keep the button label honest.
    toggle.addEventListener("change", sync);
    sync();
  });
})();
