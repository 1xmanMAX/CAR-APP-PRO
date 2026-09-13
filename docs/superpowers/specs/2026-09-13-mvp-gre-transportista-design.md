# SUNATAPP — MVP: Guía Transportista + Factura + Cobros vía Telegram

- **Fecha:** 2026-09-13
- **Estado:** Diseño aprobado por partes en conversación; pendiente revisión del documento.
- **Alcance:** Fase 1 (base + emisión SUNAT) y Fase 2 (agente Telegram) de la visión completa, recortadas a un MVP.

---

## 1. Contexto y objetivo

Empresa de transporte de carga en Perú. Hoy emite todo manualmente en el portal SOL de SUNAT. El trabajo más repetitivo es: recibir la **Guía de Remisión Remitente** (GRE-R, tipo 09) del cliente y emitir la **Guía de Remisión Transportista** (GRE-T, tipo 31), y luego facturar el flete.

**Objetivo del MVP:** enviar por Telegram la guía del remitente (PDF o foto) y recibir de vuelta la GRE-T emitida, luego facturar el flete desde el mismo chat y hacer seguimiento de cobros. Versión preliminar para validar el flujo y mejorar después.

### Visión completa (fuera de este MVP, cada una tendrá su propio spec)

| # | Módulo | Depende de |
|---|--------|------------|
| 1 | Base + emisión SUNAT | — |
| 2 | Agente Telegram (luego WhatsApp) | 1 |
| 3 | Cobranzas | 1 |
| 4 | Caja y bancos (ingresos, gastos, conciliación) | 3 |
| 5 | Flota y mantenimiento (historial, presupuestos, próximos arreglos) | 1 |
| 6 | GPS (integración con proveedores, mapa) | 5 |
| 7 | Reportes financieros y gráficos | 3, 4, 5 |

## 2. Decisiones tomadas

| Tema | Decisión |
|------|----------|
| Canal SUNAT | **Directo, SEE del Contribuyente** (sin PSE/OSE). GRE por API REST; factura por SOAP |
| Canal del agente | **Telegram** (WhatsApp en fase posterior) |
| Usuarios | Pocas personas de confianza, **todos con acceso total** (sin roles) |
| Flota en MVP | **1 vehículo y 1 conductor**, configurados; el bot no pregunta por ellos |
| Alcance MVP | GRE-T + factura del flete + control de cobros |
| Credenciales SUNAT | **No se tienen aún** → se construye con **SUNAT simulado** |
| Presupuesto nube | Mínimo (≈ USD 5–10/mes) → VPS pequeño con Docker **en el futuro** |
| Entorno | **Desarrollo 100 % local** primero; despliegue a servidor cuando esté lista |
| Lenguaje / stack | TypeScript, monorepo pnpm, Next.js, grammY, Drizzle, PGlite (local) / PostgreSQL (servidor) |
| IA de lectura | Claude (visión + texto) detrás de una interfaz intercambiable |
| Relación factura–guía | **1 factura por guía** en MVP; modelo preparado para N guías por factura |
| Cliente a facturar | Por defecto el **remitente**, editable en el resumen |

Entorno local verificado: Node 24, pnpm 9, git 2.43. Docker **no** instalado (por eso PGlite en local).

## 3. Arquitectura

```
sunatapp/
├─ apps/
│  ├─ web/        Next.js: panel (guías, facturas, cobros, configuración)
│  └─ bot/        grammY: bot de Telegram (long polling en local)
├─ packages/
│  ├─ db/         Esquema y acceso a datos (Drizzle; PGlite local, Postgres servidor)
│  ├─ core/       Casos de uso: procesarGuiaRecibida, emitirGuia, facturarGuia, registrarCobro
│  ├─ sunat/      UBL 2.1 (GRE-T 31, factura 01), firma XAdES, envío, lectura CDR; modos simulado/real
│  ├─ extractor/  GRE-R (PDF/foto) → datos estructurados + nivel de confianza
│  └─ pdf/        Representación impresa de GRE-T y factura con QR
├─ storage/       XML, CDR, PDF y archivos recibidos (local; fuera de git)
└─ referencias/   Repos open source clonados, solo consulta (fuera de git)
```

**Reglas de dependencia**
- `apps/web` y `apps/bot` solo llaman a `core`. Nunca a `sunat` o `db` directamente.
- `core` orquesta `db`, `sunat`, `extractor`, `pdf`.
- `sunat`, `extractor` y `pdf` no conocen la base de datos; reciben y devuelven datos planos.
- Cambiar SUNAT simulado ↔ real = variable `SUNAT_MODO=simulado|real` + certificado. Sin cambios de código.
- Local: `apps/web` y `apps/bot` corren como procesos separados. PGlite solo admite un proceso a la vez sobre el mismo directorio, así que en local la base se expone con `@electric-sql/pglite-socket` (servidor PGlite en un proceso, ambos apps conectan como a Postgres). En servidor: PostgreSQL normal.

## 4. Flujo del bot

**Autorización:** el bot solo atiende a IDs de Telegram registrados en `usuario`. Mensajes de otros se ignoran (y se registran en auditoría).

### 4.1 Flujo A — GRE-R → GRE-T
1. Usuario envía PDF o foto.
2. Bot responde "📄 Leyendo guía…". `extractor` obtiene:
   - serie-número GRE-R, fecha de inicio de traslado
   - remitente y destinatario (RUC/DNI, razón social)
   - punto de partida y llegada (dirección + ubigeo)
   - bienes (descripción, cantidad, unidad de medida), peso bruto total y unidad
3. Validación: RUC (dígito verificador módulo 11), DNI (8 dígitos), ubigeo existente en catálogo INEI, peso > 0, fecha válida. Campos faltantes o con baja confianza → el bot pregunta **solo** por esos campos, uno a la vez.
4. Resumen con vehículo y conductor configurados + botones `[✅ Emitir] [✏️ Corregir] [❌ Cancelar]`.
   - *Corregir*: el bot lista los campos numerados; el usuario elige uno y escribe el nuevo valor.
5. *Emitir*: `core` asigna correlativo, genera XML, firma, envía, consulta ticket.
   - Aceptada → envía PDF de GRE-T.
   - Rechazada → código + mensaje de SUNAT en lenguaje simple; el borrador queda guardado para corregir.

### 4.2 Flujo B — Factura del flete
6. Tras GRE-T aceptada: "¿Facturar este flete?" `[Sí] [Después]`. *Después* deja la guía como "sin facturar" (visible en web; comando `/facturar V001-00000001` la retoma).
7. Datos: monto (con/sin IGV), cliente (por defecto remitente), contado o crédito (días).
8. Resumen: subtotal, IGV 18 %, total. Si total > S/ 400 → **detracción 4 %** (servicio de transporte de bienes por vía terrestre), con leyenda y cuenta del Banco de la Nación de la empresa. Porcentaje y umbral configurables (no fijos en código).
9. `[✅ Emitir]` → PDF de factura, enlazada a la guía.

### 4.3 Flujo C — Cobros
10. Toda factura nace con estado de cobro `pendiente` y fecha de vencimiento (contado = fecha de emisión).
11. `/cobros` → pendientes y vencidas con totales. `/pagado F001-00000045 [monto]` → registra cobro (saldo total por defecto; parcial si se indica monto).
12. Aviso diario (08:00 hora Lima) de facturas que vencen hoy o están vencidas. Sin pendientes → no envía nada.

### 4.4 Comandos
`/start`, `/cobros`, `/pagado <factura> [monto]`, `/facturar <guía>`, `/cancelar` (aborta la conversación en curso), `/ayuda`.

## 5. Modelo de datos

Dinero en **céntimos enteros** (`bigint`). Fechas en UTC; presentación en `America/Lima`.

| Tabla | Campos principales |
|-------|--------------------|
| `empresa` | ruc, razon_social, nombre_comercial, direccion, ubigeo, registro_mtc, cuenta_detraccion_bn, serie_gre (`V001`), serie_factura (`F001`), detraccion_porcentaje, detraccion_umbral |
| `vehiculo` | placa, marca, numero_autorizacion (TUCE/certificado), activo |
| `conductor` | tipo_doc, numero_doc, nombres, apellidos, licencia, activo |
| `usuario` | nombre, email, password_hash, telegram_id, activo |
| `contraparte` | tipo_doc, numero_doc (único), razon_social, direccion, ubigeo |
| `documento_recibido` | usuario_id, telegram_file_id, ruta_archivo, mime, datos_extraidos (jsonb), confianza (jsonb por campo), creado_en |
| `guia_transportista` | serie, numero, fecha_emision, fecha_traslado, remitente_id, destinatario_id, partida_direccion, partida_ubigeo, llegada_direccion, llegada_ubigeo, peso_bruto, unidad_peso, vehiculo_id, conductor_id, gre_remitente_ref, documento_recibido_id, estado, ticket, codigo_respuesta, mensaje_respuesta, ruta_xml, ruta_cdr, ruta_pdf |
| `guia_item` | guia_id, descripcion, cantidad, unidad_medida |
| `factura` | serie, numero, fecha_emision, cliente_id, moneda (`PEN`), subtotal, igv, total, detraccion_porcentaje, detraccion_monto, forma_pago (`contado`/`credito`), fecha_vencimiento, estado_sunat, estado_cobro, codigo_respuesta, mensaje_respuesta, ruta_xml, ruta_cdr, ruta_pdf |
| `factura_guia` | factura_id, guia_id (único en MVP por guía) |
| `cobro` | factura_id, fecha, monto, medio (`transferencia`/`efectivo`/`otro`), nota, usuario_id |
| `correlativo` | tipo_documento, serie, ultimo_numero — incremento atómico en transacción |
| `auditoria` | usuario_id, accion, entidad, entidad_id, detalle (jsonb), creado_en |

**Estados**
- `guia_transportista.estado`: `borrador → pendiente_envio → enviada → aceptada | rechazada`
- `factura.estado_sunat`: `borrador → pendiente_envio → aceptada | observada | rechazada`
- `factura.estado_cobro`: `pendiente → parcial → pagada` (derivado de la suma de `cobro` frente a lo cobrable: total menos detracción)

**Correlativos:** el número se asigna **una sola vez**, al pasar de `borrador` a `pendiente_envio`, dentro de una transacción. Reintentos reutilizan el mismo número.

## 6. Paquete `sunat`

### Interfaz
```ts
interface SunatGateway {
  enviarGuia(doc: XmlFirmado): Promise<{ ticket: string }>;
  consultarTicket(ticket: string): Promise<RespuestaSunat>;   // aceptada | rechazada | en_proceso
  enviarFactura(doc: XmlFirmado): Promise<RespuestaSunat>;    // aceptada | observada | rechazada
}
```
Además: `construirGreTransportista(datos)`, `construirFactura(datos)`, `firmar(xml, certificado)`, `leerCdr(zip)`.

### Modo real
- Firma XMLDSig enveloped con RSA-SHA256 / digest SHA-256 (como el ejemplo GRE-T de GasperSoft), c14n inclusiva.
- GRE: token OAuth2 *password grant* en `api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/` (username = RUC + usuario SOL, password = clave SOL, scope `https://api-cpe.sunat.gob.pe`; cacheado hasta expirar); envío a `api-cpe.sunat.gob.pe/v1/contribuyente/gem/comprobantes/{archivo}` (ZIP base64 + hash); consulta en `.../envios/{ticket}` con backoff (2 s, 4 s, 8 s… hasta 2 min; luego continúa en segundo plano).
- Factura: SOAP `sendBill` con usuario SOL secundario; CDR síncrono.
- Referencias: `referencias/sunat/sunat-cli` (OAuth, GRE REST, SOAP, CDR), `referencias/sunat/fractuyo` (UBL tipo 31 y firma), validación cruzada con `referencias/sunat/GasperSoft.SUNAT` (`Pruebas/GRETransportista1.cs`). **No** copiar código de `odoo18-peru-localization` (AGPL).

### Modo simulado
- Genera y **firma** el XML real con un certificado autofirmado de prueba generado localmente.
- Valida el XML contra los **XSD UBL 2.1** (tomados de `xhandler-java`, Apache-2.0) con `xmllint-wasm`.
- Respuestas simuladas: ticket → `en_proceso` durante ~3 s → `aceptada` con CDR sintético.
- Rechazo forzable para pruebas (variable `SUNAT_SIMULAR_RECHAZO=<codigo>`).
- Modo intermedio `SUNAT_MODO=beta`: guías simuladas, facturas enviadas al **ambiente beta oficial** de SUNAT (usuario `MODDATOS`) para validar reglas de negocio sin certificado real.
- Detracción en factura: tipo de operación `1001`, código de bien/servicio `027` (transporte de carga), leyenda `2006`. Monto redondeado a soles enteros. Confirmar en beta que SUNAT acepta `1001` con `027` (alternativa: `1004`, que exige datos adicionales del viaje).
- GRE: verificar en implementación si existe ambiente beta. Si no existe, la primera emisión real se hace asistida.

### Manejo de fallas
| Situación | Comportamiento |
|-----------|----------------|
| SUNAT caído / sin red | Estado `pendiente_envio`; reintento automático (cada 5 min, hasta 24 h); aviso por Telegram al resolverse |
| Ticket demora | Consulta en segundo plano; envía PDF al completarse |
| Rechazo | Código + mensaje traducido; borrador editable |
| Doble clic / reintento | Idempotente por documento: nunca doble emisión ni doble correlativo |
| Token expirado | Renovación automática y reintento único |

Los reintentos y consultas en segundo plano corren dentro del proceso `apps/bot` (tarea periódica sobre documentos en `pendiente_envio` / `enviada`), por lo que sobreviven reinicios: el estado vive en la base, no en memoria.

### Secretos
Certificado `.pfx`, contraseña, usuario/clave SOL secundario, `client_id`/`client_secret` GRE, token de Telegram y API key de Claude: **solo en variables de entorno / `.env` local**, fuera de git. `.gitignore` excluye `*.pfx`, `*.p12`, `.env*`, `storage/`, `referencias/`. Se incluye `.env.example` sin valores.

## 7. Paquete `extractor`

- Entrada: archivo (PDF o imagen) + mime.
- PDF con texto → extracción de texto primero; imagen o PDF escaneado → visión.
- Llamada a Claude con **salida estructurada** (esquema JSON validado con zod) y confianza por campo.
- Interfaz `ProveedorExtraccion` para poder cambiar de modelo o proveedor.
- Nunca inventa datos: campo no legible → `null` + confianza baja → el bot pregunta.
- Muestras de prueba: 3–5 GRE-R reales en `referencias/muestras/` (fuera de git), provistas por el usuario.

## 8. Paquete `pdf`

Representación impresa de GRE-T y factura: datos del emisor, documento, tabla de bienes/ítems, totales, leyenda de detracción cuando aplica, **código QR** con el formato exigido por SUNAT y hash del XML firmado.

## 9. Web (Next.js, español)

| Pantalla | Contenido |
|----------|-----------|
| Ingreso | Email + contraseña (sesión por cookie httpOnly) |
| Inicio | Tarjetas: guías del mes, facturado del mes, por cobrar, vencido. Lista de próximas por vencer |
| Guías | Lista con estado y filtros (fecha, cliente, estado, "sin facturar"); detalle con descarga PDF/XML/CDR |
| Facturas | Lista con estado SUNAT y cobro; "Registrar cobro" (monto, fecha, medio, nota) |
| Configuración | Empresa, vehículo, conductor, usuarios (con Telegram ID), series, estado de certificado y modo SUNAT |

En el MVP la **emisión** de guías y facturas es solo por el bot. El primer usuario se crea con un script de semilla (`pnpm seed`).

## 10. Pruebas

Herramienta: Vitest.

| Nivel | Cobertura |
|-------|-----------|
| Unitarias | IGV, detracción (umbral y porcentaje), redondeos en céntimos; validación RUC/DNI/ubigeo; correlativos concurrentes sin duplicados |
| XML | GRE-T y factura validan contra XSD oficiales; firma verificable; comparación de nodos con ejemplo GasperSoft |
| Extractor | Set de muestras reales con resultado esperado; métrica de campos correctos (contra API real, ejecución manual/opcional) |
| Integración | Flujo guía → emisión → factura → cobro con PGlite + SUNAT simulado + extractor simulado |
| Bot | Conversaciones simuladas: datos faltantes, corregir, cancelar, rechazo SUNAT, doble clic, usuario no autorizado |
| Manual | Usuario real en Telegram, modo simulado |

## 11. Criterios de éxito del MVP

1. Enviar una GRE-R real al bot y recibir una GRE-T (simulada) en menos de 1 minuto, con a lo sumo 2 preguntas del bot.
2. El XML de GRE-T y factura pasa los XSD oficiales.
3. Facturar el flete desde el chat, con detracción correcta cuando aplica.
4. Ver en la web qué facturas están pendientes/vencidas y registrar un cobro.
5. Pasar a SUNAT real solo configurando certificado y credenciales.

## 12. Fuera de alcance (MVP)

Varios vehículos/conductores, roles y permisos, WhatsApp, emisión desde web, notas de crédito/débito, anulaciones y comunicación de baja, moneda USD, varias guías por factura, caja y bancos, flota y mantenimiento, GPS, reportes avanzados, despliegue a servidor.

## 13. Trámites pendientes del usuario (para modo real)

1. Adquirir **certificado digital** tributario (.pfx) de una entidad acreditada.
2. Alta como emisor en **SEE del Contribuyente** en SOL.
3. Crear **usuario SOL secundario** para envío de comprobantes.
4. Generar **credenciales API SUNAT** (client_id / client_secret) para GRE en SOL.
5. Tener cuenta de **detracciones en Banco de la Nación**.
6. Crear el bot con **@BotFather** (token) y obtener API key de Claude.
