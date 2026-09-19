# SUNATAPP — Planes 3 y 4: viajes con presupuesto, lectura con IA y web

- **Fecha:** 2026-09-19
- **Estado:** Diseño aprobado por partes en conversación; pendiente revisión del documento.
- **Depende de:** Plan 1 (núcleo, en `main`) y Plan 2 (bot de Telegram, `2026-09-13-plan2-bot-telegram-design.md`), que se implementa antes. Este documento reemplaza la §9 (Web) del spec base `2026-09-13-mvp-gre-transportista-design.md`.

---

## 1. Objetivo

Que el dueño y el chofer registren **todo por Telegram**: fotos de comprobantes, texto, notas de voz, PDFs y otras fotos. Una IA (DeepSeek) clasifica cada mensaje y extrae los datos, y el bot pide confirmar antes de guardar. Todo queda asociado a **viajes de ida y vuelta**, cada uno con su **presupuesto por ruta**, su **liquidación del adelanto del chofer** y su **ganancia real**. Una **web sencilla** sirve para ver, revisar, corregir y analizar; en la web no se cargan datos nuevos.

## 2. Decisiones tomadas

| Tema | Decisión |
|------|----------|
| Presupuesto | **Por viaje** (no mensual ni cotización). Presupuestado vs. real por categoría |
| Viaje | **Ida y vuelta**: 0 a 2 guías (ida y retorno), gastos de todo el recorrido |
| Quién registra | El chofer en ruta y el dueño; el dueño revisa y corrige |
| Canal de registro | **Solo Telegram.** La web no tiene formularios de alta (solo editar, borrar, enlazar, cerrar viaje, registrar cobro y editar plantillas) |
| Presupuesto inicial | **Plantilla por ruta**, copiada al viaje y editable; en la web se muestra el promedio real de los últimos 5 viajes cerrados |
| Dinero del chofer | **Adelanto en efectivo + envíos extra**; al cerrar, liquidación = entregado − gastado |
| Permisos | **Sin roles**: el chofer tiene el mismo acceso que el dueño |
| Lectura | **IA DeepSeek** (modelo con visión) para clasificar y extraer; voz → texto con **Whisper local** |
| Confirmación | **Siempre** se muestra lo entendido con `[✅ Correcto] [✏️ Corregir] [❌ Descartar]` antes de guardar |
| Orden | Plan 2 (bot, ya diseñado) → **Plan 3** (IA + viajes en el bot) → **Plan 4** (web) |
| Web | **Un solo proceso**: bot + web + tareas de fondo. Hono con páginas armadas en el servidor (JSX) y casi sin JavaScript en el navegador |
| Entrada a la web | Sin contraseña: `/web` en el bot entrega un enlace de un solo uso |

## 3. Arquitectura

```
packages/
  ia/                        NUEVO
    src/tipos.ts             ProveedorIA, Transcriptor, LecturaIA, tipos de extracción (zod)
    src/deepseek.ts          cliente de DeepSeek (API compatible con OpenAI), modo JSON, imágenes
    src/whisper.ts           voz → texto con whisper.cpp local (OGG → WAV 16 kHz con ffmpeg)
    src/simulado.ts          proveedor determinista para pruebas (sin red ni costo)
    src/prompts.ts           instrucciones de clasificación y extracción (un solo lugar)
    src/index.ts             crearProveedorIA(config), crearTranscriptor(config)
  core/src/viajes/           NUEVO
    rutas.ts                 CRUD de rutas y plantillas
    viajes.ts                crear, iniciar, cerrar, enlazar guías, viaje en curso por vehículo
    gastos.ts                registrar, editar, borrar gastos y entregas
    calculos.ts              presupuesto vs. real, semáforo, liquidación, ganancia, promedios
    estadisticas.ts          consultas agregadas para la web
  core/src/lecturas/         NUEVO
    recibir.ts               guardar mensaje/archivo entrante (idempotente)
    leer.ts                  pasar por Whisper/texto PDF/IA, validar, dejar "por_confirmar"
    confirmar.ts             aplicar la lectura confirmada (crea gasto, entrega, viaje…)
    pendientes.ts            reintentos de lecturas fallidas
apps/bot/                    (del Plan 2) + flujo-lectura.ts, comandos /saldo /invitar /web
apps/web/                    NUEVO: crearWeb(ctx) → app Hono; la arranca main.ts del bot
```

Reglas de dependencia:
- `apps/*` solo llaman a `core`.
- `core` usa `ia` a través de la interfaz `ProveedorIA` inyectada en el `Contexto`.
- `ia` no conoce la base de datos.
- La tarea de fondo del Plan 2 (cada 60 s) añade `procesarLecturasPendientes`, y nunca se solapan dos pasadas.

Proceso único: `pnpm app` (renombra `pnpm bot`) arranca el contexto, el bot, la web en `WEB_PUERTO` y la tarea de fondo. PGlite sigue dentro de ese proceso, sin pglite-socket.

## 4. Modelo de datos (cambios)

Montos en **céntimos** (`bigint`), como en el resto del esquema. Fechas `date` en hora de Lima.

**Enums nuevos**
- `categoria_gasto`: `combustible, peaje, viaticos, hospedaje, estiba, balanza, cochera, reparacion, otros`
- `estado_viaje`: `planificado, en_curso, cerrado`
- `medio_entrega`: `efectivo, yape, transferencia, otro`
- `tipo_mensaje`: `pdf, foto, voz, texto`
- `estado_lectura`: `pendiente, por_confirmar, confirmado, descartado, error`
- `tramo_guia`: `ida, retorno`

**Tablas nuevas**

| Tabla | Campos |
|-------|--------|
| `ruta` | id, nombre (único), activa |
| `ruta_presupuesto` | ruta_id, categoria, monto · PK (ruta_id, categoria) |
| `viaje` | id, codigo (único, `VJ-0001` con `correlativo`), ruta_id, vehiculo_id, vehiculo_secundario_id?, conductor_id, fecha_salida, fecha_regreso?, estado, nota?, creado_en, actualizado_en · **índice único parcial: un solo viaje `en_curso` por vehículo** |
| `viaje_presupuesto` | viaje_id, categoria, monto · PK (viaje_id, categoria) |
| `entrega` | id, viaje_id, fecha, monto, medio, nota?, documento_id?, usuario_id, creado_en |
| `gasto` | id, viaje_id? (null = sin viaje, aparece en "Por revisar"), categoria, monto, fecha, proveedor_ruc?, proveedor_nombre?, comprobante? (serie-número), nota?, documento_id?, usuario_id, creado_en, editado_en? |
| `lectura_ia` | id, documento_id, proveedor, modelo, tokens_entrada, tokens_cache, tokens_salida, costo_micro_usd, respuesta (jsonb), error?, creado_en |
| `invitacion` | id, codigo_hash, creada_por, expira_en, usada_por?, usada_en? |
| `enlace_web` | id, token_hash, usuario_id, expira_en, usado_en? |
| `sesion_web` | id, token_hash, usuario_id, expira_en, creado_en |

**Tablas existentes**
- `documento_recibido`:
  - `ruta_archivo` pasa a opcional (un texto no trae archivo).
  - Se agregan `tipo` (`tipo_mensaje`), `texto` (el mensaje o la transcripción), `estado_lectura`, `clasificacion`, `correcciones` (jsonb, lista de textos del usuario), `intentos_lectura`, `proximo_intento_en` y `telegram_chat_id`/`telegram_message_id` (para editar el resumen).
  - El `hash_sha256` único del Plan 2 se mantiene para archivos; para textos la idempotencia es por (`telegram_chat_id`, `telegram_message_id`).
- `guia_transportista`: se agregan `viaje_id?` y `tramo?`.
- `usuario`: `email` pasa a opcional (un chofer invitado no tiene email) y se agrega `telegram_nombre`.

## 5. Cálculos

- **Gastado por categoría** = Σ `gasto.monto` del viaje en esa categoría.
- **Semáforo** por categoría y total: 🟢 < 90 % del presupuesto · 🟡 90–100 % · 🔴 > 100 %. Sin presupuesto (0) con gasto > 0 → 🔴.
- **Liquidación** = Σ `entrega.monto` − Σ `gasto.monto`. Positivo: "el chofer devuelve S/ X". Negativo: "se le debe al chofer S/ X".
- **Flete de una guía** = `factura.subtotal` (sin IGV) de su factura en estado `aceptada` (en el MVP hay una guía por factura).
- **Ganancia del viaje** = Σ fletes − Σ gastos. Si alguna guía del viaje no tiene factura aceptada, se muestra "ganancia pendiente" junto al parcial. La detracción no resta.
- **Ganancia del mes** = Σ ganancia de los viajes **cerrados** con `fecha_regreso` en el mes.
- **Promedio de la ruta** por categoría = promedio del gastado en los últimos 5 viajes cerrados de esa ruta.
- Todos los cálculos se hacen en céntimos enteros y se redondean solo al mostrar.

## 6. Lectura con IA

### 6.1 Proveedor

```ts
interface ProveedorIA {
  nombre: string;
  leer(entrada: EntradaLectura): Promise<ResultadoLectura>;
}
interface EntradaLectura {
  texto?: string;                                  // mensaje, transcripción o texto del PDF
  imagenes?: Array<{ contenido: Buffer; mime: string }>;
  contexto: { hoy: string; viajeEnCurso?: ResumenViaje; rutas: string[]; correcciones: string[]; lecturaAnterior?: Lectura };
}
interface ResultadoLectura {
  lectura: Lectura;                                // validada con zod
  uso: { tokensEntrada: number; tokensCache: number; tokensSalida: number; costoMicroUsd: number; modelo: string };
}
type Lectura =
  | { tipo: "gasto"; categoria: Categoria; monto: number; fecha: string | null; proveedorRuc: string | null; proveedorNombre: string | null; comprobante: string | null; nota: string | null; dudas: string[] }
  | { tipo: "entrega"; monto: number; medio: MedioEntrega; fecha: string | null; dudas: string[] }
  | { tipo: "inicio_viaje"; ruta: string | null; adelanto: number | null; dudas: string[] }
  | { tipo: "fin_viaje"; dudas: string[] }
  | { tipo: "guia_remitente"; guia: GuiaExtraida }   // mismo tipo del Plan 2
  | { tipo: "otro"; descripcion: string }
  | { tipo: "no_entendi"; motivo: string };
```

- **DeepSeek:**
  - API compatible con OpenAI (`https://api.deepseek.com`), modelo con visión (`deepseek-flash` según la página de precios del 2026-09-19), salida en **modo JSON** validada con zod. Si la respuesta no valida, se reintenta una vez indicando el error; si vuelve a fallar → `no_entendi`.
  - **Antes de escribir el Plan 3 hay que verificar** el identificador exacto del modelo y el formato de las imágenes en la documentación de la API.
- **Costo:** `uso × precios` configurados en `.env` (`IA_PRECIO_*`), guardado en `lectura_ia`.
- Los montos que devuelve la IA son decimales en soles; `core` los convierte a céntimos y valida (> 0, ≤ `IA_MONTO_MAXIMO`, S/ 20,000 por defecto).
- El RUC del proveedor se valida con `validarRuc`; si no es válido se descarta y se agrega una duda.
- **Guía del remitente:** primero el lector por reglas del Plan 2 (PDF con texto). Si faltan campos o llega una **foto** de la guía, se usa la IA con la misma forma `GuiaExtraida`.
- **Transcriptor:** `Transcriptor.transcribir(audio) → texto`. Implementación local con whisper.cpp (modelo `small`, español) y ffmpeg para convertir OGG/Opus. Si no está instalado, las notas de voz quedan en `error` con el mensaje "instala Whisper" y el bot le pide al usuario que lo escriba.

### 6.2 Flujo de un mensaje

1. **Recibir.** Se guarda el archivo en `storage/recibidos/` y se registra en `documento_recibido` (`estado_lectura = pendiente`). Es idempotente. Responde "👀 Leyendo…".
2. **Preparar.** Voz → Whisper; PDF → texto (y la IA solo si el lector por reglas no basta); foto → imagen.
3. **Leer.** Con `ProveedorIA.leer` (sin bloquear el manejador de Telegram). Guarda `lectura_ia` y `estado_lectura = por_confirmar`.
4. **Mostrar el resumen**, según el tipo:
   - **gasto:** "⛽ Combustible · S/ 350.00 · Grifo Primax Juliaca (RUC 20…) · B012-4471 · 18 set · para VJ-0003 (quedarían S/ 422 del adelanto). ¿Correcto?"
   - **entrega:** "💵 Envío al chofer S/ 200.00 por Yape · VJ-0003".
   - **inicio_viaje:** "🚛 Nuevo viaje Arequipa ⇄ Puno · F2F-848 / V1X-971 · adelanto S/ 1,300 · presupuesto de la plantilla (S/ 1,570)".
   - **fin_viaje:** la liquidación y "¿cerrar VJ-0003?".
   - **guia_remitente:** continúa en el flujo de guía del Plan 2 (paso 4 en adelante).
   - **otro:** "📎 Guardé la foto (odómetro) en VJ-0003" `[✅] [❌]`.
   - **no_entendi:** botones de categorías + "escribe el monto".
   - Si la lectura trae `dudas` (monto ilegible, categoría dudosa), el resumen las muestra con ⚠️.
5. **Botones.**
   - `✅ Correcto` → `confirmarLectura` crea el registro (gasto, entrega, viaje…) en una transacción con compare-and-set sobre `estado_lectura`, así que el doble clic no duplica. El resumen se edita a "✅ Guardado".
   - `✏️ Corregir` → el bot pide una corrección en palabras ("eran 305", "es peaje", "es del viaje anterior"). Se agrega a `correcciones` y se vuelve a leer con `lecturaAnterior`.
   - `❌ Descartar` → `descartado`; el archivo se conserva.
6. **Viaje destino.** Por defecto, el viaje `en_curso` del vehículo habitual. Si no hay ninguno, el resumen ofrece `[Nuevo viaje] [Viaje anterior VJ-…] [Sin viaje]`. Si hay más de un vehículo con viaje en curso, se pregunta cuál.
7. **Pendientes de confirmar.** Si alguien manda un mensaje nuevo mientras otro espera confirmación, se procesan los dos: cada resumen tiene sus propios botones, identificados por el id del documento. Los que lleven 24 h sin respuesta aparecen en "Por revisar".

### 6.3 Mensajes que no son registros

`/comando`, las respuestas dentro de una conversación del Plan 2 (monto de factura, corrección de guía) y las respuestas a "✏️ Corregir" **no** pasan por la IA. La sesión de grammY indica si hay una conversación abierta.

## 7. Bot: comandos nuevos

| Comando | Qué hace |
|---------|----------|
| `/invitar` | Genera un código de 6 dígitos válido por 24 h. Quien lo envía al bot queda registrado como usuario (mismo acceso). Reemplaza la regla "solo el dueño" del Plan 2 |
| `/saldo` | Viaje en curso: presupuesto vs. gastado por categoría con semáforo, entregado, saldo |
| `/viaje` | Lo mismo que escribir "salgo a …": abre el flujo de inicio de viaje con botones de rutas |
| `/cerrar` | Muestra la liquidación y cierra el viaje en curso tras confirmar |
| `/web` | Enlace de un solo uso (10 min) para entrar a la web |

Notificaciones: cada aviso le llega a quien originó la acción. El resumen diario de cobros (Plan 2) le llega al **primer usuario** (el dueño).

## 8. Web

### 8.1 Técnica

- **Hono** con JSX del lado del servidor. Formularios HTML normales (POST + redirección). Casi sin JavaScript: solo un script pequeño para confirmar borrados y previsualizar fotos.
- **Gráficos** como **SVG generado en el servidor** (barras simples), sin librerías de gráficos.
- **Estilo:** un solo CSS propio, pensado primero para celular. Menú abajo en el celular (*Inicio · Viajes · Por revisar · Más*) y al costado en pantallas anchas. Montos `S/ 1,234.50` y colores de semáforo (§5).
- **Sesión:** `/entrar?t=<token>` valida `enlace_web` (un solo uso, 10 min, guardado con hash) y crea `sesion_web` (30 días) en una cookie `httpOnly`, `SameSite=Lax`, `Secure` cuando se usa HTTPS. En cada POST se verifica que el encabezado `Origin` coincida con `WEB_URL_PUBLICA`.
- Los archivos de `storage/` se sirven solo a quien tiene sesión, por id (nunca por ruta).
- **Acceso desde el celular:** mientras todo corra en la PC local, la web escucha en `WEB_HOST`/`WEB_PUERTO` y el enlace de `/web` usa `WEB_URL_PUBLICA`. Con la IP de la red local funciona desde el celular conectado al mismo wifi; desde fuera hace falta el VPS futuro o un túnel (fuera de alcance).

### 8.2 Pantallas

| Pantalla | Contenido | Acciones |
|----------|-----------|----------|
| **Inicio** | Viaje en curso (gastado vs. presupuesto, saldo), ganancia del mes, facturado del mes, por cobrar, vencido, facturas que vencen pronto, aviso "🔎 N por revisar" | — |
| **Por revisar** | Lecturas `por_confirmar` con más de 24 h, lecturas en `error`, gastos sin viaje. Foto o audio al lado de los datos | Corregir campos, asignar viaje, confirmar, descartar |
| **Viajes** | Lista por mes (código, ruta, fechas, estado, ganancia) y total del mes | Filtrar por mes, ruta o estado |
| **Detalle del viaje** | Semáforo por categoría, gastos (con 📷/🎤 para ver el original), entregas, liquidación, guías (ida y retorno) con flete, ganancia | Editar o borrar gastos y entregas, editar el presupuesto del viaje, enlazar o desenlazar guías, cerrar o reabrir el viaje |
| **Estadísticas** | Rango de fechas. Ingresos vs. gastos vs. ganancia por mes (barras); gasto por categoría; por ruta: ganancia promedio y desvío del presupuesto por categoría; combustible por viaje y por grifo; gasto por proveedor | Descargar Excel |
| **Rutas** | Plantilla por ruta y, junto a cada monto, el promedio real de los últimos 5 viajes cerrados | Crear o editar ruta y montos, **Usar promedio**, desactivar |
| **Guías** | Lista con estado y filtros (incluye "sin facturar" y "sin viaje") | Descargar PDF/XML/CDR |
| **Cobros** | Facturas pendientes y vencidas | Registrar cobro (monto, fecha, medio, nota) |
| **Más** | Empresa, vehículos, choferes, usuarios (con opción de desactivar), modo SUNAT (solo lectura), gasto de IA del mes en US$ | Desactivar usuario |

Todas las ediciones quedan en `auditoria` (quién, qué, antes y después).

### 8.3 Excel

`.xlsx` generado en el servidor (exceljs) para viajes, gastos, cobros y estadísticas del rango elegido. Los montos van como números con formato `S/ #,##0.00`.

## 9. Errores

| Situación | Comportamiento |
|-----------|----------------|
| DeepSeek no responde, sin saldo, error 5xx o 429 | La lectura queda `pendiente` con `proximo_intento_en` (1, 5, 15, 60 min…). El bot dice "lo leo en cuanto pueda" y avisa cuando esté listo |
| Clave de DeepSeek inválida (401) | Sin reintentos automáticos. Avisa al dueño una sola vez y las lecturas quedan `error` hasta corregir el `.env` |
| JSON inválido dos veces | `no_entendi` → botones manuales |
| Monto fuera de rango o RUC inválido | Se muestra como duda ⚠️ y no se guarda sin confirmar |
| Whisper o ffmpeg ausentes | La voz queda en `error` y el bot pide escribirlo |
| Doble clic en ✅ | Compare-and-set: el segundo clic responde "ya estaba guardado" |
| Dos viajes `en_curso` para el mismo vehículo | Lo impide el índice único; el bot ofrece cerrar el anterior |
| Enlace web vencido o usado | Página "pide un enlace nuevo con /web" |
| Error inesperado en la web | Página de error en español y el detalle en `logs/app.log` |

## 10. Configuración (.env, además de los Planes 1 y 2)

```
IA_PROVEEDOR=deepseek            # deepseek | simulado
DEEPSEEK_API_KEY=
DEEPSEEK_MODELO=deepseek-flash   # verificar ID exacto antes del Plan 3
IA_PRECIO_ENTRADA_USD_M=0.30     # por millón de tokens (sin caché)
IA_PRECIO_CACHE_USD_M=0.006
IA_PRECIO_SALIDA_USD_M=1.20
IA_MONTO_MAXIMO=20000            # soles
WHISPER_BIN=                     # ruta a whisper.cpp; vacío = voz desactivada
WHISPER_MODELO=                  # ruta al modelo ggml small
FFMPEG_BIN=ffmpeg
WEB_HOST=0.0.0.0
WEB_PUERTO=3000
WEB_URL_PUBLICA=http://192.168.1.X:3000
```

Nota para el usuario: los mensajes, fotos y datos que lee la IA se procesan en servidores de DeepSeek. Para cambiar de proveedor basta con otra implementación de `ProveedorIA`.

## 11. Pruebas

| Nivel | Cobertura |
|-------|-----------|
| Cálculos | Semáforo en los bordes (89.9 %, 90 %, 100 %, 100.01 %, presupuesto 0), liquidación positiva y negativa, ganancia con guía sin facturar, promedio con menos de 5 viajes, redondeo en céntimos |
| Núcleo viajes | Un solo viaje en curso por vehículo, enlace automático de la guía al viaje en curso, cierre y reapertura, auditoría de ediciones |
| Lecturas | Con `IA_PROVEEDOR=simulado`: cada tipo de lectura → confirmar crea el registro correcto; corregir agrega la corrección y vuelve a leer; descartar; doble confirmación; IA caída → pendiente → reintento → por_confirmar; 401 no reintenta; JSON inválido → no_entendi |
| Bot | Conversaciones simuladas (transformer de grammY): foto de boleta → resumen → ✅; "eran 305" → resumen nuevo; `/invitar` + código → segundo usuario; `/saldo`; "salgo a Puno, me dieron 1300" → viaje; "ya llegué" → liquidación → cerrar; mensaje dentro de una conversación del Plan 2 no pasa por la IA |
| Web | `app.request()` de Hono: sin sesión redirige; enlace de un solo uso; POST con `Origin` distinto → 403; editar gasto recalcula; un archivo de otro id no se filtra; Excel descargable y con montos numéricos |
| IA real (manual, con permiso del usuario) | Set de fotos de boletas y audios de muestra en `referencias/muestras/gastos/` (git-ignorado) con `.esperado.json`. Informe de campos acertados y costo total |

## 12. Criterios de éxito

1. El chofer manda la foto de una boleta de grifo y en menos de 15 s recibe el resumen correcto (categoría, monto, grifo); con un toque queda en el viaje en curso.
2. "Salgo a Puno, me dieron 1300" crea el viaje con el presupuesto de la plantilla; "ya llegué" muestra la liquidación correcta.
3. Una nota de voz "compré una llanta a 480" se registra como reparación de S/ 480 tras confirmar.
4. En la web, el detalle del viaje muestra el semáforo, la liquidación y la ganancia correctos, y corregir un gasto los recalcula.
5. Si DeepSeek no está disponible no se pierde ningún mensaje, y se leen solos al volver.
6. El costo de IA del mes es visible y se mantiene por debajo de US$ 2 con ~400 mensajes.

## 13. Fuera de alcance

Formularios de alta en la web, roles y permisos, rendimiento km/galón (requiere odómetro confiable), crédito fiscal del IGV de los gastos, gastos fijos mensuales (SOAT, seguros, sueldos), presupuesto mensual de la empresa, cotizaciones a clientes, acceso a la web desde fuera de la red local (VPS o túnel), WhatsApp, modo offline de la web, varias guías por factura, fotos de facturas de proveedores como documentos contables.

## 14. División en planes

- **Plan 3:** `packages/ia`, `core/lecturas`, `core/viajes` (sin estadísticas), migraciones, flujo de lectura en el bot, `/invitar` `/saldo` `/viaje` `/cerrar`, reintentos en la tarea de fondo.
- **Plan 4:** `apps/web` completa, `core/viajes/estadisticas.ts`, `/web` y sesiones, Excel, `pnpm app` como proceso único.
