/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { chatAlertas, estadoBot, listarEventos, listarUnidades, partesConDesgaste } from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { FeedTelegram } from "./dashboard";
import { Panel } from "../ui";

export const COMANDOS: Array<[string, string]> = [
  ["/viaje inicio", "Elige la unidad con botones, luego ruta y toneladas: crea el viaje en curso y suma 1 viaje a sus partes"],
  ["/fin", "Cierra el viaje en curso y pide el odómetro final (o los km)"],
  ["/gasto combustible 480", "Registra un gasto del viaje o trailer actual; manda la foto del voucher con el comando en el pie"],
  ["/km 412380", "Lectura de odómetro: suma los km a todas las partes y recalcula el desgaste"],
  ["/cambio", "Flujo guiado: unidad → parte → repuestos → costo (igual que Reparaciones)"],
  ["/compra REP-014 6 180", "Compra de repuesto al inventario (código, cantidad, costo unitario)"],
  ["/estado T-01", "Las próximas partes a cambiar de la unidad"],
  ["/web", "Enlace de un solo uso (10 min) para entrar a esta web"],
  ["PDF de la guía", "Envía el PDF del remitente: el bot arma y emite la GRE transportista (SUNAT)"],
  ["/facturar V001-1 · /cobros · /pagado", "Factura el flete, lista lo pendiente y registra cobros"],
];

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const [bot, eventos, chat, unidades] = await Promise.all([estadoBot(ctx), listarEventos(ctx, 40), chatAlertas(ctx), listarUnidades(ctx)]);
  const partes = await partesConDesgaste(ctx, unidades.map((u) => u.id));
  const peor = partes[0];
  const unidadPeor = unidades.find((u) => u.id === peor?.vehiculoId);
  const codigos = unidades.map((u) => u.codigo).slice(0, 6);

  return pagina(c, d, { titulo: "Bot de Telegram", seccion: "telegram" }, (
    <div class="grid g-tg">
      <Panel titulo="ASÍ SE VE EN EL CELULAR DEL CHOFER">
        <div class="telefono" aria-label="Ejemplo de conversación con el bot">
          <div class="tcab"><b>🤖 Control Flota</b><span style="font-size:11px;color:#8FA3B5">bot · {bot.enLinea ? "en línea" : "desconectado"}</span></div>
          {peor && peor.pct >= 70 ? (
            <div class="burbuja bot"><span class="t">ALERTA · {unidadPeor?.codigo}</span>{peor.nombreCorto} al {peor.pct}%. Quedan ≈ {peor.restanteTexto.toLowerCase()}. Programa el cambio.</div>
          ) : null}
          <div class="burbuja yo">/viaje inicio</div>
          <div class="burbuja bot">¿Qué unidad sale?</div>
          <div class="teclado">{(codigos.length ? codigos : ["T-01"]).map((x) => <span>{x}</span>)}</div>
          <div class="burbuja yo">Juliaca → Arequipa · 30 ton</div>
          <div class="burbuja bot"><span class="t">VIAJE REGISTRADO</span>{codigos[0] ?? "T-01"} en ruta. Se suma 1 viaje a cada parte de la unidad.</div>
          <div class="burbuja yo">📷 [foto del voucher]{"\n"}/gasto combustible 480</div>
          <div class="burbuja bot"><span class="t">GASTO GUARDADO</span>{codigos[0] ?? "T-01"} · Combustible · S/ 480.00. Ya aparece en Finanzas.</div>
          <div class="burbuja yo">/km 412380</div>
          <div class="burbuja bot">Odómetro actualizado: +1,290 km a frenos, llantas y aceite.</div>
          <div class="teclado"><span>/viaje</span><span>/fin</span><span>/gasto</span><span>/km</span><span>/cambio</span><span>/estado</span></div>
        </div>
      </Panel>
      <div class="filas" style="gap:10px;min-width:0">
        <Panel titulo="ESTADO DEL BOT">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span class={`bot-estado${bot.enLinea ? "" : " off"}`}>{bot.enLinea ? "EN LÍNEA" : "DESCONECTADO"}</span>
            <span class="muted" style="font-size:12px">{bot.ultimo ? `Último latido: ${new Date(bot.ultimo).toLocaleString("es-PE", { timeZone: "America/Lima" })}` : "El bot todavía no se ha conectado."}</span>
          </div>
          {!bot.enLinea ? (
            <div class="aviso info">Para encenderlo pon <b>TELEGRAM_BOT_TOKEN</b> en el archivo <code>.env</code> y ejecuta <code>pnpm app</code>. Las alertas y avisos que se generen mientras tanto quedan en cola y se envían al conectarse.</div>
          ) : null}
          <span class="muted" style="font-size:12px">Alertas al {chat ? <>grupo <code>{chat}</code></> : "dueño por mensaje privado"}. {chat ? null : <>Para usar un grupo: agrega el bot al grupo del equipo y escribe <b>/grupo</b> allí.</>}</span>
        </Panel>
        <Panel titulo="COMANDOS">
          <div class="tabla-wrap"><table class="t"><tbody>
            {COMANDOS.map(([k, v]) => <tr><td class="nowrap"><b style="color:var(--accent)">{k}</b></td><td>{v}</td></tr>)}
          </tbody></table></div>
          <span class="muted" style="font-size:11px">Solo responde a usuarios registrados. Para sumar un chofer: créalo en Ajustes con su ID de Telegram (el bot se lo dice con /start).</span>
        </Panel>
      </div>
      <Panel clase="oscuro" titulo="TELEGRAM · TODAS LAS ENTRADAS" der={<span class={`vivo${bot.enLinea ? "" : " off"}`}>● {bot.enLinea ? "LIVE" : "OFF"}</span>}>
        <div data-refrescar="/api/feed?n=40" data-cada="20"><FeedTelegram eventos={eventos} /></div>
      </Panel>
    </div>
  ));
}

export function rutasTelegram(app: App, d: Deps): void {
  app.get("/telegram", (c) => vista(c, d));
}
