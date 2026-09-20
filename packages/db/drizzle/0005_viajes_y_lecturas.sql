CREATE TYPE "public"."categoria_gasto" AS ENUM('combustible', 'peaje', 'viaticos', 'hospedaje', 'estiba', 'balanza', 'cochera', 'reparacion', 'otros');--> statement-breakpoint
CREATE TYPE "public"."estado_lectura" AS ENUM('pendiente', 'por_confirmar', 'confirmado', 'descartado', 'error');--> statement-breakpoint
CREATE TYPE "public"."estado_viaje" AS ENUM('planificado', 'en_curso', 'cerrado');--> statement-breakpoint
CREATE TYPE "public"."medio_entrega" AS ENUM('efectivo', 'yape', 'transferencia', 'otro');--> statement-breakpoint
CREATE TYPE "public"."tipo_mensaje" AS ENUM('pdf', 'foto', 'voz', 'texto');--> statement-breakpoint
CREATE TYPE "public"."tramo_guia" AS ENUM('ida', 'retorno');--> statement-breakpoint
CREATE TABLE "entrega" (
	"id" serial PRIMARY KEY NOT NULL,
	"viaje_id" integer NOT NULL,
	"fecha" date NOT NULL,
	"monto" bigint NOT NULL,
	"medio" "medio_entrega" NOT NULL,
	"nota" text,
	"documento_id" integer,
	"usuario_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gasto" (
	"id" serial PRIMARY KEY NOT NULL,
	"viaje_id" integer,
	"categoria" "categoria_gasto" NOT NULL,
	"monto" bigint NOT NULL,
	"fecha" date NOT NULL,
	"proveedor_ruc" text,
	"proveedor_nombre" text,
	"comprobante" text,
	"nota" text,
	"documento_id" integer,
	"usuario_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"editado_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invitacion" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo_hash" text NOT NULL,
	"creada_por" integer NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"usada_por" integer,
	"usada_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitacion_codigo_hash_unique" UNIQUE("codigo_hash")
);
--> statement-breakpoint
CREATE TABLE "lectura_ia" (
	"id" serial PRIMARY KEY NOT NULL,
	"documento_id" integer NOT NULL,
	"proveedor" text NOT NULL,
	"modelo" text NOT NULL,
	"tokens_entrada" integer DEFAULT 0 NOT NULL,
	"tokens_cache" integer DEFAULT 0 NOT NULL,
	"tokens_salida" integer DEFAULT 0 NOT NULL,
	"costo_micro_usd" bigint DEFAULT 0 NOT NULL,
	"respuesta" jsonb,
	"error" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ruta" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ruta_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "ruta_presupuesto" (
	"ruta_id" integer NOT NULL,
	"categoria" "categoria_gasto" NOT NULL,
	"monto" bigint NOT NULL,
	CONSTRAINT "ruta_presupuesto_ruta_id_categoria_pk" PRIMARY KEY("ruta_id","categoria")
);
--> statement-breakpoint
CREATE TABLE "viaje" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"ruta_id" integer,
	"vehiculo_id" integer NOT NULL,
	"vehiculo_secundario_id" integer,
	"conductor_id" integer NOT NULL,
	"fecha_salida" date NOT NULL,
	"fecha_regreso" date,
	"estado" "estado_viaje" DEFAULT 'planificado' NOT NULL,
	"nota" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viaje_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "viaje_presupuesto" (
	"viaje_id" integer NOT NULL,
	"categoria" "categoria_gasto" NOT NULL,
	"monto" bigint NOT NULL,
	CONSTRAINT "viaje_presupuesto_viaje_id_categoria_pk" PRIMARY KEY("viaje_id","categoria")
);
--> statement-breakpoint
ALTER TABLE "documento_recibido" ALTER COLUMN "ruta_archivo" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usuario" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD COLUMN "tipo" "tipo_mensaje" DEFAULT 'pdf' NOT NULL;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD COLUMN "texto" text;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD COLUMN "estado_lectura" "estado_lectura" DEFAULT 'pendiente' NOT NULL;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD COLUMN "clasificacion" text;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD COLUMN "correcciones" jsonb;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD COLUMN "intentos_lectura" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD COLUMN "proximo_intento_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD COLUMN "telegram_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD COLUMN "telegram_message_id" bigint;--> statement-breakpoint
ALTER TABLE "guia_transportista" ADD COLUMN "viaje_id" integer;--> statement-breakpoint
ALTER TABLE "guia_transportista" ADD COLUMN "tramo" "tramo_guia";--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "telegram_nombre" text;--> statement-breakpoint
ALTER TABLE "entrega" ADD CONSTRAINT "entrega_viaje_id_viaje_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viaje"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrega" ADD CONSTRAINT "entrega_documento_id_documento_recibido_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documento_recibido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrega" ADD CONSTRAINT "entrega_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_viaje_id_viaje_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viaje"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_documento_id_documento_recibido_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documento_recibido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitacion" ADD CONSTRAINT "invitacion_creada_por_usuario_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitacion" ADD CONSTRAINT "invitacion_usada_por_usuario_id_fk" FOREIGN KEY ("usada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lectura_ia" ADD CONSTRAINT "lectura_ia_documento_id_documento_recibido_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documento_recibido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruta_presupuesto" ADD CONSTRAINT "ruta_presupuesto_ruta_id_ruta_id_fk" FOREIGN KEY ("ruta_id") REFERENCES "public"."ruta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viaje" ADD CONSTRAINT "viaje_ruta_id_ruta_id_fk" FOREIGN KEY ("ruta_id") REFERENCES "public"."ruta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viaje" ADD CONSTRAINT "viaje_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viaje" ADD CONSTRAINT "viaje_vehiculo_secundario_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_secundario_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viaje" ADD CONSTRAINT "viaje_conductor_id_conductor_id_fk" FOREIGN KEY ("conductor_id") REFERENCES "public"."conductor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viaje_presupuesto" ADD CONSTRAINT "viaje_presupuesto_viaje_id_viaje_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viaje"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "viaje_en_curso_vehiculo" ON "viaje" USING btree ("vehiculo_id") WHERE "viaje"."estado" = 'en_curso';--> statement-breakpoint
ALTER TABLE "guia_transportista" ADD CONSTRAINT "guia_transportista_viaje_id_viaje_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viaje"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD CONSTRAINT "documento_telegram_mensaje" UNIQUE("telegram_chat_id","telegram_message_id");