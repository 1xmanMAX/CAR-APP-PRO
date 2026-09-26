// Visor 3D del trailer: nube de puntos con cada pieza por separado (cada llanta, retrovisor,
// faro…). El color es el desgaste de su zona; al tocar una pieza se resalta y se muestra su
// historial al lado. La forma de las piezas viene del servidor (packages/core/src/flota/componentes.ts).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const datos = JSON.parse(document.getElementById("datos-visor").textContent);
const cont = document.getElementById("visor");
const canvas = cont.querySelector("canvas");
const etiqueta = cont.querySelector(".etiqueta");

const COLOR = { ok: "#8FB4CC", proximo: "#F2C14E", cambiar: "#FF5AAE" };
const GRIS = "#E9E3D6";
const RESALTE = "#FFE08A";
const ESTADO_TXT = { ok: "OK", proximo: "PRÓXIMO", cambiar: "CAMBIAR" };

function soportaWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

// ——— Muestreo de las formas (semilla fija: el modelo sale igual cada vez) ———
let semilla = 11;
const rnd = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
const DENSIDAD = 55; // puntos por m²
const cuantos = (area, min, max) => Math.max(min, Math.min(max, Math.round(area * DENSIDAD)));

function muestrearCaja(f, P) {
  const [x0, y0, z0] = f.min, [x1, y1, z1] = f.max;
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const areas = [dy * dz, dy * dz, dx * dz, dx * dz, dx * dy, dx * dy];
  const total = areas.reduce((a, b) => a + b, 0) || 1;
  const n = cuantos(total, 120, 1900);
  for (let i = 0; i < n; i++) {
    let r = rnd() * total, cara = 0;
    while (cara < 5 && r > areas[cara]) r -= areas[cara++];
    let x = x0 + rnd() * dx, y = y0 + rnd() * dy, z = z0 + rnd() * dz;
    if (cara === 0) x = x0; else if (cara === 1) x = x1; else if (cara === 2) y = y0; else if (cara === 3) y = y1; else if (cara === 4) z = z0; else z = z1;
    P.push(x, y, z);
  }
}

/** Punto en coordenadas locales del cilindro (a = a lo largo del eje, u/v = sección) → mundo. */
function ubicar(c, eje, a, u, v, P) {
  if (eje === "x") P.push(c[0] + a, c[1] + u, c[2] + v);
  else if (eje === "y") P.push(c[0] + u, c[1] + a, c[2] + v);
  else P.push(c[0] + u, c[1] + v, c[2] + a);
}

function muestrearCilindro(f, P) {
  const lateral = 2 * Math.PI * f.r * f.largo, tapa = Math.PI * f.r * f.r;
  const n = cuantos(lateral + 2 * tapa, 110, 900);
  for (let i = 0; i < n; i++) {
    const ang = rnd() * Math.PI * 2;
    if (rnd() < lateral / (lateral + 2 * tapa)) {
      ubicar(f.c, f.eje, (rnd() - 0.5) * f.largo, Math.cos(ang) * f.r, Math.sin(ang) * f.r, P);
    } else {
      const rr = f.r * Math.sqrt(rnd());
      ubicar(f.c, f.eje, (rnd() < 0.5 ? -0.5 : 0.5) * f.largo, Math.cos(ang) * rr, Math.sin(ang) * rr, P);
    }
  }
}

function muestrearLlanta(f, P) {
  const [cx, cy, cz] = f.c;
  const exterior = Math.sign(cz) || 1; // el aro se ve por fuera
  for (let i = 0; i < 300; i++) {
    const ang = rnd() * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang), q = rnd();
    if (q < 0.45) { // banda de rodadura
      P.push(cx + c * f.r, cy + s * f.r, cz + (rnd() - 0.5) * f.ancho);
    } else if (q < 0.85) { // flancos
      const rr = f.r * (0.62 + 0.38 * rnd());
      P.push(cx + c * rr, cy + s * rr, cz + (rnd() < 0.5 ? -0.5 : 0.5) * f.ancho);
    } else { // aro
      const rr = f.r * (0.18 + 0.4 * rnd());
      P.push(cx + c * rr, cy + s * rr, cz + exterior * 0.4 * f.ancho);
    }
  }
}

/** Contorno de cada forma (aristas de las cajas, bordes de cilindros y llantas): une visualmente la nube. */
function contornoDe(pieza) {
  const L = [];
  const seg = (a, b) => L.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  const circulo = (punto, n = 24) => {
    for (let i = 0; i < n; i++) seg(punto((i / n) * Math.PI * 2), punto(((i + 1) / n) * Math.PI * 2));
  };
  for (const f of pieza.formas) {
    if (f.t === "caja") {
      const [x0, y0, z0] = f.min, [x1, y1, z1] = f.max;
      const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) seg(v[a], v[b]);
    } else if (f.t === "cil") {
      for (const lado of [-0.5, 0.5]) {
        circulo((ang) => {
          const P = [];
          ubicar(f.c, f.eje, lado * f.largo, Math.cos(ang) * f.r, Math.sin(ang) * f.r, P);
          return P;
        });
      }
    } else {
      for (const lado of [-0.5, 0.5]) {
        for (const r of [f.r, f.r * 0.6]) circulo((ang) => [f.c[0] + Math.cos(ang) * r, f.c[1] + Math.sin(ang) * r, f.c[2] + lado * f.ancho]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(L, 3));
  return g;
}

function nubeDe(pieza) {
  const P = [];
  for (const f of pieza.formas) {
    if (f.t === "caja") muestrearCaja(f, P);
    else if (f.t === "cil") muestrearCilindro(f, P);
    else muestrearLlanta(f, P);
  }
  return P;
}

// ——— Panel de la pieza (fuera del canvas) ———
const panel = {
  select: document.getElementById("sel-pieza"),
  detalle: document.getElementById("pieza-detalle"),
  nombre: document.getElementById("pieza-nombre"),
  zona: document.getElementById("pieza-zona"),
  partes: document.getElementById("pieza-partes"),
  historial: document.getElementById("pieza-historial"),
  id: document.getElementById("pieza-id"),
  parte: document.getElementById("pieza-parte"),
  trabajo: document.getElementById("pieza-trabajo"),
  repuestos: document.getElementById("pieza-repuestos"),
  repuesto: document.getElementById("pieza-repuesto"),
};
// Opciones originales del selector de repuestos, para reordenarlas según la pieza.
const opcionesRepuesto = panel.repuesto ? [...panel.repuesto.options].map((o) => ({ value: o.value, text: o.textContent })) : [];
const porId = new Map(datos.piezas.map((p) => [p.id, p]));
/** Partes controladas de la pieza, de la más gastada a la menos (la primera manda el color). */
const partesDe = (id) => datos.partesPieza[id] ?? [];
const estadoDe = (id) => partesDe(id)[0]?.estado;
/** ¿La pieza lleva la parte elegida en la lista de la izquierda? */
const llevaParteElegida = (id) => datos.parteSeleccionada !== null && partesDe(id).some((x) => x.id === datos.parteSeleccionada);
/** Piezas de un repuesto pedido con «VER EN 3D» (?repuesto=): se resaltan todas. */
const resaltadas = new Set(datos.resaltar?.piezas ?? []);
const enFoco = (id) => (resaltadas.size ? resaltadas.has(id) : llevaParteElegida(id));

function el(tag, props, ...hijos) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  for (const h of hijos) if (h !== null && h !== undefined) e.append(h);
  return e;
}

function mostrarPanel(id) {
  if (!panel.detalle) return;
  const p = id && porId.get(id);
  if (panel.select) panel.select.value = p ? id : "";
  panel.detalle.hidden = !p;
  if (!p) return;
  panel.nombre.textContent = p.nombre;
  const partes = partesDe(id);
  const peor = partes[0];
  panel.zona.textContent = `${datos.nombresZona[p.zona] ?? p.zona}${peor ? ` · desgaste ${peor.pct}% · ${ESTADO_TXT[peor.estado]}` : " · sin partes con desgaste controlado"}`;

  panel.partes.replaceChildren(...partes.map((x) => el("a", { className: "fila-parte", href: x.url },
    el("span", { style: "font-size:12px", textContent: x.nombre }), el("b", { className: `t-${x.estado} mono-t`, textContent: `${x.pct}%` }))));

  const hist = datos.historial[id] ?? [];
  panel.historial.replaceChildren(...(hist.length ? hist.map((h) => el("div", { className: "hist-pieza" },
    el("div", { className: "linea", style: "justify-content:space-between" },
      el("b", { textContent: h.fecha }), el("span", { className: "chip neutro", textContent: h.tipo })),
    el("span", { textContent: h.trabajo }),
    el("span", { className: "muted", style: "font-size:11px", textContent: [h.km ? `${h.km} km` : null, h.costo, h.taller].filter(Boolean).join(" · ") }),
  )) : [el("span", { className: "muted", style: "font-size:12px", textContent: "Todavía no hay nada registrado en esta pieza." })]));

  if (panel.id) panel.id.value = id;
  if (panel.parte) {
    panel.parte.replaceChildren(el("option", { value: "", textContent: "— no reinicia ningún contador —" }),
      ...partes.map((x) => el("option", { value: String(x.id), textContent: `${x.nombre} · ${x.pct}% (vuelve a 0)` })));
  }
  const reps = datos.repuestosPieza[id] ?? [];
  if (panel.repuestos) {
    panel.repuestos.replaceChildren(...(reps.length ? [
      el("span", { className: "lbl", textContent: "REPUESTOS PARA ESTA PIEZA" }),
      ...reps.map((r) => el("a", { className: "fila-parte", href: `/inventario?q=${encodeURIComponent(r.codigo)}` },
        el("span", { style: "font-size:12px", textContent: `${r.codigo} · ${r.nombre}` }),
        el("b", { className: `mono-t ${r.stock > 0 ? "t-ok" : "t-cambiar"}`, textContent: r.stock > 0 ? `stock ${r.stock}` : "agotado" }))),
    ] : []));
  }
  if (panel.repuesto && opcionesRepuesto.length) {
    // Los que sirven para esta pieza van primero, marcados con ★.
    const sirven = new Set(reps.map((r) => String(r.id)));
    const orden = [...opcionesRepuesto].sort((a, b) => Number(!a.value) - Number(!b.value) || Number(sirven.has(b.value)) - Number(sirven.has(a.value)));
    panel.repuesto.replaceChildren(...orden.map((o) => el("option", { value: o.value, textContent: sirven.has(o.value) ? `★ ${o.text}` : o.text })));
    const primero = orden.find((o) => sirven.has(o.value));
    panel.repuesto.value = primero ? primero.value : "";
  }
  if (panel.trabajo && !panel.trabajo.value) panel.trabajo.placeholder = p.grupo === "llantas" ? "Cambio de llanta, rotación, parchado…" : "Qué pasó o qué se hizo";
}

function recordarEnUrl(id) {
  try {
    const u = new URL(location.href);
    if (id) u.searchParams.set("pieza", id); else u.searchParams.delete("pieza");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  } catch {}
}

function iniciar() {
  window.__visor3d = true;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor("#121719");
  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camara.position.set(-7, 7.5, 22);
  const controles = new OrbitControls(camara, canvas);
  controles.target.set(0, 1.9, 0);
  controles.enableDamping = true;
  controles.minDistance = 3;
  controles.maxDistance = 55;
  controles.maxPolarAngle = Math.PI * 0.6;
  controles.autoRotateSpeed = 1.6;

  // Retícula de puntos en el piso.
  const piso = [];
  for (let x = -14; x <= 14; x += 1) for (let z = -7; z <= 7; z += 1) piso.push(x, 0, z);
  const gPiso = new THREE.BufferGeometry();
  gPiso.setAttribute("position", new THREE.Float32BufferAttribute(piso, 3));
  escena.add(new THREE.Points(gPiso, new THREE.PointsMaterial({ color: "#3A474C", size: 0.05 })));

  // Una nube por pieza: se puede resaltar cada una por separado.
  const objetos = [];
  for (const p of datos.piezas) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(nubeDe(p), 3));
    g.computeBoundingBox();
    const m = new THREE.PointsMaterial({ size: 0.1, transparent: true, sizeAttenuation: true, depthWrite: false });
    const o = new THREE.Points(g, m);
    const borde = new THREE.LineSegments(contornoDe(p), new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }));
    o.add(borde);
    const centro = g.boundingBox.getCenter(new THREE.Vector3());
    // Hacia dónde se aparta en el despiece: poco a lo largo, más hacia arriba y hacia los lados.
    const desplazo = new THREE.Vector3((centro.x - 0.5) * 0.1, (centro.y - 1.4) * 0.7, centro.z * 1.3);
    o.userData = { id: p.id, zona: p.zona, puntos: g.attributes.position.count, centro, desplazo };
    escena.add(o);
    objetos.push(o);
  }
  const caja = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(RESALTE));
  caja.visible = false;
  escena.add(caja);

  let seleccion = porId.has(datos.piezaSeleccionada) ? datos.piezaSeleccionada : null;
  // «Solo esta pieza» muestra únicamente la elegida; «Despiece» separa todas para verlas una a una.
  let aislar = false;
  let despiece = 0, despieceObjetivo = 0;
  const btnAislar = document.getElementById("btn-aislar");
  const btnDespiece = document.getElementById("btn-despiece");
  let encima = null;
  const pintar = () => {
    for (const o of objetos) {
      const { id } = o.userData;
      const estado = estadoDe(id);
      const m = o.material;
      const borde = o.children[0].material;
      if (id === seleccion || (!seleccion && resaltadas.has(id))) {
        m.color.set(RESALTE); m.size = 0.11; m.opacity = 1;
        borde.color.set(RESALTE); borde.opacity = 0.9;
      } else if (!seleccion && resaltadas.size) {
        m.color.set(estado ? COLOR[estado] : GRIS); m.size = id === encima ? 0.12 : 0.075; m.opacity = id === encima ? 0.8 : 0.16;
        borde.color.copy(m.color); borde.opacity = id === encima ? 0.6 : 0.08;
      } else {
        m.color.set(estado ? COLOR[estado] : GRIS);
        const enZona = !seleccion && enFoco(id);
        m.size = id === encima ? 0.12 : enZona ? 0.11 : estado ? 0.085 : 0.075;
        m.opacity = seleccion ? (id === encima ? 0.8 : 0.18) : id === encima ? 1 : estado ? 0.9 : 0.45;
        borde.color.copy(m.color);
        borde.opacity = seleccion ? (id === encima ? 0.6 : 0.1) : id === encima ? 0.9 : estado ? 0.45 : 0.28;
      }
    }
    const o = objetos.find((x) => x.userData.id === seleccion);
    caja.visible = !!o;
    if (o) caja.box.copy(o.geometry.boundingBox).translate(o.position).expandByScalar(0.08);
    for (const x of objetos) x.visible = !aislar || !seleccion || x.userData.id === seleccion;
    if (btnAislar) {
      btnAislar.disabled = !seleccion;
      btnAislar.classList.toggle("on", aislar && !!seleccion);
      btnAislar.setAttribute("aria-pressed", String(aislar && !!seleccion));
    }
  };

  // Al elegir una pieza la cámara la pone al centro (sin girar).
  const objetivo = controles.target.clone();
  let volando = false;
  let acercarA = null; // distancia a la que se acerca la cámara al elegir una pieza
  const enfocar = (id) => {
    const o = objetos.find((x) => x.userData.id === id);
    if (!o) return;
    objetivo.copy(o.userData.centro).add(o.position);
    acercarA = Math.max(4, Math.min(11, o.geometry.boundingBox.getSize(new THREE.Vector3()).length() * 1.6 + 3.5));
    volando = true;
  };
  const elegir = (id, { mover = true } = {}) => {
    seleccion = id && porId.has(id) ? id : null;
    pintar();
    mostrarPanel(seleccion);
    recordarEnUrl(seleccion);
    if (seleccion && mover) enfocar(seleccion);
  };
  if (panel.select) panel.select.addEventListener("change", () => elegir(panel.select.value || null));

  // Selección con el dedo o el mouse: entre las piezas tocadas se prefiere la más cercana y,
  // si hay varias casi a la misma distancia (retrovisor pegado a la cabina), la más pequeña.
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.16;
  const puntero = new THREE.Vector2();
  const piezaEn = (e) => {
    const r = canvas.getBoundingClientRect();
    puntero.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(puntero, camara);
    const hits = raycaster.intersectObjects(objetos.filter((o) => o.visible), false);
    if (!hits.length) return null;
    const cerca = hits.filter((h) => h.distance < hits[0].distance + 0.5);
    cerca.sort((a, b) => a.object.userData.puntos - b.object.userData.puntos);
    return cerca[0].object.userData.id;
  };
  let abajo = null;
  canvas.addEventListener("pointerdown", (e) => { abajo = [e.clientX, e.clientY]; volando = false; acercarA = null; });
  canvas.addEventListener("pointerup", (e) => {
    if (!abajo || Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) > 6) return; // fue un arrastre
    elegir(piezaEn(e), { mover: false });
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const id = piezaEn(e);
    if (id === encima) return;
    encima = id;
    canvas.style.cursor = id ? "pointer" : "";
    canvas.title = id ? porId.get(id).nombre : "";
    pintar();
  });

  // Controles.
  const girarBtn = document.getElementById("btn-girar");
  const angulo = document.getElementById("angulo");
  const rotar = (grados) => {
    const off = camara.position.clone().sub(controles.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), (grados * Math.PI) / 180);
    camara.position.copy(controles.target).add(off);
  };
  document.getElementById("btn-izq").addEventListener("click", () => rotar(-20));
  document.getElementById("btn-der").addEventListener("click", () => rotar(20));
  girarBtn.addEventListener("click", () => {
    controles.autoRotate = !controles.autoRotate;
    girarBtn.textContent = controles.autoRotate ? "DETENER" : "GIRAR";
    girarBtn.classList.toggle("on", controles.autoRotate);
    girarBtn.setAttribute("aria-pressed", String(controles.autoRotate));
  });
  const verTodo = document.getElementById("btn-todo");
  if (btnAislar) btnAislar.addEventListener("click", () => {
    if (!seleccion) return;
    aislar = !aislar;
    pintar();
    enfocar(seleccion);
  });
  if (btnDespiece) btnDespiece.addEventListener("click", () => {
    despieceObjetivo = despieceObjetivo ? 0 : 1;
    btnDespiece.classList.toggle("on", !!despieceObjetivo);
    btnDespiece.setAttribute("aria-pressed", String(!!despieceObjetivo));
  });
  if (verTodo) verTodo.addEventListener("click", () => {
    aislar = false;
    despieceObjetivo = 0;
    if (btnDespiece) { btnDespiece.classList.remove("on"); btnDespiece.setAttribute("aria-pressed", "false"); }
    if (resaltadas.size) {
      resaltadas.clear();
      centroZona = null;
      try { const u = new URL(location.href); u.searchParams.delete("repuesto"); history.replaceState(null, "", u.pathname + u.search); } catch {}
    }
    objetivo.set(0, 1.9, 0); acercarA = 24; volando = true; elegir(null, { mover: false });
  });

  const ajustar = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  };
  new ResizeObserver(ajustar).observe(canvas);
  ajustar();

  // Etiqueta flotante: la pieza elegida o, si no, la zona de la parte elegida en la lista.
  if (etiqueta && datos.resaltar) {
    etiqueta.replaceChildren(el("span", { className: "lbl", style: "color:var(--dark-muted)", textContent: "REPUESTO" }), el("br"),
      `${datos.resaltar.titulo} · va en ${resaltadas.size} ${resaltadas.size === 1 ? "pieza" : "piezas"}`);
  }
  const textoZona = etiqueta ? etiqueta.innerHTML : "";
  let centroZona = (() => {
    const b = new THREE.Box3();
    for (const o of objetos) if (enFoco(o.userData.id)) b.union(o.geometry.boundingBox);
    return b.isEmpty() ? null : b.getCenter(new THREE.Vector3());
  })();

  const v = new THREE.Vector3(), v2 = new THREE.Vector3();
  const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reducirMovimiento && datos.autogiro && !seleccion) girarBtn.click();
  pintar();
  if (seleccion) { mostrarPanel(seleccion); enfocar(seleccion); }
  else if (resaltadas.size && centroZona) { objetivo.copy(centroZona); volando = true; }

  let etiquetaDe = undefined;
  function cuadro() {
    if (despiece !== despieceObjetivo) {
      despiece += (despieceObjetivo - despiece) * (reducirMovimiento ? 1 : 0.12);
      if (Math.abs(despiece - despieceObjetivo) < 0.002) despiece = despieceObjetivo;
      for (const o of objetos) o.position.copy(o.userData.desplazo).multiplyScalar(despiece);
      pintar();
      const o = seleccion && objetos.find((x) => x.userData.id === seleccion);
      if (o) { objetivo.copy(o.userData.centro).add(o.position); volando = true; }
    }
    if (volando) {
      const antes = controles.target.clone();
      controles.target.lerp(objetivo, reducirMovimiento ? 1 : 0.12);
      camara.position.add(controles.target.clone().sub(antes));
      if (acercarA !== null) {
        const off = camara.position.clone().sub(controles.target);
        const d = off.length();
        const nueva = reducirMovimiento ? acercarA : d + (acercarA - d) * 0.1;
        camara.position.copy(controles.target).add(off.setLength(nueva));
        if (Math.abs(nueva - acercarA) < 0.02) acercarA = null;
      }
      if (controles.target.distanceTo(objetivo) < 0.01 && acercarA === null) volando = false;
    }
    controles.update();
    const oSel = seleccion && objetos.find((o) => o.userData.id === seleccion);
    const anclaSel = oSel ? v2.copy(oSel.userData.centro).add(oSel.position) : centroZona;
    if (etiqueta) {
      if (etiquetaDe !== seleccion) {
        etiquetaDe = seleccion;
        if (seleccion) {
          etiqueta.replaceChildren(el("span", { className: "lbl", style: "color:var(--dark-muted)", textContent: "PIEZA SELECCIONADA" }), el("br"), porId.get(seleccion).nombre);
        } else etiqueta.innerHTML = textoZona;
      }
      if (anclaSel) {
        v.copy(anclaSel).project(camara);
        const x = (v.x * 0.5 + 0.5) * canvas.clientWidth, y = (-v.y * 0.5 + 0.5) * canvas.clientHeight;
        const fuera = v.z > 1 || x < 0 || y < 0 || x > canvas.clientWidth || y > canvas.clientHeight;
        etiqueta.hidden = fuera;
        const izq = x > canvas.clientWidth - 280;
        etiqueta.style.left = `${izq ? x - 280 : x}px`;
        etiqueta.style.top = `${y}px`;
      } else etiqueta.hidden = true;
    }
    if (angulo) {
      const off = camara.position.clone().sub(controles.target);
      angulo.textContent = String(Math.round(((Math.atan2(off.x, off.z) * 180) / Math.PI + 360) % 360));
    }
    renderer.render(escena, camara);
    requestAnimationFrame(cuadro);
  }
  cuadro();
}

if (!soportaWebGL()) {
  cont.querySelector(".sin-webgl").hidden = false;
  // Sin 3D la lista de piezas sigue sirviendo para ver y registrar.
  if (panel.select) panel.select.addEventListener("change", () => { mostrarPanel(panel.select.value || null); recordarEnUrl(panel.select.value || null); });
  mostrarPanel(porId.has(datos.piezaSeleccionada) ? datos.piezaSeleccionada : null);
} else {
  iniciar();
}
