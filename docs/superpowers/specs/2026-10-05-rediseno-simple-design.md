# SUNATAPP — Rediseño simple: 4 lugares + un botón Anotar

- **Fecha:** 2026-10-05
- **Estado:** Aprobado por el dueño en conversación ("hazlo así"), con el lienzo de la propuesta: https://claude.ai/artifact/FwtzW4Gx48bd2PPBGtkAh2 (mapa, 5 pantallas de celular, 1 de PC).
- **Rama:** `rediseno-simple` (worktree `F:\THE FORGE\SUNATAPP-rediseno`), creada desde `sunat-salida-real` en `db4619f`. Se une después de que termine el plan SUNAT.

---

## 1. Objetivo

La app web tiene **11 pestañas + 6 páginas escondidas, ~45 formularios**, y la plata gastada se anota en **10 lugares distintos**. El dueño (y usuarios con poca educación formal) no sabe dónde va cada dato.

Objetivo: **4 lugares + un botón grande "Anotar" + Ajustes**, sin perder ninguna función, que se vea bien y sin saturar **tanto en el celular como en la PC de escritorio**.

### Principios (mandan sobre todo lo demás)

1. **Lo que se sabe, no se pregunta.** Fecha, camión, viaje en curso, km se ponen solos (memoria `registro-en-el-momento`). Se pide monto y "en qué".
2. **Cada cosa en un solo lugar.** Ninguna acción tiene dos formularios distintos.
3. **Primera vista = 3 o 4 números.** Lo avanzado va plegado en "Ver más".
4. **Palabras de la calle:** "Gasté", "Me pagaron", "Te deben", "Este viaje te deja", no "contribución" ni "egreso".
5. **Movimientos informados (PC):** al anotar se ve cómo queda (saldo del chofer, lo que deja el viaje, presupuesto).
6. **Se conserva el estilo actual:** colores, Space Mono + IBM Plex Mono, paneles crema, acento magenta (`apps/web/public/app.css`).

## 2. Mapa nuevo

| Lugar | Ruta | Absorbe (rutas actuales) |
|---|---|---|
| **Inicio** | `/` | Dashboard, Por revisar (como avisos), estado del bot |
| **+ Anotar** | `/anotar` (página en celular, panel lateral en PC) | + Gasto (Finanzas), entrega al chofer (Liquidación), compra de repuesto (Inventario), reparación/cambio (Reparaciones y PIEZA del 3D), cobro (Viajes), otro ingreso, préstamo y pago de cuota, reinversión |
| **Viajes** | `/viajes`, `/viajes/:id` | Viajes, Liquidación, guías, facturas, por cobrar, enlazar guía, cerrar viaje/flete, presupuesto del viaje |
| **Camiones** | `/camiones`, `/camiones/:id` | Trailer 3D (centro), Flota, Reparaciones (historial), Inventario (stock), odómetro, vida útil |
| **Números** | `/numeros` (+ subpáginas "Ver más") | Rentabilidad, Finanzas (caja/movimientos), Estadísticas, Cotizador, Préstamos (lista), Reinversiones, presupuesto mensual |
| **⚙ Ajustes** | `/ajustes` (hub) | Empresa, Usuarios, Costos fijos, Categorías, Catálogo de partes, **Rutas y presupuestos** (`/rutas`), **Telegram** (`/telegram`), **Sincronizar** (`/sincronizar`), **Este dispositivo / SUNAT** (`/ajustes/dispositivo`) |

- **Rutas viejas** (`/trailer/:id`, `/flota`, `/inventario`, `/reparaciones`, `/finanzas`, `/rentabilidad`, `/estadisticas`, `/revisar`) **redirigen** (302) a su lugar nuevo, conservando parámetros útiles (`?pieza=`, `?repuesto=`). Los **POST** existentes siguen funcionando (los formularios nuevos pueden reutilizarlos); no se rompe el bot ni enlaces de Telegram.
- **Roles** (`packages/core/src/acceso/acceso.ts`) se mantienen: el menú muestra solo lo que cada rol ve; Anotar muestra solo los tipos que su rol puede editar (taller: Reparé/repuesto; contador: plata).

## 3. Navegación

- **Celular (< 900 px):** barra inferior fija con Inicio · Viajes · **[+]** (círculo magenta central) · Camiones · Números. Ajustes es un ícono arriba a la derecha en Inicio. La cabecera actual (KPIs, reloj, chips) desaparece en celular.
- **PC (≥ 900 px):** menú lateral de ~220 px (Inicio, Viajes, Camiones, Números, botón magenta **Anotar**, Ajustes abajo). Contenido con `max-width` cómodo; no más de 2–3 columnas.
- El chip "SUNAT SIMULADO" y el estado del bot pasan a ser avisos de Inicio, no elementos fijos de la cabecera.

## 4. Pantallas

### 4.1 Inicio
- Tarjeta oscura grande: **"Ganaste este mes"** + comparación con el mes anterior.
- 3 cifras: **Entró · Salió · Te deben**.
- **"Necesita tu atención"**: lista corta (máx. 5) con punto de color: fotos/documentos del bot por confirmar (antes /revisar), partes por cambiar ya, cobros vencidos, viajes sin guía, SUNAT en pausa o simulado, bot desconectado. Cada fila lleva a donde se resuelve.
- **"En ruta ahora"**: una tarjeta por viaje en curso (camión, ruta, chofer, día, barra gastado/entregado, cuánto deja).
- PC añade **"Últimos viajes"** (tabla corta: viaje, flete, gastos, dejó).
- Se quitan del Inicio: feed de Telegram en vivo, carriles de 30 días, gastos por categoría, salud por parte (viven en Camiones/Números).

### 4.2 Anotar (un solo formulario)
- Paso 1 **"¿Qué pasó?"**: 6 botones grandes con dibujo: **Gasté · Plata al chofer · Me pagaron · Reparé / repuesto · Gasto de la empresa · Préstamo o cuota**.
- Paso 2 según el tipo, con los mínimos campos:
  - **Gasté**: monto, "¿en qué?" (botones de categorías variables más usadas + "Otro"), foto opcional. Viaje/camión/fecha/km automáticos (viaje en curso del camión; si hay varios, se elige con un toque).
  - **Plata al chofer**: monto, viaje (por defecto el en curso), medio.
  - **Me pagaron**: factura pendiente (lista de "Te deben") y monto (por defecto el saldo); o "otro ingreso" (monto + concepto).
  - **Reparé / repuesto**: camión, pieza (lista o desde el 3D), qué se hizo (cambio/compra para stock), repuesto del stock opcional, mano de obra, taller. Reutiliza la lógica actual de reparación (resetea contador, saca stock, registra gasto) y de compra.
  - **Gasto de la empresa**: monto, categoría fija (o "es mensual" → crea costo fijo recurrente), foto.
  - **Préstamo o cuota**: pagar cuota pendiente (lista) o registrar préstamo nuevo (reinversión incluida como opción).
- Bloque azul **"Se pone solo"** muestra lo automático con enlace "cambiar".
- **PC**: Anotar se abre como **panel lateral derecho** sobre cualquier página, con **"Así queda después de guardar"** (saldo del chofer, lo que deja el viaje, presupuesto de la categoría).
- Botón grande **GUARDAR**; al guardar vuelve a donde estaba con aviso de confirmación.
- `/revisar` (confirmar lo que llegó por Telegram) reutiliza este mismo formulario precargado.

### 4.3 Viajes
- Lista: tarjetas (celular) / tabla corta (PC) por mes: ruta, camión, estado, flete, gastos, cuánto dejó; arriba "En ruta" primero. Botón "Nuevo viaje" (viajes también nacen de la guía en el bot).
- Detalle `/viajes/:id`: tarjeta oscura **"Este viaje te deja"**, **Le diste / Le queda**, **Gastos del viaje** (barras por categoría vs presupuesto, "ver todos"), **Papeles y cobro** (guía SUNAT, factura con botón Facturar, cobro), botones **+ Anotar** y **Cerrar viaje** (cierre pide flete y km solo si faltan). Editar presupuesto del viaje, enlazar guía, reabrir: en "Ver más".

### 4.4 Camiones
- Selector de camión (chips). **Modelo 3D actual** (`public/trailer3d.js`) arriba, con leyenda bien / pronto / cambiar ya.
- Pestañas: **Lo que toca** (partes por desgaste) · **Historial** (reparaciones) · **Repuestos** (stock, compras; nuevo repuesto en "Ver más") · **Datos** (placa, carreta, marca, odómetro, configuración vehicular y carga útil, rendimiento, vida útil).
- Tocar una pieza del 3D abre su detalle con **"Registrar un cambio"** → Anotar (tipo Reparé) precargado.
- "+ Nuevo camión" en el selector.

### 4.5 Números
- Selector Este mes / Mes pasado / Año.
- **"¿Qué viaje dejó más?"** (lista ordenada), **"¿En qué se va la plata?"** (barras por categoría).
- **Ver más**: Caja (movimientos y flujo 12 semanas), Préstamos y cuotas, Cotizar un viaje, Rentabilidad detallada (por viaje / por mes / por camión / proyección / presupuesto vs real), Gráficos y Excel para el contador (estadísticas actuales).

### 4.6 Ajustes
- Hub con tarjetas grandes: Empresa · Usuarios · Costos fijos · Categorías · Rutas y presupuestos · Catálogo de partes · Telegram · Sincronizar · Este dispositivo y SUNAT. Cada una abre su página actual (re-estilizada, sin cambiar su lógica).

## 5. Lo que NO cambia
- Lógica de negocio en `packages/core` (salvo funciones de solo lectura nuevas para Inicio y "Así queda").
- Bot de Telegram y su flujo.
- Endpoints POST existentes (se pueden agregar nuevos; no se quitan los usados por formularios o pruebas).
- Modelo 3D (`trailer3d.js`) — solo cambia dónde se monta.

## 6. Calidad y pruebas
- `apps/web/test/web.test.ts` se actualiza: cada lugar nuevo responde 200 por rol permitido y 403 al resto; rutas viejas redirigen; Anotar crea cada tipo de movimiento y llama a la misma lógica de core que antes.
- **Capturas de pantalla** con Playwright (chromium ya instalado en `%LOCALAPPDATA%\ms-playwright`) de cada lugar a **390×844** y **1440×900** con datos demo (`pnpm demo:flota`); un revisor las compara con el lienzo y con estas reglas: sin desborde horizontal en 390 px, botones ≥ 44 px, texto ≥ 12 px, contraste 4.5:1, máx. 4 cifras grandes por vista, ningún formulario de más de 4 campos visibles al inicio.
- `pnpm typecheck` y `pnpm test` limpios.

## 7. Fuera de alcance
- Cambios al bot de Telegram.
- Nuevas funciones de negocio (solo se reorganiza).
- La app Android nativa más allá de que la web adaptada se vea bien en su WebView.
