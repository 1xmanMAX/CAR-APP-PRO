import { createSocket, type Socket as SocketUdp } from "node:dgram";
import { createServer, connect, type Server, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import type { Contexto } from "../infra/contexto";
import { claveGrupo, codigoDispositivo, etiquetaGrupo, identidad } from "./grupo";
import { responder, sincronizarCon, type Avance, type ResultadoSinc } from "./protocolo";

/**
 * **La red local** (la parte de PixPin `sincro/Red.kt` + `Presencia.kt`, sin Android).
 *
 * - Cada dispositivo escucha en TCP (puerto 47474, o el que quede libre) y atiende una
 *   sincronización a la vez.
 * - Para encontrarse sin teclear IPs, cada dispositivo en un grupo avisa por **difusión UDP** en el
 *   puerto 47475 cada pocos segundos: «soy Celular de Juan, K7Q2, escucho en 47474, mi grupo es
 *   <etiqueta>». La etiqueta sale de la clave del grupo y no deja sacar el código. Los que tienen la
 *   misma etiqueta se listan como «dispositivos cerca».
 * - Nada sale a internet: todo va dentro del Wi-Fi (o del punto de acceso del celular).
 */
export const PUERTO_SINC = 47474;
export const PUERTO_AVISOS = 47475;
const CADA_MS = 3000;
const CADUCA_MS = 12_000;

export interface Vecino {
  id: string;
  nombre: string;
  codigo: string;
  direccion: string;
  puerto: number;
  visto: number;
}

export interface EstadoSinc {
  enCurso: boolean;
  con: string | null;
  mensaje: string;
  fraccion: number;
  ultimo: { ok: boolean; texto: string; resultado?: ResultadoSinc; en: number } | null;
}

/** Las IPv4 de este equipo en la red local (para enseñarlas y para calcular las difusiones). */
export function direccionesLocales(): Array<{ ip: string; difusion: string; nombre: string }> {
  const out: Array<{ ip: string; difusion: string; nombre: string }> = [];
  for (const [nombre, lista] of Object.entries(networkInterfaces())) {
    for (const n of lista ?? []) {
      if (n.family !== "IPv4" || n.internal) continue;
      const ip = n.address.split(".").map(Number);
      const mascara = n.netmask.split(".").map(Number);
      const difusion = ip.map((b, i) => (b | (~mascara[i]! & 255)) & 255).join(".");
      out.push({ ip: n.address, difusion, nombre });
    }
  }
  return out;
}

export class RedSinc {
  private servidor: Server | null = null;
  private udp: SocketUdp | null = null;
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private vecinos = new Map<string, Vecino>();
  puerto = 0;
  estado: EstadoSinc = { enCurso: false, con: null, mensaje: "", fraccion: 0, ultimo: null };
  /** Se llama cuando otro dispositivo terminó de sincronizar con este (para refrescar pantallas). */
  alRecibir: ((r: { par: string; avisos: string[] }) => void) | null = null;

  constructor(private readonly ctx: Contexto, private readonly log: (m: string, e?: unknown) => void = () => {}) {}

  async iniciar(puertoPreferido = PUERTO_SINC): Promise<void> {
    if (this.servidor) return;
    this.servidor = createServer((s) => this.atender(s));
    this.puerto = await new Promise<number>((resolve) => {
      const probar = (p: number) => {
        this.servidor!.once("error", () => (p === 0 ? resolve(0) : probar(0)));
        this.servidor!.listen(p, "0.0.0.0", () => resolve((this.servidor!.address() as { port: number }).port));
      };
      probar(puertoPreferido);
    });
    this.iniciarAvisos();
  }

  private atender(s: Socket): void {
    s.setNoDelay(true);
    s.setTimeout(30 * 60_000, () => s.destroy());
    const direccion = s.remoteAddress?.replace(/^::ffff:/, "");
    this.estado = { ...this.estado, enCurso: true, con: direccion ?? null, mensaje: "Otro dispositivo está sincronizando con este…", fraccion: 0.5 };
    responder(this.ctx, s, {
      puerto: this.puerto, direccion,
      alTerminar: (r) => {
        this.estado = { enCurso: false, con: null, mensaje: "", fraccion: 1, ultimo: { ok: true, texto: `${r.par} sincronizó con este dispositivo`, en: Date.now() } };
        this.alRecibir?.(r);
      },
    }).catch((e: Error) => {
      if (this.estado.enCurso && !this.estado.ultimo) this.estado = { ...this.estado, enCurso: false };
      this.estado = { ...this.estado, enCurso: false };
      this.log("sincronización recibida con error", e);
      s.destroy();
    });
  }

  private iniciarAvisos(): void {
    try {
      const udp = createSocket({ type: "udp4", reuseAddr: true });
      udp.on("error", (e) => this.log("avisos UDP", e));
      udp.on("message", (msg, rinfo) => void this.oir(msg, rinfo.address));
      udp.bind(PUERTO_AVISOS, () => {
        try { udp.setBroadcast(true); } catch { /* sin difusión: solo con la IP a mano */ }
      });
      this.udp = udp;
      this.temporizador = setInterval(() => void this.avisar(), CADA_MS);
      void this.avisar();
    } catch (e) {
      this.log("no se pudo abrir el puerto de avisos", e);
    }
  }

  private async avisar(): Promise<void> {
    const i = await identidad(this.ctx).catch(() => null);
    if (!i?.grupo || !this.udp || !this.puerto) return;
    const msg = Buffer.from(JSON.stringify({
      cf: 1, id: i.yo.id, n: i.yo.nombre, c: codigoDispositivo(i.yo.id), e: etiquetaGrupo(claveGrupo(i.grupo)), p: this.puerto,
    }));
    const destinos = new Set(["255.255.255.255", ...direccionesLocales().map((d) => d.difusion)]);
    for (const d of destinos) this.udp.send(msg, PUERTO_AVISOS, d, () => {});
  }

  private etiquetaCache: { grupo: string; e: string } | null = null;

  private async oir(msg: Buffer, direccion: string): Promise<void> {
    let a: { cf?: number; id?: string; n?: string; c?: string; e?: string; p?: number };
    try { a = JSON.parse(msg.toString("utf8")); } catch { return; }
    if (a.cf !== 1 || !a.id || !a.e || !a.p) return;
    const i = await identidad(this.ctx);
    if (!i.grupo || a.id === i.yo.id) return;
    if (this.etiquetaCache?.grupo !== i.grupo) this.etiquetaCache = { grupo: i.grupo, e: etiquetaGrupo(claveGrupo(i.grupo)) };
    if (a.e !== this.etiquetaCache.e) return;
    this.vecinos.set(a.id, { id: a.id, nombre: a.n ?? "Dispositivo", codigo: a.c ?? "", direccion, puerto: a.p, visto: Date.now() });
  }

  /** Los del mismo grupo que se oyeron hace poco. */
  cerca(): Vecino[] {
    const ahora = Date.now();
    for (const [k, v] of this.vecinos) if (ahora - v.visto > CADUCA_MS) this.vecinos.delete(k);
    return [...this.vecinos.values()].sort((x, y) => x.nombre.localeCompare(y.nombre));
  }

  /**
   * Sincroniza con [destino] (`192.168.1.20` o `192.168.1.20:47474`). Corre en segundo plano y deja
   * el avance en [estado] para que la pantalla lo muestre.
   */
  sincronizar(destino: string): Promise<ResultadoSinc> {
    if (this.estado.enCurso) return Promise.reject(new Error("Ya hay una sincronización en curso"));
    const [host, p] = destino.trim().replace(/^https?:\/\//, "").split(":");
    const puerto = Number(p) || PUERTO_SINC;
    const avance: Avance = (mensaje, fraccion) => (this.estado = { ...this.estado, mensaje, fraccion: fraccion ?? this.estado.fraccion });
    this.estado = { enCurso: true, con: destino, mensaje: "Conectando…", fraccion: 0, ultimo: this.estado.ultimo };
    return new Promise<ResultadoSinc>((resolve, reject) => {
      const s = connect({ host: host!, port: puerto });
      s.setNoDelay(true);
      s.setTimeout(15_000, () => s.destroy(new Error(`No responde ${host}:${puerto}. ¿Está abierta la app en el otro dispositivo y en el mismo Wi-Fi?`)));
      s.once("error", (e: NodeJS.ErrnoException) => {
        const texto = e.code === "ECONNREFUSED" ? `${host} no acepta la conexión: abre Control Flota en el otro dispositivo` : e.message;
        this.estado = { enCurso: false, con: null, mensaje: "", fraccion: 0, ultimo: { ok: false, texto, en: Date.now() } };
        reject(new Error(texto));
      });
      s.once("connect", () => {
        s.setTimeout(30 * 60_000);
        sincronizarCon(this.ctx, s, { avance, puerto: this.puerto, direccion: host })
          .then((r) => {
            this.estado = { enCurso: false, con: null, mensaje: "", fraccion: 1, ultimo: { ok: true, texto: `Sincronizado con ${r.par.nombre}`, resultado: r, en: Date.now() } };
            resolve(r);
          })
          .catch((e: Error) => {
            const texto = /cortó la conexión|ECONNRESET|socket hang up/i.test(e.message)
              ? "El otro dispositivo cortó la conexión: revisa que los dos tengan el mismo código de grupo"
              : e.message;
            this.estado = { enCurso: false, con: null, mensaje: "", fraccion: 0, ultimo: { ok: false, texto, en: Date.now() } };
            reject(new Error(texto));
          })
          .finally(() => s.destroy());
      });
    });
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
    try { this.udp?.close(); } catch { /* ya cerrado */ }
    this.udp = null;
    this.servidor?.close();
    this.servidor = null;
  }
}
