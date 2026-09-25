// Formulario de cambio: partes según la unidad, filas de repuestos y costo total en vivo.
const datos = JSON.parse(document.getElementById("datos-rep").textContent);
const form = document.getElementById("form-cambio");
if (form) {
  const selUnidad = document.getElementById("sel-unidad");
  const selParte = document.getElementById("sel-parte");
  const tbody = document.querySelector("#tabla-repuestos tbody");
  const odometro = document.getElementById("odometro");
  const mano = document.getElementById("mano-obra");
  const total = document.getElementById("costo-total");
  const soles = (c) => "S/ " + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const monto = (t) => {
    const n = Number(String(t || "").replace(/[^\d.,]/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };

  function recalcular() {
    let suma = 0;
    for (const fila of tbody.querySelectorAll(".fila-rep")) {
      const r = datos.repuestos.find((x) => String(x.id) === fila.querySelector(".sel-rep").value);
      const cant = Math.max(0, parseInt(fila.querySelector(".cant").value, 10) || 0);
      const sub = r ? r.costo * cant : 0;
      fila.querySelector(".subtotal").textContent = r ? soles(sub) : "—";
      suma += sub;
    }
    total.textContent = soles(suma + monto(mano.value));
  }

  function partes() {
    const id = Number(selUnidad.value);
    const actual = selParte.value;
    selParte.replaceChildren(new Option("— reparación general (sin parte) —", ""));
    for (const p of datos.partes.filter((x) => x.vehiculoId === id)) selParte.add(new Option(p.nombre, String(p.id), false, String(p.id) === actual));
    odometro.placeholder = String(datos.odometros[id] ?? "");
  }

  function sugerirRepuesto() {
    const p = datos.partes.find((x) => String(x.id) === selParte.value);
    const primera = tbody.querySelector(".fila-rep .sel-rep");
    if (!p || !primera || primera.value) return;
    const r = datos.repuestos.find((x) => x.tipoParteId === p.tipoParteId);
    if (r) { primera.value = String(r.id); recalcular(); }
  }

  selUnidad.addEventListener("change", partes);
  selParte.addEventListener("change", sugerirRepuesto);
  form.addEventListener("input", recalcular);
  form.addEventListener("change", recalcular);
  document.getElementById("agregar-rep").addEventListener("click", () => {
    const nueva = tbody.querySelector(".fila-rep").cloneNode(true);
    nueva.querySelector(".sel-rep").value = "";
    nueva.querySelector(".cant").value = "1";
    tbody.appendChild(nueva);
    nueva.querySelector(".sel-rep").focus();
    recalcular();
  });
  tbody.addEventListener("click", (e) => {
    const b = e.target.closest(".quitar");
    if (!b) return;
    const filas = tbody.querySelectorAll(".fila-rep");
    if (filas.length > 1) b.closest(".fila-rep").remove();
    else { b.closest(".fila-rep").querySelector(".sel-rep").value = ""; }
    recalcular();
  });
  sugerirRepuesto();
  recalcular();
}
