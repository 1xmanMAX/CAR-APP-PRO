# SUNATAPP — Costos fijos y variables, viaje nacido de la guía, gasto que se llena solo y rentabilidad por viaje o por mes

- **Fecha:** 2026-09-27
- **Estado:** Diseño aprobado por partes en conversación; pendiente revisión del documento.
- **Base:** rama `plan3-ia` en `c8e2548` (v0.3.0-beta.9).

---

## 1. Objetivo

Que la ganancia que muestra la app sea la real, **separando el costo fijo del variable**. Además:

- que **todo viaje nazca de su guía**;
- que las **categorías sean las del transporte de carga pesada**, con la opción de crear otras propias;
- que **cada gasto guarde solo sus datos mínimos**: fecha y hora, unidad, viaje, guía, categoría, monto, proveedor, forma de pago y km del vehículo;
- que la rentabilidad se pueda ver **por viaje o por mes**.

### Principio que manda en todo el diseño

**Se registra en el momento en que pasan las cosas, con el mínimo de campos.** Todo lo que la app puede deducir se toma solo: el momento del registro, la unidad, el viaje, la guía y el km. A la persona se le pide solo lo que la app no puede saber: casi siempre, el monto. Lo automático se puede corregir después, pero nunca se pide por adelantado.

## 2. Decisiones tomadas

| Tema | Decisión |
|------|----------|
| Reparto del fijo en cada viaje | **Por viaje.** Fijos de la unidad en el mes ÷ viajes de esa unidad en el mes, más fijos generales del mes ÷ todos los viajes del mes. En el mes en curso el resultado es **provisional** |
| Cómo nace el viaje | **Al registrar la guía** (en la web, o mandando al bot el PDF de la guía del remitente) |
| Categorías | Tabla configurable con la lista del §4.1. Cada una es fija o variable; en Ajustes se pueden crear categorías propias |
| Km en cada gasto | El **último km conocido**. Al cargar combustible se toma el **km real** del voucher; si el voucher no lo trae, el bot lo pide en un paso |
| Fijos | **Recurrentes, se cargan solos** cada mes (los anuales, 1/12 por mes). Las cuotas de préstamo entran como fijo del mes en que vencen |
| Opción descartada | Ampliar la lista fija de categorías del código: no permite categorías propias |

## 3. Arquitectura (qué se toca)

```
packages/db/
  src/schema.ts                    categoria_gasto (tabla), costo_fijo (tabla), columnas nuevas de gasto
  drizzle/0012_costos_fijos.sql    migración: tablas, columnas, mapeo de categorías, sincronización
packages/core/src/
  finanzas/categorias.ts           NUEVO: listar, crear, desactivar y clasificar categorías
  finanzas/costos-fijos.ts         NUEVO: registrar fijos y generar los gastos del mes (idempotente)
  finanzas/finanzas.ts             registrarGasto completa solo guía, forma de pago y km; resumenFinanciero separa fijo y variable
  finanzas/captura.ts              NUEVO: deducir el contexto de un gasto (unidad, viaje, guía, km, forma de pago)
  viajes/desde-guia.ts             NUEVO: viaje creado o enlazado al registrar una guía
  guias/registrar.ts               llama a desde-guia al registrar el borrador
  rentabilidad/por-viaje-mes.ts    NUEVO: rentabilidad por viaje y por mes, con reparto de fijos
  lecturas/lecturas.ts             la confirmación usa captura.ts; el km del voucher de combustible actualiza el odómetro
  sincro/registro.ts               registra categoria_gasto y costo_fijo
packages/ia/src/
  tipos.ts, prompts.ts             categorías dinámicas (se pasan al prompt); se extraen medioPago y kmOdometro
apps/bot/src/
  flujo-lectura.ts, flujo-flota.ts confirmación en una línea; pedir km al cargar combustible si falta
apps/web/src/paginas/
  finanzas.tsx                     formulario de gasto: monto, categoría y foto, con el resto en una línea que se puede cambiar
  rentabilidad.tsx                 conmutador POR VIAJE / POR MES
  ajustes.tsx                      apartados Categorías y Costos fijos
  revisar.tsx                      viajes sin guía, guías rechazadas, viajes cerrados solos
  liquidacion.tsx                  desglose de contribución, fijo asignado y ganancia en el detalle del viaje
  estadisticas.tsx                 la descarga a Excel incluye las dos vistas nuevas
```

## 4. Datos

### 4.1 Categorías (`categoria_gasto`, tabla nueva)

Columnas: `clave` (texto, única), `nombre`, `tipo` (`fijo` | `variable`), `sistema` (bool: viene de fábrica), `activa` (bool), `orden`.

**Variables:**

| clave | nombre |
|---|---|
| combustible | Combustible |
| peaje | Peajes |
| viaticos | Viáticos del chofer |
| hospedaje | Hospedaje |
| estiba | Estiba y desestiba |
| balanza | Balanza |
| cochera | Cochera en ruta |
| lavado | Lavado |
| llantas_ruta | Llantas en ruta (parche, vulcanizado) |
| reparacion_ruta | Reparación en ruta |
| lubricantes | Lubricantes y engrase |
| resguardo | Resguardo o custodia |
| multas | Multas y papeletas |
| otros_viaje | Otros del viaje |

**Fijas:**

| clave | nombre |
|---|---|
| cuota_prestamo | Cuota de leasing o préstamo |
| soat | SOAT |
| seguro | Seguro vehicular |
| revision_tecnica | Revisión técnica |
| gps | GPS y monitoreo |
| sueldo_chofer | Sueldo del chofer |
| sueldo_admin | Sueldos administrativos |
| contador | Contador |
| local | Local, oficina o cochera mensual |
| permisos_mtc | Permisos MTC |
| telefonia | Teléfono e internet |
| mantenimiento | Mantenimiento preventivo |
| otros_fijos | Otros fijos |

- Las categorías de fábrica no se borran; solo se desactivan.
- Las categorías propias usan una clave generada a partir del nombre.

`gasto.categoria` deja de ser un enum y pasa a texto, con una referencia a `categoria_gasto.clave`. La migración mapea los valores actuales así:

- `reparacion` → `reparacion_ruta`;
- `otros` → `otros_viaje`;
- los demás conservan su clave.

Hoy las reparaciones de la página Reparaciones generan un gasto `reparacion`. Desde este cambio, un cambio **preventivo** va a `mantenimiento` y uno **correctivo** o una **falla en ruta** van a `reparacion_ruta`.

### 4.2 Columnas nuevas en `gasto`

| Columna | Tipo | Contenido |
|---|---|---|
| `guia_id` | FK `guia_transportista`, nula | guía del tramo en que ocurrió el gasto |
| `medio_pago` | enum, nulo | `efectivo_chofer`, `efectivo`, `yape_plin`, `transferencia`, `tarjeta`, `credito` |
| `km_vehiculo` | entero, nulo | km del vehículo en ese momento |
| `km_real` | bool, por defecto false | true si el km se leyó del voucher o lo dio el chofer; false si es el último conocido |
| `costo_fijo_id` | FK `costo_fijo`, nula | fijo recurrente que generó este gasto |
| `periodo` | texto `AAAA-MM`, nulo | mes al que corresponde un gasto fijo |

Restricción: `(costo_fijo_id, periodo)` es único, para que el mismo fijo nunca se genere dos veces en el mismo mes.

La **hora** es `creado_en`, que ya existe. `fecha` sigue siendo el día contable.

**Gastos existentes:**
- `medio_pago` y `km_vehiculo` quedan nulos; no se inventan.
- `guia_id` se completa desde su viaje solo cuando ese viaje tiene una única guía.

### 4.3 Fijos recurrentes (`costo_fijo`, tabla nueva)

| Columna | Contenido |
|---|---|
| `concepto` | texto |
| `categoria` | clave de una categoría **fija** |
| `monto` | céntimos |
| `periodicidad` | `mensual` o `anual` |
| `vehiculo_id` | nulo = fijo general |
| `medio_pago` | forma de pago del fijo |
| `desde` | fecha de inicio |
| `hasta` | fecha de fin, nula |
| `activo` | bool |
| `usuario_id` | quien lo registró |

**Generación:** `generarFijosDelMes(ctx, periodo)` crea, para cada fijo vigente en ese mes, un gasto con:
- `origen = sistema` y `fecha` = el día 1 del mes;
- `monto` = el monto del fijo si es mensual, o el monto ÷ 12 (redondeado a céntimos) si es anual. En diciembre se ajusta el redondeo para que el año sume exacto.

Es idempotente gracias a la restricción única. Se ejecuta:
1. en la tarea de fondo diaria que ya existe (el mismo lugar que el aviso diario);
2. y además, perezosamente, antes de calcular la rentabilidad de un mes, para no depender de que el proceso haya estado encendido.

**Cuotas de préstamo:** en el mes de su vencimiento, cada cuota genera un gasto fijo `cuota_prestamo` con la unidad del préstamo si la tiene. Usa la misma idempotencia, con la referencia a la cuota.

### 4.4 Sincronización

- `categoria_gasto` y `costo_fijo` se registran en `TABLAS` (`packages/core/src/sincro/registro.ts`).
- `categoria_gasto` usa la clave natural `clave`.
- La migración 0012 agrega las columnas `sinc_*` y los disparadores `sinc_marcar` y `sinc_lapida` a las dos tablas nuevas, siguiendo `0008_sincronizacion.sql`.
- Las columnas nuevas de `gasto` no requieren registro: el catálogo de la sincronización se lee de la base.

## 5. El viaje nace de la guía

`alRegistrarGuia(ctx, guiaId)` (en `viajes/desde-guia.ts`) se llama al final de `registrarGuiaBorrador`, dentro de la misma transacción. No espera la respuesta de SUNAT.

| Situación de la unidad de la guía | Acción |
|---|---|
| No tiene viaje en curso | Crea un viaje `en_curso` con la guía como `ida` |
| Viaje en curso con ida y sin retorno | Enlaza la guía como `retorno` |
| Viaje en curso con ida y retorno | Cierra ese viaje con el último km conocido y lo marca para revisar; luego crea un viaje nuevo con esta guía como `ida` |

El viaje creado toma todos sus datos de la guía:

| Dato del viaje | De dónde sale |
|---|---|
| `vehiculoId`, `vehiculoSecundarioId`, `conductorId` | los de la guía |
| `origenLugar`, `destinoLugar` | nombre de la ciudad (distrito o provincia) de los ubigeos de partida y llegada |
| `toneladas` | `pesoBruto`, convertido de kg a t si la unidad es KGM |
| `fechaSalida` | el momento del registro |
| `odometroInicio` | `vehiculo.odometroKm` |
| `rutaId` y presupuesto | la ruta que coincide con «origen → destino», con su plantilla copiada (mismo mecanismo que hoy) |

Casos especiales:
- **Guía rechazada o anulada por SUNAT:** el viaje se conserva, la guía queda enlazada y el viaje aparece en **Por revisar** como «guía rechazada».
- **Viajes sin guía:** se pueden seguir creando con `/viaje` o en la web, pero aparecen en **Por revisar** («sin guía») hasta que se les enlace una.
- **Cierre:** no cambia. `/fin` o «ya llegué» en el bot, o el botón en la web. Si el chofer no da km, se usa el último km real, por ejemplo el del último voucher de combustible.
- **Flete:** no cambia. Se toma de las facturas aceptadas de sus guías; si no hay factura, se pide al cerrar el viaje.

## 6. El gasto se llena solo

`capturarContexto(ctx, { usuarioId, vehiculoId?, viajeId? })`, en `finanzas/captura.ts`, devuelve la unidad, el viaje, la guía, el km, si ese km es real y la forma de pago por defecto. `registrarGasto` completa con esto todo lo que no venga explícito.

| Dato | Regla |
|---|---|
| fecha y hora | momento del registro (`fecha` = hoy en Lima; hora = `creado_en`) |
| unidad | la del viaje en curso en que el usuario es chofer; si no, la unidad indicada; en la web, la última usada |
| viaje | el viaje en curso de esa unidad (como hoy) |
| guía | la guía del tramo actual del viaje: `retorno` si está enlazada, si no `ida` |
| categoría | la IA o las reglas; en la web, un selector; si la IA duda, el bot pregunta con botones |
| monto | lo da la persona |
| proveedor | RUC y razón social leídos por la IA del voucher (el RUC se guarda solo si pasa `validarRuc`); sin foto, queda vacío |
| forma de pago | la del voucher si la IA la reconoce (tarjeta, Yape); si no, `efectivo_chofer` con viaje en curso y `transferencia` sin viaje; en los fijos, la del fijo |
| km | el último conocido (`km_real = false`). En combustible, el km del voucher (`km_real = true`), que además actualiza el odómetro con `registrarLecturaOdometro` (mismas validaciones de hoy) |
| fijo o variable | lo dice la categoría |

La IA extrae dos datos nuevos: `medioPago` y `kmOdometro`. La lista de categorías del prompt se arma desde la tabla, así que las categorías propias también se reconocen.

**Bot:**
- La confirmación es una sola línea con botones **OK** y **Cambiar**. Ejemplo: «Combustible S/ 480 · T-02 · VJ-0129 (guía T001-0307, ida) · Primax 20100… · efectivo chofer · 402,380 km».
- Si es combustible y no hay km en el voucher, antes de confirmar el bot pide un solo dato: «¿Km del tablero?», con un botón **No sé** que deja el último conocido.

**Web (Finanzas → + Gasto):**
- Visibles solo **monto, categoría y foto**.
- Debajo, una línea con lo que se guardará solo, por ejemplo: «T-02 · VJ-0129 · guía T001-0307 · 402,380 km · efectivo del chofer · 27 set 11:42».
- El enlace **cambiar** despliega esos campos para corregirlos.

## 7. Rentabilidad por viaje o por mes

`rentabilidadPorViaje(ctx, { desde, hasta, vehiculoId? })` y `rentabilidadPorMes(ctx, { desde, hasta, vehiculoId? })` van en `rentabilidad/por-viaje-mes.ts`. Antes de calcular, las dos ejecutan `generarFijosDelMes` para cada mes del rango.

**Reglas de cálculo:**
- Variables de un viaje = gastos con ese `viaje_id` cuya categoría es `variable`.
- Fijos de un mes = gastos de categoría `fija` con `periodo` = ese mes; los fijos cargados a mano sin periodo cuentan por su `fecha`. Pueden ser de una unidad o generales (`vehiculo_id` nulo).
- **Fijo asignado a un viaje** = fijos del mes de su unidad ÷ viajes cerrados de esa unidad en el mes, más fijos generales del mes ÷ viajes cerrados de todas las unidades en el mes. El mes del viaje es el de su **fecha de cierre**.
- Contribución = flete − variables. Ganancia = contribución − fijo asignado. Margen = ganancia ÷ flete.
- En el mes en curso, el fijo asignado y la ganancia se marcan `provisional: true`.
- Un gasto variable sin viaje (por ejemplo, combustible cargado en base) cuenta en el mes de la unidad como variable no asignado a ningún viaje.

**Página 08 Rentabilidad:**
- Conmutador **POR VIAJE / POR MES**, filtro de unidad y rango de meses. El cotizador y los paneles actuales se mantienen debajo.
- **Por viaje:** viaje, guía, unidad, ruta, flete, variables, contribución, fijo asignado, **ganancia** y margen. Tocar un renglón abre el detalle del viaje.
- **Por mes:** mes, viajes, ingresos, variables, contribución, fijos, **ganancia neta** y margen. Al abrir un mes se ven sus fijos desglosados. Un mes con fijos y sin viajes aparece en pérdida.

**Otros cambios:**
- El detalle del viaje (`liquidacion.tsx`) muestra la contribución, el fijo asignado y la ganancia, con la marca de provisional.
- `resumenFinanciero` (Dashboard y Finanzas) separa variables y fijos; la ganancia neta resta ambos, incluidas las cuotas de préstamo.
- La descarga a Excel de Estadísticas agrega las hojas «Por viaje» y «Por mes».

**Ajustes:**
- **Categorías:** lista, crear (nombre y fija o variable) y desactivar.
- **Costos fijos:** lista y formulario (concepto, categoría fija, monto, mensual o anual, unidad o general, desde). La forma de pago es `transferencia` por defecto, y editarla es opcional.

## 8. Por revisar

Se agregan tres motivos:
- viaje **sin guía**;
- viaje con **guía rechazada o anulada**;
- viaje **cerrado automáticamente** al registrarse una guía nueva: hay que ajustar el km y el flete.

## 9. Errores y bordes

- **Guía de una unidad inexistente o sin chofer:** hoy ya se valida al registrar la guía; no cambia.
- **Km del voucher menor que el odómetro, o salto mayor de 20,000 km:** el gasto se guarda con `km_real = false` y el último conocido, y el bot avisa que no pudo usar ese km. El gasto no se rechaza.
- **Categoría desactivada:** no aparece para gastos nuevos; los gastos existentes la conservan.
- **Mes sin viajes:** el fijo asignado por viaje no aplica; la vista por mes muestra la pérdida.
- **Fijo anual que empieza a mitad de año:** se reparte 1/12 por mes desde `desde`, sin prorratear días.

## 10. Pruebas

**Unitarias, en `packages/core/test`:**
- mapeo de categorías de la migración;
- `generarFijosDelMes`: mensual, anual (1/12, ajuste de diciembre), vigencia desde y hasta, idempotencia, cuotas de préstamo;
- `capturarContexto`: con y sin viaje en curso, tramo ida o retorno, km real del voucher y km inválido;
- `alRegistrarGuia`: los tres casos de la tabla del §5, más la guía rechazada;
- reparto del fijo por viaje: unidad y general, mes provisional, mes sin viajes;
- rentabilidad por mes: variables, fijos y ganancia neta.

**Otras pruebas:**
- **Bot** (`apps/bot/test`): gasto de combustible sin km pide el km; confirmación en una línea; categoría propia reconocida.
- **Web** (`apps/web/test`): formulario de gasto mínimo; conmutador de rentabilidad; Ajustes → Categorías y Costos fijos.
- **Recorrido completo sobre la demo:** registrar guía → viaje creado → gastos por el bot con km → guía de retorno → cerrar → ver la rentabilidad por viaje y por mes con los fijos repartidos.
- **Demo:** `demo-flota.ts` agrega fijos recurrentes (sueldos, SOAT, GPS, contador) y crea los viajes a partir de guías, para que la demo muestre todo.

## 11. Fuera de alcance

- Prorrateo de fijos por día o por km. Se eligió el reparto por viaje; se puede agregar como opción más adelante.
- Separar el interés del capital en las cuotas de préstamo: la cuota completa cuenta como fijo.
- Tabla de proveedores: el proveedor sigue siendo el RUC y el nombre guardados en cada gasto.
