import { afterEach, describe, expect, it } from "vitest";
import { ErrorNegocio, ErrorValidacion } from "../src/errores";
import { cargarGuiaCompleta } from "../src/guias/cargar";
import {
  aplicarLugar,
  aplicarRespuesta,
  borradorDesdeExtraccion,
  borradorDesdeGuia,
  entradaDesdeBorrador,
  type Borrador,
  type GuiaExtraidaMinima,
} from "../src/guias/desde-extraccion";
import { emitirGuia } from "../src/guias/emitir";
import { actualizarGuiaBorrador, registrarGuiaBorrador } from "../src/guias/registrar";
import type { TransporteGuia } from "../src/transporte/transporte";
import { crearContextoPrueba, entradaGuia } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function contexto() {
  const r = await crearContextoPrueba();
  cerrables.push(r.cerrar);
  return r.ctx;
}

const seguro = <T>(valor: T) => ({ valor, confianza: "segura" as const });

function extraccion(cambios: Partial<GuiaExtraidaMinima> = {}): GuiaExtraidaMinima {
  return {
    serieNumero: seguro("EG07-5531"),
    remitente: seguro({ numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA SAC" }),
    destinatario: seguro({ numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO SAC" }),
    partida: seguro({ direccion: "AV. 28 DE JULIO 1275", ubigeo: "150115" }),
    llegada: seguro({ direccion: "CARRETERA FEDERICO BASADRE KM 86", ubigeo: "250101" }),
    fechaTraslado: seguro("2026-09-14"),
    pesoBruto: seguro("1500.5"),
    unidadPeso: seguro("KGM" as const),
    items: seguro([{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }]),
    ...cambios,
  };
}

const transporte: TransporteGuia = {
  rucTransportista: "20606433094",
  placaPrincipal: "ABC-123",
  placasSecundarias: [],
  conductor: { numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" },
};

describe("borradorDesdeExtraccion", () => {
  it("no pregunta nada cuando toda la lectura es segura", () => {
    const b = borradorDesdeExtraccion(extraccion());
    expect(b.faltantes).toEqual([]);
    expect(b.greRemitenteRef).toBe("EG07-5531");
    expect(b.fechaTraslado).toBe("2026-09-14");
    expect(b.partida).toEqual({ direccion: "AV. 28 DE JULIO 1275", ubigeo: "150115" });
    expect(b.items).toEqual([{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }]);
  });

  it("pregunta lo dudoso y lo que no se leyó, en el orden de los campos", () => {
    const b = borradorDesdeExtraccion(
      extraccion({
        fechaTraslado: { valor: "2026-09-14", confianza: "dudosa" },
        pesoBruto: { valor: null, confianza: "dudosa" },
      }),
    );
    expect(b.faltantes).toEqual(["fechaTraslado", "pesoBruto"]);
    expect(b.fechaTraslado).toBeNull();
    expect(b.pesoBruto).toBeNull();
  });

  it("pregunta un lugar cuyo ubigeo no existe aunque venga como seguro", () => {
    const b = borradorDesdeExtraccion(extraccion({ partida: seguro({ direccion: "AV. X 1", ubigeo: "999999" }) }));
    expect(b.faltantes).toContain("partida");
    expect(b.partida).toBeNull();
  });
});

describe("aplicarRespuesta", () => {
  const conFaltante = (campo: Parameters<typeof aplicarRespuesta>[1]): Borrador => {
    const b = borradorDesdeExtraccion(extraccion());
    return { ...b, faltantes: [campo] };
  };

  it("acepta la fecha en dd/mm/aaaa y la guarda como AAAA-MM-DD", () => {
    const r = aplicarRespuesta(conFaltante("fechaTraslado"), "fechaTraslado", "14/09/2026");
    expect(r.error).toBeUndefined();
    expect(r.borrador.fechaTraslado).toBe("2026-09-14");
    expect(r.borrador.faltantes).toEqual([]);
  });

  it("acepta el peso con coma y lo normaliza con punto", () => {
    const r = aplicarRespuesta(conFaltante("pesoBruto"), "pesoBruto", "31,87");
    expect(r.error).toBeUndefined();
    expect(r.borrador.pesoBruto).toBe("31.87");
  });

  it("rechaza un peso que no es número y deja el campo pendiente", () => {
    const b = conFaltante("pesoBruto");
    const r = aplicarRespuesta(b, "pesoBruto", "ABC");
    expect(r.error).toBe("Escribe el peso así: 31.87");
    expect(r.borrador.faltantes).toEqual(["pesoBruto"]);
  });

  it("rechaza una fecha que no entiende", () => {
    const r = aplicarRespuesta(conFaltante("fechaTraslado"), "fechaTraslado", "mañana");
    expect(r.error).toBe("Escribe la fecha así: 14/09/2026");
  });

  it("rechaza un RUC con dígito verificador inválido", () => {
    const r = aplicarRespuesta(conFaltante("remitente"), "remitente", "20131312956 X");
    expect(r.error).toBe("Escribe el RUC y la razón social así: 20131312955 DISTRIBUIDORA SAC");
  });

  it("acepta RUC y razón social juntos", () => {
    const r = aplicarRespuesta(conFaltante("destinatario"), "destinatario", "20602712592 CHOCANO CARGO SAC");
    expect(r.error).toBeUndefined();
    expect(r.borrador.destinatario).toEqual({ numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO SAC" });
  });

  it("lee un bien con descripción, cantidad y unidad", () => {
    const r = aplicarRespuesta(conFaltante("items"), "items", "CEMENTO 750 BLS");
    expect(r.error).toBeUndefined();
    expect(r.borrador.items).toEqual([{ descripcion: "CEMENTO", cantidad: "750", unidadMedida: "BLS" }]);
  });

  it("traduce UND a NIU y rechaza una unidad desconocida", () => {
    expect(aplicarRespuesta(conFaltante("items"), "items", "LADRILLOS 90 UND").borrador.items).toEqual([
      { descripcion: "LADRILLOS", cantidad: "90", unidadMedida: "NIU" },
    ]);
    expect(aplicarRespuesta(conFaltante("items"), "items", "LADRILLOS 90 PALOS").error).toBe(
      "Escribe el bien así: CEMENTO 750 BLS",
    );
  });

  it("acepta la serie del remitente en mayúsculas y rechaza otra forma", () => {
    const r = aplicarRespuesta(conFaltante("serieNumero"), "serieNumero", "eg07-5531");
    expect(r.borrador.greRemitenteRef).toBe("EG07-5531");
    expect(aplicarRespuesta(conFaltante("serieNumero"), "serieNumero", "EG07 5531").error).toBe(
      "Escríbela así: EG07-5531",
    );
  });

  it("acepta la unidad de peso que mandan los botones", () => {
    expect(aplicarRespuesta(conFaltante("unidadPeso"), "unidadPeso", "TNE").borrador.unidadPeso).toBe("TNE");
  });
});

describe("aplicarLugar", () => {
  it("guarda dirección y ubigeo y saca el campo de faltantes", () => {
    const base = borradorDesdeExtraccion(extraccion({ llegada: { valor: null, confianza: "dudosa" } }));
    const b = aplicarLugar(base, "llegada", "JR. LIMA 100", "250101");
    expect(b.llegada).toEqual({ direccion: "JR. LIMA 100", ubigeo: "250101" });
    expect(b.faltantes).toEqual([]);
  });
});

describe("entradaDesdeBorrador", () => {
  it("arma la entrada completa cuando no falta nada", () => {
    const e = entradaDesdeBorrador(borradorDesdeExtraccion(extraccion()), transporte, 7);
    expect(e.documentoRecibidoId).toBe(7);
    expect(e.transporte).toEqual(transporte);
    expect(e.greRemitenteRef).toBe("EG07-5531");
  });

  it("no deja armar la entrada si todavía falta algún campo", () => {
    const b = borradorDesdeExtraccion(extraccion({ pesoBruto: { valor: null, confianza: "dudosa" } }));
    expect(() => entradaDesdeBorrador(b, transporte, 7)).toThrow(ErrorValidacion);
  });
});

describe("borradorDesdeGuia", () => {
  it("reconstruye el borrador de una guía ya registrada", async () => {
    const ctx = await contexto();
    const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
    const b = borradorDesdeGuia(await cargarGuiaCompleta(ctx.db, guiaId));
    expect(b.faltantes).toEqual([]);
    expect(b.remitente).toEqual({ numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA SAC" });
    expect(b.pesoBruto).toBe("1500.5");
    expect(b.items).toEqual([{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }]);
    expect(b.greRemitenteRef).toBe("EG01-123");
  });
});

describe("actualizarGuiaBorrador", () => {
  it("reemplaza datos e ítems de una guía en borrador", async () => {
    const ctx = await contexto();
    const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
    await actualizarGuiaBorrador(ctx, guiaId, { ...entradaGuia(), pesoBruto: "2000", items: [{ descripcion: "ARENA", cantidad: "3", unidadMedida: "TNE" }] });
    const d = await cargarGuiaCompleta(ctx.db, guiaId);
    expect(Number(d.guia.pesoBruto)).toBe(2000);
    expect(d.items.map((i) => i.descripcion)).toEqual(["ARENA"]);
  });

  it("no corrige una guía ya aceptada por SUNAT", async () => {
    const ctx = await contexto();
    const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
    expect((await emitirGuia(ctx, guiaId)).estado).toBe("aceptada");
    await expect(actualizarGuiaBorrador(ctx, guiaId, entradaGuia())).rejects.toThrow(
      new ErrorNegocio("Solo se pueden corregir guías en borrador o rechazadas"),
    );
  });
});
