import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const URL_CSV = "https://raw.githubusercontent.com/jmcastagnetto/ubigeo-peru-aumentado/main/ubigeo_distrito.csv";

function parsearLinea(linea: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (const ch of linea) {
    if (ch === '"') entreComillas = !entreComillas;
    else if (ch === "," && !entreComillas) {
      campos.push(actual);
      actual = "";
    } else actual += ch;
  }
  campos.push(actual);
  return campos;
}

const respuesta = await fetch(URL_CSV);
if (!respuesta.ok) throw new Error(`No se pudo descargar ubigeos: HTTP ${respuesta.status}`);
const lineas = (await respuesta.text()).split(/\r?\n/).filter((l) => l.trim() !== "");
// Columnas: inei, reniec, departamento, provincia, distrito, ...
const ubigeos = lineas
  .slice(1)
  .map(parsearLinea)
  .map(([codigo, , departamento, provincia, distrito]) => [codigo ?? "", departamento ?? "", provincia ?? "", distrito ?? ""])
  .filter((f) => /^\d{6}$/.test(f[0]!))
  .sort((a, b) => a[0]!.localeCompare(b[0]!));

if (ubigeos.length < 1800) throw new Error(`Catálogo incompleto: ${ubigeos.length} distritos`);

const destino = fileURLToPath(new URL("../src/dominio/ubigeos.json", import.meta.url));
writeFileSync(destino, JSON.stringify(ubigeos));
console.log(`Guardados ${ubigeos.length} ubigeos en ${destino}`);
