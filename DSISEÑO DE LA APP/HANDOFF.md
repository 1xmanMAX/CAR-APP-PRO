# Handoff: Control de Flota — Transporte de carga pesada

Brief para Claude Code. Este paquete describe el nuevo diseño visual y las funciones nuevas de la app de gestión de mi empresa de transporte (5 trailers). **La app ya está casi construida**: el trabajo es montar esto encima de lo que existe, no empezar de cero.

---

## 0. Instrucciones para Claude Code (leer primero)

1. **Antes de escribir código, revisa el repositorio existente**: stack, estructura de carpetas, modelos/tablas de la base de datos, rutas, autenticación y cómo está conectado el bot de Telegram (si ya existe).
2. **Haz un mapeo** entre lo que ya existe y lo que pide este documento. Entrégame ese mapeo como una lista corta (qué ya está, qué se modifica, qué es nuevo) **antes** de hacer cambios grandes.
3. **No borres ni reescribas módulos que funcionan.** Extiende los modelos existentes con migraciones; no los recrees. Si un nombre de campo existente difiere del que uso aquí, usa el existente.
4. Trabaja por fases (sección 9). Al final de cada fase, verifica que lo anterior siga funcionando.
5. Si algo de este documento choca con lo que ya está construido, **pregúntame** antes de decidir.
6. La carpeta `diseno/` contiene las pantallas como referencia visual (archivos `.dc.html` de un editor de diseño; no son código de producción ni se ejecutan solos). Úsalos para copiar layout, textos, colores y jerarquía. Los números que aparecen son **datos de ejemplo**.

---

## 1. Qué es la app

Una herramienta **principalmente visual** para el personal (dueño, contador, encargado de taller, choferes) que controla:

- Facturas, guías de remisión y viajes.
- Gastos, ingresos, reinversiones y préstamos.
- Inventario de repuestos con la inversión en cada uno.
- **Estado de cada parte de cada trailer** mediante un modelo 3D de puntos, con contadores de desgaste por **km, número de viajes y días**, para cambiar las piezas **antes** de que fallen.
- Presupuestos de fletes, proyecciones y rentabilidad.
- Entrada de datos desde un **bot de Telegram** (los choferes registran viajes, gastos, km y cambios desde el celular).

Moneda: soles (S/). Idioma de la interfaz: español.

---

## 2. Estilo visual (aplicar a toda la app)

Estilo "terminal / laboratorio": denso, técnico, monoespaciado, con paneles de borde fino.

### Tokens

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#EFE9DC` | Fondo de página (crema) |
| `--panel` | `#FAF7F0` | Fondo de paneles |
| `--panel-alt` | `#F2ECE0` | Cabeceras de tablas |
| `--border` | `#CDBFA5` | Bordes de paneles (1px) |
| `--divider` | `#E4DCCB` | Separadores internos, pistas de barras |
| `--text` | `#1E1B16` | Texto principal |
| `--muted` | `#6B6254` | Texto secundario / etiquetas |
| `--dark` | `#121719` | Paneles oscuros (visor 3D, feed de Telegram, KPI destacado) |
| `--dark-text` | `#E9E3D6` | Texto sobre oscuro |
| `--accent` | `#B8236E` | Magenta: acento, nav activo, botones principales, "cambiar ya" |
| `--accent-soft` | `#F7D3E5` / `#FCE6F1` | Fondos magenta suaves |
| `--accent-on-dark` | `#FF8CC6` / `#FF5AAE` | Magenta sobre fondo oscuro |
| `--amber` | `#EFD27A` (fondo) / `#7A5A00` (texto) / `#F2C14E` (sobre oscuro) / `#D9A21B` (barras) | "Próximo", resaltados |
| `--ok` | `#2D5B7A` (texto/barras) / `#D6E4EE` (fondo chip) / `#8FB4CC` (sobre oscuro) | Estado OK |

**Tipografía:** `Space Mono` 700 para títulos y cifras grandes; `IBM Plex Mono` 400/500/600 para todo lo demás (Google Fonts). Etiquetas en MAYÚSCULAS con `letter-spacing: 0.06–0.08em`, tamaño 10–12px.

**Radios:** 6px paneles, 4px botones/inputs, 3px chips.

**Estados de desgaste (usar en toda la app, de forma consistente):**
- `ok` < 70% → azul
- `próximo` 70–89% → ámbar
- `cambiar` ≥ 90% → magenta

**Accesibilidad:** botones y controles de al menos 40–44px de alto; contraste de texto ≥ 4.5:1; usar `<button>`, `<a>`, `<label>` reales.

### Estructura común de cada pantalla

1. **Header** (panel): logo de puntos, "[EMPRESA] · Control Flota", subtítulo, y a la derecha: unidades activas, viajes del mes, margen, estado del bot de Telegram (EN LÍNEA / DESCONECTADO) y la hora.
2. **Barra de navegación** (panel) con secciones numeradas; la activa en magenta:
   `01 DASHBOARD · 02 TRAILER 3D · 03 FLOTA · 04 INVENTARIO · 05 REPARACIONES · 06 VIAJES · 07 FINANZAS · 08 RENTABILIDAD · 09 TELEGRAM`
3. Contenido en una grilla de paneles.

---

## 3. Pantallas

Referencia visual de cada una en `diseno/`.

### 01 Dashboard — `Main.dc.html`
- Tira de KPIs: ganancia neta del mes (destacada, oscura), ingresos por fletes, gastos, invertido en repuestos, deuda de préstamos.
- **Flota · salud por parte**: una fila por trailer con su estado (en ruta / en base / en taller), una tira de cuadros de color (uno por parte, según desgaste) y la próxima pieza a cambiar ("FRENOS · 2 VIAJES"). Clic → Trailer 3D de esa unidad.
- **Próximos cambios**: ranking de todas las partes de toda la flota, ordenado por % de desgaste, con barra y "quedan N viajes".
- **Telegram · entradas del bot**: feed en vivo de los últimos eventos que llegaron por el bot.
- **Viajes · cuándo sale cada trailer**: una fila por trailer con los últimos 30 días; cada viaje es una barra con altura proporcional a los km.
- **Gastos por categoría**: barras horizontales.

### 02 Trailer 3D — `Trailer.dc.html` ⭐ pantalla principal nueva
- **Selector de unidad** (T-01…T-05).
- **Visor 3D con nube de puntos** del tractocamión + semirremolque sobre fondo oscuro con retícula de puntos.
  - Cada punto pertenece a una **zona**: cabina, motor, chasis, caja/semirremolque, tanque, batería, quinta rueda, llantas eje delantero, llantas de tracción, llantas del semirremolque.
  - Las zonas que contienen partes controladas se colorean según el **peor desgaste** de sus partes (ok/próximo/cambiar). Las zonas sin partes controladas van en gris claro y semitransparentes.
  - Hay marcadores (anillos) en cada zona controlada. La parte seleccionada se resalta: puntos más grandes, anillo punteado ámbar y etiqueta con nombre y % de desgaste.
  - Controles: girar izquierda/derecha y botón GIRAR/DETENER (autorotación). En la app real, implementar con **Three.js** (`THREE.Points` + `OrbitControls`), con zoom y arrastre. Ideal: poder hacer clic en una zona del modelo para seleccionarla (raycasting).
  - Leyenda: OK / PRÓXIMO (70%+) / CAMBIAR (90%+).
- Tira de datos bajo el visor: km total, viajes, km/viaje promedio, cantidad de partes OK / próximas / cambiar ya.
- **Lista de partes** (izquierda) ordenada por desgaste; cada una con barra de color, % y "≈ N viajes restantes". Clic → la selecciona.
- **Detalle de la parte** (derecha): estado, fecha de instalación, código del repuesto, costo; **tres contadores** (km, viajes, días), cada uno con valor actual / vida útil y barra. El contador que se cumple primero se marca como **"MANDA"**. Caja oscura: "CAMBIAR ANTES DE: N VIAJES". Botones: REGISTRAR CAMBIO (→ Reparaciones con la parte precargada) y VER EN STOCK (→ Inventario filtrado).
- **Km por viaje (últimos 24 viajes)**: barras coloreadas por intensidad. Mensaje clave: no todos los viajes desgastan igual.
- **Viajes desde el último cambio** de la parte seleccionada: guía, ruta, km.

### 03 Flota — `Flota.dc.html`
Tarjeta por trailer: ID, placa, marca/modelo, chip de estado, tira de salud por parte, km total, viajes, margen del mes, "próximo cambio" y botones ABRIR MODELO 3D / VIAJES. Tarjeta punteada para agregar una unidad.

### 04 Inventario — `Inventario.dc.html`
- KPIs: inversión total en repuestos, valor en almacén, valor instalado en trailers, ítems con stock bajo.
- Tabla: código, repuesto, categoría, stock, costo unitario, inversión total, **vida útil (km · viajes o días)**, **instalado en** (trailer y posición), estado (EN STOCK / BAJO / INSTALADO).
- Búsqueda + filtros por categoría y trailer; botón REGISTRAR COMPRA.
- Lateral: inversión por categoría (barras) y compras recibidas vía Telegram.

### 05 Reparaciones y cambios — `Reparaciones.dc.html`
- Formulario **Registrar cambio**: trailer, **parte del modelo**, odómetro actual, fecha, tipo (preventivo / correctivo / falla en ruta), repuestos usados (salen del inventario), mano de obra, taller/mecánico.
- Recuadro "AL GUARDAR": (1) el contador de la parte vuelve a 0 km · 0 viajes · 0 días; (2) se descuenta el stock; (3) el costo entra como gasto de ese trailer; (4) se avisa al grupo de Telegram.
- **¿Se cambió a tiempo?**: por cada cambio, el % de desgaste que tenía al cambiarse, con la franja meta 80–95% marcada. Etiquetas: MUY PRONTO (<80), A TIEMPO (80–100), TARDE (>100).
- Historial: fecha, unidad, trabajo, tipo, odómetro, costo, origen (Web/Telegram).

### 06 Viajes, guías y facturas — `Facturacion.dc.html`
- KPIs: viajes del mes, km recorridos, flete promedio, por cobrar.
- Tabla de viajes: guía, unidad, ruta, km, toneladas, flete, costo, margen %, estado de factura (PAGADA / PENDIENTE / VENCIDA / SIN FACTURA), origen. **Cada viaje registrado suma km y 1 viaje a todas las partes de esa unidad.**
- Lateral oscuro: cuentas por cobrar ordenadas por antigüedad (días) y botón "Recordar cobro por Telegram".

### 07 Finanzas — `Finanzas.dc.html`
- KPIs: ingresos del mes, gastos del mes, ganancia neta, reinvertido en el año, deuda de préstamos.
- Flujo de caja de 12 semanas (entradas hacia arriba, salidas hacia abajo).
- Movimientos: fecha, tipo (INGRESO / GASTO / REINVERSIÓN / CUOTA), detalle, unidad, monto, origen.
- Préstamos: saldo pendiente, tasa, tira de cuotas (pagadas en magenta) y próxima fecha.
- Reinversiones del año.

### 08 Rentabilidad y fletes — `Rentabilidad.dc.html`
- **Cotizador de flete** interactivo (fórmula en la sección 6): ruta, trailer, distancia, toneladas, precio del combustible, rendimiento, peajes, viáticos, desgaste S/ por km y margen deseado. Muestra el desglose de costos, el costo del viaje, el **flete sugerido**, S/ por tonelada, S/ por km y la ganancia. Botón: GENERAR PRESUPUESTO (PDF) · ENVIAR POR TELEGRAM.
- Rentabilidad por trailer del mes: viajes, ingresos, costos, S/ por km, margen % con barra.
- Proyección a 6 meses: ingresos vs costos (meses reales en color sólido, proyectados en color claro).
- Presupuesto vs real por categoría (línea que marca el 100%).

### 09 Bot de Telegram — `Chofer.dc.html`
Mock móvil del chat con el bot: alertas de desgaste, `/viaje inicio` con botones para elegir la unidad, confirmación "VIAJE REGISTRADO", `/gasto` con foto del voucher, `/km`, y un teclado de comandos.

---

## 4. Modelo de datos (nuevo o para extender)

Adaptar a los modelos que ya existen. Nombres orientativos:

- **Trailer**: id, código (T-01), placa, marca, modelo, año, estado (`en_ruta|en_base|en_taller|inactivo`), odómetro actual.
- **LecturaOdometro**: trailer_id, km, fecha, origen (`web|telegram`), usuario.
- **Viaje** (vinculado a la guía de remisión): trailer_id, chofer_id, guía, origen, destino, km, toneladas, fecha inicio/fin, flete, costo calculado, factura_id, origen del registro.
- **TipoParte** (catálogo): nombre, zona del modelo 3D (`motor|cabina|chasis|caja|tanque|bateria|quinta|llantas_del|llantas_trac|llantas_sr`), vida útil por defecto en `km`, `viajes` y `dias` (cualquiera puede ser nula).
- **ParteInstalada**: trailer_id, tipo_parte_id, posición (ej. "eje 4-6"), repuesto_id (del inventario), fecha de instalación, km de instalación, número de viajes del trailer al instalar, vida útil propia (permite sobrescribir la del catálogo), activa (bool).
- **Repuesto** (inventario): código, nombre, categoría, stock, stock mínimo, costo unitario, proveedor, tipo_parte_id (opcional).
- **CompraRepuesto**: repuesto_id, cantidad, costo unitario, fecha, origen.
- **Reparacion/Cambio**: trailer_id, parte_instalada_id (la que se retira), tipo (`preventivo|correctivo|falla_en_ruta`), odómetro, fecha, repuestos usados (detalle con cantidades), mano de obra, taller, costo total, **% de desgaste al momento del cambio** (se guarda para el panel "¿Se cambió a tiempo?"), origen.
- **Gasto / Ingreso / Reinversión / Préstamo / CuotaPrestamo / Factura**: mantener los existentes y agregar `trailer_id` (opcional) y `origen` (`web|telegram`) donde falten.
- **EventoTelegram**: fecha, usuario/chofer, comando, payload, trailer_id, entidad creada (tipo + id), estado (`ok|error`). Alimenta el feed del Dashboard.
- **ParametrosCotizador**: precio del combustible, rendimiento por trailer, viáticos por defecto, desgaste S/ por km, margen por defecto.

---

## 5. Lógica de desgaste (el núcleo)

Para cada `ParteInstalada` activa:

```
km_uso     = odometro_actual(trailer) - km_instalacion
viajes_uso = viajes_del_trailer_desde(fecha_instalacion)
dias_uso   = hoy - fecha_instalacion

r_km     = km_uso / vida_km          (si vida_km no es nula)
r_viajes = viajes_uso / vida_viajes  (si no es nula)
r_dias   = dias_uso / vida_dias      (si no es nula)

desgaste% = round(max(r_km, r_viajes, r_dias) * 100)   # manda el que se cumpla primero
estado    = ok (<70) | proximo (70–89) | cambiar (>=90)
limitante = el contador con el ratio mayor  → se muestra como "MANDA"
```

**Viajes restantes estimados** (para "CAMBIAR ANTES DE N VIAJES"):

```
km_por_viaje   = km_uso / viajes_uso          (o el promedio histórico del trailer)
dias_por_viaje = dias_uso / viajes_uso
restantes = max(0, min(
  vida_viajes - viajes_uso,
  floor((vida_km   - km_uso)   / km_por_viaje),
  floor((vida_dias - dias_uso) / dias_por_viaje)
))
```

Si la parte solo tiene vida en días (ej. batería), mostrar "N DÍAS" en lugar de viajes.

**Disparadores:**
- Al registrar un viaje o una lectura de odómetro → recalcular las partes de ese trailer.
- Cuando una parte cruza 70% o 90% → enviar una alerta al grupo de Telegram (una sola vez por umbral).
- Al registrar un cambio → guardar el % de desgaste actual en la reparación, desactivar la parte vieja, crear la nueva con contadores en 0, descontar stock, crear el gasto del trailer y avisar por Telegram.

**Color de cada zona del modelo 3D** = estado de la parte con mayor desgaste dentro de esa zona.

---

## 6. Cotizador de fletes

```
combustible = (km / rendimiento_km_por_gal) * precio_gal
desgaste    = km * desgaste_soles_por_km
costo       = combustible + peajes + viaticos + desgaste
flete       = costo / (1 - margen%)          # margen limitado a 0–90%
por_ton     = flete / toneladas
por_km      = flete / km
ganancia    = flete - costo
```

- `desgaste_soles_por_km` debería poder **calcularse automáticamente** a partir del historial: la suma del costo de cambios de repuestos dividida entre los km recorridos del trailer (o de la flota), con la opción de sobrescribirlo a mano.
- Guardar las cotizaciones y permitir exportarlas a PDF y enviarlas por Telegram.

**Proyección a 6 meses**: usar el promedio de viajes por mes, el flete promedio y el costo promedio por km de los últimos meses, más el costo de los cambios de repuestos que ya vienen en camino según los contadores de desgaste (partes que llegarán a 100% dentro del horizonte).

**Rentabilidad por trailer**: ingresos por fletes menos gastos asignados a ese trailer (combustible, peajes, repuestos, reparaciones) en el periodo; mostrar el margen % y los S/ por km.

---

## 7. Bot de Telegram

Si ya hay un bot, extenderlo; si no, crearlo (ej. `python-telegram-bot` o `grammY`, según el stack) con **webhook** hacia el backend. Solo responde a usuarios registrados (vincular el `telegram_user_id` con un usuario y su rol).

| Comando | Qué hace |
|---|---|
| `/viaje inicio` | Pide la unidad (botones T-01…T-05), luego ruta y toneladas; crea el viaje y la guía asociada |
| `/viaje fin` o `/fin` | Cierra el viaje activo y pide el km final |
| `/gasto <categoría> <monto>` | Registra un gasto del viaje o trailer actual; acepta **foto del voucher** (guardar la imagen) |
| `/km <odómetro>` | Registra una lectura de odómetro y recalcula el desgaste |
| `/cambio` | Flujo guiado: unidad → parte → repuestos → costo (igual que el formulario de Reparaciones) |
| `/compra` | Registra una compra de repuesto al inventario |
| `/estado [T-0X]` | Responde con las próximas partes a cambiar de la unidad |

El bot envía: alertas de desgaste (70% / 90%), stock bajo, cuotas de préstamo por vencer, facturas vencidas y los presupuestos generados. Cada interacción se guarda como `EventoTelegram`, y el header de la web muestra si el bot está en línea.

---

## 8. Roles

| Rol | Ve | Edita |
|---|---|---|
| Dueño / Admin | Todo | Todo, incluidos los usuarios y los parámetros del cotizador |
| Contador | Viajes, facturas, finanzas, rentabilidad | Facturas, gastos, ingresos, préstamos |
| Encargado de taller | Trailer 3D, flota, inventario, reparaciones | Inventario, reparaciones y cambios, vida útil de las partes |
| Chofer | Solo vía Telegram (sus viajes y gastos) | Viajes, gastos, km y cambios mediante el bot |

---

## 9. Fases sugeridas

1. **Mapeo del repositorio existente** y aplicación del nuevo estilo visual (tokens, header, navegación) a las pantallas que ya existen.
2. **Modelo de partes y lógica de desgaste**: tablas, cálculo, vinculación con viajes y odómetro. Pantalla Trailer 3D con Three.js.
3. Integración con Reparaciones e Inventario (el cambio reinicia contadores y descuenta stock) y el panel "¿Se cambió a tiempo?".
4. **Bot de Telegram**: comandos, webhook, alertas y feed en el Dashboard.
5. Rentabilidad: cotizador, rentabilidad por trailer, proyecciones y presupuesto vs real.
6. Pulido: rendimiento del visor 3D, vista responsive para tablet y pruebas.

## 10. Criterios de aceptación

- Al registrar un viaje de 1,290 km en T-01 (por web o por Telegram), todas las partes activas de T-01 suman 1,290 km y 1 viaje, y sus colores en el modelo 3D se actualizan.
- Una parte con 22/24 viajes, 46,800/60,000 km y 140/240 días aparece con **92%**, en magenta, con "MANDA" en el contador de viajes y "CAMBIAR ANTES DE 2 VIAJES".
- Al registrar un cambio de esa parte, su contador vuelve a 0, el stock baja, se crea el gasto en T-01, el cambio aparece en "¿Se cambió a tiempo?" como A TIEMPO (92%) y llega un aviso a Telegram.
- El cotizador recalcula en vivo y coincide con la fórmula de la sección 6.
- `/gasto combustible 480` con una foto crea el gasto, guarda la imagen y aparece en el feed del Dashboard y en Finanzas.

## 11. Preguntas para confirmar conmigo

- ¿Cuáles son las vidas útiles reales (km / viajes / días) de cada tipo de parte? Por ahora se configuran en el catálogo; los valores del diseño son de ejemplo.
- ¿El odómetro se registra a mano (por Telegram) o viene de un GPS?
- ¿Las facturas y guías electrónicas se emiten desde la app (SUNAT) o solo se registran?
- ¿Hay un grupo de Telegram del equipo para las alertas, o se envían por mensaje privado a cada rol?
