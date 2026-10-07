/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { readFile } from "node:fs/promises";
import {
  activarFacturaAutomatica, contarDocumentosEnCurso, costoIaDelMes, ErrorNegocio, facturaAutomaticaActiva, FORMULA_VR_VERIFICADA, hoy, huellaPrueba, leerPausaSunat,
  probarConexionSunat, reanudarSunat, type DatosPrueba, type ResultadoPruebaSunat,
} from "@sunatapp/core";
import { accion, formularioMultiparte, pagina, type App, type C, type Deps, type EstadoServicios } from "../base";
import { Cabecera, Panel, Vacio } from "../ui";

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

/** Solo dice si hay algo guardado: de un secreto no se muestra ni un carácter. */
function oculto(v: string | undefined, guardado = "guardada"): string {
  return v ? guardado : "sin guardar";
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

/** Última prueba de conexión hecha en este proceso: el modo Real solo se guarda si se probó lo mismo. */
interface UltimaPrueba { huella: string; todoOk: boolean; en: number }

/** Junta lo que se va a probar: cada campo vacío usa el valor guardado; el certificado, el subido o el guardado. */
async function datosDePrueba(f: Record<string, string>, actual: Record<string, string>, subido: File | undefined): Promise<DatosPrueba> {
  let pfx: Buffer | null = null;
  if (subido) pfx = Buffer.from(await subido.arrayBuffer());
  else if (actual.SUNAT_CERT_PATH) pfx = await readFile(actual.SUNAT_CERT_PATH).catch(() => null);
  return {
    pfx, clavePfx: f.SUNAT_CERT_PASSWORD || actual.SUNAT_CERT_PASSWORD || "", usuarioSol: f.SUNAT_SOL_USUARIO || actual.SUNAT_SOL_USUARIO || "",
    claveSol: f.SUNAT_SOL_CLAVE || actual.SUNAT_SOL_CLAVE || "", greClientId: f.SUNAT_GRE_CLIENT_ID || actual.SUNAT_GRE_CLIENT_ID || "",
    greClientSecret: f.SUNAT_GRE_CLIENT_SECRET || actual.SUNAT_GRE_CLIENT_SECRET || "",
  };
}

async function vista(c: C, d: Deps, resultado?: ResultadoPruebaSunat, nota?: string) {
  const s = d.servicios;
  if (!s) {
    return pagina(c, d, { titulo: "Este dispositivo", seccion: "ajustes" }, (
      <><Cabecera titulo="Este dispositivo y SUNAT" volver="/ajustes" /><Panel titulo="ESTE DISPOSITIVO"><Vacio>Esta forma de arranque solo tiene la web. Abre Control Flota con INICIAR.bat (PC) o la app de Android.</Vacio></Panel></>
    ));
  }
  const e = s.estado();
  const a = s.ajustes();
  const ia = await costoIaDelMes(d.ctx, hoy(d.ctx).slice(0, 7));
  const modo = a.SUNAT_MODO || "simulado";
  const pausa = await leerPausaSunat(d.ctx);
  const facturaAuto = await facturaAutomaticaActiva(d.ctx);
  return pagina(c, d, { titulo: "Este dispositivo", seccion: "ajustes" }, (
    <>
      <Cabecera titulo="Este dispositivo y SUNAT" volver="/ajustes" sub={e.plataforma === "android" ? "Solo de este celular" : "Solo de esta PC"} />
      <p class="muted" style="font-size:12px;margin:0">Son solo de este equipo y no se sincronizan (así el token del bot y las claves SUNAT viven en uno solo). Al guardar se aplican al momento, sin cerrar la app.
        Se guardan en <code>{e.archivoAjustes}</code>.</p>
      <form method="post" action="/ajustes/dispositivo" enctype="multipart/form-data">
        <div class="grid g-lado" style="align-items:start">
          <div class="filas" style="gap:10px;min-width:0">
            <Panel titulo="SUNAT">
              {pausa ? (
                <div class="aviso error">⏸ SUNAT en pausa desde {pausa.desde.slice(0, 16).replace("T", " ")}: {pausa.motivo}. Corrige tus claves y guarda, o <button class="btn chico" type="submit" style="min-height:44px" formaction="/ajustes/dispositivo/reanudar">REINTENTAR AHORA</button></div>
              ) : null}
              {e.sunat.modo === "real" && !FORMULA_VR_VERIFICADA ? (
                <div class="aviso info">La fórmula del valor referencial MTC aún no está verificada contra la norma: revisa el monto de la detracción de tus primeras facturas.</div>
              ) : null}
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
                <label class="campo" style="flex:1"><span>GRE client_secret ({oculto(a.SUNAT_GRE_CLIENT_SECRET, "guardado")})</span><input name="SUNAT_GRE_CLIENT_SECRET" type="password" autocomplete="off" /></label>
              </div>
              <label class="campo"><span>Certificado digital .pfx ({a.SUNAT_CERT_PATH ? "cargado" : "sin cargar"})</span><input name="certificado" type="file" accept=".pfx,.p12,application/x-pkcs12" /></label>
              <label class="campo"><span>Clave del certificado ({oculto(a.SUNAT_CERT_PASSWORD)})</span><input name="SUNAT_CERT_PASSWORD" type="password" autocomplete="off" /></label>
              <label class="campo" style="flex-direction:row;gap:6px;align-items:center;min-height:44px"><input type="checkbox" name="facturaAutomatica" value="1" checked={facturaAuto} style="width:auto;min-height:0" /><span style="text-transform:none">Facturar solo al aceptarse la guía (si el viaje tiene flete pactado y una sola guía)</span></label>
              <button class="btn chico" type="submit" formaction="/ajustes/dispositivo/probar" style="min-height:44px">PROBAR CONEXIÓN</button>
              {resultado ? (
                <div class="filas" style="gap:4px">
                  {nota ? <span class="aviso error">{nota}</span> : null}
                  {([["Certificado", resultado.certificado], ["Usuario y clave SOL", resultado.claveSol], ["Credenciales de guías", resultado.credencialesGre]] as const).map(([n, p]) => (
                    <span class={`aviso ${p.ok ? "info" : "error"}`}>{p.ok ? "✅" : "❌"} <b>{n}:</b> {p.mensaje}</span>
                  ))}
                </div>
              ) : null}
              <span class="muted" style="font-size:12px">Las claves vacías no se cambian. Emite los documentos reales desde un solo dispositivo para que la numeración no se cruce.
                La placa, la configuración vehicular y la carga útil de cada camión van en <a href="/camiones">Camiones</a> › Datos.</span>
            </Panel>
            <Panel titulo="CÓMO CONSEGUIR TUS ACCESOS SUNAT (UNA SOLA VEZ)">
              <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.5">
                <li><b>Certificado digital gratis:</b> SOL → Empresas → Comprobantes de Pago → Certificado Digital Tributario → «Solicitar Certificado Digital Tributario». Te llega al Buzón SOL; al descargarlo creas su clave y obtienes <code>certificado.p12</code>.</li>
                <li><b>Emisor desde tu sistema:</b> en SOL, inscríbete en «SEE - Del Contribuyente» subiendo ese certificado y tu correo. Rige desde el día siguiente.</li>
                <li><b>Credenciales de guías:</b> SOL → Empresas → Credenciales de API SUNAT → Gestión de Credenciales → registra una aplicación tipo <b>Desktop</b> marcando «GRE Emisión de Comprobantes». Copia el ID (client_id) y la CLAVE (client_secret).</li>
                <li><b>Usuario SOL:</b> si SUNAT responde «el usuario debe ser secundario» (0112), crea un usuario secundario con perfil de emisión electrónica y úsalo aquí. Dale también el permiso de <b>consulta de comprobantes / CDR</b>: con él la app recupera el CDR de una factura que SUNAT ya tiene.</li>
                <li>Escribe tus datos y toca <b>PROBAR CONEXIÓN</b> (se guardan al probar, sin cambiar el modo; ya en modo Real, solo se guardan si sale todo ✅). Si sale todo ✅, cambia el modo a <b>Real</b> y guarda.</li>
              </ol>
              <span class="muted" style="font-size:12px">No hay ambiente de pruebas de SUNAT para guías: la primera guía en modo Real ya es real. Hasta el 28-02-2027 SUNAT no sanciona errores en guías de transportista.</span>
            </Panel>
          </div>
          <div class="filas" style="gap:10px;min-width:0">
            <Panel titulo="BOT DE TELEGRAM">
              <EstadoBot e={e.bot} />
              {e.codigoRegistro && e.bot.estado === "en_linea" ? (
                <div class="aviso info">Para registrarte como dueño en el bot, envíale este código desde tu Telegram: <b class="mono-t" style="font-size:18px">{e.codigoRegistro}</b></div>
              ) : null}
              <label class="campo"><span>Token del bot ({oculto(a.TELEGRAM_BOT_TOKEN, "guardado")}) · te lo da @BotFather</span>
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
              <span class="muted" style="font-size:12px">Pon el token en <b>un solo dispositivo</b>, el que pase más tiempo encendido y con internet: Telegram no deja conectar el mismo bot en dos a la vez.
                Sin bot, los avisos para Telegram esperan en cola en este dispositivo.</span>
            </Panel>
            <Panel titulo="LECTURA DE BOLETAS POR TELEGRAM">
              <div class="filas" style="gap:4px">
                <span>
                  <span class={`chip ${e.ia.lector === "deepseek" ? "ok" : "neutro"}`}>{e.ia.lector === "deepseek" ? "IA DEEPSEEK · LEE FOTOS" : "REGLAS · SOLO TEXTO"}</span>{" "}
                  <span class={`chip ${e.ia.voz ? "ok" : "neutro"}`}>{e.ia.voz ? "NOTAS DE VOZ ACTIVAS" : "SIN NOTAS DE VOZ"}</span>
                </span>
                {e.ia.error ? <div class="aviso error">{e.ia.error}</div> : null}
                <span class="muted" style="font-size:12px">Este mes: {ia.lecturas} lecturas · US$ {ia.usd.toFixed(3)}. Lo que quedó a medias está en <a href="/revisar">Por revisar</a>.</span>
              </div>
              <span class="muted" style="font-size:12px">El chofer manda la foto de la boleta, un texto («grifo 350») o una nota de voz, y el bot le pide confirmar antes de guardar el gasto.
                Sin clave de IA se entienden los textos y las fotos se completan con botones. Con DeepSeek también se leen las fotos (cuesta menos de un centavo de dólar por boleta).</span>
              <div class="linea">
                <label class="campo" style="flex:1"><span>Lector</span>
                  <select name="IA_PROVEEDOR">
                    <option value="reglas" selected={e.ia.lector === "reglas"}>Reglas (sin internet, gratis)</option>
                    <option value="deepseek" selected={e.ia.lector === "deepseek"}>DeepSeek (lee fotos)</option>
                  </select>
                </label>
                <label class="campo" style="flex:2"><span>Clave de DeepSeek ({oculto(a.DEEPSEEK_API_KEY)}) · platform.deepseek.com</span>
                  <input name="DEEPSEEK_API_KEY" type="password" autocomplete="off" placeholder={a.DEEPSEEK_API_KEY ? "déjalo vacío para no cambiarla" : "sk-…"} />
                </label>
              </div>
              {a.DEEPSEEK_API_KEY ? (
                <label class="campo" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" name="quitarClaveIa" value="1" style="width:auto;min-height:0" /><span style="text-transform:none">Quitar la clave de DeepSeek</span></label>
              ) : null}
              {e.plataforma === "pc" ? (
                <div class="linea">
                  <label class="campo" style="flex:1"><span>whisper.cpp (ruta del programa, opcional)</span><input name="WHISPER_BIN" value={a.WHISPER_BIN ?? ""} placeholder="C:\whisper\main.exe" autocomplete="off" /></label>
                  <label class="campo" style="flex:1"><span>Modelo de whisper (.bin)</span><input name="WHISPER_MODELO" value={a.WHISPER_MODELO ?? ""} placeholder="ggml-small.bin" autocomplete="off" /></label>
                </div>
              ) : null}
            </Panel>
          </div>
        </div>
        <button class="btn primario" type="submit" style="margin-top:10px">GUARDAR Y APLICAR</button>
      </form>
    </>
  ));
}

export function rutasDispositivo(app: App, d: Deps): void {
  let ultimaPrueba: UltimaPrueba | null = null;
  const VIGENCIA_PRUEBA_MS = 15 * 60 * 1000;
  // Cada prueba es un login en SUNAT: probar seguido con una clave mala puede bloquear el usuario SOL.
  const ESPERA_ENTRE_PRUEBAS_MS = 60 * 1000;
  let ultimoIntento = 0;
  app.get("/ajustes/dispositivo", (c) => vista(c, d));
  app.post("/ajustes/dispositivo/probar", async (c) => {
    const { campos: f, archivos } = await formularioMultiparte(c);
    const s = d.servicios;
    if (!s || c.get("usuario").rol !== "dueno") {
      return accion(c, "/ajustes/dispositivo", async () => { throw new ErrorNegocio("Solo el dueño puede probar la conexión con SUNAT"); });
    }
    if (Date.now() - ultimoIntento < ESPERA_ENTRE_PRUEBAS_MS) {
      return accion(c, "/ajustes/dispositivo", async () => {
        throw new ErrorNegocio("Espera un minuto antes de volver a probar: cada prueba entra a SUNAT con tu usuario SOL y muchos intentos seguidos lo pueden bloquear");
      });
    }
    ultimoIntento = Date.now();
    const cambios: Record<string, string | null> = {};
    for (const k of ["SUNAT_SOL_USUARIO", "SUNAT_SOL_CLAVE", "SUNAT_GRE_CLIENT_ID", "SUNAT_GRE_CLIENT_SECRET", "SUNAT_CERT_PASSWORD"]) if (f[k]) cambios[k] = f[k]!;
    const cert = archivos.certificado ? Buffer.from(await archivos.certificado.arrayBuffer()) : undefined;
    const hayCambios = !!cert || Object.keys(cambios).length > 0;
    const actual = s.ajustes();
    if (actual.SUNAT_MODO === "real") {
      // En modo Real lo guardado se usa al momento para enviar: se prueba lo escrito SIN guardarlo y
      // solo se guarda si sale todo ✅ (si no, el fondo seguiría entrando a SUNAT con datos malos).
      const r = await probarConexionSunat(d.ctx, await datosDePrueba(f, actual, archivos.certificado));
      ultimaPrueba = { huella: r.huella, todoOk: r.todoOk, en: Date.now() };
      if (r.todoOk && hayCambios) await s.guardarAjustes(cambios, cert);
      return vista(c, d, r, !r.todoOk && hayCambios ? "Como estás en modo Real, lo que escribiste no se guardó: corrígelo y vuelve a probar." : undefined);
    }
    // Fuera de Real se guarda lo escrito (vacío = no cambiar) pero NUNCA el modo: así lo probado es lo guardado.
    if (hayCambios) await s.guardarAjustes(cambios, cert);
    const datos = await datosDePrueba({}, s.ajustes(), undefined);
    const r = await probarConexionSunat(d.ctx, datos);
    ultimaPrueba = { huella: r.huella, todoOk: r.todoOk, en: Date.now() };
    return vista(c, d, r);
  });
  app.post("/ajustes/dispositivo/reanudar", async (c) => accion(c, "/ajustes/dispositivo", async () => {
    if (!d.servicios || c.get("usuario").rol !== "dueno") throw new ErrorNegocio("Solo el dueño puede reanudar SUNAT");
    // Si la configuración pedida (Real/Beta) no carga, la app está en simulado: reanudar mandaría los
    // pendientes al simulador. Se mira el modo que corre, no cualquier aviso: una pausa por claves con
    // el modo pedido andando sí se puede reanudar.
    const e = d.servicios.estado();
    const pedido = d.servicios.ajustes().SUNAT_MODO?.trim() || "simulado";
    if ((pedido === "real" || pedido === "beta") && e.sunat.modo !== pedido) {
      throw new ErrorNegocio(`Primero corrige los ajustes de SUNAT${e.sunat.error ? `: ${e.sunat.error}` : ""}`);
    }
    await reanudarSunat(d.ctx);
    return "SUNAT reanudada";
  }));
  app.post("/ajustes/dispositivo", async (c) => {
    const { campos: f, archivos } = await formularioMultiparte(c);
    return accion(c, "/ajustes/dispositivo", async () => {
      const s = d.servicios;
      if (!s) throw new ErrorNegocio("Este arranque no tiene ajustes de dispositivo");
      if (c.get("usuario").rol !== "dueno") throw new ErrorNegocio("Solo el dueño cambia los ajustes del dispositivo");
      const actual = s.ajustes();
      const cambios: Record<string, string | null> = {};
      // Claves: vacío = no cambiar.
      for (const k of ["TELEGRAM_BOT_TOKEN", "SUNAT_SOL_CLAVE", "SUNAT_GRE_CLIENT_SECRET", "SUNAT_CERT_PASSWORD", "DEEPSEEK_API_KEY"]) if (f[k]) cambios[k] = f[k]!;
      if (f.quitarToken === "1") cambios.TELEGRAM_BOT_TOKEN = null;
      if (f.quitarClaveIa === "1") cambios.DEEPSEEK_API_KEY = null;
      if (f.IA_PROVEEDOR && !["reglas", "deepseek"].includes(f.IA_PROVEEDOR)) throw new ErrorNegocio("Lector de boletas no válido");
      const claveIa = cambios.DEEPSEEK_API_KEY === undefined ? actual.DEEPSEEK_API_KEY : cambios.DEEPSEEK_API_KEY;
      if (f.IA_PROVEEDOR === "deepseek" && !claveIa) throw new ErrorNegocio("Para leer fotos con DeepSeek pega la clave (empieza con sk-)");
      if (cambios.TELEGRAM_BOT_TOKEN && !/^\d+:[\w-]{20,}$/.test(cambios.TELEGRAM_BOT_TOKEN)) throw new ErrorNegocio("El token no tiene la forma que da @BotFather (números:letras)");
      if (f.BOT_HORA_AVISO && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.BOT_HORA_AVISO)) throw new ErrorNegocio("La hora del aviso debe ser HH:MM");
      for (const k of ["BOT_HORA_AVISO", "EXTRACTOR", "SUNAT_MODO", "SUNAT_AMBIENTE_FACTURA", "SUNAT_SOL_USUARIO", "SUNAT_GRE_CLIENT_ID", "IA_PROVEEDOR", "WHISPER_BIN", "WHISPER_MODELO"]) if (k in f) cambios[k] = f[k] || null;
      if (!["simulado", "beta", "real"].includes(f.SUNAT_MODO ?? "simulado")) throw new ErrorNegocio("Modo SUNAT no válido");
      // Cambiar de modo con documentos en camino los mandaría a otro SUNAT (o al simulador).
      if ("SUNAT_MODO" in f && (f.SUNAT_MODO || "simulado") !== (actual.SUNAT_MODO || "simulado")) {
        const enCurso = await contarDocumentosEnCurso(d.ctx);
        if (enCurso > 0) throw new ErrorNegocio(`Primero termina de enviar los documentos pendientes (${enCurso})`);
      }
      const cert = archivos.certificado ? Buffer.from(await archivos.certificado.arrayBuffer()) : undefined;
      if (f.SUNAT_MODO === "real") {
        const final: Record<string, string | null | undefined> = { ...actual, ...cambios, ...(cert ? { SUNAT_CERT_PATH: "nuevo" } : {}) };
        const faltan = OBLIGATORIOS_REAL.filter((k) => !final[k]);
        if (faltan.length) throw new ErrorNegocio(`Para el modo real falta ${faltan.map((k) => NOMBRE[k]).join(", ")}`);
        // Si ya estaba en real y no cambió nada de SUNAT, se puede guardar sin volver a probar.
        const cambioSunat = !!cert || Object.keys(cambios).some((k) => k.startsWith("SUNAT_") && (cambios[k] ?? "") !== (actual[k] ?? ""));
        if (actual.SUNAT_MODO !== "real" || cambioSunat) {
          const datosFinales = await datosDePrueba(f, actual, archivos.certificado);
          if (!ultimaPrueba || !ultimaPrueba.todoOk || Date.now() - ultimaPrueba.en > VIGENCIA_PRUEBA_MS || ultimaPrueba.huella !== huellaPrueba(datosFinales)) {
            throw new ErrorNegocio("Escribe tus datos y toca PROBAR CONEXIÓN; si sale todo ✅, cambia el modo a Real y guarda (la prueba vale 15 minutos)");
          }
        }
      }
      await s.guardarAjustes(cambios, cert);
      await activarFacturaAutomatica(d.ctx, f.facturaAutomatica === "1");
      const e = s.estado();
      if (e.sunat.error) throw new ErrorNegocio(`Guardado, pero ${e.sunat.error}`);
      return "Ajustes guardados y aplicados";
    });
  });
}
