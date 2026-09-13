import "./cargar-env";
import { empresa } from "@sunatapp/db";
import {
  cargarConfig, crearContexto, emitirFactura, emitirGuia, formatearSoles, listarCobrosPendientes, prepararFactura,
  registrarCobro, registrarGuiaBorrador, sembrarDatosIniciales,
} from "../src/index";

const config = cargarConfig();
const { ctx, cerrar } = await crearContexto(config);
try {
  if ((await ctx.db.select().from(empresa)).length === 0) {
    console.log("Sin datos iniciales: cargando empresa de demostración…");
    await sembrarDatosIniciales(ctx.db, {
      empresa: { ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", direccion: "AV. DEMO 123", ubigeo: "150115", registroMtc: "15123456CNG", cuentaDetraccionBn: "00-045-091619" },
      vehiculo: { placa: "ABC-123" },
      conductor: { numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" },
      usuario: { nombre: "Demo", email: "demo@demo.pe" },
    });
  }
  console.log(`Modo SUNAT: ${config.sunatModo}`);

  const guiaId = await registrarGuiaBorrador(ctx, {
    fechaTraslado: new Date().toISOString().slice(0, 10),
    remitente: { numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA DEMO SAC" },
    destinatario: { numeroDoc: "20602712592", razonSocial: "CLIENTE FINAL DEMO SAC" },
    partida: { direccion: "AV. 28 DE JULIO 1275", ubigeo: "150115" },
    llegada: { direccion: "CARRETERA FEDERICO BASADRE KM 86", ubigeo: "250101" },
    pesoBruto: "1500",
    unidadPeso: "KGM",
    greRemitenteRef: "EG01-123",
    items: [{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }],
  });
  const guia = await emitirGuia(ctx, guiaId);
  console.log(`Guía ${guia.serieNumero}: ${guia.estado} ${guia.mensaje ?? ""}`);
  if (guia.rutaPdf) console.log(`  PDF: ${ctx.almacen.rutaAbsoluta(guia.rutaPdf)}`);
  if (guia.estado !== "aceptada") process.exit(1);

  const { facturaId, montos } = await prepararFactura(ctx, { guiaId, montoCentimos: 150000, incluyeIgv: true, formaPago: "credito", diasCredito: 30 });
  console.log(`Factura preparada: total ${formatearSoles(montos.total)}, detracción ${formatearSoles(montos.detraccionMonto)}`);
  const fac = await emitirFactura(ctx, facturaId);
  console.log(`Factura ${fac.serieNumero}: ${fac.estado} ${fac.mensaje ?? ""}`);
  if (fac.rutaPdf) console.log(`  PDF: ${ctx.almacen.rutaAbsoluta(fac.rutaPdf)}`);

  if (fac.estado === "aceptada" || fac.estado === "observada") {
    await registrarCobro(ctx, { facturaId, montoCentimos: 50000, fecha: new Date().toISOString().slice(0, 10), medio: "transferencia" });
    const cobros = await listarCobrosPendientes(ctx);
    console.log(`Por cobrar: ${formatearSoles(cobros.totalPendiente)} (vencido ${formatearSoles(cobros.totalVencido)})`);
  }
} finally {
  await cerrar();
}
