import {
  buscarFacturaPorSerieNumero,
  ErrorNegocio,
  fechaHoraLima,
  formatearSoles,
  listarBorradores,
  listarCobrosPendientes,
  listarGuias,
  parsearMonto,
  registrarCobro,
} from "@sunatapp/core";
import { InlineKeyboard, type Bot, type CommandContext } from "grammy";
import type { ContextoBot, Dependencias } from "./bot";
import { lineaCobro, lineaGuia, lineaPendiente, textos } from "./textos";

type CtxComando = CommandContext<ContextoBot>;

async function comandoGuias(c: CtxComando, deps: Dependencias): Promise<void> {
  const filas = await listarGuias(deps.ctx);
  if (filas.length === 0) {
    await c.reply(textos.sinGuias);
    return;
  }
  await c.reply(filas.map(lineaGuia).join("\n"));
}

async function comandoPendientes(c: CtxComando, deps: Dependencias): Promise<void> {
  const filas = await listarBorradores(deps.ctx);
  if (filas.length === 0) {
    await c.reply(textos.sinPendientes);
    return;
  }
  for (const f of filas) {
    await c.reply(lineaPendiente(f), {
      reply_markup: new InlineKeyboard().text(textos.botonRetomar(f.serieNumero), `g:retomar:${f.id}`),
    });
  }
}

async function comandoCobros(c: CtxComando, deps: Dependencias): Promise<void> {
  const { filas, totalPendiente, totalVencido } = await listarCobrosPendientes(deps.ctx);
  if (filas.length === 0) {
    await c.reply(textos.sinCobros);
    return;
  }
  const lineas = filas.map(lineaCobro);
  lineas.push(`Por cobrar: ${formatearSoles(totalPendiente)} · Vencido: ${formatearSoles(totalVencido)}`);
  await c.reply(lineas.join("\n"));
}

/** Separa "F001-2 1500" en la serie-número y el resto del texto (el monto, si se escribió). */
function partirArgumentos(texto: string): { serieNumero: string; resto: string } {
  const espacio = texto.indexOf(" ");
  return espacio === -1
    ? { serieNumero: texto, resto: "" }
    : { serieNumero: texto.slice(0, espacio), resto: texto.slice(espacio + 1).trim() };
}

async function comandoPagado(c: CtxComando, deps: Dependencias): Promise<void> {
  const texto = c.match.trim();
  if (!texto) {
    await c.reply(textos.pagadoUso);
    return;
  }
  const { serieNumero, resto } = partirArgumentos(texto);
  let montoCentimos: number | undefined;
  if (resto) {
    // Esto es dinero: si después del monto sobra algo, no se adivina. `parsearMonto` borra los
    // espacios, así que "/pagado F001-2 1500 300" se leería como S/ 15,003.00 en vez de fallar.
    const monto = /\s/.test(resto) ? null : parsearMonto(resto);
    if (monto === null) {
      await c.reply(textos.pagadoUso);
      return;
    }
    montoCentimos = monto;
  }
  const fac = await buscarFacturaPorSerieNumero(deps.ctx, serieNumero);
  if (!fac) {
    await c.reply(textos.facturaNoEncontrada(serieNumero.toUpperCase()));
    return;
  }
  if (montoCentimos === undefined) {
    const { filas } = await listarCobrosPendientes(deps.ctx);
    const pendiente = filas.find((f) => f.facturaId === fac.id);
    if (!pendiente) {
      await c.reply(textos.facturaSinSaldo(serieNumero.toUpperCase()));
      return;
    }
    montoCentimos = pendiente.saldo;
  }
  try {
    const { estadoCobro, saldo } = await registrarCobro(deps.ctx, {
      facturaId: fac.id,
      montoCentimos,
      medio: "transferencia",
      fecha: fechaHoraLima(deps.ctx.reloj()).fecha,
      ...(c.session.usuarioId !== undefined ? { usuarioId: c.session.usuarioId } : {}),
    });
    await c.reply(textos.cobroRegistrado(saldo, estadoCobro));
  } catch (error) {
    if (error instanceof ErrorNegocio) {
      await c.reply(error.message);
      return;
    }
    throw error;
  }
}

/**
 * Comandos de consulta y cobro, y el único /cancelar del bot (antes vivía repartido entre los dos
 * flujos). Se registran antes que `registrarFlujoGuia`: su `bot.on("message:text")` es un
 * atrapatodo que, si llegara primero, trataría cualquiera de estos comandos como una respuesta
 * suelta de la conversación en curso.
 */
export function registrarComandos(bot: Bot<ContextoBot>, deps: Dependencias): void {
  bot.command("guias", (c) => comandoGuias(c, deps));
  bot.command("pendientes", (c) => comandoPendientes(c, deps));
  bot.command("cobros", (c) => comandoCobros(c, deps));
  bot.command("pagado", (c) => comandoPagado(c, deps));
  bot.command("cancelar", async (c) => {
    if (!c.session.flujo) {
      await c.reply(textos.noHayNadaQueCancelar);
      return;
    }
    delete c.session.flujo;
    await c.reply(textos.cancelado);
  });
}
