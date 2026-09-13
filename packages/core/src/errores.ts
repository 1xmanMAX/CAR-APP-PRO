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
