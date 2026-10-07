// Anotar en la PC: se abre como panel lateral sobre cualquier página, y «Así queda» se recalcula
// mientras se escribe. En el celular (o sin JS) los enlaces abren la página /anotar normal.
// Guardar es un POST normal del formulario: app.js bloquea el doble envío y, si algo falla, el
// servidor vuelve a /anotar con lo escrito y el aviso.
(() => {
  const panel = document.getElementById("panel-anotar");
  const ancho = window.matchMedia("(min-width: 900px)");

  function enlazarAsiQueda(raiz) {
    const form = raiz.querySelector("form[data-asi-queda]");
    if (!form) return;
    let espera = null;
    let vuelta = 0;
    const refrescar = async () => {
      const f = new FormData(form);
      const cat = f.get("categoria") === "otro" ? f.get("categoriaOtra") : f.get("categoria");
      const q = new URLSearchParams({ tipo: f.get("tipo") || "", monto: f.get("monto") || "", viajeId: f.get("viajeId") || "", categoria: cat || "" });
      const esta = ++vuelta;
      try {
        const r = await fetch(`/anotar/asi-queda?${q}`, { credentials: "same-origin" });
        const html = r.ok ? await r.text() : null;
        const caja = form.querySelector("#asi-queda");
        // Solo la última respuesta: si se escribió rápido, una vieja no pisa a la nueva.
        if (html && caja && esta === vuelta) caja.outerHTML = html;
      } catch (e) { /* sin red: se queda lo de antes */ }
    };
    form.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(refrescar, 300); });
    form.addEventListener("change", () => { clearTimeout(espera); espera = setTimeout(refrescar, 50); });
  }

  let abriendo = false;
  let desde = null;

  async function abrir(url) {
    if (abriendo) return;
    abriendo = true;
    const u = new URL(url, location.href);
    u.searchParams.set("parcial", "1");
    if (!u.searchParams.get("volver")) u.searchParams.set("volver", location.pathname + location.search);
    try {
      const r = await fetch(u, { credentials: "same-origin" });
      if (!r.ok || r.redirected) { location.href = url; return; }
      panel.innerHTML = await r.text();
      // En el panel, «volver» cierra el panel (se queda en la misma página).
      const volver = panel.querySelector(".cab-pagina a[aria-label=Volver]");
      if (volver) { volver.setAttribute("aria-label", "Cerrar"); volver.setAttribute("data-cerrar-panel", ""); }
      if (panel.hidden) desde = document.activeElement;
      panel.hidden = false;
      document.body.classList.add("con-panel");
      enlazarAsiQueda(panel);
      const monto = panel.querySelector("input[name=monto], input[name=manoObra], input[name=costo]");
      if (monto) monto.focus();
    } catch (e) {
      location.href = url;
    } finally {
      abriendo = false;
    }
  }

  function cerrar() {
    panel.hidden = true;
    panel.innerHTML = "";
    document.body.classList.remove("con-panel");
    if (desde && desde.focus) desde.focus();
    desde = null;
  }

  if (panel) {
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button > 0) return;
      if (panel.contains(a) && a.matches("[data-cerrar-panel]")) {
        e.preventDefault();
        cerrar();
        return;
      }
      if (!ancho.matches) return;
      if (a.matches("[data-abrir-panel]") || (panel.contains(a) && a.matches("[data-panel-link]"))) {
        e.preventDefault();
        abrir(a.href);
      }
    });
    document.addEventListener("submit", (e) => {
      const f = e.target;
      if (!ancho.matches || !f.matches || !f.matches("form[data-panel-form]")) return;
      e.preventDefault();
      const q = new URLSearchParams(new FormData(f));
      abrir(`${f.getAttribute("action")}?${q}`);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) cerrar(); });
    // Si la ventana se achica a tamaño celular, el panel se cierra (en el celular Anotar es su propia página).
    ancho.addEventListener("change", () => { if (!ancho.matches && !panel.hidden) cerrar(); });
  }
  enlazarAsiQueda(document);
})();
