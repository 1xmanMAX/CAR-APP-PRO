# Costos fijos y variables, viaje desde la guía, gasto automático y rentabilidad por viaje o mes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar el costo fijo del variable (con fijos recurrentes que se cargan solos y se reparten por viaje), crear el viaje al registrar su guía, completar solo los datos de cada gasto (guía, forma de pago, km) y mostrar la rentabilidad por viaje o por mes.

**Architecture:** La lista cerrada `categoria_gasto` (enum de Postgres) pasa a ser una **tabla** con la clave, el nombre y el tipo (`fijo`/`variable`), y las columnas que la usaban pasan a texto. La lógica nueva vive en `packages/core` en archivos chicos:
- `finanzas/categorias.ts`;
- `finanzas/captura.ts`: deduce unidad, viaje, guía, km y forma de pago;
- `finanzas/costos-fijos.ts`: genera los gastos del mes de forma idempotente;
- `viajes/desde-guia.ts`;
- `rentabilidad/por-viaje-mes.ts`.

La web (Hono + JSX) y el bot (grammY) solo consumen esas funciones.

**Tech Stack:** TypeScript, pnpm workspaces, Drizzle ORM + PGlite (migraciones SQL en `packages/db/drizzle`), Vitest, Hono JSX, grammY, zod, ExcelJS.

**Spec:** `docs/superpowers/specs/2026-09-27-costos-guias-rentabilidad-design.md`

## Global Constraints

- **Mínimo de campos:** a la persona solo se le pide lo que la app no puede deducir, casi siempre el monto. La fecha, la hora, la unidad, el viaje, la guía, el km y la forma de pago se toman solos (spec §1).
- Montos en **céntimos** (enteros) en toda la base y el núcleo; en pantalla se muestran con `soles()`/`soles2()`.
- Fechas contables `AAAA-MM-DD` en hora de Lima con `hoy(ctx)`; el periodo es `AAAA-MM`.
- Toda escritura importante deja auditoría con `registrarAuditoria`, como el código existente.
- Errores de negocio con `ErrorNegocio`, con mensaje en español para el usuario.
- Las tablas nuevas se registran en `TABLAS` (`packages/core/src/sincro/registro.ts`) y llevan las columnas `sinc_*` y los disparadores `sinc_marcar`/`sinc_lapida`, siguiendo `0008_sincronizacion.sql`.
- Los gastos generados por fijos o cuotas usan `sinc_uid` natural (`gf:`/`gc:`) para no duplicarse al sincronizar (spec §4.2).
- Reparto del fijo **por viaje**. El mes de un viaje es el de su **fecha de cierre** (`viaje.fecha_regreso`). En el mes en curso el resultado es `provisional` (spec §7).
- Fijos anuales = 1/12 por mes, con el redondeo en diciembre. Las cuotas de préstamo entran como fijo del mes en que vencen.
- Pruebas: `pnpm vitest run <ruta>` desde la raíz; la suite completa con `pnpm test`. PGlite es pesado: no subas `maxWorkers`.
- Commits pequeños, uno por tarea como mínimo, con mensajes en español estilo `feat(core): …`.

## Review Focus

1. **Doble conteo de cuotas en caja:** una cuota de préstamo ahora genera un gasto fijo y además, al pagarse, aparece como CUOTA. Hay que esperar que `flujoCaja` y `listarMovimientos` la cuenten **una sola vez**. Lo prueba la Tarea 4, paso «flujo sin doble conteo».
2. **Fijo generado en dos dispositivos:** el mismo fijo del mismo mes, generado en dos dispositivos, debe quedar como **una sola fila** tras sincronizar. Lo prueba la Tarea 1, paso «uid natural de gastos generados».
3. **Guía registrada dos veces para el mismo documento** (reintento del bot): no debe crear dos viajes. Lo prueba la Tarea 5, paso «idempotencia».
4. **Km del voucher menor que el odómetro o con un salto de más de 20,000 km:** el gasto se guarda igual, con el último km y un aviso; nunca se rechaza. Lo prueba la Tarea 3, paso «km inválido».
5. **Mes sin viajes cerrados pero con fijos:** la vista por mes muestra pérdida y la vista por viaje no divide entre cero. Lo prueba la Tarea 6, paso «mes sin viajes».

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `packages/db/src/schema.ts` | tabla `categoriaGasto`, tabla `costoFijo`, enums `medioPago`, `tipoCategoria` y `periodicidad`; columnas nuevas de `gasto` y `viaje`; `categoria` como texto |
| `packages/db/drizzle/0012_costos_fijos.sql` | migración: tipos, tablas, datos de fábrica, mapeo, relleno de `guia_id`, sincronización |
| `packages/core/src/finanzas/categorias.ts` (nuevo) | lista de fábrica, `listarCategorias`, `crearCategoria`, `desactivarCategoria`, `nombreCategoria`, `categoriaDesdeTexto` |
| `packages/core/src/finanzas/captura.ts` (nuevo) | `capturarContexto`, `describirContexto` |
| `packages/core/src/finanzas/costos-fijos.ts` (nuevo) | alta, edición y listado de fijos; `montoDelMes`, `generarFijosDelMes`, `asegurarFijos` |
| `packages/core/src/finanzas/finanzas.ts` | `registrarGasto` con captura; `resumenFinanciero` separando fijo y variable; caja sin doble conteo |
| `packages/core/src/viajes/desde-guia.ts` (nuevo) | `alRegistrarGuia`, `ciudadDeUbigeo` |
| `packages/core/src/viajes/revisar-viajes.ts` (nuevo) | `viajesPorRevisar` (4 motivos) |
| `packages/core/src/rentabilidad/por-viaje-mes.ts` (nuevo) | `rentabilidadPorViaje`, `rentabilidadDeViaje`, `rentabilidadPorMes` |
| `packages/core/src/guias/registrar.ts` | llama a `alRegistrarGuia` |
| `packages/core/src/flota/viajes-flota.ts` | `vehiculoSecundarioId` opcional; exporta `facturasPorViaje` |
| `packages/core/src/lecturas/lecturas.ts` | categorías dinámicas, fecha = hoy, km y medio del voucher, contexto en la lectura |
| `packages/ia/src/{tipos,prompts,reglas}.ts` | categoría de texto libre, `medioPago`, `kmOdometro`, reglas nuevas |
| `apps/bot/src/flujo-lectura.ts`, `flujo-flota.ts` | confirmación con contexto, pedir km al cargar combustible, categorías dinámicas |
| `apps/web/src/paginas/*.tsx` | gasto mínimo, categorías dinámicas, rentabilidad por viaje o mes, Ajustes, Por revisar, Excel |
| `packages/core/scripts/demo-flota.ts` | fijos y viajes desde guías en la demo |

---

### Task 1: Base de datos — categorías como tabla, fijos, columnas nuevas y sincronización

**Files:**
- Modify: `packages/db/src/schema.ts:16-17,37,249-326` (enum, tipo `CategoriaGasto`, `rutaPresupuesto`, `viaje`, `viajePresupuesto`, `gasto`)
- Create: `packages/db/drizzle/0012_costos_fijos.sql` (+ `meta/0012_snapshot.json` y la entrada en `meta/_journal.json`, que genera drizzle-kit)
- Modify: `packages/core/src/sincro/registro.ts:25-56`
- Test: `packages/db/test/db.test.ts`, `packages/core/test/sincro.test.ts`

**Interfaces:**
- Produces:
  - tablas Drizzle `categoriaGasto` y `costoFijo`;
  - enums `medioPagoEnum` (`efectivo_chofer`, `efectivo`, `yape_plin`, `transferencia`, `tarjeta`, `credito`), `tipoCategoriaEnum` (`fijo`, `variable`) y `periodicidadEnum` (`mensual`, `anual`);
  - tipos `MedioPago`, `TipoCategoria` y `Periodicidad`;
  - `export type CategoriaGasto = string`;
  - columnas `gasto.guiaId`, `medioPago`, `kmVehiculo`, `kmReal`, `costoFijoId`, `cuotaId`, `periodo`, y `viaje.cierreAutomatico`.

- [ ] **Step 1: Test que falla — la base trae las categorías de fábrica y acepta un gasto con los campos nuevos**

Agregar a `packages/db/test/db.test.ts` (importar `categoriaGasto`, `costoFijo` desde `../src/index`):

```ts
describe("costos fijos y categorías (0012)", () => {
  it("trae las 27 categorías de fábrica, 14 variables y 13 fijas", async () => {
    const cats = await db.select().from(categoriaGasto);
    expect(cats).toHaveLength(27);
    expect(cats.filter((c) => c.tipo === "variable")).toHaveLength(14);
    expect(cats.find((c) => c.clave === "sueldo_chofer")).toMatchObject({ tipo: "fijo", sistema: true, activa: true });
  });

  it("un gasto guarda guía, forma de pago, km y periodo; el mismo fijo no se repite en el mes", async () => {
    await db.insert(empresa).values({ ruc: "20606433094", razonSocial: "X", direccion: "X", ubigeo: "150115", registroMtc: "X" });
    const [cf] = await db.insert(costoFijo).values({ concepto: "Sueldo", categoria: "sueldo_chofer", monto: 250000, periodicidad: "mensual", desde: "2026-01-01" }).returning();
    await db.insert(gasto).values({ categoria: "sueldo_chofer", monto: 250000, fecha: "2026-09-01", costoFijoId: cf!.id, periodo: "2026-09", medioPago: "transferencia", origen: "sistema" });
    await expect(db.insert(gasto).values({ categoria: "sueldo_chofer", monto: 250000, fecha: "2026-09-01", costoFijoId: cf!.id, periodo: "2026-09", origen: "sistema" }))
      .rejects.toThrow();
    const [g] = await db.select().from(gasto);
    expect(g).toMatchObject({ medioPago: "transferencia", kmReal: false, periodo: "2026-09" });
  });

  it("uid natural de gastos generados: el mismo fijo y mes da el mismo sinc_uid", async () => {
    const [cf] = await db.insert(costoFijo).values({ concepto: "GPS", categoria: "gps", monto: 9000, periodicidad: "mensual", desde: "2026-01-01" }).returning();
    await db.insert(gasto).values({ categoria: "gps", monto: 9000, fecha: "2026-09-01", costoFijoId: cf!.id, periodo: "2026-09", origen: "sistema" });
    const r1 = await db.execute(sql`select sinc_uid from gasto where costo_fijo_id = ${cf!.id}`);
    await db.delete(gasto);
    await db.insert(gasto).values({ categoria: "gps", monto: 9000, fecha: "2026-09-01", costoFijoId: cf!.id, periodo: "2026-09", origen: "sistema" });
    const r2 = await db.execute(sql`select sinc_uid from gasto where costo_fijo_id = ${cf!.id}`);
    const uid = (r: unknown) => ((r as { rows: Array<{ sinc_uid: string }> }).rows ?? (r as Array<{ sinc_uid: string }>))[0]!.sinc_uid;
    expect(uid(r1)).toBe(uid(r2));
  });
});
```

(Importar también `sql` desde `../src/index`.)

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm vitest run packages/db/test/db.test.ts`
Expected: FAIL — `categoriaGasto` no se exporta.

- [ ] **Step 3: Cambiar `schema.ts`**

Reemplazar la línea 16-17 (`export const categoriaGastoEnum = pgEnum("categoria_gasto", …)`) por:

```ts
export const tipoCategoriaEnum = pgEnum("tipo_categoria", ["fijo", "variable"]);
export const medioPagoEnum = pgEnum("medio_pago", ["efectivo_chofer", "efectivo", "yape_plin", "transferencia", "tarjeta", "credito"]);
export const periodicidadEnum = pgEnum("periodicidad", ["mensual", "anual"]);
```

Reemplazar la línea 37 (`export type CategoriaGasto = …`) por:

```ts
/** Clave de `categoria_gasto` (las de fábrica y las que crea el usuario). */
export type CategoriaGasto = string;
export type TipoCategoria = (typeof tipoCategoriaEnum.enumValues)[number];
export type MedioPago = (typeof medioPagoEnum.enumValues)[number];
export type Periodicidad = (typeof periodicidadEnum.enumValues)[number];
```

Antes de `export const ruta = pgTable(...)` agregar:

```ts
/** Categorías de gasto: las de fábrica (sistema) y las propias. Cada una es fija o variable. */
export const categoriaGasto = pgTable("categoria_gasto", {
  clave: text("clave").primaryKey(),
  nombre: text("nombre").notNull(),
  tipo: tipoCategoriaEnum("tipo").notNull(),
  sistema: boolean("sistema").notNull().default(false),
  activa: boolean("activa").notNull().default(true),
  orden: integer("orden").notNull().default(100),
});
```

En `rutaPresupuesto` y `viajePresupuesto`, cambiar `categoria: categoriaGastoEnum("categoria").notNull(),` por:

```ts
  categoria: text("categoria").notNull().references(() => categoriaGasto.clave),
```

En `viaje`, después de `kmAplicados`:

```ts
  /** Se cerró solo al registrarse una guía nueva de la unidad: revisar km y flete. */
  cierreAutomatico: boolean("cierre_automatico").notNull().default(false),
```

Antes de `export const gasto` agregar la tabla `costoFijo`. `gasto` la referencia, y `cuotaPrestamo` se declara más abajo en el archivo, así que para `cuota_id` se usa una función flecha:

```ts
/** Costo fijo recurrente: se carga solo cada mes (el anual, 1/12 por mes). */
export const costoFijo = pgTable("costo_fijo", {
  id: serial("id").primaryKey(),
  concepto: text("concepto").notNull(),
  categoria: text("categoria").notNull().references(() => categoriaGasto.clave),
  monto: centimos("monto").notNull(),
  periodicidad: periodicidadEnum("periodicidad").notNull().default("mensual"),
  /** null = fijo general de la empresa. */
  vehiculoId: integer("vehiculo_id").references(() => vehiculo.id),
  medioPago: medioPagoEnum("medio_pago").notNull().default("transferencia"),
  desde: date("desde", { mode: "string" }).notNull(),
  hasta: date("hasta", { mode: "string" }),
  activo: boolean("activo").notNull().default(true),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  creadoEn: creadoEn(),
});
```

En `gasto`, cambiar `categoria` y agregar las columnas nuevas antes de `creadoEn`. El bloque de restricciones va como tercer argumento de `pgTable`:

```ts
  categoria: text("categoria").notNull().references(() => categoriaGasto.clave),
  // …columnas existentes sin cambios…
  guiaId: integer("guia_id").references(() => guiaTransportista.id),
  medioPago: medioPagoEnum("medio_pago"),
  kmVehiculo: integer("km_vehiculo"),
  /** true = km leído del voucher o dado por el chofer; false = el último conocido. */
  kmReal: boolean("km_real").notNull().default(false),
  costoFijoId: integer("costo_fijo_id").references(() => costoFijo.id),
  cuotaId: integer("cuota_id").references((): AnyPgColumn => cuotaPrestamo.id),
  /** AAAA-MM del mes al que corresponde un gasto fijo. */
  periodo: text("periodo"),
  creadoEn: creadoEn(),
  editadoEn: timestamp("editado_en", { withTimezone: true }),
}, (t) => [
  unique("gasto_fijo_periodo").on(t.costoFijoId, t.periodo),
  unique("gasto_cuota").on(t.cuotaId),
]);
```

Agregar `type AnyPgColumn` al import de `drizzle-orm/pg-core` al inicio de `schema.ts`.

- [ ] **Step 4: Generar la migración y reemplazar su SQL por el escrito a mano**

Run: `pnpm --filter @sunatapp/db generar -- --name costos_fijos`

Si drizzle-kit pregunta si `categoria_gasto` es una tabla nueva o un renombre, elegir **crear tabla**; para cada columna nueva, **crear columna**. Esto crea `drizzle/0012_costos_fijos.sql`, `meta/0012_snapshot.json` y la entrada del journal.

Reemplazar todo el contenido del `.sql` por el de abajo; el snapshot queda como lo generó drizzle-kit.

```sql
-- Costos fijos y variables (spec 2026-09-27). Las categorías dejan de ser un enum: pasan a una
-- tabla (fábrica + propias). El enum se borra antes de crear la tabla porque Postgres no deja un
-- tipo y una tabla con el mismo nombre.
ALTER TABLE "gasto" ALTER COLUMN "categoria" TYPE text USING "categoria"::text;
--> statement-breakpoint
ALTER TABLE "ruta_presupuesto" ALTER COLUMN "categoria" TYPE text USING "categoria"::text;
--> statement-breakpoint
ALTER TABLE "viaje_presupuesto" ALTER COLUMN "categoria" TYPE text USING "categoria"::text;
--> statement-breakpoint
DROP TYPE "categoria_gasto";
--> statement-breakpoint
CREATE TYPE "tipo_categoria" AS ENUM('fijo', 'variable');
--> statement-breakpoint
CREATE TYPE "medio_pago" AS ENUM('efectivo_chofer', 'efectivo', 'yape_plin', 'transferencia', 'tarjeta', 'credito');
--> statement-breakpoint
CREATE TYPE "periodicidad" AS ENUM('mensual', 'anual');
--> statement-breakpoint
CREATE TABLE "categoria_gasto" (
  "clave" text PRIMARY KEY NOT NULL, "nombre" text NOT NULL, "tipo" "tipo_categoria" NOT NULL,
  "sistema" boolean DEFAULT false NOT NULL, "activa" boolean DEFAULT true NOT NULL, "orden" integer DEFAULT 100 NOT NULL,
  "sinc_uid" text, "sinc_disp" text, "sinc_num" bigint, "sinc_creado" bigint, "sinc_tocado" bigint
);
--> statement-breakpoint
CREATE TABLE "costo_fijo" (
  "id" serial PRIMARY KEY NOT NULL, "concepto" text NOT NULL, "categoria" text NOT NULL REFERENCES "categoria_gasto"("clave"),
  "monto" bigint NOT NULL, "periodicidad" "periodicidad" DEFAULT 'mensual' NOT NULL, "vehiculo_id" integer REFERENCES "vehiculo"("id"),
  "medio_pago" "medio_pago" DEFAULT 'transferencia' NOT NULL, "desde" date NOT NULL, "hasta" date, "activo" boolean DEFAULT true NOT NULL,
  "usuario_id" integer REFERENCES "usuario"("id"), "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "sinc_uid" text, "sinc_disp" text, "sinc_num" bigint, "sinc_creado" bigint, "sinc_tocado" bigint
);
--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "guia_id" integer REFERENCES "guia_transportista"("id"),
  ADD COLUMN "medio_pago" "medio_pago", ADD COLUMN "km_vehiculo" integer, ADD COLUMN "km_real" boolean DEFAULT false NOT NULL,
  ADD COLUMN "costo_fijo_id" integer REFERENCES "costo_fijo"("id"), ADD COLUMN "cuota_id" integer REFERENCES "cuota_prestamo"("id"),
  ADD COLUMN "periodo" text;
--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_fijo_periodo" UNIQUE("costo_fijo_id", "periodo");
--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_cuota" UNIQUE("cuota_id");
--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "cierre_automatico" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sinc_marcar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  det text;
  j jsonb;
BEGIN
  IF current_setting('sinc.aplicando', true) = 'si' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    NEW.sinc_uid := OLD.sinc_uid;
    NEW.sinc_disp := OLD.sinc_disp;
    NEW.sinc_num := OLD.sinc_num;
    NEW.sinc_creado := OLD.sinc_creado;
    NEW.sinc_tocado := greatest(sinc_ahora(), coalesce(OLD.sinc_tocado, 0) + 1);
    RETURN NEW;
  END IF;
  IF NEW.sinc_uid IS NULL THEN
    j := to_jsonb(NEW);
    det := CASE TG_TABLE_NAME
      WHEN 'empresa' THEN (SELECT 'empresa')
      WHEN 'tipo_parte' THEN (SELECT 'tipo_parte:' || (j->>'codigo'))
      WHEN 'vehiculo' THEN (SELECT 'vehiculo:' || upper(regexp_replace((j->>'placa'), '[^A-Za-z0-9]', '', 'g')))
      WHEN 'conductor' THEN (SELECT 'conductor:' || (j->>'numero_doc'))
      WHEN 'contraparte' THEN (SELECT 'contraparte:' || (j->>'numero_doc'))
      WHEN 'ruta' THEN (SELECT 'ruta:' || (j->>'nombre_normalizado'))
      WHEN 'usuario' THEN (SELECT CASE WHEN (j->>'email') IS NULL THEN NULL ELSE 'usuario:' || lower((j->>'email')) END)
      WHEN 'ajuste' THEN (SELECT 'ajuste:' || (j->>'clave'))
      WHEN 'ruta_presupuesto' THEN (SELECT 'rp:' || (SELECT sinc_uid FROM ruta WHERE id = (j->>'ruta_id')::int) || ':' || (j->>'categoria'))
      WHEN 'viaje_presupuesto' THEN (SELECT 'vp:' || (SELECT sinc_uid FROM viaje WHERE id = (j->>'viaje_id')::int) || ':' || (j->>'categoria'))
      WHEN 'factura_guia' THEN (SELECT 'fg:' || (SELECT sinc_uid FROM guia_transportista WHERE id = (j->>'guia_id')::int))
      WHEN 'cuota_prestamo' THEN (SELECT 'cuota:' || (SELECT sinc_uid FROM prestamo WHERE id = (j->>'prestamo_id')::int) || ':' || (j->>'numero'))
      WHEN 'categoria_gasto' THEN (SELECT 'cat:' || (j->>'clave'))
      WHEN 'gasto' THEN (SELECT CASE
        WHEN (j->>'costo_fijo_id') IS NOT NULL THEN 'gf:' || (SELECT sinc_uid FROM costo_fijo WHERE id = (j->>'costo_fijo_id')::int) || ':' || (j->>'periodo')
        WHEN (j->>'cuota_id') IS NOT NULL THEN 'gc:' || (SELECT sinc_uid FROM cuota_prestamo WHERE id = (j->>'cuota_id')::int)
        ELSE NULL END)
      ELSE NULL END;
    NEW.sinc_uid := coalesce(md5(det), replace(gen_random_uuid()::text, '-', ''));
  END IF;
  IF NEW.sinc_disp IS NULL THEN NEW.sinc_disp := (SELECT valor FROM sinc_estado WHERE clave = 'disp'); END IF;
  IF NEW.sinc_num IS NULL THEN NEW.sinc_num := nextval('sinc_contador'); END IF;
  IF NEW.sinc_creado IS NULL THEN NEW.sinc_creado := sinc_ahora(); END IF;
  NEW.sinc_tocado := sinc_ahora();
  DELETE FROM sinc_borrado WHERE tabla = TG_TABLE_NAME AND uid = NEW.sinc_uid;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "categoria_gasto_sinc_uid" ON "categoria_gasto" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "categoria_gasto_sinc" BEFORE INSERT OR UPDATE ON "categoria_gasto" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "categoria_gasto_sinc_lapida" AFTER DELETE ON "categoria_gasto" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "costo_fijo_sinc_uid" ON "costo_fijo" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "costo_fijo_sinc" BEFORE INSERT OR UPDATE ON "costo_fijo" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "costo_fijo_sinc_lapida" AFTER DELETE ON "costo_fijo" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
INSERT INTO "categoria_gasto" ("clave", "nombre", "tipo", "sistema", "orden") VALUES
  ('combustible', 'Combustible', 'variable', true, 1), ('peaje', 'Peajes', 'variable', true, 2),
  ('viaticos', 'Viáticos del chofer', 'variable', true, 3), ('hospedaje', 'Hospedaje', 'variable', true, 4),
  ('estiba', 'Estiba y desestiba', 'variable', true, 5), ('balanza', 'Balanza', 'variable', true, 6),
  ('cochera', 'Cochera en ruta', 'variable', true, 7), ('lavado', 'Lavado', 'variable', true, 8),
  ('llantas_ruta', 'Llantas en ruta', 'variable', true, 9), ('reparacion_ruta', 'Reparación en ruta', 'variable', true, 10),
  ('lubricantes', 'Lubricantes y engrase', 'variable', true, 11), ('resguardo', 'Resguardo o custodia', 'variable', true, 12),
  ('multas', 'Multas y papeletas', 'variable', true, 13), ('otros_viaje', 'Otros del viaje', 'variable', true, 14),
  ('cuota_prestamo', 'Cuota de leasing o préstamo', 'fijo', true, 20), ('soat', 'SOAT', 'fijo', true, 21),
  ('seguro', 'Seguro vehicular', 'fijo', true, 22), ('revision_tecnica', 'Revisión técnica', 'fijo', true, 23),
  ('gps', 'GPS y monitoreo', 'fijo', true, 24), ('sueldo_chofer', 'Sueldo del chofer', 'fijo', true, 25),
  ('sueldo_admin', 'Sueldos administrativos', 'fijo', true, 26), ('contador', 'Contador', 'fijo', true, 27),
  ('local', 'Local, oficina o cochera mensual', 'fijo', true, 28), ('permisos_mtc', 'Permisos MTC', 'fijo', true, 29),
  ('telefonia', 'Teléfono e internet', 'fijo', true, 30), ('mantenimiento', 'Mantenimiento preventivo', 'fijo', true, 31),
  ('otros_fijos', 'Otros fijos', 'fijo', true, 32);
--> statement-breakpoint
UPDATE "gasto" SET "categoria" = 'reparacion_ruta' WHERE "categoria" = 'reparacion';
--> statement-breakpoint
UPDATE "gasto" SET "categoria" = 'otros_viaje' WHERE "categoria" = 'otros';
--> statement-breakpoint
UPDATE "ruta_presupuesto" SET "categoria" = CASE "categoria" WHEN 'reparacion' THEN 'reparacion_ruta' WHEN 'otros' THEN 'otros_viaje' ELSE "categoria" END;
--> statement-breakpoint
UPDATE "viaje_presupuesto" SET "categoria" = CASE "categoria" WHEN 'reparacion' THEN 'reparacion_ruta' WHEN 'otros' THEN 'otros_viaje' ELSE "categoria" END;
--> statement-breakpoint
-- Los cambios preventivos de Reparaciones son mantenimiento (fijo).
UPDATE "gasto" g SET "categoria" = 'mantenimiento' FROM "reparacion" r WHERE r."gasto_id" = g."id" AND r."tipo" = 'preventivo';
--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_categoria_fk" FOREIGN KEY ("categoria") REFERENCES "categoria_gasto"("clave");
--> statement-breakpoint
ALTER TABLE "ruta_presupuesto" ADD CONSTRAINT "ruta_presupuesto_categoria_fk" FOREIGN KEY ("categoria") REFERENCES "categoria_gasto"("clave");
--> statement-breakpoint
ALTER TABLE "viaje_presupuesto" ADD CONSTRAINT "viaje_presupuesto_categoria_fk" FOREIGN KEY ("categoria") REFERENCES "categoria_gasto"("clave");
--> statement-breakpoint
-- La guía de cada gasto antiguo, solo si su viaje tiene una única guía.
UPDATE "gasto" g SET "guia_id" = x."guia_id" FROM (
  SELECT "viaje_id", min("id") AS "guia_id" FROM "guia_transportista" WHERE "viaje_id" IS NOT NULL GROUP BY "viaje_id" HAVING count(*) = 1
) x WHERE g."viaje_id" = x."viaje_id";
--> statement-breakpoint
-- Desde cuándo se marcan los viajes sin guía en «Por revisar» (los antiguos no).
INSERT INTO "ajuste" ("clave", "valor") VALUES ('viajes_sin_guia_desde', to_jsonb(now()::text)) ON CONFLICT ("clave") DO NOTHING;
```

Verificar que el snapshot generado nombra igual las restricciones (`gasto_fijo_periodo`, `gasto_cuota`) y las claves foráneas. Si drizzle-kit usó otros nombres para las FK de `categoria`, cambiar los nombres del SQL de arriba para que coincidan con el snapshot.

- [ ] **Step 5: Registrar las tablas nuevas en la sincronización**

En `packages/core/src/sincro/registro.ts`, dentro de `TABLAS`:
- insertar `{ nombre: "categoria_gasto" },` antes de `{ nombre: "ruta" },`, porque las plantillas la referencian;
- insertar `{ nombre: "costo_fijo" },` justo antes de `{ nombre: "gasto", … }`;
- mover `{ nombre: "prestamo" }` y `{ nombre: "cuota_prestamo" }` antes de `gasto`, porque ahora `gasto.cuota_id` apunta a `cuota_prestamo`.

- [ ] **Step 6: Correr las pruebas de la base y de la sincronización**

Run: `pnpm vitest run packages/db/test/db.test.ts packages/core/test/sincro.test.ts`
Expected: PASS. Si `sincro.test.ts` enumera tablas esperadas, agregar `categoria_gasto` y `costo_fijo` a esa lista.

- [ ] **Step 7: Commit**

```bash
git add packages/db packages/core/src/sincro/registro.ts packages/core/test/sincro.test.ts
git commit -m "feat(db): categorías como tabla (fijo/variable), costos fijos y datos automáticos del gasto"
```

---

### Task 2: Núcleo — módulo de categorías y reemplazo de la lista fija

**Files:**
- Create: `packages/core/src/finanzas/categorias.ts`
- Modify:
  - `packages/core/src/finanzas/finanzas.ts:1-35,74,108,127-134`;
  - `packages/core/src/viajes/liquidacion.ts:1-3,95-100`;
  - `packages/core/src/viajes/rutas.ts:1,18,47`;
  - `packages/core/src/rentabilidad/rentabilidad.ts:184,236-240`;
  - `packages/core/src/viajes/estadisticas.ts:70`;
  - `packages/core/src/reparaciones/reparaciones.ts:124`;
  - `packages/core/src/lecturas/lecturas.ts:313`;
  - `packages/core/src/index.ts`
- Test: `packages/core/test/categorias.test.ts` (nuevo)

**Interfaces:**
- Consumes: tabla `categoriaGasto` (Task 1).
- Produces (desde `packages/core/src/finanzas/categorias.ts`, reexportado en `index.ts`):
  - `interface Categoria { clave: string; nombre: string; tipo: "fijo" | "variable"; sistema: boolean; activa: boolean; orden: number }`
  - `listarCategorias(ctx, o?: { tipo?: "fijo" | "variable"; soloActivas?: boolean }): Promise<Categoria[]>`
  - `crearCategoria(ctx, e: { nombre: string; tipo: "fijo" | "variable"; usuarioId?: number }): Promise<string>`: devuelve la clave.
  - `desactivarCategoria(ctx, clave: string, usuarioId?: number): Promise<void>`
  - `categoriaValida(db: Ejecutor, clave: string): Promise<Categoria>`: lanza `ErrorNegocio` si no existe o está inactiva.
  - `nombreCategoria(clave: string, lista?: Categoria[]): string`
  - `categoriaDesdeTexto(texto: string): string | null`: se muda aquí desde finanzas.
  - constantes `CATEGORIAS_SISTEMA` y `NOMBRE_CATEGORIA: Record<string, string>`.
- Se **eliminan** `CATEGORIAS_GASTO` (así el compilador marca cada uso que falta cambiar) y `categoriaGastoEnum`.

- [ ] **Step 1: Test que falla**

`packages/core/test/categorias.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categoriaDesdeTexto, crearCategoria, desactivarCategoria, listarCategorias, nombreCategoria, registrarGasto, type Contexto } from "../src/index";
import { crearContextoPrueba } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

describe("categorías de gasto", () => {
  it("lista las de fábrica por orden y filtra por tipo", async () => {
    const todas = await listarCategorias(ctx);
    expect(todas[0]!.clave).toBe("combustible");
    expect((await listarCategorias(ctx, { tipo: "fijo" })).every((c) => c.tipo === "fijo")).toBe(true);
  });

  it("crea una propia con clave desde el nombre, sin repetir", async () => {
    const clave = await crearCategoria(ctx, { nombre: "Guardianía de carga", tipo: "variable" });
    expect(clave).toBe("guardiania_de_carga");
    await expect(crearCategoria(ctx, { nombre: "Guardianía de carga", tipo: "fijo" })).rejects.toThrow(/ya existe/);
    const c = (await listarCategorias(ctx)).find((x) => x.clave === clave)!;
    expect(c).toMatchObject({ sistema: false, tipo: "variable", nombre: "Guardianía de carga" });
    expect(nombreCategoria(clave, [c])).toBe("Guardianía de carga");
  });

  it("una desactivada no se ofrece ni acepta gastos nuevos", async () => {
    const clave = await crearCategoria(ctx, { nombre: "Propinas", tipo: "variable" });
    await desactivarCategoria(ctx, clave);
    expect((await listarCategorias(ctx, { soloActivas: true })).some((c) => c.clave === clave)).toBe(false);
    await expect(registrarGasto(ctx, { categoria: clave, monto: 1000, origen: "web" })).rejects.toThrow(/no está activa/);
  });

  it("entiende sinónimos del rubro", () => {
    expect(categoriaDesdeTexto("grifo")).toBe("combustible");
    expect(categoriaDesdeTexto("vulcanizado")).toBe("llantas_ruta");
    expect(categoriaDesdeTexto("mecanico")).toBe("reparacion_ruta");
    expect(categoriaDesdeTexto("papeleta")).toBe("multas");
    expect(categoriaDesdeTexto("xyz")).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm vitest run packages/core/test/categorias.test.ts`
Expected: FAIL — `listarCategorias` no existe.

- [ ] **Step 3: Crear `packages/core/src/finanzas/categorias.ts`**

```ts
import { and, asc, categoriaGasto, eq, type Ejecutor, type TipoCategoria } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

export interface Categoria { clave: string; nombre: string; tipo: TipoCategoria; sistema: boolean; activa: boolean; orden: number }

/** Las de fábrica (la migración 0012 las siembra con estos mismos datos). */
export const CATEGORIAS_SISTEMA: ReadonlyArray<{ clave: string; nombre: string; tipo: TipoCategoria }> = [
  { clave: "combustible", nombre: "Combustible", tipo: "variable" }, { clave: "peaje", nombre: "Peajes", tipo: "variable" },
  { clave: "viaticos", nombre: "Viáticos del chofer", tipo: "variable" }, { clave: "hospedaje", nombre: "Hospedaje", tipo: "variable" },
  { clave: "estiba", nombre: "Estiba y desestiba", tipo: "variable" }, { clave: "balanza", nombre: "Balanza", tipo: "variable" },
  { clave: "cochera", nombre: "Cochera en ruta", tipo: "variable" }, { clave: "lavado", nombre: "Lavado", tipo: "variable" },
  { clave: "llantas_ruta", nombre: "Llantas en ruta", tipo: "variable" }, { clave: "reparacion_ruta", nombre: "Reparación en ruta", tipo: "variable" },
  { clave: "lubricantes", nombre: "Lubricantes y engrase", tipo: "variable" }, { clave: "resguardo", nombre: "Resguardo o custodia", tipo: "variable" },
  { clave: "multas", nombre: "Multas y papeletas", tipo: "variable" }, { clave: "otros_viaje", nombre: "Otros del viaje", tipo: "variable" },
  { clave: "cuota_prestamo", nombre: "Cuota de leasing o préstamo", tipo: "fijo" }, { clave: "soat", nombre: "SOAT", tipo: "fijo" },
  { clave: "seguro", nombre: "Seguro vehicular", tipo: "fijo" }, { clave: "revision_tecnica", nombre: "Revisión técnica", tipo: "fijo" },
  { clave: "gps", nombre: "GPS y monitoreo", tipo: "fijo" }, { clave: "sueldo_chofer", nombre: "Sueldo del chofer", tipo: "fijo" },
  { clave: "sueldo_admin", nombre: "Sueldos administrativos", tipo: "fijo" }, { clave: "contador", nombre: "Contador", tipo: "fijo" },
  { clave: "local", nombre: "Local, oficina o cochera mensual", tipo: "fijo" }, { clave: "permisos_mtc", nombre: "Permisos MTC", tipo: "fijo" },
  { clave: "telefonia", nombre: "Teléfono e internet", tipo: "fijo" }, { clave: "mantenimiento", nombre: "Mantenimiento preventivo", tipo: "fijo" },
  { clave: "otros_fijos", nombre: "Otros fijos", tipo: "fijo" },
];

export const NOMBRE_CATEGORIA: Record<string, string> = Object.fromEntries(CATEGORIAS_SISTEMA.map((c) => [c.clave, c.nombre]));

const sinTildes = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** Nombre para mostrar; las propias se buscan en `lista` (si no se pasa, se humaniza la clave). */
export function nombreCategoria(clave: string, lista?: Categoria[]): string {
  return lista?.find((c) => c.clave === clave)?.nombre ?? NOMBRE_CATEGORIA[clave] ?? (clave.charAt(0).toUpperCase() + clave.slice(1).replace(/_/g, " "));
}

export async function listarCategorias(ctx: Contexto, o: { tipo?: TipoCategoria; soloActivas?: boolean } = {}): Promise<Categoria[]> {
  const filtros = [];
  if (o.tipo) filtros.push(eq(categoriaGasto.tipo, o.tipo));
  if (o.soloActivas) filtros.push(eq(categoriaGasto.activa, true));
  return ctx.db.select({
    clave: categoriaGasto.clave, nombre: categoriaGasto.nombre, tipo: categoriaGasto.tipo, sistema: categoriaGasto.sistema,
    activa: categoriaGasto.activa, orden: categoriaGasto.orden,
  }).from(categoriaGasto).where(filtros.length ? and(...filtros) : undefined).orderBy(asc(categoriaGasto.orden), asc(categoriaGasto.nombre));
}

export async function categoriaValida(db: Ejecutor, clave: string): Promise<Categoria> {
  const [c] = await db.select().from(categoriaGasto).where(eq(categoriaGasto.clave, clave));
  if (!c) throw new ErrorNegocio("Categoría de gasto no válida");
  if (!c.activa) throw new ErrorNegocio(`La categoría «${c.nombre}» no está activa`);
  return { clave: c.clave, nombre: c.nombre, tipo: c.tipo, sistema: c.sistema, activa: c.activa, orden: c.orden };
}

export async function crearCategoria(ctx: Contexto, e: { nombre: string; tipo: TipoCategoria; usuarioId?: number }): Promise<string> {
  const nombre = e.nombre.trim().replace(/\s+/g, " ");
  if (nombre.length < 3) throw new ErrorNegocio("El nombre de la categoría es muy corto");
  const clave = sinTildes(nombre).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const [existe] = await ctx.db.select({ clave: categoriaGasto.clave }).from(categoriaGasto).where(eq(categoriaGasto.clave, clave));
  if (existe) throw new ErrorNegocio(`La categoría «${nombre}» ya existe`);
  await ctx.db.insert(categoriaGasto).values({ clave, nombre, tipo: e.tipo, sistema: false, activa: true, orden: 100 });
  await registrarAuditoria(ctx.db, { usuarioId: e.usuarioId, accion: "categoria_creada", entidad: "categoria_gasto", entidadId: clave, detalle: e });
  return clave;
}

export async function desactivarCategoria(ctx: Contexto, clave: string, usuarioId?: number): Promise<void> {
  const [f] = await ctx.db.update(categoriaGasto).set({ activa: false }).where(eq(categoriaGasto.clave, clave)).returning({ clave: categoriaGasto.clave });
  if (!f) throw new ErrorNegocio("La categoría no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "categoria_desactivada", entidad: "categoria_gasto", entidadId: clave });
}

const SINONIMOS: Array<[RegExp, string]> = [
  [/^(combustible|petroleo|petróleo|diesel|diésel|gasolina|grifo|gas)/i, "combustible"],
  [/^(peaje|peajes)/i, "peaje"],
  [/^(viatico|viático|viaticos|viáticos|comida|alimentos?|menu|menú)/i, "viaticos"],
  [/^(hospedaje|hotel|alojamiento)/i, "hospedaje"],
  [/^(estiba|descarga|carga)/i, "estiba"],
  [/^(balanza|pesaje)/i, "balanza"],
  [/^(cochera|parqueo|estacionamiento)/i, "cochera"],
  [/^(lavado|lavada)/i, "lavado"],
  [/^(llanta|llantas|parche|vulcaniz)/i, "llantas_ruta"],
  [/^(aceite|engrase|grasa|lubricante)/i, "lubricantes"],
  [/^(custodia|resguardo|guardian)/i, "resguardo"],
  [/^(multa|papeleta)/i, "multas"],
  [/^(reparacion|reparación|repuesto|mecanico|mecánico|taller|auxilio)/i, "reparacion_ruta"],
  [/^(otro|otros|varios)/i, "otros_viaje"],
];

export function categoriaDesdeTexto(texto: string): string | null {
  const t = texto.trim();
  for (const [re, c] of SINONIMOS) if (re.test(t)) return c;
  return null;
}
```

- [ ] **Step 4: Adaptar `finanzas.ts`**

- Borrar `CATEGORIAS_GASTO`, `NOMBRE_CATEGORIA`, `SINONIMOS` y `categoriaDesdeTexto` (líneas 12-35) y quitar `categoriaGastoEnum` del import.
- Agregar `import { categoriaValida, NOMBRE_CATEGORIA, nombreCategoria } from "./categorias";`.
- En `registrarGasto` y `editarGasto`, cambiar `if (!CATEGORIAS_GASTO.includes(e.categoria)) throw …` por `await categoriaValida(ctx.db, e.categoria);`. En `editarGasto` hacerlo solo si `e.categoria !== undefined`.
- En `gastosPorCategoria`, `nombre: NOMBRE_CATEGORIA[f.categoria]` pasa a `nombre: nombreCategoria(f.categoria)`.
- En `listarMovimientos`, `NOMBRE_CATEGORIA[g.categoria]` pasa a `nombreCategoria(g.categoria)`.

- [ ] **Step 5: Adaptar el resto del núcleo**

- `viajes/liquidacion.ts`:
  - importar `listarCategorias` y `nombreCategoria` desde `../finanzas/categorias`;
  - en `liquidacionViaje`, antes de armar `lineas`, agregar `const variables = await listarCategorias(ctx, { tipo: "variable" });`;
  - reemplazar `CATEGORIAS_GASTO` por `variables.map((c) => c.clave)` y `NOMBRE_CATEGORIA[c]` por `nombreCategoria(c, variables)`.
- `viajes/rutas.ts`:
  - quitar `categoriaGastoEnum` del import;
  - cambiar `const ORDEN_CATEGORIAS = categoriaGastoEnum.enumValues;` por `const ORDEN_CATEGORIAS = CATEGORIAS_SISTEMA.map((c) => c.clave);`, importado de `../finanzas/categorias`;
  - en el `sort`, las claves propias (índice -1) van al final: usar `(i: number) => (i < 0 ? 999 : i)` en ambos lados.
- `rentabilidad/rentabilidad.ts:184`: `sql\`${gasto.categoria} <> 'reparacion'\`` pasa a `sql\`${gasto.categoria} not in ('reparacion_ruta', 'mantenimiento')\``. En las líneas 236-240, `NOMBRE_CATEGORIA[c]` pasa a `nombreCategoria(c)`.
- `viajes/estadisticas.ts:70`: `NOMBRE_CATEGORIA[x.categoria]` pasa a `x.nombre`.
- `reparaciones/reparaciones.ts:124`: `categoria: "reparacion"` pasa a `categoria: e.tipo === "preventivo" ? "mantenimiento" : "reparacion_ruta"`.
- `lecturas/lecturas.ts:313`: `ne(gasto.categoria, "reparacion")` pasa a `notInArray(gasto.categoria, ["reparacion_ruta", "mantenimiento"])`. Agregar `notInArray` a los reexports de `packages/db/src/index.ts`.
- `index.ts`: agregar `export * from "./finanzas/categorias";`.

- [ ] **Step 6: Compilar y correr la suite del núcleo**

Run: `pnpm -r exec tsc --noEmit`
Expected: errores solo en `apps/web`, `apps/bot`, `packages/ia` y `scripts/demo-flota.ts`, que usan `CATEGORIAS_GASTO` o las claves viejas; se arreglan en las Tareas 7 a 10 y 12. En `packages/core/src` no debe quedar ninguno.

Run: `pnpm vitest run packages/core`
Expected: PASS. Las pruebas que usaban la categoría `"reparacion"` u `"otros"` deben usar `"reparacion_ruta"` y `"otros_viaje"`: buscarlas con `grep -rn '"reparacion"\|"otros"' packages/core/test` y cambiarlas.

- [ ] **Step 7: Commit**

```bash
git add packages/core packages/db/src/index.ts
git commit -m "feat(core): categorías del rubro con tipo fijo/variable y categorías propias"
```

---

### Task 3: Núcleo — el gasto captura solo guía, forma de pago y km

**Files:**
- Create: `packages/core/src/finanzas/captura.ts`
- Modify: `packages/core/src/finanzas/finanzas.ts` (`EntradaGasto`, `registrarGasto`), `packages/core/src/index.ts`
- Test: `packages/core/test/captura.test.ts` (nuevo)

**Interfaces:**
- Consumes: `categoriaValida` (Task 2), `registrarLecturaOdometro` (`flota/unidades.ts:194`).
- Produces:
  - `type MedioPago = "efectivo_chofer" | "efectivo" | "yape_plin" | "transferencia" | "tarjeta" | "credito"` (reexport de db)
  - `NOMBRE_MEDIO_PAGO: Record<MedioPago, string>`
  - `interface ContextoGasto { vehiculoId: number | null; unidad: string | null; viajeId: number | null; viajeCodigo: string | null; guiaId: number | null; guia: string | null; tramo: "ida" | "retorno" | null; km: number | null; medioPago: MedioPago }`
  - `capturarContexto(ctx, o: { usuarioId?: number; vehiculoId?: number | null; viajeId?: number | null }): Promise<ContextoGasto>`
  - `describirContexto(c: ContextoGasto): string`, que devuelve algo como «T-02 · VJ-0129 (guía V001-12, ida) · efectivo del chofer · 402,380 km».
  - `EntradaGasto` agrega: `medioPago?: MedioPago; kmVehiculo?: number | null; guiaId?: number | null; costoFijoId?: number | null; cuotaId?: number | null; periodo?: string | null`.
  - `registrarGasto` devuelve `{ id: number; viajeCodigo: string | null; contexto: ContextoGasto; kmReal: boolean; avisoKm: string | null }`.

- [ ] **Step 1: Test que falla**

`packages/core/test/captura.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  capturarContexto, describirContexto, enlazarGuia, obtenerGasto, obtenerUnidad, registrarGasto, registrarGuiaBorrador, registrarViajeFlota,
  guardarUsuario, type Contexto,
} from "../src/index";
import { crearContextoPrueba, entradaGuia } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

describe("captura automática del gasto", () => {
  it("sin viaje: unidad indicada, km actual y transferencia", async () => {
    const c = await capturarContexto(ctx, { vehiculoId: 1 });
    expect(c).toMatchObject({ vehiculoId: 1, viajeId: null, guiaId: null, medioPago: "transferencia" });
    expect(c.km).toBe((await obtenerUnidad(ctx, 1))!.odometroKm);
  });

  it("con viaje en curso: toma el viaje, la guía del tramo actual y efectivo del chofer", async () => {
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
    // registrarGuiaBorrador ya enlaza sola (Task 5); si esta tarea corre antes, se enlaza a mano:
    const ida = await registrarGuiaBorrador(ctx, entradaGuia());
    await enlazarGuia(ctx, ida, v.id, "ida").catch(() => {});
    let c = await capturarContexto(ctx, { vehiculoId: 1 });
    expect(c).toMatchObject({ viajeId: v.id, guiaId: ida, tramo: "ida", medioPago: "efectivo_chofer" });
    const ret = await registrarGuiaBorrador(ctx, { ...entradaGuia(), greRemitenteRef: "EG01-999" });
    await enlazarGuia(ctx, ret, v.id, "retorno").catch(() => {});
    c = await capturarContexto(ctx, { vehiculoId: 1 });
    expect(c).toMatchObject({ guiaId: ret, tramo: "retorno" });
    expect(describirContexto(c)).toMatch(/VJ-\d{4} \(guía .+, retorno\) · efectivo del chofer · [\d,]+ km/);
  });

  it("sin unidad: la deduce del viaje en curso del chofer que escribe", async () => {
    await guardarUsuario(ctx, { id: 1, nombre: "Chofer", email: "c@demo.pe", rol: "dueno", clave: "clave-segura", conductorId: 1 });
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Puno", estado: "en_curso", origen: "web", conductorId: 1 });
    expect((await capturarContexto(ctx, { usuarioId: 1 })).viajeId).toBe(v.id);
  });

  it("el gasto guarda solo guía, medio, km y el km real del voucher actualiza el odómetro", async () => {
    const u = (await obtenerUnidad(ctx, 1))!;
    await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
    const r = await registrarGasto(ctx, { categoria: "combustible", monto: 48000, vehiculoId: 1, kmVehiculo: u.odometroKm + 350, origen: "telegram" });
    expect(r).toMatchObject({ kmReal: true, avisoKm: null });
    const g = (await obtenerGasto(ctx, r.id))!;
    expect(g).toMatchObject({ medioPago: "efectivo_chofer", kmVehiculo: u.odometroKm + 350, kmReal: true });
    expect((await obtenerUnidad(ctx, 1))!.odometroKm).toBe(u.odometroKm + 350);
  });

  it("km inválido: guarda igual con el último km y avisa", async () => {
    const u = (await obtenerUnidad(ctx, 1))!;
    const r = await registrarGasto(ctx, { categoria: "combustible", monto: 30000, vehiculoId: 1, kmVehiculo: u.odometroKm + 50000, origen: "telegram" });
    expect(r.kmReal).toBe(false);
    expect(r.avisoKm).toMatch(/de golpe/);
    expect((await obtenerGasto(ctx, r.id))!.kmVehiculo).toBe(u.odometroKm);
  });

  it("respeta la forma de pago indicada", async () => {
    const r = await registrarGasto(ctx, { categoria: "peaje", monto: 2800, vehiculoId: 1, medioPago: "tarjeta", origen: "web" });
    expect((await obtenerGasto(ctx, r.id))!.medioPago).toBe("tarjeta");
  });
});
```

Revisar la firma de `guardarUsuario` (`packages/core/src/usuarios/usuarios.ts`). Si no acepta `conductorId`, asignarlo con `ctx.db.update(usuario).set({ conductorId: 1 }).where(eq(usuario.id, 1))`, importando `usuario`, `eq` desde `@sunatapp/db`.

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm vitest run packages/core/test/captura.test.ts`
Expected: FAIL — `capturarContexto` no existe.

- [ ] **Step 3: Crear `packages/core/src/finanzas/captura.ts`**

```ts
import { and, desc, eq, guiaTransportista, usuario, vehiculo, viaje, type MedioPago } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";

export type { MedioPago } from "@sunatapp/db";

export const NOMBRE_MEDIO_PAGO: Record<MedioPago, string> = {
  efectivo_chofer: "efectivo del chofer", efectivo: "efectivo de oficina", yape_plin: "Yape/Plin",
  transferencia: "transferencia", tarjeta: "tarjeta", credito: "crédito",
};

export interface ContextoGasto {
  vehiculoId: number | null;
  unidad: string | null;
  viajeId: number | null;
  viajeCodigo: string | null;
  guiaId: number | null;
  guia: string | null;
  tramo: "ida" | "retorno" | null;
  km: number | null;
  medioPago: MedioPago;
}

/**
 * Lo que un gasto sabe solo, en el momento en que se registra: la unidad (la indicada, la del viaje
 * o la del viaje en curso del chofer que escribe), su viaje en curso, la guía del tramo actual
 * (retorno si ya existe, si no ida), el último km conocido y la forma de pago por defecto.
 */
export async function capturarContexto(ctx: Contexto, o: { usuarioId?: number; vehiculoId?: number | null; viajeId?: number | null }): Promise<ContextoGasto> {
  let vj: { id: number; codigo: string; vehiculoId: number } | undefined;
  if (o.viajeId) {
    [vj] = await ctx.db.select({ id: viaje.id, codigo: viaje.codigo, vehiculoId: viaje.vehiculoId }).from(viaje).where(eq(viaje.id, o.viajeId));
  } else if (o.vehiculoId) {
    [vj] = await ctx.db.select({ id: viaje.id, codigo: viaje.codigo, vehiculoId: viaje.vehiculoId }).from(viaje)
      .where(and(eq(viaje.vehiculoId, o.vehiculoId), eq(viaje.estado, "en_curso"))).orderBy(desc(viaje.id)).limit(1);
  } else if (o.usuarioId) {
    const [u] = await ctx.db.select({ conductorId: usuario.conductorId }).from(usuario).where(eq(usuario.id, o.usuarioId));
    if (u?.conductorId) {
      [vj] = await ctx.db.select({ id: viaje.id, codigo: viaje.codigo, vehiculoId: viaje.vehiculoId }).from(viaje)
        .where(and(eq(viaje.conductorId, u.conductorId), eq(viaje.estado, "en_curso"))).orderBy(desc(viaje.id)).limit(1);
    }
  }
  const vehiculoId = vj?.vehiculoId ?? o.vehiculoId ?? null;
  const [v] = vehiculoId ? await ctx.db.select({ codigo: vehiculo.codigo, placa: vehiculo.placa, km: vehiculo.odometroKm }).from(vehiculo).where(eq(vehiculo.id, vehiculoId)) : [];
  let guiaId: number | null = null, guia: string | null = null, tramo: "ida" | "retorno" | null = null;
  if (vj) {
    const gs = await ctx.db.select({ id: guiaTransportista.id, serie: guiaTransportista.serie, numero: guiaTransportista.numero, tramo: guiaTransportista.tramo })
      .from(guiaTransportista).where(eq(guiaTransportista.viajeId, vj.id));
    const g = gs.find((x) => x.tramo === "retorno") ?? gs.find((x) => x.tramo === "ida") ?? null;
    if (g) {
      guiaId = g.id;
      guia = `${g.serie}-${g.numero ?? "?"}`;
      tramo = g.tramo;
    }
  }
  return {
    vehiculoId, unidad: v ? (v.codigo ?? v.placa) : null, viajeId: vj?.id ?? null, viajeCodigo: vj?.codigo ?? null,
    guiaId, guia, tramo, km: v?.km ?? null, medioPago: vj ? "efectivo_chofer" : "transferencia",
  };
}

export function describirContexto(c: ContextoGasto): string {
  return [
    c.unidad,
    c.viajeCodigo ? `${c.viajeCodigo}${c.guia ? ` (guía ${c.guia}, ${c.tramo})` : " (sin guía)"}` : "sin viaje",
    NOMBRE_MEDIO_PAGO[c.medioPago],
    c.km !== null ? `${c.km.toLocaleString("en-US")} km` : null,
  ].filter(Boolean).join(" · ");
}
```

- [ ] **Step 4: Cambiar `registrarGasto` en `finanzas.ts`**

Agregar a `EntradaGasto`:

```ts
  /** Si no se indica: efectivo del chofer con viaje en curso; transferencia sin viaje. */
  medioPago?: MedioPago;
  /** Km leído del voucher o dado por el chofer (real). Sin él se guarda el último conocido. */
  kmVehiculo?: number | null;
  guiaId?: number | null;
  costoFijoId?: number | null;
  cuotaId?: number | null;
  periodo?: string | null;
```

Reemplazar el cuerpo de `registrarGasto` desde `let vehiculoId = …` hasta el `return`:

```ts
  await categoriaValida(ctx.db, e.categoria);
  // Los fijos (costoFijoId/cuotaId) no toman viaje: son del mes.
  const esFijoGenerado = e.costoFijoId != null || e.cuotaId != null;
  const c = esFijoGenerado
    ? { vehiculoId: e.vehiculoId ?? null, unidad: null, viajeId: null, viajeCodigo: null, guiaId: null, guia: null, tramo: null, km: null, medioPago: "transferencia" as const }
    : await capturarContexto(ctx, { usuarioId: e.usuarioId, vehiculoId: e.vehiculoId, viajeId: e.viajeId });
  if (e.viajeId != null && c.viajeId === null) throw new ErrorNegocio("El viaje no existe");
  let km = c.km, kmReal = false, avisoKm: string | null = null;
  if (e.kmVehiculo != null && c.vehiculoId !== null) {
    try {
      if (e.kmVehiculo > (c.km ?? 0)) await registrarLecturaOdometro(ctx, { vehiculoId: c.vehiculoId, km: e.kmVehiculo, origen: e.origen, usuarioId: e.usuarioId, viajeId: c.viajeId ?? undefined });
      else if (e.kmVehiculo < (c.km ?? 0)) throw new ErrorNegocio(`el odómetro ya marca ${(c.km ?? 0).toLocaleString("en-US")} km`);
      km = e.kmVehiculo;
      kmReal = true;
    } catch (error) {
      if (!(error instanceof ErrorNegocio)) throw error;
      avisoKm = `No usé ese km (${error.message}); quedó el último conocido.`;
    }
  }
  const [g] = await ctx.db.insert(gasto).values({
    categoria: e.categoria, monto: e.monto, fecha: e.fecha ?? hoy(ctx), vehiculoId: c.vehiculoId, viajeId: c.viajeId, nota: e.nota ?? null,
    proveedorNombre: e.proveedorNombre ?? null, proveedorRuc: e.proveedorRuc ?? null, comprobante: e.comprobante ?? null, rutaFoto: e.rutaFoto ?? null,
    documentoId: e.documentoId ?? null, origen: e.origen, usuarioId: e.usuarioId ?? null,
    guiaId: e.guiaId ?? c.guiaId, medioPago: e.medioPago ?? c.medioPago, kmVehiculo: km, kmReal,
    costoFijoId: e.costoFijoId ?? null, cuotaId: e.cuotaId ?? null, periodo: e.periodo ?? null,
  }).returning({ id: gasto.id });
  await registrarAuditoria(ctx.db, { usuarioId: e.usuarioId, accion: "gasto_registrado", entidad: "gasto", entidadId: g!.id, detalle: { ...e, contexto: c } });
  return { id: g!.id, viajeCodigo: c.viajeCodigo, contexto: c, kmReal, avisoKm };
```

Actualizar la firma de retorno a `Promise<{ id: number; viajeCodigo: string | null; contexto: ContextoGasto; kmReal: boolean; avisoKm: string | null }>`. Agregar a los imports:
- `capturarContexto`, `type ContextoGasto` desde `./captura`;
- `registrarLecturaOdometro` desde `../flota/unidades`;
- `type MedioPago` desde `@sunatapp/db`.

En `index.ts`, agregar `export * from "./finanzas/captura";`.

- [ ] **Step 5: Correr las pruebas**

Run: `pnpm vitest run packages/core/test/captura.test.ts packages/core/test/liquidacion.test.ts packages/core/test/flota.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): el gasto captura solo unidad, viaje, guía, forma de pago y km"
```

---

### Task 4: Núcleo — fijos recurrentes, cuotas y resumen con fijo/variable

**Files:**
- Create: `packages/core/src/finanzas/costos-fijos.ts`
- Modify: `packages/core/src/finanzas/finanzas.ts` (`resumenFinanciero`, `listarMovimientos`, `flujoCaja`), `packages/core/src/index.ts`, `apps/bot/src/app.ts` o donde se arman los `extras` de `crearTareaFondo`
- Test: `packages/core/test/costos-fijos.test.ts` (nuevo)

**Interfaces:**
- Consumes: `registrarGasto` con `costoFijoId`/`cuotaId`/`periodo` (Task 3), `categoriaValida` (Task 2).
- Produces:
  - `interface CostoFijo { id; concepto; categoria; monto; periodicidad: "mensual" | "anual"; vehiculoId: number | null; unidad: string | null; medioPago: MedioPago; desde: string; hasta: string | null; activo: boolean }`
  - `crearCostoFijo(ctx, e: { concepto: string; categoria: string; monto: number; periodicidad: "mensual" | "anual"; vehiculoId?: number | null; medioPago?: MedioPago; desde?: string; hasta?: string | null; usuarioId?: number }): Promise<number>`
  - `editarCostoFijo(ctx, id, cambios: Partial<{ concepto; monto; periodicidad; vehiculoId; medioPago; hasta; activo }>, usuarioId?): Promise<void>`
  - `listarCostosFijos(ctx, soloActivos = true): Promise<CostoFijo[]>`
  - `montoDelMes(monto: number, periodicidad: "mensual" | "anual", periodo: string): number`
  - `generarFijosDelMes(ctx, periodo: string): Promise<number>`: devuelve cuántos gastos creó.
  - `asegurarFijos(ctx, desde: string, hasta: string): Promise<void>`: genera cada mes del rango hasta el mes actual, nunca los futuros.
  - `ResumenFinanciero` agrega `gastosVariables: number; gastosFijos: number`.

- [ ] **Step 1: Test que falla**

`packages/core/test/costos-fijos.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asegurarFijos, crearCostoFijo, crearPrestamo, editarCostoFijo, flujoCaja, generarFijosDelMes, listarMovimientos, montoDelMes, pagarCuota,
  resumenFinanciero, type Contexto,
} from "../src/index";
import { gasto, eq } from "@sunatapp/db";
import { crearContextoPrueba } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
// Reloj: 2026-09-13 (helpers).
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

describe("costos fijos recurrentes", () => {
  it("anual = 1/12 por mes con el redondeo en diciembre", () => {
    expect(montoDelMes(120000, "mensual", "2026-03")).toBe(120000);
    expect(montoDelMes(100000, "anual", "2026-03")).toBe(8333);
    expect(montoDelMes(100000, "anual", "2026-12")).toBe(100000 - 8333 * 11);
  });

  it("genera el gasto del mes una sola vez, respetando la vigencia", async () => {
    const a = await crearCostoFijo(ctx, { concepto: "Sueldo chofer T-01", categoria: "sueldo_chofer", monto: 250000, periodicidad: "mensual", vehiculoId: 1, desde: "2026-08-15" });
    await crearCostoFijo(ctx, { concepto: "Contador", categoria: "contador", monto: 60000, periodicidad: "mensual", desde: "2026-01-01", hasta: "2026-08-31" });
    expect(await generarFijosDelMes(ctx, "2026-09")).toBe(1);
    expect(await generarFijosDelMes(ctx, "2026-09")).toBe(0);
    const gs = await ctx.db.select().from(gasto).where(eq(gasto.costoFijoId, a));
    expect(gs).toHaveLength(1);
    expect(gs[0]).toMatchObject({ fecha: "2026-09-01", periodo: "2026-09", vehiculoId: 1, medioPago: "transferencia", origen: "sistema" });
    expect(await generarFijosDelMes(ctx, "2026-07")).toBe(1); // solo el contador (el sueldo empieza en agosto)
  });

  it("rechaza una categoría variable para un fijo", async () => {
    await expect(crearCostoFijo(ctx, { concepto: "x", categoria: "combustible", monto: 1000, periodicidad: "mensual" })).rejects.toThrow(/fija/);
  });

  it("las cuotas de préstamo entran como fijo del mes en que vencen", async () => {
    await crearPrestamo(ctx, { entidad: "BCP", monto: 1200000, tasaAnual: 12, cuotas: 12, fechaInicio: "2026-08-10", vehiculoId: 1 });
    await generarFijosDelMes(ctx, "2026-09");
    const cuotas = await ctx.db.select().from(gasto).where(eq(gasto.categoria, "cuota_prestamo"));
    expect(cuotas).toHaveLength(1);
    expect(cuotas[0]).toMatchObject({ fecha: "2026-09-10", vehiculoId: 1, periodo: "2026-09" });
  });

  it("flujo sin doble conteo: la cuota pagada sale una sola vez en caja y en movimientos", async () => {
    const p = await crearPrestamo(ctx, { entidad: "BCP", monto: 1200000, tasaAnual: 0, cuotas: 12, fechaInicio: "2026-08-10" });
    await generarFijosDelMes(ctx, "2026-09");
    await pagarCuota(ctx, p, "2026-09-10");
    const semanas = await flujoCaja(ctx, 4);
    expect(semanas.reduce((s, x) => s + x.sale, 0)).toBe(100000);
    const movs = await listarMovimientos(ctx, "2026-09-01", "2026-09-30");
    expect(movs.filter((m) => m.monto === -100000)).toHaveLength(1);
  });

  it("el resumen separa fijo y variable y resta ambos", async () => {
    await crearCostoFijo(ctx, { concepto: "GPS", categoria: "gps", monto: 9000, periodicidad: "mensual", desde: "2026-01-01" });
    const { registrarGasto } = await import("../src/index");
    await registrarGasto(ctx, { categoria: "peaje", monto: 2000, vehiculoId: 1, fecha: "2026-09-05", origen: "web" });
    const r = await resumenFinanciero(ctx, "2026-09-01", "2026-09-30");
    expect([r.gastosVariables, r.gastosFijos, r.gastos]).toEqual([2000, 9000, 11000]);
  });

  it("no genera meses futuros y la edición cambia el monto de los meses que vienen", async () => {
    const id = await crearCostoFijo(ctx, { concepto: "GPS", categoria: "gps", monto: 9000, periodicidad: "mensual", desde: "2026-01-01" });
    await asegurarFijos(ctx, "2026-09-01", "2026-12-31");
    expect(await ctx.db.select().from(gasto).where(eq(gasto.costoFijoId, id))).toHaveLength(1);
    await editarCostoFijo(ctx, id, { monto: 12000 });
    expect(await generarFijosDelMes(ctx, "2026-10")).toBe(1);
    const [oct] = await ctx.db.select().from(gasto).where(eq(gasto.periodo, "2026-10"));
    expect(oct!.monto).toBe(12000);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm vitest run packages/core/test/costos-fijos.test.ts`
Expected: FAIL — `crearCostoFijo` no existe.

- [ ] **Step 3: Crear `packages/core/src/finanzas/costos-fijos.ts`**

```ts
import { and, costoFijo, cuotaPrestamo, eq, gasto, isNull, lte, or, gte, prestamo, vehiculo, type MedioPago, type Periodicidad } from "@sunatapp/db";
import { rangoMes } from "../dominio/fechas";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { hoy } from "../flota/unidades";
import { categoriaValida } from "./categorias";

export interface CostoFijo {
  id: number; concepto: string; categoria: string; monto: number; periodicidad: Periodicidad; vehiculoId: number | null; unidad: string | null;
  medioPago: MedioPago; desde: string; hasta: string | null; activo: boolean;
}

export function montoDelMes(monto: number, periodicidad: Periodicidad, periodo: string): number {
  if (periodicidad === "mensual") return monto;
  const base = Math.floor(monto / 12);
  return periodo.endsWith("-12") ? monto - base * 11 : base;
}

export async function crearCostoFijo(
  ctx: Contexto,
  e: { concepto: string; categoria: string; monto: number; periodicidad: Periodicidad; vehiculoId?: number | null; medioPago?: MedioPago; desde?: string; hasta?: string | null; usuarioId?: number },
): Promise<number> {
  if (!e.concepto.trim()) throw new ErrorNegocio("Falta el concepto");
  if (!Number.isInteger(e.monto) || e.monto <= 0) throw new ErrorNegocio("El monto debe ser mayor que 0");
  const cat = await categoriaValida(ctx.db, e.categoria);
  if (cat.tipo !== "fijo") throw new ErrorNegocio(`«${cat.nombre}» no es una categoría fija`);
  const desde = e.desde ?? `${hoy(ctx).slice(0, 7)}-01`;
  if (e.hasta && e.hasta < desde) throw new ErrorNegocio("La fecha de fin no puede ser anterior al inicio");
  const [f] = await ctx.db.insert(costoFijo).values({
    concepto: e.concepto.trim(), categoria: e.categoria, monto: e.monto, periodicidad: e.periodicidad, vehiculoId: e.vehiculoId ?? null,
    medioPago: e.medioPago ?? "transferencia", desde, hasta: e.hasta ?? null, usuarioId: e.usuarioId ?? null,
  }).returning({ id: costoFijo.id });
  await registrarAuditoria(ctx.db, { usuarioId: e.usuarioId, accion: "costo_fijo_creado", entidad: "costo_fijo", entidadId: f!.id, detalle: e });
  return f!.id;
}

export async function editarCostoFijo(
  ctx: Contexto, id: number,
  cambios: Partial<{ concepto: string; monto: number; periodicidad: Periodicidad; vehiculoId: number | null; medioPago: MedioPago; hasta: string | null; activo: boolean }>,
  usuarioId?: number,
): Promise<void> {
  if (cambios.monto !== undefined && (!Number.isInteger(cambios.monto) || cambios.monto <= 0)) throw new ErrorNegocio("El monto debe ser mayor que 0");
  const [f] = await ctx.db.update(costoFijo).set(cambios).where(eq(costoFijo.id, id)).returning({ id: costoFijo.id });
  if (!f) throw new ErrorNegocio("El costo fijo no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "costo_fijo_editado", entidad: "costo_fijo", entidadId: id, detalle: cambios });
}

export async function listarCostosFijos(ctx: Contexto, soloActivos = true): Promise<CostoFijo[]> {
  const filas = await ctx.db.select({ f: costoFijo, codigo: vehiculo.codigo, placa: vehiculo.placa }).from(costoFijo)
    .leftJoin(vehiculo, eq(vehiculo.id, costoFijo.vehiculoId))
    .where(soloActivos ? eq(costoFijo.activo, true) : undefined).orderBy(costoFijo.categoria, costoFijo.id);
  return filas.map(({ f, codigo, placa }) => ({
    id: f.id, concepto: f.concepto, categoria: f.categoria, monto: f.monto, periodicidad: f.periodicidad, vehiculoId: f.vehiculoId,
    unidad: f.vehiculoId ? (codigo ?? placa) : null, medioPago: f.medioPago, desde: f.desde, hasta: f.hasta, activo: f.activo,
  }));
}

/** Crea los gastos fijos del mes (fijos vigentes + cuotas que vencen). Idempotente. */
export async function generarFijosDelMes(ctx: Contexto, periodo: string): Promise<number> {
  const { desde, hasta } = rangoMes(`${periodo}-01`);
  let creados = 0;
  const fijos = await ctx.db.select().from(costoFijo)
    .where(and(eq(costoFijo.activo, true), lte(costoFijo.desde, hasta), or(isNull(costoFijo.hasta), gte(costoFijo.hasta, desde))));
  for (const f of fijos) {
    const r = await ctx.db.insert(gasto).values({
      categoria: f.categoria, monto: montoDelMes(f.monto, f.periodicidad, periodo), fecha: desde, vehiculoId: f.vehiculoId, nota: f.concepto,
      origen: "sistema", medioPago: f.medioPago, costoFijoId: f.id, periodo,
    }).onConflictDoNothing().returning({ id: gasto.id });
    creados += r.length;
  }
  const cuotas = await ctx.db.select({ c: cuotaPrestamo, entidad: prestamo.entidad, vehiculoId: prestamo.vehiculoId }).from(cuotaPrestamo)
    .innerJoin(prestamo, eq(prestamo.id, cuotaPrestamo.prestamoId))
    .where(and(gte(cuotaPrestamo.vencimiento, desde), lte(cuotaPrestamo.vencimiento, hasta)));
  for (const q of cuotas) {
    const r = await ctx.db.insert(gasto).values({
      categoria: "cuota_prestamo", monto: q.c.monto, fecha: q.c.vencimiento, vehiculoId: q.vehiculoId, nota: `${q.entidad} · cuota ${q.c.numero}`,
      origen: "sistema", medioPago: "transferencia", cuotaId: q.c.id, periodo,
    }).onConflictDoNothing().returning({ id: gasto.id });
    creados += r.length;
  }
  return creados;
}

/** Genera los fijos de cada mes del rango, sin pasar del mes actual. */
export async function asegurarFijos(ctx: Contexto, desde: string, hasta: string): Promise<void> {
  const tope = hoy(ctx).slice(0, 7);
  let mes = desde.slice(0, 7);
  const fin = hasta.slice(0, 7) < tope ? hasta.slice(0, 7) : tope;
  while (mes <= fin) {
    await generarFijosDelMes(ctx, mes);
    const [y, m] = mes.split("-").map(Number);
    mes = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 7);
  }
}
```

`rangoMes` se muda a `dominio/fechas.ts` en el paso siguiente (Step 4). Hacer esa mudanza antes de compilar este archivo.

- [ ] **Step 4: `finanzas.ts` — resumen con fijo y variable, caja sin doble conteo**

- En `ResumenFinanciero` agregar `gastosVariables: number; gastosFijos: number;`.
- Reemplazar `sumaGastos` por una versión que agrupe por tipo:

```ts
async function sumaGastosPorTipo(ctx: Contexto, desde: string, hasta: string, vehiculoId?: number): Promise<{ fijo: number; variable: number }> {
  const filtros = [sql`${gasto.fecha} >= ${desde}`, sql`${gasto.fecha} <= ${hasta}`];
  if (vehiculoId !== undefined) filtros.push(eq(gasto.vehiculoId, vehiculoId));
  const filas = await ctx.db.select({ tipo: categoriaGasto.tipo, t: sql<string>`coalesce(sum(${gasto.monto}), 0)` }).from(gasto)
    .innerJoin(categoriaGasto, eq(categoriaGasto.clave, gasto.categoria)).where(and(...filtros)).groupBy(categoriaGasto.tipo);
  return { fijo: Number(filas.find((f) => f.tipo === "fijo")?.t ?? 0), variable: Number(filas.find((f) => f.tipo === "variable")?.t ?? 0) };
}
```

- En `resumenFinanciero`, antes de sumar, llamar `await asegurarFijos(ctx, desde, hasta);`. Luego:

```ts
  const t = await sumaGastosPorTipo(ctx, desde, hasta, vehiculoId);
  const gastos = t.fijo + t.variable;
```

  y devolver también `gastosVariables: t.variable, gastosFijos: t.fijo`.
- `asegurarFijos` está en `costos-fijos.ts`, que importa `rangoMes` de `finanzas.ts`. Para evitar el ciclo de imports, mover `rangoMes` y `mesAnterior` a `packages/core/src/dominio/fechas.ts`, reexportarlos desde `finanzas.ts` con `export { rangoMes, mesAnterior } from "../dominio/fechas";` e importarlos en `costos-fijos.ts` desde `../dominio/fechas`.
- En `listarMovimientos`, el bucle de `gasto` pasa a saltar los generados por cuota (la cuota aparece como CUOTA al pagarse): `for (const g of await ctx.db.select().from(gasto).where(and(rango(gasto.fecha), isNull(gasto.cuotaId))))`.
- En `flujoCaja`, los gastos generados (fijos y cuotas) no son salida de caja: `for (const g of await ctx.db.select().from(gasto).where(and(rango(gasto.fecha), isNull(gasto.cuotaId), isNull(gasto.costoFijoId))))`.
- Importar `categoriaGasto` desde `@sunatapp/db` y `asegurarFijos` desde `./costos-fijos`. `index.ts`: agregar `export * from "./finanzas/costos-fijos";`.

- [ ] **Step 5: Generación diaria en la tarea de fondo**

Run: `grep -n "extras\|crearTareaFondo(" apps/bot/src/app.ts apps/bot/src/main.ts apps/bot/src/arranque.ts`

En el arreglo `extras` que se pasa a `crearTareaFondo`, agregar:

```ts
{ nombre: "fijos del mes", tarea: () => generarFijosDelMes(deps.ctx, hoy(deps.ctx).slice(0, 7)) },
```

importando `generarFijosDelMes` y `hoy` desde `@sunatapp/core`.

- [ ] **Step 6: Correr las pruebas**

Run: `pnpm vitest run packages/core/test/costos-fijos.test.ts packages/core/test/liquidacion.test.ts apps/bot/test/fondo.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core apps/bot/src
git commit -m "feat(core): costos fijos recurrentes y cuotas como fijo del mes; resumen separa fijo y variable"
```

---

### Task 5: Núcleo — el viaje nace de la guía

**Files:**
- Create: `packages/core/src/viajes/desde-guia.ts`, `packages/core/src/viajes/revisar-viajes.ts`
- Modify:
  - `packages/core/src/guias/registrar.ts:75-116`;
  - `packages/core/src/flota/viajes-flota.ts:12-27,77-78,178` (`vehiculoSecundarioId`; exportar `facturasPorViaje`);
  - `packages/core/src/lecturas/lecturas.ts:341` (`contarPorRevisar`);
  - `packages/core/src/index.ts`
- Test: `packages/core/test/desde-guia.test.ts` (nuevo); ajustar `packages/core/test/viajes.test.ts:70` y `packages/core/test/guias.test.ts`

**Interfaces:**
- Consumes: `registrarViajeFlota`, `finalizarViajeFlota`, `enlazarGuia`, `obtenerUbigeo`.
- Produces:
  - `ciudadDeUbigeo(codigo: string): string`
  - `type AccionGuia = "creado" | "retorno" | "cerrado_y_creado"`
  - `alRegistrarGuia(ctx, guiaId: number, usuarioId?: number): Promise<{ accion: AccionGuia; viajeId: number; viajeCodigo: string; cerradoCodigo?: string } | null>`
  - `type MotivoViaje = "sin_guia" | "guia_rechazada" | "cierre_automatico" | "guia_sin_viaje"`
  - `viajesPorRevisar(ctx): Promise<Array<{ motivo: MotivoViaje; viajeId: number | null; guiaId: number | null; codigo: string; detalle: string }>>`
  - `EntradaViajeFlota.vehiculoSecundarioId?: number | null`

- [ ] **Step 1: Test que falla**

`packages/core/test/desde-guia.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guiaTransportista, eq, viaje } from "@sunatapp/db";
import { alRegistrarGuia, ciudadDeUbigeo, registrarGuiaBorrador, registrarViajeFlota, viajesPorRevisar, type Contexto } from "../src/index";
import { crearContextoPrueba, entradaGuia } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

const guia = (ref: string) => registrarGuiaBorrador(ctx, { ...entradaGuia(), greRemitenteRef: ref });
const viajeDe = async (guiaId: number) => (await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId)))[0]!;

describe("el viaje nace de la guía", () => {
  it("nombre de ciudad desde el ubigeo", () => {
    expect(ciudadDeUbigeo("150115")).toBe("Lima");
    expect(ciudadDeUbigeo("211101")).toBe("Juliaca");
    expect(ciudadDeUbigeo("250101")).toBe("Callería");
  });

  it("sin viaje en curso: registrar la guía crea el viaje con los datos de la guía", async () => {
    const g = await guia("EG01-1");
    const gi = await viajeDe(g);
    expect(gi.tramo).toBe("ida");
    const [v] = await ctx.db.select().from(viaje).where(eq(viaje.id, gi.viajeId!));
    expect(v).toMatchObject({ estado: "en_curso", origenLugar: "Lima", destinoLugar: "Callería", toneladas: "1.50", vehiculoId: gi.vehiculoId, conductorId: gi.conductorId });
  });

  it("la segunda guía de la unidad es el retorno del mismo viaje", async () => {
    const a = await guia("EG01-1");
    const b = await guia("EG01-2");
    expect((await viajeDe(b)).viajeId).toBe((await viajeDe(a)).viajeId);
    expect((await viajeDe(b)).tramo).toBe("retorno");
  });

  it("con ida y retorno ocupados: cierra ese viaje (marcado) y abre otro", async () => {
    const a = await guia("EG01-1");
    await guia("EG01-2");
    const c = await guia("EG01-3");
    const viejo = (await viajeDe(a)).viajeId!;
    const [cerrado] = await ctx.db.select().from(viaje).where(eq(viaje.id, viejo));
    expect(cerrado).toMatchObject({ estado: "cerrado", cierreAutomatico: true });
    expect((await viajeDe(c)).viajeId).not.toBe(viejo);
    expect((await viajesPorRevisar(ctx)).some((x) => x.motivo === "cierre_automatico" && x.viajeId === viejo)).toBe(true);
  });

  it("idempotencia: llamarla otra vez para la misma guía no crea otro viaje", async () => {
    const g = await guia("EG01-1");
    expect(await alRegistrarGuia(ctx, g)).toBeNull();
    expect(await ctx.db.select().from(viaje)).toHaveLength(1);
  });

  it("un viaje creado a mano después de la migración aparece como «sin guía»", async () => {
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Puno", estado: "en_curso", origen: "web" });
    expect((await viajesPorRevisar(ctx)).find((x) => x.viajeId === v.id)?.motivo).toBe("sin_guia");
  });
});
```

Nota: la placa y el chofer de `entradaGuia()` son los de `DATOS_INICIALES` (`ABC-123` y `45288569`). Revisar en `helpers.ts` que `entradaGuia()` trae `transporte`. Si no lo trae, `registrarGuiaBorrador` usa el transporte habitual, que es el mismo vehículo, y la prueba vale igual. Confirmar el nombre de distrito de `250101` en `packages/core/src/dominio/ubigeos.json`: si no es «CALLERIA», poner el que corresponda.

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm vitest run packages/core/test/desde-guia.test.ts`
Expected: FAIL — `alRegistrarGuia` no existe.

- [ ] **Step 3: `viajes-flota.ts`**

- En `EntradaViajeFlota` agregar `vehiculoSecundarioId?: number | null;`.
- En el `insert`, cambiar `vehiculoSecundarioId: v.carretaId` por `vehiculoSecundarioId: e.vehiculoSecundarioId !== undefined ? e.vehiculoSecundarioId : v.carretaId`.
- Cambiar `async function facturasPorViaje` a `export async function facturasPorViaje`.

- [ ] **Step 4: Crear `packages/core/src/viajes/desde-guia.ts`**

```ts
import { and, eq, guiaTransportista, viaje } from "@sunatapp/db";
import { obtenerUbigeo } from "../dominio/ubigeos";
import type { Contexto } from "../infra/contexto";
import { finalizarViajeFlota, registrarViajeFlota } from "../flota/viajes-flota";
import { enlazarGuia } from "./viajes";

const titulo = (t: string) => t.toLowerCase().replace(/(^|\s)\p{L}/gu, (l) => l.toUpperCase());

/** «Lima» para cualquier distrito de Lima Metropolitana; si no, el distrito («Juliaca», «Arequipa»). */
export function ciudadDeUbigeo(codigo: string): string {
  const u = obtenerUbigeo(codigo);
  if (!u) return codigo;
  return titulo(u.provincia === "LIMA" ? "LIMA" : u.distrito);
}

export type AccionGuia = "creado" | "retorno" | "cerrado_y_creado";

/**
 * Enlaza la guía recién registrada al viaje de su unidad (spec §5): sin viaje en curso lo crea (ida);
 * con ida libre de retorno la pone como retorno; con los dos tramos ocupados cierra ese viaje
 * (queda marcado para revisar km y flete) y abre uno nuevo. Una guía ya enlazada no hace nada.
 */
export async function alRegistrarGuia(ctx: Contexto, guiaId: number, usuarioId?: number) {
  const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g || g.viajeId !== null) return null;
  const [enCurso] = await ctx.db.select().from(viaje).where(and(eq(viaje.vehiculoId, g.vehiculoId), eq(viaje.estado, "en_curso")));
  let cerradoCodigo: string | undefined;
  if (enCurso) {
    const tramos = new Set((await ctx.db.select({ t: guiaTransportista.tramo }).from(guiaTransportista).where(eq(guiaTransportista.viajeId, enCurso.id))).map((x) => x.t));
    if (tramos.has("ida") && !tramos.has("retorno")) {
      await enlazarGuia(ctx, guiaId, enCurso.id, "retorno", usuarioId);
      return { accion: "retorno" as AccionGuia, viajeId: enCurso.id, viajeCodigo: enCurso.codigo };
    }
    if (!tramos.has("ida")) {
      await enlazarGuia(ctx, guiaId, enCurso.id, "ida", usuarioId);
      return { accion: "creado" as AccionGuia, viajeId: enCurso.id, viajeCodigo: enCurso.codigo };
    }
    await finalizarViajeFlota(ctx, { viajeId: enCurso.id, usuarioId });
    await ctx.db.update(viaje).set({ cierreAutomatico: true }).where(eq(viaje.id, enCurso.id));
    cerradoCodigo = enCurso.codigo;
  }
  const peso = Number(g.pesoBruto);
  const toneladas = Math.round((g.unidadPeso === "TNE" ? peso : peso / 1000) * 100) / 100;
  const v = await registrarViajeFlota(ctx, {
    vehiculoId: g.vehiculoId, vehiculoSecundarioId: g.vehiculoSecundarioId, conductorId: g.conductorId,
    origenLugar: ciudadDeUbigeo(g.partidaUbigeo), destinoLugar: ciudadDeUbigeo(g.llegadaUbigeo),
    toneladas: toneladas > 0 && toneladas <= 100 ? toneladas : null, estado: "en_curso", origen: "sistema", usuarioId,
  });
  await enlazarGuia(ctx, guiaId, v.id, "ida", usuarioId);
  return { accion: (cerradoCodigo ? "cerrado_y_creado" : "creado") as AccionGuia, viajeId: v.id, viajeCodigo: v.codigo, cerradoCodigo };
}
```

- [ ] **Step 5: Llamarla desde `registrarGuiaBorrador`**

En `guias/registrar.ts`:
- cambiar `return await ctx.db.transaction(async (tx) => { … });` por `const id = await ctx.db.transaction(async (tx) => { … });`;
- justo después, dentro del mismo `try`:

```ts
    // El viaje nace de la guía (spec §5). Si falla, la guía queda sin viaje y sale en «Por revisar».
    await alRegistrarGuia(ctx, id, usuarioId).catch(() => null);
    return id;
```

Importar `alRegistrarGuia` desde `../viajes/desde-guia`. El camino `existente` (guía ya registrada para ese documento) no llama a `alRegistrarGuia` y así no se duplica el viaje.

- [ ] **Step 6: Crear `packages/core/src/viajes/revisar-viajes.ts`**

```ts
import { ajuste, and, eq, gte, guiaTransportista, inArray, isNull, notExists, sql, viaje } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";

export type MotivoViaje = "sin_guia" | "guia_rechazada" | "cierre_automatico" | "guia_sin_viaje";
export interface ViajePorRevisar { motivo: MotivoViaje; viajeId: number | null; guiaId: number | null; codigo: string; detalle: string }

export async function viajesPorRevisar(ctx: Contexto): Promise<ViajePorRevisar[]> {
  const r: ViajePorRevisar[] = [];
  const [corte] = await ctx.db.select({ v: ajuste.valor }).from(ajuste).where(eq(ajuste.clave, "viajes_sin_guia_desde"));
  const desde = corte ? new Date(String(corte.v)) : new Date(0);
  const sinGuia = await ctx.db.select({ id: viaje.id, codigo: viaje.codigo, o: viaje.origenLugar, d: viaje.destinoLugar }).from(viaje)
    .where(and(gte(viaje.creadoEn, desde), notExists(ctx.db.select({ x: sql`1` }).from(guiaTransportista).where(eq(guiaTransportista.viajeId, viaje.id)))));
  for (const v of sinGuia) r.push({ motivo: "sin_guia", viajeId: v.id, guiaId: null, codigo: v.codigo, detalle: `${v.o ?? "?"} → ${v.d ?? "?"} no tiene guía enlazada` });
  const rech = await ctx.db.select({ g: guiaTransportista, codigo: viaje.codigo }).from(guiaTransportista).innerJoin(viaje, eq(viaje.id, guiaTransportista.viajeId))
    .where(eq(guiaTransportista.estado, "rechazada"));
  for (const x of rech) r.push({ motivo: "guia_rechazada", viajeId: x.g.viajeId, guiaId: x.g.id, codigo: x.codigo, detalle: `Guía ${x.g.serie}-${x.g.numero ?? "?"} rechazada por SUNAT: corrígela` });
  const auto = await ctx.db.select().from(viaje).where(eq(viaje.cierreAutomatico, true));
  for (const v of auto) r.push({ motivo: "cierre_automatico", viajeId: v.id, guiaId: null, codigo: v.codigo, detalle: "Se cerró solo al salir con una guía nueva: revisa km y flete" });
  const sueltas = await ctx.db.select().from(guiaTransportista).where(and(isNull(guiaTransportista.viajeId), gte(guiaTransportista.creadoEn, desde)));
  for (const g of sueltas) r.push({ motivo: "guia_sin_viaje", viajeId: null, guiaId: g.id, codigo: `${g.serie}-${g.numero ?? "?"}`, detalle: "Guía sin viaje: enlázala o crea el viaje" });
  return r;
}
```

`inArray` no se usa: quitarlo del import. Agregar `notExists` a los reexports de `packages/db/src/index.ts`.

- Cuando se corrigen el km y el flete de un viaje cerrado solo, sale de la lista: en `editarViajeFlota` (`viajes-flota.ts`), al guardar, poner `cierreAutomatico: false`.
- `contarPorRevisar` (`lecturas.ts:341`) pasa a sumar también `(await viajesPorRevisar(ctx)).length`.
- `index.ts`: exportar `./viajes/desde-guia` y `./viajes/revisar-viajes`.

- [ ] **Step 7: Ajustar las pruebas que enlazaban a mano**

Run: `pnpm vitest run packages/core`

Las pruebas que registran una guía y luego llaman a `enlazarGuia`/`enlazarGuiaAlViajeEnCurso` esperando que esté libre ahora fallarán con «La guía ya está en otro viaje». Por ejemplo `viajes.test.ts:70`.

Regla para arreglarlas: si la prueba verifica el enlace, cambiarla para verificar el enlace automático (`guiaTransportista.viajeId`/`tramo` ya puestos). Si necesita la guía libre, desenlazarla antes con `desenlazarGuia(ctx, id)`.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core packages/db/src/index.ts
git commit -m "feat(core): el viaje nace al registrar su guía (ida, retorno o cierre automático) y motivos de revisión"
```

---

### Task 6: Núcleo — rentabilidad por viaje y por mes con reparto del fijo

**Files:**
- Create: `packages/core/src/rentabilidad/por-viaje-mes.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/rentabilidad-viaje-mes.test.ts` (nuevo)

**Interfaces:**
- Consumes: `asegurarFijos` (Task 4), `facturasPorViaje` (Task 5), tabla `categoriaGasto`.
- Produces:
  - `interface FilaRentViaje { viajeId: number; codigo: string; guia: string | null; vehiculoId: number; unidad: string; ruta: string; mes: string; flete: number; variables: number; contribucion: number; fijoAsignado: number; ganancia: number; margenPct: number | null; provisional: boolean }`
  - `rentabilidadPorViaje(ctx, o: { desde: string; hasta: string; vehiculoId?: number }): Promise<FilaRentViaje[]>`
  - `rentabilidadDeViaje(ctx, viajeId: number): Promise<FilaRentViaje | null>`
  - `interface FilaRentMes { mes: string; vehiculoId: number | null; unidad: string; viajes: number; ingresos: number; variables: number; contribucion: number; fijos: number; ganancia: number; margenPct: number | null; provisional: boolean; fijosDetalle: Array<{ categoria: string; nombre: string; monto: number }> }`
  - `rentabilidadPorMes(ctx, o: { desde: string; hasta: string; vehiculoId?: number; porUnidad?: boolean }): Promise<FilaRentMes[]>`

- [ ] **Step 1: Test que falla**

`packages/core/test/rentabilidad-viaje-mes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  crearCostoFijo, crearUnidad, finalizarViajeFlota, registrarGasto, registrarViajeFlota, rentabilidadDeViaje, rentabilidadPorMes, rentabilidadPorViaje,
  type Contexto,
} from "../src/index";
import { crearContextoPrueba } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba({ reloj: () => new Date("2026-10-05T15:00:00Z") })));
afterEach(async () => cerrar());

async function viajeCerrado(vehiculoId: number, fecha: string, flete: number, combustible: number) {
  const v = await registrarViajeFlota(ctx, { vehiculoId, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", fecha, origen: "web" });
  await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: combustible, fecha, origen: "web" });
  await finalizarViajeFlota(ctx, { viajeId: v.id, km: 300, fecha, flete });
  return v.id;
}

describe("rentabilidad por viaje y por mes", () => {
  it("reparte el fijo de la unidad entre sus viajes y el general entre todos", async () => {
    const t2 = await crearUnidad(ctx, { placa: "XYZ-987", codigo: "T-02" } as never);
    await crearCostoFijo(ctx, { concepto: "Sueldo T-01", categoria: "sueldo_chofer", monto: 300000, periodicidad: "mensual", vehiculoId: 1, desde: "2026-09-01" });
    await crearCostoFijo(ctx, { concepto: "Contador", categoria: "contador", monto: 90000, periodicidad: "mensual", desde: "2026-09-01" });
    const a = await viajeCerrado(1, "2026-09-10", 500000, 150000);
    await viajeCerrado(1, "2026-09-20", 500000, 150000);
    await viajeCerrado(t2.id, "2026-09-22", 400000, 100000);
    const filas = await rentabilidadPorViaje(ctx, { desde: "2026-09-01", hasta: "2026-09-30" });
    const fa = filas.find((f) => f.viajeId === a)!;
    // fijo de T-01: 300000/2 = 150000; general: 90000/3 = 30000
    expect(fa).toMatchObject({ flete: 500000, variables: 150000, contribucion: 350000, fijoAsignado: 180000, ganancia: 170000, margenPct: 34, provisional: false });
    expect((await rentabilidadDeViaje(ctx, a))!.ganancia).toBe(170000);
  });

  it("por mes: ingresos, variables, fijos y ganancia neta; el mes actual es provisional", async () => {
    await crearCostoFijo(ctx, { concepto: "GPS", categoria: "gps", monto: 10000, periodicidad: "mensual", vehiculoId: 1, desde: "2026-09-01" });
    await viajeCerrado(1, "2026-09-10", 500000, 150000);
    const meses = await rentabilidadPorMes(ctx, { desde: "2026-09-01", hasta: "2026-10-31" });
    expect(meses.map((m) => m.mes)).toEqual(["2026-09", "2026-10"]);
    expect(meses[0]).toMatchObject({ viajes: 1, ingresos: 500000, variables: 150000, contribucion: 350000, fijos: 10000, ganancia: 340000, provisional: false });
    expect(meses[0]!.fijosDetalle).toEqual([{ categoria: "gps", nombre: "GPS y monitoreo", monto: 10000 }]);
    expect(meses[1]!.provisional).toBe(true);
  });

  it("mes sin viajes: pérdida por los fijos y ninguna división entre cero", async () => {
    await crearCostoFijo(ctx, { concepto: "Leasing", categoria: "cuota_prestamo", monto: 800000, periodicidad: "mensual", vehiculoId: 1, desde: "2026-09-01" });
    const [sep] = await rentabilidadPorMes(ctx, { desde: "2026-09-01", hasta: "2026-09-30" });
    expect(sep).toMatchObject({ viajes: 0, ingresos: 0, fijos: 800000, ganancia: -800000, margenPct: null });
    expect(await rentabilidadPorViaje(ctx, { desde: "2026-09-01", hasta: "2026-09-30" })).toEqual([]);
  });

  it("por unidad: una fila por unidad y mes", async () => {
    await viajeCerrado(1, "2026-09-10", 500000, 150000);
    const filas = await rentabilidadPorMes(ctx, { desde: "2026-09-01", hasta: "2026-09-30", porUnidad: true });
    expect(filas.every((f) => f.vehiculoId !== null)).toBe(true);
  });
});
```

Revisar la firma real de `crearUnidad` (`packages/core/src/flota/unidades.ts`) y pasar los campos obligatorios que pida; quitar el `as never` si ya calza.

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm vitest run packages/core/test/rentabilidad-viaje-mes.test.ts`
Expected: FAIL — `rentabilidadPorViaje` no existe.

- [ ] **Step 3: Crear `packages/core/src/rentabilidad/por-viaje-mes.ts`**

```ts
import { and, categoriaGasto, eq, gasto, guiaTransportista, ingreso, inArray, sql, vehiculo, viaje } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";
import { rangoMes } from "../dominio/fechas";
import { hoy } from "../flota/unidades";
import { facturasPorViaje } from "../flota/viajes-flota";
import { asegurarFijos } from "../finanzas/costos-fijos";

export interface FilaRentViaje {
  viajeId: number; codigo: string; guia: string | null; vehiculoId: number; unidad: string; ruta: string; mes: string;
  flete: number; variables: number; contribucion: number; fijoAsignado: number; ganancia: number; margenPct: number | null; provisional: boolean;
}
export interface FilaRentMes {
  mes: string; vehiculoId: number | null; unidad: string; viajes: number; ingresos: number; variables: number; contribucion: number;
  fijos: number; ganancia: number; margenPct: number | null; provisional: boolean; fijosDetalle: Array<{ categoria: string; nombre: string; monto: number }>;
}

const pct = (g: number, base: number) => (base > 0 ? Math.round((g / base) * 100) : null);

function mesesDe(desde: string, hasta: string): string[] {
  const r: string[] = [];
  let m = desde.slice(0, 7);
  while (m <= hasta.slice(0, 7)) {
    r.push(m);
    const [y, mm] = m.split("-").map(Number);
    m = new Date(Date.UTC(y!, mm!, 1)).toISOString().slice(0, 7);
  }
  return r;
}

/** Viajes cerrados cuyo mes de cierre cae en el rango, con flete y variables. */
async function viajesCerrados(ctx: Contexto, desde: string, hasta: string) {
  const filas = await ctx.db.select({ v: viaje, codigo: vehiculo.codigo, placa: vehiculo.placa }).from(viaje)
    .innerJoin(vehiculo, eq(vehiculo.id, viaje.vehiculoId))
    .where(and(eq(viaje.estado, "cerrado"), sql`${viaje.fechaRegreso} >= ${desde}`, sql`${viaje.fechaRegreso} <= ${hasta}`));
  const ids = filas.map((f) => f.v.id);
  const variables = new Map<number, number>();
  const guias = new Map<number, string>();
  if (ids.length) {
    const vs = await ctx.db.select({ id: gasto.viajeId, t: sql<string>`sum(${gasto.monto})` }).from(gasto)
      .innerJoin(categoriaGasto, eq(categoriaGasto.clave, gasto.categoria))
      .where(and(inArray(gasto.viajeId, ids), eq(categoriaGasto.tipo, "variable"))).groupBy(gasto.viajeId);
    for (const x of vs) variables.set(x.id!, Number(x.t));
    const gs = await ctx.db.select({ id: guiaTransportista.viajeId, serie: guiaTransportista.serie, num: guiaTransportista.numero, tramo: guiaTransportista.tramo })
      .from(guiaTransportista).where(inArray(guiaTransportista.viajeId, ids));
    for (const g of gs) if (g.tramo === "ida" || !guias.has(g.id!)) guias.set(g.id!, `${g.serie}-${g.num ?? "?"}`);
  }
  const facturas = await facturasPorViaje(ctx, ids);
  return filas.map(({ v, codigo, placa }) => ({
    id: v.id, codigo: v.codigo, vehiculoId: v.vehiculoId, unidad: codigo ?? placa, mes: v.fechaRegreso!.slice(0, 7),
    ruta: v.origenLugar && v.destinoLugar ? `${v.origenLugar} → ${v.destinoLugar}` : (v.nota ?? "—"), guia: guias.get(v.id) ?? null,
    flete: v.flete ?? (facturas.get(v.id) ?? []).reduce((s, x) => s + x.subtotal, 0), variables: variables.get(v.id) ?? 0,
  }));
}

/** Fijos por mes y unidad (null = general), con su detalle por categoría. */
async function fijosPorMes(ctx: Contexto, desde: string, hasta: string) {
  const mesExpr = sql<string>`coalesce(${gasto.periodo}, to_char(${gasto.fecha}, 'YYYY-MM'))`;
  const filas = await ctx.db.select({ mes: mesExpr, vehiculoId: gasto.vehiculoId, categoria: gasto.categoria, nombre: categoriaGasto.nombre, t: sql<string>`sum(${gasto.monto})` })
    .from(gasto).innerJoin(categoriaGasto, eq(categoriaGasto.clave, gasto.categoria))
    .where(and(eq(categoriaGasto.tipo, "fijo"), sql`${mesExpr} >= ${desde.slice(0, 7)}`, sql`${mesExpr} <= ${hasta.slice(0, 7)}`))
    .groupBy(mesExpr, gasto.vehiculoId, gasto.categoria, categoriaGasto.nombre);
  return filas.map((f) => ({ mes: f.mes, vehiculoId: f.vehiculoId, categoria: f.categoria, nombre: f.nombre, monto: Number(f.t) }));
}

export async function rentabilidadPorViaje(ctx: Contexto, o: { desde: string; hasta: string; vehiculoId?: number }): Promise<FilaRentViaje[]> {
  await asegurarFijos(ctx, o.desde, o.hasta);
  const desde = rangoMes(o.desde).desde, hasta = rangoMes(o.hasta).hasta;
  const todos = await viajesCerrados(ctx, desde, hasta);
  const fijos = await fijosPorMes(ctx, desde, hasta);
  const actual = hoy(ctx).slice(0, 7);
  const n = (mes: string, vehiculoId?: number) => todos.filter((v) => v.mes === mes && (vehiculoId === undefined || v.vehiculoId === vehiculoId)).length;
  const suma = (mes: string, vehiculoId: number | null) => fijos.filter((f) => f.mes === mes && f.vehiculoId === vehiculoId).reduce((s, f) => s + f.monto, 0);
  return todos.filter((v) => o.vehiculoId === undefined || v.vehiculoId === o.vehiculoId).map((v) => {
    const fijoAsignado = Math.round(suma(v.mes, v.vehiculoId) / n(v.mes, v.vehiculoId)) + Math.round(suma(v.mes, null) / n(v.mes));
    const contribucion = v.flete - v.variables;
    const ganancia = contribucion - fijoAsignado;
    return {
      viajeId: v.id, codigo: v.codigo, guia: v.guia, vehiculoId: v.vehiculoId, unidad: v.unidad, ruta: v.ruta, mes: v.mes,
      flete: v.flete, variables: v.variables, contribucion, fijoAsignado, ganancia, margenPct: pct(ganancia, v.flete), provisional: v.mes === actual,
    };
  }).sort((a, b) => b.mes.localeCompare(a.mes) || b.viajeId - a.viajeId);
}

export async function rentabilidadDeViaje(ctx: Contexto, viajeId: number): Promise<FilaRentViaje | null> {
  const [v] = await ctx.db.select({ f: viaje.fechaRegreso, e: viaje.estado }).from(viaje).where(eq(viaje.id, viajeId));
  if (!v || v.e !== "cerrado" || !v.f) return null;
  return (await rentabilidadPorViaje(ctx, { desde: v.f, hasta: v.f })).find((x) => x.viajeId === viajeId) ?? null;
}

export async function rentabilidadPorMes(ctx: Contexto, o: { desde: string; hasta: string; vehiculoId?: number; porUnidad?: boolean }): Promise<FilaRentMes[]> {
  await asegurarFijos(ctx, o.desde, o.hasta);
  const desde = rangoMes(o.desde).desde, hasta = rangoMes(o.hasta).hasta;
  const viajes = await viajesCerrados(ctx, desde, hasta);
  const fijos = await fijosPorMes(ctx, desde, hasta);
  const actual = hoy(ctx).slice(0, 7);
  const unidades = await ctx.db.select({ id: vehiculo.id, codigo: vehiculo.codigo, placa: vehiculo.placa }).from(vehiculo).where(eq(vehiculo.tipo, "tracto"));
  const variablesSinViaje = await ctx.db.select({ mes: sql<string>`to_char(${gasto.fecha}, 'YYYY-MM')`, vehiculoId: gasto.vehiculoId, t: sql<string>`sum(${gasto.monto})` })
    .from(gasto).innerJoin(categoriaGasto, eq(categoriaGasto.clave, gasto.categoria))
    .where(and(eq(categoriaGasto.tipo, "variable"), sql`${gasto.viajeId} is null`, sql`${gasto.fecha} >= ${desde}`, sql`${gasto.fecha} <= ${hasta}`))
    .groupBy(sql`to_char(${gasto.fecha}, 'YYYY-MM')`, gasto.vehiculoId);
  const otrosIngresos = await ctx.db.select({ mes: sql<string>`to_char(${ingreso.fecha}, 'YYYY-MM')`, vehiculoId: ingreso.vehiculoId, t: sql<string>`sum(${ingreso.monto})` })
    .from(ingreso).where(and(sql`${ingreso.fecha} >= ${desde}`, sql`${ingreso.fecha} <= ${hasta}`))
    .groupBy(sql`to_char(${ingreso.fecha}, 'YYYY-MM')`, ingreso.vehiculoId);

  const grupos: Array<{ vehiculoId: number | null; unidad: string }> = o.porUnidad
    ? unidades.filter((u) => o.vehiculoId === undefined || u.id === o.vehiculoId).map((u) => ({ vehiculoId: u.id, unidad: u.codigo ?? u.placa }))
    : [{ vehiculoId: o.vehiculoId ?? null, unidad: o.vehiculoId ? (unidades.find((u) => u.id === o.vehiculoId)?.codigo ?? "—") : "Todas" }];
  const r: FilaRentMes[] = [];
  for (const mes of mesesDe(desde, hasta)) {
    const delMes = viajes.filter((v) => v.mes === mes);
    for (const gr of grupos) {
      const es = (id: number | null) => gr.vehiculoId === null || id === gr.vehiculoId;
      const vs = delMes.filter((v) => es(v.vehiculoId));
      // Fijos: los de la unidad (o todos) + la parte de los generales según sus viajes del mes.
      const propios = fijos.filter((f) => f.mes === mes && f.vehiculoId !== null && es(f.vehiculoId));
      const generales = fijos.filter((f) => f.mes === mes && f.vehiculoId === null);
      const parte = gr.vehiculoId === null ? 1 : delMes.length ? vs.length / delMes.length : 1 / Math.max(1, grupos.length);
      const detalle = new Map<string, { categoria: string; nombre: string; monto: number }>();
      for (const f of [...propios, ...generales.map((g) => ({ ...g, monto: Math.round(g.monto * parte) }))]) {
        const d = detalle.get(f.categoria) ?? { categoria: f.categoria, nombre: f.nombre, monto: 0 };
        d.monto += f.monto;
        detalle.set(f.categoria, d);
      }
      const fijosMes = [...detalle.values()].reduce((s, d) => s + d.monto, 0);
      const ingresos = vs.reduce((s, v) => s + v.flete, 0) + otrosIngresos.filter((x) => x.mes === mes && es(x.vehiculoId)).reduce((s, x) => s + Number(x.t), 0);
      const variables = vs.reduce((s, v) => s + v.variables, 0) + variablesSinViaje.filter((x) => x.mes === mes && es(x.vehiculoId)).reduce((s, x) => s + Number(x.t), 0);
      const contribucion = ingresos - variables;
      const ganancia = contribucion - fijosMes;
      r.push({
        mes, vehiculoId: gr.vehiculoId, unidad: gr.unidad, viajes: vs.length, ingresos, variables, contribucion, fijos: fijosMes, ganancia,
        margenPct: pct(ganancia, ingresos), provisional: mes === actual, fijosDetalle: [...detalle.values()].sort((a, b) => b.monto - a.monto),
      });
    }
  }
  return r;
}
```

`index.ts`: agregar `export * from "./rentabilidad/por-viaje-mes";`.

- [ ] **Step 4: Correr las pruebas**

Run: `pnpm vitest run packages/core/test/rentabilidad-viaje-mes.test.ts`
Expected: PASS. Si el margen redondea distinto, recalcular a mano: el caso del primer test da 170000/500000 = 34 %.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): rentabilidad por viaje y por mes con el fijo repartido por viaje"
```

---

### Task 7: IA y lecturas — categorías dinámicas, forma de pago y km del voucher

**Files:**
- Modify: `packages/ia/src/tipos.ts:7-26`, `packages/ia/src/prompts.ts:17-18`, `packages/ia/src/reglas.ts:7-16,68`, `packages/core/src/lecturas/lecturas.ts` (`leerDocumento`, `confirmarLectura`, `ResultadoLeer`)
- Test: `packages/ia/test/ia.test.ts`, `packages/core/test/lecturas.test.ts`

**Interfaces:**
- Consumes: `listarCategorias`, `categoriaValida` (Task 2); `capturarContexto`, `describirContexto` (Task 3); `registrarGasto` con `kmVehiculo`/`medioPago`.
- Produces:
  - `Categoria` en `@sunatapp/ia` pasa a ser `string`; se exporta `MEDIOS_PAGO`;
  - la lectura de gasto agrega `medioPago: MedioPago | null` y `kmOdometro: number | null`;
  - `ContextoLectura.categorias?: Array<{ clave: string; nombre: string }>`;
  - `ResultadoLeer` (ok) agrega `contexto: string | null`;
  - `ResultadoConfirmacion` (gasto) agrega `avisoKm: string | null`.

- [ ] **Step 1: Tests que fallan**

En `packages/ia/test/ia.test.ts` agregar:

```ts
it("reglas: categorías nuevas del rubro", () => {
  const l = (t: string) => leerPorReglas({ texto: t, contexto: { hoy: "2026-09-27", correcciones: [] } });
  expect(l("vulcanizado 25")).toMatchObject({ tipo: "gasto", categoria: "llantas_ruta" });
  expect(l("mecanico 180")).toMatchObject({ tipo: "gasto", categoria: "reparacion_ruta" });
  expect(l("papeleta 400")).toMatchObject({ tipo: "gasto", categoria: "multas" });
  expect(l("grifo 350")).toMatchObject({ categoria: "combustible", medioPago: null, kmOdometro: null });
});

it("el esquema acepta una categoría propia, la forma de pago y el km", () => {
  const r = esquemaLectura.parse({ tipo: "gasto", categoria: "guardiania", monto: 50, fecha: null, proveedorRuc: null, proveedorNombre: null, comprobante: null, nota: null, dudas: [], medioPago: "tarjeta", kmOdometro: 402380 });
  expect(r).toMatchObject({ categoria: "guardiania", medioPago: "tarjeta", kmOdometro: 402380 });
});

it("el prompt lista las categorías que se le pasan", () => {
  expect(instruccionesSistema({ hoy: "2026-09-27", correcciones: [], categorias: [{ clave: "guardiania", nombre: "Guardianía" }] })).toContain("guardiania");
});
```

(Importar `esquemaLectura`, `instruccionesSistema`, `leerPorReglas` si no están importados.)

En `packages/core/test/lecturas.test.ts` agregar, siguiendo el patrón de las pruebas existentes del archivo para crear un documento y leerlo:

```ts
it("confirmar un gasto de combustible con km del voucher lo guarda como km real y fecha de hoy", async () => {
  // …crear documento de texto «grifo 350» y leerlo como en las pruebas existentes…
  // luego fijar la lectura con km y forma de pago:
  await fijarLectura(ctx, docId, { tipo: "gasto", categoria: "combustible", monto: 350, fecha: "2026-01-01", proveedorRuc: null, proveedorNombre: null, comprobante: null, nota: null, dudas: [], medioPago: "tarjeta", kmOdometro: 900 });
  const r = await confirmarLectura(ctx, docId, { vehiculoId: 1 });
  expect(r).toMatchObject({ tipo: "gasto", avisoKm: null });
  const g = await obtenerGasto(ctx, (r as { gastoId: number }).gastoId);
  expect(g).toMatchObject({ fecha: "2026-09-13", medioPago: "tarjeta", kmVehiculo: 900, kmReal: true });
});
```

(Si el odómetro sembrado de la unidad 1 es mayor que 900, usar `odometro + 100`, leyéndolo con `obtenerUnidad(ctx, 1)`.)

- [ ] **Step 2: Correr y ver que fallan**

Run: `pnpm vitest run packages/ia packages/core/test/lecturas.test.ts`
Expected: FAIL.

- [ ] **Step 3: `packages/ia/src/tipos.ts`**

```ts
/** Claves de fábrica: sirven de ejemplo al prompt y al lector por reglas; la lista real viene de la base. */
export const CATEGORIAS_BASE = [
  "combustible", "peaje", "viaticos", "hospedaje", "estiba", "balanza", "cochera", "lavado", "llantas_ruta", "reparacion_ruta",
  "lubricantes", "resguardo", "multas", "otros_viaje",
] as const;
export type Categoria = string;
export const MEDIOS = ["efectivo", "yape", "transferencia", "otro"] as const;
export type Medio = (typeof MEDIOS)[number];
export const MEDIOS_PAGO = ["efectivo_chofer", "efectivo", "yape_plin", "transferencia", "tarjeta", "credito"] as const;
```

En el objeto `gasto` del `discriminatedUnion`:

```ts
    tipo: z.literal("gasto"), categoria: z.string().trim().min(1), monto: z.number().positive().max(50_000),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), proveedorRuc: texto, proveedorNombre: texto, comprobante: texto,
    nota: texto, dudas: z.array(z.string()),
    medioPago: z.enum(MEDIOS_PAGO).nullable().default(null),
    kmOdometro: z.number().int().positive().max(5_000_000).nullable().default(null),
```

En `ContextoLectura` agregar `categorias?: Array<{ clave: string; nombre: string }>;`. Quitar `CATEGORIAS` y reemplazar sus usos por `CATEGORIAS_BASE`.

- [ ] **Step 4: `prompts.ts` y `reglas.ts`**

`prompts.ts`, la línea de «gasto»:

```ts
    `- "gasto": un pago hecho en el viaje. categoria es una clave de: ${(c.categorias?.map((x) => `${x.clave} (${x.nombre})`) ?? [...CATEGORIAS_BASE]).join(", ")}.`,
    "  combustible = grifo, petróleo, diésel · viaticos = comida, menú · reparacion_ruta = mecánico, auxilio · llantas_ruta = parche, vulcanizado.",
    "  monto en soles con decimales (el TOTAL a pagar, con IGV). fecha AAAA-MM-DD. proveedorRuc 11 dígitos. comprobante como B012-4471.",
    "  medioPago: tarjeta, yape_plin o efectivo si el comprobante lo dice; si no, null. kmOdometro: el kilometraje del vehículo si la boleta del grifo lo trae impreso (KM, ODOMETRO, KILOMETRAJE); si no, null.",
```

Agregar `medioPago: null, kmOdometro: 402380` a `EJEMPLO_JSON`.

`reglas.ts`:
- en `REGLAS`, reemplazar la última regla y agregar las nuevas antes de ella:

```ts
  [/\b(lavado|lavada)\b/, "lavado"],
  [/\b(llantas?|parche|parchado|vulcanizado|vulcanizadora)\b/, "llantas_ruta"],
  [/\b(aceite|engrase|grasa|lubricantes?)\b/, "lubricantes"],
  [/\b(custodia|resguardo)\b/, "resguardo"],
  [/\b(multa|papeleta)\b/, "multas"],
  [/\b(mecanico|reparacion|repuestos?|taller|auxilio)\b/, "reparacion_ruta"],
```

- el `return` final del gasto agrega `medioPago: null, kmOdometro: null`;
- el tipo de `REGLAS` pasa a `Array<[RegExp, string]>`.

- [ ] **Step 5: `lecturas.ts`**

- En `leerDocumento`, al armar el `contexto` que se pasa a `ia.leer`, agregar `categorias: (await listarCategorias(ctx, { soloActivas: true })).map(({ clave, nombre }) => ({ clave, nombre }))`.
- En el resultado ok de `leerDocumento`, agregar `contexto: describirContexto(await capturarContexto(ctx, { usuarioId: d.usuarioId ?? undefined }))`. Agregar `contexto: string | null` al tipo ok de `ResultadoLeer`. En los otros `return { ok: true, … }` del archivo, como `corregirLectura`, pasar también `contexto`.
- En `confirmarLectura`, rama gasto:

```ts
      const cat = await categoriaValida(ctx.db, l.categoria).catch(() => null);
      const r = await registrarGasto(ctx, {
        categoria: cat ? l.categoria : "otros_viaje", monto: aCentimos(l.monto), fecha: hoyStr, vehiculoId: o.vehiculoId ?? null,
        nota: [cat ? null : `categoría leída: ${l.categoria}`, l.nota].filter(Boolean).join(" · ") || null, proveedorNombre: l.proveedorNombre,
        proveedorRuc: l.proveedorRuc && validarRuc(l.proveedorRuc) ? l.proveedorRuc : null, comprobante: l.comprobante,
        medioPago: l.medioPago ?? undefined, kmVehiculo: l.kmOdometro,
        rutaFoto: d.tipo === "foto" ? d.rutaArchivo : null, documentoId, origen: "telegram", usuarioId: o.usuarioId,
      });
      return { tipo: "gasto", gastoId: r.id, viajeCodigo: r.viajeCodigo, monto: aCentimos(l.monto), avisoKm: r.avisoKm };
```

- Agregar `avisoKm: string | null` a la variante gasto de `ResultadoConfirmacion`. Importar `listarCategorias` y `categoriaValida` desde `../finanzas/categorias`, y `capturarContexto` y `describirContexto` desde `../finanzas/captura`.
- La fecha del gasto ya no es la de la boleta sino hoy (spec §6). La fecha leída se sigue viendo en el resumen de la lectura.

- [ ] **Step 6: Correr las pruebas**

Run: `pnpm vitest run packages/ia packages/core/test/lecturas.test.ts`
Expected: PASS. Si una prueba existente de lecturas esperaba la fecha de la boleta, cambiarla a la fecha de hoy del reloj de prueba (`2026-09-13`).

- [ ] **Step 7: Commit**

```bash
git add packages/ia packages/core
git commit -m "feat(ia): categorías dinámicas, forma de pago y km del voucher; el gasto confirmado va con fecha de hoy"
```

---

### Task 8: Bot — confirmación con contexto y km al cargar combustible

**Files:**
- Modify: `apps/bot/src/flujo-lectura.ts`, `apps/bot/src/flujo-flota.ts:196-230`
- Test: `apps/bot/test/flujo-lectura.test.ts`, `apps/bot/test/flujo-flota.test.ts`

**Interfaces:**
- Consumes:
  - `listarCategorias` y `nombreCategoria` (Task 2);
  - `ResultadoLeer.contexto` y `ResultadoConfirmacion.avisoKm` (Task 7);
  - `fijarLectura(ctx, documentoId, lectura)`, que ya existe;
  - `categoriaDesdeTexto` (Task 2).
- Produces: `EstadoFlujoLectura.paso` agrega `"km"`; callback `l:nokm:<id>`.

- [ ] **Step 1: Tests que fallan**

En `apps/bot/test/flujo-lectura.test.ts`, usando el arnés del archivo (`arnes.ts`: enviar texto, tocar botón y leer respuestas), agregar:

```ts
it("combustible sin km: al confirmar pide el km del tablero y lo guarda como km real", async () => {
  // enviar «grifo 350» → responde con resumen y botón ✅ Correcto (l:ok:<id>)
  // tocar l:ok:<id> → el bot pregunta «¿Km del tablero?» con botón «No sé»
  // enviar el km (odómetro actual + 200) → «✅ GASTO GUARDADO»
  // verificar con obtenerGasto que kmReal === true
});

it("combustible: «No sé» guarda con el último km", async () => {
  // igual, pero tocando l:nokm:<id> → «✅ GASTO GUARDADO» y kmReal === false
});

it("el resumen muestra unidad, viaje, forma de pago y km", async () => {
  // con un viaje en curso de la unidad del chofer, enviar «peaje 28» → la respuesta contiene «VJ-» y «efectivo del chofer»
});
```

Escribir cada prueba completa con las mismas funciones del arnés que usan las pruebas vecinas del archivo; no se inventan otras. Leer primero `apps/bot/test/arnes.ts` y una prueba existente de `flujo-lectura.test.ts`.

- [ ] **Step 2: Correr y ver que fallan**

Run: `pnpm vitest run apps/bot/test/flujo-lectura.test.ts`
Expected: FAIL.

- [ ] **Step 3: Cambios en `flujo-lectura.ts`**

- Imports: quitar `CATEGORIAS` y `Categoria` de `@sunatapp/ia`; importar `listarCategorias` y `nombreCategoria` de `@sunatapp/core`.
- `EstadoFlujoLectura`: `paso: "correccion" | "monto" | "km"; categoria?: string | "entrega"`.
- `ICONO` pasa a `Record<string, string>` con las claves nuevas: `llantas_ruta: "🛞"`, `reparacion_ruta: "🔧"`, `lavado: "🚿"`, `lubricantes: "🛢️"`, `resguardo: "🛡️"`, `multas: "🚨"`, `otros_viaje: "🧾"`. Al leer, usar `ICONO[cat] ?? "🧾"`.
- `resumenLectura(l, contexto?: string | null)`: en la cabeza, `nombreCategoria(l.categoria)` en vez de `NOMBRE_CATEGORIA[l.categoria]`. Agregar como última línea `contexto ? `📍 ${contexto}` : ""`, y en el detalle `l.kmOdometro ? `${l.kmOdometro.toLocaleString("en-US")} km` : null`.
- `notificarLectura`: pasar `r.contexto` a `resumenLectura`.
- `tecladoCategorias(id, categorias)`: recibe la lista (`await listarCategorias(deps.ctx, { tipo: "variable", soloActivas: true })`) y arma los botones con `c.clave` y `c.nombre`. `notificarLectura` no recibe `deps`, así que en el caso «¿Qué gasto es?» se arma con `CATEGORIAS_BASE` de `@sunatapp/ia` y `nombreCategoria` de `@sunatapp/core`. Las categorías propias se eligen corrigiendo con texto.
- En `manejarBoton`, rama `cat`: validar con `(await listarCategorias(deps.ctx, { soloActivas: true })).some((c) => c.clave === valor)`.
- En la rama `ok`, extraer el resto a `continuarGuardado(c, deps, id, preguntarKm = true)`:

```ts
async function continuarGuardado(c: ContextoBot, deps: Dependencias, id: number, preguntarKm = true): Promise<void> {
  const d = await obtenerDocumento(deps.ctx, id).catch(() => null);
  if (!d) return void (await c.reply("Ese mensaje ya no existe."));
  if (preguntarKm && d.lectura?.tipo === "gasto" && d.lectura.categoria === "combustible" && !d.lectura.kmOdometro) {
    c.session.flujo = { tipo: "lectura", paso: "km", documentoId: id } satisfies EstadoFlujoLectura;
    await c.reply("⛽ ¿Km del tablero? (escribe solo el número)", { reply_markup: new InlineKeyboard().text("No sé", `l:nokm:${id}`) });
    return;
  }
  const u = await unidadImplicita(c, deps, d.texto ?? undefined);
  if (!u) {
    await c.reply("¿De qué unidad es?", { reply_markup: tecladoUnidades(await listarUnidades(deps.ctx), `l:u:${id}:`) });
    return;
  }
  await guardar(c, deps, id, u.id);
}
```

  - La rama `ok` pasa a `await continuarGuardado(c, deps, id);`.
  - Nueva rama `nokm`: `delete c.session.flujo; await continuarGuardado(c, deps, id, false);`.
- En `manejarTexto`, antes del bloque `monto`:

```ts
  if (f?.paso === "km") {
    const km = Number(t.replace(/[,.\s]|km/gi, ""));
    if (!Number.isInteger(km) || km <= 0) return void (await c.reply("Escribe solo el número del tablero, por ejemplo 402380, o toca «No sé»."));
    delete c.session.flujo;
    const d = await obtenerDocumento(deps.ctx, f.documentoId);
    if (d.lectura?.tipo === "gasto") await fijarLectura(deps.ctx, f.documentoId, { ...d.lectura, kmOdometro: km });
    await continuarGuardado(c, deps, f.documentoId, false);
    return;
  }
```

- En el bloque `monto`, la lectura de gasto armada a mano agrega `medioPago: null, kmOdometro: null` y usa `categoria: f.categoria ?? "otros_viaje"`.
- En `guardar`, después de armar `texto` para `r.tipo === "gasto"`, agregar `(r.avisoKm ? `\n⚠️ ${r.avisoKm}` : "")`.

- [ ] **Step 4: `flujo-flota.ts` — `/gasto`**

- `USO_GASTO`: la línea de categorías pasa a `Categorías: combustible, peaje, viáticos, hospedaje, estiba, balanza, cochera, lavado, llanta, aceite, custodia, multa, mecánico, otros.`
- `guardarGasto`: `NOMBRE_CATEGORIA[...]` pasa a `nombreCategoria(g.categoria)`; `categoria: g.categoria as never` pasa a `categoria: g.categoria`. Agregar el aviso de km si `r.avisoKm`.
- `categoriaDesdeTexto` sigue importándose de `@sunatapp/core`, que ahora viene de `categorias.ts`.

- [ ] **Step 5: Correr las pruebas del bot**

Run: `pnpm vitest run apps/bot`
Expected: PASS. Las pruebas que esperaban el texto exacto del resumen deben aceptar ahora la línea `📍 …` al final.

- [ ] **Step 6: Commit**

```bash
git add apps/bot
git commit -m "feat(bot): confirmación con unidad, viaje, guía, pago y km; pide el km del tablero al cargar combustible"
```

---

### Task 9: Web — gasto mínimo y categorías dinámicas en todas las pantallas

**Files:**
- Modify:
  - `apps/web/src/paginas/finanzas.tsx:1-6,95-110,185-201`;
  - `apps/web/src/paginas/liquidacion.tsx:3-4,80-90,172-180`;
  - `apps/web/src/paginas/rutas.tsx:3-35,67`;
  - `apps/web/src/paginas/revisar.tsx:3-5,14-18,54,76`;
  - `apps/web/src/paginas/rentabilidad.tsx:3-6,145-146,204-214`;
  - `apps/web/src/paginas/estadisticas.tsx:4,146`
- Test: `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `listarCategorias`, `nombreCategoria`, `capturarContexto`, `describirContexto`, `NOMBRE_MEDIO_PAGO`, `registrarGasto` con `medioPago`/`kmVehiculo`.
- Produces: `POST /finanzas/gasto` acepta `categoria`, `monto` y `foto`, y como opcionales `vehiculoId`, `fecha`, `nota`, `medioPago` y `km`. `CamposPlantilla` y `plantillaDeFormulario` reciben la lista de categorías.

- [ ] **Step 1: Test que falla**

En `apps/web/test/web.test.ts`, dentro de `describe("con el dueño configurado")`:

```ts
it("gasto mínimo: solo monto y categoría; el resto se completa solo", async () => {
  const cookie = await entrar();
  await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
  const html = await (await app.request("/finanzas", { headers: { cookie } })).text();
  expect(html).toContain("Se guarda con");
  const fd = new FormData();
  fd.set("categoria", "peaje");
  fd.set("monto", "28.50");
  fd.set("vehiculoId", "1");
  const r = await app.request("/finanzas/gasto", { method: "POST", headers: { cookie, origin: ORIGEN }, body: fd });
  expect(r.status).toBe(303);
  const [g] = await ctx.db.select().from(gasto);
  expect(g).toMatchObject({ categoria: "peaje", monto: 2850, medioPago: "efectivo_chofer" });
  expect(g!.viajeId).not.toBeNull();
});

it("las categorías propias aparecen en el formulario de gasto", async () => {
  const cookie = await entrar();
  await crearCategoria(ctx, { nombre: "Guardianía", tipo: "variable" });
  expect(await (await app.request("/finanzas", { headers: { cookie } })).text()).toContain("Guardianía");
});
```

(Importar `crearCategoria` desde `@sunatapp/core` y `gasto` desde `../../../packages/db/src/index`.)

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm vitest run apps/web`
Expected: FAIL. Por compilación, pueden fallar además otras pruebas del archivo.

- [ ] **Step 3: `finanzas.tsx`**

- Imports: quitar `CATEGORIAS_GASTO`, `NOMBRE_CATEGORIA` y `type CategoriaGasto`; agregar `listarCategorias`, `capturarContexto`, `describirContexto`, `NOMBRE_MEDIO_PAGO` y `gasto`.
- En `vista`, al `Promise.all` agregar `listarCategorias(ctx, { soloActivas: true })` como `categorias`. Calcular la unidad por defecto (la del último gasto del usuario) y su contexto:

```ts
  const [ultimo] = await ctx.db.select({ v: gasto.vehiculoId }).from(gasto)
    .where(and(eq(gasto.usuarioId, c.get("usuario").id), isNotNull(gasto.vehiculoId))).orderBy(desc(gasto.id)).limit(1);
  const unidadDef = ultimo?.v ?? unidades[0]?.id ?? null;
  const previa = describirContexto(await capturarContexto(ctx, { vehiculoId: unidadDef }));
```

  (`and`, `eq`, `desc`, `isNotNull` y `gasto` se importan de `@sunatapp/db`; ya es dependencia de core. Si `apps/web` no lo declara en su `package.json`, agregar una función `ultimaUnidadDeUsuario(ctx, usuarioId)` en `finanzas.ts` del núcleo y usarla aquí.)
- Reemplazar el formulario `+ GASTO`:

```tsx
<form method="post" action="/finanzas/gasto" class="panel" enctype="multipart/form-data">
  <b class="lbl-12">+ GASTO</b>
  <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" required autofocus /></label>
  <label class="campo"><span>Categoría</span><select name="categoria">
    <optgroup label="Variables (del viaje)">{categorias.filter((k) => k.tipo === "variable").map((k) => <option value={k.clave}>{k.nombre}</option>)}</optgroup>
    <optgroup label="Fijos (del mes)">{categorias.filter((k) => k.tipo === "fijo").map((k) => <option value={k.clave}>{k.nombre}</option>)}</optgroup>
  </select></label>
  <label class="campo"><span>Foto del voucher</span><input type="file" name="foto" accept="image/*,application/pdf" /></label>
  <span class="muted" style="font-size:11px">Se guarda con: {previa} · ahora</span>
  <details class="plegable"><summary><span class="btn chico fantasma">cambiar</span></summary>
    <div class="filas" style="margin-top:6px">
      <label class="campo"><span>Unidad</span><select name="vehiculoId"><option value="">— general —</option>{unidades.map((u) => <option value={u.id} selected={u.id === unidadDef}>{u.codigo}</option>)}</select></label>
      <label class="campo"><span>Forma de pago</span><select name="medioPago"><option value="">automática</option>{Object.entries(NOMBRE_MEDIO_PAGO).map(([k, n]) => <option value={k}>{n}</option>)}</select></label>
      <label class="campo"><span>Km del tablero</span><input name="km" inputmode="numeric" /></label>
      <label class="campo"><span>Fecha</span><input type="date" name="fecha" value={h} /></label>
      <label class="campo"><span>Detalle</span><input name="nota" /></label>
    </div>
  </details>
  <button class="btn primario" type="submit">GUARDAR GASTO</button>
</form>
```

  Para que el `select` de unidad que está dentro de `details` se envíe aunque esté cerrado, dejar el valor por defecto `unidadDef`: el navegador envía los campos de un `<details>` cerrado igual.
- `POST /finanzas/gasto`: `categoria: f.categoria!`; agregar `medioPago: (f.medioPago || undefined) as MedioPago | undefined` y `kmVehiculo: f.km ? enteroONull(f.km) : null`. Mostrar el aviso de km si lo hay: `return r.avisoKm ? `Gasto guardado. ${r.avisoKm}` : "Gasto guardado";`.
- En la tabla de movimientos, si muestra la categoría con `NOMBRE_CATEGORIA`, usar `nombreCategoria(x, categorias)`.

- [ ] **Step 4: Resto de pantallas**

- `rutas.tsx`:
  - `plantillaDeFormulario(f, categorias: Categoria[])` recorre `categorias` (variables) en vez de `CATEGORIAS_GASTO`;
  - `CamposPlantilla(p: { categorias: Categoria[]; valores: Map<string, number>; promedio?: Map<string, number> })`;
  - en `vista` y en los `POST`, cargar `const variables = await listarCategorias(d.ctx, { tipo: "variable", soloActivas: true })` y pasarla;
  - `NOMBRE_CATEGORIA[l.categoria]` pasa a `nombreCategoria(l.categoria, variables)`.
- `liquidacion.tsx`:
  - usa `CamposPlantilla` y `plantillaDeFormulario` con la lista de variables;
  - el `select` de editar gasto usa `listarCategorias(ctx, { soloActivas: true })`;
  - `NOMBRE_CATEGORIA[g.categoria]` pasa a `nombreCategoria(g.categoria, categorias)`;
  - `f.categoria as CategoriaGasto` pasa a `f.categoria`.
- `revisar.tsx`:
  - `valores()` usa `"otros_viaje"` en vez de `"otros"`;
  - el `select` usa `listarCategorias(ctx, { soloActivas: true })`;
  - `NOMBRE_CATEGORIA[...]` pasa a `nombreCategoria(...)`.
- `rentabilidad.tsx`:
  - el presupuesto mensual recorre `await listarCategorias(ctx, { soloActivas: true })`, cargado en `vista` y en el `POST /rentabilidad/presupuesto`;
  - `Partial<Record<CategoriaGasto, number>>` pasa a `Partial<Record<string, number>>`.
- `estadisticas.tsx`: quitar el import y la línea `void NOMBRE_CATEGORIA;`.

- [ ] **Step 5: Compilar y correr las pruebas web**

Run: `pnpm -r exec tsc --noEmit`
Expected: sin errores en `apps/web`.

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): gasto con solo monto, categoría y foto; categorías propias en todas las pantallas"
```

---

### Task 10: Web — rentabilidad POR VIAJE / POR MES, desglose en el viaje y Excel

**Files:**
- Modify: `apps/web/src/paginas/rentabilidad.tsx` (`vista`), `apps/web/src/paginas/liquidacion.tsx` (KPIs del detalle), `apps/web/src/paginas/estadisticas.tsx:114-147` (libro Excel), `apps/web/src/paginas/dashboard.tsx` y `finanzas.tsx` (KPI de fijos)
- Test: `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `rentabilidadPorViaje`, `rentabilidadDeViaje`, `rentabilidadPorMes` (Task 6); `ResumenFinanciero.gastosFijos`/`gastosVariables` (Task 4).
- Produces: `GET /rentabilidad?vista=viaje|mes&unidad=<id>&desde=AAAA-MM&hasta=AAAA-MM`; el Excel agrega las hojas «Por viaje» y «Por mes».

- [ ] **Step 1: Test que falla**

```ts
it("rentabilidad: conmutador por viaje y por mes", async () => {
  const cookie = await entrar();
  const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "cerrado", km: 300, flete: 500000, origen: "web" });
  await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 150000, origen: "web" });
  let html = await (await app.request("/rentabilidad?vista=viaje", { headers: { cookie } })).text();
  expect(html).toContain("POR VIAJE");
  expect(html).toContain(v.codigo);
  expect(html).toContain("PROVISIONAL");
  html = await (await app.request("/rentabilidad?vista=mes", { headers: { cookie } })).text();
  expect(html).toContain("GANANCIA NETA");
  const x = await app.request(`/estadisticas.xlsx?desde=2026-09-01&hasta=2026-09-30`, { headers: { cookie } });
  expect(x.status).toBe(200);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm vitest run apps/web -t "conmutador"`
Expected: FAIL.

- [ ] **Step 3: `rentabilidad.tsx` — conmutador y tablas**

- En `vista`, leer:
  - `const vistaSel = c.req.query("vista") === "mes" ? "mes" : "viaje";`
  - `const unidadSel = c.req.query("unidad") ? Number(c.req.query("unidad")) : undefined;`
  - `const desdeMes = c.req.query("desde") ?? mesAnterior(h.slice(0, 7), 2);`
  - `const hastaMes = c.req.query("hasta") ?? h.slice(0, 7);`
  - con `desde = `${desdeMes}-01`` y `hasta = rangoMes(`${hastaMes}-01`).hasta`.
- Cargar `vistaSel === "viaje" ? await rentabilidadPorViaje(ctx, { desde, hasta, vehiculoId: unidadSel }) : await rentabilidadPorMes(ctx, { desde, hasta, vehiculoId: unidadSel, porUnidad: unidadSel === undefined && c.req.query("por") === "unidad" })`.
- Insertar al inicio del contenido de la página, antes del cotizador:

```tsx
<Panel titulo="RENTABILIDAD" der={
  <form method="get" action="/rentabilidad" class="linea" style="gap:6px;flex-wrap:wrap">
    <a class={`btn chico ${vistaSel === "viaje" ? "primario" : ""}`} href={`/rentabilidad?vista=viaje&desde=${desdeMes}&hasta=${hastaMes}${unidadSel ? `&unidad=${unidadSel}` : ""}`}>POR VIAJE</a>
    <a class={`btn chico ${vistaSel === "mes" ? "primario" : ""}`} href={`/rentabilidad?vista=mes&desde=${desdeMes}&hasta=${hastaMes}${unidadSel ? `&unidad=${unidadSel}` : ""}`}>POR MES</a>
    <input type="hidden" name="vista" value={vistaSel} />
    <select name="unidad" aria-label="Unidad" style="width:auto"><option value="">TODAS</option>{unidades.map((u) => <option value={u.id} selected={u.id === unidadSel}>{u.codigo}</option>)}</select>
    <input type="month" name="desde" value={desdeMes} aria-label="Desde" style="width:auto" />
    <input type="month" name="hasta" value={hastaMes} aria-label="Hasta" style="width:auto" />
    <button class="btn chico">VER</button>
  </form>
}>
  {vistaSel === "viaje" ? (
    (filasViaje.length === 0 ? <Vacio>No hay viajes cerrados en esos meses.</Vacio> : (
      <div class="tabla-wrap"><table class="t">
        <thead><tr><th>Viaje</th><th>Guía</th><th>Unid.</th><th>Ruta</th><th class="num">Flete</th><th class="num">Variables</th><th class="num">Contribución</th><th class="num">Fijo asignado</th><th class="num">Ganancia</th><th class="num">Margen</th></tr></thead>
        <tbody>{filasViaje.map((f) => (
          <tr>
            <td><a href={`/viajes/${f.viajeId}`}>{f.codigo}</a></td><td>{f.guia ?? <span class="chip cambiar">SIN GUÍA</span>}</td><td>{f.unidad}</td><td>{f.ruta}</td>
            <td class="num">{soles(f.flete)}</td><td class="num">{soles(f.variables)}</td><td class="num">{soles(f.contribucion)}</td>
            <td class="num">{soles(f.fijoAsignado)}{f.provisional ? <span class="chip proximo" style="margin-left:4px">PROVISIONAL</span> : null}</td>
            <td class="num"><b>{soles(f.ganancia)}</b></td><td class="num">{f.margenPct === null ? "—" : `${f.margenPct}%`}</td>
          </tr>
        ))}</tbody>
      </table></div>
    ))
  ) : (
    <div class="tabla-wrap"><table class="t">
      <thead><tr><th>Mes</th><th>Unid.</th><th class="num">Viajes</th><th class="num">Ingresos</th><th class="num">Variables</th><th class="num">Contribución</th><th class="num">Fijos</th><th class="num">GANANCIA NETA</th><th class="num">Margen</th></tr></thead>
      <tbody>{filasMes.map((m) => (
        <tr>
          <td>{nombreMes(m.mes)}{m.provisional ? <span class="chip proximo" style="margin-left:4px">PROVISIONAL</span> : null}</td><td>{m.unidad}</td>
          <td class="num">{m.viajes}</td><td class="num">{soles(m.ingresos)}</td><td class="num">{soles(m.variables)}</td><td class="num">{soles(m.contribucion)}</td>
          <td class="num"><details class="plegable"><summary>{soles(m.fijos)}</summary>{m.fijosDetalle.map((d) => <div style="font-size:11px">{d.nombre}: {soles(d.monto)}</div>)}</details></td>
          <td class="num"><b style={m.ganancia < 0 ? "color:var(--magenta)" : ""}>{soles(m.ganancia)}</b></td><td class="num">{m.margenPct === null ? "—" : `${m.margenPct}%`}</td>
        </tr>
      ))}</tbody>
    </table></div>
  )}
</Panel>
```

  Donde `filasViaje` y `filasMes` salen de la carga de arriba. Usar dos variables tipadas: `const filasViaje = vistaSel === "viaje" ? await … : []` y `const filasMes = vistaSel === "mes" ? await … : []`. Importar `mesAnterior`, `rentabilidadPorViaje` y `rentabilidadPorMes`. Si `var(--magenta)` no existe en `app.css`, usar el color de «negativo» que ya usan `Kpi`/`.chip.cambiar`: buscarlo con `grep -n "negativo\|--" apps/web/public/app.css | head`.

- [ ] **Step 4: Detalle del viaje (`liquidacion.tsx`)**

En la vista del detalle, cargar `const rent = await rentabilidadDeViaje(ctx, id);`. Si `rent` existe, en lugar del KPI «GANANCIA DEL VIAJE» mostrar tres KPIs:
- `CONTRIBUCIÓN` → `soles(rent.contribucion)`;
- `FIJO ASIGNADO` → `soles(rent.fijoAsignado)`, con `sub={rent.provisional ? "provisional" : undefined}`;
- `GANANCIA` → `soles(rent.ganancia)`, con `sub={rent.margenPct !== null ? `margen ${rent.margenPct}%` : undefined}`.

Si el viaje no está cerrado, dejar el KPI actual.

- [ ] **Step 5: Excel y KPIs**

- `estadisticas.tsx`, en la función que arma el libro, antes de `return Buffer.from(...)`, usar el mismo helper local de hojas del archivo (el que llama `libro.addWorksheet(nombre)`, línea 117):

```ts
  const pv = await rentabilidadPorViaje(ctx, { desde, hasta });
  hoja("Por viaje", [
    { header: "Viaje", key: "codigo" }, { header: "Guía", key: "guia" }, { header: "Unidad", key: "unidad" }, { header: "Ruta", key: "ruta", width: 28 },
    { header: "Flete", key: "flete", soles: true }, { header: "Variables", key: "variables", soles: true }, { header: "Contribución", key: "contribucion", soles: true },
    { header: "Fijo asignado", key: "fijoAsignado", soles: true }, { header: "Ganancia", key: "ganancia", soles: true }, { header: "Margen %", key: "margenPct" },
  ], pv.map((f) => ({ ...f, flete: f.flete / 100, variables: f.variables / 100, contribucion: f.contribucion / 100, fijoAsignado: f.fijoAsignado / 100, ganancia: f.ganancia / 100 })));
  const pm = await rentabilidadPorMes(ctx, { desde, hasta });
  hoja("Por mes", [
    { header: "Mes", key: "mes" }, { header: "Viajes", key: "viajes" }, { header: "Ingresos", key: "ingresos", soles: true }, { header: "Variables", key: "variables", soles: true },
    { header: "Contribución", key: "contribucion", soles: true }, { header: "Fijos", key: "fijos", soles: true }, { header: "Ganancia neta", key: "ganancia", soles: true },
    { header: "Margen %", key: "margenPct" },
  ], pm.map((m) => ({ ...m, ingresos: m.ingresos / 100, variables: m.variables / 100, contribucion: m.contribucion / 100, fijos: m.fijos / 100, ganancia: m.ganancia / 100 })));
```

  Ajustar el nombre del helper (`hoja`) y la forma en que convierte céntimos a soles a lo que el archivo ya hace en sus otras hojas: si el helper divide solo, no dividir aquí.
- `finanzas.tsx` y `dashboard.tsx`: donde está el KPI «GASTOS DEL MES», agregar `sub={`variables ${soles(fin.gastosVariables)} · fijos ${soles(fin.gastosFijos)}`}`.

- [ ] **Step 6: Correr las pruebas**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): rentabilidad por viaje o por mes, desglose del fijo en el viaje y hojas en Excel"
```

---

### Task 11: Web — Ajustes (categorías y costos fijos) y Por revisar (viajes)

**Files:**
- Modify: `apps/web/src/paginas/ajustes.tsx`, `apps/web/src/paginas/revisar.tsx`
- Test: `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `listarCategorias`, `crearCategoria`, `desactivarCategoria` (Task 2); `crearCostoFijo`, `editarCostoFijo`, `listarCostosFijos` (Task 4); `viajesPorRevisar` (Task 5).
- Produces:
  - `POST /ajustes/categoria` (`nombre`, `tipo`);
  - `POST /ajustes/categoria/:clave/desactivar`;
  - `POST /ajustes/costo-fijo` (`concepto`, `categoria`, `monto`, `periodicidad`, `vehiculoId`, `desde`);
  - `POST /ajustes/costo-fijo/:id` (`monto`, `activo`).

- [ ] **Step 1: Test que falla**

```ts
it("ajustes: crear categoría y costo fijo; por revisar muestra viajes sin guía", async () => {
  const cookie = await entrar();
  expect((await post(cookie, "/ajustes/categoria", { nombre: "Guardianía", tipo: "variable" })).status).toBe(303);
  expect((await post(cookie, "/ajustes/costo-fijo", { concepto: "Sueldo T-01", categoria: "sueldo_chofer", monto: "2500", periodicidad: "mensual", vehiculoId: "1", desde: "2026-09-01" })).status).toBe(303);
  const html = await (await app.request("/ajustes", { headers: { cookie } })).text();
  expect(html).toContain("Guardianía");
  expect(html).toContain("Sueldo T-01");
  await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Puno", estado: "en_curso", origen: "web" });
  expect(await (await app.request("/revisar", { headers: { cookie } })).text()).toContain("SIN GUÍA");
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm vitest run apps/web -t "ajustes: crear categoría"`
Expected: FAIL.

- [ ] **Step 3: `ajustes.tsx`**

En `vista`, cargar también `listarCategorias(ctx)`, `listarCostosFijos(ctx, false)` y `listarUnidades(ctx)`. Agregar dos paneles después de «USUARIOS Y ROLES»:

```tsx
<Panel titulo="COSTOS FIJOS · SE CARGAN SOLOS CADA MES">
  <div class="tabla-wrap"><table class="t">
    <thead><tr><th>Concepto</th><th>Categoría</th><th>Unidad</th><th class="num">Monto</th><th>Cada</th><th>Desde</th><th></th></tr></thead>
    <tbody>{fijos.map((f) => (
      <tr>
        <td><b>{f.concepto}</b>{!f.activo ? <span class="chip neutro" style="margin-left:4px">INACTIVO</span> : null}</td>
        <td>{nombreCategoria(f.categoria, categorias)}</td><td>{f.unidad ?? "General"}</td><td class="num">{soles2(f.monto)}</td>
        <td>{f.periodicidad === "anual" ? "año (1/12 por mes)" : "mes"}</td><td>{f.desde}</td>
        <td><details class="plegable"><summary><span class="btn chico">EDITAR</span></summary>
          <form method="post" action={`/ajustes/costo-fijo/${f.id}`} class="filas" style="margin-top:6px">
            <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" value={(f.monto / 100).toFixed(2)} /></label>
            <label class="campo" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" name="activo" value="1" checked={f.activo} style="width:auto;min-height:0" /><span style="text-transform:none">Activo</span></label>
            <button class="btn primario chico">GUARDAR</button>
          </form></details></td>
      </tr>
    ))}</tbody>
  </table></div>
  <form method="post" action="/ajustes/costo-fijo" class="form-grid" style="margin-top:8px">
    <label class="campo"><span>Concepto *</span><input name="concepto" required placeholder="Sueldo chofer T-01" /></label>
    <label class="campo"><span>Categoría</span><select name="categoria">{categorias.filter((k) => k.tipo === "fijo" && k.activa).map((k) => <option value={k.clave}>{k.nombre}</option>)}</select></label>
    <label class="campo"><span>Monto S/ *</span><input name="monto" inputmode="decimal" required /></label>
    <label class="campo"><span>Cada</span><select name="periodicidad"><option value="mensual">mes</option><option value="anual">año</option></select></label>
    <label class="campo"><span>Unidad</span><select name="vehiculoId"><option value="">General</option>{unidades.map((u) => <option value={u.id}>{u.codigo}</option>)}</select></label>
    <label class="campo"><span>Desde</span><input type="date" name="desde" /></label>
    <button class="btn primario" type="submit">AGREGAR FIJO</button>
  </form>
</Panel>
<Panel titulo="CATEGORÍAS DE GASTO">
  <div class="tabla-wrap"><table class="t">
    <thead><tr><th>Nombre</th><th>Tipo</th><th></th></tr></thead>
    <tbody>{categorias.map((k) => (
      <tr>
        <td>{k.nombre}{k.sistema ? <span class="chip neutro" style="margin-left:4px">DE FÁBRICA</span> : null}{!k.activa ? <span class="chip neutro" style="margin-left:4px">INACTIVA</span> : null}</td>
        <td>{k.tipo === "fijo" ? "Fijo" : "Variable"}</td>
        <td>{k.activa ? <form method="post" action={`/ajustes/categoria/${k.clave}/desactivar`}><button class="btn chico fantasma">DESACTIVAR</button></form> : null}</td>
      </tr>
    ))}</tbody>
  </table></div>
  <form method="post" action="/ajustes/categoria" class="linea" style="gap:6px;margin-top:8px">
    <input name="nombre" required placeholder="Nueva categoría" style="flex:2" />
    <select name="tipo" style="flex:1"><option value="variable">Variable (del viaje)</option><option value="fijo">Fijo (del mes)</option></select>
    <button class="btn primario chico">CREAR</button>
  </form>
</Panel>
```

Rutas, con el patrón `accion`/`formulario` del archivo y `parsearMonto` para el monto:

```ts
  app.post("/ajustes/categoria", async (c) => {
    const f = await formulario(c);
    return accion(c, "/ajustes", async () => {
      const clave = await crearCategoria(d.ctx, { nombre: f.nombre ?? "", tipo: f.tipo === "fijo" ? "fijo" : "variable", usuarioId: c.get("usuario").id });
      return `Categoría creada (${clave})`;
    });
  });
  app.post("/ajustes/categoria/:clave/desactivar", async (c) => accion(c, "/ajustes", async () => {
    await desactivarCategoria(d.ctx, c.req.param("clave"), c.get("usuario").id);
    return "Categoría desactivada";
  }));
  app.post("/ajustes/costo-fijo", async (c) => {
    const f = await formulario(c);
    return accion(c, "/ajustes", async () => {
      const monto = parsearMonto(f.monto ?? "");
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      await crearCostoFijo(d.ctx, {
        concepto: f.concepto ?? "", categoria: f.categoria ?? "", monto, periodicidad: f.periodicidad === "anual" ? "anual" : "mensual",
        vehiculoId: f.vehiculoId ? Number(f.vehiculoId) : null, desde: f.desde || undefined, usuarioId: c.get("usuario").id,
      });
      return "Costo fijo agregado: se carga solo cada mes";
    });
  });
  app.post("/ajustes/costo-fijo/:id", async (c) => {
    const f = await formulario(c);
    return accion(c, "/ajustes", async () => {
      const monto = f.monto ? parsearMonto(f.monto) : undefined;
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      await editarCostoFijo(d.ctx, Number(c.req.param("id")), { ...(monto !== undefined ? { monto } : {}), activo: f.activo === "1" }, c.get("usuario").id);
      return "Costo fijo guardado";
    });
  });
```

Importar `crearCategoria`, `desactivarCategoria`, `listarCategorias`, `nombreCategoria`, `crearCostoFijo`, `editarCostoFijo`, `listarCostosFijos`, `listarUnidades` y `parsearMonto` desde `@sunatapp/core`, y `soles2` desde `../ui`.

- [ ] **Step 4: `revisar.tsx` — panel de viajes**

En `vista`, al `Promise.all` agregar `viajesPorRevisar(ctx)` como `viajesRev`, y sumar `viajesRev.length` al contador del título. Agregar un panel:

```tsx
<Panel titulo={`VIAJES Y GUÍAS · ${viajesRev.length}`}>
  {viajesRev.length === 0 ? <Vacio>Todos los viajes tienen su guía y sus datos completos.</Vacio> : viajesRev.map((x) => (
    <div class="linea" style="justify-content:space-between;gap:8px;border-bottom:1px solid var(--linea, #E4D9C6);padding:6px 0">
      <span><span class={`chip ${x.motivo === "guia_rechazada" ? "cambiar" : "proximo"}`}>{{ sin_guia: "SIN GUÍA", guia_rechazada: "GUÍA RECHAZADA", cierre_automatico: "CERRADO SOLO", guia_sin_viaje: "GUÍA SIN VIAJE" }[x.motivo]}</span> <b>{x.codigo}</b> · {x.detalle}</span>
      {x.viajeId ? <a class="btn chico" href={`/viajes/${x.viajeId}`}>ABRIR</a> : null}
    </div>
  ))}
</Panel>
```

Importar `viajesPorRevisar`.

- [ ] **Step 5: Correr las pruebas**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): Ajustes con categorías y costos fijos; Por revisar con viajes sin guía, rechazadas y cerrados solos"
```

---

### Task 12: Demo, verificación completa y recorrido en la app

**Files:**
- Modify: `packages/core/scripts/demo-flota.ts:16,97` y la sección de viajes
- Test: suite completa + recorrido manual

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Demo con fijos y viajes desde guías**

En `demo-flota.ts`:
- `type CategoriaGasto` ya es `string`; la plantilla de gastos queda igual (claves que siguen existiendo).
- Después de crear las unidades, agregar los fijos:

```ts
for (const u of await listarUnidades(ctx)) {
  await crearCostoFijo(ctx, { concepto: `Sueldo chofer ${u.codigo}`, categoria: "sueldo_chofer", monto: 250000, periodicidad: "mensual", vehiculoId: u.id, desde: inicio });
  await crearCostoFijo(ctx, { concepto: `SOAT ${u.codigo}`, categoria: "soat", monto: 140000, periodicidad: "anual", vehiculoId: u.id, desde: inicio });
  await crearCostoFijo(ctx, { concepto: `GPS ${u.codigo}`, categoria: "gps", monto: 9000, periodicidad: "mensual", vehiculoId: u.id, desde: inicio });
}
await crearCostoFijo(ctx, { concepto: "Contador", categoria: "contador", monto: 80000, periodicidad: "mensual", desde: inicio });
await crearCostoFijo(ctx, { concepto: "Oficina Juliaca", categoria: "local", monto: 120000, periodicidad: "mensual", desde: inicio });
```

- En los últimos 10 viajes de la demo, en lugar de `registrarViajeFlota`, registrar una guía con `registrarGuiaBorrador(ctx, entrada)` y cerrar el viaje que crea (`alRegistrarGuia` corre sola). La `entrada` usa la placa de la unidad, el DNI del chofer sembrado y los ubigeos de origen y destino (`211101` Juliaca, `040101` Arequipa, `080101` Cusco, `230101` Tacna); se arma igual que `entradaGuia()` de `packages/core/test/helpers.ts`. Luego registrar gastos con `kmVehiculo` en el combustible, para que haya km reales.

- [ ] **Step 2: Suite completa y tipos**

Run: `pnpm -r exec tsc --noEmit`
Expected: sin errores.

Run: `pnpm test`
Expected: todas las pruebas PASS. Si algo falla, arreglarlo antes de seguir, sin saltar pruebas.

- [ ] **Step 3: Regenerar la demo y recorrerla en la app**

```bash
rm -rf data-demo
pnpm demo:flota
DATA_DIR=./data-demo STORAGE_DIR=./data-demo/storage WEB_PUERTO=3001 pnpm web
```

En el navegador (`http://localhost:3001`), verificar:
1. **Finanzas → + GASTO** muestra solo monto, categoría y foto, con la línea «Se guarda con: …».
2. **Rentabilidad → POR VIAJE** tiene filas con fijo asignado y el mes actual marcado PROVISIONAL; **POR MES** muestra los fijos desglosados.
3. El **detalle de un viaje cerrado** muestra contribución, fijo asignado y ganancia.
4. **Ajustes** muestra las categorías (fijas y variables) y los costos fijos de la demo.
5. **Estadísticas → EXCEL** trae las hojas «Por viaje» y «Por mes».
6. **Por revisar** muestra solo los viajes nuevos sin guía, no los 129 antiguos de la demo.

- [ ] **Step 4: Commit**

```bash
git add packages/core/scripts/demo-flota.ts
git commit -m "chore(demo): costos fijos y viajes creados desde guías en los datos de ejemplo"
```
