CREATE TYPE "public"."estado_cobro" AS ENUM('pendiente', 'parcial', 'pagada');--> statement-breakpoint
CREATE TYPE "public"."estado_guia" AS ENUM('borrador', 'pendiente_envio', 'enviada', 'aceptada', 'rechazada');--> statement-breakpoint
CREATE TYPE "public"."estado_sunat_factura" AS ENUM('borrador', 'pendiente_envio', 'aceptada', 'observada', 'rechazada');--> statement-breakpoint
CREATE TYPE "public"."forma_pago" AS ENUM('contado', 'credito');--> statement-breakpoint
CREATE TYPE "public"."medio_cobro" AS ENUM('transferencia', 'efectivo', 'otro');--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text,
	"detalle" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cobro" (
	"id" serial PRIMARY KEY NOT NULL,
	"factura_id" integer NOT NULL,
	"fecha" date NOT NULL,
	"monto" bigint NOT NULL,
	"medio" "medio_cobro" NOT NULL,
	"nota" text,
	"usuario_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conductor" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo_doc" text DEFAULT '1' NOT NULL,
	"numero_doc" text NOT NULL,
	"nombres" text NOT NULL,
	"apellidos" text NOT NULL,
	"licencia" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contraparte" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo_doc" text NOT NULL,
	"numero_doc" text NOT NULL,
	"razon_social" text NOT NULL,
	"direccion" text,
	"ubigeo" text,
	CONSTRAINT "contraparte_numero_doc_unique" UNIQUE("numero_doc")
);
--> statement-breakpoint
CREATE TABLE "correlativo" (
	"tipo_documento" text NOT NULL,
	"serie" text NOT NULL,
	"ultimo_numero" integer NOT NULL,
	CONSTRAINT "correlativo_tipo_documento_serie_pk" PRIMARY KEY("tipo_documento","serie")
);
--> statement-breakpoint
CREATE TABLE "documento_recibido" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer,
	"telegram_file_id" text,
	"ruta_archivo" text NOT NULL,
	"mime" text NOT NULL,
	"datos_extraidos" jsonb,
	"confianza" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "empresa" (
	"id" serial PRIMARY KEY NOT NULL,
	"ruc" text NOT NULL,
	"razon_social" text NOT NULL,
	"nombre_comercial" text,
	"direccion" text NOT NULL,
	"ubigeo" text NOT NULL,
	"registro_mtc" text NOT NULL,
	"cuenta_detraccion_bn" text,
	"serie_gre" text DEFAULT 'V001' NOT NULL,
	"serie_factura" text DEFAULT 'F001' NOT NULL,
	"detraccion_porcentaje" integer DEFAULT 4 NOT NULL,
	"detraccion_umbral" bigint DEFAULT 40000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factura" (
	"id" serial PRIMARY KEY NOT NULL,
	"serie" text NOT NULL,
	"numero" integer,
	"fecha_emision" date,
	"hora_emision" text,
	"cliente_id" integer NOT NULL,
	"moneda" text DEFAULT 'PEN' NOT NULL,
	"descripcion" text NOT NULL,
	"subtotal" bigint NOT NULL,
	"igv" bigint NOT NULL,
	"total" bigint NOT NULL,
	"detraccion_porcentaje" integer,
	"detraccion_monto" bigint DEFAULT 0 NOT NULL,
	"forma_pago" "forma_pago" NOT NULL,
	"dias_credito" integer,
	"fecha_vencimiento" date,
	"estado_sunat" "estado_sunat_factura" DEFAULT 'borrador' NOT NULL,
	"estado_cobro" "estado_cobro" DEFAULT 'pendiente' NOT NULL,
	"codigo_respuesta" text,
	"mensaje_respuesta" text,
	"ruta_xml" text,
	"ruta_cdr" text,
	"ruta_pdf" text,
	"intentos" integer DEFAULT 0 NOT NULL,
	"proximo_intento_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "factura_serie_numero" UNIQUE("serie","numero")
);
--> statement-breakpoint
CREATE TABLE "factura_guia" (
	"factura_id" integer NOT NULL,
	"guia_id" integer NOT NULL,
	CONSTRAINT "factura_guia_factura_id_guia_id_pk" PRIMARY KEY("factura_id","guia_id"),
	CONSTRAINT "factura_guia_guia_id_unique" UNIQUE("guia_id")
);
--> statement-breakpoint
CREATE TABLE "guia_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"guia_id" integer NOT NULL,
	"descripcion" text NOT NULL,
	"cantidad" numeric(14, 3) NOT NULL,
	"unidad_medida" text DEFAULT 'NIU' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guia_transportista" (
	"id" serial PRIMARY KEY NOT NULL,
	"serie" text NOT NULL,
	"numero" integer,
	"fecha_emision" date,
	"hora_emision" text,
	"fecha_traslado" date NOT NULL,
	"remitente_id" integer NOT NULL,
	"destinatario_id" integer NOT NULL,
	"partida_direccion" text NOT NULL,
	"partida_ubigeo" text NOT NULL,
	"llegada_direccion" text NOT NULL,
	"llegada_ubigeo" text NOT NULL,
	"peso_bruto" numeric(12, 3) NOT NULL,
	"unidad_peso" text DEFAULT 'KGM' NOT NULL,
	"vehiculo_id" integer NOT NULL,
	"conductor_id" integer NOT NULL,
	"gre_remitente_ref" text,
	"documento_recibido_id" integer,
	"estado" "estado_guia" DEFAULT 'borrador' NOT NULL,
	"ticket" text,
	"codigo_respuesta" text,
	"mensaje_respuesta" text,
	"ruta_xml" text,
	"ruta_cdr" text,
	"ruta_pdf" text,
	"intentos" integer DEFAULT 0 NOT NULL,
	"proximo_intento_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guia_serie_numero" UNIQUE("serie","numero")
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"telegram_id" bigint,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "usuario_email_unique" UNIQUE("email"),
	CONSTRAINT "usuario_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "vehiculo" (
	"id" serial PRIMARY KEY NOT NULL,
	"placa" text NOT NULL,
	"marca" text,
	"numero_autorizacion" text,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vehiculo_placa_unique" UNIQUE("placa")
);
--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobro" ADD CONSTRAINT "cobro_factura_id_factura_id_fk" FOREIGN KEY ("factura_id") REFERENCES "public"."factura"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobro" ADD CONSTRAINT "cobro_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD CONSTRAINT "documento_recibido_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factura" ADD CONSTRAINT "factura_cliente_id_contraparte_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."contraparte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factura_guia" ADD CONSTRAINT "factura_guia_factura_id_factura_id_fk" FOREIGN KEY ("factura_id") REFERENCES "public"."factura"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factura_guia" ADD CONSTRAINT "factura_guia_guia_id_guia_transportista_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."guia_transportista"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guia_item" ADD CONSTRAINT "guia_item_guia_id_guia_transportista_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."guia_transportista"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guia_transportista" ADD CONSTRAINT "guia_transportista_remitente_id_contraparte_id_fk" FOREIGN KEY ("remitente_id") REFERENCES "public"."contraparte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guia_transportista" ADD CONSTRAINT "guia_transportista_destinatario_id_contraparte_id_fk" FOREIGN KEY ("destinatario_id") REFERENCES "public"."contraparte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guia_transportista" ADD CONSTRAINT "guia_transportista_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guia_transportista" ADD CONSTRAINT "guia_transportista_conductor_id_conductor_id_fk" FOREIGN KEY ("conductor_id") REFERENCES "public"."conductor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guia_transportista" ADD CONSTRAINT "guia_transportista_documento_recibido_id_documento_recibido_id_fk" FOREIGN KEY ("documento_recibido_id") REFERENCES "public"."documento_recibido"("id") ON DELETE no action ON UPDATE no action;