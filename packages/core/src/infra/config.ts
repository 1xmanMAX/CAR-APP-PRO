import { z } from "zod";

const vacioANull = z.string().trim().optional().transform((v) => (v ? v : null));
const vacioAUndefined = z.string().trim().optional().transform((v) => (v ? v : undefined));

const esquema = z
  .object({
    DATABASE_URL: vacioANull,
    DATA_DIR: z.string().default("./data"),
    STORAGE_DIR: z.string().default("./storage"),
    SUNAT_MODO: z.enum(["simulado", "beta", "real"]).default("simulado"),
    // Sin default: en modo real, si no se define, se resuelve a "produccion" en cargarConfig
    // (nunca hay que forzar a las facturas por beta al pasar a real); un valor explícito
    // ("beta" o "produccion") siempre se respeta.
    SUNAT_AMBIENTE_FACTURA: vacioAUndefined.pipe(z.enum(["beta", "produccion"]).optional()),
    SUNAT_SIMULAR_RECHAZO: vacioANull,
    SUNAT_CERT_PATH: vacioANull,
    SUNAT_CERT_PASSWORD: vacioANull,
    SUNAT_SOL_USUARIO: vacioANull,
    SUNAT_SOL_CLAVE: vacioANull,
    SUNAT_GRE_CLIENT_ID: vacioANull,
    SUNAT_GRE_CLIENT_SECRET: vacioANull,
  })
  .superRefine((e, ctx) => {
    if (e.SUNAT_MODO !== "real") return;
    for (const clave of ["SUNAT_CERT_PATH", "SUNAT_CERT_PASSWORD", "SUNAT_SOL_USUARIO", "SUNAT_SOL_CLAVE", "SUNAT_GRE_CLIENT_ID", "SUNAT_GRE_CLIENT_SECRET"] as const) {
      if (!e[clave]) ctx.addIssue({ code: "custom", path: [clave], message: `${clave} es obligatorio con SUNAT_MODO=real` });
    }
  });

export interface Config {
  databaseUrl: string | null;
  dataDir: string;
  storageDir: string;
  sunatModo: "simulado" | "beta" | "real";
  sunatAmbienteFactura: "beta" | "produccion";
  simularRechazo: { codigo: string; mensaje: string } | null;
  certPath: string | null;
  certPassword: string | null;
  solUsuario: string | null;
  solClave: string | null;
  greClientId: string | null;
  greClientSecret: string | null;
}

export function cargarConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = esquema.safeParse(env);
  if (!r.success) throw new Error(`Configuración inválida: ${r.error.issues.map((i) => i.message).join("; ")}`);
  const e = r.data;
  const rechazo = e.SUNAT_SIMULAR_RECHAZO?.match(/^([^:]+):(.*)$/);
  // Sin definir: en modo real por defecto va a producción (nunca facturas silenciosamente a
  // beta); en simulado/beta el valor es irrelevante para el gateway (beta usa MODDATOS fijo),
  // así que se mantiene "beta" por compatibilidad. Un valor explícito siempre se respeta.
  const sunatAmbienteFactura = e.SUNAT_AMBIENTE_FACTURA ?? (e.SUNAT_MODO === "real" ? "produccion" : "beta");
  return {
    databaseUrl: e.DATABASE_URL,
    dataDir: e.DATA_DIR,
    storageDir: e.STORAGE_DIR,
    sunatModo: e.SUNAT_MODO,
    sunatAmbienteFactura,
    simularRechazo: rechazo ? { codigo: rechazo[1]!, mensaje: rechazo[2]! } : null,
    certPath: e.SUNAT_CERT_PATH,
    certPassword: e.SUNAT_CERT_PASSWORD,
    solUsuario: e.SUNAT_SOL_USUARIO,
    solClave: e.SUNAT_SOL_CLAVE,
    greClientId: e.SUNAT_GRE_CLIENT_ID,
    greClientSecret: e.SUNAT_GRE_CLIENT_SECRET,
  };
}
