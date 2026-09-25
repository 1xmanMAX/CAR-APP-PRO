// Primer uso: sigue la búsqueda de dispositivos y la sincronización; al terminar, lleva a Entrar.
(function () {
  var lista = document.getElementById("emp-vecinos");
  if (!lista) return;
  var progreso = document.getElementById("emp-progreso");
  var mensaje = document.getElementById("emp-mensaje");
  var barra = document.getElementById("emp-barra");
  var resultado = document.getElementById("emp-resultado");
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function refrescar() {
    fetch("/empezar/estado", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (j) {
      var e = j.estado;
      if (j.listo && !(e && e.enCurso)) {
        resultado.innerHTML = '<div class="aviso ok" role="status"><b>Datos recibidos.</b> Entra con tu correo y contraseña de siempre.</div>';
        setTimeout(function () { location.href = "/entrar"; }, 1500);
        return;
      }
      if (e && e.enCurso) {
        progreso.hidden = false;
        mensaje.textContent = e.mensaje || "Sincronizando…";
        barra.style.width = Math.round((e.fraccion || 0) * 100) + "%";
      } else {
        progreso.hidden = true;
        if (e && e.ultimo) {
          resultado.innerHTML = '<div class="aviso ' + (e.ultimo.ok ? "ok" : "error") + '" role="status">' + esc(e.ultimo.texto) +
            (e.ultimo.ok ? " · el otro dispositivo todavía no tiene usuarios con contraseña: crea el acceso allí primero." : "") + "</div>";
        }
      }
      if (!j.vecinos.length) {
        lista.innerHTML = '<span class="muted" style="font-size:12px">Buscando dispositivos del grupo en la red…</span>';
      } else {
        lista.innerHTML = j.vecinos.map(function (v) {
          return '<form method="post" action="/empezar/con" class="fila-flota" style="grid-template-columns:minmax(0,1fr) auto">' +
            '<div><b>' + esc(v.nombre) + '</b> <span class="chip ok">' + esc(v.codigo) + '</span><div class="muted" style="font-size:11px">' + esc(v.direccion) + '</div></div>' +
            '<input type="hidden" name="destino" value="' + esc(v.direccion + ":" + v.puerto) + '">' +
            '<button class="btn primario chico" type="submit"' + (e && e.enCurso ? " disabled" : "") + '>TRAER DATOS</button></form>';
        }).join("");
      }
    }).catch(function () {});
  }
  refrescar();
  setInterval(refrescar, 1500);
})();
