// Visor 3D del trailer: nube de puntos (THREE.Points) coloreada por el desgaste de cada zona.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const datos = JSON.parse(document.getElementById("datos-visor").textContent);
const cont = document.getElementById("visor");
const canvas = cont.querySelector("canvas");
const etiqueta = cont.querySelector(".etiqueta");

const COLOR = { ok: "#8FB4CC", proximo: "#F2C14E", cambiar: "#FF5AAE" };
const GRIS = "#E9E3D6";

function soportaWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}


/** Misma nube que el diseño: cajas y ruedas muestreadas en sus caras, con semilla fija. */
function nube() {
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const P = [];
  const caja = (z, x0, x1, y0, y1, z0, z1, n) => {
    for (let i = 0; i < n; i++) {
      const f = Math.floor(rnd() * 6);
      let x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0), w = z0 + rnd() * (z1 - z0);
      if (f === 0) x = x0; else if (f === 1) x = x1; else if (f === 2) y = y0; else if (f === 3) y = y1; else if (f === 4) w = z0; else w = z1;
      P.push([x, y, w, z]);
    }
  };
  const rueda = (z, x, w, n) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = 0.52 * (0.7 + 0.3 * rnd());
      P.push([x + Math.cos(a) * r, 0.52 + Math.sin(a) * r, w + (rnd() - 0.5) * 0.3, z]);
    }
  };
  const k = 2; // más densidad que el boceto: se ve mejor en pantallas grandes
  caja("cabina", -9, -6.6, 1.0, 3.7, -1.25, 1.25, 160 * k);
  caja("motor", -9.4, -8.0, 0.9, 2.0, -1.1, 1.1, 70 * k);
  caja("chasis", -9, -3, 0.75, 1.0, -0.55, 0.55, 60 * k);
  caja("chasis", -3, 9, 1.0, 1.25, -0.55, 0.55, 70 * k);
  caja("caja", -4, 9, 1.35, 4.0, -1.3, 1.3, 320 * k);
  caja("tanque", -6.2, -5.0, 0.85, 1.35, 1.1, 1.35, 36 * k);
  caja("bateria", -5.0, -4.4, 0.85, 1.25, -1.35, -1.05, 26 * k);
  caja("quinta", -4.2, -3.2, 1.12, 1.22, -0.6, 0.6, 26 * k);
  [[-8, "llantas_del"], [-4.6, "llantas_trac"], [-3.4, "llantas_trac"], [5.8, "llantas_sr"], [7.0, "llantas_sr"], [8.2, "llantas_sr"]]
    .forEach(([x, z]) => { rueda(z, x, -1.05, 22 * k); rueda(z, x, 1.05, 22 * k); });
  return P;
}

const ANCLAS = {
  llantas_sr: [7, 0.5, 1.2], llantas_trac: [-4, 0.5, 1.2], llantas_del: [-8, 0.5, 1.2], motor: [-8.7, 1.5, 0],
  bateria: [-4.7, 1.05, -1.25], quinta: [-3.7, 1.2, 0], chasis: [2, 1.1, 0.6], cabina: [-7.8, 3.2, 0], caja: [2.5, 3.2, 0], tanque: [-5.6, 1.1, 1.3],
};

function iniciar() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor("#121719");
  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camara.position.set(-7, 7.5, 22);
  const controles = new OrbitControls(camara, canvas);
  controles.target.set(0, 1.9, 0);
  controles.enableDamping = true;
  controles.minDistance = 8;
  controles.maxDistance = 55;
  controles.maxPolarAngle = Math.PI * 0.49;
  controles.autoRotateSpeed = 1.6;

  // Retícula de puntos en el piso.
  const piso = [];
  for (let x = -14; x <= 14; x += 1) for (let z = -7; z <= 7; z += 1) piso.push(x, 0, z);
  const gPiso = new THREE.BufferGeometry();
  gPiso.setAttribute("position", new THREE.Float32BufferAttribute(piso, 3));
  escena.add(new THREE.Points(gPiso, new THREE.PointsMaterial({ color: "#3A474C", size: 0.06 })));

  // Una nube por zona, para poder cambiar tamaño/opacidad de la seleccionada.
  const porZona = new Map();
  for (const [x, y, z, zona] of nube()) {
    if (!porZona.has(zona)) porZona.set(zona, []);
    porZona.get(zona).push(x, y, z);
  }
  const objetos = [];
  for (const [zona, pos] of porZona) {
    const estado = datos.zonas[zona]?.estado;
    const sel = zona === datos.zonaSeleccionada;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: estado ? COLOR[estado] : GRIS, size: sel ? 0.26 : estado ? 0.17 : 0.12, transparent: true,
      opacity: estado ? 1 : 0.4, sizeAttenuation: true, depthWrite: false,
    });
    const p = new THREE.Points(g, m);
    p.userData.zona = zona;
    escena.add(p);
    objetos.push(p);
  }

  // Anillos en cada zona controlada; el seleccionado, ámbar.
  const anillos = [];
  for (const zona of Object.keys(datos.zonas)) {
    const a = ANCLAS[zona];
    if (!a) continue;
    const sel = zona === datos.zonaSeleccionada;
    const geo = new THREE.RingGeometry(sel ? 0.55 : 0.38, sel ? 0.62 : 0.43, 40);
    const mat = new THREE.MeshBasicMaterial({ color: sel ? "#F2C14E" : COLOR[datos.zonas[zona].estado], side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false });
    const anillo = new THREE.Mesh(geo, mat);
    anillo.position.set(a[0], a[1], a[2]);
    anillo.renderOrder = 10;
    anillo.userData.zona = zona;
    escena.add(anillo);
    anillos.push(anillo);
  }

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.25;
  const puntero = new THREE.Vector2();
  let abajo = null;
  canvas.addEventListener("pointerdown", (e) => { abajo = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", (e) => {
    if (!abajo || Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) > 5) return; // fue un arrastre
    const r = canvas.getBoundingClientRect();
    puntero.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(puntero, camara);
    const hits = raycaster.intersectObjects([...anillos, ...objetos.filter((o) => datos.zonas[o.userData.zona])]);
    const zona = hits[0]?.object.userData.zona;
    const destino = zona && datos.zonas[zona]?.url;
    if (destino) window.location.href = destino;
  });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    puntero.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(puntero, camara);
    const hit = raycaster.intersectObjects([...anillos, ...objetos.filter((o) => datos.zonas[o.userData.zona])])[0];
    canvas.style.cursor = hit ? "pointer" : "";
    canvas.title = hit ? `${datos.zonas[hit.object.userData.zona].nombre} · ${datos.zonas[hit.object.userData.zona].pct}%` : "";
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

  const ajustar = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  };
  new ResizeObserver(ajustar).observe(canvas);
  ajustar();

  const ancla = datos.zonaSeleccionada && ANCLAS[datos.zonaSeleccionada];
  const v = new THREE.Vector3();
  const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reducirMovimiento && datos.autogiro) girarBtn.click();

  function cuadro() {
    controles.update();
    for (const a of anillos) a.quaternion.copy(camara.quaternion);
    if (ancla && etiqueta) {
      v.set(ancla[0], ancla[1], ancla[2]).project(camara);
      const x = (v.x * 0.5 + 0.5) * canvas.clientWidth, y = (-v.y * 0.5 + 0.5) * canvas.clientHeight;
      const fuera = v.z > 1 || x < 0 || y < 0 || x > canvas.clientWidth || y > canvas.clientHeight;
      etiqueta.hidden = fuera;
      const izq = x > canvas.clientWidth - 220;
      etiqueta.style.left = `${izq ? x - 220 : x}px`;
      etiqueta.style.top = `${y}px`;
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
} else {
  iniciar();
}
