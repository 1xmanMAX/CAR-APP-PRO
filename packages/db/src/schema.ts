import { sql } from "drizzle-orm";
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

export const categoriaGastoEnum = pgEnum("categoria_gasto",
  ["combustible", "peaje", "viaticos", "hospedaje", "estiba", "balanza", "cochera", "reparacion", "otros"]);
export const estadoViajeEnum = pgEnum("estado_viaje", ["planificado", "en_curso", "cerrado"]);
export const medioEntregaEnum = pgEnum("medio_entrega", ["efectivo", "yape", "transferencia", "otro"]);
export const tipoMensajeEnum = pgEnum("tipo_mensaje", ["pdf", "foto", "voz", "texto"]);
export const estadoLecturaEnum = pgEnum("estado_lectura", ["pendiente", "por_confirmar", "confirmado", "descartado", "error"]);
export const tramoGuiaEnum = pgEnum("tramo_guia", ["ida", "retorno"]);

// ── Control de flota (handoff de diseño) ─────────────────────────────────────
export const rolUsuarioEnum = pgEnum("rol_usuario", ["dueno", "contador", "taller", "chofer"]);
export const tipoVehiculoEnum = pgEnum("tipo_vehiculo", ["tracto", "carreta"]);
export const estadoUnidadEnum = pgEnum("estado_unidad", ["en_ruta", "en_base", "en_taller", "inactivo"]);
export const origenRegistroEnum = pgEnum("origen_registro", ["web", "telegram", "sistema"]);
export const zonaModeloEnum = pgEnum("zona_modelo",
  ["motor", "cabina", "chasis", "caja", "tanque", "bateria", "quinta", "llantas_del", "llantas_trac", "llantas_sr"]);
export const tipoReparacionEnum = pgEnum("tipo_reparacion", ["preventivo", "correctivo", "falla_en_ruta"]);
export const estadoEventoEnum = pgEnum("estado_evento", ["ok", "error"]);

export type EstadoGuia = (typeof estadoGuiaEnum.enumValues)[number];
export type EstadoSunatFactura = (typeof estadoSunatFacturaEnum.enumValues)[number];
export type EstadoCobro = (typeof estadoCobroEnum.enumValues)[number];
export type CategoriaGasto = (typeof categoriaGastoEnum.enumValues)[number];
export type EstadoViaje = (typeof estadoViajeEnum.enumValues)[number];
export type MedioEntrega = (typeof medioEntregaEnum.enumValues)[number];
export type EstadoLectura = (typeof estadoLecturaEnum.enumValues)[number];
export type TipoMensaje = (typeof tipoMensajeEnum.enumValues)[number];
export type RolUsuario = (typeof rolUsuarioEnum.enumValues)[number];
export type EstadoUnidad = (typeof estadoUnidadEnum.enumValues)[number];
export type OrigenRegistro = (typeof origenRegistroEnum.enumValues)[number];
export type ZonaModelo = (typeof zonaModeloEnum.enumValues)[number];
export type TipoReparacion = (typeof tipoReparacionEnum.enumValues)[number];

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
  /** Código visible de la unidad (T-01). Solo los tractos lo llevan. */
  codigo: text("codigo").unique(),
  tipo: tipoVehiculoEnum("tipo").notNull().default("tracto"),
  modelo: text("modelo"),
  anio: integer("anio"),
  estadoUnidad: estadoUnidadEnum("estado_unidad").notNull().default("en_base"),
  /** Odómetro actual en km: lo mueven las lecturas y los viajes con km. */
  odometroKm: integer("odometro_km").notNull().default(0),
  /** Viajes hechos antes de usar la app: se suman al conteo para los contadores de desgaste. */
  viajesBase: integer("viajes_base").notNull().default(0),
  /** Rendimiento para el cotizador (km por galón); null = el de los parámetros generales. */
  rendimientoKmGal: numeric("rendimiento_km_gal", { precision: 6, scale: 2 }),
  carretaId: integer("carreta_id"),
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
  rol: rolUsuarioEnum("rol").notNull().default("dueno"),
  conductorId: integer("conductor_id").references(() => conductor.id),
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
  nombreNormalizado: text("nombre_normalizado").notNull().unique(),
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
  origenLugar: text("origen_lugar"),
  destinoLugar: text("destino_lugar"),
  km: integer("km"),
  toneladas: numeric("toneladas", { precision: 10, scale: 2 }),
  /** Flete pactado sin IGV; null = se toma de las facturas aceptadas de sus guías. */
  flete: centimos("flete"),
  odometroInicio: integer("odometro_inicio"),
  odometroFin: integer("odometro_fin"),
  guiaRef: text("guia_ref"),
  /** Si los km del viaje ya se sumaron al odómetro de la unidad (evita sumarlos dos veces). */
  kmAplicados: boolean("km_aplicados").notNull().default(false),
  origen: origenRegistroEnum("origen").notNull().default("telegram"),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
});
// Sin índice único de "un viaje en curso por unidad": con varios dispositivos sincronizando, dos
// pueden abrir viaje a la vez sin verse. La regla la cuida la lógica (y avisa la sincronización).

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
  vehiculoId: integer("vehiculo_id").references(() => vehiculo.id),
  origen: origenRegistroEnum("origen").notNull().default("telegram"),
  rutaFoto: text("ruta_foto"),
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

// ── Control de flota ─────────────────────────────────────────────────────────

export const lecturaOdometro = pgTable("lectura_odometro", {
  id: serial("id").primaryKey(),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiculo.id),
  km: integer("km").notNull(),
  fecha: date("fecha", { mode: "string" }).notNull(),
  origen: origenRegistroEnum("origen").notNull(),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  viajeId: integer("viaje_id").references(() => viaje.id),
  creadoEn: creadoEn(),
});

export const tipoParte = pgTable("tipo_parte", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  nombreCorto: text("nombre_corto").notNull(),
  zona: zonaModeloEnum("zona").notNull(),
  vidaKm: integer("vida_km"),
  vidaViajes: integer("vida_viajes"),
  vidaDias: integer("vida_dias"),
  activo: boolean("activo").notNull().default(true),
});

export const repuesto = pgTable("repuesto", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  categoria: text("categoria").notNull(),
  stock: integer("stock").notNull().default(0),
  stockMinimo: integer("stock_minimo").notNull().default(0),
  /** Costo unitario promedio ponderado, en céntimos. */
  costoUnitario: centimos("costo_unitario").notNull().default(0),
  proveedor: text("proveedor"),
  tipoParteId: integer("tipo_parte_id").references(() => tipoParte.id),
  activo: boolean("activo").notNull().default(true),
  creadoEn: creadoEn(),
});

export const parteInstalada = pgTable("parte_instalada", {
  id: serial("id").primaryKey(),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiculo.id),
  tipoParteId: integer("tipo_parte_id").notNull().references(() => tipoParte.id),
  posicion: text("posicion").notNull().default(""),
  repuestoId: integer("repuesto_id").references(() => repuesto.id),
  fechaInstalacion: date("fecha_instalacion", { mode: "string" }).notNull(),
  kmInstalacion: integer("km_instalacion").notNull(),
  viajesInstalacion: integer("viajes_instalacion").notNull(),
  vidaKm: integer("vida_km"),
  vidaViajes: integer("vida_viajes"),
  vidaDias: integer("vida_dias"),
  costo: centimos("costo").notNull().default(0),
  activa: boolean("activa").notNull().default(true),
  /** Último umbral de alerta avisado (0, 70 o 90): cada umbral se avisa una sola vez. */
  alertaNivel: integer("alerta_nivel").notNull().default(0),
  retiradaEn: date("retirada_en", { mode: "string" }),
  creadoEn: creadoEn(),
});

export const compraRepuesto = pgTable("compra_repuesto", {
  id: serial("id").primaryKey(),
  repuestoId: integer("repuesto_id").notNull().references(() => repuesto.id),
  cantidad: integer("cantidad").notNull(),
  costoUnitario: centimos("costo_unitario").notNull(),
  fecha: date("fecha", { mode: "string" }).notNull(),
  proveedor: text("proveedor"),
  origen: origenRegistroEnum("origen").notNull().default("web"),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  creadoEn: creadoEn(),
});

export const reparacion = pgTable("reparacion", {
  id: serial("id").primaryKey(),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiculo.id),
  parteRetiradaId: integer("parte_retirada_id").references(() => parteInstalada.id),
  parteNuevaId: integer("parte_nueva_id").references(() => parteInstalada.id),
  tipoParteId: integer("tipo_parte_id").references(() => tipoParte.id),
  /** Pieza exacta del modelo 3D (llanta, retrovisor, faro…), para verla resaltada en el trailer. */
  componente: text("componente"),
  tipo: tipoReparacionEnum("tipo").notNull(),
  trabajo: text("trabajo").notNull(),
  odometro: integer("odometro").notNull(),
  fecha: date("fecha", { mode: "string" }).notNull(),
  manoObra: centimos("mano_obra").notNull().default(0),
  costoRepuestos: centimos("costo_repuestos").notNull().default(0),
  costoTotal: centimos("costo_total").notNull(),
  taller: text("taller"),
  /** % de desgaste que tenía la parte al cambiarla (para "¿Se cambió a tiempo?"). */
  desgastePct: integer("desgaste_pct"),
  gastoId: integer("gasto_id").references(() => gasto.id),
  origen: origenRegistroEnum("origen").notNull().default("web"),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  creadoEn: creadoEn(),
});

export const reparacionRepuesto = pgTable("reparacion_repuesto", {
  id: serial("id").primaryKey(),
  reparacionId: integer("reparacion_id").notNull().references(() => reparacion.id, { onDelete: "cascade" }),
  repuestoId: integer("repuesto_id").notNull().references(() => repuesto.id),
  cantidad: integer("cantidad").notNull(),
  costoUnitario: centimos("costo_unitario").notNull(),
});

export const ingreso = pgTable("ingreso", {
  id: serial("id").primaryKey(),
  fecha: date("fecha", { mode: "string" }).notNull(),
  concepto: text("concepto").notNull(),
  monto: centimos("monto").notNull(),
  vehiculoId: integer("vehiculo_id").references(() => vehiculo.id),
  viajeId: integer("viaje_id").references(() => viaje.id),
  origen: origenRegistroEnum("origen").notNull().default("web"),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  creadoEn: creadoEn(),
});

export const reinversion = pgTable("reinversion", {
  id: serial("id").primaryKey(),
  fecha: date("fecha", { mode: "string" }).notNull(),
  concepto: text("concepto").notNull(),
  monto: centimos("monto").notNull(),
  vehiculoId: integer("vehiculo_id").references(() => vehiculo.id),
  origen: origenRegistroEnum("origen").notNull().default("web"),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  creadoEn: creadoEn(),
});

export const prestamo = pgTable("prestamo", {
  id: serial("id").primaryKey(),
  entidad: text("entidad").notNull(),
  montoOriginal: centimos("monto_original").notNull(),
  /** Tasa efectiva anual en %, informativa. */
  tasaAnual: numeric("tasa_anual", { precision: 6, scale: 2 }).notNull(),
  cuotas: integer("cuotas").notNull(),
  fechaInicio: date("fecha_inicio", { mode: "string" }).notNull(),
  vehiculoId: integer("vehiculo_id").references(() => vehiculo.id),
  activo: boolean("activo").notNull().default(true),
  creadoEn: creadoEn(),
});

export const cuotaPrestamo = pgTable("cuota_prestamo", {
  id: serial("id").primaryKey(),
  prestamoId: integer("prestamo_id").notNull().references(() => prestamo.id, { onDelete: "cascade" }),
  numero: integer("numero").notNull(),
  vencimiento: date("vencimiento", { mode: "string" }).notNull(),
  monto: centimos("monto").notNull(),
  capital: centimos("capital").notNull(),
  pagadaEn: date("pagada_en", { mode: "string" }),
  avisada: boolean("avisada").notNull().default(false),
}, (t) => [unique("cuota_prestamo_numero").on(t.prestamoId, t.numero)]);

export const eventoTelegram = pgTable("evento_telegram", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  autor: text("autor"),
  comando: text("comando").notNull(),
  texto: text("texto").notNull(),
  payload: jsonb("payload"),
  vehiculoId: integer("vehiculo_id").references(() => vehiculo.id),
  entidad: text("entidad"),
  entidadId: integer("entidad_id"),
  estado: estadoEventoEnum("estado").notNull().default("ok"),
  creadoEn: creadoEn(),
});

export const cotizacion = pgTable("cotizacion", {
  id: serial("id").primaryKey(),
  ruta: text("ruta").notNull(),
  vehiculoId: integer("vehiculo_id").references(() => vehiculo.id),
  km: integer("km").notNull(),
  toneladas: numeric("toneladas", { precision: 10, scale: 2 }).notNull(),
  datos: jsonb("datos").notNull(),
  costo: centimos("costo").notNull(),
  flete: centimos("flete").notNull(),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  enviadaTelegram: boolean("enviada_telegram").notNull().default(false),
  creadoEn: creadoEn(),
});

/** Clave-valor para parámetros del cotizador, estado del bot (latido) y avisos enviados. */
export const ajuste = pgTable("ajuste", {
  clave: text("clave").primaryKey(),
  valor: jsonb("valor").notNull(),
  actualizadoEn: actualizadoEn(),
});

export const sesionWeb = pgTable("sesion_web", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  usuarioId: integer("usuario_id").notNull().references(() => usuario.id),
  expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),
  creadoEn: creadoEn(),
});

export const enlaceWeb = pgTable("enlace_web", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  usuarioId: integer("usuario_id").notNull().references(() => usuario.id),
  expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),
  usadoEn: timestamp("usado_en", { withTimezone: true }),
  creadoEn: creadoEn(),
});
