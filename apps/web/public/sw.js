// Service worker de Control Flota: hace la web instalable y la deja abrir sin conexión.
// Las páginas siempre se piden a la red (los datos deben estar al día); si no hay red se muestra
// la última versión guardada de esa página o el aviso "sin conexión". Los archivos estáticos
// (CSS, JS, íconos, Three.js, fuentes) se sirven del caché y se renuevan en segundo plano.
const VERSION = "flota-v2";
const PRECARGA = ["/sin-conexion", "/static/iconos/icono-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECARGA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const esEstatico = (url) =>
  url.pathname.startsWith("/static/") || url.pathname.startsWith("/vendor/") ||
  url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (esEstatico(url)) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const guardado = await c.match(req);
        const red = fetch(req).then((r) => {
          if (r.ok || r.type === "opaque") c.put(req, r.clone());
          return r;
        }).catch(() => guardado);
        return guardado || red;
      }),
    );
    return;
  }

  // Solo páginas del mismo sitio; la API, las descargas y la sesión no se guardan.
  if (req.mode !== "navigate" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/entrar") || url.pathname.startsWith("/salir") || url.pathname.startsWith("/configurar")) return;
  e.respondWith(
    fetch(req).then((r) => {
      if (r.ok && (r.headers.get("content-type") || "").includes("text/html")) {
        const copia = r.clone();
        caches.open(VERSION).then((c) => c.put(url.pathname, copia));
      }
      return r;
    }).catch(async () => (await caches.match(url.pathname)) || (await caches.match("/sin-conexion"))),
  );
});
