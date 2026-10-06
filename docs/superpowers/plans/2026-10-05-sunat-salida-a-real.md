# Salida a SUNAT real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño solo tramite sus accesos en SOL y los pegue en Ajustes → Este dispositivo para emitir guías de transportista y facturas del flete (tipo 1004) con validez ante SUNAT, sin riesgo de bloquear su usuario SOL.

**Architecture:**
- `packages/sunat` aprende tres cosas:
  - a clasificar las respuestas de SUNAT (credenciales, no disponible, rechazo, ya registrado);
  - a recuperar el CDR con `getStatusCdr`;
  - a armar la factura 1004 con `cac:Delivery`.
- `packages/core` agrega:
  - el valor referencial (tabla por ruta de ubigeos y datos del vehículo);
  - la pausa de SUNAT (ajuste local);
  - la prueba de conexión;
  - la factura automática.
- La web y el bot solo muestran y piden lo mínimo.

**Tech Stack:** TypeScript (Node ≥22), pnpm 9 monorepo, vitest, drizzle-orm + PGlite/Postgres, Hono JSX (web), grammY (bot).

**Spec:** `docs/superpowers/specs/2026-10-05-sunat-salida-a-real-design.md`

## Global Constraints

- Idioma de la app, mensajes y comentarios: **español**, tono simple para un dueño no técnico.
- Montos en **céntimos enteros** (`centimos(...)` en el esquema); nunca `number` con decimales para dinero.
- La migración nueva es **`0013_sunat_real`** (la 0012 de `main` es `costos_fijos`).
- Toda tabla nueva que se sincroniza lleva las columnas `sinc_uid, sinc_disp, sinc_num, sinc_creado, sinc_tocado`, índice único en `sinc_uid`, los triggers `sinc_marcar`/`sinc_lapida` y su entrada en `TABLAS` (`packages/core/src/sincro/registro.ts`).
- Ajustes **locales** (no sincronizan): `sunat_pausa`, `sunat_primera_real`. Ajuste **sincronizado**: `factura_automatica`.
- Ningún cambio llama a SUNAT de verdad en las pruebas: siempre `fetch` falso o `SunatSimulado`.
- **Nunca** reintentar automáticamente con credenciales rechazadas.
- Fórmula provisional de VR 01 = `max(VR02, 0.9 × VR03)` en una sola constante `FACTOR_CARGA_UTIL_MINIMA = 0.9`, con `FORMULA_VR_VERIFICADA = false` hasta la Tarea 1.
- Comandos: `pnpm test` (vitest en todo el repo), `pnpm typecheck`, `pnpm vitest run <ruta>` para un archivo.
- Commits en español, terminando con la línea `Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW`.

## Review Focus

- **Guía o factura emitida mientras SUNAT está en pausa** → queda pendiente con el mensaje "SUNAT en pausa…", sin sumar intentos y sin llamar al gateway (Tareas 7 y 8).
- **Ruta sin valor referencial cuando la factura no lleva detracción (≤ S/ 400)** → la factura sale igual con `0101`, sin pedir nada (Tarea 6).
- **Peso de la guía en KGM vs TNE** → la carga efectiva en TM sale igual en ambos casos (Tarea 3).
- **Fault 1033 en ambiente beta** (sin `billConsultService`) → rechazo con el código original, nunca un bucle de reintentos (Tarea 2).
- **Guardar ajustes con modo Real después de una prueba hecha con otras claves** → se bloquea (Tarea 10).

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `docs/superpowers/notas/2026-10-05-valor-referencial-mtc.md` (nuevo) | Fórmula VR verificada contra la norma, con un ejemplo numérico |
| `packages/sunat/src/tipos.ts` | `SunatCredencialesError`, método `consultarCdrFactura` en el gateway |
| `packages/sunat/src/faults.ts` (nuevo) | `clasificarFault(codigo)` |
| `packages/sunat/src/real.ts` | Códigos de ticket, credenciales, `getStatusCdr`, `probarClaveSol`, `probarCredencialesGre` |
| `packages/sunat/src/simulado.ts`, `mixto.ts` | `consultarCdrFactura` |
| `packages/sunat/src/valor-referencial.ts` (nuevo) | Cálculo puro de VR 01/02/03 y base de detracción |
| `packages/sunat/src/ubl/factura.ts` | `listID 1004` + `cac:Delivery` |
| `packages/db/src/schema.ts`, `packages/db/drizzle/0013_sunat_real.sql` | Tabla `valor_referencial_ruta`, columnas en `vehiculo` y `factura` |
| `packages/core/src/sincro/registro.ts` | Sincroniza `valor_referencial_ruta` y el ajuste `factura_automatica` |
| `packages/core/src/facturas/transporte.ts` (nuevo) | VR por ruta (CRUD), datos de transporte de una guía, `FaltaDatoTransporteError` |
| `packages/core/src/facturas/preparar.ts`, `emitir.ts` | Usan VR; detracción sobre el mayor; `en_proceso` no es rechazo; pausa |
| `packages/core/src/sunat/pausa.ts` (nuevo) | Pausar, reanudar, leer; primera emisión real |
| `packages/core/src/guias/emitir.ts` | Respeta y activa la pausa |
| `packages/core/src/sunat/probar.ts` (nuevo) | Probar certificado, clave SOL y credenciales GRE |
| `packages/core/src/facturas/automatica.ts` (nuevo) | Factura sola al aceptarse la guía |
| `apps/web/src/paginas/dispositivo.tsx` | Probar conexión, bloqueo de Real, guía SOL, pausa, interruptor de factura automática |
| `apps/web/src/paginas/rutas.tsx`, `flota.tsx` | Valor referencial por ruta, configuración y carga útil del vehículo |
| `apps/bot/src/flujo-factura.ts`, `flujo-guia.ts`, `sesion.ts`, `textos.ts` | Pregunta del VR, aviso de primera real, factura automática |

---

### Task 1: Fijar la fórmula del valor referencial (investigación, sin código de producto)

**Files:**
- Create: `docs/superpowers/notas/2026-10-05-valor-referencial-mtc.md`

**Interfaces:**
- Produces: la fórmula de VR 01, VR 02 y VR 03 y un caso numérico que la Tarea 3 copia como prueba. Si la norma confirma algo distinto a la fórmula provisional, la Tarea 3 lo implementa y pone `FORMULA_VR_VERIFICADA = true`.

- [ ] **Step 1: Descargar la norma.** Buscar el texto vigente del **D.S. 010-2006-MTC** ("Tabla de Valores Referenciales para la aplicación del SPOT al transporte de bienes por vía terrestre") y sus modificatorias, en gob.pe/mtc o El Peruano. `cpe.sunat.gob.pe` y algunos sitios del Estado bloquean WebFetch: usar `curl -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128"` y guardar en el scratchpad. Leer también la R.S. 073-2006/SUNAT (detracción del transporte de bienes) y la página https://orientacion.sunat.gob.pe/detracciones-en-el-transporte-de-bienes-por-via-terrestre.

- [ ] **Step 2: Escribir la nota** con estas secciones exactas:

```markdown
# Valor referencial MTC para la factura 1004

## Fuentes
- (URL y fecha de cada norma leída)

## Definiciones (citadas textualmente)
- Valor referencial del servicio de transporte (DeliveryTerms 01):
- Valor referencial sobre la carga efectiva (DeliveryTerms 02):
- Valor referencial sobre la carga útil nominal (DeliveryTerms 03):
- Regla de carga mínima (si existe, p. ej. % de la carga útil):

## Fórmula que implementa la app
VR02 = ...
VR03 = ...
VR01 = ...
Base de la detracción = max(importe de la operación con IGV, VR01)
Detracción = 4 % × base, redondeada a soles enteros

## Caso numérico
vrPorTm = S/ 85.50, carga efectiva = 31.87 TM, carga útil nominal = 30.00 TM, total factura = S/ 2,500.00
VR02 = ..., VR03 = ..., VR01 = ..., base = ..., detracción = ...

## ¿Coincide con la fórmula provisional max(VR02, 0.9 × VR03)?
Sí / No (y qué cambia)
```

- [ ] **Step 3: Si no se encuentra la norma**, escribir en la nota "NO VERIFICADA" con las URLs intentadas. La Tarea 3 mantiene la fórmula provisional y `FORMULA_VR_VERIFICADA = false`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notas/2026-10-05-valor-referencial-mtc.md
git commit -m "docs: fórmula del valor referencial MTC para la factura 1004

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 2: Gateway SUNAT — credenciales, faults, ticket y CDR

**Files:**
- Create: `packages/sunat/src/faults.ts`
- Modify: `packages/sunat/src/tipos.ts`, `packages/sunat/src/real.ts`, `packages/sunat/src/simulado.ts`, `packages/sunat/src/mixto.ts`, `packages/sunat/src/index.ts`
- Test: `packages/sunat/test/real.test.ts`, `packages/sunat/test/faults.test.ts` (nuevo)

**Interfaces:**
- Produces:
  - `class SunatCredencialesError extends Error` (en `tipos.ts`)
  - `SunatGateway.consultarCdrFactura(c: { ruc: string; serie: string; numero: number }): Promise<RespuestaSunat | null>`
  - `type ClaseFault = "rechazo" | "ya_registrado" | "credenciales" | "no_disponible" | "otro"`; `clasificarFault(codigo: string): ClaseFault`
  - `SunatReal.probarClaveSol(): Promise<{ ok: boolean; mensaje: string }>`
  - `SunatReal.probarCredencialesGre(): Promise<{ ok: boolean; mensaje: string }>`
  - `ENDPOINT_CONSULTA_CDR` (constante exportada)

- [ ] **Step 1: Prueba de `clasificarFault`.** Crear `packages/sunat/test/faults.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clasificarFault } from "../src/faults";

describe("clasificarFault", () => {
  it.each([
    ["2800", "rechazo"], ["3999", "rechazo"], ["1034", "rechazo"], ["0151", "rechazo"], ["0161", "rechazo"],
    ["1032", "ya_registrado"], ["1033", "ya_registrado"],
    ["0101", "credenciales"], ["0102", "credenciales"], ["0104", "credenciales"], ["0111", "credenciales"], ["0112", "credenciales"],
    ["0109", "no_disponible"], ["0130", "no_disponible"], ["0200", "no_disponible"], ["0252", "no_disponible"],
    ["4000", "otro"], ["0001", "otro"], ["abc", "otro"],
  ] as const)("%s → %s", (codigo, clase) => {
    expect(clasificarFault(codigo)).toBe(clase);
  });
});
```

- [ ] **Step 2: Correr y ver que falla.** `pnpm vitest run packages/sunat/test/faults.test.ts`. Esperado: FAIL, "Cannot find module '../src/faults'".

- [ ] **Step 3: Implementar `packages/sunat/src/faults.ts`.**

```ts
export type ClaseFault = "rechazo" | "ya_registrado" | "credenciales" | "no_disponible" | "otro";

/**
 * Qué hacer con el código de un SOAP Fault de SUNAT (catálogo de errores 0100–3999):
 * - credenciales: usuario/clave/perfil SOL → pausar todo, nunca reintentar solo;
 * - ya_registrado: el número ya está en SUNAT → recuperar su CDR;
 * - no_disponible: servicio caído o error interno → reintento normal;
 * - rechazo: contenido, nombre o ZIP inválido → reintentar no lo arregla.
 */
export function clasificarFault(codigo: string): ClaseFault {
  if (!/^\d{4}$/.test(codigo)) return "otro";
  const n = Number(codigo);
  if (n === 1032 || n === 1033) return "ya_registrado";
  if ((n >= 101 && n <= 106) || (n >= 110 && n <= 113)) return "credenciales";
  if (n === 109 || (n >= 130 && n <= 149) || (n >= 200 && n <= 299)) return "no_disponible";
  if ((n >= 150 && n <= 199) || (n >= 1000 && n <= 3999)) return "rechazo";
  return "otro";
}
```

- [ ] **Step 4: Correr.** `pnpm vitest run packages/sunat/test/faults.test.ts`. Esperado: PASS.

- [ ] **Step 5: Pruebas nuevas de `SunatReal`.** Agregar al final de `packages/sunat/test/real.test.ts`. Reusa `fetchFalso`, `json`, `token`, `cred` y `CDR_OK`, que ya existen en el archivo, e importa `SunatCredencialesError` desde `../src/tipos` y `ENDPOINT_CONSULTA_CDR` desde `../src/real`.

```ts
const soapFault = (codigo: string) => () =>
  new Response(`<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/"><soap-env:Body><soap-env:Fault><faultcode>soap-env:Client.${codigo}</faultcode><faultstring>Detalle ${codigo}</faultstring></soap-env:Fault></soap-env:Body></soap-env:Envelope>`, { status: 500 });
const statusCdr = (codigo: string, contenidoB64?: string) => () =>
  new Response(`<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><ns2:getStatusCdrResponse xmlns:ns2="http://service.sunat.gob.pe"><statusCdr>${contenidoB64 ? `<content>${contenidoB64}</content>` : ""}<statusCode>${codigo}</statusCode><statusMessage>Mensaje ${codigo}</statusMessage></statusCdr></ns2:getStatusCdrResponse></S:Body></S:Envelope>`);

describe("SunatReal — credenciales y faults", () => {
  it("token OAuth 401 es SunatCredencialesError", async () => {
    const { fn } = fetchFalso([() => new Response("{}", { status: 401 })]);
    await expect(new SunatReal(cred, { fetch: fn }).enviarGuia({ nombreArchivo: "a", xml: "<a/>" })).rejects.toBeInstanceOf(SunatCredencialesError);
  });

  it("401 persistente tras renovar el token es SunatCredencialesError", async () => {
    const { fn } = fetchFalso([token, () => new Response("", { status: 401 }), token, () => new Response("", { status: 401 })]);
    await expect(new SunatReal(cred, { fetch: fn }).enviarGuia({ nombreArchivo: "a", xml: "<a/>" })).rejects.toBeInstanceOf(SunatCredencialesError);
  });

  it("fault 0102 es SunatCredencialesError; 0109 es SunatNoDisponibleError; 1034 es rechazo", async () => {
    await expect(new SunatReal(cred, { fetch: fetchFalso([soapFault("0102")]).fn }).enviarFactura({ nombreArchivo: "a", xml: "<a/>" }))
      .rejects.toBeInstanceOf(SunatCredencialesError);
    await expect(new SunatReal(cred, { fetch: fetchFalso([soapFault("0109")]).fn }).enviarFactura({ nombreArchivo: "a", xml: "<a/>" }))
      .rejects.toBeInstanceOf(SunatNoDisponibleError);
    expect(await new SunatReal(cred, { fetch: fetchFalso([soapFault("1034")]).fn }).enviarFactura({ nombreArchivo: "a", xml: "<a/>" }))
      .toMatchObject({ estado: "rechazada", codigo: "1034" });
  });

  it("fault 1033 en producción recupera el CDR con getStatusCdr", async () => {
    const cdr = (await zipArchivo("R-x.xml", CDR_OK)).toString("base64");
    const { fn, llamadas } = fetchFalso([soapFault("1033"), statusCdr("0004", cdr)]);
    const r = await new SunatReal({ ...cred, ambienteFactura: "produccion" }, { fetch: fn })
      .enviarFactura({ nombreArchivo: "20606433094-01-F001-7", xml: "<f/>" });
    expect(r).toMatchObject({ estado: "aceptada", codigo: "0" });
    expect(llamadas[1]!.url).toBe(ENDPOINT_CONSULTA_CDR);
    const sobre = String(llamadas[1]!.init.body);
    expect(sobre).toContain("<rucComprobante>20606433094</rucComprobante>");
    expect(sobre).toContain("<serieComprobante>F001</serieComprobante>");
    expect(sobre).toContain("<numeroComprobante>7</numeroComprobante>");
  });

  it("fault 1033 en beta (sin consulta de CDR) es rechazo con el código original", async () => {
    const { fn, llamadas } = fetchFalso([soapFault("1033")]);
    expect(await new SunatReal(cred, { fetch: fn }).enviarFactura({ nombreArchivo: "20606433094-01-F001-7", xml: "<f/>" }))
      .toMatchObject({ estado: "rechazada", codigo: "1033" });
    expect(llamadas.length).toBe(1);
  });

  it("consultarCdrFactura devuelve null si SUNAT no tiene el comprobante", async () => {
    const { fn } = fetchFalso([statusCdr("0011")]);
    expect(await new SunatReal({ ...cred, ambienteFactura: "produccion" }, { fetch: fn }).consultarCdrFactura({ ruc: "20606433094", serie: "F001", numero: 9 })).toBeNull();
  });
});

describe("SunatReal — ticket GRE con códigos cortos", () => {
  it("98 en proceso, 0 aceptada con CDR, 99 rechazada", async () => {
    const cdrZip = (await zipArchivo("R-x.xml", CDR_OK)).toString("base64");
    const { fn } = fetchFalso([
      token,
      () => json({ codRespuesta: "98" }),
      () => json({ codRespuesta: "0", arcCdr: cdrZip }),
      () => json({ codRespuesta: "99", error: { numError: "2556", desError: "Placa no válida" } }),
    ]);
    const sunat = new SunatReal(cred, { fetch: fn });
    expect((await sunat.consultarTicket("T")).estado).toBe("en_proceso");
    expect(await sunat.consultarTicket("T")).toMatchObject({ estado: "aceptada" });
    expect(await sunat.consultarTicket("T")).toMatchObject({ estado: "rechazada", codigo: "2556" });
  });
});

describe("SunatReal — probar conexión", () => {
  it("probarCredencialesGre: ok con token, no ok con 401", async () => {
    expect(await new SunatReal(cred, { fetch: fetchFalso([token]).fn }).probarCredencialesGre()).toMatchObject({ ok: true });
    expect(await new SunatReal(cred, { fetch: fetchFalso([() => new Response("{}", { status: 401 })]).fn }).probarCredencialesGre())
      .toMatchObject({ ok: false, mensaje: expect.stringContaining("client_id") });
  });

  it("probarClaveSol: ok si SUNAT contesta la consulta; no ok con fault de credenciales", async () => {
    expect(await new SunatReal(cred, { fetch: fetchFalso([statusCdr("0011")]).fn }).probarClaveSol()).toMatchObject({ ok: true });
    expect(await new SunatReal(cred, { fetch: fetchFalso([soapFault("0102")]).fn }).probarClaveSol())
      .toMatchObject({ ok: false, mensaje: expect.stringContaining("clave SOL") });
  });
});
```

Además, en la prueba existente "un SOAP Fault con código 2xxx es rechazo; otro código es error", cambiar la parte de `0102`:

```ts
    const auth = fetchFalso([fault("0102")]);
    await expect(new SunatReal(cred, { fetch: auth.fn }).enviarFactura({ nombreArchivo: "a", xml: "<a/>" })).rejects.toBeInstanceOf(SunatCredencialesError);
```

- [ ] **Step 6: Correr y ver que falla.** `pnpm vitest run packages/sunat/test/real.test.ts`. Esperado: FAIL (falta `SunatCredencialesError`, `ENDPOINT_CONSULTA_CDR`, etc.).

- [ ] **Step 7: `tipos.ts`.** Agregar la clase y el método:

```ts
export interface SunatGateway {
  enviarGuia(doc: DocumentoFirmado): Promise<{ ticket: string }>;
  consultarTicket(ticket: string): Promise<RespuestaSunat>;
  enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat>;
  /** CDR de una factura ya registrada en SUNAT; null si SUNAT no la tiene o no se puede consultar. */
  consultarCdrFactura(c: { ruc: string; serie: string; numero: number }): Promise<RespuestaSunat | null>;
}

/** SUNAT rechazó el usuario/clave SOL o las credenciales API: no se debe reintentar solo. */
export class SunatCredencialesError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SunatCredencialesError";
  }
}
```

- [ ] **Step 8: `simulado.ts` y `mixto.ts`.** En `SunatSimulado`:

```ts
  async consultarCdrFactura(): Promise<RespuestaSunat | null> {
    return null;
  }
```

En `SunatMixto`:

```ts
  consultarCdrFactura(c: { ruc: string; serie: string; numero: number }): Promise<RespuestaSunat | null> {
    return this.facturas.consultarCdrFactura(c);
  }
```

Exportar `./faults` en `packages/sunat/src/index.ts` (`export * from "./faults";`).

- [ ] **Step 9: `real.ts`.** Cambios:

1. **Imports:**

```ts
import { clasificarFault } from "./faults";
import { SunatCredencialesError, SunatNoDisponibleError, type DocumentoFirmado, type RespuestaSunat, type SunatGateway } from "./tipos";

export const ENDPOINT_CONSULTA_CDR = "https://e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService";
```

2. **`obtenerToken`:** reemplazar `if (!resp.ok) throw new Error(...)` por:

```ts
    if (resp.status === 400 || resp.status === 401) {
      throw new SunatCredencialesError("SUNAT rechazó las credenciales de guías (client_id, client_secret, usuario o clave SOL)");
    }
    if (!resp.ok) throw new Error(`SUNAT rechazó el pedido de token (OAuth HTTP ${resp.status})`);
```

3. **`llamarGre`:** después del reintento por 401:

```ts
    if (resp.status === 401) throw new SunatCredencialesError("SUNAT no aceptó el permiso de las credenciales de guías");
```

4. **`consultarTicket`:** normalizar el código:

```ts
    const cod = String(Number(datos.codRespuesta));
    if (cod === "98") return { estado: "en_proceso", codigo: "98", mensaje: "En proceso", notas: [] };
    if (datos.arcCdr) return leerCdrZip(Buffer.from(datos.arcCdr, "base64"));
    if (cod === "0" || cod === "1") return { estado: "aceptada", codigo: "0", mensaje: "Aceptado", notas: [] };
```

Lo de abajo queda igual, es decir, rechazada con `error.numError`.

5. **Envoltura SOAP reutilizable.** Extraer el armado del sobre a un método privado `sobre(cuerpo: string): string` con el mismo `wsse:Security` de hoy. Agregar un método privado que hace la llamada y clasifica el fault:

```ts
  private async soap(url: string, accion: string, cuerpo: string): Promise<{ texto: string; fault?: { codigo: string; mensaje: string } }> {
    const resp = await this.llamar(url, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: accion }, body: this.sobre(cuerpo) });
    const texto = await resp.text();
    const m = texto.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>[\s\S]*?<faultstring[^>]*>([\s\S]*?)<\/faultstring>/);
    if (m) {
      const codigo = m[1]!.match(/(\d{4})\s*$/)?.[1] ?? m[1]!.trim();
      const mensaje = m[2]!.trim();
      const clase = clasificarFault(codigo);
      if (clase === "credenciales") throw new SunatCredencialesError(`SUNAT rechazó el usuario o la clave SOL (${codigo}: ${mensaje})`);
      if (clase === "no_disponible") throw new SunatNoDisponibleError(`SUNAT no disponible (${codigo}: ${mensaje})`);
      return { texto, fault: { codigo, mensaje } };
    }
    if (resp.status >= 500) throw new SunatNoDisponibleError(`SUNAT SOAP HTTP ${resp.status}`);
    return { texto };
  }
```

6. **`enviarFactura`:**

```ts
  async enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat> {
    const zip = await zipArchivo(`${doc.nombreArchivo}.xml`, doc.xml);
    const { texto, fault } = await this.soap(ENDPOINTS_FACTURA[this.cred.ambienteFactura], "urn:sendBill",
      `<ser:sendBill><fileName>${escape(doc.nombreArchivo)}.zip</fileName><contentFile>${zip.toString("base64")}</contentFile></ser:sendBill>`);
    if (fault) {
      const clase = clasificarFault(fault.codigo);
      if (clase === "ya_registrado") {
        const [ruc, , serie, numero] = doc.nombreArchivo.split("-");
        const cdr = this.cred.ambienteFactura === "produccion" && ruc && serie && numero
          ? await this.consultarCdrFactura({ ruc, serie, numero: Number(numero) })
          : null;
        return cdr ?? { estado: "rechazada", codigo: fault.codigo, mensaje: fault.mensaje, notas: [] };
      }
      if (clase === "rechazo") return { estado: "rechazada", codigo: fault.codigo, mensaje: fault.mensaje, notas: [] };
      throw new Error(`SUNAT SOAP ${fault.codigo}: ${fault.mensaje}`);
    }
    const cdr = texto.match(/<applicationResponse[^>]*>([\s\S]*?)<\/applicationResponse>/)?.[1];
    if (!cdr) throw new Error("Respuesta SOAP inesperada de SUNAT");
    return leerCdrZip(Buffer.from(cdr.trim(), "base64"));
  }
```

7. **`consultarCdrFactura`:**

```ts
  async consultarCdrFactura(c: { ruc: string; serie: string; numero: number }): Promise<RespuestaSunat | null> {
    const { texto, fault } = await this.soap(ENDPOINT_CONSULTA_CDR, "urn:getStatusCdr",
      `<ser:getStatusCdr><rucComprobante>${escape(c.ruc)}</rucComprobante><tipoComprobante>01</tipoComprobante><serieComprobante>${escape(c.serie)}</serieComprobante><numeroComprobante>${c.numero}</numeroComprobante></ser:getStatusCdr>`);
    if (fault) return null;
    const contenido = texto.match(/<content>([\s\S]*?)<\/content>/)?.[1]?.trim();
    return contenido ? leerCdrZip(Buffer.from(contenido, "base64")) : null;
  }
```

8. **Pruebas de conexión:**

```ts
  /** Comprueba usuario y clave SOL sin emitir nada: consulta un comprobante que no existe. */
  async probarClaveSol(): Promise<{ ok: boolean; mensaje: string }> {
    try {
      const { texto } = await this.soap(ENDPOINT_CONSULTA_CDR, "urn:getStatusCdr",
        `<ser:getStatusCdr><rucComprobante>${escape(this.cred.ruc)}</rucComprobante><tipoComprobante>01</tipoComprobante><serieComprobante>F999</serieComprobante><numeroComprobante>99999999</numeroComprobante></ser:getStatusCdr>`);
      if (/<statusCode>/.test(texto) || /<faultcode>/.test(texto)) return { ok: true, mensaje: "Usuario y clave SOL correctos" };
      return { ok: false, mensaje: "SUNAT respondió algo inesperado; vuelve a probar en unos minutos" };
    } catch (e) {
      if (e instanceof SunatCredencialesError) return { ok: false, mensaje: `SUNAT no aceptó tu usuario o clave SOL. ${e.message}` };
      return { ok: false, mensaje: `No se pudo conectar con SUNAT: ${(e as Error).message}` };
    }
  }

  /** Comprueba client_id/client_secret de guías pidiendo un permiso (token) que no se usa. */
  async probarCredencialesGre(): Promise<{ ok: boolean; mensaje: string }> {
    try {
      this.token = null;
      await this.obtenerToken();
      return { ok: true, mensaje: "Credenciales de guías correctas" };
    } catch (e) {
      if (e instanceof SunatCredencialesError) return { ok: false, mensaje: "SUNAT no aceptó el client_id / client_secret de guías (o el usuario y clave SOL)" };
      return { ok: false, mensaje: `No se pudo conectar con SUNAT: ${(e as Error).message}` };
    }
  }
```

- [ ] **Step 10: Correr las pruebas del paquete.** `pnpm vitest run packages/sunat`. Esperado: PASS. Si la prueba vieja de ticket "0001 aceptada con CDR" falla, revisar que `arcCdr` se lea antes de mirar el código.

- [ ] **Step 11: Typecheck.** `pnpm typecheck`. Esperado: errores en las implementaciones de `SunatGateway` en pruebas de `packages/core` y `apps/bot`, si alguna clase falsa implementa la interfaz. Agregar ahí `async consultarCdrFactura() { return null; }`. Buscarlas con `grep -rn "implements SunatGateway\|: SunatGateway = {" packages apps`.

- [ ] **Step 12: Commit**

```bash
git add packages/sunat packages/core apps
git commit -m "feat(sunat): credenciales rechazadas, faults clasificados, CDR con getStatusCdr y ticket GRE 98/0/99

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 3: Cálculo del valor referencial

**Files:**
- Create: `packages/sunat/src/valor-referencial.ts`, `packages/sunat/test/valor-referencial.test.ts`
- Modify: `packages/sunat/src/index.ts`

**Interfaces:**
- Consumes: nota de la Tarea 1.
- Produces:

```ts
export const FACTOR_CARGA_UTIL_MINIMA: number;   // 0.9 provisional
export const FORMULA_VR_VERIFICADA: boolean;     // false hasta confirmar
export function toneladas(peso: string, unidad: string): number; // "KGM" | "TNE"
export interface ValoresReferenciales { vrServicio: number; vrCargaEfectiva: number; vrCargaUtil: number } // céntimos
export function calcularValoresReferenciales(e: { vrPorTmCentimos: number; cargaEfectivaTm: number; cargaUtilTm: number }): ValoresReferenciales;
export function baseDetraccion(totalCentimos: number, vr: ValoresReferenciales | null): number;
```

- [ ] **Step 1: Prueba.** `packages/sunat/test/valor-referencial.test.ts`. Si la Tarea 1 verificó otra fórmula, reemplazar los números esperados por el caso numérico de la nota.

```ts
import { describe, expect, it } from "vitest";
import { baseDetraccion, calcularValoresReferenciales, toneladas } from "../src/valor-referencial";

describe("toneladas", () => {
  it("convierte KGM y respeta TNE", () => {
    expect(toneladas("31870", "KGM")).toBe(31.87);
    expect(toneladas("31.87", "TNE")).toBe(31.87);
  });
  it("rechaza unidades desconocidas", () => {
    expect(() => toneladas("10", "LBR")).toThrow("unidad de peso");
  });
});

describe("calcularValoresReferenciales", () => {
  it("carga efectiva mayor que el mínimo: VR01 = VR02", () => {
    const vr = calcularValoresReferenciales({ vrPorTmCentimos: 8550, cargaEfectivaTm: 31.87, cargaUtilTm: 30 });
    expect(vr).toEqual({ vrCargaEfectiva: 272489, vrCargaUtil: 256500, vrServicio: 272489 });
  });
  it("carga efectiva baja: VR01 = 90 % de la carga útil", () => {
    const vr = calcularValoresReferenciales({ vrPorTmCentimos: 8550, cargaEfectivaTm: 10, cargaUtilTm: 30 });
    expect(vr).toEqual({ vrCargaEfectiva: 85500, vrCargaUtil: 256500, vrServicio: 230850 });
  });
  it("rechaza valores no positivos", () => {
    expect(() => calcularValoresReferenciales({ vrPorTmCentimos: 0, cargaEfectivaTm: 1, cargaUtilTm: 1 })).toThrow();
  });
});

describe("baseDetraccion", () => {
  it("usa el mayor entre total y VR01", () => {
    const vr = { vrServicio: 272489, vrCargaEfectiva: 272489, vrCargaUtil: 256500 };
    expect(baseDetraccion(250000, vr)).toBe(272489);
    expect(baseDetraccion(300000, vr)).toBe(300000);
    expect(baseDetraccion(300000, null)).toBe(300000);
  });
});
```

- [ ] **Step 2: Correr y ver que falla.** `pnpm vitest run packages/sunat/test/valor-referencial.test.ts`. Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar** `packages/sunat/src/valor-referencial.ts`:

```ts
/**
 * Valores referenciales del SPOT para el transporte de carga (D.S. 010-2006-MTC). La factura 1004
 * los exige en cac:Delivery/cac:DeliveryTerms (01 servicio, 02 carga efectiva, 03 carga útil).
 * Ver docs/superpowers/notas/2026-10-05-valor-referencial-mtc.md.
 */
export const FACTOR_CARGA_UTIL_MINIMA = 0.9;
/** false mientras la fórmula de VR01 no se haya contrastado con el texto de la norma. */
export const FORMULA_VR_VERIFICADA = false;

export interface ValoresReferenciales {
  vrServicio: number;
  vrCargaEfectiva: number;
  vrCargaUtil: number;
}

export function toneladas(peso: string, unidad: string): number {
  const n = Number(peso);
  if (!(n > 0)) throw new Error(`Peso no válido: ${peso}`);
  if (unidad === "TNE") return Math.round(n * 1000) / 1000;
  if (unidad === "KGM") return Math.round(n) / 1000;
  throw new Error(`No se conoce la unidad de peso ${unidad} (se esperaba KGM o TNE)`);
}

export function calcularValoresReferenciales(e: { vrPorTmCentimos: number; cargaEfectivaTm: number; cargaUtilTm: number }): ValoresReferenciales {
  if (!(e.vrPorTmCentimos > 0) || !(e.cargaEfectivaTm > 0) || !(e.cargaUtilTm > 0)) {
    throw new Error("El valor referencial por TM, la carga efectiva y la carga útil deben ser mayores que cero");
  }
  const vrCargaEfectiva = Math.round(e.vrPorTmCentimos * e.cargaEfectivaTm);
  const vrCargaUtil = Math.round(e.vrPorTmCentimos * e.cargaUtilTm);
  const vrServicio = Math.max(vrCargaEfectiva, Math.round(vrCargaUtil * FACTOR_CARGA_UTIL_MINIMA));
  return { vrServicio, vrCargaEfectiva, vrCargaUtil };
}

/** La detracción del transporte de carga se calcula sobre el mayor entre el importe y el VR del servicio. */
export function baseDetraccion(totalCentimos: number, vr: ValoresReferenciales | null): number {
  return vr ? Math.max(totalCentimos, vr.vrServicio) : totalCentimos;
}
```

Agregar `export * from "./valor-referencial";` en `packages/sunat/src/index.ts`.

- [ ] **Step 4: Correr.** `pnpm vitest run packages/sunat/test/valor-referencial.test.ts`. Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sunat
git commit -m "feat(sunat): cálculo de valores referenciales MTC y base de la detracción

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 4: XML de la factura 1004

**Files:**
- Modify: `packages/sunat/src/ubl/factura.ts`, `packages/sunat/test/datos-prueba.ts`, `packages/sunat/test/factura.test.ts`

**Interfaces:**
- Consumes: `ValoresReferenciales` (Tarea 3).
- Produces: `DatosFactura.transporte?: TransporteFactura`.

```ts
export interface TransporteFactura {
  origen: { ubigeo: string; direccion: string };
  destino: { ubigeo: string; direccion: string };
  detalleViaje: string;
  vr: ValoresReferenciales;
  /** Opcional: solo genera observaciones si falta. */
  vehiculo?: { configuracion: string; cargaUtilTm: number; cargaEfectivaTm: number };
}
```

- [ ] **Step 1: Datos de prueba.** En `datosFacturaPrueba()` de `packages/sunat/test/datos-prueba.ts` agregar:

```ts
    transporte: {
      origen: { ubigeo: "150115", direccion: "AV. 28 DE JULIO 1275, LA VICTORIA" },
      destino: { ubigeo: "250101", direccion: "CARRETERA FEDERICO BASADRE KM 86" },
      detalleViaje: "TRASLADO DE 1.501 TNE SEGUN GRE V001-1: LA VICTORIA - PUCALLPA",
      vr: { vrServicio: 120000, vrCargaEfectiva: 120000, vrCargaUtil: 110000 },
      vehiculo: { configuracion: "T3S3", cargaUtilTm: 30, cargaEfectivaTm: 1.501 },
    },
```

- [ ] **Step 2: Pruebas.** En `packages/sunat/test/factura.test.ts`:
  - Cambiar la primera prueba: el nombre pasa a "con detracción usa operación 1004…" y `expect(xml).toContain('<cbc:InvoiceTypeCode listID="1001"')` pasa a `listID="1004"`.
  - Agregar estas pruebas:

```ts
  it("1004 lleva origen, destino, detalle y los tres valores referenciales en la línea", () => {
    const xml = construirXmlFactura(datosFacturaPrueba());
    const linea = xml.slice(xml.indexOf("<cac:InvoiceLine>"));
    expect(linea.indexOf("<cac:Delivery>")).toBeGreaterThan(linea.indexOf("</cac:PricingReference>"));
    expect(linea.indexOf("<cac:Delivery>")).toBeLessThan(linea.indexOf("<cac:TaxTotal>"));
    expect(linea).toContain('<cac:DeliveryLocation><cac:Address><cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">250101</cbc:ID>');
    expect(linea).toContain("<cbc:Instructions>TRASLADO DE 1.501 TNE SEGUN GRE V001-1: LA VICTORIA - PUCALLPA</cbc:Instructions>");
    expect(linea).toContain('<cac:DespatchAddress><cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">150115</cbc:ID>');
    expect(linea).toContain('<cac:DeliveryTerms><cbc:ID>01</cbc:ID><cbc:Amount currencyID="PEN">1200.00</cbc:Amount></cac:DeliveryTerms>');
    expect(linea).toContain('<cac:DeliveryTerms><cbc:ID>02</cbc:ID><cbc:Amount currencyID="PEN">1200.00</cbc:Amount></cac:DeliveryTerms>');
    expect(linea).toContain('<cac:DeliveryTerms><cbc:ID>03</cbc:ID><cbc:Amount currencyID="PEN">1100.00</cbc:Amount></cac:DeliveryTerms>');
    expect(linea).toContain('<cbc:SizeTypeCode listAgencyName="PE:MTC" listName="Configuracion Vehícular">T3S3</cbc:SizeTypeCode>');
  });

  it("1004 sin datos del vehículo omite cac:Shipment", () => {
    const d = datosFacturaPrueba();
    delete d.transporte!.vehiculo;
    const xml = construirXmlFactura(d);
    expect(xml).toContain("<cac:Delivery>");
    expect(xml).not.toContain("<cac:Shipment>");
  });

  it("con detracción y sin datos de transporte falla con mensaje claro", () => {
    const d = datosFacturaPrueba();
    delete d.transporte;
    expect(() => construirXmlFactura(d)).toThrow("valor referencial");
  });

  it("firmada con 1004 completo cumple el XSD", async () => {
    const resultado = await validarXsd(firmarXml(construirXmlFactura(datosFacturaPrueba()), cert), "Invoice");
    expect(resultado.errores).toEqual([]);
  });
```

En la prueba "sin detracción usa operación 0101…", agregar `expect(xml).not.toContain("<cac:Delivery>");`.

- [ ] **Step 3: Correr y ver que falla.** `pnpm vitest run packages/sunat/test/factura.test.ts`. Esperado: FAIL (listID 1001, sin Delivery).

- [ ] **Step 4: Implementar en `factura.ts`.**
  - Importar `import type { ValoresReferenciales } from "../valor-referencial";`, definir `TransporteFactura` como arriba y agregar `transporte?: TransporteFactura;` a `DatosFactura`.
  - En `construirXmlFactura`, después de validar la cuenta de detracciones:

```ts
  if (conDetraccion && !d.transporte) {
    throw new Error("La factura con detracción de transporte (1004) necesita origen, destino y valor referencial");
  }
  const t = conDetraccion ? d.transporte! : null;
  const tnm = (n: number) => n.toFixed(2);
  const envio = t?.vehiculo
    ? `
        <cac:Shipment>
          <cbc:ID>01</cbc:ID>
          <cac:Consignment>
            <cbc:ID>1</cbc:ID>
            <cac:TransportHandlingUnit>
              <cac:TransportEquipment>
                <cbc:SizeTypeCode listAgencyName="PE:MTC" listName="Configuracion Vehícular">${x(t.vehiculo.configuracion)}</cbc:SizeTypeCode>
                <cbc:ReturnabilityIndicator>false</cbc:ReturnabilityIndicator>
              </cac:TransportEquipment>
              <cac:MeasurementDimension><cbc:AttributeID>01</cbc:AttributeID><cbc:Measure unitCode="TNE">${tnm(t.vehiculo.cargaUtilTm)}</cbc:Measure></cac:MeasurementDimension>
              <cac:MeasurementDimension><cbc:AttributeID>02</cbc:AttributeID><cbc:Measure unitCode="TNE">${tnm(t.vehiculo.cargaEfectivaTm)}</cbc:Measure></cac:MeasurementDimension>
            </cac:TransportHandlingUnit>
          </cac:Consignment>
        </cac:Shipment>`
    : "";
  const entrega = t
    ? `
    <cac:Delivery>
      <cac:DeliveryLocation><cac:Address><cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${x(t.destino.ubigeo)}</cbc:ID><cac:AddressLine><cbc:Line>${x(t.destino.direccion)}</cbc:Line></cac:AddressLine></cac:Address></cac:DeliveryLocation>
      <cac:Despatch>
        <cbc:Instructions>${x(t.detalleViaje.slice(0, 500))}</cbc:Instructions>
        <cac:DespatchAddress><cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${x(t.origen.ubigeo)}</cbc:ID><cac:AddressLine><cbc:Line>${x(t.origen.direccion)}</cbc:Line></cac:AddressLine></cac:DespatchAddress>
      </cac:Despatch>
      <cac:DeliveryTerms><cbc:ID>01</cbc:ID><cbc:Amount ${PEN}>${m(t.vr.vrServicio)}</cbc:Amount></cac:DeliveryTerms>
      <cac:DeliveryTerms><cbc:ID>02</cbc:ID><cbc:Amount ${PEN}>${m(t.vr.vrCargaEfectiva)}</cbc:Amount></cac:DeliveryTerms>
      <cac:DeliveryTerms><cbc:ID>03</cbc:ID><cbc:Amount ${PEN}>${m(t.vr.vrCargaUtil)}</cbc:Amount></cac:DeliveryTerms>${envio}
    </cac:Delivery>`
    : "";
```

  - Cambiar `listID="${conDetraccion ? "1001" : "0101"}"` por `listID="${conDetraccion ? "1004" : "0101"}"`.
  - Insertar `${entrega}` justo después de `</cac:PricingReference>` dentro de `cac:InvoiceLine`.
  - Las pruebas de `toContain` comparan la cadena sin saltos de línea dentro de `DeliveryLocation`, `DespatchAddress` y `DeliveryTerms`. Por eso esas tres piezas van en una sola línea, como arriba.

- [ ] **Step 5: Correr.** `pnpm vitest run packages/sunat/test/factura.test.ts`. Esperado: PASS. Si el XSD reporta orden inválido dentro de `Consignment`/`TransportHandlingUnit`, revisar el orden contra `packages/sunat/xsd/2.1/common/UBL-CommonAggregateComponents-2.1.xsd`: busca `name="ConsignmentType"` y `name="TransportHandlingUnitType"` y respeta su secuencia.

- [ ] **Step 6: Commit**

```bash
git add packages/sunat
git commit -m "feat(sunat): factura con detracción de transporte como operación 1004 con cac:Delivery

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 5: Base de datos — migración 0013

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/core/src/sincro/registro.ts`
- Create: `packages/db/drizzle/0013_sunat_real.sql` (generada y luego editada), `packages/db/drizzle/meta/0013_snapshot.json` y `_journal.json` (los genera drizzle-kit)
- Test: `packages/core/test/sincro.test.ts` (una prueba nueva)

**Interfaces:**
- Produces: `valorReferencialRuta` (tabla); columnas `vehiculo.configuracionVehicular: string | null`, `vehiculo.cargaUtilTm: string | null` (numeric), `factura.vrServicio | vrCargaEfectiva | vrCargaUtil: number | null` (céntimos), `factura.detalleViaje: string | null`.

- [ ] **Step 1: Esquema.** En `packages/db/src/schema.ts`:

En `vehiculo`, después de `semirremolque`:

```ts
  /** Configuración vehicular MTC de la combinación (p. ej. T3S3); en tracto+carreta va en el tracto. */
  configuracionVehicular: text("configuracion_vehicular"),
  /** Carga útil nominal de la combinación, en toneladas (para el valor referencial de la factura). */
  cargaUtilTm: numeric("carga_util_tm", { precision: 8, scale: 2 }),
```

En `factura`, después de `detraccionMonto`:

```ts
  /** Valores referenciales MTC (céntimos) y detalle del viaje de la factura 1004; null sin detracción. */
  vrServicio: centimos("vr_servicio"),
  vrCargaEfectiva: centimos("vr_carga_efectiva"),
  vrCargaUtil: centimos("vr_carga_util"),
  detalleViaje: text("detalle_viaje"),
```

Tabla nueva, junto a `ruta`:

```ts
/** Valor referencial MTC por tonelada de un origen → destino (ubigeos de la guía). Se pide una sola vez. */
export const valorReferencialRuta = pgTable("valor_referencial_ruta", {
  partidaUbigeo: text("partida_ubigeo").notNull(),
  llegadaUbigeo: text("llegada_ubigeo").notNull(),
  vrPorTm: centimos("vr_por_tm").notNull(),
  fuente: text("fuente"),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.partidaUbigeo, t.llegadaUbigeo] })]);
```

- [ ] **Step 2: Generar la migración.** `pnpm --filter @sunatapp/db generar --name sunat_real`. Esperado: se crean `packages/db/drizzle/0013_sunat_real.sql` y `meta/0013_snapshot.json`, y se actualiza `_journal.json`.

- [ ] **Step 3: Editar el SQL generado.**
  1. En el `CREATE TABLE "valor_referencial_ruta"`, antes del cierre `);`, agregar la línea de sincronización (con coma en la línea anterior):

```sql
	"sinc_uid" text, "sinc_disp" text, "sinc_num" bigint, "sinc_creado" bigint, "sinc_tocado" bigint
```

  2. Al final del archivo, copiar **completa** la función `CREATE OR REPLACE FUNCTION "sinc_marcar"()` de `packages/db/drizzle/0012_costos_fijos.sql`, desde la línea `CREATE OR REPLACE FUNCTION "sinc_marcar"()` hasta `END $$;` y su `--> statement-breakpoint`. Dentro del `CASE TG_TABLE_NAME`, antes de `ELSE NULL END;`, agregar:

```sql
      WHEN 'valor_referencial_ruta' THEN (SELECT 'vr:' || (j->>'partida_ubigeo') || ':' || (j->>'llegada_ubigeo'))
```

  3. Después agregar:

```sql
CREATE UNIQUE INDEX "valor_referencial_ruta_sinc_uid" ON "valor_referencial_ruta" ("sinc_uid");--> statement-breakpoint
CREATE TRIGGER "valor_referencial_ruta_sinc" BEFORE INSERT OR UPDATE ON "valor_referencial_ruta" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();--> statement-breakpoint
CREATE TRIGGER "valor_referencial_ruta_sinc_lapida" AFTER DELETE ON "valor_referencial_ruta" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
```

- [ ] **Step 4: Registro de sincronización.** En `packages/core/src/sincro/registro.ts`:
  - Agregar `{ nombre: "valor_referencial_ruta" },` después de `{ nombre: "ruta_presupuesto" },`.
  - En la entrada de `ajuste`, agregar `'factura_automatica'` a la lista del filtro:

```ts
  { nombre: "ajuste", filtro: `clave in ('parametros_cotizador', 'presupuesto_mensual', 'telegram_chat_alertas', 'factura_automatica')` },
```

- [ ] **Step 5: Prueba de sincronización.** En `packages/core/test/sincro.test.ts`, buscar la prueba existente que sincroniza una `ruta` entre dos dispositivos (`grep -n "ruta" packages/core/test/sincro.test.ts`) y copiar su estructura en una prueba nueva. La prueba inserta en el dispositivo A `valorReferencialRuta` (`partidaUbigeo: "040101", llegadaUbigeo: "210101", vrPorTm: 8550`), sincroniza y comprueba en B:

```ts
    const filas = await b.ctx.db.select().from(valorReferencialRuta);
    expect(filas).toMatchObject([{ partidaUbigeo: "040101", llegadaUbigeo: "210101", vrPorTm: 8550 }]);
```

- [ ] **Step 6: Correr.** `pnpm vitest run packages/core/test/sincro.test.ts packages/core/test/infra.test.ts`. Esperado: PASS (las migraciones corren en PGlite al crear la base).

- [ ] **Step 7: Commit**

```bash
git add packages/db packages/core/src/sincro/registro.ts packages/core/test/sincro.test.ts
git commit -m "feat(db): valor referencial por ruta, configuración y carga útil del vehículo, VR en la factura (0013)

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 6: Núcleo — datos de transporte y factura preparada con VR

**Files:**
- Create: `packages/core/src/facturas/transporte.ts`
- Modify: `packages/core/src/facturas/preparar.ts`, `packages/core/src/facturas/emitir.ts`, `packages/core/src/dominio/montos.ts`, `packages/core/src/index.ts`, `packages/core/src/flota/unidades.ts`, `packages/core/test/helpers.ts`
- Test: `packages/core/test/facturas.test.ts`, `packages/core/test/montos.test.ts`

**Interfaces:**
- Consumes: `calcularValoresReferenciales`, `baseDetraccion`, `toneladas`, `TransporteFactura` (Tareas 3 y 4); tabla `valorReferencialRuta` (Tarea 5).
- Produces:

```ts
// facturas/transporte.ts
export class FaltaDatoTransporteError extends ErrorNegocio {
  constructor(readonly falta: { tipo: "vr_ruta"; partidaUbigeo: string; llegadaUbigeo: string; partida: string; llegada: string } | { tipo: "carga_util"; vehiculoId: number; placa: string });
}
export async function guardarValorReferencial(ctx: Contexto, e: { partidaUbigeo: string; llegadaUbigeo: string; vrPorTmCentimos: number; fuente?: string }): Promise<void>;
export async function listarValoresReferenciales(ctx: Contexto): Promise<Array<{ partidaUbigeo: string; llegadaUbigeo: string; vrPorTm: number; fuente: string | null }>>;
export async function borrarValorReferencial(ctx: Contexto, partidaUbigeo: string, llegadaUbigeo: string): Promise<void>;
export async function transporteDeGuia(ctx: Contexto, guiaId: number, db?: Ejecutor): Promise<{ transporte: TransporteFactura; vr: ValoresReferenciales }>;  // lanza FaltaDatoTransporteError
// dominio/montos.ts
calcularMontosFactura(e: { montoCentimos; incluyeIgv; detraccion; baseMinimaDetraccion?: number }): MontosFactura
// unidades.ts: EntradaUnidad + configuracionVehicular?: string | null; cargaUtilTm?: number | null
```

- [ ] **Step 1: Prueba de montos.** En `packages/core/test/montos.test.ts`:

```ts
  it("la detracción usa la base mínima (valor referencial) si es mayor que el total", () => {
    const m = calcularMontosFactura({ montoCentimos: 100000, incluyeIgv: false, detraccion: { porcentaje: 4, umbralCentimos: 40000 }, baseMinimaDetraccion: 300000 });
    expect(m).toMatchObject({ total: 118000, detraccionMonto: 12000, cobrable: 106000 });
  });
```

- [ ] **Step 2: Correr.** `pnpm vitest run packages/core/test/montos.test.ts`. Esperado: FAIL (4700 ≠ 12000).

- [ ] **Step 3: Implementar.** En `calcularMontosFactura`, agregar el parámetro opcional `baseMinimaDetraccion?: number` y cambiar el cálculo:

```ts
  const aplica = total > e.detraccion.umbralCentimos;
  const base = Math.max(total, e.baseMinimaDetraccion ?? 0);
  const detraccionMonto = aplica ? Math.round((base * e.detraccion.porcentaje) / 100 / 100) * 100 : 0;
```

El umbral de S/ 400 se sigue midiendo sobre el importe de la operación. Correr de nuevo: PASS.

- [ ] **Step 4: Datos del vehículo en `unidades.ts`.**
  - Agregar a `EntradaUnidad` `configuracionVehicular?: string | null; cargaUtilTm?: number | null;`.
  - En `actualizarUnidad`:

```ts
    if (e.configuracionVehicular !== undefined) cambios.configuracionVehicular = e.configuracionVehicular?.trim().toUpperCase() || null;
    if (e.cargaUtilTm !== undefined) {
      if (e.cargaUtilTm !== null && !(e.cargaUtilTm > 0)) throw new ErrorNegocio("La carga útil debe ser mayor que cero");
      cambios.cargaUtilTm = e.cargaUtilTm === null ? null : String(e.cargaUtilTm);
    }
```

  - En `crearUnidad`, pasar los mismos dos campos al `insert`:
    - `configuracionVehicular: e.configuracionVehicular?.trim().toUpperCase() || null`
    - `cargaUtilTm: e.cargaUtilTm == null ? null : String(e.cargaUtilTm)`

- [ ] **Step 5: Ayudante de prueba.** En `packages/core/test/helpers.ts` agregar:

```ts
import { valorReferencialRuta, vehiculo } from "@sunatapp/db";

/** Deja listo el valor referencial de la ruta de entradaGuia() y la carga útil del vehículo sembrado. */
export async function prepararDatosTransporte(ctx: Contexto): Promise<void> {
  await ctx.db.insert(valorReferencialRuta).values({ partidaUbigeo: "150115", llegadaUbigeo: "250101", vrPorTm: 8550 });
  await ctx.db.update(vehiculo).set({ configuracionVehicular: "T3S3", cargaUtilTm: "30" });
}
```

- [ ] **Step 6: Pruebas de factura.** En `packages/core/test/facturas.test.ts`:
  - **`contextoConGuia`:** después de `crearContextoPrueba`, llamar `await prepararDatosTransporte(r.ctx);`.
  - **Primera prueba de `prepararFactura`:** la guía de prueba pesa 1500.5 KGM (1.501 TM) con vrPorTm 8550 y carga útil 30. Entonces:
    - VR02 = round(8550 × 1.501) = 12834
    - VR03 = 256500
    - VR01 = max(12834, 230850) = 230850
    - base = max(118000, 230850) = 230850
    - detracción = round(230850 × 4 / 100 / 100) × 100 = 9200

  Cambiar el `toMatchObject` a `{ total: 118000, detraccionMonto: 9200, cobrable: 108800 }` y agregar:

```ts
    expect(f).toMatchObject({ vrServicio: 230850, vrCargaEfectiva: 12834, vrCargaUtil: 256500, detalleViaje: expect.stringContaining("V001-1") });
```

  - **Pruebas nuevas:**

```ts
  it("sin valor referencial de la ruta pide ese dato (FaltaDatoTransporteError)", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    await ctx.db.delete(valorReferencialRuta);
    const error = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" }).catch((e) => e);
    expect(error).toBeInstanceOf(FaltaDatoTransporteError);
    expect(error.falta).toMatchObject({ tipo: "vr_ruta", partidaUbigeo: "150115", llegadaUbigeo: "250101" });
  });

  it("sin carga útil del vehículo pide ese dato", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    await ctx.db.update(vehiculo).set({ cargaUtilTm: null });
    const error = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" }).catch((e) => e);
    expect(error.falta).toMatchObject({ tipo: "carga_util", placa: "ABC-123" });
  });

  it("sin detracción (≤ S/ 400) no pide valor referencial", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    await ctx.db.delete(valorReferencialRuta);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 30000, incluyeIgv: true, formaPago: "contado" });
    const r = await emitirFactura(ctx, facturaId);
    expect(r.estado).toBe("aceptada");
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(await ctx.almacen.leerTexto(f!.rutaXml!)).toContain('listID="0101"');
  });

  it("emitida con detracción lleva 1004 y cac:Delivery en el XML", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    await emitirFactura(ctx, facturaId);
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    const xml = await ctx.almacen.leerTexto(f!.rutaXml!);
    expect(xml).toContain('listID="1004"');
    expect(xml).toContain('<cac:DeliveryTerms><cbc:ID>01</cbc:ID><cbc:Amount currencyID="PEN">2308.50</cbc:Amount></cac:DeliveryTerms>');
  });
```

  Imports a agregar: `valorReferencialRuta, vehiculo` de `@sunatapp/db`, `FaltaDatoTransporteError` de `../src/facturas/transporte` y `prepararDatosTransporte` de `./helpers`. Ajustar a 9200 cualquier otra aserción del archivo que dependa de `detraccionMonto: 4700` o de "1133.00" (cuota neta = 118000 − 9200 = 108800 → "1088.00"); buscarlas con `grep -n "4700\|1133" packages/core/test/facturas.test.ts`.

- [ ] **Step 7: Correr y ver que falla.** `pnpm vitest run packages/core/test/facturas.test.ts`. Esperado: FAIL.

- [ ] **Step 8: Implementar `packages/core/src/facturas/transporte.ts`.**

```ts
import { and, empresa, eq, guiaTransportista, valorReferencialRuta, vehiculo, type Ejecutor } from "@sunatapp/db";
import { calcularValoresReferenciales, toneladas, type TransporteFactura, type ValoresReferenciales } from "@sunatapp/sunat";
import { ErrorNegocio } from "../errores";
import type { Contexto } from "../infra/contexto";

type Falta =
  | { tipo: "vr_ruta"; partidaUbigeo: string; llegadaUbigeo: string; partida: string; llegada: string }
  | { tipo: "carga_util"; vehiculoId: number; placa: string };

/** Falta un dato que se pide una sola vez (VR de la ruta o carga útil del vehículo) para la factura 1004. */
export class FaltaDatoTransporteError extends ErrorNegocio {
  constructor(readonly falta: Falta) {
    super(falta.tipo === "vr_ruta"
      ? `Falta el valor referencial MTC por tonelada de ${falta.partida} → ${falta.llegada}`
      : `Falta la carga útil (toneladas) de la unidad ${falta.placa}`);
    this.name = "FaltaDatoTransporteError";
  }
}

const corta = (direccion: string) => direccion.split(",").pop()!.trim().slice(0, 40);

export async function guardarValorReferencial(ctx: Contexto, e: { partidaUbigeo: string; llegadaUbigeo: string; vrPorTmCentimos: number; fuente?: string }): Promise<void> {
  if (!/^\d{6}$/.test(e.partidaUbigeo) || !/^\d{6}$/.test(e.llegadaUbigeo)) throw new ErrorNegocio("Los ubigeos deben tener 6 dígitos");
  if (!Number.isInteger(e.vrPorTmCentimos) || e.vrPorTmCentimos <= 0) throw new ErrorNegocio("El valor referencial debe ser mayor que cero");
  const valores = { vrPorTm: e.vrPorTmCentimos, fuente: e.fuente ?? null, actualizadoEn: ctx.reloj() };
  await ctx.db.insert(valorReferencialRuta).values({ partidaUbigeo: e.partidaUbigeo, llegadaUbigeo: e.llegadaUbigeo, ...valores })
    .onConflictDoUpdate({ target: [valorReferencialRuta.partidaUbigeo, valorReferencialRuta.llegadaUbigeo], set: valores });
}

export async function listarValoresReferenciales(ctx: Contexto) {
  return ctx.db.select({
    partidaUbigeo: valorReferencialRuta.partidaUbigeo, llegadaUbigeo: valorReferencialRuta.llegadaUbigeo,
    vrPorTm: valorReferencialRuta.vrPorTm, fuente: valorReferencialRuta.fuente,
  }).from(valorReferencialRuta).orderBy(valorReferencialRuta.partidaUbigeo, valorReferencialRuta.llegadaUbigeo);
}

export async function borrarValorReferencial(ctx: Contexto, partidaUbigeo: string, llegadaUbigeo: string): Promise<void> {
  await ctx.db.delete(valorReferencialRuta).where(and(eq(valorReferencialRuta.partidaUbigeo, partidaUbigeo), eq(valorReferencialRuta.llegadaUbigeo, llegadaUbigeo)));
}

/** Origen, destino, detalle y valores referenciales de la factura 1004, tomados de la guía. */
export async function transporteDeGuia(ctx: Contexto, guiaId: number, db: Ejecutor = ctx.db): Promise<{ transporte: TransporteFactura; vr: ValoresReferenciales }> {
  const [g] = await db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
  const [v] = await db.select().from(vehiculo).where(eq(vehiculo.id, g.vehiculoId));
  const [vr] = await db.select().from(valorReferencialRuta)
    .where(and(eq(valorReferencialRuta.partidaUbigeo, g.partidaUbigeo), eq(valorReferencialRuta.llegadaUbigeo, g.llegadaUbigeo)));
  if (!vr) {
    throw new FaltaDatoTransporteError({
      tipo: "vr_ruta", partidaUbigeo: g.partidaUbigeo, llegadaUbigeo: g.llegadaUbigeo,
      partida: corta(g.partidaDireccion), llegada: corta(g.llegadaDireccion),
    });
  }
  const cargaUtilTm = v?.cargaUtilTm ? Number(v.cargaUtilTm) : null;
  if (!v || !cargaUtilTm) throw new FaltaDatoTransporteError({ tipo: "carga_util", vehiculoId: g.vehiculoId, placa: v?.placa ?? "?" });
  const cargaEfectivaTm = toneladas(g.pesoBruto, g.unidadPeso);
  const valores = calcularValoresReferenciales({ vrPorTmCentimos: vr.vrPorTm, cargaEfectivaTm, cargaUtilTm });
  const detalleViaje = `TRASLADO DE ${cargaEfectivaTm.toFixed(3)} TNE SEGUN GRE ${g.serie}-${g.numero}: ${corta(g.partidaDireccion)} - ${corta(g.llegadaDireccion)}`;
  return {
    vr: valores,
    transporte: {
      origen: { ubigeo: g.partidaUbigeo, direccion: g.partidaDireccion },
      destino: { ubigeo: g.llegadaUbigeo, direccion: g.llegadaDireccion },
      detalleViaje,
      vr: valores,
      ...(v.configuracionVehicular ? { vehiculo: { configuracion: v.configuracionVehicular, cargaUtilTm, cargaEfectivaTm } } : {}),
    },
  };
}
```

Exportar desde `packages/core/src/index.ts`: `export * from "./facturas/transporte";`. Si `empresa` queda sin usar en el import, quitarlo. `Ejecutor` ya existe en `@sunatapp/db` (lo usa `sincro/registro.ts`).

- [ ] **Step 9: `prepararFactura`.** Dentro de la transacción, después de leer `emp` y `cliente`:

```ts
    // Solo una factura con detracción necesita los valores referenciales (1004).
    const sinVr = calcularMontosFactura({
      montoCentimos: e.montoCentimos, incluyeIgv: e.incluyeIgv,
      detraccion: { porcentaje: emp.detraccionPorcentaje, umbralCentimos: emp.detraccionUmbral },
    });
    const transporte = sinVr.detraccionMonto > 0 ? await transporteDeGuia(ctx, e.guiaId, tx) : null;
    const montos = transporte
      ? calcularMontosFactura({
          montoCentimos: e.montoCentimos, incluyeIgv: e.incluyeIgv,
          detraccion: { porcentaje: emp.detraccionPorcentaje, umbralCentimos: emp.detraccionUmbral },
          baseMinimaDetraccion: transporte.vr.vrServicio,
        })
      : sinVr;
```

Reemplazar el `calcularMontosFactura` actual por este bloque. En el `insert` de `factura` agregar:

```ts
        vrServicio: transporte?.vr.vrServicio ?? null,
        vrCargaEfectiva: transporte?.vr.vrCargaEfectiva ?? null,
        vrCargaUtil: transporte?.vr.vrCargaUtil ?? null,
        detalleViaje: transporte?.transporte.detalleViaje ?? null,
```

- [ ] **Step 10: `emitirFactura`.** En la rama que construye el XML (`construirXmlFactura({...})`), agregar el campo `transporte`, armado con los VR guardados en la factura y el origen y destino de la guía:

```ts
          ...(f.vrServicio !== null ? { transporte: await transporteGuardado(ctx, facturaId, f) } : {}),
```

con esta función local en `emitir.ts`:

```ts
/** Arma el bloque 1004 con los VR congelados en la factura (no se recalculan al reintentar). */
async function transporteGuardado(ctx: Contexto, facturaId: number, f: typeof factura.$inferSelect): Promise<TransporteFactura> {
  const [fg] = await ctx.db.select({ guiaId: facturaGuia.guiaId }).from(facturaGuia).where(eq(facturaGuia.facturaId, facturaId)).limit(1);
  const base = await transporteDeGuia(ctx, fg!.guiaId).catch(() => null);
  const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, fg!.guiaId));
  return {
    origen: { ubigeo: g!.partidaUbigeo, direccion: g!.partidaDireccion },
    destino: { ubigeo: g!.llegadaUbigeo, direccion: g!.llegadaDireccion },
    detalleViaje: f.detalleViaje!,
    vr: { vrServicio: f.vrServicio!, vrCargaEfectiva: f.vrCargaEfectiva!, vrCargaUtil: f.vrCargaUtil! },
    ...(base?.transporte.vehiculo ? { vehiculo: base.transporte.vehiculo } : {}),
  };
}
```

Importar `TransporteFactura` de `@sunatapp/sunat` y `transporteDeGuia` de `./transporte`. Como `construirXmlFactura` está dentro de un objeto literal, calcular `const transporte = f.vrServicio !== null ? await transporteGuardado(ctx, facturaId, f) : undefined;` antes de `firmarXml(...)` y usar `...(transporte ? { transporte } : {})`.

- [ ] **Step 11: Correr.** `pnpm vitest run packages/core`. Esperado: PASS. Si otras pruebas de `packages/core` o `apps/bot` preparan facturas > S/ 400 sin VR (`grep -rln "prepararFactura" packages/core/test apps/bot/test`), agregarles `await prepararDatosTransporte(ctx)` donde crean el contexto. Desde `apps/bot` se importa vía el reexport de `packages/core/test/helpers.ts` que ya usa `arnes.ts`; si no lo usa, insertar las mismas dos filas en el arnés.

- [ ] **Step 12: Correr todo.** `pnpm test`. Esperado: PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/core packages/sunat apps/bot/test
git commit -m "feat(core): factura 1004 con valores referenciales por ruta y vehículo; detracción sobre el mayor

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 7: Pausa de SUNAT y primera emisión real (núcleo)

**Files:**
- Create: `packages/core/src/sunat/pausa.ts`, `packages/core/test/pausa.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/infra/contexto.ts`

**Interfaces:**
- Produces:

```ts
export interface PausaSunat { desde: string; motivo: string }
export async function leerPausaSunat(ctx: Contexto): Promise<PausaSunat | null>;
/** true si recién se pausó (y se encoló el aviso); false si ya estaba pausada. */
export async function pausarSunat(ctx: Contexto, motivo: string): Promise<boolean>;
export async function reanudarSunat(ctx: Contexto): Promise<void>;
export const MENSAJE_EN_PAUSA: (motivo: string) => string;
export async function esPrimeraReal(ctx: Contexto, tipo: "guia" | "factura"): Promise<boolean>; // true solo en modo real sin aceptadas
export async function marcarPrimeraRealHecha(ctx: Contexto, tipo: "guia" | "factura"): Promise<void>;
```

- [ ] **Step 1: Prueba.** `packages/core/test/pausa.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { tomarAvisos } from "../src/eventos/eventos";
import { esPrimeraReal, leerPausaSunat, marcarPrimeraRealHecha, pausarSunat, reanudarSunat } from "../src/sunat/pausa";
import { crearContextoPrueba } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => { while (cerrables.length) await cerrables.pop()!(); });

async function ctxPrueba() {
  const r = await crearContextoPrueba();
  cerrables.push(r.cerrar);
  return r.ctx;
}

describe("pausa de SUNAT", () => {
  it("pausa una vez, avisa una vez y se reanuda", async () => {
    const ctx = await ctxPrueba();
    expect(await leerPausaSunat(ctx)).toBeNull();
    expect(await pausarSunat(ctx, "clave SOL rechazada")).toBe(true);
    expect(await pausarSunat(ctx, "otra vez")).toBe(false);
    expect(await leerPausaSunat(ctx)).toMatchObject({ motivo: "clave SOL rechazada" });
    const avisos = await tomarAvisos(ctx);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.texto).toContain("SUNAT en pausa");
    await reanudarSunat(ctx);
    expect(await leerPausaSunat(ctx)).toBeNull();
  });

  it("primera emisión real: solo en modo real y hasta marcarla", async () => {
    const ctx = await ctxPrueba();
    expect(await esPrimeraReal(ctx, "guia")).toBe(false); // simulado
    ctx.simulado = false;
    expect(await esPrimeraReal(ctx, "guia")).toBe(true);
    await marcarPrimeraRealHecha(ctx, "guia");
    expect(await esPrimeraReal(ctx, "guia")).toBe(false);
    ctx.facturaSimulada = false;
    expect(await esPrimeraReal(ctx, "factura")).toBe(true);
  });
});
```

- [ ] **Step 2: Correr.** `pnpm vitest run packages/core/test/pausa.test.ts`. Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar** `packages/core/src/sunat/pausa.ts`:

```ts
import { ajuste, eq } from "@sunatapp/db";
import { encolarAviso } from "../eventos/eventos";
import type { Contexto } from "../infra/contexto";

/**
 * **SUNAT en pausa.** Si SUNAT rechaza el usuario/clave SOL o las credenciales de guías, se deja de
 * enviar TODO hasta que el dueño corrija los ajustes: reintentar con una clave mala puede bloquear
 * el usuario SOL. Es un ajuste local (no se sincroniza): las claves son de cada dispositivo.
 */
const CLAVE_PAUSA = "sunat_pausa";
const CLAVE_PRIMERA = "sunat_primera_real";

export interface PausaSunat {
  desde: string;
  motivo: string;
}

export const MENSAJE_EN_PAUSA = (motivo: string) =>
  `⏸ SUNAT en pausa: ${motivo}. No se envía nada hasta que revises tus claves en Ajustes → Este dispositivo.`;

export async function leerPausaSunat(ctx: Contexto): Promise<PausaSunat | null> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, CLAVE_PAUSA));
  const v = f?.valor as Partial<PausaSunat> | undefined;
  return v?.motivo ? { desde: v.desde ?? "", motivo: v.motivo } : null;
}

export async function pausarSunat(ctx: Contexto, motivo: string): Promise<boolean> {
  if (await leerPausaSunat(ctx)) return false;
  const valor: PausaSunat = { desde: ctx.reloj().toISOString(), motivo };
  await ctx.db.insert(ajuste).values({ clave: CLAVE_PAUSA, valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: ctx.reloj() } });
  await encolarAviso(ctx, MENSAJE_EN_PAUSA(motivo));
  return true;
}

export async function reanudarSunat(ctx: Contexto): Promise<void> {
  await ctx.db.delete(ajuste).where(eq(ajuste.clave, CLAVE_PAUSA));
}

async function primera(ctx: Contexto): Promise<{ guia?: boolean; factura?: boolean }> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, CLAVE_PRIMERA));
  return (f?.valor as { guia?: boolean; factura?: boolean } | undefined) ?? {};
}

/** true si este dispositivo está en modo real y todavía no tuvo aceptado un documento de ese tipo. */
export async function esPrimeraReal(ctx: Contexto, tipo: "guia" | "factura"): Promise<boolean> {
  const real = tipo === "guia" ? !ctx.simulado : !ctx.facturaSimulada;
  if (!real) return false;
  return !(await primera(ctx))[tipo];
}

export async function marcarPrimeraRealHecha(ctx: Contexto, tipo: "guia" | "factura"): Promise<void> {
  const valor = { ...(await primera(ctx)), [tipo]: true };
  await ctx.db.insert(ajuste).values({ clave: CLAVE_PRIMERA, valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: ctx.reloj() } });
}
```

Exportar desde `packages/core/src/index.ts`: `export * from "./sunat/pausa";`.

- [ ] **Step 4: Reanudar al reconfigurar.** En `packages/core/src/infra/contexto.ts`, al final de `reconfigurarSunat`, después de asignar `ctx.facturaSimulada`:

```ts
  // Claves nuevas: lo que estaba en pausa por credenciales vuelve a intentarse.
  await reanudarSunat(ctx);
```

Importar `reanudarSunat` desde `../sunat/pausa`. Ojo: `crearContexto` llama `reconfigurarSunat` antes de que existan migraciones. Revisar en `crearDb` que las migraciones corren dentro de `crearDb` (`grep -n "migrate" packages/db/src/*.ts`); si corren ahí, no hay problema.

- [ ] **Step 5: Correr.** `pnpm vitest run packages/core/test/pausa.test.ts packages/core/test/infra.test.ts`. Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): pausa de SUNAT por credenciales y aviso de primera emisión real

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 8: Emisión de guías y facturas respeta la pausa

**Files:**
- Modify: `packages/core/src/guias/emitir.ts`, `packages/core/src/facturas/emitir.ts`
- Test: `packages/core/test/guias.test.ts`, `packages/core/test/facturas.test.ts`

**Interfaces:**
- Consumes: `leerPausaSunat`, `pausarSunat`, `MENSAJE_EN_PAUSA`, `marcarPrimeraRealHecha` (Tarea 7); `SunatCredencialesError` (Tarea 2).

- [ ] **Step 1: Pruebas.** Agregar en `packages/core/test/guias.test.ts`, usando su forma de crear contexto (`grep -n "crearContextoPrueba" packages/core/test/guias.test.ts`):

```ts
class GatewayContador implements SunatGateway {
  llamadas = 0;
  constructor(private readonly falla: Error | null) {}
  async enviarGuia(): Promise<{ ticket: string }> { this.llamadas++; if (this.falla) throw this.falla; return { ticket: "T" }; }
  async consultarTicket(): Promise<RespuestaSunat> { this.llamadas++; return { estado: "en_proceso", codigo: "98", mensaje: "", notas: [] }; }
  async enviarFactura(): Promise<RespuestaSunat> { this.llamadas++; if (this.falla) throw this.falla; return { estado: "aceptada", codigo: "0", mensaje: "", notas: [] }; }
  async consultarCdrFactura() { return null; }
}

describe("pausa por credenciales", () => {
  it("credenciales rechazadas pausan, no suman intento y detienen los siguientes envíos", async () => {
    const gw = new GatewayContador(new SunatCredencialesError("clave SOL rechazada"));
    const { ctx, cerrar } = await crearContextoPrueba({ gateway: gw });
    try {
      const g1 = await registrarGuiaBorrador(ctx, entradaGuia());
      const r1 = await emitirGuia(ctx, g1);
      expect(r1).toMatchObject({ estado: "pendiente_envio", mensaje: expect.stringContaining("SUNAT en pausa") });
      const [fila] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, g1));
      expect(fila!.intentos).toBe(0);
      expect(await leerPausaSunat(ctx)).not.toBeNull();

      const llamadasAntes = gw.llamadas;
      const g2 = await registrarGuiaBorrador(ctx, entradaGuia());
      expect((await emitirGuia(ctx, g2)).estado).toBe("pendiente_envio");
      await procesarPendientesGuias(ctx);
      expect(gw.llamadas).toBe(llamadasAntes);
    } finally {
      await cerrar();
    }
  });

  it("al reanudar se vuelve a enviar", async () => {
    const gw = new GatewayContador(null);
    const { ctx, cerrar } = await crearContextoPrueba({ gateway: gw });
    try {
      await pausarSunat(ctx, "prueba");
      const g = await registrarGuiaBorrador(ctx, entradaGuia());
      await emitirGuia(ctx, g);
      expect(gw.llamadas).toBe(0);
      await reanudarSunat(ctx);
      await emitirGuia(ctx, g, { esperarRespuesta: false });
      expect(gw.llamadas).toBe(1);
    } finally {
      await cerrar();
    }
  });
});
```

Imports: `SunatCredencialesError, type RespuestaSunat, type SunatGateway` de `@sunatapp/sunat`; `guiaTransportista, eq` de `@sunatapp/db`; `leerPausaSunat, pausarSunat, reanudarSunat` de `../src/sunat/pausa`; `procesarPendientesGuias` de `../src/guias/emitir`.

En `packages/core/test/facturas.test.ts` agregar:

```ts
  it("factura con credenciales rechazadas queda pendiente y pausa SUNAT", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    const base = ctx.gateway;
    ctx.gateway = {
      enviarGuia: (d) => base.enviarGuia(d), consultarTicket: (t) => base.consultarTicket(t), consultarCdrFactura: async () => null,
      enviarFactura: async () => { throw new SunatCredencialesError("clave SOL rechazada"); },
    } satisfies SunatGateway;
    const r = await emitirFactura(ctx, facturaId);
    expect(r).toMatchObject({ estado: "pendiente_envio", mensaje: expect.stringContaining("SUNAT en pausa") });
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f!.intentos).toBe(0);
    expect(await leerPausaSunat(ctx)).not.toBeNull();
  });

  it("una respuesta en_proceso no rechaza la factura", async () => {
    const gw = new SunatSimulado({ demoraMs: 0 });
    const { ctx, guiaId } = await contextoConGuia(gw);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    ctx.gateway = {
      enviarGuia: (d) => gw.enviarGuia(d), consultarTicket: (t) => gw.consultarTicket(t), consultarCdrFactura: async () => null,
      enviarFactura: async () => ({ estado: "en_proceso", codigo: "98", mensaje: "En proceso", notas: [] }),
    } satisfies SunatGateway;
    expect((await emitirFactura(ctx, facturaId)).estado).toBe("pendiente_envio");
  });
```

Los gateways falsos se arman como objetos literales con los cuatro métodos: copiar con `{ ...instancia }` no copia los métodos de una clase.

- [ ] **Step 2: Correr y ver que falla.** `pnpm vitest run packages/core/test/guias.test.ts packages/core/test/facturas.test.ts`. Esperado: FAIL.

- [ ] **Step 3: Guías (`guias/emitir.ts`).**

Imports: `SunatCredencialesError` de `@sunatapp/sunat`; `leerPausaSunat, marcarPrimeraRealHecha, MENSAJE_EN_PAUSA, pausarSunat` de `../sunat/pausa`.

Función local nueva:

```ts
/**
 * Deja la guía pendiente sin contar intento: espera a que se corrijan las claves. proximoIntentoEn
 * queda en null (sin lease) para que, al reanudar, emitirGuia o el fondo la envíen de inmediato.
 */
async function dejarEnPausa(ctx: Contexto, guiaId: number, motivo: string, extra: CambiosGuia = {}): Promise<void> {
  await actualizar(ctx, guiaId, { ...extra, proximoIntentoEn: null, codigoRespuesta: null, mensajeRespuesta: MENSAJE_EN_PAUSA(motivo) });
}
```

En `emitirGuia`, justo antes de `let ticket: string;`:

```ts
  const pausa = await leerPausaSunat(ctx);
  if (pausa) {
    await dejarEnPausa(ctx, guiaId, pausa.motivo, { rutaXml });
    return resultadoGuia(ctx, guiaId);
  }
```

En el `catch` de `ctx.gateway.enviarGuia`, al inicio:

```ts
    if (error instanceof SunatCredencialesError) {
      await pausarSunat(ctx, error.message);
      await dejarEnPausa(ctx, guiaId, error.message, { rutaXml });
      return resultadoGuia(ctx, guiaId);
    }
```

En el bucle de espera del ticket (`catch (error) { if (!(error instanceof SunatNoDisponibleError)) throw error; }`):

```ts
      } catch (error) {
        if (error instanceof SunatCredencialesError) {
          await pausarSunat(ctx, error.message);
          break;
        }
        if (!(error instanceof SunatNoDisponibleError)) throw error;
      }
```

En `procesarPendientesGuias`, al inicio:

```ts
  const pausada = (await leerPausaSunat(ctx)) !== null;
```

Envolver el `for (const g of candidatas)` en `if (!pausada) { ... }`; el barrido de PDF queda fuera. En el `catch` de ese bucle, antes de `if (error instanceof SunatNoDisponibleError) continue;`:

```ts
      if (error instanceof SunatCredencialesError) {
        await pausarSunat(ctx, error.message);
        break;
      }
```

En `aplicarRespuestaGuia`, cuando el estado aplicado es `aceptada` y `!ctx.simulado`, llamar `await marcarPrimeraRealHecha(ctx, "guia");` después de persistir el resultado.

- [ ] **Step 4: Facturas (`facturas/emitir.ts`).** Mismo patrón:
  - Función `dejarEnPausa` equivalente (con `actualizar` de facturas y también `proximoIntentoEn: null`).
  - Antes de `let r: RespuestaSunat;`, comprobar la pausa.
  - En el `catch` de `enviarFactura`, `SunatCredencialesError` → `pausarSunat` y `dejarEnPausa(ctx, facturaId, error.message, { rutaXml })`.
  - En `procesarPendientesFacturas`, `const pausada = ...` y saltar el bucle de envío si está pausada.
  - **`aplicarRespuestaSunat`:** separar `en_proceso` de `rechazada`:

```ts
  if (r.estado === "en_proceso") {
    // SUNAT no terminó de procesarla: se reintenta (si ya quedó registrada, el reenvío recupera su CDR).
    await actualizar(ctx, id, { rutaXml, proximoIntentoEn: new Date(ctx.reloj().getTime() + REINTENTO_MS), mensajeRespuesta: "SUNAT la está procesando; se consultará de nuevo" });
    return;
  }
  if (r.estado === "rechazada") {
```

  El resto del bloque de rechazo queda igual. Después de persistir `aceptada`/`observada`: `if (!ctx.facturaSimulada) await marcarPrimeraRealHecha(ctx, "factura");`.

- [ ] **Step 5: Correr.** `pnpm vitest run packages/core`. Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): guías y facturas se detienen con SUNAT en pausa; en_proceso no rechaza la factura

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 9: Probar conexión y factura automática (núcleo)

**Files:**
- Create: `packages/core/src/sunat/probar.ts`, `packages/core/src/facturas/automatica.ts`, `packages/core/test/probar.test.ts`, `packages/core/test/factura-automatica.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `SunatReal.probarClaveSol/probarCredencialesGre` (Tarea 2), `cargarPfx`, `prepararFactura`, `emitirFactura`, `transporteDeGuia`.
- Produces:

```ts
// sunat/probar.ts
export interface PuntoPrueba { ok: boolean; mensaje: string }
export interface ResultadoPruebaSunat { certificado: PuntoPrueba; claveSol: PuntoPrueba; credencialesGre: PuntoPrueba; todoOk: boolean; huella: string }
export interface DatosPrueba { pfx: Buffer | null; clavePfx: string; usuarioSol: string; claveSol: string; greClientId: string; greClientSecret: string }
export function huellaPrueba(d: DatosPrueba): string; // sha256 de los valores, para saber si se probó lo mismo que se guarda
export async function probarConexionSunat(ctx: Contexto, d: DatosPrueba, o?: { fetch?: typeof fetch; ahora?: Date }): Promise<ResultadoPruebaSunat>;
// facturas/automatica.ts
export async function facturaAutomaticaActiva(ctx: Contexto): Promise<boolean>;
export async function activarFacturaAutomatica(ctx: Contexto, activa: boolean): Promise<void>;
/** Emite la factura de una guía recién aceptada si se cumplen todas las condiciones; null si no aplica. */
export async function intentarFacturaAutomatica(ctx: Contexto, guiaId: number): Promise<ResultadoEmision | null>;
```

- [ ] **Step 1: Prueba de `probarConexionSunat`.** `packages/core/test/probar.test.ts`:

```ts
import { generarCertificadoPrueba } from "@sunatapp/sunat";
import { afterEach, describe, expect, it } from "vitest";
import { huellaPrueba, probarConexionSunat } from "../src/sunat/probar";
import { crearContextoPrueba } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => { while (cerrables.length) await cerrables.pop()!(); });

const statusCdr = () => new Response("<statusCdr><statusCode>0011</statusCode></statusCdr>");
const token = () => new Response(JSON.stringify({ access_token: "T", expires_in: 3600 }), { status: 200 });

function fetchSegun(map: { soap: () => Response; oauth: () => Response }): typeof fetch {
  return (async (url: string | URL) => (String(url).includes("oauth2") ? map.oauth() : map.soap())) as typeof fetch;
}

describe("probarConexionSunat", () => {
  it("todo ok con certificado del RUC de la empresa y SUNAT respondiendo", async () => {
    const { ctx, cerrar } = await crearContextoPrueba();
    cerrables.push(cerrar);
    const pfx = generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "clave123" });
    const d = { pfx, clavePfx: "clave123", usuarioSol: "USU1", claveSol: "x", greClientId: "id", greClientSecret: "s" };
    const r = await probarConexionSunat(ctx, d, { fetch: fetchSegun({ soap: statusCdr, oauth: token }) });
    expect(r).toMatchObject({ todoOk: true, certificado: { ok: true }, claveSol: { ok: true }, credencialesGre: { ok: true }, huella: huellaPrueba(d) });
  });

  it("certificado de otro RUC, clave de pfx mala y credenciales rechazadas", async () => {
    const { ctx, cerrar } = await crearContextoPrueba();
    cerrables.push(cerrar);
    const otro = generarCertificadoPrueba({ ruc: "20111111111", razonSocial: "OTRA SAC", password: "clave123" });
    const r1 = await probarConexionSunat(ctx, { pfx: otro, clavePfx: "clave123", usuarioSol: "U", claveSol: "x", greClientId: "i", greClientSecret: "s" },
      { fetch: fetchSegun({ soap: statusCdr, oauth: () => new Response("{}", { status: 401 }) }) });
    expect(r1.certificado).toMatchObject({ ok: false, mensaje: expect.stringContaining("20606433094") });
    expect(r1.credencialesGre.ok).toBe(false);
    expect(r1.todoOk).toBe(false);
    const r2 = await probarConexionSunat(ctx, { pfx: otro, clavePfx: "mala", usuarioSol: "U", claveSol: "x", greClientId: "i", greClientSecret: "s" },
      { fetch: fetchSegun({ soap: statusCdr, oauth: token }) });
    expect(r2.certificado).toMatchObject({ ok: false, mensaje: expect.stringContaining("clave del certificado") });
  });

  it("sin certificado cargado lo dice", async () => {
    const { ctx, cerrar } = await crearContextoPrueba();
    cerrables.push(cerrar);
    const r = await probarConexionSunat(ctx, { pfx: null, clavePfx: "", usuarioSol: "U", claveSol: "x", greClientId: "i", greClientSecret: "s" },
      { fetch: fetchSegun({ soap: statusCdr, oauth: token }) });
    expect(r.certificado).toMatchObject({ ok: false, mensaje: expect.stringContaining("Sube") });
  });
});
```

- [ ] **Step 2: Correr y ver que falla.** `pnpm vitest run packages/core/test/probar.test.ts`. Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar** `packages/core/src/sunat/probar.ts`:

```ts
import { createHash } from "node:crypto";
import { empresa } from "@sunatapp/db";
import { cargarPfx, SunatReal } from "@sunatapp/sunat";
import type { Contexto } from "../infra/contexto";

export interface PuntoPrueba { ok: boolean; mensaje: string }
export interface ResultadoPruebaSunat { certificado: PuntoPrueba; claveSol: PuntoPrueba; credencialesGre: PuntoPrueba; todoOk: boolean; huella: string }
export interface DatosPrueba { pfx: Buffer | null; clavePfx: string; usuarioSol: string; claveSol: string; greClientId: string; greClientSecret: string }

/** Huella de lo probado: el modo Real solo se guarda si se probó exactamente lo mismo. */
export function huellaPrueba(d: DatosPrueba): string {
  const h = createHash("sha256");
  h.update(d.pfx ?? Buffer.alloc(0));
  for (const v of [d.clavePfx, d.usuarioSol, d.claveSol, d.greClientId, d.greClientSecret]) h.update(`\u0000${v}`);
  return h.digest("hex");
}

const DIA_MS = 24 * 3600 * 1000;

function probarCertificado(d: DatosPrueba, ruc: string, ahora: Date): PuntoPrueba {
  if (!d.pfx) return { ok: false, mensaje: "Sube tu certificado digital (.pfx o .p12)" };
  let c;
  try {
    c = cargarPfx(d.pfx, d.clavePfx);
  } catch {
    return { ok: false, mensaje: "No se pudo abrir el certificado: revisa la clave del certificado" };
  }
  if (!c.subject.includes(ruc)) return { ok: false, mensaje: `El certificado no es del RUC ${ruc} (dice: ${c.subject})` };
  if (c.validoHasta.getTime() < ahora.getTime()) return { ok: false, mensaje: `El certificado venció el ${c.validoHasta.toISOString().slice(0, 10)}` };
  if (c.validoDesde.getTime() > ahora.getTime()) return { ok: false, mensaje: "El certificado todavía no está vigente" };
  const dias = Math.floor((c.validoHasta.getTime() - ahora.getTime()) / DIA_MS);
  return { ok: true, mensaje: dias < 30 ? `Certificado válido, pero vence en ${dias} días` : `Certificado válido hasta ${c.validoHasta.toISOString().slice(0, 10)}` };
}

export async function probarConexionSunat(ctx: Contexto, d: DatosPrueba, o: { fetch?: typeof fetch; ahora?: Date } = {}): Promise<ResultadoPruebaSunat> {
  const [emp] = await ctx.db.select({ ruc: empresa.ruc }).from(empresa).limit(1);
  const huella = huellaPrueba(d);
  if (!emp) {
    const falta = { ok: false, mensaje: "Primero completa los datos de tu empresa (Ajustes → Empresa)" };
    return { certificado: falta, claveSol: falta, credencialesGre: falta, todoOk: false, huella };
  }
  const certificado = probarCertificado(d, emp.ruc, o.ahora ?? ctx.reloj());
  const real = new SunatReal(
    { ruc: emp.ruc, usuarioSol: d.usuarioSol, claveSol: d.claveSol, greClientId: d.greClientId, greClientSecret: d.greClientSecret, ambienteFactura: "produccion" },
    o.fetch ? { fetch: o.fetch } : {},
  );
  const claveSol = d.usuarioSol && d.claveSol ? await real.probarClaveSol() : { ok: false, mensaje: "Escribe tu usuario y clave SOL" };
  const credencialesGre = d.greClientId && d.greClientSecret ? await real.probarCredencialesGre() : { ok: false, mensaje: "Escribe el client_id y el client_secret de guías" };
  return { certificado, claveSol, credencialesGre, todoOk: certificado.ok && claveSol.ok && credencialesGre.ok, huella };
}
```

El certificado de prueba lleva `OU=RUC 20606433094`, y el CDT real de SUNAT incluye el RUC en su subject. Por eso `subject.includes(ruc)` sirve para ambos. Exportar `export * from "./sunat/probar";` en `packages/core/src/index.ts`.

- [ ] **Step 4: Correr.** `pnpm vitest run packages/core/test/probar.test.ts`. Esperado: PASS.

- [ ] **Step 5: Prueba de factura automática.** `packages/core/test/factura-automatica.test.ts`:

```ts
import { eq, guiaTransportista, viaje } from "@sunatapp/db";
import { afterEach, describe, expect, it } from "vitest";
import { activarFacturaAutomatica, intentarFacturaAutomatica } from "../src/facturas/automatica";
import { emitirGuia } from "../src/guias/emitir";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import { crearContextoPrueba, entradaGuia, prepararDatosTransporte } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => { while (cerrables.length) await cerrables.pop()!(); });

async function guiaAceptadaConViaje(flete: number | null) {
  const r = await crearContextoPrueba();
  cerrables.push(r.cerrar);
  await prepararDatosTransporte(r.ctx);
  const guiaId = await registrarGuiaBorrador(r.ctx, entradaGuia());
  await emitirGuia(r.ctx, guiaId);
  const [g] = await r.ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (g!.viajeId) await r.ctx.db.update(viaje).set({ flete }).where(eq(viaje.id, g!.viajeId));
  return { ctx: r.ctx, guiaId, viajeId: g!.viajeId };
}

describe("intentarFacturaAutomatica", () => {
  it("apagada por defecto: no factura", async () => {
    const { ctx, guiaId } = await guiaAceptadaConViaje(250000);
    expect(await intentarFacturaAutomatica(ctx, guiaId)).toBeNull();
  });

  it("encendida, con flete y guía única: emite al contado por el flete", async () => {
    const { ctx, guiaId, viajeId } = await guiaAceptadaConViaje(250000);
    expect(viajeId).not.toBeNull();
    await activarFacturaAutomatica(ctx, true);
    const r = await intentarFacturaAutomatica(ctx, guiaId);
    expect(r).toMatchObject({ estado: "aceptada", serieNumero: "F001-1" });
  });

  it("encendida pero sin flete: no factura", async () => {
    const { ctx, guiaId } = await guiaAceptadaConViaje(null);
    await activarFacturaAutomatica(ctx, true);
    expect(await intentarFacturaAutomatica(ctx, guiaId)).toBeNull();
  });
});
```

Si `registrarGuiaBorrador` no crea viaje solo (revisar `packages/core/src/viajes/desde-guia.ts`; el viaje nace al registrar la guía según la spec 2026-09-27), crear el viaje en la prueba con la función de `desde-guia.ts` que usa la app y enlazarlo a la guía.

- [ ] **Step 6: Correr y ver que falla.** `pnpm vitest run packages/core/test/factura-automatica.test.ts`. Esperado: FAIL, módulo no encontrado.

- [ ] **Step 7: Implementar** `packages/core/src/facturas/automatica.ts`:

```ts
import { ajuste, contraparte, eq, facturaGuia, guiaTransportista, viaje } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";
import type { ResultadoEmision } from "../guias/emitir";
import { emitirFactura } from "./emitir";
import { prepararFactura } from "./preparar";

const CLAVE = "factura_automatica";

export async function facturaAutomaticaActiva(ctx: Contexto): Promise<boolean> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, CLAVE));
  return (f?.valor as { activa?: boolean } | undefined)?.activa === true;
}

export async function activarFacturaAutomatica(ctx: Contexto, activa: boolean): Promise<void> {
  const valor = { activa };
  await ctx.db.insert(ajuste).values({ clave: CLAVE, valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: ctx.reloj() } });
}

/**
 * Factura sola una guía recién aceptada, solo si: está encendido, la guía tiene viaje con flete
 * pactado, es la única guía del viaje, el remitente tiene RUC y no falta ningún dato (VR). Si algo
 * falla, devuelve null sin error y el bot ofrece facturar como siempre.
 */
export async function intentarFacturaAutomatica(ctx: Contexto, guiaId: number): Promise<ResultadoEmision | null> {
  if (!(await facturaAutomaticaActiva(ctx))) return null;
  const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g || g.estado !== "aceptada" || !g.viajeId) return null;
  const [ya] = await ctx.db.select().from(facturaGuia).where(eq(facturaGuia.guiaId, guiaId));
  if (ya) return null;
  const [v] = await ctx.db.select().from(viaje).where(eq(viaje.id, g.viajeId));
  if (!v?.flete || v.flete <= 0) return null;
  const guiasDelViaje = await ctx.db.select({ id: guiaTransportista.id }).from(guiaTransportista).where(eq(guiaTransportista.viajeId, g.viajeId));
  if (guiasDelViaje.length !== 1) return null;
  const [cli] = await ctx.db.select().from(contraparte).where(eq(contraparte.id, g.remitenteId));
  if (cli?.tipoDoc !== "6") return null;
  try {
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: v.flete, incluyeIgv: false, formaPago: "contado" });
    return await emitirFactura(ctx, facturaId);
  } catch (error) {
    ctx.log?.("info", `Factura automática no emitida para la guía ${guiaId}: ${(error as Error).message}`);
    return null;
  }
}
```

Exportar `export * from "./facturas/automatica";` en `packages/core/src/index.ts`.

- [ ] **Step 8: Correr.** `pnpm vitest run packages/core`. Esperado: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core
git commit -m "feat(core): probar conexión con SUNAT sin emitir y factura automática opcional

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 10: Web — Este dispositivo, rutas y flota

**Files:**
- Modify: `apps/web/src/paginas/dispositivo.tsx`, `apps/web/src/paginas/rutas.tsx`, `apps/web/src/paginas/flota.tsx`, `apps/web/src/base.tsx` (si `ServiciosDispositivo` necesita exponer el certificado guardado)
- Test: `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `probarConexionSunat`, `huellaPrueba`, `leerPausaSunat`, `reanudarSunat`, `facturaAutomaticaActiva`, `activarFacturaAutomatica`, `guardarValorReferencial`, `listarValoresReferenciales`, `borrarValorReferencial`, `FORMULA_VR_VERIFICADA` (reexportar desde core: `export { FORMULA_VR_VERIFICADA } from "@sunatapp/sunat";` en `packages/core/src/index.ts`).

- [ ] **Step 1: Pruebas web.** Revisar cómo `apps/web/test/web.test.ts` arma la app y hace POST con sesión de dueño (`grep -n "ajustes/dispositivo\|servicios" apps/web/test/web.test.ts`). Agregar tres pruebas con ese mismo arnés:
  1. **POST `/ajustes/dispositivo/probar`** con servicios falsos, usuario/clave/client_id/secret y sin certificado. Esperado: 200 y el HTML contiene "Sube tu certificado digital".
  2. **POST `/ajustes/dispositivo`** con `SUNAT_MODO=real` y todos los campos, sin una prueba previa con esos valores. Esperado: el mensaje de error contiene "Prueba la conexión".
  3. **POST `/rutas/vr`** con `partidaUbigeo=040101&llegadaUbigeo=210101&vrPorTm=85.50`. Esperado: redirección con mensaje, y `listarValoresReferenciales(ctx)` devuelve la fila con `vrPorTm: 8550`.

- [ ] **Step 2: Correr y ver que falla.** `pnpm vitest run apps/web/test/web.test.ts`. Esperado: FAIL (404 en las rutas nuevas).

- [ ] **Step 3: `dispositivo.tsx` — probar conexión.**
  - **Ruta nueva `app.post("/ajustes/dispositivo/probar", ...)`:**
    - Solo el dueño puede usarla.
    - Lee el formulario multiparte. Cada campo vacío usa el valor guardado de `s.ajustes()`. El certificado sale del archivo subido o, si no hay, del archivo en `SUNAT_CERT_PATH` (leer con `readFile`).
    - Llama `probarConexionSunat(d.ctx, datos)`.
    - Guarda en memoria del proceso `ultimaPrueba = { huella, todoOk, en: Date.now() }`, con una variable de módulo dentro de `rutasDispositivo`.
    - Muestra la vista con el resultado: tres filas ✅/❌ con `mensaje`.
  - Agregar el botón dentro del `<form>` existente, en el panel SUNAT. Al usar `formaction`, el mismo formulario se envía a la ruta de prueba:

```tsx
<button class="btn chico" type="submit" formaction="/ajustes/dispositivo/probar">PROBAR CONEXIÓN</button>
```

  - **Mostrar el resultado:** `vista(c, d, resultado?)` recibe un `ResultadoPruebaSunat | undefined` opcional y lo pinta dentro del panel SUNAT:

```tsx
{resultado ? (
  <div class="filas" style="gap:4px">
    {([["Certificado", resultado.certificado], ["Usuario y clave SOL", resultado.claveSol], ["Credenciales de guías", resultado.credencialesGre]] as const).map(([n, p]) => (
      <span class={`aviso ${p.ok ? "info" : "error"}`}>{p.ok ? "✅" : "❌"} <b>{n}:</b> {p.mensaje}</span>
    ))}
  </div>
) : null}
```

- [ ] **Step 4: `dispositivo.tsx` — bloqueo del modo Real.** En el POST de guardado, dentro de `if (f.SUNAT_MODO === "real")` y después de calcular `faltan`, armar los `DatosPrueba` con los valores finales (formulario o guardados, y el certificado nuevo o el guardado) y comprobar:

```ts
        if (!ultimaPrueba || !ultimaPrueba.todoOk || ultimaPrueba.huella !== huellaPrueba(datosFinales)) {
          throw new ErrorNegocio("Prueba la conexión con estos mismos datos (botón PROBAR CONEXIÓN) y que salga todo ✅ antes de activar el modo Real");
        }
```

Si el modo guardado ya es real y no cambió ningún campo SUNAT, no exigir prueba. Así se puede guardar el token del bot sin volver a probar: comparar `actual.SUNAT_MODO === "real"` y que no haya cambios en las claves `SUNAT_*` ni certificado nuevo.

- [ ] **Step 5: `dispositivo.tsx` — pausa, factura automática y guía SOL.**
  - **Pausa:** en `vista`, leer `const pausa = await leerPausaSunat(d.ctx);`. Si existe, mostrar arriba del panel SUNAT:

```tsx
<div class="aviso error">⏸ SUNAT en pausa desde {pausa.desde.slice(0, 16).replace("T", " ")}: {pausa.motivo}. Corrige tus claves y guarda, o <button class="btn chico" type="submit" formaction="/ajustes/dispositivo/reanudar">REINTENTAR AHORA</button></div>
```

  Ruta `app.post("/ajustes/dispositivo/reanudar", ...)` → `reanudarSunat(d.ctx)` y luego `"SUNAT reanudada"`.
  - **Fórmula sin verificar:** si `e.sunat.modo === "real" && !FORMULA_VR_VERIFICADA`, mostrar `<div class="aviso info">La fórmula del valor referencial MTC aún no está verificada contra la norma: revisa el monto de la detracción de tus primeras facturas.</div>`.
  - **Factura automática:** casilla en el panel SUNAT, `name="facturaAutomatica" value="1"`, marcada según `await facturaAutomaticaActiva(d.ctx)`, con el texto "Facturar solo al aceptarse la guía (si el viaje tiene flete pactado y una sola guía)". En el POST: `await activarFacturaAutomatica(d.ctx, f.facturaAutomatica === "1");`.
  - **Guía paso a paso:** panel nuevo después del panel SUNAT:

```tsx
<Panel titulo="CÓMO CONSEGUIR TUS ACCESOS SUNAT (UNA SOLA VEZ)">
  <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.5">
    <li><b>Certificado digital gratis:</b> SOL → Empresas → Comprobantes de Pago → Certificado Digital Tributario → «Solicitar Certificado Digital Tributario». Te llega al Buzón SOL; al descargarlo creas su clave y obtienes <code>certificado.p12</code>.</li>
    <li><b>Emisor desde tu sistema:</b> en SOL, inscríbete en «SEE - Del Contribuyente» subiendo ese certificado y tu correo. Rige desde el día siguiente.</li>
    <li><b>Credenciales de guías:</b> SOL → Empresas → Credenciales de API SUNAT → Gestión de Credenciales → registra una aplicación tipo <b>Desktop</b> marcando «GRE Emisión de Comprobantes». Copia el ID (client_id) y la CLAVE (client_secret).</li>
    <li><b>Usuario SOL:</b> si SUNAT responde «el usuario debe ser secundario» (0112), crea un usuario secundario con perfil de emisión electrónica y úsalo aquí.</li>
    <li>Pon todo aquí, toca <b>PROBAR CONEXIÓN</b> y, si sale todo ✅, cambia el modo a <b>Real</b> y guarda.</li>
  </ol>
  <span class="muted" style="font-size:11px">No hay ambiente de pruebas de SUNAT para guías: la primera guía en modo Real ya es real. Hasta el 28-02-2027 SUNAT no sanciona errores en guías de transportista.</span>
</Panel>
```

- [ ] **Step 6: `rutas.tsx` — valores referenciales.** Agregar a la vista un panel "VALOR REFERENCIAL MTC (FACTURA CON DETRACCIÓN)" con:
  - la tabla de `listarValoresReferenciales(d.ctx)`: origen ubigeo → destino ubigeo, S/ por TM y fuente, más un botón borrar por fila (POST `/rutas/vr/borrar`);
  - un formulario con `partidaUbigeo`, `llegadaUbigeo`, `vrPorTm` (soles, `parsearMonto`) y `fuente` opcional, que hace POST a `/rutas/vr`.

  Rutas:

```ts
  app.post("/rutas/vr", async (c) => {
    const f = await formulario(c);
    return accion(c, "/rutas", async () => {
      const vr = parsearMonto(f.vrPorTm ?? "");
      if (vr === null) throw new ErrorNegocio("Valor referencial no válido");
      await guardarValorReferencial(d.ctx, { partidaUbigeo: (f.partidaUbigeo ?? "").trim(), llegadaUbigeo: (f.llegadaUbigeo ?? "").trim(), vrPorTmCentimos: vr, ...(f.fuente ? { fuente: f.fuente } : {}) });
      return "Valor referencial guardado";
    });
  });
  app.post("/rutas/vr/borrar", async (c) => {
    const f = await formulario(c);
    return accion(c, "/rutas", async () => {
      await borrarValorReferencial(d.ctx, f.partidaUbigeo ?? "", f.llegadaUbigeo ?? "");
      return "Valor referencial borrado";
    });
  });
```

- [ ] **Step 7: `flota.tsx` — configuración y carga útil.**
  - En el formulario de edición de la unidad (el que hace POST a `/flota/:id`), agregar dos campos: `configuracionVehicular` (placeholder "T3S3") y `cargaUtilTm` (placeholder "30", `inputmode="decimal"`), con sus valores actuales. Revisar que `Unidad` (de `listarUnidades`) incluya las columnas nuevas; si `Unidad` se arma campo por campo, agregar `configuracionVehicular` y `cargaUtilTm` en `packages/core/src/flota/unidades.ts`.
  - En el POST:

```ts
        configuracionVehicular: f.configuracionVehicular ?? null,
        cargaUtilTm: f.cargaUtilTm ? Number(f.cargaUtilTm.replace(",", ".")) : null,
```

- [ ] **Step 8: Mensaje con enlace.** Donde la web prepara facturas (`grep -rn "prepararFactura" apps/web/src`), si el error es `FaltaDatoTransporteError`, el mensaje añade " — complétalo en Rutas (valor referencial) o en Flota (carga útil)". Basta con `error.message + sufijo` dentro de `accion`.

- [ ] **Step 9: Correr.** `pnpm vitest run apps/web` y `pnpm typecheck`. Esperado: PASS.

- [ ] **Step 10: Comprobar a mano.**
  - Arrancar con `pnpm web` (o `INICIAR-DEMO.bat`) y entrar como dueño.
  - En Ajustes → Este dispositivo, tocar PROBAR CONEXIÓN sin certificado. Esperado: ❌ "Sube tu certificado".
  - Intentar guardar el modo Real. Esperado: bloqueado.
  - Entrar a Rutas, agregar un VR y verificar que aparece en la tabla.
  - No usar claves reales.

- [ ] **Step 11: Commit**

```bash
git add apps/web packages/core/src/index.ts packages/core/src/flota/unidades.ts
git commit -m "feat(web): probar conexión SUNAT, bloqueo de modo Real, guía SOL, pausa, valor referencial y carga útil

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 11: Bot — pregunta del valor referencial, primera real y factura automática

**Files:**
- Modify: `apps/bot/src/sesion.ts`, `apps/bot/src/flujo-factura.ts`, `apps/bot/src/flujo-guia.ts`, `apps/bot/src/textos.ts`
- Test: `apps/bot/test/flujo-factura.test.ts`, `apps/bot/test/flujo-guia.test.ts`

**Interfaces:**
- Consumes: `transporteDeGuia`, `FaltaDatoTransporteError`, `guardarValorReferencial`, `actualizarUnidad`, `esPrimeraReal`, `intentarFacturaAutomatica`, `parsearMonto`.

- [ ] **Step 1: Pruebas del bot.** Revisar el arnés (`apps/bot/test/arnes.ts`) y una prueba existente de `flujo-factura.test.ts` que llega al resumen. Agregar:
  1. **Falta el VR:** con la base sin `valor_referencial_ruta`, el dueño escribe el monto 1000, elige "más IGV", el remitente y contado. Esperado: el bot responde con un texto que contiene "valor referencial MTC". El dueño responde "85.50". Esperado: se guarda la fila (`vrPorTm: 8550`) y aparece el resumen con "✅ Emitir".
  2. **Primera real:** con `ctx.facturaSimulada = false` y sin el ajuste `sunat_primera_real`, el resumen contiene "PRIMERA factura REAL".
  3. En `flujo-guia.test.ts`: con `activarFacturaAutomatica(ctx, true)` y el viaje de la guía con `flete`, al notificarse la guía aceptada se envía el PDF de la factura en vez del botón "Facturar".

- [ ] **Step 2: Correr y ver que falla.** `pnpm vitest run apps/bot`. Esperado: FAIL.

- [ ] **Step 3: Sesión.** En `EstadoFlujoFactura.paso` agregar `"vr" | "carga_util"`, y los campos:

```ts
  /** Dato de transporte que falta (se pide una sola vez y se guarda). */
  falta?: { tipo: "vr_ruta"; partidaUbigeo: string; llegadaUbigeo: string } | { tipo: "carga_util"; vehiculoId: number };
```

- [ ] **Step 4: Textos.** En `apps/bot/src/textos.ts`, dentro de `textos`:

```ts
  preguntaVr: (partida: string, llegada: string) =>
    `Para la factura con detracción necesito el valor referencial MTC por tonelada de ${partida} → ${llegada} (tabla del D.S. 010-2006-MTC). Escríbelo en soles, p. ej. 85.50. Lo guardo para las siguientes.`,
  preguntaCargaUtil: (placa: string) =>
    `¿Cuál es la carga útil (en toneladas) de la unidad ${placa} con su carreta? P. ej. 30. Lo guardo para las siguientes.`,
  vrNoEntendido: "No entendí el número. Escríbelo así: 85.50",
  primeraReal: (tipo: "guía" | "factura") => `⚠️ Esta será tu PRIMERA ${tipo} REAL ante SUNAT. Revisa bien los datos.`,
```

- [ ] **Step 5: `avanzar` en `flujo-factura.ts`.** Antes de `await mostrarResumen(c, deps, f);`:

```ts
  const d = await cargarGuiaCompleta(deps.ctx.db, f.guiaId);
  const montos = calcularMontosFactura({
    montoCentimos: f.montoCentimos!, incluyeIgv: f.incluyeIgv!,
    detraccion: { porcentaje: d.empresa.detraccionPorcentaje, umbralCentimos: d.empresa.detraccionUmbral },
  });
  if (montos.detraccionMonto > 0) {
    try {
      await transporteDeGuia(deps.ctx, f.guiaId);
    } catch (error) {
      if (!(error instanceof FaltaDatoTransporteError)) throw error;
      const falta = error.falta;
      if (falta.tipo === "vr_ruta") {
        f.paso = "vr";
        f.falta = { tipo: "vr_ruta", partidaUbigeo: falta.partidaUbigeo, llegadaUbigeo: falta.llegadaUbigeo };
        await c.reply(textos.preguntaVr(falta.partida, falta.llegada));
      } else {
        f.paso = "carga_util";
        f.falta = { tipo: "carga_util", vehiculoId: falta.vehiculoId };
        await c.reply(textos.preguntaCargaUtil(falta.placa));
      }
      return;
    }
  }
```

- [ ] **Step 6: Respuestas en `manejarTextoFactura`.** Después del bloque `if (f.paso === "monto") {...}`:

```ts
  if (f.paso === "vr" && f.falta?.tipo === "vr_ruta") {
    const vr = parsearMonto(texto);
    if (vr === null) {
      await c.reply(textos.vrNoEntendido);
      return;
    }
    await guardarValorReferencial(deps.ctx, { partidaUbigeo: f.falta.partidaUbigeo, llegadaUbigeo: f.falta.llegadaUbigeo, vrPorTmCentimos: vr, fuente: "Telegram" });
    delete f.falta;
    await avanzar(c, deps, f);
    return;
  }
  if (f.paso === "carga_util" && f.falta?.tipo === "carga_util") {
    const tm = Number(texto.replace(",", ".").trim());
    if (!(tm > 0)) {
      await c.reply(textos.vrNoEntendido);
      return;
    }
    await actualizarUnidad(deps.ctx, f.falta.vehiculoId, { cargaUtilTm: tm }, c.session.usuarioId);
    delete f.falta;
    await avanzar(c, deps, f);
    return;
  }
```

Agregar a los imports de `@sunatapp/core`: `actualizarUnidad, esPrimeraReal, FaltaDatoTransporteError, guardarValorReferencial, transporteDeGuia`.

- [ ] **Step 7: Resumen con detracción real y aviso de primera real.** En `mostrarResumen`:
  - Calcular los montos con la base mínima: si hay detracción, `const { vr } = await transporteDeGuia(deps.ctx, f.guiaId);` y pasar `baseMinimaDetraccion: vr.vrServicio` a `calcularMontosFactura`.
  - Antes del `resumenFactura(...)`: `const aviso = (await esPrimeraReal(deps.ctx, "factura")) ? `${textos.primeraReal("factura")}\n\n` : "";` y responder con `aviso + resumenFactura(...)`.
  - Hacer lo mismo en el resumen de la guía en `flujo-guia.ts` (buscar `resumenGuia(` y anteponer `textos.primeraReal("guía")` cuando `await esPrimeraReal(deps.ctx, "guia")`).

- [ ] **Step 8: Factura automática en `flujo-guia.ts`.** En `notificarGuia`, reemplazar:

```ts
    if (sinFacturar.some((g) => g.id === r.id)) await ofrecerFactura(api, chatId, r.id, r.serieNumero);
```

por:

```ts
    if (sinFacturar.some((g) => g.id === r.id)) {
      const auto = await intentarFacturaAutomatica(deps.ctx, r.id);
      if (auto) await notificarFactura(deps, api, chatId, auto);
      else await ofrecerFactura(api, chatId, r.id, r.serieNumero);
    }
```

Importar `intentarFacturaAutomatica` de `@sunatapp/core` y `notificarFactura` de `./flujo-factura`.

- [ ] **Step 9: Correr.** `pnpm vitest run apps/bot`. Esperado: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/bot
git commit -m "feat(bot): pide el valor referencial o la carga útil una sola vez, avisa la primera emisión real y factura solo si está activado

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 12: Verificación final y prueba en el beta de SUNAT (con permiso)

**Files:**
- Modify (si hace falta): `packages/core/scripts/demo.ts`
- Modify: memoria `sunatapp-pendientes-plan1.md` (lo hace el agente principal, no el implementador)

- [ ] **Step 1: Todo verde.** `pnpm typecheck` y `pnpm test`. Esperado: 0 errores y todas las pruebas PASS. Copiar el resumen de vitest (número de pruebas) en el mensaje final.

- [ ] **Step 2: Revisión manual del XML 1004.** Correr la prueba de la factura con detracción, abrir el XML guardado (la ruta sale en `f.rutaXml` del almacén temporal) o imprimirlo desde una prueba con `console.log`. Comparar a ojo con el ejemplo de la spec §5.1.

- [ ] **Step 3: PEDIR PERMISO al dueño** antes de enviar a SUNAT beta: "¿Envío una factura de prueba al ambiente beta de SUNAT (no tiene validez, usa el usuario de pruebas MODDATOS)?". Sin un sí explícito, saltar al Step 5.

- [ ] **Step 4: Envío al beta (solo con permiso).**
  - Con `SUNAT_MODO=beta`, la factura va a `e-beta.sunat.gob.pe` con MODDATOS.
  - Correr `pnpm demo` (revisar antes en `packages/core/scripts/demo.ts` que cree una guía y una factura > S/ 400, y que el VR y la carga útil estén sembrados; si no, agregarlos con `guardarValorReferencial` y `actualizarUnidad`).
  - Esperado: la factura queda `aceptada` u `observada`. Si es `rechazada`, copiar el código y el mensaje de SUNAT y corregir el XML según las reglas de validación.

- [ ] **Step 5: Commit final** (si hubo cambios en el demo):

```bash
git add packages/core/scripts/demo.ts
git commit -m "chore(demo): datos de transporte para probar la factura 1004 en beta

Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

- [ ] **Step 6: Informe al dueño.** Contar:
  - qué quedó listo;
  - si el beta aceptó la factura 1004;
  - si la fórmula del VR quedó verificada;
  - los tres pasos SOL que le faltan (certificado, inscripción, credenciales GRE).
