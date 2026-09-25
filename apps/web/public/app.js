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
      } catch { /* sin red: se intenta en la próxima vuelta */ }
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
    if (f.method?.toLowerCase() !== "post") return;
    setTimeout(() => { for (const b of f.querySelectorAll("button[type=submit], button:not([type])")) b.disabled = true; }, 0);
  });
  // Limpia ?ok=/?error= de la barra de direcciones para que un F5 no repita el aviso.
  const u = new URL(location.href);
  if (u.searchParams.has("ok") || u.searchParams.has("error")) {
    u.searchParams.delete("ok"); u.searchParams.delete("error");
    history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  }
})();
