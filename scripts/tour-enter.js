/* ═══════════════════════════════════════════════════════════════════════
   Header "Enter" buttons for checkbox-armed sections — all viewers.

   Replaces the bare checkboxes that used to sit in the Tour Mode and Moon
   Viewer headers with the interaction the Flight Simulator header has: a
   labelled button that arms/disarms the mode and reads Enter / Exit.

   The original checkbox is kept in the markup, hidden — every viewer's own
   logic listens for its "change" event, and driving that checkbox means
   none of that logic needs to know these buttons exist.

   A half-second label sync runs alongside the change listener because the
   modes can also end programmatically (the moon viewer's own Exit control,
   Escape) by assigning .checked directly, which fires no event.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var MODES = [
    { section: "tour-mode-section", toggle: "tour-mode-toggle", button: "tour-mode-enter" },
    { section: "moon-viewer-section", toggle: "moon-viewer-toggle", button: "moon-viewer-enter" },
  ];

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else { fn(); }
  }

  ready(function () {
    var wired = [];

    MODES.forEach(function (mode) {
      var toggle = document.getElementById(mode.toggle);
      var btn = document.getElementById(mode.button);
      var section = document.getElementById(mode.section);
      if (!toggle || !btn) return;

      function sync() {
        var on = toggle.checked;
        var label = on ? "Exit" : "Enter";
        if (btn.textContent !== label) btn.textContent = label;
        btn.classList.toggle("is-armed", on);
        // The active retint: viewer-skin.css turns the whole section cyan
        // off this class, so activation reads as a mode, not just a button.
        if (section) section.classList.toggle("is-touring", on);
      }

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();               // don't also toggle the <details>
        var turningOn = !toggle.checked;
        // Match the flight header: entering opens the panel so the mode's
        // controls are reachable; leaving collapses it again.
        if (section) section.open = turningOn;
        toggle.checked = turningOn;
        toggle.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
      });

      toggle.addEventListener("change", sync);
      sync();
      wired.push(sync);
    });

    // Programmatic exits assign .checked without an event — keep labels honest.
    if (wired.length) {
      setInterval(function () { wired.forEach(function (fn) { fn(); }); }, 500);
    }
  });
})();
