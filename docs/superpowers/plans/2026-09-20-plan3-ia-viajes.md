# Plan 3 — IA de lectura y viajes con presupuesto: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el chofer registre todo por Telegram —fotos de comprobantes, texto, notas de voz— y que una IA lo clasifique y extraiga los datos, siempre confirmados antes de guardar, quedando todo dentro de un **viaje de ida y vuelta** con presupuesto por ruta, liquidación del adelanto y ganancia real.

**Architecture:** Un paquete nuevo `packages/ia` (proveedor de IA y transcriptor, intercambiables desde `.env`, con una versión simulada para pruebas), dos módulos nuevos en el núcleo (`core/viajes` y `core/lecturas`) y un flujo nuevo en el bot (`flujo-lectura.ts`) más cuatro comandos. El bot sigue sin conocer la base de datos ni SUNAT.

**Tech Stack:** TypeScript 7, Node 24, pnpm 9, Vitest 5, Drizzle + PGlite, grammY 1.46, zod 4, DeepSeek (API compatible con OpenAI), whisper.cpp + ffmpeg (locales, opcionales).

**Spec:** `docs/superpowers/specs/2026-09-19-viajes-presupuesto-ia-web-design.md` (§§1-7, 9-11 y 14 "Plan 3"). La web (§8) es el Plan 4 y **no** se implementa aquí.

## Global Constraints

- Idioma: todo texto visible al usuario, nombres del dominio y mensajes de error en **español**.
- Dinero en **céntimos enteros** (`number`); nunca `float`. Los montos que devuelve la IA vienen en soles decimales y se convierten en el núcleo.
- Fechas de negocio en hora de Lima (`fechaHoraLima`), formato `AAAA-MM-DD`. Perú es UTC-5 todo el año.
- `apps/bot` solo importa `@sunatapp/core`, `@sunatapp/extractor` y `@sunatapp/ia` (nunca `db`, `sunat` ni `pdf`).
- `packages/ia` **no** importa `core` ni `db`: recibe lo que necesita por parámetros y devuelve datos planos.
- **Nada se guarda sin confirmación del usuario.** La IA propone; el usuario pulsa `✅ Correcto`. Las guías y facturas que van a SUNAT mantienen su confirmación propia del Plan 2.
- **La IA nunca inventa:** si no está segura, lo marca como duda y el bot pregunta.
- Ninguna prueba llama a la red, a Telegram, a DeepSeek ni ejecuta whisper/ffmpeg. `IA_PROVEEDOR=simulado` en pruebas.
- Claves y binarios solo desde `.env` (git-ignorado). Nunca en código, pruebas ni logs; el log jamás incluye la clave de DeepSeek ni el contenido íntegro de una foto.
- Migraciones con `pnpm --filter @sunatapp/db generar --name <nombre>`; nunca se edita una migración versionada. La siguiente es `0005`.
- Cada tarea termina con `pnpm test` y `pnpm typecheck` en verde y un commit. Mensajes en español con prefijo convencional y la línea final `Claude-Session: https://claude.ai/code/session_0187MZGEh1ffBPR4WpBTUmqh`.
- La suite completa tarda 7-11 minutos; iterar con corridas enfocadas y ejecutarla entera una vez antes de cada commit (timeout de Bash 600000 ms).

## Datos verificados de DeepSeek (2026-09-20)

- Modelo con visión: **`deepseek-flash`**. API compatible con OpenAI en `https://api.deepseek.com`, endpoint `POST /chat/completions`.
- Imágenes: bloque `{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,<...>"}}` dentro del `content` de un mensaje **`user`** (solo ahí). Formatos JPEG, PNG, GIF, WebP; máximo 32 MiB en línea; hasta 1024 tokens por imagen.
- JSON: `response_format: { type: "json_object" }`. Requiere que el prompt contenga la palabra "json" **y** un ejemplo de la estructura, y un `max_tokens` holgado para que no se corte. La documentación advierte que la API puede devolver contenido vacío de vez en cuando.
- Precios (por millón de tokens, mitad fuera de hora pico): entrada sin caché ≈ US$ 0.30, entrada con caché ≈ US$ 0.006, salida ≈ US$ 1.20. Se configuran en `.env` y se guardan por lectura.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---------|-----------------|
| `packages/db/src/schema.ts` + migración `0005` | Enums y tablas de viajes, gastos, lecturas e invitaciones; columnas nuevas en `documento_recibido`, `guia_transportista` y `usuario` |
| `packages/core/src/viajes/rutas.ts` | Rutas y plantillas de presupuesto |
| `packages/core/src/viajes/viajes.ts` | Crear, cerrar, reabrir, enlazar guías, viaje en curso |
| `packages/core/src/viajes/gastos.ts` | Gastos y entregas de dinero |
| `packages/core/src/viajes/calculos.ts` | Semáforo, liquidación, ganancia, promedios |
| `packages/ia/src/tipos.ts` | Contratos y esquemas zod de la lectura |
| `packages/ia/src/prompts.ts` | Instrucciones en un solo lugar |
| `packages/ia/src/simulado.ts` | Proveedor determinista para pruebas |
| `packages/ia/src/deepseek.ts` | Cliente real (JSON, imágenes, costo) |
| `packages/ia/src/whisper.ts` | Voz → texto local (opcional) |
| `packages/core/src/lecturas/*.ts` | Recibir, leer, confirmar, reintentar |
| `apps/bot/src/flujo-lectura.ts` | Conversación de confirmación y corrección |
| `apps/bot/src/comandos-viaje.ts` | `/invitar`, `/saldo`, `/viaje`, `/cerrar` |
| `apps/bot/src/fondo.ts`, `main.ts`, `textos.ts` | Reintentos de lectura, cableado y textos |

---

### Task 1: Arreglos parqueados del Plan 2

Tres asuntos menores quedaron anotados al cerrar el Plan 2 (ver `docs/superpowers/plans/2026-09-19-plan2-bot-telegram.md` y la memoria del proyecto).

**Files:**
- Modify: `apps/bot/test/arnes.ts`, `apps/bot/test/flujo-guia.test.ts`, `apps/bot/test/flujo-factura.test.ts`
- Modify: `apps/bot/src/main.ts`
- Modify: `packages/core/src/infra/sembrar.ts`, `packages/core/test/infra.test.ts`

**Interfaces:**
- Produces: `crearArnes` con un `fallarApi` que puede fallar **una sola vez**; `sembrarDatosIniciales` rechaza placas repetidas.

- [ ] **Step 1: Prueba tautológica.** En `apps/bot/test/flujo-guia.test.ts`, la prueba "no remata con «SUNAT no respondió» si el aviso ya había salido" pasa con y sin el arreglo: `fallarApi` rechaza **todos** los `sendMessage` posteriores al `sendDocument` y el arnés lanza antes de registrar la llamada (`apps/bot/test/arnes.ts`), así que el intento de aviso nunca queda registrado. Cambia `fallarApi` a un fallo de un solo uso (que falle el primer `sendMessage` tras el `sendDocument` y deje pasar los siguientes) y afirma que **no** aparece el texto de `guiaSinRespuesta`. Verifica el RED quitando la guarda `avisado` de `flujo-guia.ts`: la prueba debe fallar.

- [ ] **Step 2: La misma prueba para la factura.** `alAvisar` en `flujo-factura.ts` no tiene ninguna prueba. Añade la gemela en `flujo-factura.test.ts` con el mismo patrón, verificando también su RED.

- [ ] **Step 3: Error de configuración legible.** `cargarConfigBot()` se ejecuta fuera del `try` protegido de `main.ts`, así que un `TELEGRAM_BOT_TOKEN` ausente o un `BOT_HORA_AVISO` inválido mueren con un volcado de pila en vez del mensaje en español de `mensajeDeArranque`. Mueve la llamada dentro del `try` (o adelanta el `try`), cuidando que `log`/`crearLogger` sigan disponibles para el `catch`. Prueba: `cargarConfigBot({})` lanza `ErrorConfiguracion` y `mensajeDeArranque(error)` devuelve el texto en español (prueba unitaria de `config.ts`, sin ejecutar `main.ts`).

- [ ] **Step 4: Placa repetida al sembrar.** En `sembrarDatosIniciales`, si `vehiculoSecundario?.placa` normaliza igual que `vehiculo.placa`, lanza `ErrorNegocio("La placa de la carreta no puede ser la misma que la del tracto")` antes de insertar. Prueba en `infra.test.ts`.

- [ ] **Step 5: Verificar y commit.** `pnpm test && pnpm typecheck`. `git commit -m "fix(bot): arreglos parqueados del Plan 2 (pruebas reales, error de configuración legible y placa repetida)"`

---

### Task 2: Esquema de viajes, gastos y lecturas

**Files:**
- Modify: `packages/db/src/schema.ts`; migración generada `0005_viajes_y_lecturas`
- Test: `packages/db/test/db.test.ts`

**Interfaces:**
- Produces (todo exportado desde `@sunatapp/db`):

```ts
export const categoriaGastoEnum = pgEnum("categoria_gasto",
  ["combustible", "peaje", "viaticos", "hospedaje", "estiba", "balanza", "cochera", "reparacion", "otros"]);
export const estadoViajeEnum = pgEnum("estado_viaje", ["planificado", "en_curso", "cerrado"]);
export const medioEntregaEnum = pgEnum("medio_entrega", ["efectivo", "yape", "transferencia", "otro"]);
export const tipoMensajeEnum = pgEnum("tipo_mensaje", ["pdf", "foto", "voz", "texto"]);
export const estadoLecturaEnum = pgEnum("estado_lectura", ["pendiente", "por_confirmar", "confirmado", "descartado", "error"]);
export const tramoGuiaEnum = pgEnum("tramo_guia", ["ida", "retorno"]);
export type CategoriaGasto = (typeof categoriaGastoEnum.enumValues)[number];
export type EstadoViaje = (typeof estadoViajeEnum.enumValues)[number];
export type MedioEntrega = (typeof medioEntregaEnum.enumValues)[number];
export type EstadoLectura = (typeof estadoLecturaEnum.enumValues)[number];
export type TipoMensaje = (typeof tipoMensajeEnum.enumValues)[number];
```

Tablas nuevas (los montos usan el helper `centimos`, las fechas `date({ mode: "string" })`, y `creadoEn`/`actualizadoEn` los helpers existentes):

| Tabla | Columnas |
|---|---|
| `ruta` | `id` serial PK · `nombre` text **unique** · `activa` bool default true |
| `rutaPresupuesto` | `rutaId` FK ruta on delete cascade · `categoria` enum · `monto` céntimos not null · PK (rutaId, categoria) |
| `viaje` | `id` serial PK · `codigo` text **unique** · `rutaId` FK ruta · `vehiculoId` FK vehiculo not null · `vehiculoSecundarioId` FK vehiculo null · `conductorId` FK conductor not null · `fechaSalida` date not null · `fechaRegreso` date null · `estado` enum default `planificado` · `nota` text null · `creadoEn` · `actualizadoEn` · **índice único parcial** `viaje_en_curso_vehiculo` sobre `vehiculoId` con `WHERE estado = 'en_curso'` |
| `viajePresupuesto` | `viajeId` FK viaje on delete cascade · `categoria` enum · `monto` céntimos not null · PK (viajeId, categoria) |
| `entrega` | `id` serial PK · `viajeId` FK viaje not null · `fecha` date not null · `monto` céntimos not null · `medio` enum not null · `nota` text null · `documentoId` FK documento_recibido null · `usuarioId` FK usuario null · `creadoEn` |
| `gasto` | `id` serial PK · `viajeId` FK viaje **null** · `categoria` enum not null · `monto` céntimos not null · `fecha` date not null · `proveedorRuc` text null · `proveedorNombre` text null · `comprobante` text null · `nota` text null · `documentoId` FK documento_recibido null · `usuarioId` FK usuario null · `creadoEn` · `editadoEn` timestamptz null |
| `lecturaIa` | `id` serial PK · `documentoId` FK documento_recibido not null · `proveedor` text not null · `modelo` text not null · `tokensEntrada` integer not null default 0 · `tokensCache` integer not null default 0 · `tokensSalida` integer not null default 0 · `costoMicroUsd` bigint(mode number) not null default 0 · `respuesta` jsonb null · `error` text null · `creadoEn` |
| `invitacion` | `id` serial PK · `codigoHash` text **unique** · `creadaPor` FK usuario not null · `expiraEn` timestamptz not null · `usadaPor` FK usuario null · `usadaEn` timestamptz null · `creadoEn` |

Cambios en tablas existentes:
- `documentoRecibido`: `rutaArchivo` pasa a **nullable**; se agregan `tipo` (enum, default `"pdf"`, not null), `texto` text null, `estadoLectura` (enum, default `"pendiente"`, not null), `clasificacion` text null, `correcciones` jsonb null, `intentosLectura` integer not null default 0, `proximoIntentoEn` timestamptz null, `telegramChatId` bigint(mode number) null, `telegramMessageId` bigint(mode number) null, más `unique("documento_telegram_mensaje").on(telegramChatId, telegramMessageId)`.
- `guiaTransportista`: `viajeId` FK viaje null, `tramo` enum null.
- `usuario`: `email` deja de ser `notNull` (sigue `unique`; Postgres admite varios NULL) y se agrega `telegramNombre` text null.

- [ ] **Step 1: Prueba (falla).** En `db.test.ts`, una prueba que: crea ruta + presupuesto, vehículo, conductor y un viaje `en_curso`; inserta un gasto y una entrega; comprueba que un **segundo** viaje `en_curso` para el mismo vehículo falla con violación de unicidad, y que uno `cerrado` para ese vehículo sí entra; e inserta un `documento_recibido` **sin** `ruta_archivo` (texto) y otro con el mismo `(telegram_chat_id, telegram_message_id)` que debe fallar.

- [ ] **Step 2: Ejecutar → FAIL.** `pnpm vitest run packages/db`.

- [ ] **Step 3: Esquema y migración.** Escribe las tablas y ejecuta `pnpm --filter @sunatapp/db generar --name viajes_y_lecturas`. Revisa el SQL: debe ser `CREATE TYPE`/`CREATE TABLE`/`ADD COLUMN`/`ALTER COLUMN ... DROP NOT NULL` y el índice parcial; nada destructivo. El índice parcial se declara así:

```ts
(t) => [uniqueIndex("viaje_en_curso_vehiculo").on(t.vehiculoId).where(sql`${t.estado} = 'en_curso'`)]
```

Si drizzle-kit no lo genera, agrégalo como una migración SQL adicional escrita a mano **nueva** (nunca editando la generada) y deja el comentario explicando por qué.

- [ ] **Step 4: Verificar y commit.** `git commit -m "feat(db): esquema de viajes, gastos, lecturas e invitaciones"`

---

### Task 3: Rutas y plantillas de presupuesto

**Files:**
- Create: `packages/core/src/viajes/rutas.ts`; Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/rutas.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LineaPlantilla { categoria: CategoriaGasto; monto: number }        // céntimos
export interface Ruta { id: number; nombre: string; activa: boolean; plantilla: LineaPlantilla[] }
export async function crearRuta(ctx: Contexto, nombre: string, plantilla: LineaPlantilla[], usuarioId?: number): Promise<number>
export async function listarRutas(ctx: Contexto, incluirInactivas?: boolean): Promise<Ruta[]>
export async function obtenerRuta(ctx: Contexto, rutaId: number): Promise<Ruta>                     // ErrorNegocio si no existe
export async function actualizarPlantilla(ctx: Contexto, rutaId: number, plantilla: LineaPlantilla[], usuarioId?: number): Promise<void>
export async function desactivarRuta(ctx: Contexto, rutaId: number): Promise<void>
export async function buscarRuta(ctx: Contexto, texto: string): Promise<Ruta[]>
```

Reglas: `nombre` se guarda tal cual pero se compara normalizado (sin tildes, mayúsculas, espacios colapsados) para evitar duplicados → `ErrorNegocio("Ya existe una ruta con ese nombre")`. Los montos deben ser enteros ≥ 0 (`ErrorNegocio("El monto del presupuesto no puede ser negativo")`). `actualizarPlantilla` reemplaza la plantilla completa en una transacción. `buscarRuta` devuelve las rutas activas cuyo nombre normalizado contiene el texto normalizado (para que el chofer escriba "puno" y el bot ofrezca "Arequipa ⇄ Puno").

- [ ] **Step 1: Pruebas (fallan).** Cubre: crear y leer con plantilla; nombre duplicado con distinta tilde/mayúsculas → error; monto negativo → error; `actualizarPlantilla` reemplaza (no acumula); `buscarRuta("puno")` encuentra "Arequipa ⇄ Puno" y no devuelve las inactivas.
- [ ] **Step 2: Ejecutar → FAIL.**
- [ ] **Step 3: Implementar hasta verde.**
- [ ] **Step 4: Exportar, verificar y commit.** `git commit -m "feat(core): rutas y plantillas de presupuesto"`

---

### Task 4: Viajes (crear, enlazar guías, cerrar)

**Files:**
- Create: `packages/core/src/viajes/viajes.ts`; Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/viajes.test.ts`

**Interfaces:**
- Consumes: `siguienteCorrelativo` (tipo documento `"VJ"`, serie `"VJ"`), `transporteHabitual`, `fechaHoraLima`.
- Produces:

```ts
export interface Viaje {
  id: number; codigo: string; rutaId: number | null; vehiculoId: number; vehiculoSecundarioId: number | null;
  conductorId: number; fechaSalida: string; fechaRegreso: string | null; estado: EstadoViaje; nota: string | null;
}
export interface EntradaViaje {
  rutaId?: number; vehiculoId?: number; vehiculoSecundarioId?: number | null; conductorId?: number;
  fechaSalida?: string; adelantoCentimos?: number; medioAdelanto?: MedioEntrega; nota?: string;
}
export async function crearViaje(ctx: Contexto, e: EntradaViaje, usuarioId?: number): Promise<{ id: number; codigo: string }>
//   Sin vehículo/conductor usa los habituales (transporteHabitual). Sin fecha, hoy en Lima.
//   Queda en "en_curso"; si ya hay uno en curso para ese vehículo → ErrorNegocio("El tracto ABC-123 ya tiene el viaje VJ-0003 en curso").
//   Copia la plantilla de la ruta a viaje_presupuesto y, con adelanto > 0, registra la entrega inicial. Todo en una transacción.
export async function viajeEnCurso(ctx: Contexto, vehiculoId?: number): Promise<Viaje | null>   // sin vehículo: el único en curso, o null si hay varios
export async function obtenerViaje(ctx: Contexto, viajeId: number): Promise<Viaje>
export async function listarViajes(ctx: Contexto, o?: { mes?: string; rutaId?: number; estado?: EstadoViaje; limite?: number }): Promise<Viaje[]>
export async function buscarViajePorCodigo(ctx: Contexto, texto: string): Promise<Viaje | null>  // "vj-3", "VJ-0003"
export async function cerrarViaje(ctx: Contexto, viajeId: number, fechaRegreso?: string, usuarioId?: number): Promise<void>
//   Solo desde "en_curso" (ErrorNegocio si no). fechaRegreso por defecto hoy; no puede ser anterior a fechaSalida.
export async function reabrirViaje(ctx: Contexto, viajeId: number, usuarioId?: number): Promise<void>
//   Falla si el vehículo ya tiene otro viaje en curso.
export async function enlazarGuia(ctx: Contexto, guiaId: number, viajeId: number, tramo: "ida" | "retorno", usuarioId?: number): Promise<void>
//   ErrorNegocio si el viaje ya tiene una guía en ese tramo o si la guía ya está en otro viaje.
export async function desenlazarGuia(ctx: Contexto, guiaId: number, usuarioId?: number): Promise<void>
export async function enlazarGuiaAlViajeEnCurso(ctx: Contexto, guiaId: number): Promise<{ viajeId: number; tramo: "ida" | "retorno" } | null>
//   Busca el viaje en curso del vehículo de la guía; tramo "ida" si está libre, si no "retorno"; null si no hay viaje o ambos tramos están ocupados.
export async function actualizarPresupuestoViaje(ctx: Contexto, viajeId: number, plantilla: LineaPlantilla[], usuarioId?: number): Promise<void>
export const CODIGO_VIAJE = (numero: number) => `VJ-${String(numero).padStart(4, "0")}`;
```

Cada operación que cambia estado escribe en `auditoria`.

- [ ] **Step 1: Pruebas (fallan).** Cubre: crear con habituales copia la plantilla y registra el adelanto; segundo viaje en curso para el mismo tracto → error con el código del viaje vigente; `viajeEnCurso`; `enlazarGuiaAlViajeEnCurso` asigna ida y luego retorno, y devuelve null al tercer intento; `cerrarViaje` con fecha anterior a la salida → error; cerrar y reabrir; `buscarViajePorCodigo("vj-3")`; `listarViajes({ mes: "2026-09" })` filtra por `fechaSalida`.
- [ ] **Step 2: Ejecutar → FAIL.**
- [ ] **Step 3: Implementar hasta verde.** El índice parcial es la verdad sobre "un solo viaje en curso": captura la violación de unicidad (código `23505`, restricción `viaje_en_curso_vehiculo`) y conviértela en el `ErrorNegocio` con el código del viaje vigente.
- [ ] **Step 4: Exportar, verificar y commit.** `git commit -m "feat(core): viajes de ida y vuelta con presupuesto copiado de la ruta"`

---

### Task 5: Gastos y entregas

**Files:**
- Create: `packages/core/src/viajes/gastos.ts`; Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/gastos.test.ts`

**Interfaces:**

```ts
export interface EntradaGasto {
  viajeId?: number | null; categoria: CategoriaGasto; montoCentimos: number; fecha?: string;
  proveedorRuc?: string | null; proveedorNombre?: string | null; comprobante?: string | null;
  nota?: string | null; documentoId?: number | null; usuarioId?: number;
}
export interface Gasto extends Required<Pick<EntradaGasto, "categoria">> {
  id: number; viajeId: number | null; monto: number; fecha: string;
  proveedorRuc: string | null; proveedorNombre: string | null; comprobante: string | null;
  nota: string | null; documentoId: number | null; usuarioId: number | null; creadoEn: Date; editadoEn: Date | null;
}
export const MONTO_MAXIMO_CENTIMOS: number;                                   // configurable: ctx.config? no — constante 2_000_000 (S/ 20 000)
export async function registrarGasto(ctx: Contexto, e: EntradaGasto): Promise<number>
export async function editarGasto(ctx: Contexto, gastoId: number, cambios: Partial<EntradaGasto>, usuarioId?: number): Promise<void>
export async function borrarGasto(ctx: Contexto, gastoId: number, usuarioId?: number): Promise<void>
export async function listarGastos(ctx: Contexto, viajeId: number): Promise<Gasto[]>
export async function gastosSinViaje(ctx: Contexto): Promise<Gasto[]>
export async function registrarEntrega(ctx: Contexto, e: { viajeId: number; montoCentimos: number; medio: MedioEntrega; fecha?: string; nota?: string | null; documentoId?: number | null; usuarioId?: number }): Promise<number>
export async function listarEntregas(ctx: Contexto, viajeId: number): Promise<Array<{ id: number; fecha: string; monto: number; medio: MedioEntrega; nota: string | null }>>
export async function borrarEntrega(ctx: Contexto, entregaId: number, usuarioId?: number): Promise<void>
```

Reglas: monto entero > 0 y ≤ `MONTO_MAXIMO_CENTIMOS` (`ErrorNegocio("El monto debe ser mayor a cero")` / `ErrorNegocio("El monto supera el máximo permitido (S/ 20,000)")`); fecha por defecto hoy en Lima y nunca futura respecto de hoy (`ErrorNegocio("La fecha no puede ser futura")`); `proveedorRuc` se valida con `validarRuc` y, si no es válido, se guarda `null` (no es un error: la IA pudo leer mal); no se puede registrar un gasto en un viaje `cerrado` (`ErrorNegocio("El viaje VJ-0003 está cerrado; reábrelo para editarlo")`), salvo `viajeId = null`. `editarGasto` toca `editadoEn` y audita el antes y el después.

- [ ] **Step 1: Pruebas (fallan).** Cubre cada regla anterior, `listarGastos` ordenado por fecha y luego id, `gastosSinViaje`, editar cambia solo lo enviado y queda auditado, borrar, y entregas (incluida la suma de varias).
- [ ] **Step 2: Ejecutar → FAIL.** — **Step 3: Implementar hasta verde.**
- [ ] **Step 4: Exportar, verificar y commit.** `git commit -m "feat(core): gastos y entregas de dinero del viaje"`

---

### Task 6: Cálculos del viaje (semáforo, liquidación, ganancia)

**Files:**
- Create: `packages/core/src/viajes/calculos.ts`; Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/calculos.test.ts`

**Interfaces:**

```ts
export type Semaforo = "verde" | "amarillo" | "rojo";
export function semaforo(presupuesto: number, gastado: number): Semaforo;
//   presupuesto > 0: gastado/presupuesto < 0.9 → verde; ≤ 1 → amarillo; > 1 → rojo.
//   presupuesto === 0: gastado > 0 → rojo; gastado === 0 → verde.
export interface LineaResumen { categoria: CategoriaGasto; presupuesto: number; gastado: number; diferencia: number; porcentaje: number | null; semaforo: Semaforo }
export interface ResumenViaje {
  viaje: Viaje; lineas: LineaResumen[];                 // todas las categorías con presupuesto o gasto, en el orden del enum
  totalPresupuesto: number; totalGastado: number; totalSemaforo: Semaforo;
  entregado: number; saldo: number;                     // entregado − gastado (positivo: el chofer devuelve)
  guias: Array<{ guiaId: number; serieNumero: string; tramo: "ida" | "retorno" | null; flete: number | null }>;
  fletes: number;                                       // suma de los fletes conocidos (subtotal sin IGV de facturas aceptadas)
  ganancia: number;                                     // fletes − totalGastado
  gananciaPendiente: boolean;                           // true si alguna guía no tiene factura aceptada, o si el viaje no tiene guías
}
export async function resumenViaje(ctx: Contexto, viajeId: number): Promise<ResumenViaje>
export async function promedioRuta(ctx: Contexto, rutaId: number, limite?: number): Promise<LineaPlantilla[]>
//   Promedio del gastado por categoría en los últimos `limite` (5) viajes CERRADOS de esa ruta; [] si no hay ninguno.
export async function gananciaDelMes(ctx: Contexto, mes: string): Promise<{ ganancia: number; viajes: number; pendientes: number }>
//   Viajes cerrados con fechaRegreso en el mes (AAAA-MM).
```

El flete de una guía es el `subtotal` (sin IGV) de su factura en estado `aceptada` u `observada`; si no la tiene, `flete: null` y `gananciaPendiente = true`. La detracción **no** se resta. Todo en céntimos enteros; el redondeo solo ocurre al formatear.

- [ ] **Step 1: Pruebas (fallan).** `semaforo` en los bordes exactos (0.899, 0.9, 1.0, 1.0001, presupuesto 0 con y sin gasto). `resumenViaje`: categorías con presupuesto pero sin gasto y al revés; liquidación positiva y negativa; ganancia con dos guías facturadas; `gananciaPendiente` con una sin facturar y con cero guías. `promedioRuta` con 2 viajes (promedia esos dos), con más de 5 (toma los 5 últimos) y sin ninguno (`[]`). `gananciaDelMes`.
- [ ] **Step 2: Ejecutar → FAIL.** — **Step 3: Implementar hasta verde.**
- [ ] **Step 4: Exportar, verificar y commit.** `git commit -m "feat(core): cálculos del viaje (semáforo, liquidación y ganancia)"`

---

### Task 7: Paquete `ia` — contratos, prompts y proveedor simulado

**Files:**
- Create: `packages/ia/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/ia/src/tipos.ts`, `src/prompts.ts`, `src/simulado.ts`, `src/index.ts`
- Test: `packages/ia/test/simulado.test.ts`, `test/tipos.test.ts`

**Interfaces:**

```ts
export const CATEGORIAS = ["combustible", "peaje", "viaticos", "hospedaje", "estiba", "balanza", "cochera", "reparacion", "otros"] as const;
export type Categoria = (typeof CATEGORIAS)[number];
export type MedioEntrega = "efectivo" | "yape" | "transferencia" | "otro";

export const esquemaLectura = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("gasto"), categoria: z.enum(CATEGORIAS), monto: z.number().positive(),
    fecha: z.string().nullable(), proveedorRuc: z.string().nullable(), proveedorNombre: z.string().nullable(),
    comprobante: z.string().nullable(), nota: z.string().nullable(), dudas: z.array(z.string()) }),
  z.object({ tipo: z.literal("entrega"), monto: z.number().positive(), medio: z.enum(["efectivo", "yape", "transferencia", "otro"]),
    fecha: z.string().nullable(), dudas: z.array(z.string()) }),
  z.object({ tipo: z.literal("inicio_viaje"), ruta: z.string().nullable(), adelanto: z.number().nullable(), dudas: z.array(z.string()) }),
  z.object({ tipo: z.literal("fin_viaje"), dudas: z.array(z.string()) }),
  z.object({ tipo: z.literal("guia_remitente"), dudas: z.array(z.string()) }),   // los campos los saca el extractor por reglas
  z.object({ tipo: z.literal("otro"), descripcion: z.string() }),
  z.object({ tipo: z.literal("no_entendi"), motivo: z.string() }),
]);
export type Lectura = z.infer<typeof esquemaLectura>;

export interface Imagen { contenido: Buffer; mime: string }
export interface ContextoLectura {
  hoy: string;                                   // AAAA-MM-DD en Lima
  viajeEnCurso?: { codigo: string; ruta: string | null; saldo: string };
  rutas: string[];
  correcciones: string[];                        // lo que el usuario escribió al corregir, en orden
  lecturaAnterior?: Lectura;
}
export interface EntradaLectura { texto?: string; imagenes?: Imagen[]; contexto: ContextoLectura }
export interface UsoIa { proveedor: string; modelo: string; tokensEntrada: number; tokensCache: number; tokensSalida: number; costoMicroUsd: number }
export interface ResultadoLectura { lectura: Lectura; uso: UsoIa }
export interface ProveedorIA { nombre: string; leer(e: EntradaLectura): Promise<ResultadoLectura> }

export class IaNoDisponibleError extends Error {}      // reintentable (red, 429, 5xx, contenido vacío)
export class IaCredencialesError extends Error {}      // NO reintentable (401/403, saldo agotado)

export interface Transcriptor { disponible: boolean; transcribir(audio: Buffer, mime: string): Promise<string> }
export class TranscripcionNoDisponibleError extends Error {}

export function crearProveedorIA(config: ConfigIa): ProveedorIA;               // "simulado" | "deepseek"
export function crearTranscriptor(config: ConfigIa): Transcriptor;            // sin WHISPER_BIN → { disponible: false }
export interface ConfigIa {
  proveedor: "simulado" | "deepseek"; apiKey?: string; modelo: string; urlBase: string;
  precioEntradaUsdMillon: number; precioCacheUsdMillon: number; precioSalidaUsdMillon: number;
  whisperBin?: string; whisperModelo?: string; ffmpegBin: string;
}
export function cargarConfigIa(env?: Record<string, string | undefined>): ConfigIa;
```

`prompts.ts` contiene el mensaje de sistema, en español, con: la lista de categorías; la regla "nunca inventes: si no estás seguro, ponlo en `dudas` y deja el campo en null"; el formato **json** exigido con un ejemplo completo (la palabra "json" y el ejemplo son requisitos de la API); la fecha de hoy, las rutas conocidas y el viaje en curso; y las correcciones previas cuando las hay.

`simulado.ts`: determinista, sin red. Reglas mínimas sobre el texto (en minúsculas, sin tildes): `grifo|petroleo|diesel|combustible` → gasto combustible; `peaje` → peaje; `almuerzo|comida|menu|viatico` → viáticos; `hotel|hospedaje` → hospedaje; `estiba|carga|descarga` → estiba; `balanza` → balanza; `cochera` → cochera; `llanta|mecanico|reparacion|repuesto` → reparación; `yape|deposito|transferencia|me dieron` → entrega; `salgo|voy a|viajo` → inicio_viaje (ruta = el texto tras "a "); `llegue|llegamos|ya volvi` → fin_viaje; sin número reconocible → `no_entendi`. Una imagen sin texto → `otro` con descripción `"imagen"`. El monto sale del primer número del texto. `uso` con ceros y modelo `"simulado"`.

- [ ] **Step 1: Paquete.** `package.json` con dependencia `zod` (^4.6.4) y nada más; `tsconfig.json` y `vitest.config.ts` como los demás paquetes; `pnpm install`.
- [ ] **Step 2: Pruebas (fallan).** `esquemaLectura` rechaza un gasto con monto 0, con categoría inventada o sin `dudas`; acepta el ejemplo del prompt (léelo desde `prompts.ts` para que el ejemplo y el esquema no se separen nunca). `simulado` para cada regla de la tabla, incluido `no_entendi` y la corrección ("eran 305" tras un gasto de 350 → el mismo tipo con monto 305).
- [ ] **Step 3: Ejecutar → FAIL.** — **Step 4: Implementar hasta verde.**
- [ ] **Step 5: Verificar y commit.** `git commit -m "feat(ia): contratos de lectura, instrucciones y proveedor simulado"`

---

### Task 8: Proveedor DeepSeek

**Files:**
- Create: `packages/ia/src/deepseek.ts`; Modify: `packages/ia/src/index.ts`
- Test: `packages/ia/test/deepseek.test.ts`

**Interfaces:**
- Produces: `crearProveedorDeepSeek(config: ConfigIa): ProveedorIA` (usado por `crearProveedorIA` cuando `IA_PROVEEDOR=deepseek`).

Petición (sin SDK: `fetch` nativo de Node 24, para no sumar dependencias):

```ts
const respuesta = await fetch(`${config.urlBase}/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
  body: JSON.stringify({
    model: config.modelo,
    response_format: { type: "json_object" },
    max_tokens: 1000,
    messages: [
      { role: "system", content: instruccionesSistema(entrada.contexto) },
      { role: "user", content: [
        ...(entrada.texto ? [{ type: "text", text: entrada.texto }] : []),
        ...(entrada.imagenes ?? []).map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.contenido.toString("base64")}` } })),
      ] },
    ],
  }),
  signal: AbortSignal.timeout(60_000),
});
```

Manejo de la respuesta:
- 401/403 → `IaCredencialesError("DeepSeek rechazó la clave (401). Revisa DEEPSEEK_API_KEY y el saldo.")`.
- 402 o mensaje de saldo insuficiente → `IaCredencialesError` (tampoco se reintenta en bucle).
- 429 o ≥ 500 o error de red o `AbortError` → `IaNoDisponibleError`.
- 200 con `choices[0].message.content` vacío → `IaNoDisponibleError("DeepSeek devolvió una respuesta vacía")` (la documentación advierte que pasa).
- JSON inválido o que no cumple `esquemaLectura` → **un** reintento en la misma llamada, agregando un mensaje `user` que cita el error de validación; si vuelve a fallar → `{ tipo: "no_entendi", motivo: "No pude leer la respuesta del lector" }` (no lanza).
- `uso`: `tokensEntrada = usage.prompt_cache_miss_tokens ?? usage.prompt_tokens`, `tokensCache = usage.prompt_cache_hit_tokens ?? 0`, `tokensSalida = usage.completion_tokens`. `costoMicroUsd = Math.round((tokensEntrada * precioEntrada + tokensCache * precioCache + tokensSalida * precioSalida) )` con los precios en US$/millón convertidos a micro-dólares por token; el resultado es un entero de micro-dólares.
- Imágenes de más de 20 MB → `IaNoDisponibleError` no; es un error del llamador: lanza `Error("La imagen supera el tamaño admitido")` antes de la petición (el límite de Telegram ya es menor, así que no debería pasar).
- La clave nunca se incluye en ningún mensaje de error.

- [ ] **Step 1: Pruebas (fallan)** con `fetch` reemplazado (`vi.stubGlobal("fetch", ...)`; ninguna llamada real): petición bien formada (modelo, `response_format`, imagen como data URL en un mensaje `user`, `authorization` presente pero **no** registrado en el error); 401 → `IaCredencialesError` y el mensaje no contiene la clave; 429 y 503 → `IaNoDisponibleError`; contenido vacío → `IaNoDisponibleError`; JSON inválido una vez y correcto al reintento → devuelve la lectura y hace **dos** llamadas; JSON inválido dos veces → `no_entendi` sin lanzar; cálculo del costo con números conocidos (p. ej. 3000 entrada, 500 cache, 300 salida con los precios por defecto → valor exacto esperado).
- [ ] **Step 2: Ejecutar → FAIL.** — **Step 3: Implementar hasta verde.**
- [ ] **Step 4: Verificar y commit.** `git commit -m "feat(ia): proveedor DeepSeek con modo JSON, imágenes y costo por lectura"`

---

### Task 9: Transcriptor de voz (Whisper local)

**Files:**
- Create: `packages/ia/src/whisper.ts`; Modify: `packages/ia/src/index.ts`
- Test: `packages/ia/test/whisper.test.ts`

**Interfaces:**
- Produces: `crearTranscriptor(config)`: sin `whisperBin` o sin `whisperModelo` devuelve `{ disponible: false, transcribir: () => { throw new TranscripcionNoDisponibleError(...) } }`.
- Con ambos: convierte el audio (Telegram manda OGG/Opus) a WAV 16 kHz mono con `ffmpegBin` y lo pasa a whisper.cpp con `-l es -nt` (sin marcas de tiempo), ambos como procesos hijos con `execFile` sobre archivos temporales en `os.tmpdir()`, borrados siempre en un `finally`. Tiempo máximo 120 s. Si alguno falla → `TranscripcionNoDisponibleError` con el `stderr` recortado a 200 caracteres.

- [ ] **Step 1: Pruebas (fallan)** con los binarios inyectados: usa dos scripts de Node creados en un directorio temporal por la propia prueba, uno que hace de `ffmpeg` (copia la entrada a la salida) y otro que hace de `whisper` (escribe un texto fijo); comprueba que devuelve ese texto, que los temporales se borran, y que sin `whisperBin` `disponible` es false y `transcribir` lanza `TranscripcionNoDisponibleError`. Nada de audio real ni binarios reales.
- [ ] **Step 2: Ejecutar → FAIL.** — **Step 3: Implementar hasta verde.**
- [ ] **Step 4: Verificar y commit.** `git commit -m "feat(ia): transcripción de notas de voz con Whisper local"`

---

### Task 10: Núcleo de lecturas (recibir, leer, confirmar, reintentar)

**Files:**
- Create: `packages/core/src/lecturas/recibir.ts`, `leer.ts`, `confirmar.ts`, `pendientes.ts`
- Modify: `packages/core/src/infra/contexto.ts` (inyección de `ia` y `transcriptor`), `packages/core/src/index.ts`, `packages/core/package.json` (dependencia `@sunatapp/ia`), `packages/core/test/helpers.ts`
- Test: `packages/core/test/lecturas.test.ts`

**Interfaces:**

```ts
// contexto.ts
export interface Contexto { /* … */ ia?: ProveedorIA; transcriptor?: Transcriptor }

// recibir.ts
export interface MensajeEntrante {
  tipo: TipoMensaje; contenido?: Buffer; mime?: string; texto?: string;
  telegramChatId?: number; telegramMessageId?: number; telegramFileId?: string; usuarioId?: number;
}
export async function recibirMensaje(ctx: Contexto, m: MensajeEntrante): Promise<DocumentoRegistrado>
//   Idempotente: archivos por hash sha256 (reusa registrarDocumentoRecibido), textos por (chatId, messageId).

// leer.ts
export interface LecturaLista { documentoId: number; lectura: Lectura; viajeSugerido: Viaje | null }
export async function leerDocumento(ctx: Contexto, documentoId: number): Promise<LecturaLista | { error: "pendiente" | "sin_ia" | "credenciales" }>
//   1) voz → transcriptor (si no está disponible: estado "error", mensaje para el usuario)
//   2) pdf → textoDePdf (el extractor por reglas sigue siendo del flujo de guía; aquí solo se clasifica)
//   3) llama a ctx.ia.leer con el contexto (hoy, viaje en curso, rutas, correcciones, lectura anterior)
//   4) guarda lectura_ia (uso y costo, o el error) y deja documento_recibido en "por_confirmar" con clasificacion
//   IaNoDisponibleError → estado "pendiente" con proximoIntentoEn (1, 5, 15, 60 min según intentosLectura) → { error: "pendiente" }
//   IaCredencialesError → estado "error", sin reintento → { error: "credenciales" }
export async function agregarCorreccion(ctx: Contexto, documentoId: number, texto: string): Promise<LecturaLista | { error: … }>
//   Añade el texto a `correcciones` y vuelve a leer con `lecturaAnterior`.

// confirmar.ts
export type ResultadoConfirmacion =
  | { tipo: "gasto"; gastoId: number; viajeId: number | null; resumen: ResumenViaje | null }
  | { tipo: "entrega"; entregaId: number; resumen: ResumenViaje }
  | { tipo: "inicio_viaje"; viajeId: number; codigo: string }
  | { tipo: "fin_viaje"; viajeId: number; resumen: ResumenViaje }
  | { tipo: "otro" }
  | { tipo: "ya_confirmado" };
export async function confirmarLectura(ctx: Contexto, documentoId: number, o: { viajeId?: number | null; usuarioId?: number }): Promise<ResultadoConfirmacion>
//   Compare-and-set sobre estado_lectura ("por_confirmar" → "confirmado") DENTRO de la transacción que crea el registro:
//   el segundo clic devuelve { tipo: "ya_confirmado" } sin duplicar nada.
export async function descartarLectura(ctx: Contexto, documentoId: number, usuarioId?: number): Promise<void>

// pendientes.ts
export async function procesarLecturasPendientes(ctx: Contexto): Promise<LecturaLista[]>
//   Documentos en "pendiente" con proximoIntentoEn vencido; devuelve los que quedaron "por_confirmar" para avisar.
export async function listarPorRevisar(ctx: Contexto): Promise<Array<{ documentoId: number; tipo: TipoMensaje; estado: EstadoLectura; desde: Date; resumen: string }>>
//   "por_confirmar" con más de 24 h, "error", y gastos sin viaje. (Lo consume el Plan 4; aquí basta con exponerlo y probarlo.)
```

Conversión de la lectura al registro: el monto en soles se convierte a céntimos con `Math.round(monto * 100)` y se valida con las reglas de `registrarGasto`; la fecha nula toma hoy; `proveedorRuc` inválido se descarta; en `inicio_viaje` la ruta se busca con `buscarRuta` (una sola coincidencia → se usa; varias o ninguna → el bot pregunta, así que `confirmarLectura` exige `rutaId` explícito en ese caso vía `o`).

- [ ] **Step 1: Pruebas (fallan)** con `IA_PROVEEDOR=simulado` (agrega a `crearContextoPrueba` las opciones `ia` y `transcriptor`): recibir el mismo texto dos veces deja un solo documento; un gasto leído queda "por_confirmar" y al confirmar crea el gasto en el viaje en curso con el monto correcto; doble confirmación → `ya_confirmado` y un solo gasto; descartar; corrección "eran 305" cambia el monto y deja rastro en `correcciones`; IA caída (proveedor que lanza `IaNoDisponibleError`) → "pendiente" con `proximoIntentoEn`, y `procesarLecturasPendientes` lo resuelve al avanzar el reloj; `IaCredencialesError` → "error" y **no** se reintenta; voz sin transcriptor → "error" con mensaje claro; `inicio_viaje` crea el viaje con el adelanto; `fin_viaje` cierra el viaje y devuelve el resumen.
- [ ] **Step 2: Ejecutar → FAIL.** — **Step 3: Implementar hasta verde.**
- [ ] **Step 4: Verificar y commit.** `git commit -m "feat(core): lecturas con IA, confirmación y reintentos"`

---

### Task 11: Bot — flujo de lectura

**Files:**
- Create: `apps/bot/src/flujo-lectura.ts`; Modify: `apps/bot/src/bot.ts`, `sesion.ts`, `textos.ts`, `flujo-guia.ts` (reusar la entrada desde una extracción)
- Modify: `apps/bot/package.json` (dependencia `@sunatapp/ia` solo para los tipos)
- Test: `apps/bot/test/flujo-lectura.test.ts`

**Interfaces:**
- Produces: `registrarFlujoLectura(bot, deps)`, `notificarLectura(deps, api, chatId, lectura)`.
- `Dependencias` gana `ia: ProveedorIA` y `transcriptor: Transcriptor` (se inyectan en el `Contexto` del núcleo).

**Conversación** (todo el texto en `textos.ts`):
1. Entrada: `message:photo`, `message:voice`, `message:audio`, y `message:text` que no sea comando ni parte de otro flujo. Los **PDF** siguen yendo al flujo de guía (Plan 2). Responde "👀 Leyendo…" y lanza la lectura con `deps.enSegundoPlano`.
2. Al terminar, muestra el resumen según el tipo, con `[✅ Correcto] [✏️ Corregir] [❌ Descartar]` (`l:ok:<documentoId>`, `l:corr:<documentoId>`, `l:desc:<documentoId>`):
   - gasto: `⛽ Combustible · S/ 350.00 · Grifo Primax Juliaca (RUC 20…) · B012-4471 · 18/09 · para VJ-0003 (quedarían S/ 422 del adelanto). ¿Correcto?`
   - entrega: `💵 Envío al chofer S/ 200.00 por Yape · VJ-0003. ¿Correcto?`
   - inicio_viaje: `🚛 Nuevo viaje Arequipa ⇄ Puno · F2F-848 / V1X-971 · adelanto S/ 1,300 · presupuesto S/ 1,570. ¿Correcto?`
   - fin_viaje: la liquidación (`Entregado … · Gastado … · Devuelve …`) y `¿Cierro VJ-0003?`
   - otro: `📎 Guardé la foto en VJ-0003.` con `[✅] [❌]`
   - no_entendi: `🤔 No te entendí. ¿Qué fue?` con botones de categoría (`l:cat:<documentoId>:<categoria>`) y luego pide el monto.
   - Las `dudas` se listan debajo con ⚠️.
3. Sin viaje en curso, el resumen ofrece `[Nuevo viaje] [VJ-0003 (anterior)] [Sin viaje]` (`l:viaje:<documentoId>:nuevo|<viajeId>|sin`) antes de confirmar.
4. `✏️ Corregir` pide "¿Qué corrijo?" y la siguiente respuesta de texto va a `agregarCorreccion` → nuevo resumen.
5. Errores: IA caída → `⏳ No pude leerlo ahora; lo leo en cuanto pueda y te aviso.`; credenciales → aviso **una sola vez** al dueño (`⛔ DeepSeek rechazó la clave; revisa DEEPSEEK_API_KEY`) y el documento queda en "por revisar"; voz sin Whisper → `🎤 No tengo instalado el lector de voz; escríbelo, por favor.`
6. Nada se guarda sin el `✅`. El doble clic responde `Ya lo guardé.`

Integración con el flujo de guía: si la clasificación es `guia_remitente` (foto de una guía), el flujo de lectura llama a la función del flujo de guía que arranca desde un documento ya registrado; para eso extrae de `flujo-guia.ts` una función exportada `iniciarGuiaDesdeDocumento(c, deps, documentoId)` reutilizada por `manejarDocumento`.

- [ ] **Step 1: Pruebas (fallan)** con el arnés del Plan 2 más `ia` simulada: foto con pie "grifo 350" → resumen exacto → `l:ok` → el gasto existe en el viaje en curso; texto "peaje 28.50" → resumen; corregir "eran 305" → resumen nuevo con 305; descartar; doble `l:ok` → "Ya lo guardé." y un solo gasto; sin viaje en curso → botones de viaje; nota de voz sin transcriptor → mensaje claro; IA caída → mensaje de espera y, tras `procesarLecturasPendientes`, llega el resumen; `no_entendi` → botones de categoría → monto → resumen; un PDF sigue yendo al flujo de guía (no lo toca este flujo); un texto durante el flujo de factura **no** se interpreta como gasto.
- [ ] **Step 2: Ejecutar → FAIL.** — **Step 3: Implementar hasta verde.**
- [ ] **Step 4: Verificar y commit.** `git commit -m "feat(bot): lectura de fotos, voz y texto con confirmación"`

---

### Task 12: Bot — comandos de viaje y multiusuario

**Files:**
- Create: `apps/bot/src/comandos-viaje.ts`; Modify: `apps/bot/src/registro.ts`, `comandos.ts`, `bot.ts`, `textos.ts`
- Modify (core): `packages/core/src/usuarios/usuarios.ts` (invitaciones)
- Test: `apps/bot/test/comandos-viaje.test.ts`, `packages/core/test/usuarios.test.ts`

**Interfaces:**

```ts
// core/usuarios.ts
export async function crearInvitacion(ctx: Contexto, creadaPor: number): Promise<{ codigo: string; expiraEn: Date }>
//   6 dígitos con crypto.randomInt; se guarda solo el hash sha256; vale 24 h y un solo uso.
export async function usarInvitacion(ctx: Contexto, codigo: string, telegramId: number, nombre: string): Promise<Usuario | null>
//   Transacción: marca la invitación usada (compare-and-set) y crea el usuario (email null, telegramNombre).
export async function listarUsuarios(ctx: Contexto): Promise<Usuario[]>
```

El middleware de autorización del Plan 2 pasa a admitir **cualquier** usuario activo con `telegramId`, y los desconocidos que envían un código válido de invitación quedan registrados (además del código de dueño inicial, que se mantiene tal cual).

| Comando | Comportamiento |
|---------|----------------|
| `/invitar` | Genera el código y responde: `Dale este código a la persona (vence en 24 h): 482913` |
| `/saldo` | Resumen del viaje en curso: una línea por categoría con emoji, gastado/presupuesto y el semáforo; al final `Entregado … · Gastado … · Saldo …`. Sin viaje en curso → `No hay ningún viaje en curso. Escribe /viaje para empezar uno.` |
| `/viaje` | Si ya hay uno en curso lo muestra y ofrece `[Cerrarlo]`. Si no, pregunta la ruta con botones (`v:ruta:<id>`), luego el adelanto (texto, `parsearMonto`), y crea el viaje mostrando el presupuesto copiado |
| `/cerrar` | Muestra la liquidación y pide confirmar (`v:cerrar:<viajeId>`); al confirmar cierra y responde con la ganancia (o "ganancia pendiente" si falta facturar) |
| `/rutas` | Lista las rutas con su presupuesto total; sin rutas → explica que se crea la primera desde `/viaje` escribiendo el nombre |

`/viaje` con una ruta que no existe ofrece `[Crear ruta "Arequipa ⇄ Puno"]`, que la crea con la plantilla vacía (el presupuesto se ajusta después desde la web, Plan 4).

Notificaciones: cada aviso va a quien originó la acción; el resumen diario de cobros sigue yendo al dueño (`duenoTelegramId`).

- [ ] **Step 1: Pruebas (fallan)** de núcleo (invitación: crear, usar, usar dos veces → null, vencida → null; el código no se guarda en claro) y de bot (`/invitar` + código desde otro usuario → queda registrado y puede usar `/saldo`; `/viaje` completo; `/saldo` con y sin viaje; `/cerrar` con confirmación; un usuario no invitado sigue siendo ignorado).
- [ ] **Step 2: Ejecutar → FAIL.** — **Step 3: Implementar hasta verde.**
- [ ] **Step 4: Verificar y commit.** `git commit -m "feat(bot): comandos de viaje, saldo e invitación de usuarios"`

---

### Task 13: Cableado, configuración y documentación

**Files:**
- Modify: `apps/bot/src/fondo.ts`, `main.ts`, `config.ts`; `packages/core/src/infra/contexto.ts`; `.env.example`; `README.md`
- Test: `apps/bot/test/fondo.test.ts`

**Interfaces:**
- `crearTareaFondo` añade `procesarLecturasPendientes` a cada pasada y notifica las lecturas que quedaron listas (mismo aislamiento por documento que guías y facturas: un fallo no detiene a los demás).
- `main.ts` construye `ia` y `transcriptor` con `cargarConfigIa()`, los inyecta en el `Contexto` y en `Dependencias`, y al arrancar imprime en español qué lector de IA está activo y si la voz está disponible (sin mostrar la clave).

`.env` nuevo (documentado en `.env.example` y el README):

```
IA_PROVEEDOR=deepseek            # deepseek | simulado
DEEPSEEK_API_KEY=
DEEPSEEK_MODELO=deepseek-flash
DEEPSEEK_URL=https://api.deepseek.com
IA_PRECIO_ENTRADA_USD_M=0.30
IA_PRECIO_CACHE_USD_M=0.006
IA_PRECIO_SALIDA_USD_M=1.20
WHISPER_BIN=
WHISPER_MODELO=
FFMPEG_BIN=ffmpeg
```

Sin `DEEPSEEK_API_KEY` y con `IA_PROVEEDOR=deepseek`, `cargarConfigIa` lanza `ErrorConfiguracion("Falta DEEPSEEK_API_KEY en .env (o usa IA_PROVEEDOR=simulado)")`.

- [ ] **Step 1: Pruebas (fallan):** la pasada de fondo procesa lecturas pendientes y notifica una sola vez por documento; un fallo al notificar una lectura no impide notificar las demás; `cargarConfigIa` sin clave lanza el error en español y con `simulado` no la exige.
- [ ] **Step 2: Implementar hasta verde.**
- [ ] **Step 3: Arranque en seco.** Como en el Plan 2: token falso, `DATA_DIR`/`STORAGE_DIR` temporales, `IA_PROVEEDOR=simulado`. Comprueba que imprime el lector activo y el estado de la voz, y que apaga limpio con SIGINT. Nunca usar el token ni la clave reales.
- [ ] **Step 4: README** — sección "Gastos y viajes por Telegram": qué puede mandar el chofer, cómo se confirma, `/invitar`, `/viaje`, `/saldo`, `/cerrar`, cómo conseguir la clave de DeepSeek, cuánto cuesta aproximadamente y cómo instalar Whisper y ffmpeg si se quieren notas de voz (y que sin ellos el bot pide que lo escriban).
- [ ] **Step 5: Verificar y commit.** `git commit -m "feat(bot): cableado de la IA, reintentos de lectura y documentación"`

---

### Task 14: Prueba con muestras reales (con permiso del usuario)

**Files:**
- Create: `packages/ia/test/muestras.test.ts` (se salta si no hay muestras)
- Create (git-ignorado): `referencias/muestras/gastos/*.jpg|.ogg` + `<nombre>.esperado.json`

**Interfaces:** ninguna nueva; mide la precisión del proveedor real.

- [ ] **Step 1: Prueba** que recorre `referencias/muestras/gastos/*` con su `.esperado.json` al lado y compara campo por campo la lectura de **DeepSeek real**, imprimiendo aciertos y el costo total. Se ejecuta solo con `IA_MUESTRAS=1` y `IA_PROVEEDOR=deepseek`; en cualquier otro caso `it.skip`. Nunca se ejecuta en la suite normal.
- [ ] **Step 2: Pedir al usuario** un puñado de fotos de boletas reales (grifo, peaje, comida) y, si quiere voz, una nota de voz; explicarle que esa corrida envía esas fotos a DeepSeek y cuesta unos centavos. **No ejecutarla sin su permiso explícito.**
- [ ] **Step 3: Con su permiso,** ejecutar, anotar el porcentaje de aciertos y el costo en el README de referencias (git-ignorado), y ajustar `prompts.ts` si algún campo falla de forma sistemática.
- [ ] **Step 4: Commit** (solo el archivo de prueba; verificar con `git status` que no entra nada de `referencias/`). `git commit -m "test(ia): medición de precisión con boletas reales (opcional, fuera de la suite)"`

---

## Cobertura del spec (autorrevisión)

| Spec (2026-09-19) | Tarea |
|---|---|
| §4 tablas nuevas y cambios | 2 |
| §5 cálculos (semáforo, liquidación, ganancia, promedios) | 6 |
| §6.1 ProveedorIA, DeepSeek, costo, transcriptor | 7, 8, 9 |
| §6.2 flujo del mensaje (recibir → leer → confirmar) | 10, 11 |
| §6.3 mensajes que no son registros | 11 |
| §7 comandos `/invitar` `/saldo` `/viaje` `/cerrar` | 12 |
| §9 errores (IA caída, credenciales, voz, doble clic, dos viajes en curso) | 8, 10, 11, 4 |
| §10 configuración | 13 |
| §11 pruebas (cálculos, núcleo, lecturas, bot, IA real) | 3-14 |
| §12 criterios de éxito 1-5 | 11, 12, 14 (el 6, costo visible, es del Plan 4) |
| §14 división: rutas, viajes, gastos, IA, lecturas, bot, fondo | 3-13 |
| Pendientes parqueados del Plan 2 | 1 |

Fuera de alcance aquí (Plan 4): la web, las estadísticas, el Excel, `enlace_web`/`sesion_web` y el gasto de IA mostrado al usuario.
