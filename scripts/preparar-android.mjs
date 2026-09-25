// Deja listo lo que el APK lleva dentro y no está en el repo:
//   android/app/movil/libnode   Node.js para Android (de nodejs-mobile, ~60 MB por procesador)
//   android/app/movil/assets/app  la app empaquetada (scripts/empaquetar-movil.mjs)
//
//   node scripts/preparar-android.mjs
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const raiz = resolve(import.meta.dirname, "..");
const movil = join(raiz, "android/app/movil");
const VERSION_NODE = "18.20.4";
const libnode = join(movil, "libnode");

if (!existsSync(join(libnode, "include/node/node.h"))) {
  const tmp = mkdtempSync(join(tmpdir(), "libnode-"));
  console.log(`Descargando Node.js ${VERSION_NODE} para Android (nodejs-mobile)…`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npm, ["pack", `nodejs-mobile-react-native@${VERSION_NODE}`, "--silent"], { cwd: tmp, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
  execFileSync("tar", ["-xzf", `nodejs-mobile-react-native-${VERSION_NODE}.tgz`, "package/android/libnode"], { cwd: tmp, stdio: "inherit" });
  rmSync(libnode, { recursive: true, force: true });
  mkdirSync(movil, { recursive: true });
  cpSync(join(tmp, "package/android/libnode"), libnode, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
}
execFileSync(process.execPath, [join(raiz, "scripts/empaquetar-movil.mjs"), join(movil, "assets/app")], { stdio: "inherit" });
console.log("Listo: ya se puede compilar el APK en android/ (gradle assembleRelease).");
