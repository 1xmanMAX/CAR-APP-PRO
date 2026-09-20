import { afterEach, describe, expect, it, vi } from "vitest";
import { emitirGuia, registrarGuiaBorrador, type Contexto, type ResultadoEmision } from "@sunatapp/core";
import { crearContextoPrueba, entradaGuia } from "../../../packages/core/test/helpers";
import { crearArnes } from "./arnes";
import { crearTareaFondo } from "../src/fondo";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

const RESPUESTA_ACEPTADA = { estado: "aceptada", codigo: "0", mensaje: "La Guía ha sido aceptada", notas: [], cdrZip: null };

/**
 * Gateway con el envío bajo control de la prueba: primero falla (deja la guía "pendiente_envio")
 * y después se queda colgado hasta que la prueba lo suelta, para poder solapar dos pasadas.
 */
class GatewayControlado {
  envios = 0;
  fallar = true;
  private soltarEnvio: ((v: { ticket: string }) => void) | null = null;
  private avisarEntrada!: () => void;
  /** Se resuelve cuando el envío colgado ya está en curso. */
  entrada = new Promise<void>((r) => {
    this.avisarEntrada = r;
  });

  async enviarGuia(): Promise<{ ticket: string }> {
    this.envios += 1;
    if (this.fallar) throw new Error("red caída");
    return new Promise((resolver) => {
      this.soltarEnvio = resolver;
      this.avisarEntrada();
    });
  }

  soltar(): void {
    this.soltarEnvio!({ ticket: "TICKET-1" });
  }

  async consultarTicket(): Promise<unknown> {
    return RESPUESTA_ACEPTADA;
  }

  async enviarFactura(): Promise<unknown> {
    return RESPUESTA_ACEPTADA;
  }
}

/** Una guía que quedó en "pendiente_envio" y ya cumplió su espera de reintento. */
async function guiaPendiente(ctx: Contexto, avanzar: (ms: number) => void): Promise<number> {
  const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
  const r = await emitirGuia(ctx, guiaId);
  expect(r.estado).toBe("pendiente_envio");
  avanzar(10 * 60_000);
  return guiaId;
}

async function preparar(gateway: GatewayControlado) {
  let ahora = new Date("2026-09-13T15:00:00Z");
  const { ctx, cerrar } = await crearContextoPrueba({ gateway: gateway as never, reloj: () => ahora });
  cerrables.push(cerrar);
  const avanzar = (ms: number): void => {
    ahora = new Date(ahora.getTime() + ms);
  };
  const a = await crearArnes({ ctx });
  cerrables.push(a.cerrar);
  const notificaciones: Array<{ tipo: string; r: ResultadoEmision }> = [];
  const errores: string[] = [];
  const deps = { ...a.deps, log: { info() {}, error: (m: string) => errores.push(m) } };
  const tarea = crearTareaFondo(deps, async (tipo, r) => {
    notificaciones.push({ tipo, r });
  });
  return { ctx, avanzar, tarea, notificaciones, errores };
}

describe("tarea de fondo", () => {
  it("no solapa dos pasadas: la segunda sale sin reenviar nada", async () => {
    const gateway = new GatewayControlado();
    const { ctx, avanzar, tarea, notificaciones } = await preparar(gateway);
    await guiaPendiente(ctx, avanzar);
    gateway.fallar = false;
    gateway.envios = 0;

    const primera = tarea.pasada();
    await gateway.entrada;
    await tarea.pasada(); // en curso: debe salir de inmediato sin tocar SUNAT
    expect(gateway.envios).toBe(1);

    gateway.soltar();
    await primera;

    expect(gateway.envios).toBe(1);
    expect(notificaciones).toHaveLength(1);
    expect(notificaciones[0]!.tipo).toBe("guia");
    expect(notificaciones[0]!.r.estado).toBe("aceptada");
    expect(notificaciones[0]!.r.serieNumero).toBe("V001-1");
  });

  it("deja pasar otra pasada una vez terminada la anterior", async () => {
    const gateway = new GatewayControlado();
    const { ctx, avanzar, tarea, notificaciones } = await preparar(gateway);
    await guiaPendiente(ctx, avanzar);
    gateway.fallar = false;
    const primera = tarea.pasada();
    await gateway.entrada;
    gateway.soltar();
    await primera;
    expect(notificaciones).toHaveLength(1);

    await tarea.pasada(); // ya no hay pendientes: no avisa nada nuevo
    expect(notificaciones).toHaveLength(1);
  });

  it("anota el error y no lo propaga si falla el aviso", async () => {
    const gateway = new GatewayControlado();
    let ahora = new Date("2026-09-13T15:00:00Z");
    const { ctx, cerrar } = await crearContextoPrueba({ gateway: gateway as never, reloj: () => ahora });
    cerrables.push(cerrar);
    const a = await crearArnes({ ctx });
    cerrables.push(a.cerrar);
    const errores: string[] = [];
    const deps = { ...a.deps, log: { info() {}, error: (m: string) => errores.push(m) } };
    const tarea = crearTareaFondo(deps, async () => {
      throw new Error("Telegram no responde");
    });
    await guiaPendiente(ctx, (ms) => {
      ahora = new Date(ahora.getTime() + ms);
    });
    gateway.fallar = false;
    const p = tarea.pasada();
    await gateway.entrada;
    gateway.soltar();
    await expect(p).resolves.toBeUndefined();
    expect(errores.join(" ")).toContain("aviso");
  });

  it("iniciar() repite la pasada y el cancelador la detiene", async () => {
    vi.useFakeTimers();
    try {
      const gateway = new GatewayControlado();
      const ahora = new Date("2026-09-13T15:00:00Z");
      const reloj = vi.fn(() => ahora);
      const { ctx, cerrar } = await crearContextoPrueba({ gateway: gateway as never, reloj });
      cerrables.push(cerrar);
      const a = await crearArnes({ ctx });
      cerrables.push(a.cerrar);
      const tarea = crearTareaFondo(a.deps, async () => {});

      reloj.mockClear();
      const detener = tarea.iniciar(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      const trasUnaPasada = reloj.mock.calls.length;
      expect(trasUnaPasada).toBeGreaterThan(0);

      detener();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(reloj.mock.calls.length).toBe(trasUnaPasada);
    } finally {
      vi.useRealTimers();
    }
  });
});
