/**
 * A PDF read in the page (pdf.js, vendored, loaded on first use), with
 * reviewers' comments pinned to the place they are about.
 *
 *   renderPdf(host, arrayBuffer, { pins, onPin })
 *     pins   [{page, x, y, label, id}]  drawn as numbered markers
 *     onPin  ({page, x, y}) => void     set: a click on a page drops a pin there
 *
 * Pages render as they scroll into view, so a 60-page thesis does not paint
 * 60 canvases up front. x and y are fractions of the page, so a pin lands on
 * the same spot at any zoom or screen width.
 */
import { h, put } from "./dom.js?v=20261024-11165cf";

let lib = null;
async function pdfjs() {
  if (lib) return lib;
  lib = await import("/social/vendor/pdf.min.mjs");
  lib.GlobalWorkerOptions.workerSrc = "/social/vendor/pdf.worker.min.mjs";
  return lib;
}

export async function renderPdf(host, data, { pins = [], onPin = null } = {}) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const pagesBox = h("div", { class: "s-pdf" });
  put(host, h("p", { class: "s-hint", text: `${doc.numPages} page${doc.numPages === 1 ? "" : "s"}${onPin ? ". Click a place on a page to pin a comment there." : "."}` }), pagesBox);
  const width = () => Math.min(900, Math.max(280, pagesBox.clientWidth || host.clientWidth || 600));
  const draw = async (n, slot) => {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = width() / base.width;
    const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
    const canvas = h("canvas", { class: "s-pdf-canvas", width: Math.floor(vp.width), height: Math.floor(vp.height),
      "aria-label": `Page ${n}` });
    canvas.style.width = `${Math.floor(base.width * scale)}px`;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    slot.replaceChildren(canvas);
    for (const p of pins.filter((x) => x.page === n)) {
      const pin = h("span", { class: "s-pdf-pin", title: p.label || "", text: String(p.n || "•") });
      pin.style.left = `${p.x * 100}%`;
      pin.style.top = `${p.y * 100}%`;
      if (p.id) pin.addEventListener("click", (e) => { e.stopPropagation(); document.getElementById(`rc-${p.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); });
      slot.appendChild(pin);
    }
    if (onPin) {
      canvas.addEventListener("click", (e) => {
        const r = canvas.getBoundingClientRect();
        onPin({ page: n, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
      });
    }
  };
  const seen = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting || en.target.dataset.drawn) continue;
      en.target.dataset.drawn = "1";
      draw(Number(en.target.dataset.page), en.target).catch(() => { en.target.textContent = "This page didn't render."; });
    }
  }, { rootMargin: "400px 0px" });
  for (let n = 1; n <= doc.numPages; n += 1) {
    const slot = h("div", { class: "s-pdf-page", "data-page": String(n) }, h("span", { class: "s-muted", text: `Page ${n}` }));
    put(pagesBox, slot);
    seen.observe(slot);
  }
  return doc;
}
