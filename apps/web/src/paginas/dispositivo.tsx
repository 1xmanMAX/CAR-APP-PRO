/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { ErrorNegocio } from "@sunatapp/core";
import { accion, formularioMultiparte, pagina, type App, type C, type Deps, type EstadoServicios } from "../base";
import { Panel, Vacio } from "../ui";

/**
 * **Ajustes → Este dispositivo**: lo que en la PC se escribía a mano en `.env` (bot de Telegram y
 * SUNAT), ahora desde la app, igual en la PC y en el celular. Se guarda en el `.env` de este
 * dispositivo (no se sincroniza: el token del bot va en uno solo) y se aplica al momento.
 */
const OBLIGATORIOS_REAL = ["SUNAT_CERT_PATH", "SUNAT_CERT_PASSWORD", "SUNAT_SOL_USUARIO", "SUNAT_SOL_CLAVE", "SUNAT_GRE_CLIENT_ID", "SUNAT_GRE_CLIENT_SECRET"] as const;
const NOMBRE: Record<(typeof OBLIGATORIOS_REAL)[number], string> = {
  SUNAT_CERT_PATH: "el certificado digital (.pfx)", SUNAT_CERT_PASSWORD: "la clave del certificado", SUNAT_SOL_USUARIO: "el usuario SOL",
  SUNAT_SOL_CLAVE: "la clave SOL", SUNAT_GRE_CLIENT_ID: "el client_id de la GRE", SUNAT_GRE_CLIENT_SECRET: "el client_secret de la GRE",
};

/** «••••1234»: se ve que hay algo guardado sin mostrarlo. */
function oculto(v: string | undefined): string {
  return v ? `guardado ••••${v.slice(-4)}` : "sin guardar";
}

function EstadoBot(p: { e: EstadoServicios["bot"] }) {
  const { e } = p;
  const texto = {
    sin_token: "APAGADO · sin token",
    conectando: "CONECTANDO…",
    en_linea: `EN LÍNEA${e.usuario ? ` · @${e.usuario}` : ""}`,
    error: "NO CONECTA",
    esperando_datos: "ESPERANDO LA CONFIGURACIÓN INICIAL",
  }[e.estado];
  const clase = e.estado === "en_linea" ? "ok" : e.estado === "error" ? "cambiar" : "neutro";
  return (
    <div class="filas" style="gap:4px">
      <span><span class={`chip ${clase}`}>{texto}</span></span>
      {e.mensaje ? <span class="muted" style="font-size:12px">{e.mensaje}</span> : null}
    </div>
  );
}

async function vista(c: C, d: Deps) {
  const s = d.servicios;
  if (!s) {
    return pagina(c, d, { titulo: "Este dispositivo", seccion: "ajustes" }, (
      <Panel titulo="ESTE DISPOSITIVO"><Vacio>Esta forma de arranque solo tiene la web. Abre Control Flota con INICIAR.bat (PC) o la app de Android.</Vacio></Panel>
    ));
  }
  const e = s.estado();
  const a = s.ajustes();
  const modo = a.SUNAT_MODO || "simulado";
  return pagina(c, d, { titulo: "Este dispositivo", seccion: "ajustes" }, (
    <>
      <section class="panel oscuro" style="gap:6px">
        <b class="mono-t" style="font-size:16px;color:var(--accent-on-dark)">AJUSTES DE ESTE DISPOSITIVO · {e.plataforma === "android" ? "CELULAR" : "PC"}</b>
        <span style="font-size:12px">Son solo de este equipo y no se sincronizan (así el token del bot y las claves SUNAT viven en uno solo). Al guardar se aplican al momento, sin cerrar la app.
          Se guardan en <code>{e.archivoAjustes}</code>.</span>
      </section>
      <form method="post" action="/ajustes/dispositivo" enctype="multipart/form-data">
        <div class="grid g-lado">
          <Panel titulo="BOT DE TELEGRAM">
            <EstadoBot e={e.bot} />
            {e.codigoRegistro && e.bot.estado === "en_linea" ? (
              <div class="aviso info">Para registrarte como dueño en el bot, envíale este código desde tu Telegram: <b class="mono-t" style="font-size:18px">{e.codigoRegistro}</b></div>
            ) : null}
            <label class="campo"><span>Token del bot ({oculto(a.TELEGRAM_BOT_TOKEN)}) · te lo da @BotFather</span>
              <input name="TELEGRAM_BOT_TOKEN" type="password" autocomplete="off" placeholder={a.TELEGRAM_BOT_TOKEN ? "déjalo vacío para no cambiarlo" : "123456789:AA…"} />
            </label>
            {a.TELEGRAM_BOT_TOKEN ? (
              <label class="campo" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" name="quitarToken" value="1" style="width:auto;min-height:0" /><span style="text-transform:none">Apagar el bot en este dispositivo (quitar el token)</span></label>
            ) : null}
            <div class="linea">
              <label class="campo" style="flex:1"><span>Hora del aviso diario</span><input name="BOT_HORA_AVISO" type="time" value={a.BOT_HORA_AVISO || "08:00"} /></label>
              <label class="campo" style="flex:1"><span>Lector de guías PDF</span>
                <select name="EXTRACTOR"><option value="reglas" selected={(a.EXTRACTOR || "reglas") === "reglas"}>Reglas (sin internet)</option><option value="ia" selected={a.EXTRACTOR === "ia"}>IA</option></select>
              </label>
            </div>
            <span class="muted" style="font-size:11px">Pon el token en <b>un solo dispositivo</b>, el que pase más tiempo encendido y con internet: Telegram no deja conectar el mismo bot en dos a la vez.
              Sin bot, los avisos para Telegram esperan en cola en este dispositivo.</span>
          </Panel>

          <Panel titulo="SUNAT">
            <div class="filas" style="gap:4px">
              <span><span class={`chip ${e.sunat.modo === "real" ? "ok" : "neutro"}`}>MODO {e.sunat.modo.toUpperCase()}</span></span>
              {e.sunat.error ? <div class="aviso error">{e.sunat.error}</div> : null}
            </div>
            <label class="campo"><span>Modo</span>
              <select name="SUNAT_MODO">
                <option value="simulado" selected={modo === "simulado"}>Simulado (sin validez, para practicar)</option>
                <option value="beta" selected={modo === "beta"}>Beta (facturas al ambiente de pruebas de SUNAT)</option>
                <option value="real" selected={modo === "real"}>Real (con tu certificado y clave SOL)</option>
              </select>
            </label>
            <label class="campo"><span>Facturas en modo real</span>
              <select name="SUNAT_AMBIENTE_FACTURA">
                <option value="" selected={!a.SUNAT_AMBIENTE_FACTURA}>Producción</option>
                <option value="beta" selected={a.SUNAT_AMBIENTE_FACTURA === "beta"}>Beta (pruebas)</option>
              </select>
            </label>
            <div class="linea">
              <label class="campo" style="flex:1"><span>Usuario SOL</span><input name="SUNAT_SOL_USUARIO" value={a.SUNAT_SOL_USUARIO ?? ""} autocomplete="off" /></label>
              <label class="campo" style="flex:1"><span>Clave SOL ({oculto(a.SUNAT_SOL_CLAVE)})</span><input name="SUNAT_SOL_CLAVE" type="password" autocomplete="off" /></label>
            </div>
            <div class="linea">
              <label class="campo" style="flex:1"><span>GRE client_id</span><input name="SUNAT_GRE_CLIENT_ID" value={a.SUNAT_GRE_CLIENT_ID ?? ""} autocomplete="off" /></label>
              <label class="campo" style="flex:1"><span>GRE client_secret ({oculto(a.SUNAT_GRE_CLIENT_SECRET)})</span><input name="SUNAT_GRE_CLIENT_SECRET" type="password" autocomplete="off" /></label>
            </div>
            <label class="campo"><span>Certificado digital .pfx ({a.SUNAT_CERT_PATH ? "cargado" : "sin cargar"})</span><input name="certificado" type="file" accept=".pfx,.p12,application/x-pkcs12" /></label>
            <label class="campo"><span>Clave del certificado ({oculto(a.SUNAT_CERT_PASSWORD)})</span><input name="SUNAT_CERT_PASSWORD" type="password" autocomplete="off" /></label>
            <span class="muted" style="font-size:11px">Las claves vacías no se cambian. Emite los documentos reales desde un solo dispositivo para que la numeración no se cruce.</span>
          </Panel>
        </div>
        <button class="btn primario" type="submit" style="margin-top:10px">GUARDAR Y APLICAR</button>
      </form>
    </>
  ));
}

export function rutasDispositivo(app: App, d: Deps): void {
  app.get("/ajustes/dispositivo", (c) => vista(c, d));
  app.post("/ajustes/dispositivo", async (c) => {
    const { campos: f, archivos } = await formularioMultiparte(c);
    return accion(c, "/ajustes/dispositivo", async () => {
      const s = d.servicios;
      if (!s) throw new ErrorNegocio("Este arranque no tiene ajustes de dispositivo");
      if (c.get("usuario").rol !== "dueno") throw new ErrorNegocio("Solo el dueño cambia los ajustes del dispositivo");
      const actual = s.ajustes();
      const cambios: Record<string, string | null> = {};
      // Claves: vacío = no cambiar.
      for (const k of ["TELEGRAM_BOT_TOKEN", "SUNAT_SOL_CLAVE", "SUNAT_GRE_CLIENT_SECRET", "SUNAT_CERT_PASSWORD"]) if (f[k]) cambios[k] = f[k]!;
      if (f.quitarToken === "1") cambios.TELEGRAM_BOT_TOKEN = null;
      if (cambios.TELEGRAM_BOT_TOKEN && !/^\d+:[\w-]{20,}$/.test(cambios.TELEGRAM_BOT_TOKEN)) throw new ErrorNegocio("El token no tiene la forma que da @BotFather (números:letras)");
      if (f.BOT_HORA_AVISO && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.BOT_HORA_AVISO)) throw new ErrorNegocio("La hora del aviso debe ser HH:MM");
      for (const k of ["BOT_HORA_AVISO", "EXTRACTOR", "SUNAT_MODO", "SUNAT_AMBIENTE_FACTURA", "SUNAT_SOL_USUARIO", "SUNAT_GRE_CLIENT_ID"]) if (k in f) cambios[k] = f[k] || null;
      if (!["simulado", "beta", "real"].includes(f.SUNAT_MODO ?? "simulado")) throw new ErrorNegocio("Modo SUNAT no válido");
      const cert = archivos.certificado ? Buffer.from(await archivos.certificado.arrayBuffer()) : undefined;
      if (f.SUNAT_MODO === "real") {
        const final: Record<string, string | null | undefined> = { ...actual, ...cambios, ...(cert ? { SUNAT_CERT_PATH: "nuevo" } : {}) };
        const faltan = OBLIGATORIOS_REAL.filter((k) => !final[k]);
        if (faltan.length) throw new ErrorNegocio(`Para el modo real falta ${faltan.map((k) => NOMBRE[k]).join(", ")}`);
      }
      await s.guardarAjustes(cambios, cert);
      const e = s.estado();
      if (e.sunat.error) throw new ErrorNegocio(`Guardado, pero ${e.sunat.error}`);
      return "Ajustes guardados y aplicados";
    });
  });
}
