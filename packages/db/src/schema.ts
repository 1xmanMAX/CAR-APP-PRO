import {
  bigint, boolean, date, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, serial, text, timestamp, unique,
} from "drizzle-orm/pg-core";

const creadoEn = () => timestamp("creado_en", { withTimezone: true }).notNull().defaultNow();
const actualizadoEn = () => timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow();
const centimos = (nombre: string) => bigint(nombre, { mode: "number" });

export const estadoGuiaEnum = pgEnum("estado_guia", ["borrador", "pendiente_envio", "enviada", "aceptada", "rechazada"]);
export const estadoSunatFacturaEnum = pgEnum("estado_sunat_factura", ["borrador", "pendiente_envio", "aceptada", "observada", "rechazada"]);
export const estadoCobroEnum = pgEnum("estado_cobro", ["pendiente", "parcial", "pagada"]);
export const formaPagoEnum = pgEnum("forma_pago", ["contado", "credito"]);
export const medioCobroEnum = pgEnum("medio_cobro", ["transferencia", "efectivo", "otro"]);

export type EstadoGuia = (typeof estadoGuiaEnum.enumValues)[number];
export type EstadoSunatFactura = (typeof estadoSunatFacturaEnum.enumValues)[number];
export type EstadoCobro = (typeof estadoCobroEnum.enumValues)[number];

export const empresa = pgTable("empresa", {
  id: serial("id").primaryKey(),
  ruc: text("ruc").notNull(),
  razonSocial: text("razon_social").notNull(),
  nombreComercial: text("nombre_comercial"),
  direccion: text("direccion").notNull(),
  ubigeo: text("ubigeo").notNull(),
  registroMtc: text("registro_mtc").notNull(),
  cuentaDetraccionBn: text("cuenta_detraccion_bn"),
  serieGre: text("serie_gre").notNull().default("V001"),
  serieFactura: text("serie_factura").notNull().default("F001"),
  detraccionPorcentaje: integer("detraccion_porcentaje").notNull().default(4),
  detraccionUmbral: centimos("detraccion_umbral").notNull().default(40000),
});

export const vehiculo = pgTable("vehiculo", {
  id: serial("id").primaryKey(),
  placa: text("placa").notNull().unique(),
  marca: text("marca"),
  numeroAutorizacion: text("numero_autorizacion"),
  activo: boolean("activo").notNull().default(true),
});

export const conductor = pgTable("conductor", {
  id: serial("id").primaryKey(),
  tipoDoc: text("tipo_doc").notNull().default("1"),
  numeroDoc: text("numero_doc").notNull().unique(),
  nombres: text("nombres").notNull(),
  apellidos: text("apellidos").notNull(),
  licencia: text("licencia").notNull(),
  activo: boolean("activo").notNull().default(true),
});

export const usuario = pgTable("usuario", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  telegramId: bigint("telegram_id", { mode: "number" }).unique(),
  activo: boolean("activo").notNull().default(true),
});

export const contraparte = pgTable("contraparte", {
  id: serial("id").primaryKey(),
  tipoDoc: text("tipo_doc").notNull(),
  numeroDoc: text("numero_doc").notNull().unique(),
  razonSocial: text("razon_social").notNull(),
  direccion: text("direccion"),
  ubigeo: text("ubigeo"),
});

export const documentoRecibido = pgTable("documento_recibido", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  telegramFileId: text("telegram_file_id"),
  rutaArchivo: text("ruta_archivo").notNull(),
  mime: text("mime").notNull(),
  datosExtraidos: jsonb("datos_extraidos"),
  confianza: jsonb("confianza"),
  hashSha256: text("hash_sha256").unique(),
  creadoEn: creadoEn(),
});

export const guiaTransportista = pgTable("guia_transportista", {
  id: serial("id").primaryKey(),
  serie: text("serie").notNull(),
  numero: integer("numero"),
  fechaEmision: date("fecha_emision", { mode: "string" }),
  horaEmision: text("hora_emision"),
  fechaTraslado: date("fecha_traslado", { mode: "string" }).notNull(),
  remitenteId: integer("remitente_id").notNull().references(() => contraparte.id),
  destinatarioId: integer("destinatario_id").notNull().references(() => contraparte.id),
  partidaDireccion: text("partida_direccion").notNull(),
  partidaUbigeo: text("partida_ubigeo").notNull(),
  llegadaDireccion: text("llegada_direccion").notNull(),
  llegadaUbigeo: text("llegada_ubigeo").notNull(),
  pesoBruto: numeric("peso_bruto", { precision: 12, scale: 3 }).notNull(),
  unidadPeso: text("unidad_peso").notNull().default("KGM"),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiculo.id),
  vehiculoSecundarioId: integer("vehiculo_secundario_id").references(() => vehiculo.id),
  conductorId: integer("conductor_id").notNull().references(() => conductor.id),
  greRemitenteRef: text("gre_remitente_ref"),
  documentoRecibidoId: integer("documento_recibido_id").references(() => documentoRecibido.id),
  estado: estadoGuiaEnum("estado").notNull().default("borrador"),
  ticket: text("ticket"),
  codigoRespuesta: text("codigo_respuesta"),
  mensajeRespuesta: text("mensaje_respuesta"),
  rutaXml: text("ruta_xml"),
  rutaCdr: text("ruta_cdr"),
  rutaPdf: text("ruta_pdf"),
  urlQr: text("url_qr"),
  intentos: integer("intentos").notNull().default(0),
  proximoIntentoEn: timestamp("proximo_intento_en", { withTimezone: true }),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [
  unique("guia_serie_numero").on(t.serie, t.numero),
  unique("guia_documento_recibido").on(t.documentoRecibidoId),
]);

export const guiaItem = pgTable("guia_item", {
  id: serial("id").primaryKey(),
  guiaId: integer("guia_id").notNull().references(() => guiaTransportista.id, { onDelete: "cascade" }),
  descripcion: text("descripcion").notNull(),
  cantidad: numeric("cantidad", { precision: 14, scale: 3 }).notNull(),
  unidadMedida: text("unidad_medida").notNull().default("NIU"),
});

export const factura = pgTable("factura", {
  id: serial("id").primaryKey(),
  serie: text("serie").notNull(),
  numero: integer("numero"),
  fechaEmision: date("fecha_emision", { mode: "string" }),
  horaEmision: text("hora_emision"),
  clienteId: integer("cliente_id").notNull().references(() => contraparte.id),
  moneda: text("moneda").notNull().default("PEN"),
  descripcion: text("descripcion").notNull(),
  subtotal: centimos("subtotal").notNull(),
  igv: centimos("igv").notNull(),
  total: centimos("total").notNull(),
  detraccionPorcentaje: integer("detraccion_porcentaje"),
  detraccionMonto: centimos("detraccion_monto").notNull().default(0),
  formaPago: formaPagoEnum("forma_pago").notNull(),
  diasCredito: integer("dias_credito"),
  fechaVencimiento: date("fecha_vencimiento", { mode: "string" }),
  estadoSunat: estadoSunatFacturaEnum("estado_sunat").notNull().default("borrador"),
  estadoCobro: estadoCobroEnum("estado_cobro").notNull().default("pendiente"),
  codigoRespuesta: text("codigo_respuesta"),
  mensajeRespuesta: text("mensaje_respuesta"),
  rutaXml: text("ruta_xml"),
  rutaCdr: text("ruta_cdr"),
  rutaPdf: text("ruta_pdf"),
  intentos: integer("intentos").notNull().default(0),
  proximoIntentoEn: timestamp("proximo_intento_en", { withTimezone: true }),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [unique("factura_serie_numero").on(t.serie, t.numero)]);

export const facturaGuia = pgTable("factura_guia", {
  facturaId: integer("factura_id").notNull().references(() => factura.id, { onDelete: "cascade" }),
  guiaId: integer("guia_id").notNull().unique().references(() => guiaTransportista.id),
}, (t) => [primaryKey({ columns: [t.facturaId, t.guiaId] })]);

export const cobro = pgTable("cobro", {
  id: serial("id").primaryKey(),
  facturaId: integer("factura_id").notNull().references(() => factura.id),
  fecha: date("fecha", { mode: "string" }).notNull(),
  monto: centimos("monto").notNull(),
  medio: medioCobroEnum("medio").notNull(),
  nota: text("nota"),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  creadoEn: creadoEn(),
});

export const correlativo = pgTable("correlativo", {
  tipoDocumento: text("tipo_documento").notNull(),
  serie: text("serie").notNull(),
  ultimoNumero: integer("ultimo_numero").notNull(),
}, (t) => [primaryKey({ columns: [t.tipoDocumento, t.serie] })]);

export const auditoria = pgTable("auditoria", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  accion: text("accion").notNull(),
  entidad: text("entidad").notNull(),
  entidadId: text("entidad_id"),
  detalle: jsonb("detalle"),
  creadoEn: creadoEn(),
});
