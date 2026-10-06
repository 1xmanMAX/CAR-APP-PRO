CREATE TABLE "valor_referencial_ruta" (
	"partida_ubigeo" text NOT NULL,
	"llegada_ubigeo" text NOT NULL,
	"vr_por_tm" bigint NOT NULL,
	"fuente" text,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"sinc_uid" text, "sinc_disp" text, "sinc_num" bigint, "sinc_creado" bigint, "sinc_tocado" bigint,
	CONSTRAINT "valor_referencial_ruta_partida_ubigeo_llegada_ubigeo_pk" PRIMARY KEY("partida_ubigeo","llegada_ubigeo")
);
--> statement-breakpoint
ALTER TABLE "factura" ADD COLUMN "vr_servicio" bigint;--> statement-breakpoint
ALTER TABLE "factura" ADD COLUMN "vr_carga_efectiva" bigint;--> statement-breakpoint
ALTER TABLE "factura" ADD COLUMN "vr_carga_util" bigint;--> statement-breakpoint
ALTER TABLE "factura" ADD COLUMN "detalle_viaje" text;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "configuracion_vehicular" text;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "carga_util_tm" numeric(8, 2);--> statement-breakpoint
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
      WHEN 'valor_referencial_ruta' THEN (SELECT 'vr:' || (j->>'partida_ubigeo') || ':' || (j->>'llegada_ubigeo'))
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
CREATE UNIQUE INDEX "valor_referencial_ruta_sinc_uid" ON "valor_referencial_ruta" ("sinc_uid");--> statement-breakpoint
CREATE TRIGGER "valor_referencial_ruta_sinc" BEFORE INSERT OR UPDATE ON "valor_referencial_ruta" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();--> statement-breakpoint
CREATE TRIGGER "valor_referencial_ruta_sinc_lapida" AFTER DELETE ON "valor_referencial_ruta" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
