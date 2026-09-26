import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import { hmac } from "./grupo";

/**
 * La tubería entre dos dispositivos: tramos cifrados con la clave del grupo (portado de PixPin,
 * `sincro/Canal.kt`).
 *
 * Al abrirse, cada lado manda 32 bytes al azar; de los dos y de la clave del grupo sale la clave de
 * esta conversación, distinta en cada una y en cada sentido. Cada tramo va con AES-256-GCM, que
 * además de cifrar firma: un dispositivo con otro código no descifra ni el primer tramo, y esa es la
 * prueba de que son del mismo grupo sin que el código viaje nunca.
 *
 * Tramo en el cable: largo (u32) + cifrado + etiqueta GCM (16). En claro: tipo (1 byte) + datos.
 */
export class CodigoDistinto extends Error {
  constructor() {
    super("El otro dispositivo tiene otro código de grupo");
    this.name = "CodigoDistinto";
  }
}

const MAGIA = Buffer.from("CFS1");
export const TOPE_DE_TRAMO = 64 * 1024 * 1024;
export const JSON_ = 1;
export const TROZO = 2;

/** Lee bytes exactos de un stream, con espera. */
class Lector {
  private buf: Buffer = Buffer.alloc(0);
  private esperando: (() => void) | null = null;
  private fin: Error | null = null;
  constructor(stream: Duplex) {
    stream.on("data", (d: Buffer) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
      this.esperando?.();
    });
    const cerrar = (e?: Error) => {
      this.fin ??= e ?? new Error("El otro dispositivo cortó la conexión");
      this.esperando?.();
    };
    stream.on("end", () => cerrar());
    stream.on("close", () => cerrar());
    stream.on("error", (e) => cerrar(e));
  }
  async leer(n: number): Promise<Buffer> {
    while (this.buf.length < n) {
      if (this.fin) throw this.fin;
      await new Promise<void>((r) => (this.esperando = r));
      this.esperando = null;
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return Buffer.from(out);
  }
}

export class Canal {
  private cuentaSalida = 0n;
  private cuentaEntrada = 0n;
  enviados = 0;
  recibidos = 0;

  private constructor(
    private readonly stream: Duplex,
    private readonly lector: Lector,
    private readonly claveSalida: Buffer,
    private readonly claveEntrada: Buffer,
  ) {}

  static async abrir(stream: Duplex, claveDelGrupo: Buffer, inicia: boolean): Promise<Canal> {
    const lector = new Lector(stream);
    const mio = randomBytes(32);
    stream.write(Buffer.concat([MAGIA, mio]));
    const magia = await lector.leer(4);
    if (!magia.equals(MAGIA)) throw new Error("El otro no es Control Flota");
    const suyo = await lector.leer(32);
    const [delQueInicia, delQueResponde] = inicia ? [mio, suyo] : [suyo, mio];
    const sesion = hmac(claveDelGrupo, "sesion", delQueInicia, delQueResponde);
    const ida = hmac(sesion, "ida");
    const vuelta = hmac(sesion, "vuelta");
    return inicia ? new Canal(stream, lector, ida, vuelta) : new Canal(stream, lector, vuelta, ida);
  }

  private iv(n: bigint): Buffer {
    const b = Buffer.alloc(12);
    b.writeBigUInt64BE(n, 4);
    return b;
  }

  enviar(tipo: number, datos: Buffer): void {
    const c = createCipheriv("aes-256-gcm", this.claveSalida, this.iv(this.cuentaSalida++));
    const cifrado = Buffer.concat([c.update(Buffer.from([tipo])), c.update(datos), c.final(), c.getAuthTag()]);
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(cifrado.length);
    this.stream.write(Buffer.concat([largo, cifrado]));
    this.enviados += datos.length;
  }

  async recibir(): Promise<{ tipo: number; datos: Buffer }> {
    const largo = (await this.lector.leer(4)).readUInt32BE();
    if (largo < 17 || largo > TOPE_DE_TRAMO) throw new Error(`Tramo de ${largo} bytes`);
    const cifrado = await this.lector.leer(largo);
    const d = createDecipheriv("aes-256-gcm", this.claveEntrada, this.iv(this.cuentaEntrada++));
    d.setAuthTag(cifrado.subarray(cifrado.length - 16));
    let claro: Buffer;
    try {
      claro = Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - 16)), d.final()]);
    } catch {
      throw new CodigoDistinto();
    }
    this.recibidos += claro.length - 1;
    return { tipo: claro[0]!, datos: claro.subarray(1) };
  }

  enviarJson(o: unknown): void {
    this.enviar(JSON_, Buffer.from(JSON.stringify(o)));
  }

  async recibirJson<T>(): Promise<T> {
    const { tipo, datos } = await this.recibir();
    if (tipo !== JSON_) throw new Error("Se esperaba un mensaje");
    return JSON.parse(datos.toString("utf8")) as T;
  }

  cerrar(): void {
    this.stream.end();
  }
}
