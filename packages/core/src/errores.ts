export class ErrorValidacion extends Error {
  constructor(public readonly errores: string[]) {
    super(errores.join("; "));
    this.name = "ErrorValidacion";
  }
}

export class ErrorNegocio extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorNegocio";
  }
}

/** Los datos de la empresa se piden cuando hacen falta (al emitir), no al instalar la app. */
export const FALTA_EMPRESA = "Faltan los datos de tu empresa (RUC, razón social, dirección…): complétalos en la app, en Ajustes → Empresa.";
