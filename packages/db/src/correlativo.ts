import { sql } from "drizzle-orm";
import type { Ejecutor } from "./cliente";
import { correlativo } from "./schema";

export async function siguienteCorrelativo(db: Ejecutor, tipoDocumento: string, serie: string): Promise<number> {
  const [fila] = await db
    .insert(correlativo)
    .values({ tipoDocumento, serie, ultimoNumero: 1 })
    .onConflictDoUpdate({
      target: [correlativo.tipoDocumento, correlativo.serie],
      set: { ultimoNumero: sql`${correlativo.ultimoNumero} + 1` },
    })
    .returning({ numero: correlativo.ultimoNumero });
  if (!fila) throw new Error("No se pudo obtener el correlativo");
  return fila.numero;
}
