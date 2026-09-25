// Pantalla Sincronizar: lista de dispositivos cerca y avance de la sincronización, en vivo.
var datos = JSON.parse(document.getElementById("datos-sinc").textContent);
var lista = document.getElementById("sinc-vecinos");
var progreso = document.getElementById("sinc-progreso");
var mensaje = document.getElementById("sinc-mensaje");
var barra = document.getElementById("sinc-barra");
var resultado = document.getElementById("sinc-resultado");
var vivo = document.getElementById("sinc-vivo");
var estabaEnCurso = false;

function esc(t) {
  return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
}

function pintarVecinos(vecinos, ocupado) {
  if (!lista) return;
  if (!vecinos.length) {
    lista.innerHTML = '<span class="muted" style="font-size:12px">Buscando dispositivos del grupo en la red… Abre Control Flota en el otro dispositivo (mismo Wi-Fi).</span>';
    return;
  }
  lista.innerHTML = vecinos.map(function (v) {
    return '<form method="post" action="/sincronizar/con" class="fila-flota" style="grid-template-columns:minmax(0,1fr) auto">' +
      '<div><b>' + esc(v.nombre) + '</b> <span class="chip ok">' + esc(v.codigo) + '</span><div class="muted" style="font-size:11px">' + esc(v.direccion) + ' · en línea</div></div>' +
      '<input type="hidden" name="destino" value="' + esc(v.direccion + ":" + v.puerto) + '">' +
      '<button class="btn primario chico" type="submit"' + (ocupado ? " disabled" : "") + '>SINCRONIZAR</button></form>';
  }).join("");
}

function pintarResultado(u) {
  if (!resultado || !u) return;
  var r = u.resultado;
  var html = '<div class="aviso ' + (u.ok ? "ok" : "error") + '" role="status"><b>' + esc(u.texto) + '</b>';
  if (r) {
    html += '<br>↓ ' + r.traidas + ' recibidos · ↑ ' + r.mandadas + ' enviados · ⇄ ' + r.fusionadas + ' juntados' +
      (r.choques ? ' (' + r.choques + ' campos cambiados en los dos: ganó el más reciente)' : '') +
      ' · ✕ ' + r.borradas + ' borrados' + (r.archivos ? ' · ' + r.archivos + ' fotos/documentos' : '');
    if (r.avisos && r.avisos.length) {
      var vistos = r.avisos.slice(0, 8);
      html += '<ul style="margin:6px 0 0 16px;padding:0">' + vistos.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") +
        (r.avisos.length > 8 ? "<li>… y " + (r.avisos.length - 8) + " avisos más</li>" : "") + "</ul>";
    }
  }
  resultado.innerHTML = html + "</div>";
}

function refrescar() {
  if (!datos.enGrupo) return;
  fetch("/api/sincro", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (j) {
    var e = j.estado;
    if (vivo) vivo.textContent = "● " + (j.vecinos.length ? j.vecinos.length + " CERCA" : "BUSCANDO");
    pintarVecinos(j.vecinos, e && e.enCurso);
    if (e && e.enCurso) {
      estabaEnCurso = true;
      progreso.hidden = false;
      mensaje.textContent = e.mensaje || "Sincronizando…";
      barra.style.width = Math.round((e.fraccion || 0) * 100) + "%";
    } else {
      progreso.hidden = true;
      if (e && e.ultimo) pintarResultado(e.ultimo);
      if (estabaEnCurso) {
        estabaEnCurso = false;
        setTimeout(function () { location.reload(); }, 2500);
      }
    }
  }).catch(function () { /* sin conexión con la app: se reintenta */ });
}

refrescar();
setInterval(refrescar, 1500);
