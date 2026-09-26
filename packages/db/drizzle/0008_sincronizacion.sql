-- Sincronización entre dispositivos sin servidor (diseño tomado de PixPin, docs/sincronizacion.md).
-- Cada fila sincronizable lleva sus códigos: sinc_uid (único en todo el grupo), sinc_disp + sinc_num
-- (el dispositivo donde nació y su número allí: «47·K7Q2») y sinc_creado; sinc_tocado es la hora del
-- último cambio. Los disparadores los ponen solos: la lógica de negocio no se entera.
CREATE TABLE "sinc_estado" ("clave" text PRIMARY KEY NOT NULL, "valor" text NOT NULL);
--> statement-breakpoint
CREATE SEQUENCE "sinc_contador";
--> statement-breakpoint
CREATE TABLE "sinc_borrado" ("tabla" text NOT NULL, "uid" text NOT NULL, "en" bigint NOT NULL, CONSTRAINT "sinc_borrado_pk" PRIMARY KEY("tabla","uid"));
--> statement-breakpoint
CREATE TABLE "sinc_base" ("par" text NOT NULL, "clave" text NOT NULL, "resumen" text NOT NULL, CONSTRAINT "sinc_base_pk" PRIMARY KEY("par","clave"));
--> statement-breakpoint
CREATE TABLE "sinc_objeto" ("resumen" text PRIMARY KEY NOT NULL, "datos" jsonb NOT NULL);
--> statement-breakpoint
CREATE TABLE "sinc_historial" ("id" serial PRIMARY KEY NOT NULL, "par" text NOT NULL, "par_nombre" text NOT NULL, "inicio" timestamp with time zone NOT NULL, "fin" timestamp with time zone, "dirigi" boolean NOT NULL, "resultado" jsonb, "error" text);
--> statement-breakpoint
CREATE FUNCTION "sinc_ahora"() RETURNS bigint LANGUAGE sql AS $$ SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint $$;
--> statement-breakpoint
CREATE FUNCTION "sinc_marcar"() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE FUNCTION "sinc_lapida"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sinc_uid IS NOT NULL THEN
    INSERT INTO sinc_borrado (tabla, uid, en) VALUES (TG_TABLE_NAME, OLD.sinc_uid, sinc_ahora())
      ON CONFLICT (tabla, uid) DO UPDATE SET en = excluded.en;
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "viaje_en_curso_vehiculo";
--> statement-breakpoint
DROP INDEX IF EXISTS "parte_activa_unica";
--> statement-breakpoint
ALTER TABLE "empresa" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "conductor" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "contraparte" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "tipo_parte" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "repuesto" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "ruta" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "ruta_presupuesto" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "viaje_presupuesto" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "entrega" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "guia_transportista" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "guia_item" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "factura" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "factura_guia" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "cobro" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "lectura_odometro" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "parte_instalada" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "compra_repuesto" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "reparacion" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "reparacion_repuesto" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "ingreso" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "reinversion" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "prestamo" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "cuota_prestamo" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "evento_telegram" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "cotizacion" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
ALTER TABLE "ajuste" ADD COLUMN "sinc_uid" text, ADD COLUMN "sinc_disp" text, ADD COLUMN "sinc_num" bigint, ADD COLUMN "sinc_creado" bigint, ADD COLUMN "sinc_tocado" bigint;
--> statement-breakpoint
UPDATE "empresa" t SET sinc_uid = coalesce(md5('empresa'), md5('legado:empresa:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "conductor" t SET sinc_uid = coalesce(md5('conductor:' || t.numero_doc), md5('legado:conductor:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "usuario" t SET sinc_uid = coalesce(md5(CASE WHEN t.email IS NULL THEN NULL ELSE 'usuario:' || lower(t.email) END), md5('legado:usuario:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "vehiculo" t SET sinc_uid = coalesce(md5('vehiculo:' || upper(regexp_replace(t.placa, '[^A-Za-z0-9]', '', 'g'))), md5('legado:vehiculo:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "contraparte" t SET sinc_uid = coalesce(md5('contraparte:' || t.numero_doc), md5('legado:contraparte:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "tipo_parte" t SET sinc_uid = coalesce(md5('tipo_parte:' || t.codigo), md5('legado:tipo_parte:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "repuesto" t SET sinc_uid = coalesce(md5('legado:repuesto:' || t.id), md5('legado:repuesto:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "ruta" t SET sinc_uid = coalesce(md5('ruta:' || t.nombre_normalizado), md5('legado:ruta:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "ruta_presupuesto" t SET sinc_uid = coalesce(md5('rp:' || (SELECT sinc_uid FROM ruta WHERE id = t.ruta_id) || ':' || t.categoria), replace(gen_random_uuid()::text, '-', '')), sinc_num = 0, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "viaje" t SET sinc_uid = coalesce(md5('legado:viaje:' || t.id), md5('legado:viaje:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "viaje_presupuesto" t SET sinc_uid = coalesce(md5('vp:' || (SELECT sinc_uid FROM viaje WHERE id = t.viaje_id) || ':' || t.categoria), replace(gen_random_uuid()::text, '-', '')), sinc_num = 0, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "entrega" t SET sinc_uid = coalesce(md5('legado:entrega:' || t.id), md5('legado:entrega:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "gasto" t SET sinc_uid = coalesce(md5('legado:gasto:' || t.id), md5('legado:gasto:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "guia_transportista" t SET sinc_uid = coalesce(md5('legado:guia_transportista:' || t.id), md5('legado:guia_transportista:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "guia_item" t SET sinc_uid = coalesce(md5('legado:guia_item:' || t.id), md5('legado:guia_item:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "factura" t SET sinc_uid = coalesce(md5('legado:factura:' || t.id), md5('legado:factura:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "factura_guia" t SET sinc_uid = coalesce(md5('fg:' || (SELECT sinc_uid FROM guia_transportista WHERE id = t.guia_id)), replace(gen_random_uuid()::text, '-', '')), sinc_num = 0, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "cobro" t SET sinc_uid = coalesce(md5('legado:cobro:' || t.id), md5('legado:cobro:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "lectura_odometro" t SET sinc_uid = coalesce(md5('legado:lectura_odometro:' || t.id), md5('legado:lectura_odometro:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "parte_instalada" t SET sinc_uid = coalesce(md5('legado:parte_instalada:' || t.id), md5('legado:parte_instalada:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "compra_repuesto" t SET sinc_uid = coalesce(md5('legado:compra_repuesto:' || t.id), md5('legado:compra_repuesto:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "reparacion" t SET sinc_uid = coalesce(md5('legado:reparacion:' || t.id), md5('legado:reparacion:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "reparacion_repuesto" t SET sinc_uid = coalesce(md5('legado:reparacion_repuesto:' || t.id), md5('legado:reparacion_repuesto:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "ingreso" t SET sinc_uid = coalesce(md5('legado:ingreso:' || t.id), md5('legado:ingreso:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "reinversion" t SET sinc_uid = coalesce(md5('legado:reinversion:' || t.id), md5('legado:reinversion:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "prestamo" t SET sinc_uid = coalesce(md5('legado:prestamo:' || t.id), md5('legado:prestamo:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "cuota_prestamo" t SET sinc_uid = coalesce(md5('cuota:' || (SELECT sinc_uid FROM prestamo WHERE id = t.prestamo_id) || ':' || t.numero), md5('legado:cuota_prestamo:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "evento_telegram" t SET sinc_uid = coalesce(md5('legado:evento_telegram:' || t.id), md5('legado:evento_telegram:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "cotizacion" t SET sinc_uid = coalesce(md5('legado:cotizacion:' || t.id), md5('legado:cotizacion:' || t.id)), sinc_num = t.id, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
UPDATE "ajuste" t SET sinc_uid = md5('ajuste:' || t.clave), sinc_num = 0, sinc_creado = 0, sinc_tocado = 0;
--> statement-breakpoint
CREATE UNIQUE INDEX "empresa_sinc_uid" ON "empresa" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "empresa_sinc" BEFORE INSERT OR UPDATE ON "empresa" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "empresa_sinc_lapida" AFTER DELETE ON "empresa" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "conductor_sinc_uid" ON "conductor" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "conductor_sinc" BEFORE INSERT OR UPDATE ON "conductor" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "conductor_sinc_lapida" AFTER DELETE ON "conductor" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "usuario_sinc_uid" ON "usuario" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "usuario_sinc" BEFORE INSERT OR UPDATE ON "usuario" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "usuario_sinc_lapida" AFTER DELETE ON "usuario" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "vehiculo_sinc_uid" ON "vehiculo" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "vehiculo_sinc" BEFORE INSERT OR UPDATE ON "vehiculo" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "vehiculo_sinc_lapida" AFTER DELETE ON "vehiculo" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "contraparte_sinc_uid" ON "contraparte" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "contraparte_sinc" BEFORE INSERT OR UPDATE ON "contraparte" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "contraparte_sinc_lapida" AFTER DELETE ON "contraparte" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "tipo_parte_sinc_uid" ON "tipo_parte" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "tipo_parte_sinc" BEFORE INSERT OR UPDATE ON "tipo_parte" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "tipo_parte_sinc_lapida" AFTER DELETE ON "tipo_parte" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "repuesto_sinc_uid" ON "repuesto" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "repuesto_sinc" BEFORE INSERT OR UPDATE ON "repuesto" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "repuesto_sinc_lapida" AFTER DELETE ON "repuesto" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "ruta_sinc_uid" ON "ruta" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "ruta_sinc" BEFORE INSERT OR UPDATE ON "ruta" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "ruta_sinc_lapida" AFTER DELETE ON "ruta" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "ruta_presupuesto_sinc_uid" ON "ruta_presupuesto" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "ruta_presupuesto_sinc" BEFORE INSERT OR UPDATE ON "ruta_presupuesto" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "ruta_presupuesto_sinc_lapida" AFTER DELETE ON "ruta_presupuesto" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "viaje_sinc_uid" ON "viaje" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "viaje_sinc" BEFORE INSERT OR UPDATE ON "viaje" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "viaje_sinc_lapida" AFTER DELETE ON "viaje" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "viaje_presupuesto_sinc_uid" ON "viaje_presupuesto" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "viaje_presupuesto_sinc" BEFORE INSERT OR UPDATE ON "viaje_presupuesto" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "viaje_presupuesto_sinc_lapida" AFTER DELETE ON "viaje_presupuesto" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "entrega_sinc_uid" ON "entrega" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "entrega_sinc" BEFORE INSERT OR UPDATE ON "entrega" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "entrega_sinc_lapida" AFTER DELETE ON "entrega" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "gasto_sinc_uid" ON "gasto" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "gasto_sinc" BEFORE INSERT OR UPDATE ON "gasto" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "gasto_sinc_lapida" AFTER DELETE ON "gasto" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "guia_transportista_sinc_uid" ON "guia_transportista" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "guia_transportista_sinc" BEFORE INSERT OR UPDATE ON "guia_transportista" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "guia_transportista_sinc_lapida" AFTER DELETE ON "guia_transportista" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "guia_item_sinc_uid" ON "guia_item" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "guia_item_sinc" BEFORE INSERT OR UPDATE ON "guia_item" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "guia_item_sinc_lapida" AFTER DELETE ON "guia_item" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "factura_sinc_uid" ON "factura" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "factura_sinc" BEFORE INSERT OR UPDATE ON "factura" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "factura_sinc_lapida" AFTER DELETE ON "factura" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "factura_guia_sinc_uid" ON "factura_guia" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "factura_guia_sinc" BEFORE INSERT OR UPDATE ON "factura_guia" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "factura_guia_sinc_lapida" AFTER DELETE ON "factura_guia" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "cobro_sinc_uid" ON "cobro" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "cobro_sinc" BEFORE INSERT OR UPDATE ON "cobro" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "cobro_sinc_lapida" AFTER DELETE ON "cobro" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "lectura_odometro_sinc_uid" ON "lectura_odometro" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "lectura_odometro_sinc" BEFORE INSERT OR UPDATE ON "lectura_odometro" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "lectura_odometro_sinc_lapida" AFTER DELETE ON "lectura_odometro" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "parte_instalada_sinc_uid" ON "parte_instalada" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "parte_instalada_sinc" BEFORE INSERT OR UPDATE ON "parte_instalada" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "parte_instalada_sinc_lapida" AFTER DELETE ON "parte_instalada" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "compra_repuesto_sinc_uid" ON "compra_repuesto" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "compra_repuesto_sinc" BEFORE INSERT OR UPDATE ON "compra_repuesto" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "compra_repuesto_sinc_lapida" AFTER DELETE ON "compra_repuesto" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "reparacion_sinc_uid" ON "reparacion" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "reparacion_sinc" BEFORE INSERT OR UPDATE ON "reparacion" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "reparacion_sinc_lapida" AFTER DELETE ON "reparacion" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "reparacion_repuesto_sinc_uid" ON "reparacion_repuesto" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "reparacion_repuesto_sinc" BEFORE INSERT OR UPDATE ON "reparacion_repuesto" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "reparacion_repuesto_sinc_lapida" AFTER DELETE ON "reparacion_repuesto" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "ingreso_sinc_uid" ON "ingreso" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "ingreso_sinc" BEFORE INSERT OR UPDATE ON "ingreso" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "ingreso_sinc_lapida" AFTER DELETE ON "ingreso" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "reinversion_sinc_uid" ON "reinversion" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "reinversion_sinc" BEFORE INSERT OR UPDATE ON "reinversion" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "reinversion_sinc_lapida" AFTER DELETE ON "reinversion" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "prestamo_sinc_uid" ON "prestamo" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "prestamo_sinc" BEFORE INSERT OR UPDATE ON "prestamo" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "prestamo_sinc_lapida" AFTER DELETE ON "prestamo" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "cuota_prestamo_sinc_uid" ON "cuota_prestamo" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "cuota_prestamo_sinc" BEFORE INSERT OR UPDATE ON "cuota_prestamo" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "cuota_prestamo_sinc_lapida" AFTER DELETE ON "cuota_prestamo" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "evento_telegram_sinc_uid" ON "evento_telegram" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "evento_telegram_sinc" BEFORE INSERT OR UPDATE ON "evento_telegram" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "evento_telegram_sinc_lapida" AFTER DELETE ON "evento_telegram" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "cotizacion_sinc_uid" ON "cotizacion" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "cotizacion_sinc" BEFORE INSERT OR UPDATE ON "cotizacion" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "cotizacion_sinc_lapida" AFTER DELETE ON "cotizacion" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
--> statement-breakpoint
CREATE UNIQUE INDEX "ajuste_sinc_uid" ON "ajuste" ("sinc_uid");
--> statement-breakpoint
CREATE TRIGGER "ajuste_sinc" BEFORE INSERT OR UPDATE ON "ajuste" FOR EACH ROW EXECUTE FUNCTION sinc_marcar();
--> statement-breakpoint
CREATE TRIGGER "ajuste_sinc_lapida" AFTER DELETE ON "ajuste" FOR EACH ROW EXECUTE FUNCTION sinc_lapida();
