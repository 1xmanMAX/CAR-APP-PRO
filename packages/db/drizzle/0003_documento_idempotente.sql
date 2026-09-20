ALTER TABLE "documento_recibido" ADD COLUMN "hash_sha256" text;--> statement-breakpoint
ALTER TABLE "documento_recibido" ADD CONSTRAINT "documento_recibido_hash_sha256_unique" UNIQUE("hash_sha256");--> statement-breakpoint
ALTER TABLE "guia_transportista" ADD CONSTRAINT "guia_documento_recibido" UNIQUE("documento_recibido_id");