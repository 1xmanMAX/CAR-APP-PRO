// Empaqueta la app (web + núcleo + sincronización) en una carpeta que corre con Node 18 sin
// instalar nada: es lo que va dentro del APK de Android (y sirve también en cualquier PC).
//
//   node scripts/empaquetar-movil.mjs [carpeta-de-salida]
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const raiz = resolve(import.meta.dirname, "..");
const salida = resolve(process.argv[2] || join(raiz, "dist-movil", "app"));
rmSync(salida, { recursive: true, force: true });
mkdirSync(salida, { recursive: true });

const desdeWeb = createRequire(join(raiz, "apps/web/package.json"));
const desdeDb = createRequire(join(raiz, "packages/db/package.json"));
const desdeSunat = createRequire(join(raiz, "packages/sunat/package.json"));
const desdePdf = createRequire(join(raiz, "packages/pdf/package.json"));
const paquete = (req, nombre) => {
  // La carpeta del paquete: sube desde su archivo principal hasta encontrar su package.json.
  let d = dirname(req.resolve(nombre));
  while (!existsSync(join(d, "package.json")) || JSON.parse(readFileSync(join(d, "package.json"), "utf8")).name !== nombre) d = dirname(d);
  return d;
};

await build({
  entryPoints: [join(raiz, "apps/bot/src/movil.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: join(salida, "servidor.mjs"),
  // Paquetes con archivos propios (wasm, datos): van aparte, tal cual, en node_modules.
  external: ["@electric-sql/pglite", "@electric-sql/pglite/*", "xmllint-wasm"],
  jsx: "automatic",
  jsxImportSource: "hono/jsx",
  // La mitad de tamaño: el celular lee y compila menos al abrir la app. Los nombres de clases y
  // funciones se conservan (hay código que los usa en mensajes y comprobaciones).
  minify: true,
  keepNames: true,
  logLevel: "error",
  banner: {
    js: [
      "import { createRequire as __crearRequire } from 'node:module';",
      "import { fileURLToPath as __aRuta } from 'node:url';",
      "import { dirname as __carpeta } from 'node:path';",
      "const require = __crearRequire(import.meta.url);",
      "const __filename = __aRuta(import.meta.url);",
      "const __dirname = __carpeta(__filename);",
    ].join("\n"),
  },
});

// Lo que el código busca en disco.
const copiar = (de, a) => cpSync(de, join(salida, a), { recursive: true });
copiar(join(raiz, "packages/db/drizzle"), "drizzle");
copiar(join(raiz, "packages/sunat/xsd/2.1"), "xsd");
copiar(join(raiz, "apps/web/public"), "public");
const three = paquete(desdeWeb, "three");
for (const f of ["build/three.module.js", "build/three.core.js", "examples/jsm/controls/OrbitControls.js"]) {
  mkdirSync(dirname(join(salida, "three", f)), { recursive: true });
  cpSync(join(three, f), join(salida, "three", f));
}
// pdfkit lee sus fuentes (AFM) de «__dirname/data» y carga las 14 estándar con
// require("#standard-fonts/…"), que Node resuelve con el package.json más cercano al paquete.
const pdfkit = paquete(desdePdf, "pdfkit");
copiar(join(pdfkit, "js/data"), "data");
copiar(join(pdfkit, "js/standard-fonts"), "standard-fonts");
writeFileSync(join(salida, "package.json"), JSON.stringify({
  name: "controlflota-movil", private: true, imports: { "#standard-fonts/*": "./standard-fonts/*.cjs" },
}, null, 2));
for (const [req, nombre] of [[desdeDb, "@electric-sql/pglite"], [desdeSunat, "xmllint-wasm"]]) {
  const d = paquete(req, nombre);
  const destino = join(salida, "node_modules", nombre);
  mkdirSync(destino, { recursive: true });
  // Sin mapas, tipos ni extensiones de Postgres que la app no usa: el APK pesa menos.
  const sobra = (r) => /\.(map|d\.ts|d\.cts|d\.mts|tar\.gz|md)$/.test(r) || /(^|\/)(node_modules|src)$/.test(r);
  cpSync(d, destino, { recursive: true, filter: (r) => !sobra(r.slice(d.length)) });
}
// Base de datos ya creada y migrada: crearla desde cero (initdb de PGlite) es lo que más demora el
// primer arranque en el celular; copiarla de aquí es varias veces más rápido.
{
  const { PGlite } = await import(pathToFileURL(desdeDb.resolve("@electric-sql/pglite")).href);
  const { drizzle } = await import(pathToFileURL(desdeDb.resolve("drizzle-orm/pglite")).href);
  const { migrate } = await import(pathToFileURL(desdeDb.resolve("drizzle-orm/pglite/migrator")).href);
  const pg = await PGlite.create();
  await migrate(drizzle({ client: pg }), { migrationsFolder: join(raiz, "packages/db/drizzle") });
  const volcado = await pg.dumpDataDir("gzip");
  writeFileSync(join(salida, "base-inicial.tgz"), Buffer.from(await volcado.arrayBuffer()));
  await pg.close();
}
// Dónde está cada cosa, para el arranque.
writeFileSync(join(salida, "iniciar.mjs"), `// Arranca la app empaquetada: node iniciar.mjs
import { writeFileSync } from "node:fs";
import module from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const aqui = dirname(fileURLToPath(import.meta.url));
// Node guarda el código ya compilado: desde la segunda vez la app abre más rápido.
try { module.enableCompileCache?.(join(process.env.TMPDIR || aqui, "cache-node")); } catch {}
process.env.CF_BASE_INICIAL ||= join(aqui, "base-inicial.tgz");
process.env.CF_MIGRACIONES ||= join(aqui, "drizzle");
process.env.CF_XSD ||= join(aqui, "xsd");
process.env.CF_PUBLICO ||= join(aqui, "public");
process.env.CF_THREE ||= join(aqui, "three");
// Si algo falla al arrancar, queda escrito (la app de Android lo muestra) y hay tiempo de verlo.
// Ya en marcha, un error suelto se anota y la app sigue: mejor que cerrarse en la cara del usuario.
const fallar = (e) => {
  const texto = (e && e.stack) || String(e);
  if (globalThis.__controlFlotaListo) {
    console.error("CONTROLFLOTA_AVISO", texto);
    return;
  }
  console.error("CONTROLFLOTA_ERROR", texto);
  try { writeFileSync(join(process.env.CF_DATOS || ".", "error-al-arrancar.txt"), texto); } catch {}
  setTimeout(() => process.exit(1), 1500);
};
process.on("uncaughtException", fallar);
process.on("unhandledRejection", fallar);
try {
  await import("./servidor.mjs");
} catch (e) {
  fallar(e);
}
`);
const version = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).version;
writeFileSync(join(salida, "version.txt"), version);
console.log(`Paquete listo en ${salida} (v${version})`);
