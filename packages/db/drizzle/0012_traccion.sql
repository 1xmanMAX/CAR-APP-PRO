ALTER TABLE "vehiculo" ALTER COLUMN "semirremolque" SET DEFAULT 'plataforma';--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "traccion" text DEFAULT '6x2' NOT NULL;--> statement-breakpoint
UPDATE "vehiculo" SET "semirremolque" = 'plataforma' WHERE "semirremolque" = 'furgon';