import { cargarConfig, cargarEnv, crearContexto, sembrarDatosIniciales, validarRuc } from "../src/index";

cargarEnv();

const e = process.env;
const faltantes = ["EMPRESA_RUC", "EMPRESA_RAZON_SOCIAL", "EMPRESA_DIRECCION", "EMPRESA_UBIGEO", "EMPRESA_REGISTRO_MTC", "VEHICULO_PLACA", "CONDUCTOR_DNI", "CONDUCTOR_NOMBRES", "CONDUCTOR_APELLIDOS", "CONDUCTOR_LICENCIA", "USUARIO_NOMBRE", "USUARIO_EMAIL"].filter((k) => !e[k]);
if (faltantes.length) {
  console.error(`Completa en .env: ${faltantes.join(", ")}`);
  process.exit(1);
}
if (!validarRuc(e.EMPRESA_RUC!)) {
  console.error("EMPRESA_RUC no es un RUC válido");
  process.exit(1);
}

const { ctx, cerrar } = await crearContexto(cargarConfig());
try {
  await sembrarDatosIniciales(ctx.db, {
    empresa: {
      ruc: e.EMPRESA_RUC!, razonSocial: e.EMPRESA_RAZON_SOCIAL!, direccion: e.EMPRESA_DIRECCION!, ubigeo: e.EMPRESA_UBIGEO!,
      registroMtc: e.EMPRESA_REGISTRO_MTC!, ...(e.EMPRESA_CUENTA_DETRACCION ? { cuentaDetraccionBn: e.EMPRESA_CUENTA_DETRACCION } : {}),
    },
    vehiculo: { placa: e.VEHICULO_PLACA! },
    conductor: { numeroDoc: e.CONDUCTOR_DNI!, nombres: e.CONDUCTOR_NOMBRES!, apellidos: e.CONDUCTOR_APELLIDOS!, licencia: e.CONDUCTOR_LICENCIA! },
    usuario: { nombre: e.USUARIO_NOMBRE!, email: e.USUARIO_EMAIL!, ...(e.USUARIO_TELEGRAM_ID ? { telegramId: Number(e.USUARIO_TELEGRAM_ID) } : {}) },
  });
  console.log("Datos iniciales cargados.");
} finally {
  await cerrar();
}
