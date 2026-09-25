CREATE TYPE "public"."estado_evento" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."estado_unidad" AS ENUM('en_ruta', 'en_base', 'en_taller', 'inactivo');--> statement-breakpoint
CREATE TYPE "public"."origen_registro" AS ENUM('web', 'telegram', 'sistema');--> statement-breakpoint
CREATE TYPE "public"."rol_usuario" AS ENUM('dueno', 'contador', 'taller', 'chofer');--> statement-breakpoint
CREATE TYPE "public"."tipo_reparacion" AS ENUM('preventivo', 'correctivo', 'falla_en_ruta');--> statement-breakpoint
CREATE TYPE "public"."tipo_vehiculo" AS ENUM('tracto', 'carreta');--> statement-breakpoint
CREATE TYPE "public"."zona_modelo" AS ENUM('motor', 'cabina', 'chasis', 'caja', 'tanque', 'bateria', 'quinta', 'llantas_del', 'llantas_trac', 'llantas_sr');--> statement-breakpoint
CREATE TABLE "ajuste" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" jsonb NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compra_repuesto" (
	"id" serial PRIMARY KEY NOT NULL,
	"repuesto_id" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"costo_unitario" bigint NOT NULL,
	"fecha" date NOT NULL,
	"proveedor" text,
	"origen" "origen_registro" DEFAULT 'web' NOT NULL,
	"usuario_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cotizacion" (
	"id" serial PRIMARY KEY NOT NULL,
	"ruta" text NOT NULL,
	"vehiculo_id" integer,
	"km" integer NOT NULL,
	"toneladas" numeric(10, 2) NOT NULL,
	"datos" jsonb NOT NULL,
	"costo" bigint NOT NULL,
	"flete" bigint NOT NULL,
	"usuario_id" integer,
	"enviada_telegram" boolean DEFAULT false NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cuota_prestamo" (
	"id" serial PRIMARY KEY NOT NULL,
	"prestamo_id" integer NOT NULL,
	"numero" integer NOT NULL,
	"vencimiento" date NOT NULL,
	"monto" bigint NOT NULL,
	"capital" bigint NOT NULL,
	"pagada_en" date,
	"avisada" boolean DEFAULT false NOT NULL,
	CONSTRAINT "cuota_prestamo_numero" UNIQUE("prestamo_id","numero")
);
--> statement-breakpoint
CREATE TABLE "enlace_web" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"usuario_id" integer NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"usado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enlace_web_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "evento_telegram" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer,
	"autor" text,
	"comando" text NOT NULL,
	"texto" text NOT NULL,
	"payload" jsonb,
	"vehiculo_id" integer,
	"entidad" text,
	"entidad_id" integer,
	"estado" "estado_evento" DEFAULT 'ok' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingreso" (
	"id" serial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"concepto" text NOT NULL,
	"monto" bigint NOT NULL,
	"vehiculo_id" integer,
	"viaje_id" integer,
	"origen" "origen_registro" DEFAULT 'web' NOT NULL,
	"usuario_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lectura_odometro" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehiculo_id" integer NOT NULL,
	"km" integer NOT NULL,
	"fecha" date NOT NULL,
	"origen" "origen_registro" NOT NULL,
	"usuario_id" integer,
	"viaje_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parte_instalada" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehiculo_id" integer NOT NULL,
	"tipo_parte_id" integer NOT NULL,
	"posicion" text DEFAULT '' NOT NULL,
	"repuesto_id" integer,
	"fecha_instalacion" date NOT NULL,
	"km_instalacion" integer NOT NULL,
	"viajes_instalacion" integer NOT NULL,
	"vida_km" integer,
	"vida_viajes" integer,
	"vida_dias" integer,
	"costo" bigint DEFAULT 0 NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"alerta_nivel" integer DEFAULT 0 NOT NULL,
	"retirada_en" date,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prestamo" (
	"id" serial PRIMARY KEY NOT NULL,
	"entidad" text NOT NULL,
	"monto_original" bigint NOT NULL,
	"tasa_anual" numeric(6, 2) NOT NULL,
	"cuotas" integer NOT NULL,
	"fecha_inicio" date NOT NULL,
	"vehiculo_id" integer,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reinversion" (
	"id" serial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"concepto" text NOT NULL,
	"monto" bigint NOT NULL,
	"vehiculo_id" integer,
	"origen" "origen_registro" DEFAULT 'web' NOT NULL,
	"usuario_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reparacion" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehiculo_id" integer NOT NULL,
	"parte_retirada_id" integer,
	"parte_nueva_id" integer,
	"tipo_parte_id" integer,
	"tipo" "tipo_reparacion" NOT NULL,
	"trabajo" text NOT NULL,
	"odometro" integer NOT NULL,
	"fecha" date NOT NULL,
	"mano_obra" bigint DEFAULT 0 NOT NULL,
	"costo_repuestos" bigint DEFAULT 0 NOT NULL,
	"costo_total" bigint NOT NULL,
	"taller" text,
	"desgaste_pct" integer,
	"gasto_id" integer,
	"origen" "origen_registro" DEFAULT 'web' NOT NULL,
	"usuario_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reparacion_repuesto" (
	"id" serial PRIMARY KEY NOT NULL,
	"reparacion_id" integer NOT NULL,
	"repuesto_id" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"costo_unitario" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repuesto" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"categoria" text NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"stock_minimo" integer DEFAULT 0 NOT NULL,
	"costo_unitario" bigint DEFAULT 0 NOT NULL,
	"proveedor" text,
	"tipo_parte_id" integer,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repuesto_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "sesion_web" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"usuario_id" integer NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sesion_web_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tipo_parte" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"nombre_corto" text NOT NULL,
	"zona" "zona_modelo" NOT NULL,
	"vida_km" integer,
	"vida_viajes" integer,
	"vida_dias" integer,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "tipo_parte_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "vehiculo_id" integer;--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "origen" "origen_registro" DEFAULT 'telegram' NOT NULL;--> statement-breakpoint
ALTER TABLE "gasto" ADD COLUMN "ruta_foto" text;--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "rol" "rol_usuario" DEFAULT 'dueno' NOT NULL;--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "conductor_id" integer;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "codigo" text;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "tipo" "tipo_vehiculo" DEFAULT 'tracto' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "modelo" text;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "anio" integer;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "estado_unidad" "estado_unidad" DEFAULT 'en_base' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "odometro_km" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "viajes_base" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "rendimiento_km_gal" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "carreta_id" integer;--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "origen_lugar" text;--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "destino_lugar" text;--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "km" integer;--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "toneladas" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "flete" bigint;--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "odometro_inicio" integer;--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "odometro_fin" integer;--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "guia_ref" text;--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "km_aplicados" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "viaje" ADD COLUMN "origen" "origen_registro" DEFAULT 'telegram' NOT NULL;--> statement-breakpoint
ALTER TABLE "compra_repuesto" ADD CONSTRAINT "compra_repuesto_repuesto_id_repuesto_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."repuesto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_repuesto" ADD CONSTRAINT "compra_repuesto_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuota_prestamo" ADD CONSTRAINT "cuota_prestamo_prestamo_id_prestamo_id_fk" FOREIGN KEY ("prestamo_id") REFERENCES "public"."prestamo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enlace_web" ADD CONSTRAINT "enlace_web_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evento_telegram" ADD CONSTRAINT "evento_telegram_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evento_telegram" ADD CONSTRAINT "evento_telegram_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingreso" ADD CONSTRAINT "ingreso_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingreso" ADD CONSTRAINT "ingreso_viaje_id_viaje_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viaje"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingreso" ADD CONSTRAINT "ingreso_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lectura_odometro" ADD CONSTRAINT "lectura_odometro_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lectura_odometro" ADD CONSTRAINT "lectura_odometro_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lectura_odometro" ADD CONSTRAINT "lectura_odometro_viaje_id_viaje_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viaje"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parte_instalada" ADD CONSTRAINT "parte_instalada_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parte_instalada" ADD CONSTRAINT "parte_instalada_tipo_parte_id_tipo_parte_id_fk" FOREIGN KEY ("tipo_parte_id") REFERENCES "public"."tipo_parte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parte_instalada" ADD CONSTRAINT "parte_instalada_repuesto_id_repuesto_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."repuesto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestamo" ADD CONSTRAINT "prestamo_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reinversion" ADD CONSTRAINT "reinversion_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reinversion" ADD CONSTRAINT "reinversion_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reparacion" ADD CONSTRAINT "reparacion_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reparacion" ADD CONSTRAINT "reparacion_parte_retirada_id_parte_instalada_id_fk" FOREIGN KEY ("parte_retirada_id") REFERENCES "public"."parte_instalada"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reparacion" ADD CONSTRAINT "reparacion_parte_nueva_id_parte_instalada_id_fk" FOREIGN KEY ("parte_nueva_id") REFERENCES "public"."parte_instalada"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reparacion" ADD CONSTRAINT "reparacion_tipo_parte_id_tipo_parte_id_fk" FOREIGN KEY ("tipo_parte_id") REFERENCES "public"."tipo_parte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reparacion" ADD CONSTRAINT "reparacion_gasto_id_gasto_id_fk" FOREIGN KEY ("gasto_id") REFERENCES "public"."gasto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reparacion" ADD CONSTRAINT "reparacion_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reparacion_repuesto" ADD CONSTRAINT "reparacion_repuesto_reparacion_id_reparacion_id_fk" FOREIGN KEY ("reparacion_id") REFERENCES "public"."reparacion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reparacion_repuesto" ADD CONSTRAINT "reparacion_repuesto_repuesto_id_repuesto_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."repuesto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuesto" ADD CONSTRAINT "repuesto_tipo_parte_id_tipo_parte_id_fk" FOREIGN KEY ("tipo_parte_id") REFERENCES "public"."tipo_parte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesion_web" ADD CONSTRAINT "sesion_web_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parte_activa_unica" ON "parte_instalada" USING btree ("vehiculo_id","tipo_parte_id","posicion") WHERE "parte_instalada"."activa" = true;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_conductor_id_conductor_id_fk" FOREIGN KEY ("conductor_id") REFERENCES "public"."conductor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD CONSTRAINT "vehiculo_codigo_unique" UNIQUE("codigo");--> statement-breakpoint
UPDATE "vehiculo" SET "tipo" = 'carreta' WHERE "id" IN (SELECT "vehiculo_secundario_id" FROM "guia_transportista" WHERE "vehiculo_secundario_id" IS NOT NULL UNION SELECT "vehiculo_secundario_id" FROM "viaje" WHERE "vehiculo_secundario_id" IS NOT NULL);--> statement-breakpoint
UPDATE "vehiculo" v SET "codigo" = 'T-' || lpad(n.rn::text, 2, '0') FROM (SELECT "id", row_number() OVER (ORDER BY "id") AS rn FROM "vehiculo" WHERE "tipo" = 'tracto') n WHERE v."id" = n."id" AND v."codigo" IS NULL;
