// Cotizador de flete en vivo (misma fórmula que core/rentabilidad: handoff §6).
const datos = JSON.parse(document.getElementById("datos-coti").textContent);
const form = document.getElementById("form-coti");
const $ = (id) => document.getElementById(id);
const num = (el) => {
  const n = Number(String(el.value).replace(/,/g, "."));
  return Number.isFinite(n) ? n : 0;
};
const soles = (n) => "S/ " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function cotizar(e) {
  const margen = Math.min(90, Math.max(0, e.margenPct));
  const combustible = e.rendimiento > 0 ? (e.km / e.rendimiento) * e.precioGal : 0;
  const desgaste = e.km * e.desgaste;
  const costo = combustible + e.peajes + e.viaticos + desgaste;
  const flete = costo / (1 - margen / 100);
  return { combustible, peajes: e.peajes, viaticos: e.viaticos, desgaste, costo, flete, margen, porTon: e.toneladas > 0 ? flete / e.toneladas : null, porKm: e.km > 0 ? flete / e.km : null, ganancia: flete - costo };
}

function pintar() {
  const r = cotizar({
    km: num($("c-km")), toneladas: num($("c-ton")), precioGal: num($("c-precio")), rendimiento: num($("c-rend")),
    peajes: num($("c-peajes")), viaticos: num($("c-viaticos")), desgaste: num($("c-desgaste")), margenPct: num($("c-margen")),
  });
  const poner = (k, v) => { for (const el of form.querySelectorAll(`[data-k="${k}"]`)) el.textContent = v; };
  for (const k of ["combustible", "peajes", "viaticos", "desgaste", "costo", "flete", "ganancia"]) poner(k, soles(r[k]));
  poner("margen", String(r.margen));
  poner("porTon", r.porTon === null ? "—" : soles(r.porTon));
  poner("porKm", r.porKm === null ? "—" : soles(r.porKm));
}

if (form) {
  $("c-unidad").addEventListener("change", () => {
    const u = datos.unidades.find((x) => String(x.id) === $("c-unidad").value);
    $("c-rend").value = u && u.rendimiento ? u.rendimiento : datos.params.rendimientoKmGal;
    pintar();
  });
  form.addEventListener("input", pintar);
  pintar();
}
