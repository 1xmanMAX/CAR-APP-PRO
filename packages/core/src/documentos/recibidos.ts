import { createHash } from "node:crypto";
import { documentoRecibido, eq, guiaTransportista } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";

export interface ArchivoRecibido { contenido: Buffer; mime: string; telegramFileId?: string; usuarioId?: number }
export interface DocumentoRegistrado { id: number; nuevo: boolean; guiaId: number | null; rutaArchivo: string | null }

const EXTENSIONES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "audio/ogg": "ogg" };

async function guiaDe(ctx: Contexto, documentoId: number): Promise<number | null> {
  const [g] = await ctx.db.select({ id: guiaTransportista.id }).from(guiaTransportista).where(eq(guiaTransportista.documentoRecibidoId, documentoId));
  return g?.id ?? null;
}

export async function registrarDocumentoRecibido(ctx: Contexto, a: ArchivoRecibido): Promise<DocumentoRegistrado> {
  const hash = createHash("sha256").update(a.contenido).digest("hex");
  const [existente] = await ctx.db.select().from(documentoRecibido).where(eq(documentoRecibido.hashSha256, hash));
  if (existente) return { id: existente.id, nuevo: false, guiaId: await guiaDe(ctx, existente.id), rutaArchivo: existente.rutaArchivo };
  const rutaArchivo = await ctx.almacen.guardar(`recibidos/${hash}.${EXTENSIONES[a.mime] ?? "bin"}`, a.contenido);
  const [fila] = await ctx.db.insert(documentoRecibido)
    .values({ hashSha256: hash, rutaArchivo, mime: a.mime, telegramFileId: a.telegramFileId ?? null, usuarioId: a.usuarioId ?? null })
    .onConflictDoNothing({ target: documentoRecibido.hashSha256 })
    .returning({ id: documentoRecibido.id });
  if (fila) return { id: fila.id, nuevo: true, guiaId: null, rutaArchivo };
  // Carrera: otra llamada insertó el mismo hash entre el select y el insert.
  const [ganador] = await ctx.db.select().from(documentoRecibido).where(eq(documentoRecibido.hashSha256, hash));
  return { id: ganador!.id, nuevo: false, guiaId: await guiaDe(ctx, ganador!.id), rutaArchivo: ganador!.rutaArchivo };
}

export async function guardarExtraccion(ctx: Contexto, documentoId: number, datos: unknown, confianza: unknown): Promise<void> {
  await ctx.db.update(documentoRecibido).set({ datosExtraidos: datos, confianza }).where(eq(documentoRecibido.id, documentoId));
}
