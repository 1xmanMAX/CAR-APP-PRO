# SUNATAPP · Control Flota

App para empresa de transporte: control de flota (desgaste de cada parte de cada trailer con modelo 3D,
inventario, reparaciones, viajes, finanzas y rentabilidad), guía de remisión transportista, factura
del flete y cobros conectados a SUNAT, y un bot de Telegram para registrar todo desde el celular.

## Arranque rápido
```bash
pnpm install
cp .env.example .env      # completa EMPRESA_*, VEHICULO_*, CONDUCTOR_*, USUARIO_*
pnpm sembrar              # datos iniciales (una sola vez)
pnpm app                  # bot + web + tareas de fondo en un solo proceso
```
Abre `http://localhost:3000`: la primera vez te pide crear el acceso del dueño (correo y contraseña).
Sin `TELEGRAM_BOT_TOKEN`, `pnpm app` arranca solo la web; al poner el token y reiniciar se activa el bot.

### Probar con datos de ejemplo
```bash
pnpm demo:flota                                            # crea ./data-demo (5 trailers, 4 meses de viajes…)
DATA_DIR=./data-demo STORAGE_DIR=./data-demo/storage pnpm web
```
Entra con `demo@flota.pe` / `demo1234` (también `contador@flota.pe` y `taller@flota.pe` para ver los roles).

## Web · pantallas
01 Dashboard · 02 Trailer 3D (nube de puntos con Three.js; clic en una zona para ver su parte) · 03 Flota ·
04 Inventario · 05 Reparaciones (el cambio reinicia el contador, descuenta stock, crea el gasto y avisa por
Telegram) · 06 Viajes, guías, facturas y cobros · 07 Finanzas (flujo de caja, préstamos, reinversiones) ·
08 Rentabilidad (cotizador de flete con PDF, proyección a 6 meses, presupuesto vs real) · 09 Telegram · Ajustes
(usuarios y roles, catálogo de partes con su vida útil).

**Desgaste:** cada parte controlada lleva tres contadores (km, viajes y días desde su instalación); manda el
que se cumple primero. OK < 70 % · PRÓXIMO 70–89 % · CAMBIAR ≥ 90 %. Al cruzar 70 % y 90 % el bot avisa una
sola vez. Los valores de vida útil iniciales son de ejemplo: ajústalos en Ajustes.

**Roles:** dueño (todo), contador (viajes, facturas, finanzas, rentabilidad), taller (trailer 3D, flota,
inventario, reparaciones), chofer (solo Telegram).

Diseño de referencia: `DSISEÑO DE LA APP/HANDOFF.md`.

## Sincronización sin servidor (PC y celulares)

Cada dispositivo tiene su propia base (PGlite) y funciona sin conexión. La pantalla **Sincronizar**
junta los cambios entre dispositivos del mismo grupo por la red local (diseño portado de PixPin:
`packages/core/src/sincro/`):

- Cada fila lleva `sinc_uid` (código único), `sinc_disp`+`sinc_num` (dispositivo de origen y su
  correlativo) y `sinc_creado`/`sinc_tocado` (horas); los disparadores de la migración 0008 los
  ponen solos y dejan lápidas de lo borrado.
- Descubrimiento por difusión UDP (47475), sincronización por TCP (47474) cifrada con AES-256-GCM
  (clave derivada del código del grupo). Solo viajan las filas que cambiaron desde la última vez
  con ese dispositivo; los choques se juntan campo por campo (gana el más reciente).
- `/empezar`: en un dispositivo nuevo, unirse al grupo y traerse todo sin crear otro dueño.

## Arranque común (PC y Android)

`apps/bot/src/arranque.ts` levanta todo en ambos: web, sincronización, tareas de fondo (reintentos
SUNAT, alertas, cola de avisos, aviso diario) y el bot de Telegram si hay token. `pnpm app` lo usa
en la PC (`main.ts`) y la app de Android en el celular (`movil.ts`). Los ajustes del dispositivo
(bot y SUNAT) van en **Ajustes → Este dispositivo**, que escribe el `.env` de ese dispositivo y lo
aplica sin reiniciar.

**Entrada directa (mientras la app está en desarrollo, `ENTRADA_DIRECTA=1` por defecto):** quien
abre la app en el mismo equipo (la app de Android, o `http://localhost` en la PC) entra como dueño
sin formulario ni contraseña; en un dispositivo vacío se crea el dueño «Jefe». Los datos de la
empresa se piden recién al emitir la primera guía o factura y se guardan en **Ajustes → Empresa**.
Desde otro equipo de la red se sigue pidiendo correo y contraseña. Con `ENTRADA_DIRECTA=0` vuelve la
configuración inicial completa (`/configurar`) y el login.

## App de Android (sin servidor)

`android/` es una app Kotlin con Node.js dentro (Node LTS de Termux, con ICU completo: fechas,
monedas y textos iguales que en la PC; va como `libnode.so` y la app lo ejecuta) que corre la misma
app web en `127.0.0.1:3939`:

```bash
node scripts/preparar-android.mjs      # baja Node de Termux (necesita ar, tar y readelf) y empaqueta la app
cd android && gradle assembleRelease    # -Pabis=x86_64 para el emulador
```

## Requisitos
Node 22+ (LTS), pnpm 9.

## Uso local
```bash
pnpm install
cp .env.example .env      # SUNAT_MODO=simulado por defecto
pnpm test                 # todas las pruebas
pnpm demo                 # flujo completo: guía → factura → cobro (archivos en storage/)
```

## Modos SUNAT
- `simulado`: nada sale a internet; PDFs marcados "DOCUMENTO SIMULADO".
- `beta`: guías simuladas; facturas al ambiente beta oficial de SUNAT.
- `real`: requiere certificado `.pfx`, usuario SOL secundario y credenciales API SUNAT (ver spec, sección 13).

## Bot de Telegram
El bot es la forma de usar la app en el día a día: le mandas por chat el PDF de la guía del
remitente y él emite la guía de transportista, factura el flete y lleva los cobros. Solo atiende a
su dueño (una persona).

### Requisitos
Los de arriba (Node 24+, pnpm 9) y un bot propio creado con
[@BotFather](https://t.me/BotFather), que te da el token.

### Variables (`.env`)
| Variable | Ejemplo | Para qué |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `123456:AA…` | Token del bot. Obligatorio; nunca se escribe en el código ni en los logs. |
| `EXTRACTOR` | `reglas` | Lector del PDF del remitente. Hoy solo `reglas` (por defecto); `ia` está reservado y **todavía no está disponible**: el bot no arranca si lo pones. |
| `BOT_HORA_AVISO` | `08:00` | Hora de Lima del aviso diario de cobros. |
| `LOG_DIR` | `./logs` | Carpeta del `bot.log` (una línea JSON por evento). |

### Arranque
Antes de sembrar hay que completar en `.env` las variables `EMPRESA_*`, `VEHICULO_*`,
`CONDUCTOR_*` y `USUARIO_*` (ver `.env.example`): `pnpm sembrar` las carga una sola vez y falla
diciendo cuáles faltan. `VEHICULO_PLACA_SECUNDARIA` es opcional pero conviene ponerla: es la
carreta de la unidad habitual, y sin ella el bot pregunta por la placa secundaria en cada guía.

```bash
pnpm sembrar              # empresa, vehículo(s), conductor y usuario (una sola vez)
pnpm bot                  # arranca solo el bot (pnpm app = bot + web)
```
La primera vez el bot imprime en consola un `Código de registro: 123456`. Envíaselo por Telegram
desde tu cuenta: quedas como dueño y a partir de ahí solo te responde a ti. El código vale una vez.

### Comandos de flota
- `/viaje` — sale una unidad (botones T-01…; luego "Juliaca → Arequipa · 30 ton")
- `/fin [odómetro o km]` — llegó; suma los km a todas sus partes
- `/gasto combustible 480 [detalle]` — gasto; manda la foto del voucher con el comando como pie de foto
- `/km 412380 [T-01]` — lectura de odómetro · `/estado [T-01]` — próximas partes a cambiar
- `/cambio` — cambio de parte guiado · `/compra REP-014 6 180` — compra de repuesto
- `/web` — enlace de un solo uso para entrar a la web · `/grupo` (en el grupo del equipo) — recibir ahí las alertas
- Un chofer nuevo escribe `/start` y el bot le dice su ID; el dueño lo registra en Ajustes.

### Comandos de documentos
- Envía el PDF de la guía del remitente y el bot arma la guía de transportista.
- `/guias` — últimas guías · `/pendientes` — guías por terminar
- `/facturar V001-1` — facturar el flete de una guía
- `/cobros` — facturas por cobrar · `/pagado F001-1 [monto]` — registrar un cobro
- `/cancelar` — cancelar lo que se esté haciendo · `/ayuda`

Además, sin que se lo pidas: reintenta cada minuto lo que quedó a medias con SUNAT (y te avisa del
desenlace) y a la hora de `BOT_HORA_AVISO` te manda lo vencido y lo que vence hoy.

### Boletas y gastos por Telegram
El chofer manda la **foto de la boleta**, un **texto** («grifo 350», «peaje 28.50», «me yapearon 500») o una
**nota de voz**. El bot responde con lo que entendió (categoría, monto, proveedor, comprobante, fecha) y
tres botones: **✅ Correcto** (se guarda como gasto de la unidad y de su viaje en curso, o como dinero
entregado para el viaje), **✏️ Corregir** («eran 305», «era peaje») y **❌ Descartar**. Nada se guarda sin ✅.

- Sin clave de IA funciona el lector por reglas: entiende los textos y las fotos se completan con botones
  (categoría y monto). La foto queda guardada con el gasto.
- Con una clave de [DeepSeek](https://platform.deepseek.com) (Ajustes → Este dispositivo) también lee las
  fotos. Cada lectura anota tokens y costo (menos de un centavo de dólar por boleta).
- Si la IA no responde, el mensaje queda en cola, se reintenta (1, 5, 15 y 60 min) y el bot avisa.
- Notas de voz: solo en la PC con whisper.cpp y ffmpeg (`WHISPER_BIN`, `WHISPER_MODELO`); sin ellos el bot
  pide que lo escriban.

### Prueba manual
Con `SUNAT_MODO=simulado`: envíale el PDF de una guía real del remitente → confirma el borrador →
recibes la GRE-T simulada en PDF → responde "Sí" a facturar el flete → emite la factura →
comprueba con `/cobros` que aparece por cobrar.

## Documentación
- Diseño: `docs/superpowers/specs/2026-09-13-mvp-gre-transportista-design.md`
- Planes: `docs/superpowers/plans/`
