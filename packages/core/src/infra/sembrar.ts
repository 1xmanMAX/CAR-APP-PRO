import { conductor, empresa, usuario, vehiculo, type Db } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";

export interface DatosIniciales {
  empresa: { ruc: string; razonSocial: string; nombreComercial?: string; direccion: string; ubigeo: string; registroMtc: string; cuentaDetraccionBn?: string };
  vehiculo: { placa: string; marca?: string; numeroAutorizacion?: string };
  conductor: { numeroDoc: string; nombres: string; apellidos: string; licencia: string };
  usuario: { nombre: string; email: string; telegramId?: number };
}

export async function sembrarDatosIniciales(db: Db, d: DatosIniciales): Promise<void> {
  if ((await db.select({ id: empresa.id }).from(empresa).limit(1)).length > 0) {
    throw new ErrorNegocio("Los datos iniciales ya fueron cargados");
  }
  await db.transaction(async (tx) => {
    await tx.insert(empresa).values(d.empresa);
    await tx.insert(vehiculo).values(d.vehiculo);
    await tx.insert(conductor).values({ ...d.conductor, tipoDoc: "1" });
    await tx.insert(usuario).values(d.usuario);
  });
}
