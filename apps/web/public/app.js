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

// Dentro de la app de Android: sin botón de instalar y con arreglos para WebViews viejos.
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
})();

// Usabilidad en el celular (ver docs/ESTUDIO-USABILIDAD.md).
(() => {
  // Aviso de «guardado»: se va solo a los 5 s o al tocarlo.
  for (const t of document.querySelectorAll("[data-toast]")) {
    const quitar = () => { t.classList.add("fuera"); setTimeout(() => t.remove(), 400); };
    t.addEventListener("click", quitar);
    setTimeout(quitar, 5000);
  }

  // Formularios plegables: se abren al tocar su título o al llegar con su enlace (#id).
  const plegables = [...document.querySelectorAll(".panel[data-plegable]")];
  const abrir = (p, enfocar) => {
    p.classList.add("abierto");
    p.querySelector(".panel-cab")?.setAttribute("aria-expanded", "true");
    if (enfocar) {
      p.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => p.querySelector("input:not([type=hidden]), select, textarea")?.focus({ preventScroll: true }), 350);
    }
  };
  for (const p of plegables) {
    const cab = p.querySelector(".panel-cab");
    if (!cab) continue;
    cab.setAttribute("role", "button");
    cab.setAttribute("tabindex", "0");
    cab.setAttribute("aria-expanded", "false");
    const alternar = () => {
      if (p.classList.toggle("abierto")) abrir(p, true);
      else cab.setAttribute("aria-expanded", "false");
    };
    cab.addEventListener("click", (e) => { if (!e.target.closest("a, button, input, select")) alternar(); });
    cab.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(); } });
  }
  const porHash = () => {
    if (!location.hash) return;
    const destino = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!destino) return;
    for (const p of plegables) if (p === destino || p.contains(destino) || destino.contains(p)) abrir(p, p === destino || p.contains(destino));
  };
  porHash();
  window.addEventListener("hashchange", porHash);
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (a && a.getAttribute("href") === location.hash) porHash();
  });

  // Filtros (mes, unidad) que se aplican solos al cambiar: un toque menos.
  for (const f of document.querySelectorAll("form[data-auto]")) {
    f.addEventListener("change", () => f.requestSubmit ? f.requestSubmit() : f.submit());
  }

  // Tablas → tarjetas en el celular: cada celda lleva el título de su columna.
  for (const t of document.querySelectorAll("table.t")) {
    const titulos = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    if (!titulos.length || t.closest("[data-sin-tarjetas]")) continue;
    for (const tr of t.querySelectorAll("tbody tr")) {
      [...tr.children].forEach((td, i) => { if (td.tagName === "TD" && !td.hasAttribute("colspan")) td.setAttribute("data-etiqueta", titulos[i] ?? ""); });
    }
    t.classList.add("tarjetas-movil");
  }

  // «Más»: se cierra al tocar fuera o al elegir.
  const mas = document.querySelector(".tabbar .mas");
  if (mas) document.addEventListener("click", (e) => { if (mas.open && !mas.contains(e.target)) mas.open = false; });
})();

// Validación al salir del campo (no mientras se escribe) y «Guardando…» al enviar.
(() => {
  const mensaje = (el) => {
    const v = el.validity;
    if (v.valueMissing) return "Falta este dato.";
    if (el.inputMode === "decimal" && el.value && !/^\s*-?[\d.,]+\s*$/.test(el.value)) return "Escribe solo el número (ej. 120.50).";
    if (el.inputMode === "numeric" && el.value && !/^\s*[\d.,\s]+\s*$/.test(el.value)) return "Escribe solo números.";
    if (v.patternMismatch) return el.title || "El formato no es válido.";
    if (v.typeMismatch) return "El formato no es válido.";
    if (v.rangeUnderflow) return `Debe ser ${el.min} o más.`;
    if (v.rangeOverflow) return `Debe ser ${el.max} o menos.`;
    return el.validationMessage || "";
  };
  const revisar = (el, mostrarOk) => {
    if (!el.closest(".campo") || el.type === "hidden" || el.type === "file" || el.disabled) return true;
    el.setCustomValidity(""); // el mensaje anterior no cuenta: se vuelve a revisar desde cero
    const texto = mensaje(el);
    el.setCustomValidity(texto && !el.validity.valueMissing && !el.validity.typeMismatch ? texto : "");
    let nota = el.closest(".campo").querySelector(".error-campo");
    if (texto) {
      if (!nota) { nota = document.createElement("small"); nota.className = "error-campo"; nota.setAttribute("role", "alert"); el.closest(".campo").append(nota); }
      nota.textContent = texto;
      el.setAttribute("aria-invalid", "true");
      el.classList.remove("valido");
      return false;
    }
    nota?.remove();
    el.removeAttribute("aria-invalid");
    el.classList.toggle("valido", !!(mostrarOk && el.value));
    return true;
  };
  document.addEventListener("focusout", (e) => { if (e.target.matches?.("input, select, textarea")) revisar(e.target, true); });
  document.addEventListener("input", (e) => { if (e.target.getAttribute?.("aria-invalid") === "true") revisar(e.target, false); });
  document.addEventListener("submit", (e) => {
    const f = e.target;
    if (!(f instanceof HTMLFormElement) || (f.method || "").toLowerCase() !== "post") return;
    const malos = [...f.querySelectorAll("input, select, textarea")].filter((el) => !revisar(el, false));
    if (malos.length) { e.preventDefault(); e.stopImmediatePropagation(); malos[0].focus(); return; }
    setTimeout(() => {
      if (e.defaultPrevented) return;
      for (const b of f.querySelectorAll("button[type=submit], button:not([type])")) {
        if (b.textContent.trim().length > 2) { b.dataset.texto = b.textContent; b.textContent = "Guardando…"; }
      }
    }, 0);
  }, true);
  // Si se vuelve con «atrás», los botones quedan como estaban.
  window.addEventListener("pageshow", () => {
    for (const b of document.querySelectorAll("button[data-texto]")) { b.textContent = b.dataset.texto; b.disabled = false; delete b.dataset.texto; }
  });
})();

// Listas largas diferidas: se copian de su plantilla la primera vez que se abren.
(() => {
  const llenar = (sel) => {
    const tpl = document.getElementById(sel.dataset.opciones);
    if (!tpl || sel.dataset.lleno) return;
    const elegidas = new Set([...sel.selectedOptions].map((o) => o.value));
    sel.replaceChildren(tpl.content.cloneNode(true));
    for (const o of sel.options) o.selected = elegidas.has(o.value);
    sel.dataset.lleno = "1";
  };
  for (const sel of document.querySelectorAll("select[data-opciones]")) {
    for (const ev of ["focus", "pointerdown", "touchstart"]) sel.addEventListener(ev, () => llenar(sel), { once: true, passive: true });
    sel.closest("details")?.addEventListener("toggle", (e) => { if (e.target.open) llenar(sel); });
  }
})();
