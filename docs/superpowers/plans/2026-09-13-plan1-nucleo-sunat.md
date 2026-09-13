# Plan 1 — Núcleo: dominio, base de datos, SUNAT, PDF y casos de uso

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el núcleo sin interfaz: emitir GRE Transportista y factura (SUNAT simulado, beta o real), guardar XML/CDR/PDF y registrar cobros, todo cubierto por tests.

**Architecture:** Monorepo pnpm en TypeScript sin paso de build (cada paquete exporta `src/index.ts`). `@sunatapp/sunat` y `@sunatapp/pdf` son puros (no conocen la BD). `@sunatapp/db` define el esquema Drizzle sobre PGlite (local/tests) o PostgreSQL. `@sunatapp/core` orquesta todo mediante un `Contexto` inyectable. El bot (Plan 2) y la web (Plan 3) solo consumen `@sunatapp/core`.

**Tech Stack:** Node 24, pnpm 9, TypeScript, Vitest, Drizzle ORM + drizzle-kit, @electric-sql/pglite, pg, node-forge, @xmldom/xmldom, xml-crypto (solo c14n), xmllint-wasm, yazl/yauzl, fast-xml-parser, pdfkit, qrcode, unpdf (tests), zod, tsx.

**Spec:** `docs/superpowers/specs/2026-09-13-mvp-gre-transportista-design.md`

**Planes siguientes (se escriben al terminar este):** Plan 2 — extractor + bot Telegram (incluye servidor `pglite-socket`). Plan 3 — web Next.js.

## Global Constraints

- Node `>=24`, pnpm `9.12.3`, ESM (`"type": "module"`) en todos los paquetes.
- Dinero siempre en **céntimos enteros** (`number` entero en TS; `bigint` mode number en BD).
- Fechas de documentos en zona `America/Lima`: `YYYY-MM-DD`; horas `HH:MM:SS`.
- IGV 18 %. Detracción: porcentaje y umbral configurables en `empresa` (por defecto 4 % y S/ 400 = `40000` céntimos). Aplica si total **>** umbral. Monto redondeado a soles enteros.
- Numeración sin ceros a la izquierda: `V001-1`, `F001-45`. Serie GRE-T por defecto `V001`; factura `F001`.
- Nombre de archivo SUNAT: `{RUC}-{tipo}-{serie}-{numero}` (tipo `31` GRE-T, `01` factura).
- Firma: XMLDSig enveloped, c14n inclusiva `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`, RSA-SHA256, digest SHA-256, Id de firma `SignSUNATAPP`.
- Secretos solo por variables de entorno. `.gitignore` ya excluye `.env*`, `*.pfx`, `storage/`, `data/`, `referencias/`.
- **No copiar código** de `referencias/sunat/odoo18-peru-localization` (AGPL). sunat-cli (MIT), fractuyo (ISC), GasperSoft (MIT) y xhandler-java (Apache-2.0) sí se pueden adaptar.
- Textos visibles al usuario y nombres de dominio en español.
- Commits en español (`feat(core): ...`), terminando con la línea `Claude-Session: https://claude.ai/code/session_01QPGFTzyKwX9M9T1kWj9wrZ`.

## Estructura de archivos

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts, .env.example
packages/
  core/
    scripts/generar-ubigeos.ts   descarga catálogo INEI → src/dominio/ubigeos.json
    scripts/sembrar.ts           crea empresa/vehículo/conductor/usuario desde .env
    scripts/demo.ts              flujo de punta a punta (verificación manual)
    src/errores.ts               ErrorValidacion, ErrorNegocio
    src/dominio/                 montos, validaciones, ubigeos(+json), fechas, serie-numero
    src/infra/                   config, almacen, contexto, auditoria, sembrar
    src/guias/                   validar, registrar, cargar, emitir
    src/facturas/                preparar, emitir
    src/cobros/cobros.ts
    test/
  db/
    drizzle.config.ts, drizzle/ (migraciones generadas)
    src/schema.ts, src/cliente.ts, src/correlativo.ts, src/index.ts
    test/
  sunat/
    xsd/2.1/{maindoc,common}/*.xsd, xsd/NOTICE.md
    src/tipos.ts, util.ts, letras.ts, certificado.ts, firma.ts, xsd.ts
    src/ubl/gre-transportista.ts, src/ubl/factura.ts
    src/zip.ts, cdr.ts, simulado.ts, real.ts, mixto.ts, index.ts
    test/
  pdf/
    src/comun.ts, guia.ts, factura.ts, index.ts
    test/
```

---

### Task 1: Monorepo + montos (IGV y detracción)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/dominio/montos.ts`, `packages/core/src/errores.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/montos.test.ts`

**Interfaces:**
- Produces:
  - `IGV_PORCENTAJE = 18`
  - `interface ParametrosDetraccion { porcentaje: number; umbralCentimos: number }`
  - `interface MontosFactura { subtotal: number; igv: number; total: number; detraccionPorcentaje: number | null; detraccionMonto: number; cobrable: number }`
  - `calcularMontosFactura(e: { montoCentimos: number; incluyeIgv: boolean; detraccion: ParametrosDetraccion }): MontosFactura`
  - `formatearSoles(centimos: number): string` → `"S/ 1,180.00"`
  - `class ErrorValidacion extends Error { errores: string[] }`, `class ErrorNegocio extends Error`

- [ ] **Step 1: Crear archivos raíz**

`package.json`:
```json
{
  "name": "sunatapp",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.3",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "pnpm -r exec tsc --noEmit"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { projects: ["packages/*"] },
});
```

- [ ] **Step 2: Crear el paquete core e instalar herramientas**

`packages/core/package.json`:
```json
{
  "name": "@sunatapp/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

`packages/core/vitest.config.ts` (mismo contenido para cada paquete nuevo de este plan):
```ts
import { defineProject } from "vitest/config";

export default defineProject({
  test: { testTimeout: 30000 },
});
```

Run: `pnpm add -Dw typescript vitest @types/node tsx`
Expected: instala sin errores y crea `pnpm-lock.yaml`.

- [ ] **Step 3: Escribir el test que falla**

`packages/core/test/montos.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { calcularMontosFactura, formatearSoles } from "../src/dominio/montos";

const detraccion = { porcentaje: 4, umbralCentimos: 40000 };

describe("calcularMontosFactura", () => {
  it("monto sin IGV: agrega 18 % y aplica detracción redondeada a soles", () => {
    expect(calcularMontosFactura({ montoCentimos: 100000, incluyeIgv: false, detraccion })).toEqual({
      subtotal: 100000,
      igv: 18000,
      total: 118000,
      detraccionPorcentaje: 4,
      detraccionMonto: 4700, // 4 % de 1180.00 = 47.20 → 47
      cobrable: 113300,
    });
  });

  it("monto con IGV: separa subtotal e IGV", () => {
    const m = calcularMontosFactura({ montoCentimos: 118000, incluyeIgv: true, detraccion });
    expect(m.subtotal).toBe(100000);
    expect(m.igv).toBe(18000);
    expect(m.total).toBe(118000);
  });

  it("monto chico con IGV redondea al céntimo y no aplica detracción", () => {
    expect(calcularMontosFactura({ montoCentimos: 10000, incluyeIgv: true, detraccion })).toEqual({
      subtotal: 8475,
      igv: 1525,
      total: 10000,
      detraccionPorcentaje: null,
      detraccionMonto: 0,
      cobrable: 10000,
    });
  });

  it("total igual al umbral no aplica detracción; un céntimo más sí", () => {
    expect(calcularMontosFactura({ montoCentimos: 40000, incluyeIgv: true, detraccion }).detraccionMonto).toBe(0);
    expect(calcularMontosFactura({ montoCentimos: 40001, incluyeIgv: true, detraccion }).detraccionMonto).toBe(1600);
  });

  it.each([0, -5, 10.5])("rechaza monto inválido %s", (monto) => {
    expect(() => calcularMontosFactura({ montoCentimos: monto, incluyeIgv: true, detraccion })).toThrow(
      "El monto debe ser un entero positivo en céntimos",
    );
  });
});

describe("formatearSoles", () => {
  it("formatea con separador de miles y dos decimales", () => {
    expect(formatearSoles(118000)).toBe("S/ 1,180.00");
    expect(formatearSoles(5)).toBe("S/ 0.05");
    expect(formatearSoles(123456789)).toBe("S/ 1,234,567.89");
  });
});
```

- [ ] **Step 4: Ejecutar y confirmar que falla**

Run: `pnpm vitest run packages/core/test/montos.test.ts`
Expected: FAIL — no se puede resolver `../src/dominio/montos`.

- [ ] **Step 5: Implementar**

`packages/core/src/errores.ts`:
```ts
export class ErrorValidacion extends Error {
  constructor(public readonly errores: string[]) {
    super(errores.join("; "));
    this.name = "ErrorValidacion";
  }
}

export class ErrorNegocio extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorNegocio";
  }
}
```

`packages/core/src/dominio/montos.ts`:
```ts
export const IGV_PORCENTAJE = 18;

export interface ParametrosDetraccion {
  porcentaje: number;
  umbralCentimos: number;
}

export interface MontosFactura {
  subtotal: number;
  igv: number;
  total: number;
  detraccionPorcentaje: number | null;
  detraccionMonto: number;
  cobrable: number;
}

export function calcularMontosFactura(e: {
  montoCentimos: number;
  incluyeIgv: boolean;
  detraccion: ParametrosDetraccion;
}): MontosFactura {
  if (!Number.isInteger(e.montoCentimos) || e.montoCentimos <= 0) {
    throw new Error("El monto debe ser un entero positivo en céntimos");
  }
  let subtotal: number;
  let igv: number;
  let total: number;
  if (e.incluyeIgv) {
    total = e.montoCentimos;
    subtotal = Math.round((total * 100) / (100 + IGV_PORCENTAJE));
    igv = total - subtotal;
  } else {
    subtotal = e.montoCentimos;
    igv = Math.round((subtotal * IGV_PORCENTAJE) / 100);
    total = subtotal + igv;
  }
  const aplica = total > e.detraccion.umbralCentimos;
  const detraccionMonto = aplica ? Math.round((total * e.detraccion.porcentaje) / 100 / 100) * 100 : 0;
  return {
    subtotal,
    igv,
    total,
    detraccionPorcentaje: aplica ? e.detraccion.porcentaje : null,
    detraccionMonto,
    cobrable: total - detraccionMonto,
  };
}

export function formatearSoles(centimos: number): string {
  const soles = Math.trunc(centimos / 100);
  const cent = String(Math.abs(centimos % 100)).padStart(2, "0");
  return `S/ ${soles.toLocaleString("en-US")}.${cent}`;
}
```

`packages/core/src/index.ts`:
```ts
export * from "./errores";
export * from "./dominio/montos";
```

- [ ] **Step 6: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/core/test/montos.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json vitest.config.ts packages/core
git commit -m "feat(core): monorepo y cálculo de IGV y detracción"
```

---

### Task 2: Validaciones (RUC, DNI), ubigeos, fechas y serie-número

**Files:**
- Create: `packages/core/src/dominio/validaciones.ts`, `ubigeos.ts`, `fechas.ts`, `serie-numero.ts`
- Create: `packages/core/scripts/generar-ubigeos.ts` → genera `packages/core/src/dominio/ubigeos.json`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/validaciones.test.ts`, `packages/core/test/fechas.test.ts`

**Interfaces:**
- Produces:
  - `validarRuc(ruc: string): boolean`, `validarDni(dni: string): boolean`
  - `type TipoDocIdentidad = "1" | "6"`; `tipoDocumentoDe(numero: string): TipoDocIdentidad | null`
  - `interface Ubigeo { codigo: string; departamento: string; provincia: string; distrito: string }`
  - `existeUbigeo(codigo: string): boolean`, `obtenerUbigeo(codigo: string): Ubigeo | undefined`, `buscarUbigeos(texto: string, limite?: number): Ubigeo[]`
  - `fechaHoraLima(d: Date): { fecha: string; hora: string }`, `sumarDias(fecha: string, dias: number): string`
  - `parsearSerieNumero(texto: string): { serie: string; numero: number } | null`

- [ ] **Step 1: Script que genera el catálogo de ubigeos**

`packages/core/scripts/generar-ubigeos.ts`:
```ts
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
```

Run: `pnpm tsx packages/core/scripts/generar-ubigeos.ts`
Expected: `Guardados 18xx ubigeos en ...ubigeos.json`

- [ ] **Step 2: Escribir los tests que fallan**

`packages/core/test/validaciones.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { tipoDocumentoDe, validarDni, validarRuc } from "../src/dominio/validaciones";
import { buscarUbigeos, existeUbigeo, obtenerUbigeo } from "../src/dominio/ubigeos";
import { parsearSerieNumero } from "../src/dominio/serie-numero";

describe("validarRuc", () => {
  it.each(["20131312955", "20606433094"])("acepta RUC válido %s", (ruc) => {
    expect(validarRuc(ruc)).toBe(true);
  });
  it.each(["20131312956", "2013131295", "30131312955", "2013131295A", ""])("rechaza %s", (ruc) => {
    expect(validarRuc(ruc)).toBe(false);
  });
});

describe("validarDni y tipoDocumentoDe", () => {
  it("valida 8 dígitos", () => {
    expect(validarDni("45288569")).toBe(true);
    expect(validarDni("4528856")).toBe(false);
  });
  it("detecta el tipo de documento", () => {
    expect(tipoDocumentoDe("20131312955")).toBe("6");
    expect(tipoDocumentoDe("45288569")).toBe("1");
    expect(tipoDocumentoDe("123")).toBeNull();
  });
});

describe("ubigeos", () => {
  it("obtiene un distrito por código", () => {
    expect(obtenerUbigeo("150115")).toEqual({
      codigo: "150115",
      departamento: "LIMA",
      provincia: "LIMA",
      distrito: "LA VICTORIA",
    });
    expect(existeUbigeo("250101")).toBe(true);
    expect(existeUbigeo("999999")).toBe(false);
  });
  it("busca sin importar tildes ni mayúsculas", () => {
    expect(buscarUbigeos("la victoria").map((u) => u.codigo)).toContain("150115");
  });
});

describe("parsearSerieNumero", () => {
  it("acepta con y sin ceros", () => {
    expect(parsearSerieNumero("F001-45")).toEqual({ serie: "F001", numero: 45 });
    expect(parsearSerieNumero(" v001-00000001 ")).toEqual({ serie: "V001", numero: 1 });
    expect(parsearSerieNumero("F001")).toBeNull();
  });
});
```

`packages/core/test/fechas.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fechaHoraLima, sumarDias } from "../src/dominio/fechas";

describe("fechas", () => {
  it("convierte a hora de Lima (UTC-5)", () => {
    expect(fechaHoraLima(new Date("2026-09-14T03:30:15Z"))).toEqual({ fecha: "2026-09-13", hora: "22:30:15" });
  });
  it("suma días cruzando meses y años", () => {
    expect(sumarDias("2026-09-13", 30)).toBe("2026-10-13");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});
```

- [ ] **Step 3: Ejecutar y confirmar que fallan**

Run: `pnpm vitest run packages/core/test/validaciones.test.ts packages/core/test/fechas.test.ts`
Expected: FAIL — módulos no encontrados.

- [ ] **Step 4: Implementar**

`packages/core/src/dominio/validaciones.ts`:
```ts
export type TipoDocIdentidad = "1" | "6";

const FACTORES_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function validarRuc(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const suma = FACTORES_RUC.reduce((acc, f, i) => acc + f * Number(ruc[i]), 0);
  const resto = 11 - (suma % 11);
  const digito = resto === 10 ? 0 : resto === 11 ? 1 : resto;
  return digito === Number(ruc[10]);
}

export function validarDni(dni: string): boolean {
  return /^\d{8}$/.test(dni);
}

export function tipoDocumentoDe(numero: string): TipoDocIdentidad | null {
  if (validarRuc(numero)) return "6";
  if (validarDni(numero)) return "1";
  return null;
}
```

`packages/core/src/dominio/ubigeos.ts`:
```ts
import datos from "./ubigeos.json";

export interface Ubigeo {
  codigo: string;
  departamento: string;
  provincia: string;
  distrito: string;
}

const catalogo: Ubigeo[] = (datos as string[][]).map(([codigo, departamento, provincia, distrito]) => ({
  codigo: codigo!,
  departamento: departamento!,
  provincia: provincia!,
  distrito: distrito!,
}));
const porCodigo = new Map(catalogo.map((u) => [u.codigo, u]));

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();
}

export function obtenerUbigeo(codigo: string): Ubigeo | undefined {
  return porCodigo.get(codigo);
}

export function existeUbigeo(codigo: string): boolean {
  return porCodigo.has(codigo);
}

export function buscarUbigeos(texto: string, limite = 10): Ubigeo[] {
  const buscado = normalizar(texto);
  if (!buscado) return [];
  return catalogo.filter((u) => normalizar(u.distrito).includes(buscado)).slice(0, limite);
}
```

`packages/core/src/dominio/fechas.ts`:
```ts
const formato = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function fechaHoraLima(d: Date): { fecha: string; hora: string } {
  const p = Object.fromEntries(formato.formatToParts(d).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}:${p.second}` };
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
```

`packages/core/src/dominio/serie-numero.ts`:
```ts
export function parsearSerieNumero(texto: string): { serie: string; numero: number } | null {
  const m = texto.trim().toUpperCase().match(/^([A-Z0-9]{4})-(\d{1,8})$/);
  if (!m) return null;
  return { serie: m[1]!, numero: Number(m[2]) };
}
```

Añadir a `packages/core/src/index.ts`:
```ts
export * from "./dominio/validaciones";
export * from "./dominio/ubigeos";
export * from "./dominio/fechas";
export * from "./dominio/serie-numero";
```

- [ ] **Step 5: Ejecutar y confirmar que pasan**

Run: `pnpm vitest run packages/core/test`
Expected: PASS (todos los tests de core).

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): validación de RUC/DNI, catálogo de ubigeos y fechas de Lima"
```

---

### Task 3: Base de datos (esquema, migraciones, correlativos)

**Files:**
- Create: `packages/db/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`
- Create: `packages/db/src/schema.ts`, `src/cliente.ts`, `src/correlativo.ts`, `src/index.ts`
- Generate: `packages/db/drizzle/*` (drizzle-kit)
- Test: `packages/db/test/db.test.ts`

**Interfaces:**
- Produces (desde `@sunatapp/db`):
  - Tablas Drizzle: `empresa`, `vehiculo`, `conductor`, `usuario`, `contraparte`, `documentoRecibido`, `guiaTransportista`, `guiaItem`, `factura`, `facturaGuia`, `cobro`, `correlativo`, `auditoria`
  - Tipos: `type Db`, `type Tx`, `type Ejecutor = Db | Tx`, `type EstadoGuia`, `type EstadoSunatFactura`, `type EstadoCobro`
  - `crearDb(o: { tipo: "pglite"; directorio?: string } | { tipo: "postgres"; url: string }): Promise<{ db: Db; cerrar: () => Promise<void> }>` (aplica migraciones)
  - `siguienteCorrelativo(db: Ejecutor, tipoDocumento: string, serie: string): Promise<number>`
  - Re-exporta `eq, and, or, lte, lt, gte, inArray, isNull, desc, sql` de `drizzle-orm` para que `core` use la misma instancia.

- [ ] **Step 1: Crear paquete e instalar dependencias**

`packages/db/package.json`:
```json
{
  "name": "@sunatapp/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "generar": "drizzle-kit generate" }
}
```
`packages/db/tsconfig.json`: igual que core. `packages/db/vitest.config.ts`: igual que core.

Run: `pnpm --filter @sunatapp/db add drizzle-orm @electric-sql/pglite pg`
Run: `pnpm --filter @sunatapp/db add -D drizzle-kit @types/pg`

`packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
```

- [ ] **Step 2: Escribir el esquema**

`packages/db/src/schema.ts`:
```ts
import {
  bigint, boolean, date, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, serial, text, timestamp, unique,
} from "drizzle-orm/pg-core";

const creadoEn = () => timestamp("creado_en", { withTimezone: true }).notNull().defaultNow();
const actualizadoEn = () => timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow();
const centimos = (nombre: string) => bigint(nombre, { mode: "number" });

export const estadoGuiaEnum = pgEnum("estado_guia", ["borrador", "pendiente_envio", "enviada", "aceptada", "rechazada"]);
export const estadoSunatFacturaEnum = pgEnum("estado_sunat_factura", ["borrador", "pendiente_envio", "aceptada", "observada", "rechazada"]);
export const estadoCobroEnum = pgEnum("estado_cobro", ["pendiente", "parcial", "pagada"]);
export const formaPagoEnum = pgEnum("forma_pago", ["contado", "credito"]);
export const medioCobroEnum = pgEnum("medio_cobro", ["transferencia", "efectivo", "otro"]);

export type EstadoGuia = (typeof estadoGuiaEnum.enumValues)[number];
export type EstadoSunatFactura = (typeof estadoSunatFacturaEnum.enumValues)[number];
export type EstadoCobro = (typeof estadoCobroEnum.enumValues)[number];

export const empresa = pgTable("empresa", {
  id: serial("id").primaryKey(),
  ruc: text("ruc").notNull(),
  razonSocial: text("razon_social").notNull(),
  nombreComercial: text("nombre_comercial"),
  direccion: text("direccion").notNull(),
  ubigeo: text("ubigeo").notNull(),
  registroMtc: text("registro_mtc").notNull(),
  cuentaDetraccionBn: text("cuenta_detraccion_bn"),
  serieGre: text("serie_gre").notNull().default("V001"),
  serieFactura: text("serie_factura").notNull().default("F001"),
  detraccionPorcentaje: integer("detraccion_porcentaje").notNull().default(4),
  detraccionUmbral: centimos("detraccion_umbral").notNull().default(40000),
});

export const vehiculo = pgTable("vehiculo", {
  id: serial("id").primaryKey(),
  placa: text("placa").notNull().unique(),
  marca: text("marca"),
  numeroAutorizacion: text("numero_autorizacion"),
  activo: boolean("activo").notNull().default(true),
});

export const conductor = pgTable("conductor", {
  id: serial("id").primaryKey(),
  tipoDoc: text("tipo_doc").notNull().default("1"),
  numeroDoc: text("numero_doc").notNull(),
  nombres: text("nombres").notNull(),
  apellidos: text("apellidos").notNull(),
  licencia: text("licencia").notNull(),
  activo: boolean("activo").notNull().default(true),
});

export const usuario = pgTable("usuario", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  telegramId: bigint("telegram_id", { mode: "number" }).unique(),
  activo: boolean("activo").notNull().default(true),
});

export const contraparte = pgTable("contraparte", {
  id: serial("id").primaryKey(),
  tipoDoc: text("tipo_doc").notNull(),
  numeroDoc: text("numero_doc").notNull().unique(),
  razonSocial: text("razon_social").notNull(),
  direccion: text("direccion"),
  ubigeo: text("ubigeo"),
});

export const documentoRecibido = pgTable("documento_recibido", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  telegramFileId: text("telegram_file_id"),
  rutaArchivo: text("ruta_archivo").notNull(),
  mime: text("mime").notNull(),
  datosExtraidos: jsonb("datos_extraidos"),
  confianza: jsonb("confianza"),
  creadoEn: creadoEn(),
});

export const guiaTransportista = pgTable("guia_transportista", {
  id: serial("id").primaryKey(),
  serie: text("serie").notNull(),
  numero: integer("numero"),
  fechaEmision: date("fecha_emision", { mode: "string" }),
  horaEmision: text("hora_emision"),
  fechaTraslado: date("fecha_traslado", { mode: "string" }).notNull(),
  remitenteId: integer("remitente_id").notNull().references(() => contraparte.id),
  destinatarioId: integer("destinatario_id").notNull().references(() => contraparte.id),
  partidaDireccion: text("partida_direccion").notNull(),
  partidaUbigeo: text("partida_ubigeo").notNull(),
  llegadaDireccion: text("llegada_direccion").notNull(),
  llegadaUbigeo: text("llegada_ubigeo").notNull(),
  pesoBruto: numeric("peso_bruto", { precision: 12, scale: 3 }).notNull(),
  unidadPeso: text("unidad_peso").notNull().default("KGM"),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiculo.id),
  conductorId: integer("conductor_id").notNull().references(() => conductor.id),
  greRemitenteRef: text("gre_remitente_ref"),
  documentoRecibidoId: integer("documento_recibido_id").references(() => documentoRecibido.id),
  estado: estadoGuiaEnum("estado").notNull().default("borrador"),
  ticket: text("ticket"),
  codigoRespuesta: text("codigo_respuesta"),
  mensajeRespuesta: text("mensaje_respuesta"),
  rutaXml: text("ruta_xml"),
  rutaCdr: text("ruta_cdr"),
  rutaPdf: text("ruta_pdf"),
  intentos: integer("intentos").notNull().default(0),
  proximoIntentoEn: timestamp("proximo_intento_en", { withTimezone: true }),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [unique("guia_serie_numero").on(t.serie, t.numero)]);

export const guiaItem = pgTable("guia_item", {
  id: serial("id").primaryKey(),
  guiaId: integer("guia_id").notNull().references(() => guiaTransportista.id, { onDelete: "cascade" }),
  descripcion: text("descripcion").notNull(),
  cantidad: numeric("cantidad", { precision: 14, scale: 3 }).notNull(),
  unidadMedida: text("unidad_medida").notNull().default("NIU"),
});

export const factura = pgTable("factura", {
  id: serial("id").primaryKey(),
  serie: text("serie").notNull(),
  numero: integer("numero"),
  fechaEmision: date("fecha_emision", { mode: "string" }),
  horaEmision: text("hora_emision"),
  clienteId: integer("cliente_id").notNull().references(() => contraparte.id),
  moneda: text("moneda").notNull().default("PEN"),
  descripcion: text("descripcion").notNull(),
  subtotal: centimos("subtotal").notNull(),
  igv: centimos("igv").notNull(),
  total: centimos("total").notNull(),
  detraccionPorcentaje: integer("detraccion_porcentaje"),
  detraccionMonto: centimos("detraccion_monto").notNull().default(0),
  formaPago: formaPagoEnum("forma_pago").notNull(),
  diasCredito: integer("dias_credito"),
  fechaVencimiento: date("fecha_vencimiento", { mode: "string" }),
  estadoSunat: estadoSunatFacturaEnum("estado_sunat").notNull().default("borrador"),
  estadoCobro: estadoCobroEnum("estado_cobro").notNull().default("pendiente"),
  codigoRespuesta: text("codigo_respuesta"),
  mensajeRespuesta: text("mensaje_respuesta"),
  rutaXml: text("ruta_xml"),
  rutaCdr: text("ruta_cdr"),
  rutaPdf: text("ruta_pdf"),
  intentos: integer("intentos").notNull().default(0),
  proximoIntentoEn: timestamp("proximo_intento_en", { withTimezone: true }),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [unique("factura_serie_numero").on(t.serie, t.numero)]);

export const facturaGuia = pgTable("factura_guia", {
  facturaId: integer("factura_id").notNull().references(() => factura.id, { onDelete: "cascade" }),
  guiaId: integer("guia_id").notNull().unique().references(() => guiaTransportista.id),
}, (t) => [primaryKey({ columns: [t.facturaId, t.guiaId] })]);

export const cobro = pgTable("cobro", {
  id: serial("id").primaryKey(),
  facturaId: integer("factura_id").notNull().references(() => factura.id),
  fecha: date("fecha", { mode: "string" }).notNull(),
  monto: centimos("monto").notNull(),
  medio: medioCobroEnum("medio").notNull(),
  nota: text("nota"),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  creadoEn: creadoEn(),
});

export const correlativo = pgTable("correlativo", {
  tipoDocumento: text("tipo_documento").notNull(),
  serie: text("serie").notNull(),
  ultimoNumero: integer("ultimo_numero").notNull(),
}, (t) => [primaryKey({ columns: [t.tipoDocumento, t.serie] })]);

export const auditoria = pgTable("auditoria", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  accion: text("accion").notNull(),
  entidad: text("entidad").notNull(),
  entidadId: text("entidad_id"),
  detalle: jsonb("detalle"),
  creadoEn: creadoEn(),
});
```

- [ ] **Step 3: Generar la migración inicial**

Run: `pnpm --filter @sunatapp/db exec drizzle-kit generate --name inicial`
Expected: crea `packages/db/drizzle/0000_inicial.sql` y `packages/db/drizzle/meta/`.

- [ ] **Step 4: Escribir el test que falla**

`packages/db/test/db.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearDb, empresa, siguienteCorrelativo, type Db } from "../src/index";

let db: Db;
let cerrar: () => Promise<void>;

beforeEach(async () => {
  ({ db, cerrar } = await crearDb({ tipo: "pglite" }));
});
afterEach(async () => {
  await cerrar();
});

describe("crearDb", () => {
  it("aplica migraciones y permite insertar con valores por defecto", async () => {
    await db.insert(empresa).values({
      ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", direccion: "AV. DEMO 123",
      ubigeo: "150115", registroMtc: "MTC123",
    });
    const [fila] = await db.select().from(empresa);
    expect(fila?.serieGre).toBe("V001");
    expect(fila?.detraccionUmbral).toBe(40000);
  });
});

describe("siguienteCorrelativo", () => {
  it("numera 1, 2, 3 por serie de forma independiente", async () => {
    expect(await siguienteCorrelativo(db, "31", "V001")).toBe(1);
    expect(await siguienteCorrelativo(db, "31", "V001")).toBe(2);
    expect(await siguienteCorrelativo(db, "01", "F001")).toBe(1);
    expect(await siguienteCorrelativo(db, "31", "V001")).toBe(3);
  });

  it("no repite números con llamadas concurrentes", async () => {
    const numeros = await Promise.all(Array.from({ length: 20 }, () => siguienteCorrelativo(db, "31", "V001")));
    expect(new Set(numeros).size).toBe(20);
    expect(Math.max(...numeros)).toBe(20);
  });

  it("funciona dentro de una transacción", async () => {
    const n = await db.transaction((tx) => siguienteCorrelativo(tx, "01", "F001"));
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 5: Ejecutar y confirmar que falla**

Run: `pnpm vitest run packages/db`
Expected: FAIL — `../src/index` no existe.

- [ ] **Step 6: Implementar cliente, correlativo e índice**

`packages/db/src/cliente.ts`:
```ts
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migrarPglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migrarPg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Ejecutor = Db | Tx;

const carpetaMigraciones = fileURLToPath(new URL("../drizzle", import.meta.url));

export type OpcionesDb = { tipo: "pglite"; directorio?: string } | { tipo: "postgres"; url: string };

export async function crearDb(o: OpcionesDb): Promise<{ db: Db; cerrar: () => Promise<void> }> {
  if (o.tipo === "pglite") {
    const cliente = o.directorio ? new PGlite(o.directorio) : new PGlite();
    const db = drizzlePglite({ client: cliente, schema });
    await migrarPglite(db, { migrationsFolder: carpetaMigraciones });
    return { db: db as unknown as Db, cerrar: () => cliente.close() };
  }
  const pool = new pg.Pool({ connectionString: o.url });
  const db = drizzlePg({ client: pool, schema });
  await migrarPg(db, { migrationsFolder: carpetaMigraciones });
  return { db: db as unknown as Db, cerrar: () => pool.end() };
}
```

`packages/db/src/correlativo.ts`:
```ts
import { sql } from "drizzle-orm";
import type { Ejecutor } from "./cliente";
import { correlativo } from "./schema";

export async function siguienteCorrelativo(db: Ejecutor, tipoDocumento: string, serie: string): Promise<number> {
  const [fila] = await db
    .insert(correlativo)
    .values({ tipoDocumento, serie, ultimoNumero: 1 })
    .onConflictDoUpdate({
      target: [correlativo.tipoDocumento, correlativo.serie],
      set: { ultimoNumero: sql`${correlativo.ultimoNumero} + 1` },
    })
    .returning({ numero: correlativo.ultimoNumero });
  if (!fila) throw new Error("No se pudo obtener el correlativo");
  return fila.numero;
}
```

`packages/db/src/index.ts`:
```ts
export * from "./schema";
export * from "./cliente";
export * from "./correlativo";
export { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
```

- [ ] **Step 7: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/db`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): esquema Drizzle, migración inicial y correlativos atómicos"
```

---

### Task 4: SUNAT — certificado y firma digital

**Files:**
- Create: `packages/sunat/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/sunat/src/util.ts`, `src/certificado.ts`, `src/firma.ts`, `src/index.ts`
- Test: `packages/sunat/test/firma.test.ts`

**Interfaces:**
- Produces (desde `@sunatapp/sunat`):
  - `escapeXml(s: string): string`, `centimosADecimal(c: number): string` (`118000` → `"1180.00"`), `decimal(valor: string, decimales: number): string`
  - `interface Certificado { privateKeyPem: string; certificatePem: string; certificadoBase64: string; subject: string; validoDesde: Date; validoHasta: Date }`
  - `cargarPfx(pfx: Buffer, password: string): Certificado`
  - `generarCertificadoPrueba(o: { ruc: string; razonSocial: string; password: string }): Buffer`
  - `ID_FIRMA = "SignSUNATAPP"`
  - `firmarXml(xmlSinFirma: string, cert: Certificado): string` — requiere `<ext:ExtensionContent/>` en el XML
  - `verificarFirma(xml: string): { valida: boolean; motivo?: "sin_firma" | "digest" | "firma" }`
  - `extraerDigest(xml: string): string`

> Adaptado de `referencias/sunat/sunat-cli/packages/cli/src/cpe/sign/xades.ts` y `cert-loader.ts` (MIT), cambiando a SHA-256 como en `referencias/sunat/GasperSoft.SUNAT/Xml/20606433094-31-V001-1.xml`.

- [ ] **Step 1: Crear paquete e instalar dependencias**

`packages/sunat/package.json`:
```json
{
  "name": "@sunatapp/sunat",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```
`tsconfig.json` y `vitest.config.ts`: igual que core.

Run: `pnpm --filter @sunatapp/sunat add node-forge @xmldom/xmldom xml-crypto`
Run: `pnpm --filter @sunatapp/sunat add -D @types/node-forge`

- [ ] **Step 2: Escribir el test que falla**

`packages/sunat/test/firma.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { cargarPfx, generarCertificadoPrueba, type Certificado } from "../src/certificado";
import { extraerDigest, firmarXml, ID_FIRMA, verificarFirma } from "../src/firma";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:ID>F001-1</cbc:ID>
  <cbc:Note>ORIGINAL</cbc:Note>
</Invoice>`;

let cert: Certificado;

beforeAll(() => {
  const pfx = generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "clave" });
  cert = cargarPfx(pfx, "clave");
});

describe("certificado de prueba", () => {
  it("se carga con clave privada y datos", () => {
    expect(cert.privateKeyPem).toContain("PRIVATE KEY");
    expect(cert.subject).toContain("TRANSPORTES DEMO SAC");
    expect(cert.validoHasta.getTime()).toBeGreaterThan(Date.now());
  });

  it("falla con clave incorrecta", () => {
    const pfx = generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "X", password: "buena" });
    expect(() => cargarPfx(pfx, "mala")).toThrow();
  });
});

describe("firmarXml", () => {
  it("inserta la firma SHA-256 dentro de ExtensionContent y se verifica", () => {
    const firmado = firmarXml(XML, cert);
    expect(firmado).toContain(`Id="${ID_FIRMA}"`);
    expect(firmado).toContain("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
    expect(verificarFirma(firmado)).toEqual({ valida: true });
    expect(extraerDigest(firmado)).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("detecta un documento alterado", () => {
    const alterado = firmarXml(XML, cert).replace("ORIGINAL", "ALTERADO");
    expect(verificarFirma(alterado)).toEqual({ valida: false, motivo: "digest" });
  });

  it("detecta ausencia de firma", () => {
    expect(verificarFirma(XML)).toEqual({ valida: false, motivo: "sin_firma" });
  });

  it("exige el nodo ExtensionContent", () => {
    expect(() => firmarXml("<a/>", cert)).toThrow("ExtensionContent");
  });
});
```

- [ ] **Step 3: Ejecutar y confirmar que falla**

Run: `pnpm vitest run packages/sunat/test/firma.test.ts`
Expected: FAIL — módulos no encontrados.

- [ ] **Step 4: Implementar**

`packages/sunat/src/util.ts`:
```ts
export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function centimosADecimal(c: number): string {
  const signo = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${signo}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function decimal(valor: string, decimales: number): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error(`Número inválido: ${valor}`);
  return n.toFixed(decimales);
}
```

`packages/sunat/src/certificado.ts`:
```ts
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

export interface Certificado {
  privateKeyPem: string;
  certificatePem: string;
  certificadoBase64: string;
  subject: string;
  validoDesde: Date;
  validoHasta: Date;
}

function pemABase64(pem: string): string {
  return pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
}

export function cargarPfx(pfx: Buffer, password: string): Certificado {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary")));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  const bolsaClave = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
  const clave = bolsaClave?.[0]?.key;
  if (!clave) throw new Error("El certificado no tiene clave privada (¿contraseña incorrecta?)");
  const bolsaCert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  const cert = bolsaCert?.[0]?.cert;
  if (!cert) throw new Error("El archivo no contiene certificado");
  const certificatePem = forge.pki.certificateToPem(cert);
  return {
    privateKeyPem: forge.pki.privateKeyToPem(clave),
    certificatePem,
    certificadoBase64: pemABase64(certificatePem),
    subject: cert.subject.attributes.map((a) => `${a.shortName}=${a.value}`).join(", "),
    validoDesde: cert.validity.notBefore,
    validoHasta: cert.validity.notAfter,
  };
}

export function generarCertificadoPrueba(o: { ruc: string; razonSocial: string; password: string }): Buffer {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const clavePrivada = forge.pki.privateKeyFromPem(privateKey);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000);
  const atributos = [
    { name: "commonName", value: `${o.razonSocial} - CERTIFICADO DE PRUEBA` },
    { name: "organizationName", value: o.razonSocial },
    { name: "organizationalUnitName", value: `RUC ${o.ruc}` },
    { shortName: "C", value: "PE" },
  ];
  cert.setSubject(atributos);
  cert.setIssuer(atributos);
  cert.sign(clavePrivada, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(clavePrivada, [cert], o.password, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}
```

`packages/sunat/src/firma.ts`:
```ts
import { createHash, createSign, createVerify, X509Certificate } from "node:crypto";
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";
import { C14nCanonicalization } from "xml-crypto";
import type { Certificado } from "./certificado";

export const ID_FIRMA = "SignSUNATAPP";

const DS = "http://www.w3.org/2000/09/xmldsig#";
const EXT = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const c14n = new C14nCanonicalization();

type Ns = { prefix: string; namespaceURI: string };

function parsear(xml: string): Document {
  return new DOMParser().parseFromString(xml, "text/xml");
}

function serializar(doc: Document | Node): string {
  return new XMLSerializer().serializeToString(doc);
}

function canonicalizar(nodo: Node, ancestros: Ns[] = []): string {
  return c14n.process(nodo as never, { ancestorNamespaces: ancestros }) as string;
}

function namespacesAncestros(nodo: Element): Ns[] {
  const lista: Ns[] = [];
  const vistos = new Set<string>();
  let actual = nodo.parentNode;
  while (actual && actual.nodeType === 1) {
    const el = actual as Element;
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes.item(i)!;
      if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) {
        const prefix = attr.name === "xmlns" ? "" : attr.name.slice(6);
        if (!vistos.has(prefix)) {
          vistos.add(prefix);
          lista.push({ prefix, namespaceURI: attr.value });
        }
      }
    }
    actual = actual.parentNode;
  }
  return lista;
}

function digestSinFirma(doc: Document): string {
  const copia = parsear(serializar(doc));
  const firma = copia.getElementsByTagNameNS(DS, "Signature").item(0);
  firma?.parentNode?.removeChild(firma);
  return createHash("sha256").update(canonicalizar(copia.documentElement!), "utf8").digest("base64");
}

function hijo(doc: Document, padre: Element, nombre: string, atributos: Record<string, string> = {}, texto?: string): Element {
  const el = doc.createElementNS(DS, `ds:${nombre}`);
  for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, v);
  if (texto !== undefined) el.appendChild(doc.createTextNode(texto));
  padre.appendChild(el);
  return el;
}

export function firmarXml(xmlSinFirma: string, cert: Certificado): string {
  const doc = parsear(xmlSinFirma);
  const contenido = doc.getElementsByTagNameNS(EXT, "ExtensionContent").item(0);
  if (!contenido) throw new Error("El XML no tiene el nodo ext:ExtensionContent");
  while (contenido.firstChild) contenido.removeChild(contenido.firstChild);

  const firma = doc.createElementNS(DS, "ds:Signature");
  firma.setAttribute("Id", ID_FIRMA);
  contenido.appendChild(firma);
  const signedInfo = hijo(doc, firma, "SignedInfo");
  hijo(doc, signedInfo, "CanonicalizationMethod", { Algorithm: C14N });
  hijo(doc, signedInfo, "SignatureMethod", { Algorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" });
  const referencia = hijo(doc, signedInfo, "Reference", { URI: "" });
  const transforms = hijo(doc, referencia, "Transforms");
  hijo(doc, transforms, "Transform", { Algorithm: "http://www.w3.org/2000/09/xmldsig#enveloped-signature" });
  hijo(doc, referencia, "DigestMethod", { Algorithm: "http://www.w3.org/2001/04/xmlenc#sha256" });
  hijo(doc, referencia, "DigestValue", {}, digestSinFirma(doc));
  hijo(doc, firma, "SignatureValue");
  const keyInfo = hijo(doc, firma, "KeyInfo");
  const x509Data = hijo(doc, keyInfo, "X509Data");
  hijo(doc, x509Data, "X509Certificate", {}, cert.certificadoBase64);

  // Reparsear para firmar exactamente el mismo DOM que verá el receptor.
  const doc2 = parsear(serializar(doc));
  const firma2 = doc2.getElementsByTagNameNS(DS, "Signature").item(0)!;
  const signedInfo2 = firma2.getElementsByTagNameNS(DS, "SignedInfo").item(0)!;
  const valor = createSign("RSA-SHA256")
    .update(canonicalizar(signedInfo2, namespacesAncestros(signedInfo2)), "utf8")
    .sign(cert.privateKeyPem, "base64");
  firma2.getElementsByTagNameNS(DS, "SignatureValue").item(0)!.appendChild(doc2.createTextNode(valor));

  const salida = serializar(doc2);
  return salida.startsWith("<?xml") ? salida : `<?xml version="1.0" encoding="UTF-8"?>\n${salida}`;
}

function textoDs(padre: Element, nombre: string): string {
  return padre.getElementsByTagNameNS(DS, nombre).item(0)?.textContent?.trim() ?? "";
}

export function verificarFirma(xml: string): { valida: boolean; motivo?: "sin_firma" | "digest" | "firma" } {
  const doc = parsear(xml);
  const firma = doc.getElementsByTagNameNS(DS, "Signature").item(0);
  if (!firma) return { valida: false, motivo: "sin_firma" };
  if (digestSinFirma(doc) !== textoDs(firma, "DigestValue")) return { valida: false, motivo: "digest" };
  const signedInfo = firma.getElementsByTagNameNS(DS, "SignedInfo").item(0)!;
  const lineas = textoDs(firma, "X509Certificate").match(/.{1,64}/g) ?? [];
  const pem = `-----BEGIN CERTIFICATE-----\n${lineas.join("\n")}\n-----END CERTIFICATE-----\n`;
  const ok = createVerify("RSA-SHA256")
    .update(canonicalizar(signedInfo, namespacesAncestros(signedInfo)), "utf8")
    .verify(new X509Certificate(pem).publicKey, textoDs(firma, "SignatureValue"), "base64");
  return ok ? { valida: true } : { valida: false, motivo: "firma" };
}

export function extraerDigest(xml: string): string {
  const firma = parsear(xml).getElementsByTagNameNS(DS, "Signature").item(0);
  if (!firma) throw new Error("El XML no está firmado");
  return textoDs(firma, "DigestValue");
}
```

Si TypeScript indica que `C14nCanonicalization` no se exporta desde `"xml-crypto"`, importar desde `"xml-crypto/lib/c14n-canonicalization.js"` (así lo hace sunat-cli).

`packages/sunat/src/index.ts`:
```ts
export * from "./util";
export * from "./certificado";
export * from "./firma";
```

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/sunat/test/firma.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/sunat pnpm-lock.yaml
git commit -m "feat(sunat): certificado de prueba y firma XMLDSig SHA-256 con verificación"
```

---

### Task 5: SUNAT — XML de GRE Transportista + validación XSD

**Files:**
- Copy: XSD UBL 2.1 a `packages/sunat/xsd/2.1/maindoc/` y `packages/sunat/xsd/2.1/common/`; create `packages/sunat/xsd/NOTICE.md`
- Create: `packages/sunat/src/xsd.ts`, `packages/sunat/src/ubl/gre-transportista.ts`
- Modify: `packages/sunat/src/index.ts`
- Test: `packages/sunat/test/gre-transportista.test.ts`, `packages/sunat/test/datos-prueba.ts`

**Interfaces:**
- Consumes: `firmarXml`, `escapeXml`, `decimal`, `ID_FIRMA` (Task 4)
- Produces:
  - `type TipoDocIdentidadSunat = "0" | "1" | "4" | "6" | "7"`
  - `interface Parte { tipoDoc: TipoDocIdentidadSunat; numeroDoc: string; razonSocial: string }`
  - `interface Direccion { ubigeo: string; direccion: string }`
  - `interface DatosGreTransportista { emisor: { ruc: string; razonSocial: string; registroMtc: string }; serie: string; numero: number; fechaEmision: string; horaEmision: string; fechaTraslado: string; remitente: Parte; destinatario: Parte; partida: Direccion; llegada: Direccion; pesoBruto: string; unidadPeso: "KGM" | "TNE"; vehiculo: { placa: string }; conductor: { tipoDoc: TipoDocIdentidadSunat; numeroDoc: string; nombres: string; apellidos: string; licencia: string }; documentosRelacionados: Array<{ tipo: "01" | "09"; serieNumero: string; rucEmisor: string }>; items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }> }`
  - `construirXmlGreTransportista(d: DatosGreTransportista): string` (sin firmar)
  - `validarXsd(xml: string, tipo: "DespatchAdvice" | "Invoice"): Promise<{ valido: boolean; errores: string[] }>`
  - Test helper `datosGrePrueba(): DatosGreTransportista` en `test/datos-prueba.ts`

> Estructura basada en `referencias/sunat/GasperSoft.SUNAT/Xml/20606433094-31-V001-1.xml`. El orden de los elementos está definido por el XSD; no reordenar.

- [ ] **Step 1: Copiar los XSD e instalar el validador**

Run (PowerShell, desde la raíz):
```powershell
$origen = "referencias\sunat\xhandler-java\xbuilder\core\src\test\resources\xsd\2.1"
New-Item -ItemType Directory -Force packages\sunat\xsd\2.1\maindoc, packages\sunat\xsd\2.1\common | Out-Null
Copy-Item "$origen\maindoc\UBL-DespatchAdvice-2.1.xsd", "$origen\maindoc\UBL-Invoice-2.1.xsd" packages\sunat\xsd\2.1\maindoc\
Copy-Item "$origen\common\*.xsd" packages\sunat\xsd\2.1\common\
(Get-ChildItem packages\sunat\xsd\2.1 -Recurse -File).Count
```
Expected: `16`

`packages/sunat/xsd/NOTICE.md`:
```markdown
Esquemas UBL 2.1 (OASIS) copiados de project-openubl/xhandler-java
(`xbuilder/core/src/test/resources/xsd/2.1`), licencia Apache-2.0.
Los esquemas son © OASIS Open y se distribuyen sin modificaciones.
```

Run: `pnpm --filter @sunatapp/sunat add xmllint-wasm`

- [ ] **Step 2: Escribir datos de prueba y el test que falla**

`packages/sunat/test/datos-prueba.ts`:
```ts
import type { DatosGreTransportista } from "../src/ubl/gre-transportista";

export function datosGrePrueba(): DatosGreTransportista {
  return {
    emisor: { ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", registroMtc: "15123456CNG" },
    serie: "V001",
    numero: 1,
    fechaEmision: "2026-09-13",
    horaEmision: "10:15:00",
    fechaTraslado: "2026-09-14",
    remitente: { tipoDoc: "6", numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA & CIA S.A.C." },
    destinatario: { tipoDoc: "6", numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO S.A.C." },
    partida: { ubigeo: "150115", direccion: "AV. 28 DE JULIO 1275, LA VICTORIA" },
    llegada: { ubigeo: "250101", direccion: "CARRETERA FEDERICO BASADRE KM 86" },
    pesoBruto: "1500.5",
    unidadPeso: "KGM",
    vehiculo: { placa: "abc-123" },
    conductor: { tipoDoc: "1", numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" },
    documentosRelacionados: [{ tipo: "09", serieNumero: "EG01-123", rucEmisor: "20131312955" }],
    items: [
      { descripcion: "CAJAS DE CERÁMICA", cantidad: "120", unidadMedida: "BX" },
      { descripcion: "BOLSAS DE CEMENTO", cantidad: "40", unidadMedida: "NIU" },
    ],
  };
}
```

`packages/sunat/test/gre-transportista.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { cargarPfx, generarCertificadoPrueba, type Certificado } from "../src/certificado";
import { firmarXml, verificarFirma } from "../src/firma";
import { construirXmlGreTransportista } from "../src/ubl/gre-transportista";
import { validarXsd } from "../src/xsd";
import { datosGrePrueba } from "./datos-prueba";

let cert: Certificado;
beforeAll(() => {
  cert = cargarPfx(generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "x" }), "x");
});

describe("construirXmlGreTransportista", () => {
  it("genera tipo 31 con transportista, remitente, vehículo y conductor", () => {
    const xml = construirXmlGreTransportista(datosGrePrueba());
    expect(xml).toContain("<cbc:ID>V001-1</cbc:ID>");
    expect(xml).toContain('catalogo01">31</cbc:DespatchAdviceTypeCode>');
    expect(xml).toContain("<cbc:CompanyID>15123456CNG</cbc:CompanyID>");
    expect(xml).toContain("<cbc:ID>ABC123</cbc:ID>"); // placa normalizada
    expect(xml).toContain("<cbc:FirstName>JHON LARRY</cbc:FirstName>");
    expect(xml).toContain('<cbc:GrossWeightMeasure unitCode="KGM">1500.500</cbc:GrossWeightMeasure>');
    expect(xml).toContain("<cbc:RegistrationName>DISTRIBUIDORA &amp; CIA S.A.C.</cbc:RegistrationName>");
    expect(xml).toContain('catalogo61">09</cbc:DocumentTypeCode>');
    expect(xml).toContain("<cbc:StartDate>2026-09-14</cbc:StartDate>");
    expect(xml.match(/<cac:DespatchLine>/g)).toHaveLength(2);
  });

  it("el XML firmado cumple el XSD UBL DespatchAdvice 2.1", async () => {
    const firmado = firmarXml(construirXmlGreTransportista(datosGrePrueba()), cert);
    expect(verificarFirma(firmado).valida).toBe(true);
    const resultado = await validarXsd(firmado, "DespatchAdvice");
    expect(resultado.errores).toEqual([]);
    expect(resultado.valido).toBe(true);
  });

  it("validarXsd reporta errores si falta un elemento obligatorio", async () => {
    const firmado = firmarXml(construirXmlGreTransportista(datosGrePrueba()), cert);
    const roto = firmado.replace(/<cbc:ID>V001-1<\/cbc:ID>/, "");
    const resultado = await validarXsd(roto, "DespatchAdvice");
    expect(resultado.valido).toBe(false);
    expect(resultado.errores.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Ejecutar y confirmar que falla**

Run: `pnpm vitest run packages/sunat/test/gre-transportista.test.ts`
Expected: FAIL — `../src/ubl/gre-transportista` no existe.

- [ ] **Step 4: Implementar el validador XSD**

`packages/sunat/src/xsd.ts`:
```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateXML } from "xmllint-wasm";

const DIR = fileURLToPath(new URL("../xsd/2.1/", import.meta.url));

function leerXsd(ruta: string): string {
  // Los imports "../common/X.xsd" se aplanan porque xmllint-wasm usa un sistema de archivos plano.
  return readFileSync(ruta, "utf8").replace(/schemaLocation="(\.\.\/)+common\//g, 'schemaLocation="');
}

const comunes = readdirSync(join(DIR, "common")).map((f) => ({ fileName: f, contents: leerXsd(join(DIR, "common", f)) }));

export async function validarXsd(xml: string, tipo: "DespatchAdvice" | "Invoice"): Promise<{ valido: boolean; errores: string[] }> {
  const principal = `UBL-${tipo}-2.1.xsd`;
  const resultado = await validateXML({
    xml: [{ fileName: "documento.xml", contents: xml }],
    schema: [{ fileName: principal, contents: leerXsd(join(DIR, "maindoc", principal)) }],
    preload: comunes,
  });
  return { valido: resultado.valid, errores: resultado.errors.map((e) => e.message) };
}
```

- [ ] **Step 5: Implementar el constructor de GRE-T**

`packages/sunat/src/ubl/gre-transportista.ts`:
```ts
import { ID_FIRMA } from "../firma";
import { decimal, escapeXml as x } from "../util";

export type TipoDocIdentidadSunat = "0" | "1" | "4" | "6" | "7";
export interface Parte { tipoDoc: TipoDocIdentidadSunat; numeroDoc: string; razonSocial: string }
export interface Direccion { ubigeo: string; direccion: string }

export interface DatosGreTransportista {
  emisor: { ruc: string; razonSocial: string; registroMtc: string };
  serie: string;
  numero: number;
  fechaEmision: string;
  horaEmision: string;
  fechaTraslado: string;
  remitente: Parte;
  destinatario: Parte;
  partida: Direccion;
  llegada: Direccion;
  pesoBruto: string;
  unidadPeso: "KGM" | "TNE";
  vehiculo: { placa: string };
  conductor: { tipoDoc: TipoDocIdentidadSunat; numeroDoc: string; nombres: string; apellidos: string; licencia: string };
  documentosRelacionados: Array<{ tipo: "01" | "09"; serieNumero: string; rucEmisor: string }>;
  items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }>;
}

const CAT = "urn:pe:gob:sunat:cpe:see:gem:catalogos";
const NOMBRE_DOC: Record<"01" | "09", string> = { "01": "Factura", "09": "Guía de Remisión Remitente" };

function idDoc(tipoDoc: string, numero: string): string {
  return `<cbc:ID schemeID="${x(tipoDoc)}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="${CAT}:catalogo06">${x(numero)}</cbc:ID>`;
}

function parte(p: Parte): string {
  return `<cac:Party>
      <cac:PartyIdentification>${idDoc(p.tipoDoc, p.numeroDoc)}</cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName>${x(p.razonSocial)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>`;
}

function direccion(etiqueta: "DeliveryAddress" | "DespatchAddress", d: Direccion): string {
  return `<cac:${etiqueta}>
        <cbc:ID schemeName="Ubigeos" schemeAgencyName="PE:INEI">${x(d.ubigeo)}</cbc:ID>
        <cac:AddressLine><cbc:Line>${x(d.direccion)}</cbc:Line></cac:AddressLine>
      </cac:${etiqueta}>`;
}

export function normalizarPlaca(placa: string): string {
  return placa.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function construirXmlGreTransportista(d: DatosGreTransportista): string {
  const relacionados = d.documentosRelacionados
    .map(
      (r) => `  <cac:AdditionalDocumentReference>
    <cbc:ID>${x(r.serieNumero)}</cbc:ID>
    <cbc:DocumentTypeCode listAgencyName="PE:SUNAT" listName="Documento relacionado al transporte" listURI="${CAT}:catalogo61">${r.tipo}</cbc:DocumentTypeCode>
    <cbc:DocumentType>${NOMBRE_DOC[r.tipo]}</cbc:DocumentType>
    <cac:IssuerParty><cac:PartyIdentification>${idDoc("6", r.rucEmisor)}</cac:PartyIdentification></cac:IssuerParty>
  </cac:AdditionalDocumentReference>`,
    )
    .join("\n");

  const lineas = d.items
    .map(
      (it, i) => `  <cac:DespatchLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:DeliveredQuantity unitCode="${x(it.unidadMedida)}" unitCodeListID="UN/ECE rec 20" unitCodeListAgencyName="United Nations Economic Commission for Europe">${decimal(it.cantidad, 2)}</cbc:DeliveredQuantity>
    <cac:OrderLineReference><cbc:LineID>${i + 1}</cbc:LineID></cac:OrderLineReference>
    <cac:Item>
      <cbc:Description>${x(it.descripcion)}</cbc:Description>
      <cac:AdditionalItemProperty>
        <cbc:Name>Indicador de bien regulado por SUNAT</cbc:Name>
        <cbc:NameCode listAgencyName="PE:SUNAT" listName="Propiedad del item" listURI="${CAT}:catalogo55">7022</cbc:NameCode>
        <cbc:Value>0</cbc:Value>
      </cac:AdditionalItemProperty>
    </cac:Item>
  </cac:DespatchLine>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID schemeAgencyName="PE:SUNAT">2.0</cbc:CustomizationID>
  <cbc:ID>${x(d.serie)}-${d.numero}</cbc:ID>
  <cbc:IssueDate>${d.fechaEmision}</cbc:IssueDate>
  <cbc:IssueTime>${d.horaEmision}</cbc:IssueTime>
  <cbc:DespatchAdviceTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="${CAT}:catalogo01">31</cbc:DespatchAdviceTypeCode>
${relacionados}
  <cac:Signature>
    <cbc:ID>${ID_FIRMA}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification><cbc:ID>${x(d.emisor.ruc)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${x(d.emisor.razonSocial)}</cbc:Name></cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#${ID_FIRMA}</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:DespatchSupplierParty>
    ${parte({ tipoDoc: "6", numeroDoc: d.emisor.ruc, razonSocial: d.emisor.razonSocial })}
  </cac:DespatchSupplierParty>
  <cac:DeliveryCustomerParty>
    ${parte(d.destinatario)}
  </cac:DeliveryCustomerParty>
  <cac:Shipment>
    <cbc:ID>SUNAT_Envio</cbc:ID>
    <cbc:GrossWeightMeasure unitCode="${d.unidadPeso}">${decimal(d.pesoBruto, 3)}</cbc:GrossWeightMeasure>
    <cac:ShipmentStage>
      <cac:TransitPeriod><cbc:StartDate>${d.fechaTraslado}</cbc:StartDate></cac:TransitPeriod>
      <cac:CarrierParty><cac:PartyLegalEntity><cbc:CompanyID>${x(d.emisor.registroMtc)}</cbc:CompanyID></cac:PartyLegalEntity></cac:CarrierParty>
      <cac:DriverPerson>
        ${idDoc(d.conductor.tipoDoc, d.conductor.numeroDoc)}
        <cbc:FirstName>${x(d.conductor.nombres)}</cbc:FirstName>
        <cbc:FamilyName>${x(d.conductor.apellidos)}</cbc:FamilyName>
        <cbc:JobTitle>Principal</cbc:JobTitle>
        <cac:IdentityDocumentReference><cbc:ID>${x(d.conductor.licencia)}</cbc:ID></cac:IdentityDocumentReference>
      </cac:DriverPerson>
    </cac:ShipmentStage>
    <cac:Delivery>
      ${direccion("DeliveryAddress", d.llegada)}
      <cac:Despatch>
        ${direccion("DespatchAddress", d.partida)}
        <cac:DespatchParty>
          <cac:PartyIdentification>${idDoc(d.remitente.tipoDoc, d.remitente.numeroDoc)}</cac:PartyIdentification>
          <cac:PartyLegalEntity><cbc:RegistrationName>${x(d.remitente.razonSocial)}</cbc:RegistrationName></cac:PartyLegalEntity>
        </cac:DespatchParty>
      </cac:Despatch>
    </cac:Delivery>
    <cac:TransportHandlingUnit>
      <cac:TransportEquipment><cbc:ID>${x(normalizarPlaca(d.vehiculo.placa))}</cbc:ID></cac:TransportEquipment>
    </cac:TransportHandlingUnit>
  </cac:Shipment>
${lineas}
</DespatchAdvice>`;
}
```

Añadir a `packages/sunat/src/index.ts`:
```ts
export * from "./xsd";
export * from "./ubl/gre-transportista";
```

- [ ] **Step 6: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/sunat`
Expected: PASS. Si el test XSD falla, imprimir `resultado.errores`, corregir el orden o el contenido del elemento señalado en el XML (nunca editar los XSD) y volver a ejecutar.

- [ ] **Step 7: Commit**

```bash
git add packages/sunat pnpm-lock.yaml
git commit -m "feat(sunat): XML de guía transportista (tipo 31) validado contra XSD UBL 2.1"
```

---

### Task 6: SUNAT — XML de factura (detracción, contado/crédito) y monto en letras

**Files:**
- Create: `packages/sunat/src/letras.ts`, `packages/sunat/src/ubl/factura.ts`
- Modify: `packages/sunat/src/index.ts`, `packages/sunat/test/datos-prueba.ts`
- Test: `packages/sunat/test/letras.test.ts`, `packages/sunat/test/factura.test.ts`

**Interfaces:**
- Consumes: `Parte` (Task 5), `firmarXml`, `ID_FIRMA`, `escapeXml`, `centimosADecimal` (Task 4), `validarXsd` (Task 5)
- Produces:
  - `montoEnLetras(centimos: number): string` → `"SON: MIL CIENTO OCHENTA CON 00/100 SOLES"`
  - `CODIGO_DETRACCION_TRANSPORTE = "027"`
  - `interface DatosFactura { emisor: { ruc: string; razonSocial: string; nombreComercial?: string; ubigeo: string; direccion: string; cuentaDetraccion?: string }; serie: string; numero: number; fechaEmision: string; horaEmision: string; cliente: Parte & { direccion?: string }; descripcion: string; montos: { subtotal: number; igv: number; total: number; detraccionPorcentaje: number | null; detraccionMonto: number }; formaPago: { tipo: "contado" } | { tipo: "credito"; fechaVencimiento: string }; guiasRelacionadas: string[] }`
  - `construirXmlFactura(d: DatosFactura): string` (sin firmar)
  - Test helper `datosFacturaPrueba(): DatosFactura`

- [ ] **Step 1: Escribir el test de letras que falla**

`packages/sunat/test/letras.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { montoEnLetras } from "../src/letras";

describe("montoEnLetras", () => {
  it.each([
    [118000, "SON: MIL CIENTO OCHENTA CON 00/100 SOLES"],
    [150050, "SON: MIL QUINIENTOS CON 50/100 SOLES"],
    [2100000, "SON: VEINTIUN MIL CON 00/100 SOLES"],
    [100000000, "SON: UN MILLON CON 00/100 SOLES"],
    [10000, "SON: CIEN CON 00/100 SOLES"],
    [10100, "SON: CIENTO UNO CON 00/100 SOLES"],
    [5, "SON: CERO CON 05/100 SOLES"],
    [253045099, "SON: DOS MILLONES QUINIENTOS TREINTA MIL CUATROCIENTOS CINCUENTA CON 99/100 SOLES"],
  ])("%i → %s", (centimos, esperado) => {
    expect(montoEnLetras(centimos)).toBe(esperado);
  });
});
```

Run: `pnpm vitest run packages/sunat/test/letras.test.ts`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 2: Implementar letras**

`packages/sunat/src/letras.ts`:
```ts
const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const DIEZ_A_VEINTINUEVE = [
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
  "VEINTE", "VEINTIUNO", "VEINTIDOS", "VEINTITRES", "VEINTICUATRO", "VEINTICINCO", "VEINTISEIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function decenas(n: number): string {
  if (n < 10) return UNIDADES[n]!;
  if (n < 30) return DIEZ_A_VEINTINUEVE[n - 10]!;
  const u = n % 10;
  return DECENAS[Math.floor(n / 10)]! + (u ? ` Y ${UNIDADES[u]}` : "");
}

function menorMil(n: number): string {
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const r = n % 100;
  return [c ? CENTENAS[c] : "", r ? decenas(r) : ""].filter(Boolean).join(" ");
}

const apocope = (s: string) => s.replace(/UNO$/, "UN");

function enteroALetras(n: number): string {
  if (n === 0) return "CERO";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor(n / 1000) % 1000;
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLON" : `${apocope(menorMil(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${apocope(menorMil(miles))} MIL`);
  if (resto) partes.push(menorMil(resto));
  return partes.join(" ");
}

export function montoEnLetras(centimos: number): string {
  const soles = Math.floor(centimos / 100);
  const cent = String(centimos % 100).padStart(2, "0");
  return `SON: ${enteroALetras(soles)} CON ${cent}/100 SOLES`;
}
```

Run: `pnpm vitest run packages/sunat/test/letras.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: Agregar datos de prueba y el test de factura que falla**

Añadir al final de `packages/sunat/test/datos-prueba.ts`:
```ts
import type { DatosFactura } from "../src/ubl/factura";

export function datosFacturaPrueba(): DatosFactura {
  return {
    emisor: { ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", ubigeo: "150115", direccion: "AV. DEMO 123", cuentaDetraccion: "00-045-091619" },
    serie: "F001",
    numero: 1,
    fechaEmision: "2026-09-13",
    horaEmision: "11:00:00",
    cliente: { tipoDoc: "6", numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA & CIA S.A.C.", direccion: "AV. LIMA 456" },
    descripcion: "SERVICIO DE TRANSPORTE DE CARGA SEGUN GRE V001-1",
    montos: { subtotal: 100000, igv: 18000, total: 118000, detraccionPorcentaje: 4, detraccionMonto: 4700 },
    formaPago: { tipo: "contado" },
    guiasRelacionadas: ["V001-1"],
  };
}
```
(Mover el `import type` junto a los otros imports al inicio del archivo.)

`packages/sunat/test/factura.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { cargarPfx, generarCertificadoPrueba, type Certificado } from "../src/certificado";
import { firmarXml } from "../src/firma";
import { construirXmlFactura } from "../src/ubl/factura";
import { validarXsd } from "../src/xsd";
import { datosFacturaPrueba } from "./datos-prueba";

let cert: Certificado;
beforeAll(() => {
  cert = cargarPfx(generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "x" }), "x");
});

describe("construirXmlFactura", () => {
  it("con detracción usa operación 1001, código 027, cuenta y leyendas", () => {
    const xml = construirXmlFactura(datosFacturaPrueba());
    expect(xml).toContain('<cbc:InvoiceTypeCode listID="1001"');
    expect(xml).toContain('<cbc:Note languageLocaleID="1000">SON: MIL CIENTO OCHENTA CON 00/100 SOLES</cbc:Note>');
    expect(xml).toContain('<cbc:Note languageLocaleID="2006">Operación sujeta a detracción</cbc:Note>');
    expect(xml).toContain("<cbc:ID>00-045-091619</cbc:ID>");
    expect(xml).toContain('catalogo54">027</cbc:PaymentMeansID>');
    expect(xml).toContain("<cbc:PaymentPercent>4.00</cbc:PaymentPercent>");
    expect(xml).toContain('<cbc:Amount currencyID="PEN">47.00</cbc:Amount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="PEN">1180.00</cbc:PayableAmount>');
    expect(xml).toContain('catalogo01">31</cbc:DocumentTypeCode>');
    expect(xml).toContain("<cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>");
  });

  it("sin detracción usa operación 0101 y no incluye nodos de detracción", () => {
    const d = datosFacturaPrueba();
    d.montos = { subtotal: 8475, igv: 1525, total: 10000, detraccionPorcentaje: null, detraccionMonto: 0 };
    const xml = construirXmlFactura(d);
    expect(xml).toContain('<cbc:InvoiceTypeCode listID="0101"');
    expect(xml).not.toContain("Detraccion");
  });

  it("a crédito declara una cuota por el neto de detracción", () => {
    const d = datosFacturaPrueba();
    d.formaPago = { tipo: "credito", fechaVencimiento: "2026-10-13" };
    const xml = construirXmlFactura(d);
    expect(xml).toContain("<cbc:PaymentMeansID>Credito</cbc:PaymentMeansID>");
    expect(xml).toContain("<cbc:PaymentMeansID>Cuota001</cbc:PaymentMeansID>");
    expect(xml).toContain('<cbc:Amount currencyID="PEN">1133.00</cbc:Amount>');
    expect(xml).toContain("<cbc:PaymentDueDate>2026-10-13</cbc:PaymentDueDate>");
  });

  it("falla si hay detracción sin cuenta del Banco de la Nación", () => {
    const d = datosFacturaPrueba();
    delete d.emisor.cuentaDetraccion;
    expect(() => construirXmlFactura(d)).toThrow("cuenta de detracciones");
  });

  it.each(["contado", "credito"] as const)("firmada cumple el XSD UBL Invoice 2.1 (%s)", async (tipo) => {
    const d = datosFacturaPrueba();
    d.formaPago = tipo === "contado" ? { tipo } : { tipo, fechaVencimiento: "2026-10-13" };
    const resultado = await validarXsd(firmarXml(construirXmlFactura(d), cert), "Invoice");
    expect(resultado.errores).toEqual([]);
  });
});
```

Run: `pnpm vitest run packages/sunat/test/factura.test.ts`
Expected: FAIL — `../src/ubl/factura` no existe.

- [ ] **Step 4: Implementar el constructor de factura**

`packages/sunat/src/ubl/factura.ts`:
```ts
import { ID_FIRMA } from "../firma";
import { montoEnLetras } from "../letras";
import { centimosADecimal as m, escapeXml as x } from "../util";
import type { Parte } from "./gre-transportista";

export const CODIGO_DETRACCION_TRANSPORTE = "027";

export interface DatosFactura {
  emisor: { ruc: string; razonSocial: string; nombreComercial?: string; ubigeo: string; direccion: string; cuentaDetraccion?: string };
  serie: string;
  numero: number;
  fechaEmision: string;
  horaEmision: string;
  cliente: Parte & { direccion?: string };
  descripcion: string;
  montos: { subtotal: number; igv: number; total: number; detraccionPorcentaje: number | null; detraccionMonto: number };
  formaPago: { tipo: "contado" } | { tipo: "credito"; fechaVencimiento: string };
  guiasRelacionadas: string[];
}

const CAT = "urn:pe:gob:sunat:cpe:see:gem:catalogos";
const PEN = 'currencyID="PEN"';

function tributoIgv(): string {
  return `<cac:TaxScheme>
            <cbc:ID schemeName="Codigo de tributos" schemeAgencyName="PE:SUNAT" schemeURI="${CAT}:catalogo05">1000</cbc:ID>
            <cbc:Name>IGV</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>`;
}

export function construirXmlFactura(d: DatosFactura): string {
  const { montos } = d;
  const conDetraccion = montos.detraccionMonto > 0 && montos.detraccionPorcentaje !== null;
  if (conDetraccion && !d.emisor.cuentaDetraccion) {
    throw new Error("Falta la cuenta de detracciones del Banco de la Nación de la empresa");
  }
  const neto = montos.total - montos.detraccionMonto;

  const guias = d.guiasRelacionadas
    .map(
      (g) => `  <cac:DespatchDocumentReference>
    <cbc:ID>${x(g)}</cbc:ID>
    <cbc:DocumentTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="${CAT}:catalogo01">31</cbc:DocumentTypeCode>
  </cac:DespatchDocumentReference>`,
    )
    .join("\n");

  const direccionCliente = d.cliente.direccion
    ? `<cac:RegistrationAddress><cac:AddressLine><cbc:Line>${x(d.cliente.direccion)}</cbc:Line></cac:AddressLine></cac:RegistrationAddress>`
    : "";

  const medioDetraccion = conDetraccion
    ? `  <cac:PaymentMeans>
    <cbc:ID>Detraccion</cbc:ID>
    <cbc:PaymentMeansCode listAgencyName="PE:SUNAT" listName="Medio de pago" listURI="${CAT}:catalogo59">001</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>${x(d.emisor.cuentaDetraccion!)}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
    : "";

  const terminosDetraccion = conDetraccion
    ? `  <cac:PaymentTerms>
    <cbc:ID>Detraccion</cbc:ID>
    <cbc:PaymentMeansID schemeName="Codigo de detraccion" schemeAgencyName="PE:SUNAT" schemeURI="${CAT}:catalogo54">${CODIGO_DETRACCION_TRANSPORTE}</cbc:PaymentMeansID>
    <cbc:PaymentPercent>${montos.detraccionPorcentaje!.toFixed(2)}</cbc:PaymentPercent>
    <cbc:Amount ${PEN}>${m(montos.detraccionMonto)}</cbc:Amount>
  </cac:PaymentTerms>`
    : "";

  const formaPago =
    d.formaPago.tipo === "contado"
      ? `  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>
  </cac:PaymentTerms>`
      : `  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Credito</cbc:PaymentMeansID>
    <cbc:Amount ${PEN}>${m(neto)}</cbc:Amount>
  </cac:PaymentTerms>
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Cuota001</cbc:PaymentMeansID>
    <cbc:Amount ${PEN}>${m(neto)}</cbc:Amount>
    <cbc:PaymentDueDate>${d.formaPago.fechaVencimiento}</cbc:PaymentDueDate>
  </cac:PaymentTerms>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID schemeAgencyName="PE:SUNAT">2.0</cbc:CustomizationID>
  <cbc:ID>${x(d.serie)}-${d.numero}</cbc:ID>
  <cbc:IssueDate>${d.fechaEmision}</cbc:IssueDate>
  <cbc:IssueTime>${d.horaEmision}</cbc:IssueTime>
  <cbc:InvoiceTypeCode listID="${conDetraccion ? "1001" : "0101"}" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="${CAT}:catalogo01">01</cbc:InvoiceTypeCode>
  <cbc:Note languageLocaleID="1000">${montoEnLetras(montos.total)}</cbc:Note>
${conDetraccion ? '  <cbc:Note languageLocaleID="2006">Operación sujeta a detracción</cbc:Note>' : ""}
  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha" listAgencyName="United Nations Economic Commission for Europe" listName="Currency">PEN</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>1</cbc:LineCountNumeric>
${guias}
  <cac:Signature>
    <cbc:ID>${ID_FIRMA}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification><cbc:ID>${x(d.emisor.ruc)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${x(d.emisor.razonSocial)}</cbc:Name></cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#${ID_FIRMA}</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="${CAT}:catalogo06">${x(d.emisor.ruc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${x(d.emisor.nombreComercial ?? d.emisor.razonSocial)}</cbc:Name></cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${x(d.emisor.razonSocial)}</cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:ID schemeName="Ubigeos" schemeAgencyName="PE:INEI">${x(d.emisor.ubigeo)}</cbc:ID>
          <cbc:AddressTypeCode listAgencyName="PE:SUNAT" listName="Establecimientos anexos">0000</cbc:AddressTypeCode>
          <cac:AddressLine><cbc:Line>${x(d.emisor.direccion)}</cbc:Line></cac:AddressLine>
          <cac:Country><cbc:IdentificationCode listID="ISO 3166-1" listAgencyName="United Nations Economic Commission for Europe" listName="Country">PE</cbc:IdentificationCode></cac:Country>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${x(d.cliente.tipoDoc)}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="${CAT}:catalogo06">${x(d.cliente.numeroDoc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${x(d.cliente.razonSocial)}</cbc:RegistrationName>
        ${direccionCliente}
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
${medioDetraccion}
${formaPago}
${terminosDetraccion}
  <cac:TaxTotal>
    <cbc:TaxAmount ${PEN}>${m(montos.igv)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount ${PEN}>${m(montos.subtotal)}</cbc:TaxableAmount>
      <cbc:TaxAmount ${PEN}>${m(montos.igv)}</cbc:TaxAmount>
      <cac:TaxCategory>
          ${tributoIgv()}
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount ${PEN}>${m(montos.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount ${PEN}>${m(montos.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount ${PEN}>${m(montos.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="ZZ" unitCodeListID="UN/ECE rec 20" unitCodeListAgencyName="United Nations Economic Commission for Europe">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount ${PEN}>${m(montos.subtotal)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount ${PEN}>${m(montos.total)}</cbc:PriceAmount>
        <cbc:PriceTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Precio" listURI="${CAT}:catalogo16">01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount ${PEN}>${m(montos.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount ${PEN}>${m(montos.subtotal)}</cbc:TaxableAmount>
        <cbc:TaxAmount ${PEN}>${m(montos.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>18.00</cbc:Percent>
          <cbc:TaxExemptionReasonCode listAgencyName="PE:SUNAT" listName="Afectacion del IGV" listURI="${CAT}:catalogo07">10</cbc:TaxExemptionReasonCode>
          ${tributoIgv()}
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>${x(d.descripcion)}</cbc:Description>
      <cac:SellersItemIdentification><cbc:ID>FLETE</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount ${PEN}>${m(montos.subtotal)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;
}
```

Añadir a `packages/sunat/src/index.ts`:
```ts
export * from "./letras";
export * from "./ubl/factura";
```

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/sunat`
Expected: PASS. Si el XSD reporta un error de orden, reubicar el elemento según `packages/sunat/xsd/2.1/common/UBL-CommonAggregateComponents-2.1.xsd` y reintentar.

- [ ] **Step 6: Commit**

```bash
git add packages/sunat
git commit -m "feat(sunat): XML de factura con detracción, contado/crédito y monto en letras"
```

---

### Task 7: SUNAT — contrato del gateway, ZIP, CDR y SUNAT simulado

**Files:**
- Create: `packages/sunat/src/tipos.ts`, `src/zip.ts`, `src/cdr.ts`, `src/simulado.ts`
- Modify: `packages/sunat/src/index.ts`
- Test: `packages/sunat/test/simulado.test.ts`

**Interfaces:**
- Produces:
  - `type EstadoRespuesta = "aceptada" | "observada" | "rechazada" | "en_proceso"`
  - `interface RespuestaSunat { estado: EstadoRespuesta; codigo: string; mensaje: string; notas: string[]; cdrZip?: Buffer; urlQr?: string }`
  - `interface DocumentoFirmado { nombreArchivo: string; xml: string }` (nombre sin extensión)
  - `interface SunatGateway { enviarGuia(doc: DocumentoFirmado): Promise<{ ticket: string }>; consultarTicket(ticket: string): Promise<RespuestaSunat>; enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat> }`
  - `class SunatNoDisponibleError extends Error` — red caída, timeout o HTTP 5xx: el llamador debe reintentar más tarde
  - `nombreArchivo(ruc: string, tipo: "01" | "31", serie: string, numero: number): string`
  - `zipArchivo(nombre: string, contenido: string | Buffer): Promise<Buffer>`, `leerXmlDeZip(zip: Buffer): Promise<string>` (soporta ZIP anidado)
  - `leerCdr(xml: string): RespuestaSunat`, `leerCdrZip(zip: Buffer): Promise<RespuestaSunat>`
  - `class SunatSimulado implements SunatGateway` con `constructor(o?: { demoraMs?: number; rechazo?: { codigo: string; mensaje: string }; ahora?: () => number })`

> Adaptado de `sunat-cli/.../cpe/soap/zip.ts` y `cdr.ts` (MIT).

- [ ] **Step 1: Instalar dependencias**

Run: `pnpm --filter @sunatapp/sunat add yazl yauzl fast-xml-parser`
Run: `pnpm --filter @sunatapp/sunat add -D @types/yazl @types/yauzl`

- [ ] **Step 2: Escribir el test que falla**

`packages/sunat/test/simulado.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { leerCdr } from "../src/cdr";
import { SunatSimulado } from "../src/simulado";
import { nombreArchivo } from "../src/tipos";
import { leerXmlDeZip, zipArchivo } from "../src/zip";

describe("zip", () => {
  it("lee el XML de un ZIP simple y de uno anidado", async () => {
    const simple = await zipArchivo("R-a.xml", "<x>1</x>");
    expect(await leerXmlDeZip(simple)).toBe("<x>1</x>");
    const anidado = await zipArchivo("R-a.zip", simple);
    expect(await leerXmlDeZip(anidado)).toBe("<x>1</x>");
  });
});

describe("leerCdr", () => {
  const cdr = (codigo: string, notas = "") => `<?xml version="1.0"?>
<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  ${notas}
  <cac:DocumentResponse>
    <cac:Response><cbc:ResponseCode>${codigo}</cbc:ResponseCode><cbc:Description>Mensaje ${codigo}</cbc:Description></cac:Response>
    <cac:DocumentReference><cbc:ID>V001-1</cbc:ID><cbc:DocumentDescription>https://qr.sunat/abc</cbc:DocumentDescription></cac:DocumentReference>
  </cac:DocumentResponse>
</ar:ApplicationResponse>`;

  it("0 es aceptada y extrae la URL del QR", () => {
    expect(leerCdr(cdr("0"))).toMatchObject({ estado: "aceptada", codigo: "0", mensaje: "Mensaje 0", urlQr: "https://qr.sunat/abc" });
  });
  it("con notas es observada", () => {
    expect(leerCdr(cdr("0", "<cbc:Note>4252 - aviso</cbc:Note>"))).toMatchObject({ estado: "observada", notas: ["4252 - aviso"] });
  });
  it("2xxx es rechazada", () => {
    expect(leerCdr(cdr("2800")).estado).toBe("rechazada");
  });
});

describe("SunatSimulado", () => {
  it("la guía queda en proceso durante la demora y luego se acepta con CDR", async () => {
    let reloj = 1_000;
    const sunat = new SunatSimulado({ demoraMs: 3000, ahora: () => reloj });
    const nombre = nombreArchivo("20606433094", "31", "V001", 1);
    expect(nombre).toBe("20606433094-31-V001-1");
    const { ticket } = await sunat.enviarGuia({ nombreArchivo: nombre, xml: "<x/>" });
    expect((await sunat.consultarTicket(ticket)).estado).toBe("en_proceso");
    reloj += 3000;
    const r = await sunat.consultarTicket(ticket);
    expect(r.estado).toBe("aceptada");
    expect(r.cdrZip).toBeInstanceOf(Buffer);
    expect(r.urlQr).toContain("SIMULADO");
  });

  it("es sin estado: otra instancia puede consultar el ticket", async () => {
    const { ticket } = await new SunatSimulado({ demoraMs: 0 }).enviarGuia({ nombreArchivo: "20606433094-31-V001-2", xml: "<x/>" });
    expect((await new SunatSimulado({ demoraMs: 0 }).consultarTicket(ticket)).estado).toBe("aceptada");
  });

  it("puede forzar rechazo", async () => {
    const sunat = new SunatSimulado({ demoraMs: 0, rechazo: { codigo: "2556", mensaje: "Placa inválida" } });
    const { ticket } = await sunat.enviarGuia({ nombreArchivo: "20606433094-31-V001-3", xml: "<x/>" });
    expect(await sunat.consultarTicket(ticket)).toMatchObject({ estado: "rechazada", codigo: "2556", mensaje: "Placa inválida" });
    expect((await sunat.enviarFactura({ nombreArchivo: "20606433094-01-F001-1", xml: "<x/>" })).estado).toBe("rechazada");
  });

  it("acepta facturas al instante", async () => {
    const r = await new SunatSimulado().enviarFactura({ nombreArchivo: "20606433094-01-F001-1", xml: "<x/>" });
    expect(r).toMatchObject({ estado: "aceptada", codigo: "0" });
  });
});
```

Run: `pnpm vitest run packages/sunat/test/simulado.test.ts`
Expected: FAIL — módulos no encontrados.

- [ ] **Step 3: Implementar tipos, zip y CDR**

`packages/sunat/src/tipos.ts`:
```ts
export type EstadoRespuesta = "aceptada" | "observada" | "rechazada" | "en_proceso";

export interface RespuestaSunat {
  estado: EstadoRespuesta;
  codigo: string;
  mensaje: string;
  notas: string[];
  cdrZip?: Buffer;
  urlQr?: string;
}

export interface DocumentoFirmado {
  nombreArchivo: string;
  xml: string;
}

export interface SunatGateway {
  enviarGuia(doc: DocumentoFirmado): Promise<{ ticket: string }>;
  consultarTicket(ticket: string): Promise<RespuestaSunat>;
  enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat>;
}

export class SunatNoDisponibleError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SunatNoDisponibleError";
  }
}

export function nombreArchivo(ruc: string, tipo: "01" | "31", serie: string, numero: number): string {
  return `${ruc}-${tipo}-${serie}-${numero}`;
}
```

`packages/sunat/src/zip.ts`:
```ts
import yauzl from "yauzl";
import yazl from "yazl";

function aBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    stream.on("data", (c: Buffer) => partes.push(c));
    stream.on("end", () => resolve(Buffer.concat(partes)));
    stream.on("error", reject);
  });
}

export async function zipArchivo(nombre: string, contenido: string | Buffer): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  zip.addBuffer(typeof contenido === "string" ? Buffer.from(contenido, "utf8") : contenido, nombre);
  zip.end();
  return aBuffer(zip.outputStream as unknown as NodeJS.ReadableStream);
}

function primeraEntrada(zip: Buffer, acepta: (nombre: string) => boolean): Promise<{ nombre: string; contenido: Buffer }> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, archivo) => {
      if (err || !archivo) return reject(err ?? new Error("ZIP vacío"));
      let encontrado = false;
      archivo.on("entry", (entrada: yauzl.Entry) => {
        if (entrada.fileName.endsWith("/") || !acepta(entrada.fileName)) return archivo.readEntry();
        archivo.openReadStream(entrada, (err2, stream) => {
          if (err2 || !stream) return reject(err2 ?? new Error("No se pudo leer el ZIP"));
          encontrado = true;
          aBuffer(stream).then((contenido) => resolve({ nombre: entrada.fileName, contenido }), reject);
        });
      });
      archivo.on("end", () => {
        if (!encontrado) reject(new Error("El ZIP no contiene XML"));
      });
      archivo.on("error", reject);
      archivo.readEntry();
    });
  });
}

export async function leerXmlDeZip(zip: Buffer): Promise<string> {
  const externo = await primeraEntrada(zip, (n) => /\.(xml|zip)$/i.test(n));
  if (/\.xml$/i.test(externo.nombre)) return externo.contenido.toString("utf8");
  const interno = await primeraEntrada(externo.contenido, (n) => /\.xml$/i.test(n));
  return interno.contenido.toString("utf8");
}
```

`packages/sunat/src/cdr.ts`:
```ts
import { XMLParser } from "fast-xml-parser";
import type { RespuestaSunat } from "./tipos";
import { leerXmlDeZip } from "./zip";

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, isArray: (n) => n === "Note" });

export function leerCdr(xml: string): RespuestaSunat {
  const raiz = parser.parse(xml).ApplicationResponse ?? {};
  const docResp = raiz.DocumentResponse ?? {};
  const resp = docResp.Response ?? {};
  const codigo = String(resp.ResponseCode ?? "");
  const notas: string[] = (raiz.Note ?? []).map(String);
  const numero = Number.parseInt(codigo, 10);
  const estado = Number.isNaN(numero) || numero >= 2000 ? "rechazada" : notas.length > 0 ? "observada" : "aceptada";
  const urlQr = docResp.DocumentReference?.DocumentDescription;
  return { estado, codigo, mensaje: String(resp.Description ?? ""), notas, ...(urlQr ? { urlQr: String(urlQr) } : {}) };
}

export async function leerCdrZip(zip: Buffer): Promise<RespuestaSunat> {
  return { ...leerCdr(await leerXmlDeZip(zip)), cdrZip: zip };
}
```

- [ ] **Step 4: Implementar SUNAT simulado**

`packages/sunat/src/simulado.ts`:
```ts
import { leerCdrZip } from "./cdr";
import type { DocumentoFirmado, RespuestaSunat, SunatGateway } from "./tipos";
import { zipArchivo } from "./zip";

export interface OpcionesSimulado {
  demoraMs?: number;
  rechazo?: { codigo: string; mensaje: string };
  ahora?: () => number;
}

export class SunatSimulado implements SunatGateway {
  private readonly demoraMs: number;
  private readonly ahora: () => number;

  constructor(private readonly o: OpcionesSimulado = {}) {
    this.demoraMs = o.demoraMs ?? 3000;
    this.ahora = o.ahora ?? Date.now;
  }

  async enviarGuia(doc: DocumentoFirmado): Promise<{ ticket: string }> {
    // El ticket codifica nombre y hora: no hace falta memoria y sobrevive reinicios.
    return { ticket: `SIM.${this.ahora()}.${doc.nombreArchivo}` };
  }

  async consultarTicket(ticket: string): Promise<RespuestaSunat> {
    const m = ticket.match(/^SIM\.(\d+)\.(.+)$/);
    if (!m) throw new Error(`Ticket simulado inválido: ${ticket}`);
    if (this.ahora() - Number(m[1]) < this.demoraMs) {
      return { estado: "en_proceso", codigo: "0098", mensaje: "En proceso", notas: [] };
    }
    return this.responder(m[2]!, true);
  }

  async enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat> {
    return this.responder(doc.nombreArchivo, false);
  }

  private async responder(nombre: string, esGuia: boolean): Promise<RespuestaSunat> {
    if (this.o.rechazo) return { estado: "rechazada", codigo: this.o.rechazo.codigo, mensaje: this.o.rechazo.mensaje, notas: [] };
    const serieNumero = nombre.split("-").slice(2).join("-");
    const url = esGuia ? `<cbc:DocumentDescription>https://simulado.local/qr?doc=SIMULADO-${nombre}</cbc:DocumentDescription>` : "";
    const cdr = `<?xml version="1.0" encoding="UTF-8"?>
<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>SIMULADO</cbc:ID>
  <cac:DocumentResponse>
    <cac:Response><cbc:ResponseCode>0</cbc:ResponseCode><cbc:Description>(SIMULADO) El comprobante ${serieNumero} ha sido aceptado</cbc:Description></cac:Response>
    <cac:DocumentReference><cbc:ID>${serieNumero}</cbc:ID>${url}</cac:DocumentReference>
  </cac:DocumentResponse>
</ar:ApplicationResponse>`;
    return leerCdrZip(await zipArchivo(`R-${nombre}.xml`, cdr));
  }
}
```

Añadir a `packages/sunat/src/index.ts`:
```ts
export * from "./tipos";
export * from "./zip";
export * from "./cdr";
export * from "./simulado";
```

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/sunat`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sunat pnpm-lock.yaml
git commit -m "feat(sunat): contrato de gateway, lectura de CDR y SUNAT simulado sin estado"
```

---

### Task 8: SUNAT — gateway real (OAuth + GRE REST + SOAP sendBill) y gateway mixto

**Files:**
- Create: `packages/sunat/src/real.ts`, `packages/sunat/src/mixto.ts`
- Modify: `packages/sunat/src/index.ts`
- Test: `packages/sunat/test/real.test.ts`

**Interfaces:**
- Consumes: `SunatGateway`, `RespuestaSunat`, `DocumentoFirmado`, `SunatNoDisponibleError`, `zipArchivo`, `leerCdrZip` (Task 7)
- Produces:
  - `interface CredencialesSunat { ruc: string; usuarioSol: string; claveSol: string; greClientId?: string; greClientSecret?: string; ambienteFactura: "beta" | "produccion" }`
  - `ENDPOINTS_FACTURA: Record<"beta" | "produccion", string>`
  - `class SunatReal implements SunatGateway` con `constructor(cred: CredencialesSunat, o?: { fetch?: typeof fetch })`
  - `class SunatMixto implements SunatGateway` con `constructor(guias: SunatGateway, facturas: SunatGateway)`

> Endpoints y formato tomados de `sunat-cli/.../sunat-rest/oauth.ts`, `sunat-rest/gre.ts` y `cpe/soap/client.ts` (MIT). En beta SUNAT usa usuario `MODDATOS` / clave `moddatos`.

- [ ] **Step 1: Escribir el test que falla (con `fetch` falso)**

`packages/sunat/test/real.test.ts`:
```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SunatMixto } from "../src/mixto";
import { ENDPOINTS_FACTURA, SunatReal, type CredencialesSunat } from "../src/real";
import { SunatSimulado } from "../src/simulado";
import { SunatNoDisponibleError } from "../src/tipos";
import { leerXmlDeZip, zipArchivo } from "../src/zip";

const cred: CredencialesSunat = {
  ruc: "20606433094", usuarioSol: "USUARIO1", claveSol: "clave1",
  greClientId: "cid", greClientSecret: "csecret", ambienteFactura: "beta",
};

const CDR_OK = `<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cac:DocumentResponse><cac:Response><cbc:ResponseCode>0</cbc:ResponseCode><cbc:Description>Aceptado</cbc:Description></cac:Response></cac:DocumentResponse></ar:ApplicationResponse>`;

type Llamada = { url: string; init: RequestInit };

function fetchFalso(respuestas: Array<(l: Llamada) => Response | Promise<Response>>) {
  const llamadas: Llamada[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    const llamada = { url: String(url), init };
    llamadas.push(llamada);
    const siguiente = respuestas.shift();
    if (!siguiente) throw new Error(`Llamada inesperada a ${url}`);
    return siguiente(llamada);
  }) as typeof fetch;
  return { fn, llamadas };
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const token = () => json({ access_token: "TOKEN1", expires_in: 3600 });

describe("SunatReal — guías", () => {
  it("pide token con password grant y envía el ZIP con hash SHA-256", async () => {
    const { fn, llamadas } = fetchFalso([token, () => json({ numTicket: "T-1" })]);
    const sunat = new SunatReal(cred, { fetch: fn });
    const r = await sunat.enviarGuia({ nombreArchivo: "20606433094-31-V001-1", xml: "<guia/>" });
    expect(r).toEqual({ ticket: "T-1" });

    expect(llamadas[0]!.url).toBe("https://api-seguridad.sunat.gob.pe/v1/clientessol/cid/oauth2/token/");
    const form = new URLSearchParams(String(llamadas[0]!.init.body));
    expect(form.get("grant_type")).toBe("password");
    expect(form.get("username")).toBe("20606433094USUARIO1");
    expect(form.get("scope")).toBe("https://api-cpe.sunat.gob.pe");

    expect(llamadas[1]!.url).toBe("https://api-cpe.sunat.gob.pe/v1/contribuyente/gem/comprobantes/20606433094-31-V001-1");
    const cuerpo = JSON.parse(String(llamadas[1]!.init.body));
    const zip = Buffer.from(cuerpo.archivo.arcGreZip, "base64");
    expect(cuerpo.archivo.nomArchivo).toBe("20606433094-31-V001-1.zip");
    expect(cuerpo.archivo.hashZip).toBe(createHash("sha256").update(zip).digest("hex"));
    expect(await leerXmlDeZip(zip)).toBe("<guia/>");
    expect((llamadas[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN1");
  });

  it("reutiliza el token y lo renueva ante 401", async () => {
    const { fn, llamadas } = fetchFalso([
      token,
      () => json({ numTicket: "T-1" }),
      () => new Response("", { status: 401 }),
      () => json({ access_token: "TOKEN2", expires_in: 3600 }),
      () => json({ numTicket: "T-2" }),
    ]);
    const sunat = new SunatReal(cred, { fetch: fn });
    await sunat.enviarGuia({ nombreArchivo: "a", xml: "<a/>" });
    expect(await sunat.enviarGuia({ nombreArchivo: "b", xml: "<b/>" })).toEqual({ ticket: "T-2" });
    expect(llamadas.filter((l) => l.url.includes("oauth2")).length).toBe(2);
  });

  it("consultarTicket: 0098 en proceso, 0001 aceptada con CDR, 0003 rechazada con error", async () => {
    const cdrZip = (await zipArchivo("R-x.xml", CDR_OK)).toString("base64");
    const { fn } = fetchFalso([
      token,
      () => json({ codRespuesta: "0098" }),
      () => json({ codRespuesta: "0001", indCdrGenerado: "1", arcCdr: cdrZip }),
      () => json({ codRespuesta: "0003", error: { numError: "2556", desError: "Placa no válida" } }),
    ]);
    const sunat = new SunatReal(cred, { fetch: fn });
    expect((await sunat.consultarTicket("T")).estado).toBe("en_proceso");
    expect(await sunat.consultarTicket("T")).toMatchObject({ estado: "aceptada", codigo: "0" });
    expect(await sunat.consultarTicket("T")).toMatchObject({ estado: "rechazada", codigo: "2556", mensaje: "Placa no válida" });
  });

  it("error de red o HTTP 5xx se reporta como SUNAT no disponible", async () => {
    const caida = fetchFalso([() => { throw new TypeError("fetch failed"); }]);
    await expect(new SunatReal(cred, { fetch: caida.fn }).enviarGuia({ nombreArchivo: "a", xml: "<a/>" })).rejects.toBeInstanceOf(SunatNoDisponibleError);
    const http500 = fetchFalso([token, () => new Response("boom", { status: 503 })]);
    await expect(new SunatReal(cred, { fetch: http500.fn }).enviarGuia({ nombreArchivo: "a", xml: "<a/>" })).rejects.toBeInstanceOf(SunatNoDisponibleError);
  });

  it("sin credenciales GRE falla con mensaje claro", async () => {
    const sunat = new SunatReal({ ...cred, greClientId: undefined }, { fetch: fetchFalso([]).fn });
    await expect(sunat.enviarGuia({ nombreArchivo: "a", xml: "<a/>" })).rejects.toThrow("credenciales API SUNAT");
  });
});

describe("SunatReal — facturas (SOAP)", () => {
  it("envía sendBill al endpoint beta con WS-Security y lee el CDR", async () => {
    const cdr = (await zipArchivo("R-f.xml", CDR_OK)).toString("base64");
    const { fn, llamadas } = fetchFalso([
      () => new Response(`<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/"><soap-env:Body><br:sendBillResponse xmlns:br="http://service.sunat.gob.pe"><applicationResponse>${cdr}</applicationResponse></br:sendBillResponse></soap-env:Body></soap-env:Envelope>`),
    ]);
    const r = await new SunatReal(cred, { fetch: fn }).enviarFactura({ nombreArchivo: "20606433094-01-F001-1", xml: "<f/>" });
    expect(r).toMatchObject({ estado: "aceptada", codigo: "0" });
    expect(llamadas[0]!.url).toBe(ENDPOINTS_FACTURA.beta);
    const sobre = String(llamadas[0]!.init.body);
    expect(sobre).toContain("<wsse:Username>20606433094USUARIO1</wsse:Username>");
    expect(sobre).toContain("<fileName>20606433094-01-F001-1.zip</fileName>");
  });

  it("un SOAP Fault con código 2xxx es rechazo; otro código es error", async () => {
    const fault = (codigo: string) => () =>
      new Response(`<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/"><soap-env:Body><soap-env:Fault><faultcode>soap-env:Client.${codigo}</faultcode><faultstring>Detalle ${codigo}</faultstring></soap-env:Fault></soap-env:Body></soap-env:Envelope>`, { status: 500 });
    const rechazo = fetchFalso([fault("2800")]);
    expect(await new SunatReal(cred, { fetch: rechazo.fn }).enviarFactura({ nombreArchivo: "a", xml: "<a/>" })).toMatchObject({ estado: "rechazada", codigo: "2800", mensaje: "Detalle 2800" });
    const auth = fetchFalso([fault("0102")]);
    await expect(new SunatReal(cred, { fetch: auth.fn }).enviarFactura({ nombreArchivo: "a", xml: "<a/>" })).rejects.toThrow("0102");
  });
});

describe("SunatMixto", () => {
  it("usa un gateway para guías y otro para facturas", async () => {
    const guias = new SunatSimulado({ demoraMs: 0 });
    const facturas = new SunatSimulado({ rechazo: { codigo: "2000", mensaje: "no" } });
    const mixto = new SunatMixto(guias, facturas);
    const { ticket } = await mixto.enviarGuia({ nombreArchivo: "20606433094-31-V001-1", xml: "<x/>" });
    expect((await mixto.consultarTicket(ticket)).estado).toBe("aceptada");
    expect((await mixto.enviarFactura({ nombreArchivo: "20606433094-01-F001-1", xml: "<x/>" })).estado).toBe("rechazada");
  });
});
```

Run: `pnpm vitest run packages/sunat/test/real.test.ts`
Expected: FAIL — `../src/real` no existe.

- [ ] **Step 2: Implementar el gateway real**

`packages/sunat/src/real.ts`:
```ts
import { createHash } from "node:crypto";
import { leerCdrZip } from "./cdr";
import { SunatNoDisponibleError, type DocumentoFirmado, type RespuestaSunat, type SunatGateway } from "./tipos";
import { zipArchivo } from "./zip";

export interface CredencialesSunat {
  ruc: string;
  usuarioSol: string;
  claveSol: string;
  greClientId?: string;
  greClientSecret?: string;
  ambienteFactura: "beta" | "produccion";
}

export const ENDPOINTS_FACTURA = {
  beta: "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService",
  produccion: "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService",
} as const;

const URL_TOKEN = "https://api-seguridad.sunat.gob.pe/v1/clientessol";
const URL_GRE = "https://api-cpe.sunat.gob.pe/v1/contribuyente/gem/comprobantes";

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class SunatReal implements SunatGateway {
  private token: { valor: string; expira: number } | null = null;
  private readonly fetch: typeof fetch;

  constructor(private readonly cred: CredencialesSunat, o: { fetch?: typeof fetch } = {}) {
    this.fetch = o.fetch ?? globalThis.fetch;
  }

  private async llamar(url: string, init: RequestInit): Promise<Response> {
    let resp: Response;
    try {
      resp = await this.fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      throw new SunatNoDisponibleError(`No se pudo conectar con SUNAT: ${(error as Error).message}`);
    }
    return resp;
  }

  private async obtenerToken(): Promise<string> {
    if (this.token && this.token.expira > Date.now() + 60_000) return this.token.valor;
    const { greClientId, greClientSecret, ruc, usuarioSol, claveSol } = this.cred;
    if (!greClientId || !greClientSecret) throw new Error("Faltan las credenciales API SUNAT (client_id / client_secret) para guías");
    const resp = await this.llamar(`${URL_TOKEN}/${encodeURIComponent(greClientId)}/oauth2/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "password",
        scope: "https://api-cpe.sunat.gob.pe",
        client_id: greClientId,
        client_secret: greClientSecret,
        username: `${ruc}${usuarioSol}`,
        password: claveSol,
      }).toString(),
    });
    if (resp.status >= 500) throw new SunatNoDisponibleError(`SUNAT OAuth HTTP ${resp.status}`);
    if (!resp.ok) throw new Error(`SUNAT rechazó las credenciales (OAuth HTTP ${resp.status})`);
    const datos = (await resp.json()) as { access_token: string; expires_in: number };
    this.token = { valor: datos.access_token, expira: Date.now() + datos.expires_in * 1000 };
    return this.token.valor;
  }

  private async llamarGre(url: string, init: RequestInit): Promise<unknown> {
    const hacer = async () =>
      this.llamar(url, { ...init, headers: { ...(init.headers as object), Authorization: `Bearer ${await this.obtenerToken()}`, Accept: "application/json" } });
    let resp = await hacer();
    if (resp.status === 401) {
      this.token = null;
      resp = await hacer();
    }
    if (resp.status >= 500) throw new SunatNoDisponibleError(`SUNAT GRE HTTP ${resp.status}`);
    const texto = await resp.text();
    if (!resp.ok) throw new Error(`SUNAT GRE HTTP ${resp.status}: ${texto.slice(0, 300)}`);
    return texto ? JSON.parse(texto) : {};
  }

  async enviarGuia(doc: DocumentoFirmado): Promise<{ ticket: string }> {
    const zip = await zipArchivo(`${doc.nombreArchivo}.xml`, doc.xml);
    const datos = (await this.llamarGre(`${URL_GRE}/${encodeURIComponent(doc.nombreArchivo)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        archivo: {
          nomArchivo: `${doc.nombreArchivo}.zip`,
          arcGreZip: zip.toString("base64"),
          hashZip: createHash("sha256").update(zip).digest("hex"),
        },
      }),
    })) as { numTicket?: string };
    if (!datos.numTicket) throw new Error("SUNAT no devolvió número de ticket");
    return { ticket: datos.numTicket };
  }

  async consultarTicket(ticket: string): Promise<RespuestaSunat> {
    const datos = (await this.llamarGre(`${URL_GRE}/envios/${encodeURIComponent(ticket)}`, { method: "GET" })) as {
      codRespuesta: string;
      arcCdr?: string;
      error?: { numError?: string; desError?: string };
    };
    if (datos.codRespuesta === "0098") return { estado: "en_proceso", codigo: "0098", mensaje: "En proceso", notas: [] };
    if (datos.arcCdr) return leerCdrZip(Buffer.from(datos.arcCdr, "base64"));
    if (datos.codRespuesta === "0001") return { estado: "aceptada", codigo: "0001", mensaje: "Aceptado", notas: [] };
    return {
      estado: "rechazada",
      codigo: datos.error?.numError ?? datos.codRespuesta,
      mensaje: datos.error?.desError ?? "Rechazado por SUNAT",
      notas: [],
    };
  }

  async enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat> {
    const zip = await zipArchivo(`${doc.nombreArchivo}.xml`, doc.xml);
    const sobre = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header><wsse:Security><wsse:UsernameToken>
    <wsse:Username>${escape(this.cred.ruc + this.cred.usuarioSol)}</wsse:Username>
    <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escape(this.cred.claveSol)}</wsse:Password>
  </wsse:UsernameToken></wsse:Security></soapenv:Header>
  <soapenv:Body><ser:sendBill><fileName>${escape(doc.nombreArchivo)}.zip</fileName><contentFile>${zip.toString("base64")}</contentFile></ser:sendBill></soapenv:Body>
</soapenv:Envelope>`;
    const resp = await this.llamar(ENDPOINTS_FACTURA[this.cred.ambienteFactura], {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "urn:sendBill" },
      body: sobre,
    });
    const texto = await resp.text();
    const fault = texto.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>[\s\S]*?<faultstring[^>]*>([\s\S]*?)<\/faultstring>/);
    if (fault) {
      const codigo = fault[1]!.match(/(\d{4})\s*$/)?.[1] ?? fault[1]!.trim();
      const numero = Number(codigo);
      if (numero >= 2000 && numero < 4000) return { estado: "rechazada", codigo, mensaje: fault[2]!.trim(), notas: [] };
      throw new Error(`SUNAT SOAP ${codigo}: ${fault[2]!.trim()}`);
    }
    if (resp.status >= 500) throw new SunatNoDisponibleError(`SUNAT SOAP HTTP ${resp.status}`);
    const cdr = texto.match(/<applicationResponse[^>]*>([\s\S]*?)<\/applicationResponse>/)?.[1];
    if (!cdr) throw new Error(`Respuesta SOAP inesperada (HTTP ${resp.status})`);
    return leerCdrZip(Buffer.from(cdr.trim(), "base64"));
  }
}
```

`packages/sunat/src/mixto.ts`:
```ts
import type { DocumentoFirmado, RespuestaSunat, SunatGateway } from "./tipos";

export class SunatMixto implements SunatGateway {
  constructor(private readonly guias: SunatGateway, private readonly facturas: SunatGateway) {}

  enviarGuia(doc: DocumentoFirmado): Promise<{ ticket: string }> {
    return this.guias.enviarGuia(doc);
  }

  consultarTicket(ticket: string): Promise<RespuestaSunat> {
    return this.guias.consultarTicket(ticket);
  }

  enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat> {
    return this.facturas.enviarFactura(doc);
  }
}
```

Añadir a `packages/sunat/src/index.ts`:
```ts
export * from "./real";
export * from "./mixto";
```

- [ ] **Step 3: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/sunat`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/sunat
git commit -m "feat(sunat): gateway real (OAuth, GRE REST, SOAP sendBill) y gateway mixto"
```

---

### Task 9: PDF de guía y factura con QR

**Files:**
- Create: `packages/pdf/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/pdf/src/comun.ts`, `src/guia.ts`, `src/factura.ts`, `src/index.ts`
- Test: `packages/pdf/test/pdf.test.ts`

**Interfaces:**
- Produces (desde `@sunatapp/pdf`, recibe todo ya formateado como texto):
  - `interface PdfGuia { emisor: { ruc: string; razonSocial: string; direccion: string; registroMtc: string }; serieNumero: string; fechaEmision: string; fechaTraslado: string; remitente: { numeroDoc: string; razonSocial: string }; destinatario: { numeroDoc: string; razonSocial: string }; partida: string; llegada: string; vehiculoPlaca: string; conductor: { nombre: string; numeroDoc: string; licencia: string }; pesoBruto: string; unidadPeso: string; documentosRelacionados: string[]; items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }>; textoQr: string; simulado: boolean }`
  - `interface PdfFactura { emisor: { ruc: string; razonSocial: string; direccion: string }; serieNumero: string; fechaEmision: string; fechaVencimiento: string | null; formaPago: string; cliente: { numeroDoc: string; razonSocial: string; direccion?: string }; descripcion: string; subtotal: string; igv: string; total: string; montoEnLetras: string; detraccion: { porcentaje: string; monto: string; cuenta: string } | null; guiasRelacionadas: string[]; textoQr: string; simulado: boolean }`
  - `generarPdfGuia(d: PdfGuia, o?: { comprimir?: boolean }): Promise<Buffer>`
  - `generarPdfFactura(d: PdfFactura, o?: { comprimir?: boolean }): Promise<Buffer>`

- [ ] **Step 1: Crear paquete e instalar dependencias**

`packages/pdf/package.json`:
```json
{
  "name": "@sunatapp/pdf",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```
`tsconfig.json` y `vitest.config.ts`: igual que core.

Run: `pnpm --filter @sunatapp/pdf add pdfkit qrcode`
Run: `pnpm --filter @sunatapp/pdf add -D @types/pdfkit @types/qrcode unpdf`

- [ ] **Step 2: Escribir el test que falla**

`packages/pdf/test/pdf.test.ts`:
```ts
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { generarPdfFactura, type PdfFactura } from "../src/factura";
import { generarPdfGuia, type PdfGuia } from "../src/guia";

async function texto(pdf: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  return (await extractText(doc, { mergePages: true })).text as string;
}

const guia: PdfGuia = {
  emisor: { ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", direccion: "AV. DEMO 123", registroMtc: "15123456CNG" },
  serieNumero: "V001-1",
  fechaEmision: "2026-09-13",
  fechaTraslado: "2026-09-14",
  remitente: { numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA SAC" },
  destinatario: { numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO SAC" },
  partida: "AV. 28 DE JULIO 1275 - LIMA / LIMA / LA VICTORIA",
  llegada: "CARRETERA FEDERICO BASADRE KM 86 - UCAYALI / CORONEL PORTILLO / CALLERIA",
  vehiculoPlaca: "ABC123",
  conductor: { nombre: "JHON LARRY VELEZMORO SOZA", numeroDoc: "45288569", licencia: "Q45288569" },
  pesoBruto: "1500.500",
  unidadPeso: "KGM",
  documentosRelacionados: ["GRE Remitente EG01-123"],
  items: [{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }],
  textoQr: "https://simulado.local/qr",
  simulado: true,
};

const factura: PdfFactura = {
  emisor: { ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", direccion: "AV. DEMO 123" },
  serieNumero: "F001-1",
  fechaEmision: "2026-09-13",
  fechaVencimiento: "2026-10-13",
  formaPago: "Crédito",
  cliente: { numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA SAC" },
  descripcion: "SERVICIO DE TRANSPORTE DE CARGA SEGUN GRE V001-1",
  subtotal: "S/ 1,000.00",
  igv: "S/ 180.00",
  total: "S/ 1,180.00",
  montoEnLetras: "SON: MIL CIENTO OCHENTA CON 00/100 SOLES",
  detraccion: { porcentaje: "4%", monto: "S/ 47.00", cuenta: "00-045-091619" },
  guiasRelacionadas: ["V001-1"],
  textoQr: "20606433094|01|F001|1|180.00|1180.00|2026-09-13|6|20131312955|abc=|",
  simulado: true,
};

describe("PDF", () => {
  it("guía: PDF válido con los datos clave", async () => {
    const pdf = await generarPdfGuia(guia);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = await texto(pdf);
    for (const esperado of ["GUÍA DE REMISIÓN ELECTRÓNICA TRANSPORTISTA", "V001-1", "ABC123", "Q45288569", "1500.500", "CAJAS DE CERAMICA", "SIMULADO"]) {
      expect(t).toContain(esperado);
    }
  });

  it("factura: PDF válido con totales, detracción y letras", async () => {
    const t = await texto(await generarPdfFactura(factura));
    for (const esperado of ["FACTURA ELECTRÓNICA", "F001-1", "S/ 1,180.00", "SON: MIL CIENTO OCHENTA", "00-045-091619", "2026-10-13"]) {
      expect(t).toContain(esperado);
    }
  });

  it("factura sin detracción no muestra la sección", async () => {
    const t = await texto(await generarPdfFactura({ ...factura, detraccion: null }));
    expect(t).not.toContain("detracción");
  });
});
```

Run: `pnpm vitest run packages/pdf`
Expected: FAIL — módulos no encontrados.

- [ ] **Step 3: Implementar**

`packages/pdf/src/comun.ts`:
```ts
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export type Doc = PDFKit.PDFDocument;

export async function crearPdf(dibujar: (doc: Doc) => Promise<void> | void, comprimir = true): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40, compress: comprimir });
  const partes: Buffer[] = [];
  doc.on("data", (c: Buffer) => partes.push(c));
  const fin = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
  });
  await dibujar(doc);
  doc.end();
  return fin;
}

export function encabezado(doc: Doc, emisor: { ruc: string; razonSocial: string; direccion: string }, titulo: string, serieNumero: string, simulado: boolean): void {
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(13).text(emisor.razonSocial, 40, y, { width: 320 });
  doc.font("Helvetica").fontSize(9).text(emisor.direccion, { width: 320 });
  doc.rect(380, y, 175, 70).stroke();
  doc.font("Helvetica-Bold").fontSize(10).text(`RUC ${emisor.ruc}`, 385, y + 8, { width: 165, align: "center" });
  doc.text(titulo, { width: 165, align: "center" });
  doc.fontSize(12).text(serieNumero, { width: 165, align: "center" });
  doc.y = y + 85;
  doc.x = 40;
  if (simulado) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#b00020").text("DOCUMENTO SIMULADO - SIN VALOR TRIBUTARIO", { align: "center" });
    doc.fillColor("black").moveDown(0.5);
  }
}

export function campo(doc: Doc, etiqueta: string, valor: string): void {
  doc.font("Helvetica-Bold").fontSize(9).text(`${etiqueta}: `, { continued: true }).font("Helvetica").text(valor);
}

export function seccion(doc: Doc, titulo: string): void {
  doc.moveDown(0.6).font("Helvetica-Bold").fontSize(10).text(titulo.toUpperCase()).moveDown(0.2);
}

export async function qr(doc: Doc, texto: string): Promise<void> {
  const imagen = await QRCode.toBuffer(texto, { width: 110, margin: 1 });
  doc.moveDown();
  doc.image(imagen, 40, doc.y, { width: 90 });
  doc.y += 95;
}
```

`packages/pdf/src/guia.ts`:
```ts
import { campo, crearPdf, encabezado, qr, seccion } from "./comun";

export interface PdfGuia {
  emisor: { ruc: string; razonSocial: string; direccion: string; registroMtc: string };
  serieNumero: string;
  fechaEmision: string;
  fechaTraslado: string;
  remitente: { numeroDoc: string; razonSocial: string };
  destinatario: { numeroDoc: string; razonSocial: string };
  partida: string;
  llegada: string;
  vehiculoPlaca: string;
  conductor: { nombre: string; numeroDoc: string; licencia: string };
  pesoBruto: string;
  unidadPeso: string;
  documentosRelacionados: string[];
  items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }>;
  textoQr: string;
  simulado: boolean;
}

export function generarPdfGuia(d: PdfGuia, o: { comprimir?: boolean } = {}): Promise<Buffer> {
  return crearPdf(async (doc) => {
    encabezado(doc, d.emisor, "GUÍA DE REMISIÓN ELECTRÓNICA TRANSPORTISTA", d.serieNumero, d.simulado);
    campo(doc, "Fecha de emisión", d.fechaEmision);
    campo(doc, "Inicio de traslado", d.fechaTraslado);
    campo(doc, "Registro MTC", d.emisor.registroMtc);
    seccion(doc, "Remitente y destinatario");
    campo(doc, "Remitente", `${d.remitente.razonSocial} (${d.remitente.numeroDoc})`);
    campo(doc, "Destinatario", `${d.destinatario.razonSocial} (${d.destinatario.numeroDoc})`);
    seccion(doc, "Traslado");
    campo(doc, "Punto de partida", d.partida);
    campo(doc, "Punto de llegada", d.llegada);
    campo(doc, "Peso bruto", `${d.pesoBruto} ${d.unidadPeso}`);
    if (d.documentosRelacionados.length) campo(doc, "Documentos relacionados", d.documentosRelacionados.join(", "));
    seccion(doc, "Vehículo y conductor");
    campo(doc, "Placa", d.vehiculoPlaca);
    campo(doc, "Conductor", `${d.conductor.nombre} - DNI ${d.conductor.numeroDoc}`);
    campo(doc, "Licencia", d.conductor.licencia);
    seccion(doc, "Bienes trasladados");
    d.items.forEach((it, i) => {
      doc.font("Helvetica").fontSize(9).text(`${i + 1}. ${it.descripcion} — ${it.cantidad} ${it.unidadMedida}`);
    });
    await qr(doc, d.textoQr);
    doc.font("Helvetica").fontSize(8).text("Representación impresa de la Guía de Remisión Electrónica Transportista.");
  }, o.comprimir);
}
```

`packages/pdf/src/factura.ts`:
```ts
import { campo, crearPdf, encabezado, qr, seccion } from "./comun";

export interface PdfFactura {
  emisor: { ruc: string; razonSocial: string; direccion: string };
  serieNumero: string;
  fechaEmision: string;
  fechaVencimiento: string | null;
  formaPago: string;
  cliente: { numeroDoc: string; razonSocial: string; direccion?: string };
  descripcion: string;
  subtotal: string;
  igv: string;
  total: string;
  montoEnLetras: string;
  detraccion: { porcentaje: string; monto: string; cuenta: string } | null;
  guiasRelacionadas: string[];
  textoQr: string;
  simulado: boolean;
}

export function generarPdfFactura(d: PdfFactura, o: { comprimir?: boolean } = {}): Promise<Buffer> {
  return crearPdf(async (doc) => {
    encabezado(doc, d.emisor, "FACTURA ELECTRÓNICA", d.serieNumero, d.simulado);
    campo(doc, "Fecha de emisión", d.fechaEmision);
    campo(doc, "Forma de pago", d.formaPago);
    if (d.fechaVencimiento) campo(doc, "Fecha de vencimiento", d.fechaVencimiento);
    seccion(doc, "Cliente");
    campo(doc, "Razón social", d.cliente.razonSocial);
    campo(doc, "RUC", d.cliente.numeroDoc);
    if (d.cliente.direccion) campo(doc, "Dirección", d.cliente.direccion);
    seccion(doc, "Detalle");
    doc.font("Helvetica").fontSize(9).text(`1 servicio — ${d.descripcion}`);
    if (d.guiasRelacionadas.length) campo(doc, "Guías de remisión", d.guiasRelacionadas.join(", "));
    seccion(doc, "Totales");
    campo(doc, "Op. gravada", d.subtotal);
    campo(doc, "IGV 18%", d.igv);
    campo(doc, "Importe total", d.total);
    doc.font("Helvetica").fontSize(9).text(d.montoEnLetras);
    if (d.detraccion) {
      seccion(doc, "Operación sujeta a detracción");
      campo(doc, "Porcentaje", d.detraccion.porcentaje);
      campo(doc, "Monto", d.detraccion.monto);
      campo(doc, "Cuenta Banco de la Nación", d.detraccion.cuenta);
    }
    await qr(doc, d.textoQr);
    doc.font("Helvetica").fontSize(8).text("Representación impresa de la Factura Electrónica.");
  }, o.comprimir);
}
```

`packages/pdf/src/index.ts`:
```ts
export * from "./guia";
export * from "./factura";
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/pdf`
Expected: PASS (3 tests). Si unpdf devuelve el texto con saltos que cortan una frase buscada, comparar con `t.replace(/\s+/g, " ")`.

- [ ] **Step 5: Commit**

```bash
git add packages/pdf pnpm-lock.yaml
git commit -m "feat(pdf): representación impresa de guía y factura con QR"
```

---

### Task 10: Core — configuración, almacén de archivos, contexto y datos iniciales

**Files:**
- Create: `packages/core/src/infra/config.ts`, `almacen.ts`, `auditoria.ts`, `sembrar.ts`, `contexto.ts`
- Create: `.env.example`
- Modify: `packages/core/package.json` (dependencias workspace), `packages/core/src/index.ts`
- Test: `packages/core/test/infra.test.ts`, `packages/core/test/helpers.ts`

**Interfaces:**
- Consumes: `crearDb`, `Db`, `Ejecutor`, tablas (Task 3); `SunatGateway`, `SunatSimulado`, `SunatReal`, `SunatMixto`, `cargarPfx`, `generarCertificadoPrueba`, `Certificado` (Tasks 4–8)
- Produces:
  - `interface Config { databaseUrl: string | null; dataDir: string; storageDir: string; sunatModo: "simulado" | "beta" | "real"; sunatAmbienteFactura: "beta" | "produccion"; simularRechazo: { codigo: string; mensaje: string } | null; certPath: string | null; certPassword: string | null; solUsuario: string | null; solClave: string | null; greClientId: string | null; greClientSecret: string | null }`
  - `cargarConfig(env?: Record<string, string | undefined>): Config`
  - `interface Almacen { guardar(ruta: string, contenido: string | Buffer): Promise<string>; leer(ruta: string): Promise<Buffer>; leerTexto(ruta: string): Promise<string>; rutaAbsoluta(ruta: string): string }`
  - `crearAlmacenLocal(base: string): Almacen`
  - `registrarAuditoria(db: Ejecutor, e: { usuarioId?: number | null; accion: string; entidad: string; entidadId?: string | number | null; detalle?: unknown }): Promise<void>`
  - `interface DatosIniciales { empresa: { ruc: string; razonSocial: string; nombreComercial?: string; direccion: string; ubigeo: string; registroMtc: string; cuentaDetraccionBn?: string }; vehiculo: { placa: string; marca?: string; numeroAutorizacion?: string }; conductor: { numeroDoc: string; nombres: string; apellidos: string; licencia: string }; usuario: { nombre: string; email: string; telegramId?: number } }`
  - `sembrarDatosIniciales(db: Db, d: DatosIniciales): Promise<void>` (lanza `ErrorNegocio` si ya existe empresa)
  - `interface Contexto { db: Db; gateway: SunatGateway; certificado: Certificado; almacen: Almacen; reloj: () => Date; dormir: (ms: number) => Promise<void>; simulado: boolean }`
  - `crearContexto(config: Config): Promise<{ ctx: Contexto; cerrar: () => Promise<void> }>`
  - Test helper `crearContextoPrueba(o?: { gateway?: SunatGateway; reloj?: () => Date }): Promise<{ ctx: Contexto; cerrar: () => Promise<void> }>` (BD en memoria, datos sembrados, SUNAT simulado sin demora)

- [ ] **Step 1: Declarar dependencias de core**

Modificar `packages/core/package.json` agregando:
```json
  "dependencies": {
    "@sunatapp/db": "workspace:*",
    "@sunatapp/pdf": "workspace:*",
    "@sunatapp/sunat": "workspace:*"
  }
```
Run: `pnpm --filter @sunatapp/core add zod`
Run: `pnpm install`

- [ ] **Step 2: Escribir helpers y el test que falla**

`packages/core/test/helpers.ts`:
```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crearDb } from "@sunatapp/db";
import { cargarPfx, generarCertificadoPrueba, SunatSimulado, type Certificado, type SunatGateway } from "@sunatapp/sunat";
import { crearAlmacenLocal } from "../src/infra/almacen";
import type { Contexto } from "../src/infra/contexto";
import { sembrarDatosIniciales, type DatosIniciales } from "../src/infra/sembrar";

let certificado: Certificado | undefined;

export const DATOS_INICIALES: DatosIniciales = {
  empresa: {
    ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", direccion: "AV. DEMO 123", ubigeo: "150115",
    registroMtc: "15123456CNG", cuentaDetraccionBn: "00-045-091619",
  },
  vehiculo: { placa: "ABC-123", marca: "VOLVO" },
  conductor: { numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" },
  usuario: { nombre: "Dueño", email: "dueno@demo.pe", telegramId: 111 },
};

export async function crearContextoPrueba(o: { gateway?: SunatGateway; reloj?: () => Date } = {}) {
  certificado ??= cargarPfx(generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "x" }), "x");
  const { db, cerrar } = await crearDb({ tipo: "pglite" });
  await sembrarDatosIniciales(db, DATOS_INICIALES);
  const ctx: Contexto = {
    db,
    gateway: o.gateway ?? new SunatSimulado({ demoraMs: 0 }),
    certificado,
    almacen: crearAlmacenLocal(mkdtempSync(join(tmpdir(), "sunatapp-"))),
    reloj: o.reloj ?? (() => new Date("2026-09-13T15:00:00Z")),
    dormir: async () => {},
    simulado: true,
  };
  return { ctx, cerrar };
}
```

`packages/core/test/infra.test.ts`:
```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditoria, empresa, usuario } from "@sunatapp/db";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorNegocio } from "../src/errores";
import { crearAlmacenLocal } from "../src/infra/almacen";
import { registrarAuditoria } from "../src/infra/auditoria";
import { cargarConfig } from "../src/infra/config";
import { crearContexto } from "../src/infra/contexto";
import { sembrarDatosIniciales } from "../src/infra/sembrar";
import { crearContextoPrueba, DATOS_INICIALES } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

describe("cargarConfig", () => {
  it("usa valores por defecto en modo simulado", () => {
    const c = cargarConfig({});
    expect(c).toMatchObject({ sunatModo: "simulado", databaseUrl: null, storageDir: "./storage", dataDir: "./data", simularRechazo: null });
  });

  it("interpreta el rechazo simulado", () => {
    expect(cargarConfig({ SUNAT_SIMULAR_RECHAZO: "2556:Placa inválida" }).simularRechazo).toEqual({ codigo: "2556", mensaje: "Placa inválida" });
  });

  it("en modo real exige certificado y credenciales", () => {
    expect(() => cargarConfig({ SUNAT_MODO: "real" })).toThrow(/SUNAT_CERT_PATH/);
  });
});

describe("almacén local", () => {
  it("guarda y lee archivos en subcarpetas", async () => {
    const almacen = crearAlmacenLocal(mkdtempSync(join(tmpdir(), "alm-")));
    const ruta = await almacen.guardar("guias/a.xml", "<a/>");
    expect(ruta).toBe("guias/a.xml");
    expect(await almacen.leerTexto(ruta)).toBe("<a/>");
  });

  it("impide salir de la carpeta base", async () => {
    const almacen = crearAlmacenLocal(mkdtempSync(join(tmpdir(), "alm-")));
    await expect(almacen.guardar("../fuera.txt", "x")).rejects.toThrow("Ruta no permitida");
  });
});

describe("sembrar y auditoría", () => {
  it("siembra una sola vez y registra auditoría", async () => {
    const { ctx, cerrar } = await crearContextoPrueba();
    cerrables.push(cerrar);
    expect(await ctx.db.select().from(empresa)).toHaveLength(1);
    expect((await ctx.db.select().from(usuario))[0]?.telegramId).toBe(111);
    await expect(sembrarDatosIniciales(ctx.db, DATOS_INICIALES)).rejects.toBeInstanceOf(ErrorNegocio);
    await registrarAuditoria(ctx.db, { accion: "prueba", entidad: "empresa", entidadId: 1, detalle: { a: 1 } });
    expect((await ctx.db.select().from(auditoria))[0]).toMatchObject({ accion: "prueba", entidadId: "1" });
  });
});

describe("crearContexto", () => {
  it("en modo simulado crea y reutiliza un certificado de prueba en storage", async () => {
    const base = mkdtempSync(join(tmpdir(), "ctx-"));
    const config = cargarConfig({ STORAGE_DIR: join(base, "storage"), DATA_DIR: join(base, "data") });
    const a = await crearContexto(config);
    cerrables.push(a.cerrar);
    expect(a.ctx.simulado).toBe(true);
    expect(await a.ctx.almacen.leer("certificado-prueba.pfx")).toBeInstanceOf(Buffer);
    const subject = a.ctx.certificado.subject;
    await a.cerrar();
    cerrables.pop();
    const b = await crearContexto(config);
    cerrables.push(b.cerrar);
    expect(b.ctx.certificado.subject).toBe(subject);
  });
});
```

Run: `pnpm vitest run packages/core/test/infra.test.ts`
Expected: FAIL — módulos no encontrados.

- [ ] **Step 3: Implementar configuración**

`packages/core/src/infra/config.ts`:
```ts
import { z } from "zod";

const vacioANull = z.string().trim().optional().transform((v) => (v ? v : null));

const esquema = z
  .object({
    DATABASE_URL: vacioANull,
    DATA_DIR: z.string().default("./data"),
    STORAGE_DIR: z.string().default("./storage"),
    SUNAT_MODO: z.enum(["simulado", "beta", "real"]).default("simulado"),
    SUNAT_AMBIENTE_FACTURA: z.enum(["beta", "produccion"]).default("beta"),
    SUNAT_SIMULAR_RECHAZO: vacioANull,
    SUNAT_CERT_PATH: vacioANull,
    SUNAT_CERT_PASSWORD: vacioANull,
    SUNAT_SOL_USUARIO: vacioANull,
    SUNAT_SOL_CLAVE: vacioANull,
    SUNAT_GRE_CLIENT_ID: vacioANull,
    SUNAT_GRE_CLIENT_SECRET: vacioANull,
  })
  .superRefine((e, ctx) => {
    if (e.SUNAT_MODO !== "real") return;
    for (const clave of ["SUNAT_CERT_PATH", "SUNAT_CERT_PASSWORD", "SUNAT_SOL_USUARIO", "SUNAT_SOL_CLAVE", "SUNAT_GRE_CLIENT_ID", "SUNAT_GRE_CLIENT_SECRET"] as const) {
      if (!e[clave]) ctx.addIssue({ code: "custom", path: [clave], message: `${clave} es obligatorio con SUNAT_MODO=real` });
    }
  });

export interface Config {
  databaseUrl: string | null;
  dataDir: string;
  storageDir: string;
  sunatModo: "simulado" | "beta" | "real";
  sunatAmbienteFactura: "beta" | "produccion";
  simularRechazo: { codigo: string; mensaje: string } | null;
  certPath: string | null;
  certPassword: string | null;
  solUsuario: string | null;
  solClave: string | null;
  greClientId: string | null;
  greClientSecret: string | null;
}

export function cargarConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = esquema.safeParse(env);
  if (!r.success) throw new Error(`Configuración inválida: ${r.error.issues.map((i) => i.message).join("; ")}`);
  const e = r.data;
  const rechazo = e.SUNAT_SIMULAR_RECHAZO?.match(/^([^:]+):(.*)$/);
  return {
    databaseUrl: e.DATABASE_URL,
    dataDir: e.DATA_DIR,
    storageDir: e.STORAGE_DIR,
    sunatModo: e.SUNAT_MODO,
    sunatAmbienteFactura: e.SUNAT_AMBIENTE_FACTURA,
    simularRechazo: rechazo ? { codigo: rechazo[1]!, mensaje: rechazo[2]! } : null,
    certPath: e.SUNAT_CERT_PATH,
    certPassword: e.SUNAT_CERT_PASSWORD,
    solUsuario: e.SUNAT_SOL_USUARIO,
    solClave: e.SUNAT_SOL_CLAVE,
    greClientId: e.SUNAT_GRE_CLIENT_ID,
    greClientSecret: e.SUNAT_GRE_CLIENT_SECRET,
  };
}
```

- [ ] **Step 4: Implementar almacén, auditoría y sembrado**

`packages/core/src/infra/almacen.ts`:
```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export interface Almacen {
  guardar(ruta: string, contenido: string | Buffer): Promise<string>;
  leer(ruta: string): Promise<Buffer>;
  leerTexto(ruta: string): Promise<string>;
  rutaAbsoluta(ruta: string): string;
}

export function crearAlmacenLocal(base: string): Almacen {
  const raiz = resolve(base);
  const absoluta = (ruta: string) => {
    const destino = resolve(raiz, ruta);
    if (destino !== raiz && !destino.startsWith(raiz + sep)) throw new Error(`Ruta no permitida: ${ruta}`);
    return destino;
  };
  return {
    async guardar(ruta, contenido) {
      const destino = absoluta(ruta);
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, contenido);
      return relative(raiz, destino).split(sep).join("/");
    },
    leer: (ruta) => readFile(absoluta(ruta)),
    leerTexto: (ruta) => readFile(absoluta(ruta), "utf8"),
    rutaAbsoluta: absoluta,
  };
}
```

`packages/core/src/infra/auditoria.ts`:
```ts
import { auditoria, type Ejecutor } from "@sunatapp/db";

export async function registrarAuditoria(
  db: Ejecutor,
  e: { usuarioId?: number | null; accion: string; entidad: string; entidadId?: string | number | null; detalle?: unknown },
): Promise<void> {
  await db.insert(auditoria).values({
    usuarioId: e.usuarioId ?? null,
    accion: e.accion,
    entidad: e.entidad,
    entidadId: e.entidadId === undefined || e.entidadId === null ? null : String(e.entidadId),
    detalle: e.detalle ?? null,
  });
}
```

`packages/core/src/infra/sembrar.ts`:
```ts
import { conductor, empresa, usuario, vehiculo, type Db } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";

export interface DatosIniciales {
  empresa: { ruc: string; razonSocial: string; nombreComercial?: string; direccion: string; ubigeo: string; registroMtc: string; cuentaDetraccionBn?: string };
  vehiculo: { placa: string; marca?: string; numeroAutorizacion?: string };
  conductor: { numeroDoc: string; nombres: string; apellidos: string; licencia: string };
  usuario: { nombre: string; email: string; telegramId?: number };
}

export async function sembrarDatosIniciales(db: Db, d: DatosIniciales): Promise<void> {
  if ((await db.select({ id: empresa.id }).from(empresa).limit(1)).length > 0) {
    throw new ErrorNegocio("Los datos iniciales ya fueron cargados");
  }
  await db.transaction(async (tx) => {
    await tx.insert(empresa).values(d.empresa);
    await tx.insert(vehiculo).values(d.vehiculo);
    await tx.insert(conductor).values({ ...d.conductor, tipoDoc: "1" });
    await tx.insert(usuario).values(d.usuario);
  });
}
```

- [ ] **Step 5: Implementar el contexto**

`packages/core/src/infra/contexto.ts`:
```ts
import { join } from "node:path";
import { crearDb, empresa, type Db } from "@sunatapp/db";
import {
  cargarPfx, generarCertificadoPrueba, SunatMixto, SunatReal, SunatSimulado, type Certificado, type SunatGateway,
} from "@sunatapp/sunat";
import { readFile } from "node:fs/promises";
import { crearAlmacenLocal, type Almacen } from "./almacen";
import type { Config } from "./config";

export interface Contexto {
  db: Db;
  gateway: SunatGateway;
  certificado: Certificado;
  almacen: Almacen;
  reloj: () => Date;
  dormir: (ms: number) => Promise<void>;
  simulado: boolean;
}

const PFX_PRUEBA = "certificado-prueba.pfx";
const CLAVE_PRUEBA = "prueba";

async function obtenerCertificado(config: Config, almacen: Almacen, db: Db): Promise<Certificado> {
  if (config.sunatModo === "real") return cargarPfx(await readFile(config.certPath!), config.certPassword!);
  try {
    return cargarPfx(await almacen.leer(PFX_PRUEBA), CLAVE_PRUEBA);
  } catch {
    const [emp] = await db.select().from(empresa).limit(1);
    const pfx = generarCertificadoPrueba({ ruc: emp?.ruc ?? "20000000001", razonSocial: emp?.razonSocial ?? "EMPRESA DE PRUEBA", password: CLAVE_PRUEBA });
    await almacen.guardar(PFX_PRUEBA, pfx);
    return cargarPfx(pfx, CLAVE_PRUEBA);
  }
}

async function crearGateway(config: Config, db: Db): Promise<SunatGateway> {
  const simulado = new SunatSimulado(config.simularRechazo ? { rechazo: config.simularRechazo } : {});
  if (config.sunatModo === "simulado") return simulado;
  const [emp] = await db.select().from(empresa).limit(1);
  if (!emp) throw new Error("Carga los datos iniciales (pnpm sembrar) antes de usar SUNAT beta o real");
  if (config.sunatModo === "beta") {
    return new SunatMixto(simulado, new SunatReal({ ruc: emp.ruc, usuarioSol: "MODDATOS", claveSol: "moddatos", ambienteFactura: "beta" }));
  }
  return new SunatReal({
    ruc: emp.ruc,
    usuarioSol: config.solUsuario!,
    claveSol: config.solClave!,
    greClientId: config.greClientId!,
    greClientSecret: config.greClientSecret!,
    ambienteFactura: config.sunatAmbienteFactura,
  });
}

export async function crearContexto(config: Config): Promise<{ ctx: Contexto; cerrar: () => Promise<void> }> {
  const { db, cerrar } = config.databaseUrl
    ? await crearDb({ tipo: "postgres", url: config.databaseUrl })
    : await crearDb({ tipo: "pglite", directorio: join(config.dataDir, "pglite") });
  const almacen = crearAlmacenLocal(config.storageDir);
  const ctx: Contexto = {
    db,
    almacen,
    gateway: await crearGateway(config, db),
    certificado: await obtenerCertificado(config, almacen, db),
    reloj: () => new Date(),
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
    simulado: config.sunatModo !== "real",
  };
  return { ctx, cerrar };
}
```

Añadir a `packages/core/src/index.ts`:
```ts
export * from "./infra/config";
export * from "./infra/almacen";
export * from "./infra/auditoria";
export * from "./infra/sembrar";
export * from "./infra/contexto";
```

`.env.example` (raíz):
```dotenv
# Base de datos: vacío = PGlite en DATA_DIR/pglite
DATABASE_URL=
DATA_DIR=./data
STORAGE_DIR=./storage

# simulado | beta (guías simuladas, facturas a beta SUNAT) | real
SUNAT_MODO=simulado
SUNAT_AMBIENTE_FACTURA=beta
# Forzar rechazo en modo simulado, formato codigo:mensaje
SUNAT_SIMULAR_RECHAZO=

# Solo para SUNAT_MODO=real
SUNAT_CERT_PATH=
SUNAT_CERT_PASSWORD=
SUNAT_SOL_USUARIO=
SUNAT_SOL_CLAVE=
SUNAT_GRE_CLIENT_ID=
SUNAT_GRE_CLIENT_SECRET=

# Datos iniciales (pnpm sembrar)
EMPRESA_RUC=
EMPRESA_RAZON_SOCIAL=
EMPRESA_DIRECCION=
EMPRESA_UBIGEO=
EMPRESA_REGISTRO_MTC=
EMPRESA_CUENTA_DETRACCION=
VEHICULO_PLACA=
CONDUCTOR_DNI=
CONDUCTOR_NOMBRES=
CONDUCTOR_APELLIDOS=
CONDUCTOR_LICENCIA=
USUARIO_NOMBRE=
USUARIO_EMAIL=
USUARIO_TELEGRAM_ID=
```

- [ ] **Step 6: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/core`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core .env.example pnpm-lock.yaml
git commit -m "feat(core): configuración, almacén de archivos, contexto y datos iniciales"
```

---

### Task 11: Core — registrar y emitir guías (con reintentos y consulta en segundo plano)

**Files:**
- Create: `packages/core/src/guias/validar.ts`, `registrar.ts`, `cargar.ts`, `emitir.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/guias.test.ts`

**Interfaces:**
- Consumes: `Contexto`, `registrarAuditoria` (Task 10); `validarRuc`, `validarDni`, `tipoDocumentoDe`, `existeUbigeo`, `obtenerUbigeo`, `fechaHoraLima` (Task 2); `siguienteCorrelativo`, tablas (Task 3); `construirXmlGreTransportista`, `firmarXml`, `validarXsd`, `extraerDigest`, `nombreArchivo`, `SunatNoDisponibleError`, `RespuestaSunat` (Tasks 4–7); `generarPdfGuia` (Task 9)
- Produces:
  - `interface EntradaGuia { fechaTraslado: string; remitente: { numeroDoc: string; razonSocial: string }; destinatario: { numeroDoc: string; razonSocial: string }; partida: { direccion: string; ubigeo: string }; llegada: { direccion: string; ubigeo: string }; pesoBruto: string; unidadPeso: "KGM" | "TNE"; greRemitenteRef: string | null; items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }>; documentoRecibidoId?: number }`
  - `validarEntradaGuia(e: EntradaGuia): string[]` (lista vacía = válida)
  - `registrarGuiaBorrador(ctx: Contexto, e: EntradaGuia, usuarioId?: number): Promise<number>` (lanza `ErrorValidacion`)
  - `interface ResultadoEmision { id: number; estado: string; serieNumero: string; codigo: string | null; mensaje: string | null; rutaPdf: string | null }`
  - `emitirGuia(ctx: Contexto, guiaId: number, o?: { esperarRespuesta?: boolean }): Promise<ResultadoEmision>`
  - `procesarPendientesGuias(ctx: Contexto): Promise<ResultadoEmision[]>` (devuelve solo las guías que cambiaron a estado final)
  - `cargarGuiaCompleta(db: Ejecutor, guiaId: number)` y `resultadoGuia(ctx: Contexto, guiaId: number): Promise<ResultadoEmision>`
  - Constantes: `ESPERAS_TICKET_MS = [2000, 4000, 8000, 16000, 30000, 30000, 30000]`, `REINTENTO_MS = 300000`, `MAX_INTENTOS = 288`

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `packages/core/test/helpers.ts` (y `import type { EntradaGuia } from "../src/guias/validar";` arriba):
```ts
export function entradaGuia(): EntradaGuia {
  return {
    fechaTraslado: "2026-09-14",
    remitente: { numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA SAC" },
    destinatario: { numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO SAC" },
    partida: { direccion: "AV. 28 DE JULIO 1275", ubigeo: "150115" },
    llegada: { direccion: "CARRETERA FEDERICO BASADRE KM 86", ubigeo: "250101" },
    pesoBruto: "1500.5",
    unidadPeso: "KGM",
    greRemitenteRef: "EG01-123",
    items: [{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }],
  };
}
```

`packages/core/test/guias.test.ts`:
```ts
import { contraparte, correlativo, eq, guiaTransportista } from "@sunatapp/db";
import { SunatNoDisponibleError, SunatSimulado, type DocumentoFirmado, type SunatGateway } from "@sunatapp/sunat";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorValidacion } from "../src/errores";
import { emitirGuia, procesarPendientesGuias } from "../src/guias/emitir";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import { validarEntradaGuia } from "../src/guias/validar";
import { crearContextoPrueba, entradaGuia } from "./helpers";

class GatewayControlado implements SunatGateway {
  envios = 0;
  caido = true;
  constructor(private readonly base: SunatGateway) {}
  async enviarGuia(doc: DocumentoFirmado) {
    this.envios++;
    if (this.caido) throw new SunatNoDisponibleError("sin red");
    return this.base.enviarGuia(doc);
  }
  consultarTicket(t: string) { return this.base.consultarTicket(t); }
  enviarFactura(doc: DocumentoFirmado) { return this.base.enviarFactura(doc); }
}

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function contexto(o: Parameters<typeof crearContextoPrueba>[0] = {}) {
  const r = await crearContextoPrueba(o);
  cerrables.push(r.cerrar);
  return r.ctx;
}

describe("validarEntradaGuia", () => {
  it("acepta una entrada correcta", () => {
    expect(validarEntradaGuia(entradaGuia())).toEqual([]);
  });

  it("explica cada problema en español", () => {
    const e = entradaGuia();
    e.remitente.numeroDoc = "20131312956";
    e.llegada.ubigeo = "999999";
    e.pesoBruto = "0";
    e.items = [];
    e.fechaTraslado = "14/09/2026";
    expect(validarEntradaGuia(e)).toEqual([
      "Fecha de traslado inválida (use AAAA-MM-DD)",
      "RUC/DNI del remitente inválido",
      "Ubigeo de llegada no existe",
      "El peso bruto debe ser mayor a cero",
      "Debe haber al menos un bien",
    ]);
  });
});

describe("registrarGuiaBorrador", () => {
  it("crea contrapartes reutilizables y usa el vehículo y conductor activos", async () => {
    const ctx = await contexto();
    const id1 = await registrarGuiaBorrador(ctx, entradaGuia());
    await registrarGuiaBorrador(ctx, entradaGuia());
    expect(await ctx.db.select().from(contraparte)).toHaveLength(2);
    const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id1));
    expect(g).toMatchObject({ estado: "borrador", numero: null, serie: "V001" });
  });

  it("rechaza entradas inválidas", async () => {
    const ctx = await contexto();
    const e = entradaGuia();
    e.pesoBruto = "-1";
    await expect(registrarGuiaBorrador(ctx, e)).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe("emitirGuia", () => {
  it("flujo feliz: número, XML, CDR, PDF y estado aceptada", async () => {
    const ctx = await contexto();
    const r = await emitirGuia(ctx, await registrarGuiaBorrador(ctx, entradaGuia()));
    expect(r).toMatchObject({ estado: "aceptada", serieNumero: "V001-1", codigo: "0" });
    const [g] = await ctx.db.select().from(guiaTransportista);
    expect(await ctx.almacen.leerTexto(g!.rutaXml!)).toContain("<cbc:ID>V001-1</cbc:ID>");
    expect((await ctx.almacen.leer(g!.rutaPdf!)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(g!.rutaCdr).toBe("guias/R-20606433094-31-V001-1.zip");
  });

  it("es idempotente: emitir dos veces no reenvía ni gasta otro número", async () => {
    const gw = new GatewayControlado(new SunatSimulado({ demoraMs: 0 }));
    gw.caido = false;
    const ctx = await contexto({ gateway: gw });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, id);
    const segunda = await emitirGuia(ctx, id);
    expect(segunda.serieNumero).toBe("V001-1");
    expect(gw.envios).toBe(1);
    expect((await ctx.db.select().from(correlativo))[0]?.ultimoNumero).toBe(1);
  });

  it("SUNAT caído deja la guía pendiente y el proceso de fondo la completa con el mismo número", async () => {
    let ahora = new Date("2026-09-13T15:00:00Z");
    const gw = new GatewayControlado(new SunatSimulado({ demoraMs: 0 }));
    const ctx = await contexto({ gateway: gw, reloj: () => ahora });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    expect(await emitirGuia(ctx, id)).toMatchObject({ estado: "pendiente_envio", serieNumero: "V001-1" });

    expect(await procesarPendientesGuias(ctx)).toEqual([]); // aún no toca reintentar
    gw.caido = false;
    ahora = new Date(ahora.getTime() + 6 * 60_000);
    const cambios = await procesarPendientesGuias(ctx);
    expect(cambios).toEqual([expect.objectContaining({ id, estado: "aceptada", serieNumero: "V001-1" })]);
  });

  it("rechazo de SUNAT queda registrado y se puede reemitir con el mismo número", async () => {
    const ctx = await contexto({ gateway: new SunatSimulado({ demoraMs: 0, rechazo: { codigo: "2556", mensaje: "Placa inválida" } }) });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    expect(await emitirGuia(ctx, id)).toMatchObject({ estado: "rechazada", codigo: "2556", mensaje: "Placa inválida" });
    ctx.gateway = new SunatSimulado({ demoraMs: 0 });
    expect(await emitirGuia(ctx, id)).toMatchObject({ estado: "aceptada", serieNumero: "V001-1" });
  });

  it("si el ticket tarda, queda enviada y el proceso de fondo la termina", async () => {
    let ms = Date.parse("2026-09-13T15:00:00Z");
    const ctx = await contexto({
      gateway: new SunatSimulado({ demoraMs: 10 * 60_000, ahora: () => ms }),
      reloj: () => new Date(ms),
    });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    expect((await emitirGuia(ctx, id)).estado).toBe("enviada");
    ms += 11 * 60_000;
    expect(await procesarPendientesGuias(ctx)).toEqual([expect.objectContaining({ id, estado: "aceptada" })]);
  });
});
```

Run: `pnpm vitest run packages/core/test/guias.test.ts`
Expected: FAIL — módulos no encontrados.

- [ ] **Step 2: Implementar validación y registro**

`packages/core/src/guias/validar.ts`:
```ts
import { existeUbigeo } from "../dominio/ubigeos";
import { tipoDocumentoDe } from "../dominio/validaciones";

export interface EntradaGuia {
  fechaTraslado: string;
  remitente: { numeroDoc: string; razonSocial: string };
  destinatario: { numeroDoc: string; razonSocial: string };
  partida: { direccion: string; ubigeo: string };
  llegada: { direccion: string; ubigeo: string };
  pesoBruto: string;
  unidadPeso: "KGM" | "TNE";
  greRemitenteRef: string | null;
  items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }>;
  documentoRecibidoId?: number;
}

export function validarEntradaGuia(e: EntradaGuia): string[] {
  const errores: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.fechaTraslado) || Number.isNaN(Date.parse(e.fechaTraslado))) {
    errores.push("Fecha de traslado inválida (use AAAA-MM-DD)");
  }
  for (const [nombre, parte] of [["remitente", e.remitente], ["destinatario", e.destinatario]] as const) {
    if (!tipoDocumentoDe(parte.numeroDoc)) errores.push(`RUC/DNI del ${nombre} inválido`);
    if (!parte.razonSocial.trim()) errores.push(`Falta la razón social del ${nombre}`);
  }
  for (const [nombre, dir] of [["partida", e.partida], ["llegada", e.llegada]] as const) {
    if (!dir.direccion.trim()) errores.push(`Falta la dirección de ${nombre}`);
    if (!existeUbigeo(dir.ubigeo)) errores.push(`Ubigeo de ${nombre} no existe`);
  }
  if (!(Number(e.pesoBruto) > 0)) errores.push("El peso bruto debe ser mayor a cero");
  if (e.items.length === 0) errores.push("Debe haber al menos un bien");
  e.items.forEach((it, i) => {
    if (!it.descripcion.trim()) errores.push(`El bien ${i + 1} no tiene descripción`);
    if (!(Number(it.cantidad) > 0)) errores.push(`La cantidad del bien ${i + 1} debe ser mayor a cero`);
  });
  return errores;
}
```

`packages/core/src/guias/registrar.ts`:
```ts
import { conductor, contraparte, empresa, eq, guiaItem, guiaTransportista, vehiculo, type Tx } from "@sunatapp/db";
import { tipoDocumentoDe } from "../dominio/validaciones";
import { ErrorNegocio, ErrorValidacion } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { validarEntradaGuia, type EntradaGuia } from "./validar";

async function asegurarContraparte(tx: Tx, p: { numeroDoc: string; razonSocial: string }): Promise<number> {
  const [fila] = await tx
    .insert(contraparte)
    .values({ tipoDoc: tipoDocumentoDe(p.numeroDoc)!, numeroDoc: p.numeroDoc, razonSocial: p.razonSocial.trim() })
    .onConflictDoUpdate({ target: contraparte.numeroDoc, set: { razonSocial: p.razonSocial.trim() } })
    .returning({ id: contraparte.id });
  return fila!.id;
}

export async function registrarGuiaBorrador(ctx: Contexto, e: EntradaGuia, usuarioId?: number): Promise<number> {
  const errores = validarEntradaGuia(e);
  if (errores.length) throw new ErrorValidacion(errores);
  return ctx.db.transaction(async (tx) => {
    const [emp] = await tx.select().from(empresa).limit(1);
    const [veh] = await tx.select().from(vehiculo).where(eq(vehiculo.activo, true)).limit(1);
    const [cond] = await tx.select().from(conductor).where(eq(conductor.activo, true)).limit(1);
    if (!emp || !veh || !cond) throw new ErrorNegocio("Falta configurar empresa, vehículo o conductor");
    const [guia] = await tx
      .insert(guiaTransportista)
      .values({
        serie: emp.serieGre,
        fechaTraslado: e.fechaTraslado,
        remitenteId: await asegurarContraparte(tx, e.remitente),
        destinatarioId: await asegurarContraparte(tx, e.destinatario),
        partidaDireccion: e.partida.direccion.trim(),
        partidaUbigeo: e.partida.ubigeo,
        llegadaDireccion: e.llegada.direccion.trim(),
        llegadaUbigeo: e.llegada.ubigeo,
        pesoBruto: e.pesoBruto,
        unidadPeso: e.unidadPeso,
        vehiculoId: veh.id,
        conductorId: cond.id,
        greRemitenteRef: e.greRemitenteRef,
        documentoRecibidoId: e.documentoRecibidoId ?? null,
      })
      .returning({ id: guiaTransportista.id });
    await tx.insert(guiaItem).values(e.items.map((it) => ({ guiaId: guia!.id, ...it })));
    await registrarAuditoria(tx, { usuarioId, accion: "guia_registrada", entidad: "guia_transportista", entidadId: guia!.id });
    return guia!.id;
  });
}
```

- [ ] **Step 3: Implementar carga y mapeos**

`packages/core/src/guias/cargar.ts`:
```ts
import { conductor, contraparte, empresa, eq, guiaItem, guiaTransportista, vehiculo, type Ejecutor } from "@sunatapp/db";
import type { PdfGuia } from "@sunatapp/pdf";
import type { DatosGreTransportista, TipoDocIdentidadSunat } from "@sunatapp/sunat";
import { obtenerUbigeo } from "../dominio/ubigeos";
import { ErrorNegocio } from "../errores";

export async function cargarGuiaCompleta(db: Ejecutor, guiaId: number) {
  const [guia] = await db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!guia) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
  const [emp] = await db.select().from(empresa).limit(1);
  const [remitente] = await db.select().from(contraparte).where(eq(contraparte.id, guia.remitenteId));
  const [destinatario] = await db.select().from(contraparte).where(eq(contraparte.id, guia.destinatarioId));
  const [veh] = await db.select().from(vehiculo).where(eq(vehiculo.id, guia.vehiculoId));
  const [cond] = await db.select().from(conductor).where(eq(conductor.id, guia.conductorId));
  const items = await db.select().from(guiaItem).where(eq(guiaItem.guiaId, guiaId)).orderBy(guiaItem.id);
  if (!emp || !remitente || !destinatario || !veh || !cond) throw new ErrorNegocio(`Datos incompletos para la guía ${guiaId}`);
  return { guia, empresa: emp, remitente, destinatario, vehiculo: veh, conductor: cond, items };
}

export type GuiaCompleta = Awaited<ReturnType<typeof cargarGuiaCompleta>>;

export function datosGreDesde(d: GuiaCompleta): DatosGreTransportista {
  const parte = (c: GuiaCompleta["remitente"]) => ({ tipoDoc: c.tipoDoc as TipoDocIdentidadSunat, numeroDoc: c.numeroDoc, razonSocial: c.razonSocial });
  return {
    emisor: { ruc: d.empresa.ruc, razonSocial: d.empresa.razonSocial, registroMtc: d.empresa.registroMtc },
    serie: d.guia.serie,
    numero: d.guia.numero!,
    fechaEmision: d.guia.fechaEmision!,
    horaEmision: d.guia.horaEmision!,
    fechaTraslado: d.guia.fechaTraslado,
    remitente: parte(d.remitente),
    destinatario: parte(d.destinatario),
    partida: { ubigeo: d.guia.partidaUbigeo, direccion: d.guia.partidaDireccion },
    llegada: { ubigeo: d.guia.llegadaUbigeo, direccion: d.guia.llegadaDireccion },
    pesoBruto: d.guia.pesoBruto,
    unidadPeso: d.guia.unidadPeso as "KGM" | "TNE",
    vehiculo: { placa: d.vehiculo.placa },
    conductor: { tipoDoc: d.conductor.tipoDoc as TipoDocIdentidadSunat, numeroDoc: d.conductor.numeroDoc, nombres: d.conductor.nombres, apellidos: d.conductor.apellidos, licencia: d.conductor.licencia },
    documentosRelacionados: d.guia.greRemitenteRef ? [{ tipo: "09", serieNumero: d.guia.greRemitenteRef, rucEmisor: d.remitente.numeroDoc }] : [],
    items: d.items.map((it) => ({ descripcion: it.descripcion, cantidad: it.cantidad, unidadMedida: it.unidadMedida })),
  };
}

function lugar(direccion: string, ubigeo: string): string {
  const u = obtenerUbigeo(ubigeo);
  return u ? `${direccion} - ${u.departamento} / ${u.provincia} / ${u.distrito}` : direccion;
}

export function datosPdfGuiaDesde(d: GuiaCompleta, textoQr: string, simulado: boolean): PdfGuia {
  return {
    emisor: { ruc: d.empresa.ruc, razonSocial: d.empresa.razonSocial, direccion: d.empresa.direccion, registroMtc: d.empresa.registroMtc },
    serieNumero: `${d.guia.serie}-${d.guia.numero}`,
    fechaEmision: d.guia.fechaEmision!,
    fechaTraslado: d.guia.fechaTraslado,
    remitente: { numeroDoc: d.remitente.numeroDoc, razonSocial: d.remitente.razonSocial },
    destinatario: { numeroDoc: d.destinatario.numeroDoc, razonSocial: d.destinatario.razonSocial },
    partida: lugar(d.guia.partidaDireccion, d.guia.partidaUbigeo),
    llegada: lugar(d.guia.llegadaDireccion, d.guia.llegadaUbigeo),
    vehiculoPlaca: d.vehiculo.placa,
    conductor: { nombre: `${d.conductor.nombres} ${d.conductor.apellidos}`, numeroDoc: d.conductor.numeroDoc, licencia: d.conductor.licencia },
    pesoBruto: Number(d.guia.pesoBruto).toFixed(3),
    unidadPeso: d.guia.unidadPeso,
    documentosRelacionados: d.guia.greRemitenteRef ? [`GRE Remitente ${d.guia.greRemitenteRef}`] : [],
    items: d.items.map((it) => ({ descripcion: it.descripcion, cantidad: String(Number(it.cantidad)), unidadMedida: it.unidadMedida })),
    textoQr,
    simulado,
  };
}
```

- [ ] **Step 4: Implementar emisión y proceso de fondo**

`packages/core/src/guias/emitir.ts`:
```ts
import { and, eq, guiaTransportista, isNull, lt, lte, or, siguienteCorrelativo } from "@sunatapp/db";
import { generarPdfGuia } from "@sunatapp/pdf";
import {
  construirXmlGreTransportista, extraerDigest, firmarXml, nombreArchivo, SunatNoDisponibleError, validarXsd, type RespuestaSunat,
} from "@sunatapp/sunat";
import { fechaHoraLima } from "../dominio/fechas";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { cargarGuiaCompleta, datosGreDesde, datosPdfGuiaDesde } from "./cargar";

export const ESPERAS_TICKET_MS = [2000, 4000, 8000, 16000, 30000, 30000, 30000];
export const REINTENTO_MS = 5 * 60_000;
export const MAX_INTENTOS = 288;

export interface ResultadoEmision {
  id: number;
  estado: string;
  serieNumero: string;
  codigo: string | null;
  mensaje: string | null;
  rutaPdf: string | null;
}

type CambiosGuia = Partial<typeof guiaTransportista.$inferInsert>;

async function actualizar(ctx: Contexto, id: number, cambios: CambiosGuia): Promise<void> {
  await ctx.db.update(guiaTransportista).set({ ...cambios, actualizadoEn: ctx.reloj() }).where(eq(guiaTransportista.id, id));
}

export async function resultadoGuia(ctx: Contexto, guiaId: number): Promise<ResultadoEmision> {
  const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
  return {
    id: g.id,
    estado: g.estado,
    serieNumero: g.numero ? `${g.serie}-${g.numero}` : `${g.serie}-(sin número)`,
    codigo: g.codigoRespuesta,
    mensaje: g.mensajeRespuesta,
    rutaPdf: g.rutaPdf,
  };
}

export async function aplicarRespuestaGuia(ctx: Contexto, guiaId: number, r: RespuestaSunat): Promise<void> {
  if (r.estado === "en_proceso") return;
  const d = await cargarGuiaCompleta(ctx.db, guiaId);
  const nombre = nombreArchivo(d.empresa.ruc, "31", d.guia.serie, d.guia.numero!);
  if (r.estado === "rechazada") {
    await actualizar(ctx, guiaId, { estado: "rechazada", codigoRespuesta: r.codigo, mensajeRespuesta: r.mensaje, ticket: null });
    await registrarAuditoria(ctx.db, { accion: "guia_rechazada", entidad: "guia_transportista", entidadId: guiaId, detalle: { codigo: r.codigo } });
    return;
  }
  const rutaCdr = r.cdrZip ? await ctx.almacen.guardar(`guias/R-${nombre}.zip`, r.cdrZip) : null;
  const xml = await ctx.almacen.leerTexto(d.guia.rutaXml!);
  const textoQr = r.urlQr ?? `${d.empresa.ruc}|31|${d.guia.serie}|${d.guia.numero}|${extraerDigest(xml)}|`;
  const pdf = await generarPdfGuia(datosPdfGuiaDesde(d, textoQr, ctx.simulado));
  const rutaPdf = await ctx.almacen.guardar(`guias/${nombre}.pdf`, pdf);
  await actualizar(ctx, guiaId, { estado: "aceptada", codigoRespuesta: r.codigo, mensajeRespuesta: r.mensaje, rutaCdr, rutaPdf });
  await registrarAuditoria(ctx.db, { accion: "guia_aceptada", entidad: "guia_transportista", entidadId: guiaId });
}

export async function emitirGuia(ctx: Contexto, guiaId: number, o: { esperarRespuesta?: boolean } = {}): Promise<ResultadoEmision> {
  const reserva = await ctx.db.transaction(async (tx) => {
    const [g] = await tx.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId)).for("update");
    if (!g) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
    if (g.estado === "aceptada" || g.estado === "enviada") return "ya_procesada" as const;
    const { fecha, hora } = fechaHoraLima(ctx.reloj());
    const numero = g.numero ?? (await siguienteCorrelativo(tx, "31", g.serie));
    await tx
      .update(guiaTransportista)
      .set({ numero, fechaEmision: fecha, horaEmision: hora, estado: "pendiente_envio", actualizadoEn: ctx.reloj() })
      .where(eq(guiaTransportista.id, guiaId));
    return "reservada" as const;
  });
  if (reserva === "ya_procesada") return resultadoGuia(ctx, guiaId);

  const d = await cargarGuiaCompleta(ctx.db, guiaId);
  const nombre = nombreArchivo(d.empresa.ruc, "31", d.guia.serie, d.guia.numero!);
  const xml = firmarXml(construirXmlGreTransportista(datosGreDesde(d)), ctx.certificado);
  const xsd = await validarXsd(xml, "DespatchAdvice");
  if (!xsd.valido) {
    await actualizar(ctx, guiaId, { estado: "rechazada", codigoRespuesta: "XSD", mensajeRespuesta: xsd.errores.slice(0, 5).join(" | ") });
    return resultadoGuia(ctx, guiaId);
  }
  const rutaXml = await ctx.almacen.guardar(`guias/${nombre}.xml`, xml);
  const intentos = d.guia.intentos + 1;

  let ticket: string;
  try {
    ({ ticket } = await ctx.gateway.enviarGuia({ nombreArchivo: nombre, xml }));
  } catch (error) {
    if (error instanceof SunatNoDisponibleError) {
      await actualizar(ctx, guiaId, {
        rutaXml, intentos, proximoIntentoEn: new Date(ctx.reloj().getTime() + REINTENTO_MS),
        codigoRespuesta: null, mensajeRespuesta: "SUNAT no disponible; se reintentará automáticamente",
      });
    } else {
      await actualizar(ctx, guiaId, { rutaXml, intentos, estado: "rechazada", codigoRespuesta: "ERROR", mensajeRespuesta: (error as Error).message });
    }
    return resultadoGuia(ctx, guiaId);
  }

  await actualizar(ctx, guiaId, { rutaXml, intentos, ticket, estado: "enviada", proximoIntentoEn: null, codigoRespuesta: null, mensajeRespuesta: null });
  await registrarAuditoria(ctx.db, { accion: "guia_enviada", entidad: "guia_transportista", entidadId: guiaId, detalle: { ticket } });

  if (o.esperarRespuesta !== false) {
    for (const espera of ESPERAS_TICKET_MS) {
      await ctx.dormir(espera);
      try {
        const r = await ctx.gateway.consultarTicket(ticket);
        if (r.estado !== "en_proceso") {
          await aplicarRespuestaGuia(ctx, guiaId, r);
          break;
        }
      } catch (error) {
        if (!(error instanceof SunatNoDisponibleError)) throw error;
      }
    }
  }
  return resultadoGuia(ctx, guiaId);
}

export async function procesarPendientesGuias(ctx: Contexto): Promise<ResultadoEmision[]> {
  const ahora = ctx.reloj();
  const haceUnMinuto = new Date(ahora.getTime() - 60_000);
  const candidatas = await ctx.db
    .select({ id: guiaTransportista.id, estado: guiaTransportista.estado, ticket: guiaTransportista.ticket })
    .from(guiaTransportista)
    .where(
      or(
        and(
          eq(guiaTransportista.estado, "pendiente_envio"),
          lt(guiaTransportista.intentos, MAX_INTENTOS),
          lte(guiaTransportista.actualizadoEn, haceUnMinuto),
          or(isNull(guiaTransportista.proximoIntentoEn), lte(guiaTransportista.proximoIntentoEn, ahora)),
        ),
        eq(guiaTransportista.estado, "enviada"),
      ),
    );

  const cambios: ResultadoEmision[] = [];
  for (const g of candidatas) {
    if (g.estado === "pendiente_envio") {
      // Reenvío sin espera; si queda "enviada" se consulta el ticket una vez en esta misma pasada.
      const r = await emitirGuia(ctx, g.id, { esperarRespuesta: false });
      if (r.estado === "aceptada" || r.estado === "rechazada") cambios.push(r);
      if (r.estado !== "enviada") continue;
    }
    const [actual] = await ctx.db.select({ ticket: guiaTransportista.ticket }).from(guiaTransportista).where(eq(guiaTransportista.id, g.id));
    if (!actual?.ticket) continue;
    try {
      const r = await ctx.gateway.consultarTicket(actual.ticket);
      if (r.estado !== "en_proceso") {
        await aplicarRespuestaGuia(ctx, g.id, r);
        cambios.push(await resultadoGuia(ctx, g.id));
      }
    } catch (error) {
      if (!(error instanceof SunatNoDisponibleError)) throw error;
    }
  }
  return cambios;
}
```

Añadir a `packages/core/src/index.ts`:
```ts
export * from "./guias/validar";
export * from "./guias/registrar";
export * from "./guias/cargar";
export * from "./guias/emitir";
```

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): registro y emisión de guías con reintentos y consulta en segundo plano"
```

---

### Task 12: Core — facturar la guía y controlar cobros

**Files:**
- Create: `packages/core/src/facturas/preparar.ts`, `packages/core/src/facturas/emitir.ts`, `packages/core/src/cobros/cobros.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/facturas.test.ts`

**Interfaces:**
- Consumes: `Contexto`, `registrarAuditoria` (Task 10); `calcularMontosFactura`, `formatearSoles`, `fechaHoraLima`, `sumarDias`, `parsearSerieNumero` (Tasks 1–2); `emitirGuia`, `registrarGuiaBorrador`, `ResultadoEmision`, `REINTENTO_MS`, `MAX_INTENTOS` (Task 11; la factura se responde de inmediato, sin ticket); `construirXmlFactura`, `montoEnLetras`, `firmarXml`, `validarXsd`, `extraerDigest`, `nombreArchivo`, `SunatNoDisponibleError`, `centimosADecimal` (Tasks 4–7); `generarPdfFactura` (Task 9)
- Produces:
  - `interface EntradaFactura { guiaId: number; montoCentimos: number; incluyeIgv: boolean; clienteId?: number; formaPago: "contado" | "credito"; diasCredito?: number }`
  - `prepararFactura(ctx: Contexto, e: EntradaFactura, usuarioId?: number): Promise<{ facturaId: number; montos: MontosFactura }>`
  - `emitirFactura(ctx: Contexto, facturaId: number): Promise<ResultadoEmision>`
  - `procesarPendientesFacturas(ctx: Contexto): Promise<ResultadoEmision[]>`
  - `registrarCobro(ctx: Contexto, e: { facturaId: number; montoCentimos: number; fecha: string; medio: "transferencia" | "efectivo" | "otro"; nota?: string; usuarioId?: number }): Promise<{ estadoCobro: EstadoCobro; saldo: number }>`
  - `buscarFacturaPorSerieNumero(ctx: Contexto, texto: string): Promise<{ id: number } | null>`
  - `interface FilaCobro { facturaId: number; serieNumero: string; cliente: string; fechaVencimiento: string; saldo: number; estado: "vencida" | "vence_hoy" | "pendiente" }`
  - `listarCobrosPendientes(ctx: Contexto): Promise<{ filas: FilaCobro[]; totalPendiente: number; totalVencido: number }>` (saldo = cobrable − cobrado; ordenado por vencimiento)

- [ ] **Step 1: Escribir el test que falla**

`packages/core/test/facturas.test.ts`:
```ts
import { empresa, eq, factura } from "@sunatapp/db";
import { SunatNoDisponibleError, SunatSimulado, type DocumentoFirmado, type SunatGateway } from "@sunatapp/sunat";
import { afterEach, describe, expect, it } from "vitest";
import { buscarFacturaPorSerieNumero, listarCobrosPendientes, registrarCobro } from "../src/cobros/cobros";
import { ErrorNegocio } from "../src/errores";
import { emitirFactura, procesarPendientesFacturas } from "../src/facturas/emitir";
import { prepararFactura } from "../src/facturas/preparar";
import { emitirGuia } from "../src/guias/emitir";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import type { Contexto } from "../src/infra/contexto";
import { crearContextoPrueba, entradaGuia } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

let ahora = new Date("2026-09-13T15:00:00Z");

async function contextoConGuia(gateway?: SunatGateway): Promise<{ ctx: Contexto; guiaId: number }> {
  ahora = new Date("2026-09-13T15:00:00Z");
  const r = await crearContextoPrueba({ reloj: () => ahora, ...(gateway ? { gateway } : {}) });
  cerrables.push(r.cerrar);
  const guiaId = await registrarGuiaBorrador(r.ctx, entradaGuia());
  await emitirGuia(r.ctx, guiaId);
  return { ctx: r.ctx, guiaId };
}

describe("prepararFactura", () => {
  it("calcula montos con detracción y factura al remitente por defecto", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    const { facturaId, montos } = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    expect(montos).toMatchObject({ total: 118000, detraccionMonto: 4700, cobrable: 113300 });
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f).toMatchObject({ estadoSunat: "borrador", serie: "F001", descripcion: expect.stringContaining("V001-1") });
  });

  it("no permite facturar dos veces la misma guía", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    await expect(prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" })).rejects.toThrow("ya tiene factura");
  });

  it("exige guía aceptada y cuenta de detracciones cuando aplica", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    const borrador = await registrarGuiaBorrador(ctx, entradaGuia());
    await expect(prepararFactura(ctx, { guiaId: borrador, montoCentimos: 1000, incluyeIgv: true, formaPago: "contado" })).rejects.toBeInstanceOf(ErrorNegocio);
    await ctx.db.update(empresa).set({ cuentaDetraccionBn: null });
    await expect(prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" })).rejects.toThrow("cuenta de detracciones");
  });

  it("crédito exige días mayores a cero", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    await expect(prepararFactura(ctx, { guiaId, montoCentimos: 1000, incluyeIgv: true, formaPago: "credito" })).rejects.toThrow("días de crédito");
  });
});

describe("emitirFactura", () => {
  it("emite a crédito con vencimiento, archivos y estado aceptada", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "credito", diasCredito: 30 });
    const r = await emitirFactura(ctx, facturaId);
    expect(r).toMatchObject({ estado: "aceptada", serieNumero: "F001-1" });
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f).toMatchObject({ fechaEmision: "2026-09-13", fechaVencimiento: "2026-10-13", estadoCobro: "pendiente" });
    expect(await ctx.almacen.leerTexto(f!.rutaXml!)).toContain("<cbc:PaymentDueDate>2026-10-13</cbc:PaymentDueDate>");
    expect((await ctx.almacen.leer(f!.rutaPdf!)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await emitirFactura(ctx, facturaId)).toMatchObject({ serieNumero: "F001-1" }); // idempotente
  });

  it("SUNAT caído: pendiente y luego enviada por el proceso de fondo", async () => {
    let caido = true;
    const base = new SunatSimulado({ demoraMs: 0 });
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => base.enviarGuia(d),
      consultarTicket: (t: string) => base.consultarTicket(t),
      enviarFactura: async (d: DocumentoFirmado) => {
        if (caido) throw new SunatNoDisponibleError("sin red");
        return base.enviarFactura(d);
      },
    };
    const { ctx, guiaId } = await contextoConGuia(gw);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    expect((await emitirFactura(ctx, facturaId)).estado).toBe("pendiente_envio");
    caido = false;
    ahora = new Date(ahora.getTime() + 6 * 60_000);
    expect(await procesarPendientesFacturas(ctx)).toEqual([expect.objectContaining({ id: facturaId, estado: "aceptada" })]);
  });
});

describe("cobros", () => {
  async function facturaEmitida(diasCredito?: number) {
    const { ctx, guiaId } = await contextoConGuia();
    const { facturaId } = await prepararFactura(ctx, {
      guiaId, montoCentimos: 100000, incluyeIgv: false,
      formaPago: diasCredito ? "credito" : "contado", ...(diasCredito ? { diasCredito } : {}),
    });
    await emitirFactura(ctx, facturaId);
    return { ctx, facturaId };
  }

  it("pago parcial y luego total sobre el monto cobrable (sin detracción)", async () => {
    const { ctx, facturaId } = await facturaEmitida();
    expect(await registrarCobro(ctx, { facturaId, montoCentimos: 50000, fecha: "2026-09-14", medio: "transferencia" })).toEqual({ estadoCobro: "parcial", saldo: 63300 });
    expect(await registrarCobro(ctx, { facturaId, montoCentimos: 63300, fecha: "2026-09-15", medio: "efectivo" })).toEqual({ estadoCobro: "pagada", saldo: 0 });
    await expect(registrarCobro(ctx, { facturaId, montoCentimos: 1, fecha: "2026-09-15", medio: "otro" })).rejects.toThrow("supera el saldo");
  });

  it("busca por serie-número con o sin ceros", async () => {
    const { ctx, facturaId } = await facturaEmitida();
    expect(await buscarFacturaPorSerieNumero(ctx, "f001-00000001")).toEqual({ id: facturaId });
    expect(await buscarFacturaPorSerieNumero(ctx, "F001-99")).toBeNull();
    expect(await buscarFacturaPorSerieNumero(ctx, "basura")).toBeNull();
  });

  it("lista pendientes, vence hoy y vencidas con totales", async () => {
    const { ctx } = await facturaEmitida(30);
    let lista = await listarCobrosPendientes(ctx);
    expect(lista.filas).toEqual([expect.objectContaining({ serieNumero: "F001-1", estado: "pendiente", saldo: 113300, fechaVencimiento: "2026-10-13" })]);
    expect(lista).toMatchObject({ totalPendiente: 113300, totalVencido: 0 });

    ahora = new Date("2026-10-13T15:00:00Z");
    expect((await listarCobrosPendientes(ctx)).filas[0]?.estado).toBe("vence_hoy");

    ahora = new Date("2026-10-20T15:00:00Z");
    lista = await listarCobrosPendientes(ctx);
    expect(lista.filas[0]?.estado).toBe("vencida");
    expect(lista.totalVencido).toBe(113300);
  });
});
```

Run: `pnpm vitest run packages/core/test/facturas.test.ts`
Expected: FAIL — módulos no encontrados.

- [ ] **Step 2: Implementar preparar factura**

`packages/core/src/facturas/preparar.ts`:
```ts
import { contraparte, empresa, eq, facturaGuia, factura, guiaTransportista } from "@sunatapp/db";
import { calcularMontosFactura, type MontosFactura } from "../dominio/montos";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

export interface EntradaFactura {
  guiaId: number;
  montoCentimos: number;
  incluyeIgv: boolean;
  clienteId?: number;
  formaPago: "contado" | "credito";
  diasCredito?: number;
}

export async function prepararFactura(ctx: Contexto, e: EntradaFactura, usuarioId?: number): Promise<{ facturaId: number; montos: MontosFactura }> {
  if (e.formaPago === "credito" && !(e.diasCredito && e.diasCredito > 0)) {
    throw new ErrorNegocio("Indica los días de crédito (mayor a cero)");
  }
  return ctx.db.transaction(async (tx) => {
    const [guia] = await tx.select().from(guiaTransportista).where(eq(guiaTransportista.id, e.guiaId));
    if (!guia || guia.estado !== "aceptada") throw new ErrorNegocio("Solo se pueden facturar guías aceptadas por SUNAT");
    const [ya] = await tx.select().from(facturaGuia).where(eq(facturaGuia.guiaId, e.guiaId));
    if (ya) throw new ErrorNegocio(`La guía ${guia.serie}-${guia.numero} ya tiene factura`);
    const [emp] = await tx.select().from(empresa).limit(1);
    if (!emp) throw new ErrorNegocio("Falta configurar la empresa");
    const clienteId = e.clienteId ?? guia.remitenteId;
    const [cliente] = await tx.select().from(contraparte).where(eq(contraparte.id, clienteId));
    if (!cliente) throw new ErrorNegocio("El cliente no existe");
    if (cliente.tipoDoc !== "6") throw new ErrorNegocio("La factura requiere un cliente con RUC");

    const montos = calcularMontosFactura({
      montoCentimos: e.montoCentimos,
      incluyeIgv: e.incluyeIgv,
      detraccion: { porcentaje: emp.detraccionPorcentaje, umbralCentimos: emp.detraccionUmbral },
    });
    if (montos.detraccionMonto > 0 && !emp.cuentaDetraccionBn) {
      throw new ErrorNegocio("Configura la cuenta de detracciones del Banco de la Nación antes de facturar montos mayores a S/ 400");
    }

    const [fila] = await tx
      .insert(factura)
      .values({
        serie: emp.serieFactura,
        clienteId,
        descripcion: `SERVICIO DE TRANSPORTE DE CARGA SEGUN GRE ${guia.serie}-${guia.numero}${guia.greRemitenteRef ? ` (GRE REMITENTE ${guia.greRemitenteRef})` : ""}`,
        subtotal: montos.subtotal,
        igv: montos.igv,
        total: montos.total,
        detraccionPorcentaje: montos.detraccionPorcentaje,
        detraccionMonto: montos.detraccionMonto,
        formaPago: e.formaPago,
        diasCredito: e.formaPago === "credito" ? e.diasCredito! : null,
      })
      .returning({ id: factura.id });
    await tx.insert(facturaGuia).values({ facturaId: fila!.id, guiaId: e.guiaId });
    await registrarAuditoria(tx, { usuarioId, accion: "factura_preparada", entidad: "factura", entidadId: fila!.id });
    return { facturaId: fila!.id, montos };
  });
}
```

- [ ] **Step 3: Implementar emisión de factura**

`packages/core/src/facturas/emitir.ts`:
```ts
import { and, contraparte, empresa, eq, factura, facturaGuia, guiaTransportista, isNull, lt, lte, or, siguienteCorrelativo } from "@sunatapp/db";
import { generarPdfFactura } from "@sunatapp/pdf";
import {
  construirXmlFactura, extraerDigest, firmarXml, montoEnLetras, nombreArchivo, SunatNoDisponibleError, validarXsd,
  type RespuestaSunat, type TipoDocIdentidadSunat,
} from "@sunatapp/sunat";
import { fechaHoraLima, sumarDias } from "../dominio/fechas";
import { formatearSoles } from "../dominio/montos";
import { ErrorNegocio } from "../errores";
import type { ResultadoEmision } from "../guias/emitir";
import { MAX_INTENTOS, REINTENTO_MS } from "../guias/emitir";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

type CambiosFactura = Partial<typeof factura.$inferInsert>;

async function actualizar(ctx: Contexto, id: number, cambios: CambiosFactura): Promise<void> {
  await ctx.db.update(factura).set({ ...cambios, actualizadoEn: ctx.reloj() }).where(eq(factura.id, id));
}

async function resultadoFactura(ctx: Contexto, id: number): Promise<ResultadoEmision> {
  const [f] = await ctx.db.select().from(factura).where(eq(factura.id, id));
  if (!f) throw new ErrorNegocio(`La factura ${id} no existe`);
  return {
    id: f.id,
    estado: f.estadoSunat,
    serieNumero: f.numero ? `${f.serie}-${f.numero}` : `${f.serie}-(sin número)`,
    codigo: f.codigoRespuesta,
    mensaje: f.mensajeRespuesta,
    rutaPdf: f.rutaPdf,
  };
}

async function cargarFactura(ctx: Contexto, id: number) {
  const [f] = await ctx.db.select().from(factura).where(eq(factura.id, id));
  if (!f) throw new ErrorNegocio(`La factura ${id} no existe`);
  const [emp] = await ctx.db.select().from(empresa).limit(1);
  const [cliente] = await ctx.db.select().from(contraparte).where(eq(contraparte.id, f.clienteId));
  const guias = await ctx.db
    .select({ serie: guiaTransportista.serie, numero: guiaTransportista.numero })
    .from(facturaGuia)
    .innerJoin(guiaTransportista, eq(facturaGuia.guiaId, guiaTransportista.id))
    .where(eq(facturaGuia.facturaId, id));
  return { factura: f, empresa: emp!, cliente: cliente!, guias: guias.map((g) => `${g.serie}-${g.numero}`) };
}

async function aplicarRespuestaFactura(ctx: Contexto, id: number, r: RespuestaSunat): Promise<void> {
  const d = await cargarFactura(ctx, id);
  const f = d.factura;
  const nombre = nombreArchivo(d.empresa.ruc, "01", f.serie, f.numero!);
  if (r.estado === "rechazada" || r.estado === "en_proceso") {
    await actualizar(ctx, id, { estadoSunat: "rechazada", codigoRespuesta: r.codigo, mensajeRespuesta: r.mensaje });
    await registrarAuditoria(ctx.db, { accion: "factura_rechazada", entidad: "factura", entidadId: id, detalle: { codigo: r.codigo } });
    return;
  }
  const rutaCdr = r.cdrZip ? await ctx.almacen.guardar(`facturas/R-${nombre}.zip`, r.cdrZip) : null;
  const xml = await ctx.almacen.leerTexto(f.rutaXml!);
  const m = (c: number) => (c / 100).toFixed(2);
  const textoQr = `${d.empresa.ruc}|01|${f.serie}|${f.numero}|${m(f.igv)}|${m(f.total)}|${f.fechaEmision}|${d.cliente.tipoDoc}|${d.cliente.numeroDoc}|${extraerDigest(xml)}|`;
  const pdf = await generarPdfFactura({
    emisor: { ruc: d.empresa.ruc, razonSocial: d.empresa.razonSocial, direccion: d.empresa.direccion },
    serieNumero: `${f.serie}-${f.numero}`,
    fechaEmision: f.fechaEmision!,
    fechaVencimiento: f.formaPago === "credito" ? f.fechaVencimiento : null,
    formaPago: f.formaPago === "credito" ? "Crédito" : "Contado",
    cliente: { numeroDoc: d.cliente.numeroDoc, razonSocial: d.cliente.razonSocial, ...(d.cliente.direccion ? { direccion: d.cliente.direccion } : {}) },
    descripcion: f.descripcion,
    subtotal: formatearSoles(f.subtotal),
    igv: formatearSoles(f.igv),
    total: formatearSoles(f.total),
    montoEnLetras: montoEnLetras(f.total),
    detraccion: f.detraccionMonto > 0 ? { porcentaje: `${f.detraccionPorcentaje}%`, monto: formatearSoles(f.detraccionMonto), cuenta: d.empresa.cuentaDetraccionBn ?? "" } : null,
    guiasRelacionadas: d.guias,
    textoQr,
    simulado: ctx.simulado,
  });
  const rutaPdf = await ctx.almacen.guardar(`facturas/${nombre}.pdf`, pdf);
  await actualizar(ctx, id, {
    estadoSunat: r.estado, codigoRespuesta: r.codigo,
    mensajeRespuesta: [r.mensaje, ...r.notas].join(" | "), rutaCdr, rutaPdf, proximoIntentoEn: null,
  });
  await registrarAuditoria(ctx.db, { accion: "factura_aceptada", entidad: "factura", entidadId: id });
}

export async function emitirFactura(ctx: Contexto, facturaId: number): Promise<ResultadoEmision> {
  const reserva = await ctx.db.transaction(async (tx) => {
    const [f] = await tx.select().from(factura).where(eq(factura.id, facturaId)).for("update");
    if (!f) throw new ErrorNegocio(`La factura ${facturaId} no existe`);
    if (f.estadoSunat === "aceptada" || f.estadoSunat === "observada") return "ya_procesada" as const;
    const { fecha, hora } = fechaHoraLima(ctx.reloj());
    const numero = f.numero ?? (await siguienteCorrelativo(tx, "01", f.serie));
    await tx
      .update(factura)
      .set({
        numero, fechaEmision: fecha, horaEmision: hora, estadoSunat: "pendiente_envio",
        fechaVencimiento: f.formaPago === "credito" ? sumarDias(fecha, f.diasCredito!) : fecha,
        actualizadoEn: ctx.reloj(),
      })
      .where(eq(factura.id, facturaId));
    return "reservada" as const;
  });
  if (reserva === "ya_procesada") return resultadoFactura(ctx, facturaId);

  const d = await cargarFactura(ctx, facturaId);
  const f = d.factura;
  const nombre = nombreArchivo(d.empresa.ruc, "01", f.serie, f.numero!);
  const xml = firmarXml(
    construirXmlFactura({
      emisor: {
        ruc: d.empresa.ruc, razonSocial: d.empresa.razonSocial, ubigeo: d.empresa.ubigeo, direccion: d.empresa.direccion,
        ...(d.empresa.nombreComercial ? { nombreComercial: d.empresa.nombreComercial } : {}),
        ...(d.empresa.cuentaDetraccionBn ? { cuentaDetraccion: d.empresa.cuentaDetraccionBn } : {}),
      },
      serie: f.serie,
      numero: f.numero!,
      fechaEmision: f.fechaEmision!,
      horaEmision: f.horaEmision!,
      cliente: {
        tipoDoc: d.cliente.tipoDoc as TipoDocIdentidadSunat, numeroDoc: d.cliente.numeroDoc, razonSocial: d.cliente.razonSocial,
        ...(d.cliente.direccion ? { direccion: d.cliente.direccion } : {}),
      },
      descripcion: f.descripcion,
      montos: { subtotal: f.subtotal, igv: f.igv, total: f.total, detraccionPorcentaje: f.detraccionPorcentaje, detraccionMonto: f.detraccionMonto },
      formaPago: f.formaPago === "credito" ? { tipo: "credito", fechaVencimiento: f.fechaVencimiento! } : { tipo: "contado" },
      guiasRelacionadas: d.guias,
    }),
    ctx.certificado,
  );
  const xsd = await validarXsd(xml, "Invoice");
  if (!xsd.valido) {
    await actualizar(ctx, facturaId, { estadoSunat: "rechazada", codigoRespuesta: "XSD", mensajeRespuesta: xsd.errores.slice(0, 5).join(" | ") });
    return resultadoFactura(ctx, facturaId);
  }
  const rutaXml = await ctx.almacen.guardar(`facturas/${nombre}.xml`, xml);
  const intentos = f.intentos + 1;
  try {
    const r = await ctx.gateway.enviarFactura({ nombreArchivo: nombre, xml });
    await actualizar(ctx, facturaId, { rutaXml, intentos });
    await aplicarRespuestaFactura(ctx, facturaId, r);
  } catch (error) {
    if (!(error instanceof SunatNoDisponibleError)) {
      await actualizar(ctx, facturaId, { rutaXml, intentos, estadoSunat: "rechazada", codigoRespuesta: "ERROR", mensajeRespuesta: (error as Error).message });
    } else {
      await actualizar(ctx, facturaId, {
        rutaXml, intentos, proximoIntentoEn: new Date(ctx.reloj().getTime() + REINTENTO_MS),
        mensajeRespuesta: "SUNAT no disponible; se reintentará automáticamente",
      });
    }
  }
  return resultadoFactura(ctx, facturaId);
}

export async function procesarPendientesFacturas(ctx: Contexto): Promise<ResultadoEmision[]> {
  const ahora = ctx.reloj();
  const candidatas = await ctx.db
    .select({ id: factura.id })
    .from(factura)
    .where(
      and(
        eq(factura.estadoSunat, "pendiente_envio"),
        lt(factura.intentos, MAX_INTENTOS),
        lte(factura.actualizadoEn, new Date(ahora.getTime() - 60_000)),
        or(isNull(factura.proximoIntentoEn), lte(factura.proximoIntentoEn, ahora)),
      ),
    );
  const cambios: ResultadoEmision[] = [];
  for (const { id } of candidatas) {
    const r = await emitirFactura(ctx, id);
    if (r.estado !== "pendiente_envio") cambios.push(r);
  }
  return cambios;
}
```

- [ ] **Step 4: Implementar cobros**

`packages/core/src/cobros/cobros.ts`:
```ts
import { and, cobro, contraparte, eq, factura, inArray, sql, type EstadoCobro } from "@sunatapp/db";
import { fechaHoraLima } from "../dominio/fechas";
import { parsearSerieNumero } from "../dominio/serie-numero";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

export interface FilaCobro {
  facturaId: number;
  serieNumero: string;
  cliente: string;
  fechaVencimiento: string;
  saldo: number;
  estado: "vencida" | "vence_hoy" | "pendiente";
}

const EMITIDAS = ["aceptada", "observada"] as const;

async function cobrado(ctx: Contexto, facturaId: number): Promise<number> {
  const [fila] = await ctx.db.select({ suma: sql<string>`coalesce(sum(${cobro.monto}), 0)` }).from(cobro).where(eq(cobro.facturaId, facturaId));
  return Number(fila?.suma ?? 0);
}

export async function registrarCobro(
  ctx: Contexto,
  e: { facturaId: number; montoCentimos: number; fecha: string; medio: "transferencia" | "efectivo" | "otro"; nota?: string; usuarioId?: number },
): Promise<{ estadoCobro: EstadoCobro; saldo: number }> {
  if (!Number.isInteger(e.montoCentimos) || e.montoCentimos <= 0) throw new ErrorNegocio("El monto cobrado debe ser mayor a cero");
  const [f] = await ctx.db.select().from(factura).where(eq(factura.id, e.facturaId));
  if (!f || !EMITIDAS.includes(f.estadoSunat as (typeof EMITIDAS)[number])) throw new ErrorNegocio("Solo se registran cobros de facturas aceptadas por SUNAT");
  const cobrable = f.total - f.detraccionMonto;
  const saldoAntes = cobrable - (await cobrado(ctx, f.id));
  if (e.montoCentimos > saldoAntes) throw new ErrorNegocio(`El monto supera el saldo pendiente (${saldoAntes / 100})`);
  const saldo = saldoAntes - e.montoCentimos;
  const estadoCobro: EstadoCobro = saldo === 0 ? "pagada" : "parcial";
  await ctx.db.transaction(async (tx) => {
    await tx.insert(cobro).values({ facturaId: f.id, fecha: e.fecha, monto: e.montoCentimos, medio: e.medio, nota: e.nota ?? null, usuarioId: e.usuarioId ?? null });
    await tx.update(factura).set({ estadoCobro, actualizadoEn: ctx.reloj() }).where(eq(factura.id, f.id));
    await registrarAuditoria(tx, { usuarioId: e.usuarioId, accion: "cobro_registrado", entidad: "factura", entidadId: f.id, detalle: { monto: e.montoCentimos } });
  });
  return { estadoCobro, saldo };
}

export async function buscarFacturaPorSerieNumero(ctx: Contexto, texto: string): Promise<{ id: number } | null> {
  const sn = parsearSerieNumero(texto);
  if (!sn) return null;
  const [f] = await ctx.db.select({ id: factura.id }).from(factura).where(and(eq(factura.serie, sn.serie), eq(factura.numero, sn.numero)));
  return f ?? null;
}

export async function listarCobrosPendientes(ctx: Contexto): Promise<{ filas: FilaCobro[]; totalPendiente: number; totalVencido: number }> {
  const hoy = fechaHoraLima(ctx.reloj()).fecha;
  const facturas = await ctx.db
    .select({ f: factura, cliente: contraparte.razonSocial })
    .from(factura)
    .innerJoin(contraparte, eq(factura.clienteId, contraparte.id))
    .where(and(inArray(factura.estadoSunat, [...EMITIDAS]), inArray(factura.estadoCobro, ["pendiente", "parcial"])));
  const filas: FilaCobro[] = [];
  for (const { f, cliente } of facturas) {
    const saldo = f.total - f.detraccionMonto - (await cobrado(ctx, f.id));
    const venc = f.fechaVencimiento!;
    filas.push({
      facturaId: f.id,
      serieNumero: `${f.serie}-${f.numero}`,
      cliente,
      fechaVencimiento: venc,
      saldo,
      estado: venc < hoy ? "vencida" : venc === hoy ? "vence_hoy" : "pendiente",
    });
  }
  filas.sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
  return {
    filas,
    totalPendiente: filas.reduce((s, f) => s + f.saldo, 0),
    totalVencido: filas.filter((f) => f.estado === "vencida").reduce((s, f) => s + f.saldo, 0),
  };
}
```

Añadir a `packages/core/src/index.ts`:
```ts
export * from "./facturas/preparar";
export * from "./facturas/emitir";
export * from "./cobros/cobros";
```

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `pnpm vitest run packages/core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): facturación de guías con detracción y control de cobros"
```

---

### Task 13: Scripts de sembrado y demo de punta a punta + verificación final

**Files:**
- Create: `packages/core/scripts/cargar-env.ts`, `packages/core/scripts/sembrar.ts`, `packages/core/scripts/demo.ts`
- Create: `README.md`
- Modify: `package.json` (raíz: scripts)

**Interfaces:**
- Consumes: todo lo exportado por `@sunatapp/core` (Tasks 1–12)
- Produces: comandos `pnpm sembrar`, `pnpm demo`, `pnpm typecheck`, `pnpm test`

- [ ] **Step 1: Scripts**

`packages/core/scripts/cargar-env.ts`:
```ts
try {
  process.loadEnvFile(".env");
} catch {
  // Sin .env: se usan variables del entorno y valores por defecto.
}
```

`packages/core/scripts/sembrar.ts`:
```ts
import "./cargar-env";
import { cargarConfig, crearContexto, sembrarDatosIniciales, validarRuc } from "../src/index";

const e = process.env;
const faltantes = ["EMPRESA_RUC", "EMPRESA_RAZON_SOCIAL", "EMPRESA_DIRECCION", "EMPRESA_UBIGEO", "EMPRESA_REGISTRO_MTC", "VEHICULO_PLACA", "CONDUCTOR_DNI", "CONDUCTOR_NOMBRES", "CONDUCTOR_APELLIDOS", "CONDUCTOR_LICENCIA", "USUARIO_NOMBRE", "USUARIO_EMAIL"].filter((k) => !e[k]);
if (faltantes.length) {
  console.error(`Completa en .env: ${faltantes.join(", ")}`);
  process.exit(1);
}
if (!validarRuc(e.EMPRESA_RUC!)) {
  console.error("EMPRESA_RUC no es un RUC válido");
  process.exit(1);
}

const { ctx, cerrar } = await crearContexto(cargarConfig());
try {
  await sembrarDatosIniciales(ctx.db, {
    empresa: {
      ruc: e.EMPRESA_RUC!, razonSocial: e.EMPRESA_RAZON_SOCIAL!, direccion: e.EMPRESA_DIRECCION!, ubigeo: e.EMPRESA_UBIGEO!,
      registroMtc: e.EMPRESA_REGISTRO_MTC!, ...(e.EMPRESA_CUENTA_DETRACCION ? { cuentaDetraccionBn: e.EMPRESA_CUENTA_DETRACCION } : {}),
    },
    vehiculo: { placa: e.VEHICULO_PLACA! },
    conductor: { numeroDoc: e.CONDUCTOR_DNI!, nombres: e.CONDUCTOR_NOMBRES!, apellidos: e.CONDUCTOR_APELLIDOS!, licencia: e.CONDUCTOR_LICENCIA! },
    usuario: { nombre: e.USUARIO_NOMBRE!, email: e.USUARIO_EMAIL!, ...(e.USUARIO_TELEGRAM_ID ? { telegramId: Number(e.USUARIO_TELEGRAM_ID) } : {}) },
  });
  console.log("Datos iniciales cargados.");
} finally {
  await cerrar();
}
```

`packages/core/scripts/demo.ts`:
```ts
import "./cargar-env";
import { empresa } from "@sunatapp/db";
import {
  cargarConfig, crearContexto, emitirFactura, emitirGuia, formatearSoles, listarCobrosPendientes, prepararFactura,
  registrarCobro, registrarGuiaBorrador, sembrarDatosIniciales,
} from "../src/index";

const config = cargarConfig();
const { ctx, cerrar } = await crearContexto(config);
try {
  if ((await ctx.db.select().from(empresa)).length === 0) {
    console.log("Sin datos iniciales: cargando empresa de demostración…");
    await sembrarDatosIniciales(ctx.db, {
      empresa: { ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", direccion: "AV. DEMO 123", ubigeo: "150115", registroMtc: "15123456CNG", cuentaDetraccionBn: "00-045-091619" },
      vehiculo: { placa: "ABC-123" },
      conductor: { numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" },
      usuario: { nombre: "Demo", email: "demo@demo.pe" },
    });
  }
  console.log(`Modo SUNAT: ${config.sunatModo}`);

  const guiaId = await registrarGuiaBorrador(ctx, {
    fechaTraslado: new Date().toISOString().slice(0, 10),
    remitente: { numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA DEMO SAC" },
    destinatario: { numeroDoc: "20602712592", razonSocial: "CLIENTE FINAL DEMO SAC" },
    partida: { direccion: "AV. 28 DE JULIO 1275", ubigeo: "150115" },
    llegada: { direccion: "CARRETERA FEDERICO BASADRE KM 86", ubigeo: "250101" },
    pesoBruto: "1500",
    unidadPeso: "KGM",
    greRemitenteRef: "EG01-123",
    items: [{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }],
  });
  const guia = await emitirGuia(ctx, guiaId);
  console.log(`Guía ${guia.serieNumero}: ${guia.estado} ${guia.mensaje ?? ""}`);
  if (guia.rutaPdf) console.log(`  PDF: ${ctx.almacen.rutaAbsoluta(guia.rutaPdf)}`);
  if (guia.estado !== "aceptada") process.exit(1);

  const { facturaId, montos } = await prepararFactura(ctx, { guiaId, montoCentimos: 150000, incluyeIgv: true, formaPago: "credito", diasCredito: 30 });
  console.log(`Factura preparada: total ${formatearSoles(montos.total)}, detracción ${formatearSoles(montos.detraccionMonto)}`);
  const fac = await emitirFactura(ctx, facturaId);
  console.log(`Factura ${fac.serieNumero}: ${fac.estado} ${fac.mensaje ?? ""}`);
  if (fac.rutaPdf) console.log(`  PDF: ${ctx.almacen.rutaAbsoluta(fac.rutaPdf)}`);

  if (fac.estado === "aceptada" || fac.estado === "observada") {
    await registrarCobro(ctx, { facturaId, montoCentimos: 50000, fecha: new Date().toISOString().slice(0, 10), medio: "transferencia" });
    const cobros = await listarCobrosPendientes(ctx);
    console.log(`Por cobrar: ${formatearSoles(cobros.totalPendiente)} (vencido ${formatearSoles(cobros.totalVencido)})`);
  }
} finally {
  await cerrar();
}
```

Modificar scripts de `package.json` raíz:
```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "pnpm -r exec tsc --noEmit",
    "sembrar": "tsx packages/core/scripts/sembrar.ts",
    "demo": "tsx packages/core/scripts/demo.ts",
    "ubigeos": "tsx packages/core/scripts/generar-ubigeos.ts"
  }
```

- [ ] **Step 2: README**

`README.md`:
````markdown
# SUNATAPP

App para empresa de transporte: guía de remisión transportista, factura del flete y cobros, conectada a SUNAT.

## Requisitos
Node 24+, pnpm 9.

## Uso local
```bash
pnpm install
cp .env.example .env      # SUNAT_MODO=simulado por defecto
pnpm test                 # todas las pruebas
pnpm demo                 # flujo completo: guía → factura → cobro (archivos en storage/)
```

## Modos SUNAT
- `simulado`: nada sale a internet; PDFs marcados "DOCUMENTO SIMULADO".
- `beta`: guías simuladas; facturas al ambiente beta oficial de SUNAT.
- `real`: requiere certificado `.pfx`, usuario SOL secundario y credenciales API SUNAT (ver spec, sección 13).

## Documentación
- Diseño: `docs/superpowers/specs/2026-09-13-mvp-gre-transportista-design.md`
- Planes: `docs/superpowers/plans/`
````

- [ ] **Step 3: Verificación completa**

Run: `pnpm test`
Expected: PASS en los paquetes `@sunatapp/core`, `@sunatapp/db`, `@sunatapp/sunat`, `@sunatapp/pdf`.

Run: `pnpm typecheck`
Expected: sin errores. Corregir cualquier error de tipos antes de continuar.

Run: `pnpm demo`
Expected en la primera ejecución (modo simulado; la guía tarda ~6 s por la demora simulada y la espera del ticket):
```
Modo SUNAT: simulado
Guía V001-1: aceptada (SIMULADO) El comprobante V001-1 ha sido aceptado
  PDF: ...\storage\guias\20606433094-31-V001-1.pdf
Factura preparada: total S/ 1,500.00, detracción S/ 60.00
Factura F001-1: aceptada (SIMULADO) El comprobante F001-1 ha sido aceptado
  PDF: ...\storage\facturas\20606433094-01-F001-1.pdf
Por cobrar: S/ 940.00 (vencido S/ 0.00)
```
Abrir ambos PDF y revisar a ojo que se lean bien (datos, QR, sello "DOCUMENTO SIMULADO").

- [ ] **Step 4 (opcional, requiere internet): validar la factura en SUNAT beta**

Run (PowerShell): `$env:SUNAT_MODO="beta"; $env:DATA_DIR="./data-beta"; $env:STORAGE_DIR="./storage-beta"; pnpm demo`
Expected: `Factura F001-1: aceptada` u `observada`. Si SUNAT rechaza por el tipo de operación `1001` con código `027`, anotar el código y mensaje exactos y reportarlo antes de cambiar a `1004` (decisión a tomar con el usuario, ver spec §6).

- [ ] **Step 5: Commit**

```bash
git add package.json README.md packages/core/scripts
git commit -m "feat: scripts de sembrado y demo de punta a punta"
```

---

## Cobertura del spec (autorrevisión)

| Spec | Tarea |
|------|-------|
| §3 arquitectura y reglas de dependencia | 1, 3, 4, 9, 10 |
| §4.1 validación de guía (RUC, DNI, ubigeo, peso, fecha) | 2, 11 |
| §4.1 emisión GRE-T, rechazo con código | 5, 11 |
| §4.2 factura, IGV, detracción configurable, cliente remitente por defecto | 1, 6, 12 |
| §4.3 cobros, parciales, vencidas, vence hoy | 12 |
| §5 modelo de datos, estados, correlativos atómicos | 3, 11, 12 |
| §6 modos simulado / beta / real, fallas, idempotencia, secretos | 7, 8, 10, 11, 12 |
| §7 extractor | **Plan 2** |
| §4 bot, comandos, aviso diario | **Plan 2** |
| §8 PDF con QR | 9, 11, 12 |
| §9 web | **Plan 3** |
| §10 pruebas unitarias, XML/XSD, integración | todas |
| §11 criterio 2 (XSD) y 5 (cambio de modo por configuración) | 5, 6, 10 |

