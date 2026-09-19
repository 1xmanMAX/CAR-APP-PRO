# Plan 2 — Bot de Telegram + lector de guías: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño envíe por Telegram el PDF de una GRE Remitente y reciba la GRE Transportista emitida (SUNAT simulado), facture el flete y controle cobros desde el chat.

**Architecture:** Cambios pequeños al núcleo (`packages/core`, `packages/db`, `packages/sunat`, `packages/pdf`), un paquete nuevo `packages/extractor` (lector por reglas sobre el texto del PDF) y una app nueva `apps/bot` (grammY, long polling) que solo llama a `core` y `extractor`. El bot guarda el estado de conversación en memoria (sesión por chat) y todo lo durable en la BD.

**Tech Stack:** TypeScript 7, Node 24, pnpm 9 monorepo, Vitest 5, Drizzle + PGlite, grammY 1.46, unpdf 1.8, zod 4.

**Spec:** `docs/superpowers/specs/2026-09-13-plan2-bot-telegram-design.md` (base: `docs/superpowers/specs/2026-09-13-mvp-gre-transportista-design.md`). Contexto posterior: `docs/superpowers/specs/2026-09-19-viajes-presupuesto-ia-web-design.md` (Planes 3 y 4, **no** se implementan aquí; solo no hay que cerrarles la puerta).

## Global Constraints

- Idioma: todo texto visible al usuario, nombres de funciones del dominio y mensajes de error en **español**.
- Montos en **céntimos enteros** (`number`); nunca `float` para dinero.
- Fechas de negocio en hora de Lima (`fechaHoraLima`), formato `AAAA-MM-DD`.
- `apps/bot` solo importa `@sunatapp/core` y `@sunatapp/extractor` (nunca `db`, `sunat` ni `pdf` directamente).
- `packages/extractor` no importa `core` en `src/`: recibe `validarRuc` y `obtenerUbigeo` por inyección.
- El token (`TELEGRAM_BOT_TOKEN`) vive solo en `.env` (git-ignorado). Nunca en código, pruebas ni logs.
- Los PDFs reales de `referencias/muestras/` son git-ignorados: **nunca** copiarlos a carpetas versionadas ni pegarlos en fixtures. Los fixtures usan **datos inventados**.
- SUNAT siempre en modo simulado en pruebas. Ninguna prueba hace llamadas de red.
- Las pruebas del bot no llaman a la API de Telegram: se interceptan con un transformer de grammY.
- Cada tarea termina con `pnpm test` y `pnpm typecheck` en verde y un commit. Mensajes de commit en español con prefijo convencional (`feat`, `fix`, `test`, `chore`) y la línea final `Claude-Session: https://claude.ai/code/session_0187MZGEh1ffBPR4WpBTUmqh`.
- Migraciones: se generan con `pnpm --filter @sunatapp/db generar --name <nombre>` (drizzle-kit) y se versionan en `packages/db/drizzle/`. Nunca se edita una migración ya versionada.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---------|-----------------|
| `vitest.config.ts`, `packages/*/vitest.config.ts` | Estabilidad de la suite (tiempos y paralelismo) |
| `packages/db/src/schema.ts` | Columnas nuevas: `guia_transportista.vehiculo_secundario_id`, `url_qr`; `documento_recibido.hash_sha256`; índice único en `guia_transportista.documento_recibido_id` |
| `packages/db/drizzle/000N_*.sql` | Migraciones generadas |
| `packages/sunat/src/ubl/gre-transportista.ts` | `vehiculo.placasSecundarias` → `AttachedTransportEquipment` |
| `packages/pdf/src/guia.ts` | `placas: string[]` en lugar de `vehiculoPlaca` |
| `packages/core/src/guias/cargar.ts` | Carga del vehículo secundario |
| `packages/core/src/guias/emitir.ts` | Persistir CDR/urlQr antes del PDF, `generarPdfGuiaSiFalta`, barrido, limpiar `rutaXml` al reemitir |
| `packages/core/src/facturas/emitir.ts` | Limpiar `rutaXml` al reemitir desde `rechazada` |
| `packages/core/src/documentos/recibidos.ts` | NUEVO: `registrarDocumentoRecibido` idempotente |
| `packages/core/src/guias/validar.ts`, `registrar.ts` | `EntradaGuia.transporte`, idempotencia por documento |
| `packages/core/src/transporte/transporte.ts` | NUEVO: `compararTransporte`, `registrarVehiculo`, `registrarConductor`, `transporteHabitual` |
| `packages/core/src/consultas/consultas.ts` | NUEVO: `listarGuias`, `listarBorradores`, `listarGuiasSinFacturar`, `buscarGuiaPorSerieNumero` |
| `packages/core/src/usuarios/usuarios.ts` | NUEVO: `registrarUsuarioTelegram`, `usuarioPorTelegram`, `hayDueno`, auditoría de desconocidos |
| `packages/core/src/guias/desde-extraccion.ts` | NUEVO: borrador de guía a partir de lo extraído y respuestas del usuario |
| `packages/core/src/infra/contexto.ts` | `log?` en `Contexto` |
| `packages/extractor/` | NUEVO paquete: tipos, texto del PDF, lector por reglas |
| `apps/bot/` | NUEVA app: config, log, textos, registro, flujos, comandos, fondo, aviso diario, main |

---

### Task 1: Estabilizar la suite de pruebas

Hoy `pnpm test` falla de forma intermitente por **timeouts** (no por lógica): muchos archivos crean PGlite en paralelo y saturan la máquina. En cada corrida fallan pruebas distintas (`db.test.ts` hook 10 s, `infra.test.ts` y `facturas.test.ts` 30 s).

**Files:**
- Modify: `vitest.config.ts`
- Modify: `packages/core/vitest.config.ts`, `packages/db/vitest.config.ts`, `packages/sunat/vitest.config.ts`, `packages/pdf/vitest.config.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `pnpm test` estable; todas las tareas siguientes dependen de ello.

- [ ] **Step 1: Medir.** Ejecuta `pnpm test 2>&1 | tail -20` y anota qué pruebas fallan y con qué tiempo.

- [ ] **Step 2: Limitar paralelismo y subir tiempos.** En `vitest.config.ts` raíz:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    // PGlite es pesado: demasiados archivos en paralelo agotan CPU/RAM y producen timeouts falsos.
    maxWorkers: 2,
  },
});
```

En cada `packages/*/vitest.config.ts`:

```ts
import { defineProject } from "vitest/config";

export default defineProject({
  test: { testTimeout: 60000, hookTimeout: 60000 },
});
```

Si `maxWorkers` no es aceptado por la versión instalada de Vitest, consulta los tipos en `node_modules/vitest` (busca `maxWorkers` / `poolOptions`) y usa la opción equivalente. No desactives pruebas.

- [ ] **Step 3: Verificar dos corridas seguidas en verde.** `pnpm test` dos veces. Esperado: `122 passed` ambas veces. Si alguna sigue fallando por tiempo, baja `maxWorkers` a 1 antes de tocar otra cosa.

- [ ] **Step 4: Commit.** `git commit -m "test: estabiliza la suite limitando paralelismo y ampliando tiempos de PGlite"`

---

### Task 2: Vehículo secundario (tracto + carreta)

**Files:**
- Modify: `packages/db/src/schema.ts` (tabla `guiaTransportista`); migración generada `vehiculo_secundario`
- Modify: `packages/sunat/src/ubl/gre-transportista.ts`, `packages/sunat/test/datos-prueba.ts`
- Modify: `packages/pdf/src/guia.ts`
- Modify: `packages/core/src/guias/cargar.ts`
- Test: la prueba de GRE de `packages/sunat/test/` (búscala con `grep -l construirXmlGreTransportista packages/sunat/test`), `packages/pdf/test/pdf.test.ts`, `packages/core/test/guias.test.ts`

**Interfaces:**
- Produces:
  - `DatosGreTransportista.vehiculo: { placa: string; placasSecundarias: string[] }`
  - `PdfGuia.placas: string[]` (reemplaza `vehiculoPlaca`)
  - Columna `guiaTransportista.vehiculoSecundarioId: number | null`
  - `GuiaCompleta.vehiculoSecundario: typeof vehiculo.$inferSelect | null`

- [ ] **Step 1: Prueba XML (falla).** En la prueba de la GRE, con los datos de prueba existentes:

```ts
it("incluye la carreta como AttachedTransportEquipment y sigue pasando el XSD", async () => {
  const d = { ...datosGre(), vehiculo: { placa: "ABC-123", placasSecundarias: ["XYZ-987"] } };
  const xml = construirXmlGreTransportista(d);
  expect(xml).toContain("<cac:TransportEquipment><cbc:ID>ABC123</cbc:ID><cac:AttachedTransportEquipment><cbc:ID>XYZ987</cbc:ID></cac:AttachedTransportEquipment></cac:TransportEquipment>");
  const r = await validarXsd(firmarXml(xml, certificado), "DespatchAdvice");
  expect(r.errores).toEqual([]);
});
```

(`datosGre()` y `certificado` son orientativos: usa los nombres reales de las ayudas del archivo de prueba.)

- [ ] **Step 2: Ejecutar → FAIL.** `pnpm vitest run packages/sunat`.

- [ ] **Step 3: Implementar.** En `gre-transportista.ts`:

```ts
vehiculo: { placa: string; placasSecundarias: string[] };
```

```ts
const adjuntos = d.vehiculo.placasSecundarias
  .map((p) => `<cac:AttachedTransportEquipment><cbc:ID>${x(normalizarPlaca(p))}</cbc:ID></cac:AttachedTransportEquipment>`)
  .join("");
// línea 131:
`<cac:TransportEquipment><cbc:ID>${x(normalizarPlaca(d.vehiculo.placa))}</cbc:ID>${adjuntos}</cac:TransportEquipment>`
```

Actualiza `datos-prueba.ts` (`placasSecundarias: []`) y cualquier otro constructor de `vehiculo` (`grep -rn "vehiculo: {" packages`). Si el XSD rechaza la posición, revisa el tipo `TransportEquipmentType` en los XSD de `referencias/sunat/` y coloca `AttachedTransportEquipment` donde exige la secuencia.

- [ ] **Step 4: PDF.** En `pdf.test.ts` reemplaza `vehiculoPlaca: "ABC-123"` por `placas: ["ABC-123"]` y agrega:

```ts
it("muestra tracto y carreta separados por barra", async () => {
  const texto = await textoDe(await generarPdfGuia({ ...datosGuia(), placas: ["F2F-848", "V1X-971"] }, { comprimir: false }));
  expect(texto).toContain("F2F-848 / V1X-971");
});
```

En `guia.ts`: `placas: string[];` y `campo(doc, d.placas.length > 1 ? "Placas" : "Placa", d.placas.join(" / "));`

- [ ] **Step 5: Esquema + migración.** En `guiaTransportista`, después de `vehiculoId`:

```ts
vehiculoSecundarioId: integer("vehiculo_secundario_id").references(() => vehiculo.id),
```

`pnpm --filter @sunatapp/db generar --name vehiculo_secundario`. Revisa que el SQL sea solo `ADD COLUMN` + FK.

- [ ] **Step 6: `cargar.ts`.**

```ts
const [vehSec] = guia.vehiculoSecundarioId
  ? await db.select().from(vehiculo).where(eq(vehiculo.id, guia.vehiculoSecundarioId))
  : [];
// …
return { guia, empresa: emp, remitente, destinatario, vehiculo: veh, vehiculoSecundario: vehSec ?? null, conductor: cond, items };
```

`datosGreDesde`: `vehiculo: { placa: d.vehiculo.placa, placasSecundarias: d.vehiculoSecundario ? [d.vehiculoSecundario.placa] : [] }`.
`datosPdfGuiaDesde`: `placas: [d.vehiculo.placa, ...(d.vehiculoSecundario ? [d.vehiculoSecundario.placa] : [])]`.

- [ ] **Step 7: Prueba de núcleo.** En `guias.test.ts`: inserta un vehículo `XYZ-987`, pon su id en `vehiculoSecundarioId` de una guía borrador (update directo), emite y verifica que el XML almacenado contiene `XYZ987`.

- [ ] **Step 8: Verificar y commit.** `pnpm test && pnpm typecheck`. `git commit -m "feat: guía transportista con vehículo secundario (carreta) en XML y PDF"`

---

### Task 3: Arreglos pendientes del Plan 1

Dos defectos conocidos:
1. En `aplicarRespuestaGuia`, si el CDR/PDF falla después del compare-and-set, se pierden `cdrZip` y `urlQr` (el claim ya puso `ticket = null`) y no hay barrido que regenere el PDF.
2. Al reemitir desde `rechazada`, si la **preparación** falla, `rutaXml` sigue apuntando al XML rechazado; el siguiente reintento (`fechaNueva = false`) reenvía ese XML viejo. Pasa en guías y facturas.

**Files:**
- Modify: `packages/db/src/schema.ts` (`guiaTransportista.urlQr`); migración `url_qr_guia`
- Modify: `packages/core/src/guias/emitir.ts`, `packages/core/src/facturas/emitir.ts`
- Test: `packages/core/test/guias.test.ts`, `packages/core/test/facturas.test.ts`

**Interfaces:**
- Produces:
  - `export async function generarPdfGuiaSiFalta(ctx: Contexto, guiaId: number): Promise<void>` (idempotente; nunca relanza)
  - `procesarPendientesGuias` también devuelve las guías `aceptada` a las que generó el PDF en esa pasada.

- [ ] **Step 1: Pruebas (fallan).** En `guias.test.ts`:

```ts
it("si el PDF falla tras la aceptación, conserva CDR y urlQr y el barrido regenera el PDF", async () => {
  const ctx = await contexto();
  const id = await registrarGuiaBorrador(ctx, entradaGuia());
  const guardarOriginal = ctx.almacen.guardar;
  ctx.almacen.guardar = async (ruta, c) => {
    if (ruta.endsWith(".pdf")) throw new Error("disco lleno");
    return guardarOriginal(ruta, c);
  };
  const r = await emitirGuia(ctx, id);
  expect(r.estado).toBe("aceptada");
  const [g1] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
  expect(g1!.rutaPdf).toBeNull();
  expect(g1!.rutaCdr).not.toBeNull();
  expect(g1!.urlQr).not.toBeNull();
  ctx.almacen.guardar = guardarOriginal;
  const cambios = await procesarPendientesGuias(ctx);
  expect(cambios.map((c) => c.id)).toContain(id);
  const [g2] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
  expect(g2!.rutaPdf).toMatch(/\.pdf$/);
});
```

Si `SunatSimulado` no devuelve `urlQr`, en esta prueba usa un gateway envoltorio que agregue `urlQr: "https://e-factura.sunat.gob.pe/v1/contribuyente/gre/comprobantes/descargaqr?hashqr=x"` a la respuesta de `consultarTicket`.

Segundo caso (guías), completo:
1. Gateway que la primera vez rechaza (`SunatSimulado({ rechazo: { codigo: "2800", mensaje: "dato inválido" }, demoraMs: 0 })`) y después acepta (`SunatSimulado({ demoraMs: 0 })`), conmutado por una variable.
2. `emitirGuia` → `rechazada`; guarda `xmlA = await ctx.almacen.leerTexto(guia.rutaXml!)`.
3. Avanza el reloj 10 minutos; haz que `ctx.almacen.guardar` lance para rutas `.xml`; `emitirGuia` → queda `pendiente_envio`. Afirma `rutaXml === null`.
4. Restaura `guardar`, cambia el gateway a "acepta", avanza el reloj 10 minutos más, `procesarPendientesGuias`.
5. Afirma que la guía quedó `aceptada` y que el XML almacenado es distinto de `xmlA`.

Agrega el caso equivalente en `facturas.test.ts` (rechazo con `SunatSimulado({ rechazo })` en `enviarFactura`).

- [ ] **Step 2: Ejecutar → FAIL.**

- [ ] **Step 3: Columna.** `urlQr: text("url_qr"),` en `guiaTransportista`; `pnpm --filter @sunatapp/db generar --name url_qr_guia`.

- [ ] **Step 4: `generarPdfGuiaSiFalta` y separación en `aplicarRespuestaGuia`.**

```ts
export async function generarPdfGuiaSiFalta(ctx: Contexto, guiaId: number): Promise<void> {
  const [g] = await ctx.db.select({ estado: guiaTransportista.estado, rutaPdf: guiaTransportista.rutaPdf })
    .from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g || g.estado !== "aceptada" || g.rutaPdf) return;
  try {
    const d = await cargarGuiaCompleta(ctx.db, guiaId);
    const nombre = nombreArchivo(d.empresa.ruc, "31", d.guia.serie, d.guia.numero!);
    const xml = await ctx.almacen.leerTexto(d.guia.rutaXml!);
    const textoQr = d.guia.urlQr ?? `${d.empresa.ruc}|31|${d.guia.serie}|${d.guia.numero}|${extraerDigest(xml)}|`;
    const pdf = await generarPdfGuia(datosPdfGuiaDesde(d, textoQr, ctx.simulado));
    const rutaPdf = await ctx.almacen.guardar(`guias/${nombre}.pdf`, pdf);
    await actualizar(ctx, guiaId, { rutaPdf });
  } catch (error) {
    await registrarAuditoria(ctx.db, { accion: "guia_pdf_pendiente", entidad: "guia_transportista", entidadId: guiaId, detalle: { error: (error as Error).message } });
  }
}
```

En `aplicarRespuestaGuia`, rama aceptada, reemplaza el bloque `try` actual por:

```ts
try {
  const [emp] = await ctx.db.select({ ruc: empresa.ruc }).from(empresa).limit(1);
  const [g] = await ctx.db.select({ serie: guiaTransportista.serie, numero: guiaTransportista.numero }).from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  const rutaCdr = r.cdrZip ? await ctx.almacen.guardar(`guias/R-${nombreArchivo(emp!.ruc, "31", g!.serie, g!.numero!)}.zip`, r.cdrZip) : null;
  await actualizar(ctx, guiaId, { rutaCdr, urlQr: r.urlQr ?? null });
} catch (error) {
  await actualizar(ctx, guiaId, { urlQr: r.urlQr ?? null }).catch(() => {});
  await registrarAuditoria(ctx.db, { accion: "guia_cdr_pendiente", entidad: "guia_transportista", entidadId: guiaId, detalle: { error: (error as Error).message } });
}
await generarPdfGuiaSiFalta(ctx, guiaId);
```

- [ ] **Step 5: Barrido** al final de `procesarPendientesGuias`, antes del `return`:

```ts
const sinPdf = await ctx.db.select({ id: guiaTransportista.id }).from(guiaTransportista)
  .where(and(eq(guiaTransportista.estado, "aceptada"), isNull(guiaTransportista.rutaPdf)));
for (const { id } of sinPdf) {
  await generarPdfGuiaSiFalta(ctx, id);
  const r = await resultadoGuia(ctx, id);
  if (r.rutaPdf && !cambios.some((c) => c.id === id)) cambios.push(r);
}
```

- [ ] **Step 6: Limpiar `rutaXml` al reemitir.** En la reserva de `emitirGuia`, dentro de `if (fechaNueva) { … }`, agrega `cambios.rutaXml = null;`. Mismo cambio en la reserva de `emitirFactura`.

- [ ] **Step 7: Verificar y commit.** `git commit -m "fix(core): PDF de guía recuperable tras la aceptación y no reenviar XML rechazado al reemitir"`

---

### Task 4: Documento recibido idempotente

**Files:**
- Modify: `packages/db/src/schema.ts`; migración `documento_idempotente`
- Create: `packages/core/src/documentos/recibidos.ts`
- Modify: `packages/core/src/guias/registrar.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/documentos.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ArchivoRecibido { contenido: Buffer; mime: string; telegramFileId?: string; usuarioId?: number }
export interface DocumentoRegistrado { id: number; nuevo: boolean; guiaId: number | null; rutaArchivo: string }
export async function registrarDocumentoRecibido(ctx: Contexto, a: ArchivoRecibido): Promise<DocumentoRegistrado>
export async function guardarExtraccion(ctx: Contexto, documentoId: number, datos: unknown, confianza: unknown): Promise<void>
```

  - `registrarGuiaBorrador` con un `documentoRecibidoId` que ya tiene guía devuelve **el id de esa guía** sin crear otra.

- [ ] **Step 1: Pruebas (fallan).**

```ts
describe("registrarDocumentoRecibido", () => {
  it("guarda el archivo una vez y devuelve el mismo documento al repetir", async () => {
    const ctx = await contexto();
    const pdf = Buffer.from("%PDF-1.4 prueba");
    const a = await registrarDocumentoRecibido(ctx, { contenido: pdf, mime: "application/pdf" });
    const b = await registrarDocumentoRecibido(ctx, { contenido: pdf, mime: "application/pdf" });
    expect(a.nuevo).toBe(true);
    expect(b).toEqual({ ...a, nuevo: false });
    expect(a.rutaArchivo).toMatch(/^recibidos\/[0-9a-f]{64}\.pdf$/);
    expect(await ctx.almacen.leer(a.rutaArchivo)).toEqual(pdf);
  });

  it("informa la guía ya registrada para ese documento y no crea otra", async () => {
    const ctx = await contexto();
    const d = await registrarDocumentoRecibido(ctx, { contenido: Buffer.from("x"), mime: "application/pdf" });
    const g1 = await registrarGuiaBorrador(ctx, { ...entradaGuia(), documentoRecibidoId: d.id });
    const g2 = await registrarGuiaBorrador(ctx, { ...entradaGuia(), documentoRecibidoId: d.id });
    expect(g2).toBe(g1);
    expect((await registrarDocumentoRecibido(ctx, { contenido: Buffer.from("x"), mime: "application/pdf" })).guiaId).toBe(g1);
  });
});
```

(`contexto()` es el mismo helper con `cerrables` que usa `guias.test.ts`; cópialo al archivo nuevo.)

- [ ] **Step 2: Ejecutar → FAIL.**

- [ ] **Step 3: Esquema.** `hashSha256: text("hash_sha256").unique(),` en `documentoRecibido`. En las restricciones de `guiaTransportista` agrega `unique("guia_documento_recibido").on(t.documentoRecibidoId)` (Postgres permite varios NULL). `pnpm --filter @sunatapp/db generar --name documento_idempotente`.

- [ ] **Step 4: `recibidos.ts`.**

```ts
import { createHash } from "node:crypto";
import { documentoRecibido, eq, guiaTransportista } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";

const EXTENSIONES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "audio/ogg": "ogg" };

async function guiaDe(ctx: Contexto, documentoId: number): Promise<number | null> {
  const [g] = await ctx.db.select({ id: guiaTransportista.id }).from(guiaTransportista).where(eq(guiaTransportista.documentoRecibidoId, documentoId));
  return g?.id ?? null;
}

export async function registrarDocumentoRecibido(ctx: Contexto, a: ArchivoRecibido): Promise<DocumentoRegistrado> {
  const hash = createHash("sha256").update(a.contenido).digest("hex");
  const [existente] = await ctx.db.select().from(documentoRecibido).where(eq(documentoRecibido.hashSha256, hash));
  if (existente) return { id: existente.id, nuevo: false, guiaId: await guiaDe(ctx, existente.id), rutaArchivo: existente.rutaArchivo };
  const rutaArchivo = await ctx.almacen.guardar(`recibidos/${hash}.${EXTENSIONES[a.mime] ?? "bin"}`, a.contenido);
  const [fila] = await ctx.db.insert(documentoRecibido)
    .values({ hashSha256: hash, rutaArchivo, mime: a.mime, telegramFileId: a.telegramFileId ?? null, usuarioId: a.usuarioId ?? null })
    .onConflictDoNothing({ target: documentoRecibido.hashSha256 })
    .returning({ id: documentoRecibido.id });
  if (fila) return { id: fila.id, nuevo: true, guiaId: null, rutaArchivo };
  const [ganador] = await ctx.db.select().from(documentoRecibido).where(eq(documentoRecibido.hashSha256, hash));
  return { id: ganador!.id, nuevo: false, guiaId: await guiaDe(ctx, ganador!.id), rutaArchivo: ganador!.rutaArchivo };
}

export async function guardarExtraccion(ctx: Contexto, documentoId: number, datos: unknown, confianza: unknown): Promise<void> {
  await ctx.db.update(documentoRecibido).set({ datosExtraidos: datos, confianza }).where(eq(documentoRecibido.id, documentoId));
}
```

- [ ] **Step 5: Idempotencia en `registrarGuiaBorrador`.** Antes de la transacción, si `e.documentoRecibidoId` está definido y ya hay guía con ese documento, devuelve su id. Si la transacción falla con violación de unicidad de `guia_documento_recibido` (código `23505` en `error.cause?.code ?? error.code`), vuelve a leer y devuelve el id existente.

- [ ] **Step 6: Exportar** `export * from "./documentos/recibidos";` en `index.ts`.

- [ ] **Step 7: Verificar y commit.** `git commit -m "feat(core): documento recibido idempotente por hash y guía única por documento"`

---

### Task 5: Transporte en la entrada de guía

**Files:**
- Modify: `packages/core/src/guias/validar.ts`, `packages/core/src/guias/registrar.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/transporte/transporte.ts`
- Test: `packages/core/test/transporte.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DatosConductor { numeroDoc: string; nombres: string; apellidos: string; licencia: string }
export interface TransporteGuia { rucTransportista: string; placaPrincipal: string; placasSecundarias: string[]; conductor: DatosConductor }
// EntradaGuia gana: transporte?: TransporteGuia   (sin él: primer vehículo y conductor activos, como hoy)
export interface ComparacionTransporte {
  rucEmpresaCoincide: boolean;
  placaPrincipal: "registrada" | "nueva";
  placasSecundarias: Array<{ placa: string; estado: "registrada" | "nueva" }>;
  conductor: "registrado" | "nuevo";
}
export async function compararTransporte(ctx: Contexto, t: TransporteGuia): Promise<ComparacionTransporte>
export async function registrarVehiculo(ctx: Contexto, placa: string): Promise<number>         // idempotente
export async function registrarConductor(ctx: Contexto, d: DatosConductor): Promise<number>    // idempotente por numeroDoc
export async function transporteHabitual(ctx: Contexto): Promise<TransporteGuia>              // RUC empresa, 1.er vehículo activo (+2.º activo como carreta si existe), 1.er conductor activo
```

Las placas se comparan normalizadas (`normalizarPlaca`: sin guiones, mayúsculas; reexpórtala desde `core` para que el bot no importe `sunat`) y se guardan con el formato recibido (`F2F-848`).

- [ ] **Step 1: Pruebas (fallan).**

```ts
const conductorDemo = { numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" };

describe("transporte", () => {
  it("compara contra lo registrado sin importar guiones ni mayúsculas", async () => {
    const ctx = await contexto();
    const t = { rucTransportista: "20606433094", placaPrincipal: "abc123", placasSecundarias: ["XYZ-987"], conductor: conductorDemo };
    expect(await compararTransporte(ctx, t)).toEqual({
      rucEmpresaCoincide: true, placaPrincipal: "registrada",
      placasSecundarias: [{ placa: "XYZ-987", estado: "nueva" }], conductor: "registrado",
    });
  });

  it("registrarVehiculo y registrarConductor no duplican", async () => {
    const ctx = await contexto();
    const a = await registrarVehiculo(ctx, "XYZ-987");
    expect(await registrarVehiculo(ctx, "xyz987")).toBe(a);
    const d = { numeroDoc: "01320429", nombres: "MARIO", apellidos: "MAMANI MAMANI", licencia: "U01320429" };
    const c = await registrarConductor(ctx, d);
    expect(await registrarConductor(ctx, d)).toBe(c);
  });

  it("registrarGuiaBorrador usa las placas y el conductor de la entrada", async () => {
    const ctx = await contexto();
    await registrarVehiculo(ctx, "XYZ-987");
    const id = await registrarGuiaBorrador(ctx, { ...entradaGuia(), transporte: {
      rucTransportista: "20606433094", placaPrincipal: "ABC-123", placasSecundarias: ["XYZ-987"], conductor: conductorDemo } });
    const d = await cargarGuiaCompleta(ctx.db, id);
    expect(d.vehiculoSecundario?.placa).toBe("XYZ-987");
  });

  it("rechaza placas no registradas y un RUC de transportista ajeno", async () => {
    const ctx = await contexto();
    const base = { rucTransportista: "20606433094", placaPrincipal: "ABC-123", placasSecundarias: [], conductor: conductorDemo };
    await expect(registrarGuiaBorrador(ctx, { ...entradaGuia(), transporte: { ...base, placaPrincipal: "QQQ-111" } }))
      .rejects.toThrow("La placa QQQ-111 no está registrada");
    await expect(registrarGuiaBorrador(ctx, { ...entradaGuia(), transporte: { ...base, rucTransportista: "20131312955" } }))
      .rejects.toThrow("El transportista de la guía no es la empresa");
  });

  it("transporteHabitual devuelve lo registrado", async () => {
    const ctx = await contexto();
    expect(await transporteHabitual(ctx)).toEqual({ rucTransportista: "20606433094", placaPrincipal: "ABC-123", placasSecundarias: [], conductor: conductorDemo });
  });
});
```

- [ ] **Step 2: Ejecutar → FAIL.**

- [ ] **Step 3: Validación.** En `validarEntradaGuia`, si hay `transporte`: RUC inválido → "RUC del transportista inválido"; placa principal con menos de 5 caracteres alfanuméricos tras normalizar → "Placa inválida"; `validarDni` falla → "DNI del conductor inválido"; licencia vacía → "Falta la licencia del conductor"; nombres o apellidos vacíos → "Faltan los nombres del conductor".

- [ ] **Step 4: Implementar `transporte.ts`.** Búsqueda por placa normalizada:

```ts
const placaSql = sql`upper(regexp_replace(${vehiculo.placa}, '[^A-Za-z0-9]', '', 'g'))`;
const [v] = await ctx.db.select({ id: vehiculo.id }).from(vehiculo).where(sql`${placaSql} = ${normalizarPlaca(placa)}`);
```

En `registrarGuiaBorrador`, con `e.transporte`: `rucTransportista !== emp.ruc` → `ErrorNegocio("El transportista de la guía no es la empresa")`; más de una placa secundaria → `ErrorNegocio("Solo se admite una carreta por guía")`; vehículo no encontrado → `ErrorNegocio(\`La placa ${placa} no está registrada\`)`; conductor no encontrado → `ErrorNegocio(\`El conductor con DNI ${dni} no está registrado\`)`; guarda `vehiculoSecundarioId`.

- [ ] **Step 5: Exportar, verificar y commit.** `git commit -m "feat(core): transporte de la guía (placas y conductor) y comparación con lo registrado"`

---

### Task 6: Utilidades para el bot y hook de log

**Files:**
- Create: `packages/core/src/consultas/consultas.ts`, `packages/core/src/usuarios/usuarios.ts`
- Modify: `packages/core/src/infra/contexto.ts`, `packages/core/src/guias/emitir.ts`, `packages/core/src/facturas/emitir.ts`, `packages/core/src/cobros/cobros.ts`, `packages/core/src/index.ts`, `packages/core/test/helpers.ts`
- Test: `packages/core/test/consultas.test.ts`

**Interfaces:**
- Produces:

```ts
// contexto.ts
export type NivelLog = "info" | "error";
export interface Contexto { /* … */ log?: (nivel: NivelLog, mensaje: string, detalle?: unknown) => void }

// consultas.ts
export interface FilaGuia { id: number; serieNumero: string; estado: EstadoGuia; fechaTraslado: string; remitente: string; destinatario: string; facturada: boolean }
export async function listarGuias(ctx: Contexto, limite?: number): Promise<FilaGuia[]>       // más recientes primero, default 10
export async function listarBorradores(ctx: Contexto): Promise<FilaGuia[]>                  // estado borrador o rechazada
export async function listarGuiasSinFacturar(ctx: Contexto): Promise<FilaGuia[]>            // aceptadas sin factura_guia
export async function buscarGuiaPorSerieNumero(ctx: Contexto, texto: string): Promise<{ id: number } | null>
export async function buscarContrapartePorDoc(ctx: Contexto, numeroDoc: string): Promise<{ id: number; razonSocial: string } | null>

// usuarios.ts
export type Usuario = typeof usuario.$inferSelect;
export async function hayUsuarios(ctx: Contexto): Promise<boolean>
export async function hayDueno(ctx: Contexto): Promise<boolean>                               // algún usuario con telegramId
export async function registrarUsuarioTelegram(ctx: Contexto, telegramId: number): Promise<Usuario>
//   asigna al primer usuario sin telegramId; si ya hay dueño → ErrorNegocio("El bot ya tiene dueño"); sin usuarios → ErrorNegocio("Ejecuta pnpm sembrar primero")
export async function usuarioPorTelegram(ctx: Contexto, telegramId: number): Promise<Usuario | null>  // solo activos
export async function duenoTelegramId(ctx: Contexto): Promise<number | null>                // telegramId del usuario de menor id con telegramId
export async function auditarTelegramDesconocido(ctx: Contexto, telegramId: number, texto: string | undefined): Promise<void>
export async function contarAuditoria(ctx: Contexto, accion: string): Promise<number>
```

Además, `EstadoGuia` se reexporta desde `core` (`export type { EstadoGuia } from "@sunatapp/db"`), y `crearContextoPrueba` gana la opción `datos?: DatosIniciales`.

- [ ] **Step 1: Pruebas (fallan).** Cubre: `listarGuias` ordena por id descendente y marca `facturada`; `listarBorradores` incluye borrador y rechazada, excluye aceptada; `listarGuiasSinFacturar`; `buscarGuiaPorSerieNumero("v001-1")` encuentra la guía emitida con número 1 y devuelve null para "V001-99" y "basura"; `registrarUsuarioTelegram` con un contexto sembrado sin `telegramId` asigna el ID y un segundo llamado lanza "El bot ya tiene dueño"; `usuarioPorTelegram` devuelve null para desconocidos e inactivos; `duenoTelegramId`; `auditarTelegramDesconocido` + `contarAuditoria`.

- [ ] **Step 2: Implementar.** `registrarUsuarioTelegram` en transacción con `select … for("update")` sobre `usuario`.

- [ ] **Step 3: Log.** Agrega `log?` a `Contexto`. En cada `catch` que silencia errores en `procesarPendientesGuias`, `procesarPendientesFacturas`, `generarPdfGuiaSiFalta` y `generarPdfFacturaSiFalta` agrega `ctx.log?.("error", "<qué falló> <id>", error);` sin cambiar el flujo. Prueba: un contexto con `log` que acumula, un PDF que falla → hay una entrada `error`.

- [ ] **Step 4: Verificar y commit.** `git commit -m "feat(core): consultas de guías, usuarios de Telegram y hook de log"`

---

### Task 7: Paquete `extractor` (lector de guías por reglas)

**Files:**
- Create: `packages/extractor/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/extractor/src/tipos.ts`, `src/texto-pdf.ts`, `src/lector-reglas.ts`, `src/index.ts`
- Create: `packages/extractor/test/fixtures/guia-desordenada.txt` (datos inventados), `test/lector-reglas.test.ts`, `test/muestras.test.ts`
- Create (git-ignorado, solo local): `referencias/muestras/GUIA DE REMISION TTT4-0000202.esperado.json`

**Interfaces:**
- Produces:

```ts
export type Confianza = "segura" | "dudosa";
export interface Campo<T> { valor: T | null; confianza: Confianza }
export interface GuiaExtraida {
  serieNumero: Campo<string>;                                   // "TTT4-202" (sin ceros a la izquierda en el número)
  remitente: Campo<{ numeroDoc: string; razonSocial: string }>;
  destinatario: Campo<{ numeroDoc: string; razonSocial: string }>;
  transportista: Campo<{ ruc: string; razonSocial: string }>;
  partida: Campo<{ direccion: string; ubigeo: string }>;
  llegada: Campo<{ direccion: string; ubigeo: string }>;
  fechaTraslado: Campo<string>;                                 // AAAA-MM-DD
  pesoBruto: Campo<string>;                                     // "31.87"
  unidadPeso: Campo<"KGM" | "TNE">;
  placas: Campo<{ principal: string; secundarias: string[] }>;
  conductor: Campo<{ numeroDoc: string; nombres: string; apellidos: string; licencia: string | null }>;
  items: Campo<Array<{ descripcion: string; cantidad: string; unidadMedida: string }>>;
  documentosRelacionados: string[];                             // p. ej. ["F127-133917"] (informativo)
}
export interface ProveedorExtraccion { nombre: string; extraer(archivo: { contenido: Buffer; mime: string }): Promise<GuiaExtraida> }
export interface Validadores { validarRuc(ruc: string): boolean; obtenerUbigeo(codigo: string): { codigo: string } | undefined }
export async function textoDePdf(contenido: Buffer): Promise<string>
export function leerGuiaDeTexto(texto: string, v: Validadores): GuiaExtraida           // puro, sin E/S
export function crearExtractor(config: { tipo: "reglas" | "ia" }, v: Validadores): ProveedorExtraccion
//   "ia" → lanza Error("Lector con IA no disponible aún")
export class PdfSinTextoError extends Error {}
```

**Cómo sale el texto real** (verificado con `unpdf` sobre la muestra TTT4-202; etiquetas y valores en bloques separados, varios valores pegados):

```
RUC 20542642166                                          ← RUC del remitente (encabezado)
TTT4 - 202                                               ← serie - número de la GRE-R
TRANSPORTE INTERNACIONAL MAIRUMAX S.A.C.20608650581      ← transportista: razón social + RUC pegados
CORPORACION CODISUR S.R.L.                               ← destinatario (razón social)
20542642166                                              ← destinatario (RUC solo en una línea)
F2F-848 - V1X-971                                        ← placas: principal - secundarias
750.00                                                   ← número de bultos
31.87                                                    ← peso bruto
MARIO MAMANI MAMANI01320429                              ← conductor: nombre completo + DNI pegados
: 8/08/2026                                              ← fecha
8/08/2026                                                ← fecha
CARRETERA A YURA KM. 26 ESTACION YURA AREQUIPA040128     ← partida: dirección + ubigeo pegados
MZA. T LOTE. 3 AV ORGULLO AYMARA … PUNO - PUNO -210101   ← llegada: dirección + " -" + ubigeo
U01320429LICENCIA DE CONDUCIR :                          ← licencia pegada a la etiqueta
TNE                                                      ← unidad real del peso (la etiqueta dice "(KGM)": manda la unidad suelta)
CORPORACION CODISUR S.R.L                                ← membrete del remitente
CEMENTO HS + R X 42.5 KG RUMI BLS 750.0000100100131      ← ítem: descripción + unidad + cantidad (4 decimales) + código pegado
PEDIDO SAP N° 107475228 - FACTURA F127-133917            ← observaciones
```

Entre esas líneas aparecen etiquetas sueltas (`DENOMINACIÓN`, `RUC :`, `:`, `MOTIVO DE TRASLADO`, `COMPRA`, `DESTINATARIO`, `DATOS DEL TRASLADO`, etc.).

**Reglas** (en `lector-reglas.ts`; trabajar con `texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)`):

| Campo | Regla | Segura cuando |
|-------|-------|---------------|
| serieNumero | línea `^([A-Z0-9]{4})\s*-\s*(\d{1,8})$` → `SERIE-número` sin ceros | una sola línea coincide |
| remitente.numeroDoc | primera línea `^RUC\s+(\d{11})$` con RUC válido | encontrada |
| transportista | primera línea `^(.*\D)(\d{11})$` con RUC válido y que no empieza con "RUC" | encontrada |
| destinatario | línea de texto seguida inmediatamente de una línea `^\d{11}$` con RUC válido (después del transportista) | ambas encontradas |
| remitente.razonSocial | si destinatario.RUC == remitente.RUC → razón social del destinatario; si no, la primera línea de texto después de la línea suelta `^(KGM\|TNE)$` | igualdad de RUC o membrete encontrado |
| placas | línea `^([A-Z0-9]{3}-?[A-Z0-9]{3})((\s*-\s*[A-Z0-9]{3}-?[A-Z0-9]{3})*)$` | encontrada |
| pesoBruto | entre las dos líneas `^\d+(\.\d+)?$` que siguen a las placas, la que **no** es igual a la suma de cantidades de los ítems (esa es el número de bultos) | una sola candidata tras descartar bultos |
| unidadPeso | línea suelta `^(KGM\|TNE)$`; si no hay, `KGM` dudosa | encontrada |
| conductor | línea `^([A-ZÑÁÉÍÓÚ ]+?)(\d{8})$`; apellidos = las 2 últimas palabras; nombres = el resto; licencia `([A-Z]\d{8})(?=LICENCIA)` o línea `^[A-Z]\d{8}$` | DNI y licencia encontrados y ≥ 3 palabras |
| partida / llegada | líneas `^(.*?)(?:\s*-)?\s*(\d{6})$` cuyo código existe en `obtenerUbigeo`; la 1.ª es partida y la 2.ª llegada; dirección sin guion final | exactamente 2 candidatas |
| fechaTraslado | todas las `(\d{1,2})/(\d{2})/(\d{4})` → `AAAA-MM-DD` | todas iguales (si difieren: la última, dudosa) |
| items | líneas `^(.+?)\s+(BLS\|NIU\|KGM\|TNE\|BX\|ZZ\|MTR\|LTR\|GLN\|UND)\s+(\d+\.\d{4})\S*$`; `UND`→`NIU`; cantidad sin ceros sobrantes (`"750"`, `"12.5"`) | al menos un ítem |
| documentosRelacionados | `FACTURA\s+([A-Z0-9]{4}-\d+)` | informativo |

Nunca inventa: sin candidato → `{ valor: null, confianza: "dudosa" }`.

- [ ] **Step 1: Paquete.** `package.json`:

```json
{
  "name": "@sunatapp/extractor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "unpdf": "^1.8.1" },
  "devDependencies": { "@sunatapp/core": "workspace:*" }
}
```

`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`. `vitest.config.ts` igual al de la Task 1. `pnpm install`.

- [ ] **Step 2: Fixture con datos inventados** `test/fixtures/guia-desordenada.txt`: el mismo orden y ruido del bloque de arriba, con estos datos: remitente `RUC 20131312955` (membrete `DISTRIBUIDORA SAC`), GRE-R `EG07 - 5531`, transportista `TRANSPORTES DEMO SAC20606433094`, destinatario `CHOCANO CARGO SAC` / `20602712592`, placas `ABC-123 - XYZ-987`, bultos `120.00`, peso `1500.5`, conductor `JHON LARRY VELEZMORO SOZA45288569`, fechas `: 14/09/2026` y `14/09/2026`, partida `AV. 28 DE JULIO 1275 LIMA150115`, llegada `CARRETERA FEDERICO BASADRE KM 86 PUCALLPA -250101`, licencia `Q45288569LICENCIA DE CONDUCIR :`, unidad `KGM`, ítem `CAJAS DE CERAMICA BX 120.0000100200300`, observaciones `PEDIDO 998 - FACTURA F001-4455`.

- [ ] **Step 3: Prueba (falla).**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leerGuiaDeTexto } from "../src/lector-reglas";

const v = {
  validarRuc: (r: string) => ["20131312955", "20606433094", "20602712592"].includes(r),
  obtenerUbigeo: (c: string) => (["150115", "250101"].includes(c) ? { codigo: c } : undefined),
};
const texto = readFileSync(new URL("./fixtures/guia-desordenada.txt", import.meta.url), "utf8");

describe("leerGuiaDeTexto", () => {
  it("extrae todos los campos de una guía desordenada", () => {
    const g = leerGuiaDeTexto(texto, v);
    expect(g.serieNumero).toEqual({ valor: "EG07-5531", confianza: "segura" });
    expect(g.remitente).toEqual({ valor: { numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA SAC" }, confianza: "segura" });
    expect(g.transportista.valor).toEqual({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC" });
    expect(g.destinatario.valor).toEqual({ numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO SAC" });
    expect(g.placas.valor).toEqual({ principal: "ABC-123", secundarias: ["XYZ-987"] });
    expect(g.pesoBruto).toEqual({ valor: "1500.5", confianza: "segura" });
    expect(g.unidadPeso.valor).toBe("KGM");
    expect(g.conductor.valor).toEqual({ numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" });
    expect(g.partida.valor).toEqual({ direccion: "AV. 28 DE JULIO 1275 LIMA", ubigeo: "150115" });
    expect(g.llegada.valor).toEqual({ direccion: "CARRETERA FEDERICO BASADRE KM 86 PUCALLPA", ubigeo: "250101" });
    expect(g.fechaTraslado).toEqual({ valor: "2026-09-14", confianza: "segura" });
    expect(g.items.valor).toEqual([{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }]);
    expect(g.documentosRelacionados).toEqual(["F001-4455"]);
  });

  it("no inventa: texto vacío deja todo en null y dudoso", () => {
    const g = leerGuiaDeTexto("", v);
    expect(g.serieNumero).toEqual({ valor: null, confianza: "dudosa" });
    expect(g.items).toEqual({ valor: null, confianza: "dudosa" });
    expect(g.documentosRelacionados).toEqual([]);
  });

  it("marca dudosa la serie cuando hay dos candidatas", () => {
    expect(leerGuiaDeTexto(`${texto}\nAB12 - 99`, v).serieNumero.confianza).toBe("dudosa");
  });
});
```

- [ ] **Step 4: Ejecutar → FAIL.** `pnpm vitest run packages/extractor`.

- [ ] **Step 5: Implementar.** `lector-reglas.ts` según la tabla. `texto-pdf.ts`:

```ts
import { extractText, getDocumentProxy } from "unpdf";

export async function textoDePdf(contenido: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(contenido));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}
```

`index.ts` con `crearExtractor`: `extraer` lanza `PdfSinTextoError("Solo PDF por ahora")` si `mime !== "application/pdf"`; si `textoDePdf` falla o devuelve menos de 50 caracteres lanza `PdfSinTextoError("El PDF no tiene texto")`; si no, `leerGuiaDeTexto`. Exporta todo lo de `tipos.ts`.

- [ ] **Step 6: Prueba con muestras reales (local).** `test/muestras.test.ts` recorre `referencias/muestras/*.pdf` que tengan al lado `<mismo nombre>.esperado.json`; si no hay carpeta o pares, `it.skip("sin muestras locales")`. Compara campo por campo con `crearExtractor({ tipo: "reglas" }, { validarRuc, obtenerUbigeo })` (importados de `@sunatapp/core` solo en la prueba), imprime `aciertos/total` y exige todos los campos acertados. Crea el `.esperado.json` de TTT4-202 (git-ignorado) con forma `GuiaExtraida` pero solo los `valor`: serie `TTT4-202`, remitente `20542642166` "CORPORACION CODISUR S.R.L.", transportista `20608650581` "TRANSPORTE INTERNACIONAL MAIRUMAX S.A.C.", destinatario `20542642166` "CORPORACION CODISUR S.R.L.", placas `F2F-848` + `["V1X-971"]`, peso `31.87` `TNE`, conductor `01320429` "MARIO" / "MAMANI MAMANI" / `U01320429`, partida ubigeo `040128` dirección "CARRETERA A YURA KM. 26 ESTACION YURA AREQUIPA", llegada ubigeo `210101`, fecha `2026-08-08`, ítems `[{ "descripcion": "CEMENTO HS + R X 42.5 KG RUMI", "cantidad": "750", "unidadMedida": "BLS" }]`, relacionados `["F127-133917"]`. Para la dirección de llegada usa lo que devuelva la regla y verifícalo a mano contra el PDF.

- [ ] **Step 7: Verificar y commit.** `git status` no debe listar nada de `referencias/`. `git commit -m "feat(extractor): lector de guías por reglas sobre el texto del PDF"`

---

### Task 8: `apps/bot` — base, registro del dueño y arnés de pruebas

**Files:**
- Create: `apps/bot/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `apps/bot/src/config.ts`, `src/log.ts`, `src/textos.ts`, `src/sesion.ts`, `src/registro.ts`, `src/bot.ts`
- Create: `apps/bot/test/arnes.ts`, `test/registro.test.ts`
- Modify: `vitest.config.ts` (agregar `apps/*` a `projects`), `package.json` raíz (script `bot`)

**Interfaces:**
- Produces:

```ts
// config.ts
export interface ConfigBot { token: string; extractor: "reglas" | "ia"; horaAviso: string; logDir: string }
export function cargarConfigBot(env?: Record<string, string | undefined>): ConfigBot  // sin token → Error("Falta TELEGRAM_BOT_TOKEN en .env"); defaults: reglas, "08:00", "./logs"

// log.ts
export interface Logger { info(m: string, d?: unknown): void; error(m: string, d?: unknown): void }
export function crearLogger(dir: string): Logger     // una línea JSON por evento en <dir>/bot.log (appendFile) y en consola

// sesion.ts
export interface Sesion { usuarioId?: number; flujo?: EstadoFlujoGuia | EstadoFlujoFactura }   // tipos de flujo: Tasks 9 y 10 (aquí: `flujo?: { tipo: string }` y se refinan luego)

// bot.ts
export interface Dependencias {
  ctx: Contexto;
  extractor: ProveedorExtraccion;
  descargarArchivo(fileId: string): Promise<Buffer>;
  enSegundoPlano(tarea: () => Promise<void>): void;    // prod: void tarea().catch((e) => log.error(...)); pruebas: acumula
  codigoRegistro: string | null;                       // 6 dígitos si no hay dueño al arrancar; se pone en null al usarse
  log: Logger;
}
export type ContextoBot = Context & SessionFlavor<Sesion>;
export function crearBot(token: string, deps: Dependencias, botInfo?: UserFromGetMe): Bot<ContextoBot>

// registro.ts
export function generarCodigoRegistro(): string        // 6 dígitos con crypto.randomInt(0, 1_000_000), con ceros a la izquierda
export function middlewareAutorizacion(deps: Dependencias): Middleware<ContextoBot>
```

  - El middleware: `usuarioPorTelegram(from.id)`; si existe, `session.usuarioId = u.id` y `next()`. Si no existe, `deps.codigoRegistro` no es null y el texto es exactamente ese código → `registrarUsuarioTelegram`, `deps.codigoRegistro = null`, responde `textos.registroOk`. En cualquier otro caso no responde nada y llama `auditarTelegramDesconocido`.

- [ ] **Step 1: Paquete.**

```json
{
  "name": "@sunatapp/bot",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "tsx src/main.ts" },
  "dependencies": { "@sunatapp/core": "workspace:*", "@sunatapp/extractor": "workspace:*", "grammy": "^1.46.0" },
  "devDependencies": { "pdfkit": "^0.20.2", "@types/pdfkit": "^0.17.6" }
}
```

Script raíz: `"bot": "pnpm --filter @sunatapp/bot start"`. `tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`. `vitest.config.ts` como en la Task 1. `pnpm install`. Agrega `"apps/*"` a `projects` en el `vitest.config.ts` raíz.

- [ ] **Step 2: Arnés `test/arnes.ts`.** Crea el bot con `botInfo` fijo (sin `getMe`) e intercepta todas las llamadas salientes con un transformer:

```ts
import type { Update, UserFromGetMe } from "grammy/types";
import type { SunatGateway } from "@sunatapp/sunat"; // solo tipos en pruebas: si no resuelve, usa Parameters<typeof crearContextoPrueba>[0]
import { crearExtractor } from "@sunatapp/extractor";
import { obtenerUbigeo, validarRuc, type Contexto } from "@sunatapp/core";
import { crearContextoPrueba, DATOS_INICIALES } from "../../../packages/core/test/helpers";
import { crearBot, type Dependencias } from "../src/bot";

export interface Llamada { metodo: string; payload: Record<string, unknown> }
const BOT_INFO: UserFromGetMe = {
  id: 1, is_bot: true, first_name: "Bot", username: "prueba_bot", can_join_groups: false,
  can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false,
} as UserFromGetMe;

export async function crearArnes(o: {
  codigoRegistro?: string | null; archivos?: Record<string, Buffer>; sinDueno?: boolean;
  gateway?: SunatGateway; ctx?: Contexto;
} = {}) {
  const creado = o.ctx ? null : await crearContextoPrueba({
    ...(o.gateway ? { gateway: o.gateway } : {}),
    ...(o.sinDueno ? { datos: { ...DATOS_INICIALES, usuario: { nombre: "Dueño", email: "d@x.pe" } } } : {}),
  });
  const ctx = o.ctx ?? creado!.ctx;
  const llamadas: Llamada[] = [];
  const tareas: Promise<void>[] = [];
  let mensajeId = 1000;
  const deps: Dependencias = {
    ctx,
    extractor: crearExtractor({ tipo: "reglas" }, { validarRuc, obtenerUbigeo }),
    descargarArchivo: async (id) => o.archivos?.[id] ?? Buffer.from(""),
    enSegundoPlano: (t) => { tareas.push(t()); },
    codigoRegistro: o.codigoRegistro ?? null,
    log: { info() {}, error() {} },
  };
  const bot = crearBot("123:prueba", deps, BOT_INFO);
  bot.api.config.use(async (_prev, metodo, payload) => {
    llamadas.push({ metodo, payload: payload as Record<string, unknown> });
    const conMensaje = ["sendMessage", "sendDocument", "editMessageText"].includes(metodo);
    return { ok: true, result: conMensaje ? { message_id: ++mensajeId, date: 0, chat: { id: 111, type: "private" } } : true } as never;
  });
  let updateId = 1;
  const de = (id: number) => ({ id, is_bot: false, first_name: "Usuario" });
  const chat = (id: number) => ({ id, type: "private" as const, first_name: "U" });
  const enviar = (u: Omit<Update, "update_id">) => bot.handleUpdate({ update_id: updateId++, ...u } as Update);
  return {
    ctx, deps, llamadas,
    cerrar: async () => { await Promise.allSettled(tareas); if (creado) await creado.cerrar(); },
    texto: (t: string, userId = 111) => enviar({ message: {
      message_id: updateId, date: 0, chat: chat(userId), from: de(userId), text: t,
      ...(t.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: t.split(" ")[0]!.length }] } : {}),
    } } as never),
    documento: (fileId: string, mime = "application/pdf", userId = 111, tamano = 1000) => enviar({ message: {
      message_id: updateId, date: 0, chat: chat(userId), from: de(userId),
      document: { file_id: fileId, file_unique_id: fileId, mime_type: mime, file_size: tamano },
    } } as never),
    foto: (fileId: string, userId = 111) => enviar({ message: {
      message_id: updateId, date: 0, chat: chat(userId), from: de(userId),
      photo: [{ file_id: fileId, file_unique_id: fileId, width: 1, height: 1 }],
    } } as never),
    boton: (data: string, userId = 111) => enviar({ callback_query: {
      id: String(updateId), from: de(userId), chat_instance: "x", data,
      message: { message_id: 1, date: 0, chat: chat(userId) },
    } } as never),
    async esperarTareas() { while (tareas.length) await tareas.shift(); },
    textosEnviados: () => llamadas
      .filter((l) => ["sendMessage", "editMessageText"].includes(l.metodo) || (l.metodo === "sendDocument" && l.payload.caption))
      .map((l) => String(l.payload.text ?? l.payload.caption)),
    documentosEnviados: () => llamadas.filter((l) => l.metodo === "sendDocument"),
    botones: () => {
      const ultima = [...llamadas].reverse().find((l) => (l.payload.reply_markup as { inline_keyboard?: unknown } | undefined)?.inline_keyboard);
      return ((ultima?.payload.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } | undefined)?.inline_keyboard ?? []).flat();
    },
  };
}
```

Si el import relativo a `packages/core/test/helpers.ts` no resuelve con TypeScript, agrega ese archivo al `include` del `tsconfig` del bot. Si `@sunatapp/sunat` no está disponible para el bot, tipa `gateway` con `NonNullable<Parameters<typeof crearContextoPrueba>[0]>["gateway"]` (el bot no debe depender de `sunat`).

- [ ] **Step 3: Pruebas de registro (fallan).**

```ts
describe("registro del dueño", () => {
  it("el primero que envía el código queda como dueño y el código deja de valer", async () => {
    const a = await crearArnes({ sinDueno: true, codigoRegistro: "482913" });
    await a.texto("482913", 555);
    expect(a.textosEnviados().at(-1)).toBe("✅ Listo. Solo te atenderé a ti.");
    expect(await usuarioPorTelegram(a.ctx, 555)).not.toBeNull();
    await a.texto("482913", 777);
    expect(a.textosEnviados()).toHaveLength(1);
    await a.cerrar();
  });

  it("ignora y audita a desconocidos", async () => {
    const a = await crearArnes();
    await a.texto("hola", 999);
    expect(a.llamadas).toHaveLength(0);
    expect(await contarAuditoria(a.ctx, "telegram_desconocido")).toBe(1);
    await a.cerrar();
  });

  it("atiende al dueño registrado", async () => {
    const a = await crearArnes();           // DATOS_INICIALES tiene telegramId 111
    await a.texto("/ayuda");
    expect(a.textosEnviados().at(-1)).toContain("/cobros");
    await a.cerrar();
  });

  it("generarCodigoRegistro da 6 dígitos", () => {
    expect(generarCodigoRegistro()).toMatch(/^\d{6}$/);
  });
});
```

- [ ] **Step 4: Implementar** `config.ts`, `log.ts`, `textos.ts`, `sesion.ts`, `registro.ts`, `bot.ts`: `new Bot<ContextoBot>(token, botInfo ? { botInfo } : {})`, `bot.use(session({ initial: (): Sesion => ({}) }))`, `bot.use(middlewareAutorizacion(deps))`, `bot.command(["start", "ayuda"], (c) => c.reply(textos.ayuda))`, `bot.catch((e) => { deps.log.error("error en manejador", e.error); void e.ctx.reply(textos.errorGenerico).catch(() => {}); })`.

`textos.ts` (este paso):

```ts
export const textos = {
  registroOk: "✅ Listo. Solo te atenderé a ti.",
  errorGenerico: "😕 Algo salió mal. Ya quedó anotado; intenta de nuevo en un momento.",
  ayuda: [
    "📋 Qué puedo hacer:",
    "• Envíame el PDF de la guía del remitente y emito la guía de transportista.",
    "/guias — últimas guías",
    "/pendientes — guías por terminar",
    "/facturar V001-1 — facturar una guía",
    "/cobros — facturas por cobrar",
    "/pagado F001-1 [monto] — registrar un cobro",
    "/cancelar — cancelar lo que estemos haciendo",
  ].join("\n"),
};
```

- [ ] **Step 5: Verificar y commit.** `git commit -m "feat(bot): base del bot con registro del dueño y arnés de pruebas"`

---

### Task 9: Flujo de guía por Telegram

**Files:**
- Create: `packages/core/src/guias/desde-extraccion.ts` (+ export en `index.ts`), `packages/core/test/desde-extraccion.test.ts`
- Create: `apps/bot/src/flujo-guia.ts`, `apps/bot/test/pdf-prueba.ts`, `apps/bot/test/flujo-guia.test.ts`
- Modify: `apps/bot/src/bot.ts`, `apps/bot/src/textos.ts`, `apps/bot/src/sesion.ts`, `apps/bot/test/arnes.ts`

**Interfaces:**
- Consumes: `registrarDocumentoRecibido`, `guardarExtraccion`, `validarEntradaGuia`, `compararTransporte`, `registrarVehiculo`, `registrarConductor`, `transporteHabitual`, `registrarGuiaBorrador`, `emitirGuia`, `resultadoGuia`, `buscarUbigeos`, `obtenerUbigeo`, `cargarGuiaCompleta` (core); `ProveedorExtraccion`, `GuiaExtraida`, `PdfSinTextoError` (extractor).
- Produces:

```ts
// core/guias/desde-extraccion.ts — no importa el paquete extractor: tipo estructural propio
export interface CampoExtraido<T> { valor: T | null; confianza: "segura" | "dudosa" }
export interface GuiaExtraidaMinima {
  serieNumero: CampoExtraido<string>;
  remitente: CampoExtraido<{ numeroDoc: string; razonSocial: string }>;
  destinatario: CampoExtraido<{ numeroDoc: string; razonSocial: string }>;
  partida: CampoExtraido<{ direccion: string; ubigeo: string }>;
  llegada: CampoExtraido<{ direccion: string; ubigeo: string }>;
  fechaTraslado: CampoExtraido<string>;
  pesoBruto: CampoExtraido<string>;
  unidadPeso: CampoExtraido<"KGM" | "TNE">;
  items: CampoExtraido<Array<{ descripcion: string; cantidad: string; unidadMedida: string }>>;
}
export const ORDEN_CAMPOS = ["serieNumero", "remitente", "destinatario", "partida", "llegada", "fechaTraslado", "pesoBruto", "unidadPeso", "items"] as const;
export type CampoGuia = (typeof ORDEN_CAMPOS)[number];
export interface Borrador {
  fechaTraslado: string | null; remitente: { numeroDoc: string; razonSocial: string } | null; destinatario: { numeroDoc: string; razonSocial: string } | null;
  partida: { direccion: string; ubigeo: string } | null; llegada: { direccion: string; ubigeo: string } | null;
  pesoBruto: string | null; unidadPeso: "KGM" | "TNE" | null; greRemitenteRef: string | null;
  items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }> | null;
  faltantes: CampoGuia[];                     // null, dudosos o inválidos, en ORDEN_CAMPOS
}
export function borradorDesdeExtraccion(g: GuiaExtraidaMinima): Borrador
export function aplicarRespuesta(b: Borrador, campo: Exclude<CampoGuia, "partida" | "llegada">, texto: string): { borrador: Borrador; error?: string }
export function aplicarLugar(b: Borrador, campo: "partida" | "llegada", direccion: string, ubigeo: string): Borrador
export function entradaDesdeBorrador(b: Borrador, transporte: TransporteGuia, documentoRecibidoId: number): EntradaGuia   // lanza ErrorValidacion si falta algo
export function borradorDesdeGuia(d: GuiaCompleta): Borrador                               // para "Corregir y reenviar" y "Retomar"

// apps/bot/src/sesion.ts
export interface EstadoFlujoGuia {
  tipo: "guia";
  paso: "transporte" | "preguntando" | "distrito" | "resumen" | "eligiendo_campo" | "emitiendo";
  documentoId: number;
  guiaId?: number;                            // si se retoma una guía existente (rechazada/borrador)
  borrador: Borrador;
  transporte: TransporteGuia;
  pendientesTransporte: Array<{ tipo: "placa"; placa: string; habitual: string | null } | { tipo: "conductor"; datos: DatosConductor }>;
  campoActual?: CampoGuia;
  direccionPendiente?: string;                // partida/llegada: dirección ya escrita, falta elegir distrito
}
```

**`aplicarRespuesta` por campo:**
- `serieNumero`: `^[A-Z0-9]{4}-\d{1,8}$` (mayúsculas) → `greRemitenteRef`; error "Escríbela así: EG07-5531".
- `fechaTraslado`: `dd/mm/aaaa` o `aaaa-mm-dd` válida → error "Escribe la fecha así: 14/09/2026".
- `pesoBruto`: número > 0 con punto o coma (`"31,87"` → `"31.87"`) → error "Escribe el peso así: 31.87".
- `unidadPeso`: `KGM` o `TNE` (los botones mandan eso).
- `remitente`/`destinatario`: `"20131312955 DISTRIBUIDORA SAC"` → RUC/DNI válido (`tipoDocumentoDe`) + razón social no vacía → error "Escribe el RUC y la razón social así: 20131312955 DISTRIBUIDORA SAC".
- `items`: `"CEMENTO 750 BLS"` (descripción, cantidad > 0, unidad del catálogo `BLS NIU KGM TNE BX ZZ MTR LTR GLN`, `UND`→`NIU`) → error "Escribe el bien así: CEMENTO 750 BLS".
- Al aplicar con éxito, el campo sale de `faltantes`.

**Conversación** (textos en `textos.ts`):
1. `message:document` con `application/pdf` y `file_size` ≤ 20 MB → "📄 Leyendo la guía…". Foto → "Por ahora solo leo PDF. Envíame el PDF de la guía." PDF > 20 MB → "Ese archivo pasa de 20 MB, el límite de Telegram para bots. Envíame el PDF original de SUNAT."
2. `descargarArchivo` + `registrarDocumentoRecibido`. Si ya tiene guía → `Esta guía ya la registré como ${serieNumero} (${estado}).` y termina.
3. `extractor.extraer`; `PdfSinTextoError` → "No pude leer texto en ese PDF. Envíame el PDF original de SUNAT." `guardarExtraccion(documentoId, valores, confianzas)`.
4. Transporte: con `transportista`, `placas` y `conductor` extraídos arma `TransporteGuia` (sin ellos → `transporteHabitual`). `compararTransporte`: RUC distinto → `⛔ Esta guía indica otro transportista (RUC ${ruc}). No la puedo emitir.` y termina. Por cada placa nueva: `La placa ${placa} no está registrada.` con `[Registrar ${placa}]` (`g:placa:reg:<placa>`) y, si hay habitual, `[Usar la habitual ${habitual}]` (`g:placa:hab:<placa>`). Conductor nuevo: `El conductor ${nombres} ${apellidos} (DNI ${dni}) no está registrado.` con `[Registrar conductor]` (`g:cond:reg`) y `[Usar conductor habitual]` (`g:cond:hab`).
5. Pregunta cada campo de `faltantes` de uno en uno:
   - serieNumero: "¿Cuál es la serie y número de la guía del remitente? (ej. EG07-5531)"
   - remitente / destinatario: "¿RUC y razón social del remitente?" / "…del destinatario?"
   - partida / llegada: "¿Dirección del punto de partida?" / "…de llegada?" → luego "¿En qué distrito?" → botones con `buscarUbigeos(texto, 8)` (`g:ubigeo:<codigo>`, texto `DISTRITO (PROVINCIA, DEPARTAMENTO)`); sin resultados → "No encontré ese distrito. Escribe solo el nombre del distrito."
   - fechaTraslado: "¿Cuál es la fecha de inicio de traslado? (dd/mm/aaaa)"
   - pesoBruto: "¿Cuál es el peso bruto? (ej. 31.87)"
   - unidadPeso: "¿En qué unidad está el peso?" `[KGM] [TNE]` (`g:unidad:KGM`)
   - items: "¿Qué bien se traslada? (ej. CEMENTO 750 BLS)"
6. Resumen (`resumenGuia(borrador, transporte, nombresConductor)`):

```
🧾 Guía de transportista (borrador)
Remitente: DISTRIBUIDORA SAC (20131312955)
Destinatario: CHOCANO CARGO SAC (20602712592)
Partida: AV. 28 DE JULIO 1275 LIMA — LA VICTORIA, LIMA
Llegada: CARRETERA FEDERICO BASADRE KM 86 PUCALLPA — CALLERIA, CORONEL PORTILLO
Traslado: 14/09/2026 · Peso: 1500.5 KGM
Vehículo: ABC-123 / XYZ-987 · Conductor: JHON LARRY VELEZMORO SOZA
Bienes: 1. CAJAS DE CERAMICA — 120 BX
GRE remitente: EG07-5531
```

con `[✅ Emitir] [✏️ Corregir] [❌ Cancelar]` → `g:emitir`, `g:corregir`, `g:cancelar`.
7. Corregir → botones con los nombres de campo (`g:campo:<campo>`, textos "Remitente", "Destinatario", "Partida", "Llegada", "Fecha", "Peso", "Unidad", "Bienes", "GRE remitente") → pregunta ese campo → vuelve al resumen.
8. Emitir → paso `emitiendo` (un segundo `g:emitir` responde "Ya la estoy enviando." sin hacer nada), `entradaDesdeBorrador` + `registrarGuiaBorrador` (idempotente por documento; si `guiaId` existe —guía retomada— actualiza esa guía: agrega a core `actualizarGuiaBorrador(ctx, guiaId, entrada)` que reemplaza datos e ítems solo si la guía está en `borrador` o `rechazada`) → "📤 Enviando a SUNAT…" → `deps.enSegundoPlano(async () => { const r = await emitirGuia(ctx, id); await notificarGuia(api, chatId, r) })`, y se borra `session.flujo`. `notificarGuia` (exportada para el fondo, Task 12):
   - aceptada → `sendDocument(chatId, new InputFile(ctx.almacen.rutaAbsoluta(rutaPdf)), { caption: "✅ Guía V001-1 aceptada." })` y luego la oferta de factura (Task 10; en esta tarea, deja el gancho `ofrecerFactura` como función que la Task 10 implementa — en esta tarea solo envía la leyenda).
   - rechazada → `❌ SUNAT rechazó la guía ${serieNumero}: ${mensaje}` + `[✏️ Corregir y reenviar]` (`g:reenviar:<guiaId>` → carga `borradorDesdeGuia` y muestra el resumen con `guiaId`).
   - otro estado → "⏳ SUNAT no respondió; lo reintento solo y te aviso."
9. `/cancelar` en cualquier paso → "Cancelado." y borra `session.flujo`.
10. Textos sueltos sin flujo activo → "Envíame el PDF de la guía del remitente o escribe /ayuda."

- [ ] **Step 1: Pruebas de núcleo (fallan)** en `desde-extraccion.test.ts`: `borradorDesdeExtraccion` con todo seguro → `faltantes: []`; con `fechaTraslado` dudosa y `pesoBruto` null → `faltantes: ["fechaTraslado", "pesoBruto"]`; con ubigeo de partida inexistente → `"partida"` en faltantes. `aplicarRespuesta`: "14/09/2026" → `2026-09-14`; "31,87" → `"31.87"`; "20131312956 X" → error; "CEMENTO 750 BLS" → ítem; "ABC" en peso → error. `entradaDesdeBorrador` con faltantes → `ErrorValidacion`. `actualizarGuiaBorrador` sobre guía aceptada → `ErrorNegocio("Solo se pueden corregir guías en borrador o rechazadas")`.

- [ ] **Step 2: Implementar núcleo hasta verde.**

- [ ] **Step 3: PDF de prueba** `apps/bot/test/pdf-prueba.ts`:

```ts
import PDFDocument from "pdfkit";

export function pdfConLineas(lineas: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ compress: false });
    const partes: Buffer[] = [];
    doc.on("data", (p: Buffer) => partes.push(p));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.font("Helvetica").fontSize(9);
    for (const l of lineas) doc.text(l);
    doc.end();
  });
}

export function lineasFixture(cambios: (l: string[]) => string[] = (l) => l): string[] {
  const texto = readFileSync(new URL("../../../packages/extractor/test/fixtures/guia-desordenada.txt", import.meta.url), "utf8");
  return cambios(texto.split(/\r?\n/));
}
```

Primero verifica que `textoDePdf(await pdfConLineas(lineasFixture()))` devuelve las mismas líneas (una prueba rápida); si `unpdf` junta o parte líneas distinto, ajusta el tamaño de fuente o el ancho de página hasta que `leerGuiaDeTexto` dé el mismo resultado que con el fixture.

- [ ] **Step 4: Pruebas de conversación (fallan)** en `flujo-guia.test.ts`, con `a = await crearArnes({ archivos: { pdf1: await pdfConLineas(lineasFixture()) } })` y `registrarVehiculo(a.ctx, "XYZ-987")` antes:
  - flujo completo sin preguntas: `documento("pdf1")` → último texto empieza con "🧾 Guía de transportista (borrador)" y contiene "Vehículo: ABC-123 / XYZ-987"; `boton("g:emitir")` → "📤 Enviando a SUNAT…"; `esperarTareas()` → un `sendDocument` con leyenda "✅ Guía V001-1 aceptada.";
  - campo dudoso: fixture sin las líneas de fecha → "¿Cuál es la fecha de inicio de traslado? (dd/mm/aaaa)"; `texto("14/09/2026")` → resumen con "Traslado: 14/09/2026";
  - respuesta inválida: `texto("mañana")` → "Escribe la fecha así: 14/09/2026" y vuelve a esperar la fecha;
  - transporte ajeno: fixture con `TRANSPORTES DEMO SAC20131312955` → "⛔ Esta guía indica otro transportista (RUC 20131312955). No la puedo emitir.";
  - placa nueva: sin registrar `XYZ-987` → botones "Registrar XYZ-987" y "Usar la habitual ABC-123"… (nota: la habitual para una carreta es el 2.º vehículo activo; si no hay, solo "Registrar") → `boton("g:placa:reg:XYZ-987")` → resumen con "ABC-123 / XYZ-987";
  - corregir: `boton("g:corregir")` → `boton("g:campo:pesoBruto")` → `texto("2000")` → resumen con "Peso: 2000 KGM";
  - rechazo SUNAT: `crearArnes({ gateway: new SunatSimulado({ demoraMs: 0, rechazo: { codigo: "2800", mensaje: "dato inválido" } }) })` → tras emitir y `esperarTareas()`: "❌ SUNAT rechazó la guía V001-1: dato inválido" y botón "✏️ Corregir y reenviar";
  - doble clic: `boton("g:emitir")` dos veces → segunda respuesta "Ya la estoy enviando." y `listarGuias` devuelve 1;
  - mismo PDF dos veces (tras emitir) → "Esta guía ya la registré como V001-1 (aceptada).";
  - `/cancelar` durante una pregunta → "Cancelado." y un texto posterior recibe "Envíame el PDF de la guía del remitente o escribe /ayuda.";
  - foto → "Por ahora solo leo PDF. Envíame el PDF de la guía."

  Para instanciar `SunatSimulado` en el bot sin depender de `@sunatapp/sunat`, reexporta `SunatSimulado` desde `packages/core/test/helpers.ts` y úsalo desde ahí.

- [ ] **Step 5: Implementar** `flujo-guia.ts` y conectarlo en `bot.ts`: `bot.on("message:document", …)`, `bot.on("message:photo", …)`, `bot.callbackQuery(/^g:/, …)` (siempre `answerCallbackQuery`), `bot.command("cancelar", …)`, y `bot.on("message:text", …)` que delega al flujo activo según `session.flujo?.tipo`. El `chatId` para notificar sale de `c.chat.id`.

- [ ] **Step 6: Verificar y commit.** `git commit -m "feat(bot): flujo de guía desde el PDF del remitente hasta la GRE-T"`

---

### Task 10: Flujo de factura

**Files:**
- Create: `apps/bot/src/flujo-factura.ts`, `apps/bot/test/flujo-factura.test.ts`
- Modify: `apps/bot/src/bot.ts`, `apps/bot/src/textos.ts`, `apps/bot/src/sesion.ts`, `apps/bot/src/flujo-guia.ts` (oferta tras aceptación)
- Modify (core): `packages/core/src/dominio/montos.ts` (`parsearMonto`), `packages/core/test/montos.test.ts`

**Interfaces:**
- Consumes: `prepararFactura`, `emitirFactura`, `calcularMontosFactura`, `formatearSoles`, `buscarGuiaPorSerieNumero`, `buscarContrapartePorDoc`, `resultadoGuia`, `cargarGuiaCompleta` (para el remitente y la empresa).
- Produces:

```ts
export function parsearMonto(texto: string): number | null
// "2500" → 250000; "2,500.50" → 250050; "2500,5" → 250050; "2500.5" → 250050; "S/ 1 200" → 120000; "dos mil"/"0"/"-5" → null
export interface EstadoFlujoFactura {
  tipo: "factura"; guiaId: number;
  paso: "monto" | "igv" | "cliente" | "ruc_cliente" | "pago" | "dias" | "resumen" | "emitiendo";
  montoCentimos?: number; incluyeIgv?: boolean; clienteId?: number; formaPago?: "contado" | "credito"; diasCredito?: number;
}
export async function ofrecerFactura(api: Api, chatId: number, guiaId: number, serieNumero: string): Promise<void>  // "¿Facturar este flete (V001-1)?" [Sí] [Después]
export async function iniciarFlujoFactura(c: ContextoBot, deps: Dependencias, guiaId: number): Promise<void>
export async function notificarFactura(api: Api, deps: Dependencias, chatId: number, r: ResultadoEmision): Promise<void>
```

**Conversación:**
1. Tras la leyenda de guía aceptada, `ofrecerFactura`: "¿Facturar este flete (V001-1)?" `[Sí]` (`f:si:<guiaId>`) `[Después]` (`f:despues:<guiaId>`). Después → "Listo, queda sin facturar. Usa /facturar V001-1 cuando quieras."
2. `/facturar V001-1` → guía inexistente "No encontré la guía V001-1."; no aceptada "Solo se pueden facturar guías aceptadas por SUNAT."; ya facturada "La guía V001-1 ya tiene factura."; si no, inicia el flujo.
3. "¿Cuál es el monto del flete? (ej. 2500)" → `parsearMonto`; null → "No entendí el monto. Escríbelo así: 2500 o 2,500.50".
4. "¿El monto incluye IGV?" `[Incluye IGV]` (`f:igv:si`) `[Más IGV]` (`f:igv:no`).
5. "¿A quién se factura?" `[Remitente: DISTRIBUIDORA SAC]` (`f:cli:rem`) `[Otro RUC]` (`f:cli:otro`) → Otro: "Escribe el RUC del cliente." → `buscarContrapartePorDoc`; no existe → "Ese RUC no está registrado. Por ahora factura al remitente o a un cliente con el que ya trabajaste."; no es RUC (tipoDoc ≠ "6") → "La factura requiere un cliente con RUC."
6. "¿Forma de pago?" `[Contado]` `[Crédito 15 días]` `[Crédito 30 días]` `[Otro plazo]` (`f:pago:contado`, `f:pago:15`, `f:pago:30`, `f:pago:otro`) → Otro: "¿Cuántos días de crédito?" (entero > 0).
7. Resumen (con `calcularMontosFactura` y los parámetros de detracción de la empresa; reusa `formatearSoles`):

```
🧾 Factura (borrador)
Guía: V001-1
Cliente: DISTRIBUIDORA SAC (20131312955)
Subtotal: S/ 2,118.64 · IGV: S/ 381.36 · Total: S/ 2,500.00
Detracción 4%: S/ 100.00 · Neto a cobrar: S/ 2,400.00
Pago: crédito 30 días
```

(sin detracción, se omite esa línea y "Neto a cobrar" = total; contado → "Pago: contado"). `[✅ Emitir] [❌ Cancelar]` (`f:emitir`, `f:cancelar`).
8. Emitir → paso `emitiendo` (doble clic → "Ya la estoy enviando.") → `prepararFactura` (los `ErrorNegocio` se muestran tal cual y se termina el flujo) → "📤 Enviando la factura a SUNAT…" → en segundo plano `emitirFactura` y `notificarFactura`: aceptada/observada → `sendDocument` con leyenda "✅ Factura F001-1 aceptada."; rechazada → "❌ SUNAT rechazó la factura F001-1: <mensaje>"; otro → "⏳ SUNAT no respondió; lo reintento solo y te aviso."

- [ ] **Step 1: Pruebas `parsearMonto` (fallan) → implementar → verde.**
- [ ] **Step 2: Pruebas de conversación (fallan)** (crea la guía aceptada vía core antes de cada caso: `registrarGuiaBorrador` + `emitirGuia`): factura completa (2500 · incluye IGV · remitente · crédito 30) → resumen exacto de arriba → emitir → `esperarTareas()` → documento con "✅ Factura F001-1 aceptada."; "dos mil" → mensaje de monto; `f:despues` → texto con "/facturar V001-1"; `/facturar V001-1` sobre guía ya facturada → "La guía V001-1 ya tiene factura."; otro RUC desconocido → mensaje correspondiente; tras el flujo de guía de la Task 9, la aceptación ofrece "¿Facturar este flete (V001-1)?".
- [ ] **Step 3: Implementar hasta verde.**
- [ ] **Step 4: Commit.** `git commit -m "feat(bot): facturación del flete desde el chat"`

---

### Task 11: Comandos

**Files:**
- Create: `apps/bot/src/comandos.ts`, `apps/bot/test/comandos.test.ts`
- Modify: `apps/bot/src/bot.ts`, `apps/bot/src/textos.ts`

**Interfaces:**
- Consumes: `listarCobrosPendientes`, `registrarCobro`, `buscarFacturaPorSerieNumero`, `listarGuias`, `listarBorradores`, `cargarGuiaCompleta`, `borradorDesdeGuia`, `formatearSoles`, `parsearMonto`, `fechaHoraLima`, `ErrorNegocio`.

| Comando | Respuesta |
|---------|-----------|
| `/guias` | Una línea por guía (últimas 10): `V001-3 · 14/09 · CHOCANO CARGO SAC · ✅ aceptada · facturada` (📝 borrador, ⏳ pendiente_envio/enviada, ✅ aceptada, ❌ rechazada; "sin facturar" solo en aceptadas). Sin guías → "Todavía no hay guías." |
| `/pendientes` | Por cada borrador/rechazada: `V001-2 · ❌ rechazada · CHOCANO CARGO SAC` con botón `[Retomar V001-2]` (`g:retomar:<guiaId>` → flujo guía en paso `resumen` con `borradorDesdeGuia`, `guiaId` y el transporte de la guía). Sin nada → "No hay guías pendientes." |
| `/cobros` | Por factura: `🔴 F001-2 · DISTRIBUIDORA SAC · vencida 30/09 · S/ 2,400.00` (🔴 vencida, 🟡 vence hoy, ⚪ pendiente con "vence 30/09"); al final `Por cobrar: S/ X · Vencido: S/ Y`. Sin nada → "No hay facturas por cobrar. 🎉" |
| `/pagado F001-2 [monto]` | Sin monto = saldo completo. `registrarCobro` (medio `transferencia`, fecha de hoy en Lima, `usuarioId` de la sesión). Responde `💰 Cobro registrado. Saldo: S/ 0.00 (pagada)` o `(parcial)`. Formato inválido → "Úsalo así: /pagado F001-2 1500". Factura inexistente → "No encontré la factura F001-2." `ErrorNegocio` → su mensaje tal cual |
| `/cancelar` | Con flujo → "Cancelado."; sin flujo → "No hay nada que cancelar." (mueve aquí el `/cancelar` de la Task 9 si quedó en el flujo) |

- [ ] **Step 1: Pruebas (fallan)** para cada comando con datos creados vía core. `/pendientes` tras "reinicio": crea un borrador con el arnés A, construye un arnés B con `crearArnes({ ctx: a.ctx })` (misma BD, sesión nueva) → aparece la guía y `boton("g:retomar:<id>")` muestra el resumen; emitir desde ahí reusa la **misma** guía (no crea otra).
- [ ] **Step 2: Implementar hasta verde.**
- [ ] **Step 3: Commit.** `git commit -m "feat(bot): comandos de guías, pendientes, cobros y pagos"`

---

### Task 12: Tareas automáticas, aviso diario y arranque

**Files:**
- Create: `apps/bot/src/fondo.ts`, `apps/bot/src/aviso-diario.ts`, `apps/bot/src/main.ts`
- Create: `apps/bot/test/fondo.test.ts`, `apps/bot/test/aviso-diario.test.ts`
- Modify: `packages/core/src/index.ts` (exportar `cargarEnv` movido desde `scripts/cargar-env.ts` a `src/infra/cargar-env.ts`; los scripts lo importan de ahí), `README.md`, `.gitignore`

**Interfaces:**
- Produces:

```ts
// fondo.ts
export function crearTareaFondo(deps: Dependencias, notificar: (tipo: "guia" | "factura", r: ResultadoEmision) => Promise<void>):
  { pasada(): Promise<void>; iniciar(intervaloMs?: number): () => void }
// pasada(): procesarPendientesGuias + procesarPendientesFacturas y notificar cada cambio; si ya hay una pasada en curso, retorna sin hacer nada; errores → deps.log.error
// aviso-diario.ts
export function msHastaProximoAviso(ahora: Date, horaLima: string): number     // Perú: UTC-5 fijo, sin horario de verano
export async function textoAvisoDiario(ctx: Contexto): Promise<string | null>  // null si no hay nada que vence hoy ni vencido
export function programarAvisoDiario(enviar: () => Promise<void>, horaLima: string, reloj?: () => Date): () => void   // setTimeout encadenado; devuelve cancelar
```

`textoAvisoDiario`:

```
📅 Cobros de hoy
🔴 Vencidas:
• F001-2 · DISTRIBUIDORA SAC · S/ 2,400.00 (venció 15/09)
🟡 Vencen hoy:
• F001-3 · CHOCANO CARGO SAC · S/ 1,180.00
```

`main.ts`:
1. `cargarEnv()`; `const config = cargarConfig(); const cfgBot = cargarConfigBot(); const log = crearLogger(cfgBot.logDir);`
2. `const { ctx, cerrar } = await crearContexto(config); ctx.log = (n, m, d) => log[n](m, d);`
3. Sin usuarios → `console.error("Ejecuta pnpm sembrar primero")`, `await cerrar()`, `process.exit(1)`.
4. Sin dueño → `codigoRegistro = generarCodigoRegistro()` y `console.log(\`Código de registro: ${codigo} — envíalo al bot desde tu Telegram.\`)`.
5. `const bot = crearBot(cfgBot.token, { ctx, extractor: crearExtractor({ tipo: cfgBot.extractor }, { validarRuc, obtenerUbigeo }), descargarArchivo, enSegundoPlano, codigoRegistro, log })` con `descargarArchivo = async (fileId) => { const f = await bot.api.getFile(fileId); const r = await fetch(\`https://api.telegram.org/file/bot${cfgBot.token}/${f.file_path}\`); if (!r.ok) throw new Error(\`No se pudo descargar el archivo (${r.status})\`); return Buffer.from(await r.arrayBuffer()); }` (nunca loguear la URL: contiene el token).
6. Tarea de fondo cada 60 s notificando al dueño (`duenoTelegramId`): guía → `notificarGuia` (aceptada con PDF y oferta de factura; rechazada con botón); factura → `notificarFactura`.
7. Aviso diario a las `cfgBot.horaAviso` al dueño con `textoAvisoDiario` (si no es null).
8. `bot.start({ onStart: () => log.info("Bot iniciado") })`; en `SIGINT`/`SIGTERM`: `bot.stop()`, detener fondo y aviso, `await cerrar()`.

- [ ] **Step 1: Pruebas (fallan):** `msHastaProximoAviso(new Date("2026-09-19T12:00:00Z"), "08:00")` = 3 600 000 (07:00 Lima → 08:00); con `"2026-09-19T13:30:00Z"` (08:30 Lima) = 23.5 h; `textoAvisoDiario` sin facturas → `null`; con una vencida y una que vence hoy (crea facturas vía core con distintos `diasCredito` y un `reloj` controlado) → contiene "🔴 Vencidas:" y "🟡 Vencen hoy:"; `pasada()` llamada dos veces a la vez con un gateway lento (una promesa que tú resuelves) → `procesarPendientesGuias` corre una sola vez (cuenta llamadas a `enviarGuia`); una guía pendiente que se acepta en la pasada → `notificar("guia", r)` con `estado: "aceptada"`.
- [ ] **Step 2: Implementar hasta verde.**
- [ ] **Step 3: Arranque en seco.** Con el `.env` real: `timeout 20 pnpm bot` (o arráncalo en segundo plano y detenlo a los 20 s). Esperado: sin errores; si no hay dueño, imprime el código. No envíes nada por Telegram: eso lo hace el usuario.
- [ ] **Step 4: README** — sección "Bot de Telegram": requisitos, variables (`TELEGRAM_BOT_TOKEN`, `EXTRACTOR=reglas`, `BOT_HORA_AVISO=08:00`, `LOG_DIR=./logs`), `pnpm sembrar`, `pnpm bot`, registrarse con el código, comandos, y la prueba manual: enviar el PDF de una guía real → GRE-T simulada → facturar → `/cobros`. Agrega `logs/` a `.gitignore`.
- [ ] **Step 5: Verificar y commit.** `pnpm test && pnpm typecheck`. `git commit -m "feat(bot): tareas automáticas, aviso diario de cobros y arranque con pnpm bot"`

---

## Cobertura del spec (autorrevisión)

| Spec Plan 2 | Tarea |
|-------------|-------|
| §4.1 vehículo secundario (BD, XML, PDF) | 2 |
| §4.2 arreglos pendientes | 3 |
| §4.3 idempotencia por documento | 4 |
| §4.4 transporte en la entrada | 5 |
| §4.5 comparación con lo registrado + registrar vehículo/conductor | 5 |
| §4.6 utilidades para el bot | 6 |
| §4.7 hook de log | 6 |
| §5 lector por reglas + interfaz para IA | 7 |
| §6.1 registro del dueño | 8 |
| §6.2 flujo guía | 9 |
| §6.3 flujo factura | 10 |
| §6.4 comandos | 8 (`/start`, `/ayuda`), 11 |
| §6.5 tareas automáticas y aviso diario | 12 |
| §6.6 estado de conversación + retomar tras reinicio | 9, 11 |
| §7 errores | 8 (`bot.catch`), 9, 10, 12 |
| §8 configuración | 8, 12 |
| §9 pruebas | todas |
| §10 criterios de éxito | 12 (prueba manual del usuario) |
