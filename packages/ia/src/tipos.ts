import { z } from "zod";

/**
 * **Lo que la IA entiende de un mensaje del chofer** (foto de boleta, texto o nota de voz). Nada se
 * guarda con esto solo: el bot muestra el resumen y la persona confirma.
 */
export const CATEGORIAS = ["combustible", "peaje", "viaticos", "hospedaje", "estiba", "balanza", "cochera", "reparacion", "otros"] as const;
export type Categoria = (typeof CATEGORIAS)[number];
export const MEDIOS = ["efectivo", "yape", "transferencia", "otro"] as const;
export type Medio = (typeof MEDIOS)[number];

const texto = z.string().trim().min(1).nullable();

export const esquemaLectura = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("gasto"), categoria: z.enum(CATEGORIAS), monto: z.number().positive().max(50_000),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), proveedorRuc: texto, proveedorNombre: texto, comprobante: texto,
    nota: texto, dudas: z.array(z.string()),
  }),
  z.object({ tipo: z.literal("entrega"), monto: z.number().positive().max(50_000), medio: z.enum(MEDIOS), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), dudas: z.array(z.string()) }),
  z.object({ tipo: z.literal("otro"), descripcion: z.string() }),
  z.object({ tipo: z.literal("no_entendi"), motivo: z.string() }),
]);
export type Lectura = z.infer<typeof esquemaLectura>;

export interface Imagen { contenido: Buffer; mime: string }

export interface ContextoLectura {
  /** Hoy en Lima (AAAA-MM-DD): para las boletas sin año o sin fecha. */
  hoy: string;
  /** Lo que la persona escribió al corregir, en orden. */
  correcciones: string[];
  lecturaAnterior?: Lectura;
}

export interface EntradaLectura { texto?: string; imagenes?: Imagen[]; contexto: ContextoLectura }

export interface UsoIa { proveedor: string; modelo: string; tokensEntrada: number; tokensCache: number; tokensSalida: number; costoMicroUsd: number }
export interface ResultadoLectura { lectura: Lectura; uso: UsoIa }

export interface ProveedorIA {
  nombre: string;
  /** false = solo entiende texto (las fotos sin texto se preguntan). */
  leeImagenes: boolean;
  leer(e: EntradaLectura): Promise<ResultadoLectura>;
}

/** Se puede reintentar más tarde (sin red, 429, 5xx, respuesta vacía). */
export class IaNoDisponibleError extends Error {}
/** No se reintenta: clave rechazada o sin saldo. */
export class IaCredencialesError extends Error {}

export interface Transcriptor { disponible: boolean; transcribir(audio: Buffer, mime: string): Promise<string> }
export class TranscripcionNoDisponibleError extends Error {}
