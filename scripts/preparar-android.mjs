// Deja listo lo que el APK lleva dentro y no está en el repo:
//   android/app/movil/jniLibs/<abi>/  Node.js para Android (de Termux: Node LTS con ICU completo,
//                                     el mismo motor de fechas, monedas y textos que en la PC)
//   android/app/movil/assets/app/     la app empaquetada (scripts/empaquetar-movil.mjs)
//
//   node scripts/preparar-android.mjs [abis]     (por omisión arm64-v8a,armeabi-v7a)
//
// Necesita `ar`, `tar` (con xz) y `readelf` (binutils): Linux, macOS con binutils o WSL.
//
// Android solo instala del APK las librerías llamadas `lib*.so`. Las de Termux traen versión en el
// nombre (libssl.so.3, libicuuc.so.78…): se renombran a un nombre del MISMO largo (libssl_3.so,
// libicuuc_78.so) y se cambia ese texto dentro de cada binario, así no hace falta reescribir el ELF.
// El ejecutable de Node va como `libnode.so` y la app lo lanza desde su carpeta de librerías.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const raiz = resolve(import.meta.dirname, "..");
const movil = join(raiz, "android/app/movil");
const REPO = "https://packages.termux.dev/apt/termux-main";
const ARQ = { "arm64-v8a": "aarch64", "armeabi-v7a": "arm", x86_64: "x86_64" };
const PAQUETES = ["nodejs-lts", "libc++", "openssl", "c-ares", "libicu", "libsqlite", "zlib"];
const abis = (process.argv[2] || "arm64-v8a,armeabi-v7a").split(",").map((a) => a.trim());

async function bajar(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Paquete → { version, archivo } del índice de Termux para una arquitectura. */
async function indice(arq) {
  const texto = (await bajar(`${REPO}/dists/stable/main/binary-${arq}/Packages`)).toString("utf8");
  const out = new Map();
  for (const bloque of texto.split(/\n\n+/)) {
    const campo = (k) => bloque.match(new RegExp(`^${k}: (.+)$`, "m"))?.[1];
    const nombre = campo("Package");
    if (nombre) out.set(nombre, { version: campo("Version"), archivo: campo("Filename") });
  }
  return out;
}

/** «libssl.so.3» → «libssl_3.so» (mismo largo); los que ya terminan en .so no cambian. */
const nombreAndroid = (n) => n.replace(/^(lib.+)\.so\.([\d.]+)$/, (_, base, v) => `${base}_${v.replace(/\./g, "_")}.so`);

function soname(archivo) {
  const salida = execFileSync("readelf", ["-d", archivo], { encoding: "utf8" });
  return salida.match(/\(SONAME\)\s+Library soname: \[(.+)\]/)?.[1] ?? null;
}

function necesita(archivo) {
  const salida = execFileSync("readelf", ["-d", archivo], { encoding: "utf8" });
  return [...salida.matchAll(/\(NEEDED\)\s+Shared library: \[(.+)\]/g)].map((m) => m[1]);
}

/** Cambia textos terminados en \0 por otros del mismo largo dentro de un binario. */
function parchear(buf, cambios) {
  for (const [de, a] of cambios) {
    if (de === a) continue;
    if (de.length !== a.length) throw new Error(`${de} → ${a}: distinto largo`);
    const buscar = Buffer.from(`\0${de}\0`);
    const poner = Buffer.from(`\0${a}\0`);
    let i = buf.indexOf(buscar);
    while (i !== -1) {
      poner.copy(buf, i);
      i = buf.indexOf(buscar, i + 1);
    }
  }
  return buf;
}

for (const abi of abis) {
  const arq = ARQ[abi];
  if (!arq) throw new Error(`Procesador desconocido: ${abi}`);
  const destino = join(movil, "jniLibs", abi);
  const idx = await indice(arq);
  const marca = PAQUETES.map((p) => `${p}=${idx.get(p)?.version}`).join(" ");
  if (existsSync(join(destino, "libnode.so")) && existsSync(join(destino, ".versiones")) && readFileSync(join(destino, ".versiones"), "utf8") === marca) {
    console.log(`${abi}: ya está (${idx.get("nodejs-lts")?.version})`);
    continue;
  }
  console.log(`${abi}: bajando Node ${idx.get("nodejs-lts")?.version} de Termux…`);
  const tmp = mkdtempSync(join(tmpdir(), `termux-${arq}-`));
  for (const p of PAQUETES) {
    const info = idx.get(p);
    if (!info) throw new Error(`Termux no tiene ${p} para ${arq}`);
    const deb = join(tmp, `${p}.deb`);
    writeFileSync(deb, await bajar(`${REPO}/${info.archivo}`));
    const miembros = execFileSync("ar", ["t", deb], { encoding: "utf8" }).split("\n");
    const datos = miembros.find((m) => m.startsWith("data.tar"));
    execFileSync("sh", ["-c", `ar p "${deb}" ${datos} | tar -x${datos.endsWith(".xz") ? "J" : datos.endsWith(".gz") ? "z" : ""} -C "${tmp}"`]);
  }
  const usr = join(tmp, "data/data/com.termux/files/usr");
  // Solo las librerías que Node necesita de verdad (siguiendo NEEDED desde el ejecutable).
  const libDir = join(usr, "lib");
  const porSoname = new Map();
  for (const f of readdirSync(libDir)) {
    const ruta = join(libDir, f);
    if (!statSync(ruta).isFile() || !/\.so(\.|$)/.test(f)) continue;
    porSoname.set(soname(ruta) ?? f, ruta);
  }
  const elegidas = new Map();
  const pendientes = necesita(join(usr, "bin/node"));
  while (pendientes.length) {
    const n = pendientes.pop();
    if (elegidas.has(n)) continue;
    const ruta = porSoname.get(n);
    if (!ruta) continue; // del sistema (libc, libm, libdl, liblog…)
    elegidas.set(n, ruta);
    pendientes.push(...necesita(ruta));
  }
  const cambios = [...elegidas.keys()].map((n) => [n, nombreAndroid(n)]);
  rmSync(destino, { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });
  writeFileSync(join(destino, "libnode.so"), parchear(readFileSync(join(usr, "bin/node")), cambios));
  for (const [n, ruta] of elegidas) writeFileSync(join(destino, nombreAndroid(n)), parchear(readFileSync(ruta), cambios));
  writeFileSync(join(destino, ".versiones"), marca);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${abi}: ${readdirSync(destino).filter((f) => f.endsWith(".so")).join(", ")}`);
}

// Certificados raíz para HTTPS (Telegram, SUNAT): los de Node, por si OpenSSL busca los de Termux.
const tls = await import("node:tls");
const assets = join(movil, "assets");
execFileSync(process.execPath, [join(raiz, "scripts/empaquetar-movil.mjs"), join(assets, "app")], { stdio: "inherit" });
writeFileSync(join(assets, "app", "certificados.pem"), tls.rootCertificates.join("\n") + "\n");
// Configuración de OpenSSL vacía: sin ella buscaría la de Termux, que no existe en la app.
writeFileSync(join(assets, "app", "openssl.cnf"), "# Control Flota: sin ajustes propios de OpenSSL\n");
// Quitar lo de la versión anterior (Node como librería con puente JNI).
rmSync(join(movil, "libnode"), { recursive: true, force: true });
console.log("Listo: ya se puede compilar el APK en android/ (gradle assembleRelease).");
