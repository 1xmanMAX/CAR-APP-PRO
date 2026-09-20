ALTER TABLE "ruta" ADD COLUMN "nombre_normalizado" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ruta" ADD CONSTRAINT "ruta_nombre_normalizado_unique" UNIQUE("nombre_normalizado");