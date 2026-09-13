# SUNATAPP — Plan 2: Bot de Telegram + lector de guías

- **Fecha:** 2026-09-13
- **Estado:** Diseño aprobado por partes en conversación; pendiente revisión del documento.
- **Depende de:** Plan 1 (núcleo) fusionado en `main` (76df174). Spec base: `2026-09-13-mvp-gre-transportista-design.md` (sus §4 y §6 siguen vigentes salvo lo que este documento cambie).

---

## 1. Objetivo

Que el dueño envíe por Telegram el PDF de una Guía de Remisión Remitente (GRE-R) y reciba la Guía de Remisión Transportista (GRE-T) emitida, luego facture el flete y controle cobros, todo desde el chat, con SUNAT en modo simulado.

## 2. Decisiones tomadas

| Tema | Decisión |
|------|----------|
| Empresa | TRANSPORTE INTERNACIONAL MAIRUMAX S.A.C., RUC 20608650581 |
| Unidad habitual | Tracto **F2F-848** + carreta **V1X-971** |
| Conductor habitual | MARIO MAMANI MAMANI, DNI 01320429, licencia U01320429 |
| Lectura de la guía | **Lector por reglas, sin IA**, sobre el texto del PDF. Interfaz `ProveedorExtraccion` lista para un lector con IA (`EXTRACTOR=reglas\|ia`) |
| Fotos | No soportadas en este plan (se piden PDF o datos escritos) |
| Vehículo y conductor | **Se toman de la guía y se comparan contra lo registrado**; si difieren se pregunta; si el RUC del transportista no es el de la empresa se detiene |
| Dueño del bot | El primero que envía el **código de registro** de 6 dígitos que el bot muestra en consola al arrancar sin dueño |
| Token | `TELEGRAM_BOT_TOKEN` solo en `.env` (git-ignorado). Recomendación: revocar y regenerar el token pegado en el chat |
| Ejecución | Un proceso local `pnpm bot` (grammY, long polling) con la tarea de fondo y el aviso diario |
| Base de datos | PGlite dentro del proceso del bot (un solo proceso). Compartirla con la web es tema del Plan 3 |

## 3. Arquitectura

```
apps/bot/
  src/main.ts              arranque: config, contexto core, bot, tarea de fondo, aviso diario
  src/registro.ts          código de registro y autorización del dueño
  src/flujo-guia.ts        PDF → lectura → preguntas → resumen → emitir
  src/flujo-factura.ts     monto → cliente → pago → resumen → emitir
  src/comandos.ts          /cobros /pagado /facturar /guias /pendientes /cancelar /ayuda
  src/fondo.ts             procesarPendientesGuias/Facturas cada minuto + notificación
  src/aviso-diario.ts      08:00 America/Lima
  src/textos.ts            mensajes en español (un solo lugar)
  src/log.ts               logger a logs/bot.log
packages/extractor/
  src/tipos.ts             GuiaExtraida, Campo<T> {valor, confianza}, ProveedorExtraccion
  src/texto-pdf.ts         PDF → texto (unpdf)
  src/lector-reglas.ts     reglas por forma de dato (ver §5)
  src/index.ts             crearExtractor(config, validadores)
```

Reglas de dependencia: `apps/bot` usa `@sunatapp/core` y `@sunatapp/extractor`. `extractor` no conoce la BD ni SUNAT y no importa `core`: recibe por inyección las funciones `validarRuc` y `obtenerUbigeo` en `crearExtractor`, evitando dependencias circulares.

## 4. Cambios al núcleo (primer bloque del plan)

1. **Vehículo secundario.**
   - BD: `guia_transportista.vehiculo_secundario_id` (nullable, FK `vehiculo`); `vehiculo` admite varias filas (tracto y carreta).
   - `DatosGreTransportista.vehiculo` pasa a `{ placa: string; placasSecundarias: string[] }`.
   - XML: `cac:TransportHandlingUnit/cac:TransportEquipment/cac:AttachedTransportEquipment/cbc:ID` por cada placa secundaria (referencias: greenter `despatch2022.xml.twig`, GasperSoft `GuiaRemision.cs`). Debe seguir pasando el XSD.
   - PDF: "Placas: F2F-848 / V1X-971".
2. **Arreglos pendientes del Plan 1:**
   - Guía aceptada cuyo CDR/PDF falla tras el claim: persistir `rutaCdr` y `urlQr` antes del PDF; `generarPdfGuiaSiFalta` + barrido de fondo para `aceptada AND ruta_pdf IS NULL`.
   - Reemisión desde `rechazada`: limpiar `rutaXml` en la reserva cuando la fecha es nueva (guías y facturas).
3. **Idempotencia por documento recibido.** `documento_recibido.hash_sha256` único. `registrarDocumentoRecibido(ctx, archivo)` devuelve el existente si el hash ya está; `registrarGuiaBorrador` no crea un segundo borrador para el mismo `documentoRecibidoId` (índice único) y devuelve la guía existente.
4. **Transporte en la entrada de guía.** `EntradaGuia` añade `transporte: { rucTransportista: string; placaPrincipal: string; placasSecundarias: string[]; conductor: { numeroDoc: string; nombres: string; apellidos: string; licencia: string } }`. `registrarGuiaBorrador` usa esas placas y ese conductor (debiendo existir registrados; el bot los registra antes si el usuario lo aprueba) en lugar de "el primero activo".
5. **Comparación con lo registrado.** `compararTransporte(ctx, transporte)` devuelve `{ rucEmpresaCoincide: boolean; placaPrincipal: 'registrada' | 'nueva'; placasSecundarias: Array<{ placa: string; estado: 'registrada' | 'nueva' }>; conductor: 'registrado' | 'nuevo' }`. Además `registrarVehiculo(ctx, placa)` y `registrarConductor(ctx, datos)`.
6. **Utilidades para el bot:**
   - `listarGuias(ctx, limite)`.
   - `listarBorradores(ctx)`.
   - `buscarGuiaPorSerieNumero(ctx, texto)`.
   - `registrarUsuarioTelegram(ctx, telegramId)`: asigna el ID al usuario sembrado sin `telegramId`; si ya hay dueño, rechaza.
   - `usuarioPorTelegram(ctx, telegramId)`.
7. **Hook de log.** `Contexto.log?: (nivel: 'info' | 'error', mensaje: string, detalle?: unknown) => void`. Los `catch` silenciosos de `procesarPendientes*` lo llaman.

## 5. Lector por reglas

**Entrada:** buffer PDF. **Salida:** `GuiaExtraida` con cada campo como `{ valor: T | null; confianza: 'segura' | 'dudosa' }`.

Texto: `unpdf` (`extractText` con `mergePages`). Verificado con la muestra real TTT4-202: el texto sale completo pero con etiquetas y valores en bloques separados, por lo que las reglas se basan en la **forma del dato** y usan etiquetas solo para desempatar.

| Campo | Regla | Segura cuando |
|-------|-------|---------------|
| Serie-número GRE-R | `([A-Z0-9]{4})\s*-\s*(\d{1,8})` cerca de "REMITENTE"/"GUIA" | Un único candidato |
| Remitente | RUC del bloque de encabezado del emisor | RUC válido en la cabecera |
| Destinatario | RUC + denominación tras "DESTINATARIO" | Encontrado |
| Transportista | RUC válido seguido de razón social | Asociado a "TRANSPORTISTA" |
| Partida / llegada | Líneas `\d{6}\s+texto` cuyo código existe en el catálogo INEI; primera = partida, segunda = llegada | Exactamente dos candidatos |
| Fecha inicio de traslado | `d{1,2}/mm/aaaa` asociada a "INICIO DE TRASLADO", o la única fecha | Única o asociación clara |
| Peso bruto | número seguido de `KGM` o `TNE` (la unidad junto al número manda sobre la etiqueta) | Un único candidato |
| Placas | Patrón de placa `[A-Z0-9]{3}-?[A-Z0-9]{3}` excluyendo series de documentos; primera principal, resto secundarias | Aparecen juntas separadas por " - " o tras "VEHÍCULO" |
| Conductor | DNI de 8 dígitos + nombre; licencia `[A-Z]\d{8}` | DNI y licencia encontrados |
| Bienes | Filas `ítem código descripción unidad cantidad`; unidades frecuentes del catálogo 03 (BLS, NIU, KGM, TNE, BX, ZZ, MTR, LTR, GLN; UND→NIU) | Cantidad numérica y unidad reconocida |
| Documentos relacionados | `FACTURA\s+([A-Z0-9]{4}-\d+)` en observaciones | Informativo |

Nunca inventa: sin candidato → `null`. Varios candidatos sin desempate → `dudosa` con el primero.

```ts
interface ProveedorExtraccion {
  nombre: string;
  extraer(archivo: { contenido: Buffer; mime: string }): Promise<GuiaExtraida>;
}
```

## 6. Conversación del bot

### 6.1 Registro del dueño
- Al arrancar, si ningún usuario tiene `telegram_id`, genera un código aleatorio de 6 dígitos y lo muestra en consola.
- El primer mensaje con exactamente ese código registra su `telegram_id` en el usuario sembrado y responde *"✅ Listo. Solo te atenderé a ti."* El código deja de valer.
- Mensajes de otros IDs se ignoran y se auditan (`telegram_desconocido`). Sin usuario sembrado, el bot no arranca y pide ejecutar `pnpm sembrar`.

### 6.2 Flujo guía
1. Recibe documento `application/pdf` (≤ 20 MB). Foto → mensaje "solo PDF por ahora".
2. Guarda en `storage/recibidos/<hash>.pdf` y registra `documento_recibido` (idempotente). Si ya tiene guía → *"Esta guía ya la registré como V001-n"* con su estado.
3. Lee con el extractor y guarda `datos_extraidos` y `confianza`.
4. Valida con `validarEntradaGuia`. Por cada campo `null`, `dudosa` o inválido pregunta de uno en uno (botones cuando hay opciones; ubigeo por nombre de distrito → botones con `buscarUbigeos`).
5. `compararTransporte`: RUC distinto → se detiene con mensaje; placa o conductor nuevos → pregunta registrarlos o usar los habituales.
6. Resumen con `[✅ Emitir] [✏️ Corregir] [❌ Cancelar]`. Corregir lista campos numerados; tras editar vuelve al resumen. Las correcciones se guardan junto a lo extraído.
7. Emitir: `registrarGuiaBorrador` + `emitirGuia` **sin bloquear el manejador** (tarea en segundo plano; responde "📤 Enviando a SUNAT…"). Al terminar notifica aceptada (con PDF), rechazada (mensaje + `[✏️ Corregir y reenviar]`) o pendiente (reintento automático).

### 6.3 Flujo factura
Tras guía aceptada: `[Sí] [Después]` → monto (acepta "2500", "2,500.50") → `[Incluye IGV] [Más IGV]` → cliente `[Remitente] [Otro RUC]` → pago `[Contado] [Crédito 15] [Crédito 30] [Otro plazo]` → resumen (subtotal, IGV, total, detracción, neto) → `[✅ Emitir]` → `prepararFactura` + `emitirFactura` en segundo plano → PDF.

### 6.4 Comandos
`/start`, `/cobros`, `/pagado <factura> [monto]`, `/facturar <guía>`, `/guias`, `/pendientes`, `/cancelar`, `/ayuda`.

### 6.5 Tareas automáticas
- Cada 60 s: `procesarPendientesGuias`, `procesarPendientesFacturas` y barrido de PDFs faltantes; cada cambio de estado se notifica al dueño (con PDF si corresponde). Nunca se solapan dos pasadas.
- 08:00 America/Lima (`BOT_HORA_AVISO`): resumen de `listarCobrosPendientes` con "vencen hoy" y "vencidas"; sin nada, no escribe.

### 6.6 Estado de conversación
En memoria por chat (sesión grammY). Borradores y documentos viven en BD: un reinicio no pierde trabajo y `/pendientes` retoma.

## 7. Errores

| Situación | Comportamiento |
|-----------|----------------|
| PDF sin texto / ilegible | Mensaje pidiendo el PDF original o los datos escritos |
| Archivo > 20 MB | Mensaje explicando el límite de Telegram |
| Error de red con Telegram | grammY reintenta; la tarea de fondo continúa |
| Error inesperado en un manejador | Respuesta genérica en español + detalle en `logs/bot.log`; el bot sigue |
| Reinicio | Pendientes retomados desde BD |
| Desconocido | Ignorado + auditoría |

## 8. Configuración (.env)

```
TELEGRAM_BOT_TOKEN=
EXTRACTOR=reglas            # reglas | ia (ia fuera de alcance; interfaz lista)
BOT_HORA_AVISO=08:00
LOG_DIR=./logs
```
Más las variables del Plan 1. Datos pendientes del usuario: dirección fiscal y distrito de la empresa, registro MTC, cuenta de detracciones del Banco de la Nación, nombre y correo del usuario.

## 9. Pruebas

| Nivel | Cobertura |
|-------|-----------|
| Núcleo | XML con carreta pasa XSD; PDF muestra placas; `compararTransporte`; idempotencia por hash; los 2 arreglos pendientes con regresión; `registrarUsuarioTelegram` |
| Lector | Fixture de texto con **datos inventados** que reproduce el desorden de la muestra real (en git). Pruebas locales sobre `referencias/muestras/*.pdf` con `.esperado.json` al lado; se omiten si no hay muestras; reportan campos acertados |
| Bot | Conversaciones con la API de Telegram simulada (transformer de grammY que intercepta llamadas): registro con código, desconocido ignorado, flujo guía completo, campo dudoso, transporte distinto, corregir, rechazo SUNAT, factura completa, `/cobros`, `/pagado`, `/pendientes` tras reinicio |
| Manual | Bot real en Telegram, modo simulado, con la guía TTT4-202 |

## 10. Criterios de éxito

1. Enviar TTT4-202 al bot y recibir la GRE-T simulada con tracto y carreta en menos de 1 minuto, con 0 preguntas si todo coincide con lo registrado.
2. Facturar ese flete desde el chat y verlo en `/cobros`.
3. Un desconocido no puede usar el bot.
4. Reenviar el mismo PDF no crea una segunda guía.
5. Cambiar `EXTRACTOR` no requiere tocar el bot.

## 11. Fuera de alcance

Web (Plan 3), WhatsApp, lector con IA (solo interfaz), fotos, varias guías por factura, modo SUNAT real (requiere además los arreglos de credenciales y "ya registrado"), multiusuario.
