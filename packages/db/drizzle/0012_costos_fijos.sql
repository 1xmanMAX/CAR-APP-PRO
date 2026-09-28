-- Costos fijos y variables (spec 2026-09-27). Las categorías dejan de ser un enum y pasan a una
-- tabla (fábrica + propias). El enum se borra antes de crear la tabla: Postgres no deja un tipo y
-- una tabla con el mismo nombre.
ALTER TABLE "gasto" ALTER COLUMN "categoria" SET DATA TYPE text USING "categoria"::text;--> statement-breakpoint
ALTER TABLE "ruta_presupuesto" ALTER COLUMN "categoria" SET DATA TYPE text USING "categoria"::text;--> statement-breakpoint
ALTER TABLE "viaje_presupuesto" ALTER COLUMN "categoria" SET DATA TYPE text USING "categoria"::text;--> statement-breakpoint
DROP TYPE "public"."categoria_gasto";--> statement-breakpoint
CREATE TYPE "public"."medio_pago" AS ENUM('efectivo_chofer', 'efectivo', 'yape_plin', 'transferencia', 'tarjeta', 'credito');--> statement-breakpoint
CREATE TYPE "public"."periodicidad" AS ENUM('mensual', 'anual');--> statement-breakpoint
CREATE TYPE "public"."tipo_categoria" AS ENUM('fijo', 'variable');--> statement-breakpoint
CREATE TABLE "categoria_gasto" (
	"clave" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_categoria" NOT NULL,
	"sistema" boolean DEFAULT false NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"orden" integer DEFAULT 100 NOT NULL,
	"sinc_uid" text, "sinc_disp" text, "sinc_num" bigint, "sinc_creado" bigint, "sinc_tocado" bigint
);
--> statement-breakpoint
CREATE TABLE "costo_fijo" (
	"id" serial PRIMARY KEY NOT NULL,
	"concepto" text NOT NULL,
	"categoria" text NOT NULL,
	"monto" bigint NOT NULL,
	"periodicidad" "periodicidad" DEFAULT 'mensual' NOT NULL,
	"vehiculo_id" integer,
	"medio_pago" "medio_pago" DEFAULT 'transferencia' NOT NULL,
	"desde" date NOT NULL,
	"hasta" date,
	"activo" boolean DEFAULT true NOT NULL,
	"usuario_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"sinc_uid" text, "sinc_disp" text, "sinc_num" bigint, "sinc_creado" bigint, "sinc_tocado" bigint
);
--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "guia_id" integer;--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "medio_pago" "medio_pago";--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "km_vehiculo" integer;--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "km_real" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "costo_fijo_id" integer;--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "cuota_id" integer;--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "periodo" text;--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "cierre_automatico" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sinc_marcar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  det text;
  j jsonb;
BEGIN
  -- Al aplicar lo que llega de otro dispositivo se respetan sus códigos y su hora.
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
      -- Los gastos que generan los fijos y las cuotas nacen iguales en cada dispositivo: mismo código.
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
  -- Si vuelve algo con el mismo código (se borró y se volvió a crear), deja de estar borrado.
  DELETE FROM sinc_borrado WHERE tabla = TG_TABLE_NAME AND uid = NEW.sinc_uid;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "categoria_gasto_sinc_uid" ON "categoria_gasto" ("sinc_uid");--> statement-breakpoint
CREATE TRIGGER "categoria_gasto_sinc" BEFORE INSERT OR UPDATE ON "categoria_gasto" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();--> statement-breakpoint
CREATE TRIGGER "categoria_gasto_sinc_lapida" AFTER DELETE ON "categoria_gasto" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();--> statement-breakpoint
CREATE UNIQUE INDEX "costo_fijo_sinc_uid" ON "costo_fijo" ("sinc_uid");--> statement-breakpoint
CREATE TRIGGER "costo_fijo_sinc" BEFORE INSERT OR UPDATE ON "costo_fijo" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();--> statement-breakpoint
CREATE TRIGGER "costo_fijo_sinc_lapida" AFTER DELETE ON "costo_fijo" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();--> statement-breakpoint
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
  ('otros_fijos', 'Otros fijos', 'fijo', true, 32);--> statement-breakpoint
UPDATE "gasto" SET "categoria" = 'reparacion_ruta' WHERE "categoria" = 'reparacion';--> statement-breakpoint
UPDATE "gasto" SET "categoria" = 'otros_viaje' WHERE "categoria" = 'otros';--> statement-breakpoint
UPDATE "ruta_presupuesto" SET "categoria" = CASE "categoria" WHEN 'reparacion' THEN 'reparacion_ruta' WHEN 'otros' THEN 'otros_viaje' ELSE "categoria" END;--> statement-breakpoint
UPDATE "viaje_presupuesto" SET "categoria" = CASE "categoria" WHEN 'reparacion' THEN 'reparacion_ruta' WHEN 'otros' THEN 'otros_viaje' ELSE "categoria" END;--> statement-breakpoint
-- Los cambios preventivos de Reparaciones son mantenimiento (fijo).
UPDATE "gasto" g SET "categoria" = 'mantenimiento' FROM "reparacion" r WHERE r."gasto_id" = g."id" AND r."tipo" = 'preventivo';--> statement-breakpoint
ALTER TABLE "costo_fijo" ADD CONSTRAINT "costo_fijo_categoria_categoria_gasto_clave_fk" FOREIGN KEY ("categoria") REFERENCES "public"."categoria_gasto"("clave") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costo_fijo" ADD CONSTRAINT "costo_fijo_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costo_fijo" ADD CONSTRAINT "costo_fijo_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_categoria_categoria_gasto_clave_fk" FOREIGN KEY ("categoria") REFERENCES "public"."categoria_gasto"("clave") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_guia_id_guia_transportista_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."guia_transportista"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_costo_fijo_id_costo_fijo_id_fk" FOREIGN KEY ("costo_fijo_id") REFERENCES "public"."costo_fijo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_cuota_id_cuota_prestamo_id_fk" FOREIGN KEY ("cuota_id") REFERENCES "public"."cuota_prestamo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruta_presupuesto" ADD CONSTRAINT "ruta_presupuesto_categoria_categoria_gasto_clave_fk" FOREIGN KEY ("categoria") REFERENCES "public"."categoria_gasto"("clave") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viaje_presupuesto" ADD CONSTRAINT "viaje_presupuesto_categoria_categoria_gasto_clave_fk" FOREIGN KEY ("categoria") REFERENCES "public"."categoria_gasto"("clave") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_fijo_periodo" UNIQUE("costo_fijo_id","periodo");--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_cuota" UNIQUE("cuota_id");--> statement-breakpoint
-- La guía de cada gasto antiguo, solo si su viaje tiene una única guía.
UPDATE "gasto" g SET "guia_id" = x."guia_id" FROM (
  SELECT "viaje_id", min("id") AS "guia_id" FROM "guia_transportista" WHERE "viaje_id" IS NOT NULL GROUP BY "viaje_id" HAVING count(*) = 1
) x WHERE g."viaje_id" = x."viaje_id";--> statement-breakpoint
-- Desde cuándo se marcan en «Por revisar» los viajes sin guía (los anteriores a este cambio no).
INSERT INTO "ajuste" ("clave", "valor") VALUES ('viajes_sin_guia_desde', to_jsonb(now()::text)) ON CONFLICT ("clave") DO NOTHING;
