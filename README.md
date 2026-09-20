# SUNATAPP

App para empresa de transporte: guía de remisión transportista, factura del flete y cobros, conectada a SUNAT.

## Requisitos
Node 24+, pnpm 9.

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
pnpm bot                  # arranca el bot
```
La primera vez el bot imprime en consola un `Código de registro: 123456`. Envíaselo por Telegram
desde tu cuenta: quedas como dueño y a partir de ahí solo te responde a ti. El código vale una vez.

### Comandos
- Envía el PDF de la guía del remitente y el bot arma la guía de transportista.
- `/guias` — últimas guías · `/pendientes` — guías por terminar
- `/facturar V001-1` — facturar el flete de una guía
- `/cobros` — facturas por cobrar · `/pagado F001-1 [monto]` — registrar un cobro
- `/cancelar` — cancelar lo que se esté haciendo · `/ayuda`

Además, sin que se lo pidas: reintenta cada minuto lo que quedó a medias con SUNAT (y te avisa del
desenlace) y a la hora de `BOT_HORA_AVISO` te manda lo vencido y lo que vence hoy.

### Prueba manual
Con `SUNAT_MODO=simulado`: envíale el PDF de una guía real del remitente → confirma el borrador →
recibes la GRE-T simulada en PDF → responde "Sí" a facturar el flete → emite la factura →
comprueba con `/cobros` que aparece por cobrar.

## Documentación
- Diseño: `docs/superpowers/specs/2026-09-13-mvp-gre-transportista-design.md`
- Planes: `docs/superpowers/plans/`
