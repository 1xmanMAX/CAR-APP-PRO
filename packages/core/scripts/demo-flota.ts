/**
 * Carga datos de DEMOSTRACIÓN (5 trailers, viajes, partes, inventario, reparaciones, finanzas y
 * eventos del bot) en una base aparte (por defecto ./data-demo), nunca en la real.
 *
 *   pnpm demo:flota                 # crea ./data-demo y la llena
 *   DATA_DIR=./data-demo pnpm web   # la web sobre esos datos (usuario demo@flota.pe / demo1234)
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { crearDb, type Db } from "@sunatapp/db";
import {
  crearAlmacenLocal, crearPrestamo, crearRepuesto, crearUnidad, guardarUsuario, instalarParte, listarTiposParte, pagarCuota,
  partesDeUnidad, registrarCambio, registrarCompra, registrarEvento, registrarGasto, registrarIngreso, registrarLecturaOdometro,
  registrarReinversion, registrarViajeFlota, sembrarDatosIniciales, sumarDias, fechaHoraLima, buscarUnidad, finalizarViajeFlota,
  type Contexto, type CategoriaGasto,
} from "../src";
import { cargarPfx, generarCertificadoPrueba, SunatSimulado } from "@sunatapp/sunat";

const dir = process.env.DEMO_DIR ?? "./data-demo";
if (existsSync(join(dir, "pglite"))) {
  console.error(`Ya existe ${dir}. Bórrala si quieres volver a generar la demo.`);
  process.exit(1);
}
await mkdir(join(dir, "pglite"), { recursive: true });
const { db, cerrar } = await crearDb({ tipo: "pglite", directorio: join(dir, "pglite") });

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const entre = (a: number, b: number) => Math.round(a + rnd() * (b - a));

const hoyReal = fechaHoraLima(new Date()).fecha;
let relojFecha = hoyReal;
const ctx: Contexto = {
  db: db as Db,
  gateway: new SunatSimulado({ demoraMs: 0 }),
  certificado: cargarPfx(generarCertificadoPrueba({ ruc: "20601234567", razonSocial: "TRANSPORTES ANDINOS SAC", password: "x" }), "x"),
  almacen: crearAlmacenLocal(join(dir, "storage")),
  // El reloj avanza con los datos que se generan, para que las fechas sean coherentes.
  reloj: () => new Date(`${relojFecha}T17:00:00Z`),
  dormir: async () => {},
  simulado: true,
  facturaSimulada: true,
};

await sembrarDatosIniciales(db as Db, {
  empresa: { ruc: "20601234567", razonSocial: "TRANSPORTES ANDINOS SAC", nombreComercial: "ANDINOS", direccion: "AV. CIRCUNVALACIÓN 480, JULIACA", ubigeo: "211101", registroMtc: "1512345CNG", cuentaDetraccionBn: "00-101-123456" },
  vehiculo: { placa: "F2F-848", marca: "VOLVO" },
  vehiculoSecundario: { placa: "V1X-971" },
  conductor: { numeroDoc: "45288569", nombres: "JUAN", apellidos: "QUISPE MAMANI", licencia: "Q45288569" },
  usuario: { nombre: "Demo Dueño", email: "demo@flota.pe" },
});
await guardarUsuario(ctx, { id: 1, nombre: "Demo Dueño", email: "demo@flota.pe", rol: "dueno", clave: "demo1234" });
await guardarUsuario(ctx, { nombre: "Contadora", email: "contador@flota.pe", rol: "contador", clave: "demo1234" });
await guardarUsuario(ctx, { nombre: "Taller Base", email: "taller@flota.pe", rol: "taller", clave: "demo1234" });

const inicio = sumarDias(hoyReal, -125);
relojFecha = inicio;
const t01 = (await buscarUnidad(ctx, "T-01"))!;
const { actualizarUnidad } = await import("../src");
await actualizarUnidad(ctx, t01.id, { marca: "VOLVO", modelo: "FH 540", anio: 2019, viajesBase: 120 });
await registrarLecturaOdometro(ctx, { vehiculoId: t01.id, km: 355000, origen: "web" });
const unidades = [t01.id];
const otras = [
  { placa: "D4K-102", placaCarreta: "V2A-330", marca: "SCANIA", modelo: "R 450", anio: 2020, odometroKm: 298000, viajesBase: 96 },
  { placa: "B7M-515", placaCarreta: "V5C-812", marca: "VOLVO", modelo: "FH 460", anio: 2018, odometroKm: 402000, viajesBase: 150 },
  { placa: "C9P-221", placaCarreta: "V8D-104", marca: "INTERNATIONAL", modelo: "LT 625", anio: 2021, odometroKm: 188000, viajesBase: 62 },
  { placa: "E3R-760", placaCarreta: "V3F-559", marca: "FREIGHTLINER", modelo: "CASCADIA", anio: 2017, odometroKm: 455000, viajesBase: 171 },
];
for (const o of otras) unidades.push((await crearUnidad(ctx, o)).id);

const tipos = await listarTiposParte(ctx);
// Inventario.
const reps: Record<string, number> = {};
const catalogoRep: Array<[string, string, string, number, number, number]> = [
  ["frenos_sr", "Pastillas de freno semirremolque", "Frenos", 180, 30, 6],
  ["aceite", "Aceite 15W40 (balde 5 gal) + filtro", "Lubricantes", 420, 12, 3],
  ["filtro_aire", "Filtro de aire", "Filtros", 160, 8, 2],
  ["llantas_trac", "Llanta 295/80 R22.5 tracción", "Llantas", 1450, 10, 4],
  ["llantas_sr", "Llanta 295/80 R22.5 semirremolque", "Llantas", 1280, 14, 4],
  ["bateria", "Batería 12V 150Ah", "Eléctrico", 690, 3, 1],
  ["amortiguadores", "Amortiguador delantero", "Suspensión", 380, 4, 2],
  ["quinta", "Grasa para quinta rueda (kg)", "Lubricantes", 35, 20, 5],
];
for (const [codigoTipo, nombre, cat, costo, cant, min] of catalogoRep) {
  const tipo = tipos.find((t) => t.codigo === codigoTipo);
  const id = await crearRepuesto(ctx, { nombre, categoria: cat, stockMinimo: min, tipoParteId: tipo?.id, proveedor: cat === "Llantas" ? "Llantas del Sur" : "Repuestos Juliaca" });
  await registrarCompra(ctx, { repuestoId: id, cantidad: cant, costoUnitario: costo * 100, origen: rnd() > 0.5 ? "telegram" : "web", fecha: inicio });
  reps[codigoTipo] = id;
}

// Viajes de los últimos ~4 meses con gastos.
const rutas: Array<[string, string, number, number]> = [
  ["Juliaca", "Arequipa", 1290, 3900], ["Puno", "Lima", 3050, 9800], ["Arequipa", "Cusco", 1020, 3300], ["Juliaca", "Tacna", 1480, 4500],
  ["Arequipa", "Matarani", 240, 1200], ["Cusco", "Lima", 2200, 7400],
];
const gastoPlantilla: Array<[CategoriaGasto, number]> = [["combustible", 0.34], ["peaje", 0.05], ["viaticos", 0.04], ["estiba", 0.02], ["cochera", 0.01]];
let guia = 180;
for (let dia = 0; dia <= 124; dia += 1) {
  relojFecha = sumarDias(inicio, dia);
  for (const vid of unidades) {
    if (rnd() > 0.2) continue;
    const [o, dst, km, flete] = rutas[entre(0, rutas.length - 1)]!;
    const kmReal = km + entre(-40, 60);
    const fleteReal = Math.round(flete * (0.92 + rnd() * 0.18)) * 100;
    const v = await registrarViajeFlota(ctx, {
      vehiculoId: vid, origenLugar: o, destinoLugar: dst, km: kmReal, toneladas: entre(26, 32), flete: fleteReal,
      guiaRef: `T001-0${guia++}`, fecha: relojFecha, origen: rnd() > 0.35 ? "telegram" : "web",
    });
    for (const [cat, prop] of gastoPlantilla) {
      if (cat !== "combustible" && rnd() > 0.7) continue;
      await registrarGasto(ctx, { categoria: cat, monto: Math.round(fleteReal * prop * (0.85 + rnd() * 0.3)), viajeId: v.id, fecha: relojFecha, origen: rnd() > 0.3 ? "telegram" : "web" });
    }
  }
}

// Partes: se instalan con un desgaste realista (entre 8 % y 97 %) según los contadores reales.
relojFecha = hoyReal;
for (const vid of unidades) {
  const u = (await buscarUnidad(ctx, vid))!;
  for (const t of tipos) {
    const r = 0.08 + rnd() * 0.89;
    const kmUso = t.vidaKm ? Math.round(t.vidaKm * r * (0.8 + rnd() * 0.2)) : 0;
    const viajesUso = t.vidaViajes ? Math.round(t.vidaViajes * r * (0.8 + rnd() * 0.2)) : 0;
    const diasUso = t.vidaDias ? Math.round(t.vidaDias * r * (0.7 + rnd() * 0.3)) : 0;
    await instalarParte(ctx, {
      vehiculoId: vid, tipoParteId: t.id, fecha: sumarDias(hoyReal, -diasUso), km: Math.max(0, u.odometroKm - kmUso),
      viajes: Math.max(0, u.viajesTotales - viajesUso), costo: entre(150, 3200) * 100,
    });
  }
}

// Cambios de partes (algunos a tiempo, otros pronto o tarde).
relojFecha = hoyReal;
for (const vid of unidades.slice(0, 4)) {
  const partes = await partesDeUnidad(ctx, vid);
  const p = partes.find((x) => reps[x.codigoTipo] !== undefined && x.pct >= 60) ?? partes.find((x) => reps[x.codigoTipo] !== undefined);
  if (!p) continue;
  await registrarCambio(ctx, {
    vehiculoId: vid, parteInstaladaId: p.id, tipo: p.pct > 100 ? "correctivo" : "preventivo",
    repuestos: [{ repuestoId: reps[p.codigoTipo]!, cantidad: p.codigoTipo.startsWith("llantas") ? 2 : 1 }], manoObra: entre(80, 350) * 100,
    taller: rnd() > 0.5 ? "Taller Base" : "Servicentro Juliaca", origen: rnd() > 0.5 ? "telegram" : "web",
  });
}

// T-01: el caso del diseño. Frenos del semirremolque al 92 % (22/24 viajes, 46,800/60,000 km, 140/240 días).
relojFecha = hoyReal;
const frenos = tipos.find((t) => t.codigo === "frenos_sr")!;
const unidadT01 = (await buscarUnidad(ctx, t01.id))!;
await instalarParte(ctx, {
  vehiculoId: t01.id, tipoParteId: frenos.id, fecha: sumarDias(hoyReal, -140), km: unidadT01.odometroKm - 46800,
  viajes: unidadT01.viajesTotales - 22, repuestoId: reps.frenos_sr, costo: 6 * 18000,
});
// Una unidad en ruta ahora mismo.
const enRuta = await registrarViajeFlota(ctx, { vehiculoId: unidades[1]!, origenLugar: "Juliaca", destinoLugar: "Arequipa", toneladas: 30, estado: "en_curso", origen: "telegram" });
void enRuta;
void finalizarViajeFlota;

// Finanzas.
relojFecha = sumarDias(hoyReal, -200);
const prestamo = await crearPrestamo(ctx, { entidad: "BCP · Leasing T-05", monto: 42000000, tasaAnual: 13.5, cuotas: 36, fechaInicio: relojFecha, vehiculoId: unidades[4] });
for (let k = 0; k < 6; k++) {
  relojFecha = sumarDias(hoyReal, -170 + k * 30);
  await pagarCuota(ctx, prestamo, relojFecha);
}
relojFecha = sumarDias(hoyReal, -90);
await crearPrestamo(ctx, { entidad: "Caja Arequipa · capital de trabajo", monto: 6000000, tasaAnual: 18, cuotas: 12, fechaInicio: relojFecha });
relojFecha = sumarDias(hoyReal, -60);
await registrarReinversion(ctx, { concepto: "GPS para toda la flota", monto: 950000, origen: "web" });
relojFecha = sumarDias(hoyReal, -15);
await registrarReinversion(ctx, { concepto: "Carreta nueva V3F-559", monto: 8500000, vehiculoId: unidades[4], origen: "web" });
await registrarIngreso(ctx, { concepto: "Alquiler de cochera a tercero", monto: 60000, origen: "web" });

const { guardarPresupuestoMensual } = await import("../src");
await guardarPresupuestoMensual(ctx, { combustible: 3200000, peaje: 450000, viaticos: 300000, estiba: 150000, cochera: 60000, reparacion: 900000 });

// Eventos del bot (feed del Dashboard).
relojFecha = hoyReal;
const eventos: Array<[string, string, number]> = [
  ["/viaje inicio", "T-02 sale: Juliaca → Arequipa · 30 ton", unidades[1]!],
  ["/gasto", "Combustible S/ 480.00 · con foto del voucher", unidades[1]!],
  ["/km", "T-03 odómetro 402,380 km (+1,290)", unidades[2]!],
  ["/compra", "6 × Pastillas de freno semirremolque · S/ 1,080.00", t01.id],
  ["/cambio", "T-04 · Aceite y filtro de motor al 91% (A TIEMPO)", unidades[3]!],
  ["alerta", "T-01 · Frenos semirremolque al 92%. Quedan ≈ 2 viajes", t01.id],
];
for (const [comando, texto, vehiculoId] of eventos) await registrarEvento(ctx, { comando, texto, vehiculoId, autor: "Juan Q." });

await cerrar();
console.log(`Demo lista en ${dir}.\nArranca la web con:  DATA_DIR=${dir} STORAGE_DIR=${dir}/storage pnpm web\nEntra con demo@flota.pe / demo1234 (también contador@flota.pe y taller@flota.pe).`);
