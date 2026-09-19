import { conductor, empresa, eq, sql, vehiculo } from "@sunatapp/db";
import { normalizarPlaca } from "@sunatapp/sunat";
import { ErrorNegocio } from "../errores";
import type { Contexto } from "../infra/contexto";

export interface DatosConductor {
  numeroDoc: string;
  nombres: string;
  apellidos: string;
  licencia: string;
}

export interface TransporteGuia {
  rucTransportista: string;
  placaPrincipal: string;
  placasSecundarias: string[];
  conductor: DatosConductor;
}

export interface ComparacionTransporte {
  rucEmpresaCoincide: boolean;
  placaPrincipal: "registrada" | "nueva";
  placasSecundarias: Array<{ placa: string; estado: "registrada" | "nueva" }>;
  conductor: "registrado" | "nuevo";
}

function placaSql(columna: typeof vehiculo.placa) {
  return sql`upper(regexp_replace(${columna}, '[^A-Za-z0-9]', '', 'g'))`;
}

async function buscarVehiculoPorPlaca(ctx: Contexto, placa: string): Promise<{ id: number } | undefined> {
  const [v] = await ctx.db.select({ id: vehiculo.id }).from(vehiculo).where(sql`${placaSql(vehiculo.placa)} = ${normalizarPlaca(placa)}`);
  return v;
}

async function buscarConductorPorDni(ctx: Contexto, numeroDoc: string): Promise<{ id: number } | undefined> {
  const [c] = await ctx.db.select({ id: conductor.id }).from(conductor).where(eq(conductor.numeroDoc, numeroDoc));
  return c;
}

export async function compararTransporte(ctx: Contexto, t: TransporteGuia): Promise<ComparacionTransporte> {
  const [emp] = await ctx.db.select({ ruc: empresa.ruc }).from(empresa).limit(1);
  const principal = await buscarVehiculoPorPlaca(ctx, t.placaPrincipal);
  const secundarias = await Promise.all(
    t.placasSecundarias.map(async (placa) => ({ placa, estado: (await buscarVehiculoPorPlaca(ctx, placa)) ? ("registrada" as const) : ("nueva" as const) })),
  );
  const cond = await buscarConductorPorDni(ctx, t.conductor.numeroDoc);
  return {
    rucEmpresaCoincide: emp?.ruc === t.rucTransportista,
    placaPrincipal: principal ? "registrada" : "nueva",
    placasSecundarias: secundarias,
    conductor: cond ? "registrado" : "nuevo",
  };
}

export async function registrarVehiculo(ctx: Contexto, placa: string): Promise<number> {
  const existente = await buscarVehiculoPorPlaca(ctx, placa);
  if (existente) return existente.id;
  const [fila] = await ctx.db.insert(vehiculo).values({ placa }).onConflictDoNothing({ target: vehiculo.placa }).returning({ id: vehiculo.id });
  if (fila) return fila.id;
  const ganador = await buscarVehiculoPorPlaca(ctx, placa);
  return ganador!.id;
}

export async function registrarConductor(ctx: Contexto, d: DatosConductor): Promise<number> {
  const existente = await buscarConductorPorDni(ctx, d.numeroDoc);
  if (existente) return existente.id;
  const [fila] = await ctx.db
    .insert(conductor)
    .values({ numeroDoc: d.numeroDoc, nombres: d.nombres, apellidos: d.apellidos, licencia: d.licencia })
    .onConflictDoNothing({ target: conductor.numeroDoc })
    .returning({ id: conductor.id });
  if (fila) return fila.id;
  const ganador = await buscarConductorPorDni(ctx, d.numeroDoc);
  return ganador!.id;
}

export async function transporteHabitual(ctx: Contexto): Promise<TransporteGuia> {
  const [emp] = await ctx.db.select({ ruc: empresa.ruc }).from(empresa).limit(1);
  const vehiculos = await ctx.db.select().from(vehiculo).where(eq(vehiculo.activo, true)).orderBy(vehiculo.id).limit(2);
  const [cond] = await ctx.db.select().from(conductor).where(eq(conductor.activo, true)).orderBy(conductor.id).limit(1);
  if (!emp || !vehiculos[0] || !cond) throw new ErrorNegocio("Falta configurar empresa, vehículo o conductor");
  return {
    rucTransportista: emp.ruc,
    placaPrincipal: vehiculos[0].placa,
    placasSecundarias: vehiculos[1] ? [vehiculos[1].placa] : [],
    conductor: { numeroDoc: cond.numeroDoc, nombres: cond.nombres, apellidos: cond.apellidos, licencia: cond.licencia },
  };
}
