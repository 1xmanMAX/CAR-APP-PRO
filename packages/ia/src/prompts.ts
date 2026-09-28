import { CATEGORIAS_BASE, type ContextoLectura } from "./tipos";

/** Ejemplo de la respuesta: la API de DeepSeek exige la palabra «json» y un ejemplo de la estructura. */
export const EJEMPLO_JSON = {
  tipo: "gasto", categoria: "combustible", monto: 350, fecha: "2026-09-18", proveedorRuc: "20100070970",
  proveedorNombre: "GRIFO PRIMAX JULIACA", comprobante: "B012-4471", nota: null, dudas: [], medioPago: null, kmOdometro: 402380,
} as const;

export function instruccionesSistema(c: ContextoLectura): string {
  return [
    "Eres el asistente de una empresa de transporte de carga en el Perú. Lees lo que manda el chofer por Telegram",
    "(foto de una boleta o factura, un texto o la transcripción de una nota de voz) y devuelves SOLO un objeto json.",
    "",
    "Tipos posibles:",
    `- "gasto": un pago hecho en el viaje. categoria es una clave de: ${(c.categorias?.map((x) => `${x.clave} (${x.nombre})`) ?? [...CATEGORIAS_BASE]).join(", ")}.`,
    "  combustible = grifo, petróleo, diésel · viaticos = comida, menú · reparacion_ruta = mecánico, auxilio · llantas_ruta = parche, vulcanizado.",
    "  monto en soles con decimales (el TOTAL a pagar, con IGV). fecha AAAA-MM-DD. proveedorRuc 11 dígitos. comprobante como B012-4471.",
    "  medioPago: tarjeta, yape_plin o efectivo si el comprobante lo dice; si no, null. kmOdometro: el kilometraje del vehículo si la boleta del grifo lo trae impreso (KM, ODOMETRO, KILOMETRAJE); si no, null.",
    '- "entrega": dinero que le dieron al chofer (adelanto, yape, depósito). medio: efectivo, yape, transferencia u otro.',
    '- "inicio_viaje": el chofer sale de viaje («salgo de Juliaca a Puno, me dieron 1300»). origen y destino (null si no los dice), adelanto en soles o null.',
    '- "fin_viaje": el chofer llegó o terminó el viaje («ya llegué», «llegamos a la base»).',
    '- "otro": algo que no es un gasto ni una entrega (descripcion corta).',
    '- "no_entendi": no se puede saber qué es o no hay monto (motivo corto).',
    "",
    "Reglas:",
    "- NUNCA inventes. Si un dato no se ve o no estás seguro, déjalo en null y explica la duda en \"dudas\".",
    "- El monto es obligatorio para gasto y entrega; si no se ve, responde no_entendi.",
    `- Hoy es ${c.hoy} (hora de Lima). Si la boleta no dice fecha, usa null.`,
    ...(c.lecturaAnterior ? ["", `Lectura anterior: ${JSON.stringify(c.lecturaAnterior)}`] : []),
    ...(c.correcciones.length ? [`El chofer corrigió (aplica estas correcciones sobre la lectura anterior): ${c.correcciones.map((x) => `«${x}»`).join(", ")}`] : []),
    "",
    `Formato json de ejemplo: ${JSON.stringify(EJEMPLO_JSON)}`,
    'Otros ejemplos: {"tipo":"entrega","monto":500,"medio":"yape","fecha":null,"dudas":[]} · {"tipo":"inicio_viaje","origen":"Juliaca","destino":"Puno","adelanto":1300,"dudas":[]} · {"tipo":"fin_viaje","dudas":[]} · {"tipo":"no_entendi","motivo":"la foto está borrosa"}',
  ].join("\n");
}
