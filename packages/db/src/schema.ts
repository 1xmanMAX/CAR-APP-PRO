import { sql } from "drizzle-orm";
import {
  bigint, boolean, date, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, serial, text, timestamp, unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const creadoEn = () => timestamp("creado_en", { withTimezone: true }).notNull().defaultNow();
const actualizadoEn = () => timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow();
const centimos = (nombre: string) => bigint(nombre, { mode: "number" });

export const estadoGuiaEnum = pgEnum("estado_guia", ["borrador", "pendiente_envio", "enviada", "aceptada", "rechazada"]);
export const estadoSunatFacturaEnum = pgEnum("estado_sunat_factura", ["borrador", "pendiente_envio", "aceptada", "observada", "rechazada"]);
export const estadoCobroEnum = pgEnum("estado_cobro", ["pendiente", "parcial", "pagada"]);
export const formaPagoEnum = pgEnum("forma_pago", ["contado", "credito"]);
export const medioCobroEnum = pgEnum("medio_cobro", ["transferencia", "efectivo", "otro"]);

export const categoriaGastoEnum = pgEnum("categoria_gasto",
  ["combustible", "peaje", "viaticos", "hospedaje", "estiba", "balanza", "cochera", "reparacion", "otros"]);
export const estadoViajeEnum = pgEnum("estado_viaje", ["planificado", "en_curso", "cerrado"]);
export const medioEntregaEnum = pgEnum("medio_entrega", ["efectivo", "yape", "transferencia", "otro"]);
export const tipoMensajeEnum = pgEnum("tipo_mensaje", ["pdf", "foto", "voz", "texto"]);
export const estadoLecturaEnum = pgEnum("estado_lectura", ["pendiente", "por_confirmar", "confirmado", "descartado", "error"]);
export const tramoGuiaEnum = pgEnum("tramo_guia", ["ida", "retorno"]);

export type EstadoGuia = (typeof estadoGuiaEnum.enumValues)[number];
export type EstadoSunatFactura = (typeof estadoSunatFacturaEnum.enumValues)[number];
export type EstadoCobro = (typeof estadoCobroEnum.enumValues)[number];
export type CategoriaGasto = (typeof categoriaGastoEnum.enumValues)[number];
export type EstadoViaje = (typeof estadoViajeEnum.enumValues)[number];
export type MedioEntrega = (typeof medioEntregaEnum.enumValues)[number];
export type EstadoLectura = (typeof estadoLecturaEnum.enumValues)[number];
export type TipoMensaje = (typeof tipoMensajeEnum.enumValues)[number];

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
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  telegramId: bigint("telegram_id", { mode: "number" }).unique(),
  telegramNombre: text("telegram_nombre"),
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
  rutaArchivo: text("ruta_archivo"),
  mime: text("mime").notNull(),
  tipo: tipoMensajeEnum("tipo").notNull().default("pdf"),
  texto: text("texto"),
  estadoLectura: estadoLecturaEnum("estado_lectura").notNull().default("pendiente"),
  clasificacion: text("clasificacion"),
  correcciones: jsonb("correcciones"),
  intentosLectura: integer("intentos_lectura").notNull().default(0),
  proximoIntentoEn: timestamp("proximo_intento_en", { withTimezone: true }),
  telegramChatId: bigint("telegram_chat_id", { mode: "number" }),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
  datosExtraidos: jsonb("datos_extraidos"),
  confianza: jsonb("confianza"),
  hashSha256: text("hash_sha256").unique(),
  creadoEn: creadoEn(),
}, (t) => [
  unique("documento_telegram_mensaje").on(t.telegramChatId, t.telegramMessageId),
]);

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
  viajeId: integer("viaje_id").references(() => viaje.id),
  tramo: tramoGuiaEnum("tramo"),
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

export const ruta = pgTable("ruta", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  activa: boolean("activa").notNull().default(true),
});

export const rutaPresupuesto = pgTable("ruta_presupuesto", {
  rutaId: integer("ruta_id").notNull().references(() => ruta.id, { onDelete: "cascade" }),
  categoria: categoriaGastoEnum("categoria").notNull(),
  monto: centimos("monto").notNull(),
}, (t) => [primaryKey({ columns: [t.rutaId, t.categoria] })]);

export const viaje = pgTable("viaje", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  rutaId: integer("ruta_id").references(() => ruta.id),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiculo.id),
  vehiculoSecundarioId: integer("vehiculo_secundario_id").references(() => vehiculo.id),
  conductorId: integer("conductor_id").notNull().references(() => conductor.id),
  fechaSalida: date("fecha_salida", { mode: "string" }).notNull(),
  fechaRegreso: date("fecha_regreso", { mode: "string" }),
  estado: estadoViajeEnum("estado").notNull().default("planificado"),
  nota: text("nota"),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [
  uniqueIndex("viaje_en_curso_vehiculo").on(t.vehiculoId).where(sql`${t.estado} = 'en_curso'`),
]);

export const viajePresupuesto = pgTable("viaje_presupuesto", {
  viajeId: integer("viaje_id").notNull().references(() => viaje.id, { onDelete: "cascade" }),
  categoria: categoriaGastoEnum("categoria").notNull(),
  monto: centimos("monto").notNull(),
}, (t) => [primaryKey({ columns: [t.viajeId, t.categoria] })]);

export const entrega = pgTable("entrega", {
  id: serial("id").primaryKey(),
  viajeId: integer("viaje_id").notNull().references(() => viaje.id),
  fecha: date("fecha", { mode: "string" }).notNull(),
  monto: centimos("monto").notNull(),
  medio: medioEntregaEnum("medio").notNull(),
  nota: text("nota"),
  documentoId: integer("documento_id").references(() => documentoRecibido.id),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  creadoEn: creadoEn(),
});

export const gasto = pgTable("gasto", {
  id: serial("id").primaryKey(),
  viajeId: integer("viaje_id").references(() => viaje.id),
  categoria: categoriaGastoEnum("categoria").notNull(),
  monto: centimos("monto").notNull(),
  fecha: date("fecha", { mode: "string" }).notNull(),
  proveedorRuc: text("proveedor_ruc"),
  proveedorNombre: text("proveedor_nombre"),
  comprobante: text("comprobante"),
  nota: text("nota"),
  documentoId: integer("documento_id").references(() => documentoRecibido.id),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  creadoEn: creadoEn(),
  editadoEn: timestamp("editado_en", { withTimezone: true }),
});

export const lecturaIa = pgTable("lectura_ia", {
  id: serial("id").primaryKey(),
  documentoId: integer("documento_id").notNull().references(() => documentoRecibido.id),
  proveedor: text("proveedor").notNull(),
  modelo: text("modelo").notNull(),
  tokensEntrada: integer("tokens_entrada").notNull().default(0),
  tokensCache: integer("tokens_cache").notNull().default(0),
  tokensSalida: integer("tokens_salida").notNull().default(0),
  costoMicroUsd: bigint("costo_micro_usd", { mode: "number" }).notNull().default(0),
  respuesta: jsonb("respuesta"),
  error: text("error"),
  creadoEn: creadoEn(),
});

export const invitacion = pgTable("invitacion", {
  id: serial("id").primaryKey(),
  codigoHash: text("codigo_hash").notNull().unique(),
  creadaPor: integer("creada_por").notNull().references(() => usuario.id),
  expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),
  usadaPor: integer("usada_por").references(() => usuario.id),
  usadaEn: timestamp("usada_en", { withTimezone: true }),
  creadoEn: creadoEn(),
});
