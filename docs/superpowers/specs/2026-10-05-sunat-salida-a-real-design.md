# SUNATAPP — Salida a SUNAT real: factura 1004, conexión segura y "pon tus claves y funciona"

- **Fecha:** 2026-10-05
- **Estado:** Diseño aprobado en conversación; pendiente revisión del documento.
- **Base:** `main` en `ef41d59`. La rama `claude/android-startup-performance-gt4dmk` (v0.3.0-beta.12) no toca SUNAT, pero trae la migración `0012_traccion`, que choca en número con `0012_costos_fijos` de `main`: la migración de este trabajo será la **0013** y el choque se resuelve al unir ramas, fuera de este diseño.

---

## 1. Objetivo

Que el dueño **solo tenga que tramitar sus accesos en SOL y pegarlos en la app** para emitir guías de transportista y facturas del flete con validez ante SUNAT, sin intermediarios (SEE - Del Contribuyente), y que la app no pueda poner en riesgo su usuario SOL.

Hoy la app ya arma, firma y envía la guía (API REST GRE) y la factura (SOAP `billService`), pero solo se ha usado en modo simulado y le faltan piezas para el modo real.

### Principio que manda

**Mínimo de campos** (ver memoria `registro-en-el-momento`): los datos nuevos que exige SUNAT se piden **una sola vez** (por ruta o por vehículo) y luego se calculan solos.

## 2. Hallazgos de la investigación (2026-10-05)

| Tema | Hallazgo | Fuente |
|---|---|---|
| Canal de la guía | Solo API REST GRE; un OSE no puede emitir guías | cpe.sunat.gob.pe/node/116 |
| Ambiente de pruebas de guías | **No hay beta oficial** de GRE | Lista oficial de servicios web (cpe.sunat.gob.pe, 2026-05) |
| Ambiente de pruebas de facturas | `e-beta.sunat.gob.pe` con `MODDATOS` | idem |
| Consulta de CDR de facturas | `e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService` (`getStatusCdr`) | idem |
| Certificado | **CDT gratuito** de SUNAT hasta el 31-12-2027 (empresas que iniciaron en 2020 o después califican); sirve para facturas y guías | cpe.sunat.gob.pe/certificado-digital |
| Alta como emisor | En SOL, subiendo certificado y correo; sin homologación; rige al día siguiente | cpe.sunat.gob.pe/sistema_emision/see_contribuyente |
| Credenciales GRE | SOL → Empresas → Credenciales de API SUNAT → Gestión → aplicación "Desktop" con "GRE Emisión de Comprobantes" | docs de proveedores (Factpro, APISUNAT); no oficial |
| Token GRE | `grant_type=password`, `scope=https://api-cpe.sunat.gob.pe`, usuario `RUC+usuarioSOL`; dura ~1 h | verifac.pe, greenter/gre-api; no oficial |
| Ticket GRE | `codRespuesta` **"98"** en proceso, **"0"** aceptado (CDR en `arcCdr`), **"99"** rechazado | idem; **el código actual espera "0098"/"0001"** |
| Factura con detracción de transporte | Tipo de operación **1004**, no 1001. Exige en cada línea `cac:Delivery` con origen, destino, detalle del viaje y **tres valores referenciales** (ID 01, 02, 03) > 0, o se rechaza (3116–3126) | Reglas de validación SUNAT al 26-08-2026, hoja Factura2_0 |
| No sanción | Errores de GRE-Transportista no se sancionan hasta el **28-02-2027** | El Peruano, RSNATI 000031-2026 |
| No automatizable | Pago de detracciones (solo SOL o Banco de la Nación); GRE por evento (solo SEE-SOL) | orientacion.sunat.gob.pe; cpe.sunat.gob.pe/node/114 |

## 3. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Canal | Directo a SUNAT (SEE - Del Contribuyente), sin OSE/PSE |
| Alcance | Solo guía de transportista y factura del flete. Boletas, notas, bajas, SIRE y consulta RUC quedan fuera |
| Valor referencial | Se guarda **una vez por par origen→destino** (valor por TM de la tabla MTC) y **una vez por vehículo** (configuración vehicular y carga útil nominal); la app calcula los tres valores |
| Base de la detracción | 4 % del **mayor** entre el total de la factura y el valor referencial del servicio (ID 01) |
| Credenciales rechazadas | **Pausa global de envíos** hasta que se cambien los ajustes; nunca reintento automático con una clave mala |
| Activar modo Real | Solo si **Probar conexión** sale bien en los tres puntos |
| Factura automática | Opcional, **apagada por defecto** |

## 4. Arquitectura (qué se toca)

```
packages/sunat/src/
  tipos.ts                 SunatCredencialesError; RespuestaSunat sin cambios; SunatGateway + consultarCdrFactura, probarConexion
  real.ts                  códigos de ticket 98/0/99 (y 0098/0001); clasificación de faults SOAP; getStatusCdr; probarConexion
  simulado.ts, mixto.ts    implementan los métodos nuevos (simulado: respuestas fijas configurables)
  ubl/factura.ts           listID 1004 + cac:Delivery por línea (origen, destino, detalle, VR 01/02/03, Shipment opcional)
  valor-referencial.ts     NUEVO: cálculo puro de VR 01/02/03 y base de detracción
packages/db/
  src/schema.ts            valor_referencial_ruta (tabla); vehiculo.configuracion_vehicular, vehiculo.carga_util_tm;
                           factura: vr_servicio, vr_carga_efectiva, vr_carga_util, detalle_viaje
                           (pausa, primera emisión real y factura automática van en la tabla `ajuste`)
  drizzle/0013_sunat_real.sql
packages/core/src/
  facturas/preparar.ts     calcula VR y detracción sobre el mayor; error de negocio claro si falta el VR de la ruta o los datos del vehículo
  facturas/emitir.ts       en_proceso → pendiente de consulta (no rechazada); 1033 → getStatusCdr; credenciales → pausa
  guias/emitir.ts          credenciales → pausa; respeta la pausa antes de enviar o consultar
  sunat/pausa.ts           NUEVO: pausar, reanudar, consultar estado; se limpia al reconfigurar SUNAT
  sunat/probar.ts          NUEVO: chequeo de certificado, clave SOL y credenciales GRE
  facturas/automatica.ts   NUEVO: decide si una guía aceptada se factura sola
apps/web/src/paginas/
  dispositivo.tsx          botón PROBAR CONEXIÓN, resultado por punto, guía paso a paso SOL, bloqueo de modo Real
  rutas / flota            campos "valor referencial por TM" (ruta) y "configuración / carga útil" (vehículo)
apps/bot/src/
  flujo-factura.ts         pregunta el VR si falta; confirmación extra en la primera emisión real; aviso de pausa
  fondo.ts                 avisa una vez cuando SUNAT entra en pausa
```

## 5. Parte 1 — Factura 1004

### 5.1 XML

Cuando la factura tiene detracción:

- `cbc:InvoiceTypeCode listID="1004"`.
- Leyenda `cbc:Note languageLocaleID="2006"` (ya existe).
- `PaymentMeans` y `PaymentTerms` con ID `Detraccion` y código 027 (ya existen).
- En la `cac:InvoiceLine`, después de `cac:PricingReference` y antes de `cac:TaxTotal`, se agrega:

```xml
<cac:Delivery>
  <cac:DeliveryLocation><cac:Address>                       <!-- destino = llegada de la guía -->
    <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">{llegadaUbigeo}</cbc:ID>
    <cac:AddressLine><cbc:Line>{llegadaDireccion}</cbc:Line></cac:AddressLine>
  </cac:Address></cac:DeliveryLocation>
  <cac:Despatch>
    <cbc:Instructions>{detalleViaje}</cbc:Instructions>      <!-- 3 a 500 caracteres -->
    <cac:DespatchAddress>                                    <!-- origen = partida de la guía -->
      <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">{partidaUbigeo}</cbc:ID>
      <cac:AddressLine><cbc:Line>{partidaDireccion}</cbc:Line></cac:AddressLine>
    </cac:DespatchAddress>
  </cac:Despatch>
  <cac:DeliveryTerms><cbc:ID>01</cbc:ID><cbc:Amount currencyID="PEN">{vrServicio}</cbc:Amount></cac:DeliveryTerms>
  <cac:DeliveryTerms><cbc:ID>02</cbc:ID><cbc:Amount currencyID="PEN">{vrCargaEfectiva}</cbc:Amount></cac:DeliveryTerms>
  <cac:DeliveryTerms><cbc:ID>03</cbc:ID><cbc:Amount currencyID="PEN">{vrCargaUtil}</cbc:Amount></cac:DeliveryTerms>
  <cac:Shipment>…</cac:Shipment>                            <!-- opcional: un tramo con configuración vehicular y cargas -->
</cac:Delivery>
```

- **Origen y destino:** se toman de la **primera guía relacionada**, que es la única en el flujo actual (una factura por guía).
- **Detalle del viaje:** `TRASLADO DE {peso} {unidad} SEGUN GRE {serie-número}: {partida corta} - {llegada corta}`, recortado a 500 caracteres.
- **`cac:Shipment`:** lleva un solo `Consignment` con `SizeTypeCode` (configuración vehicular), `ReturnabilityIndicator=false` y las medidas 01 (carga útil) y 02 (carga efectiva) en TNE. Solo genera observaciones, nunca rechazo, así que se incluye cuando el vehículo tiene los datos y se omite si no.
- **Orden de los elementos:** sigue el XSD UBL 2.1 incluido en `packages/sunat/xsd/2.1`. La validación XSD existente lo comprueba en cada emisión.
- **Sin detracción** (factura ≤ S/ 400): el XML queda igual que hoy (`0101`, sin `Delivery`).

### 5.2 Valor referencial (`valor-referencial.ts`, función pura)

Entradas:

- **`vrPorTm`:** soles por tonelada métrica, de la tabla MTC para ese origen→destino.
- **`cargaEfectivaTm`:** peso bruto de la guía convertido a TM.
- **`cargaUtilTm`:** carga útil nominal de la configuración vehicular del vehículo.

Salidas, en céntimos y redondeadas al céntimo:

- **VR 02 (sobre carga efectiva):** `vrPorTm × cargaEfectivaTm`.
- **VR 03 (sobre carga útil nominal):** `vrPorTm × cargaUtilTm`.
- **VR 01 (del servicio):** el valor que manda la norma del MTC.
- **Base de detracción:** `max(total de la factura, VR 01)`.
- **Detracción:** `round(4 % × base)`, redondeada a soles enteros como hoy.

**Fórmula de VR 01 — verificada (2026-10-05).** La norma vigente es el **D.S. 020-2021-MTC** (deroga el 010-2006 y el 033-2006). Su art. 3: el valor referencial del servicio es el valor por TM × la carga efectiva, y "en ningún caso puede ser inferior al 70 % de la capacidad de carga útil nominal". La app usa `VR 01 = max(VR 02, 0.7 × VR 03)` (constante `FACTOR_CARGA_UTIL_MINIMA = 0.7`, `FORMULA_VR_VERIFICADA = true`), en céntimos enteros. Detalle y caso numérico: `docs/superpowers/notas/2026-10-05-valor-referencial-mtc.md`. **No implementado:** el factor de retorno al vacío 1.4 (art. 4: cisternas, tolvas, contenedores, carga peligrosa… en rutas > 200 km virtuales); la app siempre declara `ReturnabilityIndicator=false`.

### 5.3 Datos nuevos (una sola vez)

- **`valor_referencial_ruta`** (`partida_ubigeo`, `llegada_ubigeo`, `vr_por_tm` en céntimos, `fuente` texto libre, `actualizado_en`). La clave es el par de ubigeos. Se sincroniza como las demás tablas de catálogo.
- **`vehiculo.configuracion_vehicular`** (texto, por ejemplo `T3S3`) y **`vehiculo.carga_util_tm`** (numeric). Para tracto + carreta se usan los del **tracto**, que representan la combinación. La web los muestra en la ficha del vehículo con una ayuda.
- **`factura`** guarda `vr_servicio`, `vr_carga_efectiva`, `vr_carga_util` y `detalle_viaje`. Así el XML se reconstruye igual en reintentos y el PDF los muestra.

### 5.4 Cuando falta un dato

- `prepararFactura` lanza `ErrorNegocio` si la factura tendrá detracción y falta:
  - el VR del par de ubigeos: "Falta el valor referencial MTC de {origen} → {destino}";
  - o la carga útil del vehículo.
- **El bot pregunta solo ese dato** (un número), lo guarda en la tabla y reintenta la preparación.
- **La web** muestra el mismo mensaje con un campo para completarlo en el momento.

## 6. Parte 2 — Conexión segura

### 6.1 Errores de credenciales → pausa

**Nuevo error `SunatCredencialesError`.** Lo lanza `SunatReal` cuando:

- el token OAuth responde 400 o 401;
- un 401 persiste después de renovar el token;
- un fault SOAP trae un código de autenticación (0102 usuario o clave incorrectos, 0111 sin perfil, 0103/0104/0105/0106 problemas de usuario). La lista exacta se fija en el plan desde `CodeErrors` / las reglas oficiales.

**Pausa (`core/sunat/pausa.ts`).** Se guarda en `ajuste` con la clave `sunat_pausa` (`{ desde, motivo }`). Esa clave **no se sincroniza**: las claves SUNAT son de cada dispositivo, y su pausa también. Al recibir `SunatCredencialesError`:

- **El documento en curso:** vuelve a su estado anterior (pendiente) sin sumar intento.
- **Al dueño:** se le avisa una sola vez por Telegram y con un aviso fijo en la web: "SUNAT en pausa: {motivo}. Revisa tus claves en Ajustes → Este dispositivo".
- **Envíos:** `emitirGuia`, `emitirFactura`, la consulta de tickets y `procesarPendientes*` **no llaman al gateway** mientras haya pausa. Los documentos quedan pendientes, sin perder nada.

**Reanudación.**

- **Automática:** `reconfigurarSunat` la limpia solo si cambió una credencial (usuario/clave SOL, client_id/secret, ruta o contenido del certificado, su clave), el modo o el ambiente respecto de la configuración anterior (huella en `ajuste.sunat_config_huella`), o si la pausa fue porque la configuración pedida no cargaba. Rearmar con lo mismo (cada arranque, guardar otro ajuste) no la limpia. *(Revisión final: reemplaza a "se limpia en cada reconfiguración".)*
- **Manual:** botón "Reintentar ahora" en la web (no anda mientras la configuración pedida no cargue).
- **Configuración que no carga:** si Real/Beta no carga, la app queda en simulado para la web pero SUNAT en pausa (nunca el simulador "acepta" pendientes reales). Cambiar el modo está bloqueado mientras haya guías o facturas pendientes de envío o enviadas.
- **Respuestas raras:** 3 errores de SUNAT sin clasificar seguidos (entre documentos) pausan con "SUNAT responde de forma inesperada; revisa tus claves antes de seguir". Un Fault sin código en `faultcode` toma el primer código de 4 cifras del `faultstring`; HTTP 401/403 del SOAP es error de credenciales.
- **Certificado vencido:** en modo real, antes de firmar no se reserva número y SUNAT queda en pausa ("Tu certificado digital venció el …").

**Por qué:** varios intentos con clave mala pueden bloquear el usuario SOL. Hoy cada documento reintentaría cada 5 minutos.

### 6.2 Faults SOAP de factura

| Código | Tratamiento |
|---|---|
| 2000–3999 | Rechazo (igual que hoy) |
| 1032, 1033 ("ya informado" / "registrado previamente") | `getStatusCdr` en `billConsultService` (solo producción) → se aplica el CDR recuperado; si SUNAT no lo devuelve, la factura queda `pendiente_envio` con ese código, sin reintento automático, y el mensaje "SUNAT dice que ya tiene esta factura: verifícala en SOL antes de volver a emitir" (revisión final). Reemitir una factura que SUNAT rechazó toma un número nuevo |
| Otros 1000–1999 y 0150–0199 (contenido, nombre o ZIP inválido) | Rechazo: reintentar no lo arregla |
| 0101–0106, 0110–0113 (autenticación, perfil, usuario secundario) | `SunatCredencialesError` → pausa |
| 0109, 0130–0149, 0200–0299 (servicio no disponible / error interno) | `SunatNoDisponibleError` → reintento normal |
| Otros | Error genérico → reintento normal (igual que hoy) |

### 6.3 "En proceso"

- **Facturas:** una respuesta `en_proceso` deja de marcarse como rechazada. Queda `pendiente_envio` y se reintenta; si al reintentar SUNAT dice "ya registrado", se recupera el CDR (§6.2).
- **Guías:** el ticket acepta `"98"` y `"0098"` (en proceso), `"0"` y `"0001"` (aceptado) y `"99"` (rechazado, con CDR o `error.numError`).

## 7. Parte 3 — "Pon tus claves y funciona"

### 7.1 Probar conexión (`core/sunat/probar.ts`)

Devuelve `{ certificado, claveSol, credencialesGre }`. Cada punto es `{ ok, mensaje }` y **ninguno emite documentos**.

1. **Certificado:** abre el .pfx/.p12 con su clave, comprueba que el RUC del certificado sea el de la empresa y que esté vigente (avisa si vence en menos de 30 días).
2. **Clave SOL:** llama `getStatus`/`getStatusCdr` de `billConsultService` con un comprobante inexistente. Si SUNAT responde "no existe", la clave es correcta; si responde un código de autenticación, no lo es.
3. **Credenciales GRE:** pide el token OAuth y lo descarta.

Las pruebas 2 y 3 se hacen con los valores **escritos en el formulario**, antes de guardarlos. Un fallo aquí no activa la pausa global: la prueba se hace a pedido y una sola vez.

*(Revisión final.)* Si la prueba 2 falla por credenciales, la 3 no se hace ("No se probó: primero corrige usuario/clave SOL"). Se permite una prueba por minuto. En modo Real se prueba lo escrito sin guardarlo y solo se guarda si sale todo ✅; fuera de Real se guarda lo escrito (sin el modo) y luego se prueba.

### 7.2 Pantalla Ajustes → Este dispositivo

- **Botón PROBAR CONEXIÓN** junto al panel SUNAT, con ✅/❌ por punto y qué corregir.
- **Modo Real bloqueado:** no se puede guardar con modo Real si la última prueba con esos mismos valores no salió ✅ en los tres puntos. El mensaje explica qué falta.
- **Panel "Cómo conseguir tus accesos"**, con las rutas de menú SOL de §2:
  1. Pedir el certificado gratuito.
  2. Inscribirse como emisor desde los sistemas del contribuyente.
  3. Crear las credenciales de API GRE.
  4. Opcional: crear un usuario secundario. Se indica que hay que probar si basta un usuario secundario, porque no se pudo confirmar.
- Acepta `.pfx` y `.p12` (ya lo hace).

### 7.3 Primera emisión real

Mientras este dispositivo no haya tenido aceptada ninguna guía (o factura) en modo real, la confirmación que ya existe antes de emitir (botón ✅ Emitir del bot) muestra un aviso destacado: "⚠️ Esta será tu PRIMERA guía REAL ante SUNAT". Se guarda en el ajuste local `sunat_primera_real` (`{ guia, factura }`), que no se sincroniza. Después de la primera aceptada, el aviso desaparece.

## 8. Parte 4 — Factura automática (opcional)

- Ajuste `factura_automatica` (`{ activa: boolean }`, por defecto `false`), que **sí se sincroniza** (se agrega al filtro de `ajuste` en `sincro/registro.ts`), con un interruptor en Ajustes.
- Al aceptarse una guía, la factura se prepara y se emite sola si se cumple todo esto:
  - el interruptor está encendido;
  - la guía tiene viaje con `flete` pactado;
  - es la única guía del viaje;
  - el cliente (remitente) tiene RUC;
  - no falta el valor referencial.

  Usa el `flete` (sin IGV), forma de pago **contado**, y el PDF llega por Telegram.
- Si cualquier condición falla, se ofrece "Facturar sí/después" como hoy, sin error.

## 9. Manejo de errores (resumen)

| Situación | Resultado |
|---|---|
| SUNAT caída o sin red | Reintento cada 5 min hasta 24 h (igual que hoy) |
| Clave SOL o credenciales GRE malas | Pausa global + un aviso; nada se pierde |
| Falta VR o carga útil | No se prepara la factura; se pide el dato |
| SUNAT dice "ya registrado" | Se recupera el CDR y se marca aceptada |
| Factura "en proceso" | Se consulta después, sin reenviar |
| XML inválido por XSD | Rechazo local con detalle (igual que hoy) |

## 10. Pruebas

- **Unitarias de `valor-referencial.ts`:** casos con y sin carreta, peso en KGM y TNE, base de detracción cuando VR 01 > total y cuando es menor.
- **XML 1004:** construcción + validación XSD + comprobación de orden de elementos. Se comparan los nodos clave con el ejemplo de §5.1.
- **`SunatReal` con `fetch` falso:**
  - token 401 → `SunatCredencialesError`;
  - fault 0102 → `SunatCredencialesError`;
  - fault 1033 → `getStatusCdr` llamado y CDR aplicado;
  - ticket `"98"`/`"0"`/`"99"` y sus variantes de 4 dígitos.
- **Pausa:** un error de credenciales en un documento detiene los siguientes envíos (el gateway falso cuenta llamadas = 0); `reconfigurarSunat` la limpia.
- **Probar conexión:** los tres puntos con respuestas falsas, OK y fallo.
- **Factura automática:** se emite con todas las condiciones y no se emite si falta cualquiera.
- **Beta real de SUNAT** (solo con permiso explícito del dueño): enviar una factura 1004 al beta con `MODDATOS` y comprobar que SUNAT la acepta. No existe equivalente para guías.

## 11. Fuera de alcance

- Boletas, notas de crédito y débito, comunicación de baja, resumen diario.
- SIRE (compras y ventas), consulta de validez y consulta RUC.
- Pago de detracciones y GRE por evento: no tienen API.
- Varias guías en una misma factura (solo la primera aporta origen y destino).
- Recuperar el CDR de una guía que SUNAT ya tiene (1033 en la GRE): no hay consulta de CDR por número para guías; se trata como un rechazo más y el dueño la verifica en SOL. (En facturas, un 1032/1033 sin CDR recuperado queda pendiente "por verificar en SOL" y no se reenvía solo.)
- Unir la rama de la beta 12 con `main` (choque de la migración 0012).
