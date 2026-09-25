// Comportamiento mínimo común: reloj de Lima, feeds que se refrescan solos y confirmaciones.
(() => {
  const reloj = document.querySelector("[data-reloj]");
  if (reloj) {
    const fmt = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    setInterval(() => { reloj.textContent = fmt.format(new Date()); }, 15000);
  }
  for (const el of document.querySelectorAll("[data-refrescar]")) {
    const url = el.getAttribute("data-refrescar");
    const cada = Math.max(10, Number(el.getAttribute("data-cada")) || 30) * 1000;
    setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(url, { credentials: "same-origin" });
        if (r.ok) el.innerHTML = await r.text();
      } catch (e) { /* sin red: se intenta en la próxima vuelta */ }
    }, cada);
  }
  document.addEventListener("submit", (e) => {
    const f = e.target.closest("[data-confirmar]");
    if (f && !window.confirm(f.getAttribute("data-confirmar"))) e.preventDefault();
  }, true);
  // Evita el doble envío de formularios.
  document.addEventListener("submit", (e) => {
    if (e.defaultPrevented) return;
    const f = e.target;
    if (!f.method || f.method.toLowerCase() !== "post") return;
    setTimeout(() => { for (const b of f.querySelectorAll("button[type=submit], button:not([type])")) b.disabled = true; }, 0);
  });
  // Limpia ?ok=/?error= de la barra de direcciones para que un F5 no repita el aviso.
  const u = new URL(location.href);
  if (u.searchParams.has("ok") || u.searchParams.has("error")) {
    u.searchParams.delete("ok"); u.searchParams.delete("error");
    history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  }
})();

// App instalable (PWA): registra el service worker y ofrece el botón "Instalar app".
(() => {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  let aviso = null;
  const boton = document.getElementById("instalar-app");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    aviso = e;
    if (boton) boton.hidden = false;
  });
  if (boton) boton.addEventListener("click", async () => {
    if (!aviso) return;
    aviso.prompt();
    await aviso.userChoice.catch(() => {});
    aviso = null;
    boton.hidden = true;
  });
  window.addEventListener("appinstalled", () => { if (boton) boton.hidden = true; });
})();

// Dentro de la app de Android: opción para cambiar de servidor y sin botón de instalar.
(() => {
  if (!/ControlFlotaAndroid/.test(navigator.userAgent)) return;
  document.documentElement.classList.add("en-app");
  // WebViews viejos (Android sin actualizar) no entienden `gap` en flex: se agregan márgenes.
  const d = document.createElement("div");
  d.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute";
  d.appendChild(document.createElement("div"));
  d.appendChild(document.createElement("div"));
  document.body.appendChild(d);
  if (d.scrollHeight !== 1) document.documentElement.classList.add("sin-gap");
  d.remove();
  const b = document.getElementById("app-servidor");
  if (b) b.hidden = false;
})();
