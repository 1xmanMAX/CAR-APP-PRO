import { conductor, empresa, eq, usuario, vehiculo, type Db } from "@sunatapp/db";
import { sembrarCatalogoPartes } from "../flota/catalogo";
import { normalizarPlaca } from "@sunatapp/sunat";
import { ErrorNegocio } from "../errores";

export interface DatosIniciales {
  empresa: { ruc: string; razonSocial: string; nombreComercial?: string; direccion: string; ubigeo: string; registroMtc: string; cuentaDetraccionBn?: string };
  vehiculo: { placa: string; marca?: string; numeroAutorizacion?: string };
  /**
   * La carreta de la unidad habitual (tracto + carreta). Opcional, pero sin ella la primera guía
   * real siempre pregunta por la placa secundaria: `transporteHabitual` saca la carreta del
   * segundo vehículo activo.
   */
  vehiculoSecundario?: { placa: string; marca?: string; numeroAutorizacion?: string };
  conductor: { numeroDoc: string; nombres: string; apellidos: string; licencia: string };
  usuario: { nombre: string; email: string; telegramId?: number };
}

export async function sembrarDatosIniciales(db: Db, d: DatosIniciales): Promise<void> {
  if ((await db.select({ id: empresa.id }).from(empresa).limit(1)).length > 0) {
    throw new ErrorNegocio("Los datos iniciales ya fueron cargados");
  }
  if (d.vehiculoSecundario && normalizarPlaca(d.vehiculoSecundario.placa) === normalizarPlaca(d.vehiculo.placa)) {
    throw new ErrorNegocio("La placa de la carreta no puede ser la misma que la del tracto");
  }
  await db.transaction(async (tx) => {
    await tx.insert(empresa).values(d.empresa);
    // El orden importa: `transporteHabitual` toma el primer vehículo activo como tracto y el
    // segundo como carreta.
    const [tracto] = await tx.insert(vehiculo).values({ ...d.vehiculo, codigo: "T-01", tipo: "tracto" }).returning({ id: vehiculo.id });
    if (d.vehiculoSecundario) {
      const [carreta] = await tx.insert(vehiculo).values({ ...d.vehiculoSecundario, tipo: "carreta" }).returning({ id: vehiculo.id });
      await tx.update(vehiculo).set({ carretaId: carreta!.id }).where(eq(vehiculo.id, tracto!.id));
    }
    await tx.insert(conductor).values({ ...d.conductor, tipoDoc: "1" });
    await tx.insert(usuario).values({ ...d.usuario, rol: "dueno" });
    await sembrarCatalogoPartes(tx);
  });
}
