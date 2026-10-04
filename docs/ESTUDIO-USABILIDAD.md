# Estudio de usabilidad · Control Flota

**Fecha:** octubre 2026 · **Versión estudiada:** 0.3.0-beta.11 → cambios en 0.3.0-beta.12

## 1. Método

1. **Auditoría de la app real en celular.** Se abrieron las 13 pantallas con datos de demostración en
   un celular simulado de 390 × 844 px (Android, táctil). Un script midió en cada una:
   - el alto de la página;
   - los elementos tocables de menos de 44 px;
   - los textos de menos de 12 px;
   - el peso del HTML.

   Además se revisaron capturas.
2. **Revisión de literatura.** Se reunieron 39 fuentes (papers revisados por pares, guías de
   plataforma y estándares) sobre los temas de cada problema hallado. Cada DOI o URL se comprobó;
   lo que no se pudo verificar se dejó fuera. La lista completa está en la sección 6.
3. **Cambios justificados.** Solo se implementó lo que respalda la evidencia. Después se repitió la
   misma medición (sección 4).

## 2. Problemas encontrados (beta.11, celular 390 px)

| # | Problema | Dato medido |
|---|----------|-------------|
| P1 | La cabecera ocupa un tercio de la pantalla en **todas** las páginas: nombre, lema, 3 cifras, estado del bot, reloj y usuario. | ~290 px de 844 |
| P2 | El menú está **arriba y se desliza de costado**. De 10 secciones solo se ven 3; el resto queda fuera de la pantalla y lejos del pulgar. | 7 de 10 ocultas |
| P3 | Botones, enlaces y filas **chicos para el dedo**. | p. ej. Ajustes: 111 de 114 tocables < 44 px; Flota: 95 de 96 |
| P4 | Letra **muy chica**: etiquetas de 10–11 px, en MAYÚSCULAS monoespaciadas. | 30–50 % de los textos < 12 px |
| P5 | Formularios **siempre abiertos** debajo de las listas: Viajes con 3 formularios, Finanzas con 3. Lo que se consulta queda enterrado. | Finanzas: 2895 px de alto |
| P6 | El inicio **no dice qué hay que hacer hoy**. Las alertas (partes por cambiar, cuota de préstamo, por revisar) están repartidas. | — |
| P7 | El **semáforo usa solo color** (azul, ámbar, magenta) en los cuadros de salud y las barras. | — |
| P8 | **Contraste insuficiente** en los bordes de campos (no se ve dónde tocar con sol) y en la barra ámbar. | 1,8:1 y 1,7:1 (mínimo 3:1) |
| P9 | Las tablas se aprietan en columnas de 3–4 palabras por línea, o hay que deslizarlas de costado. | Historial de reparaciones |
| P10 | Filtros de mes o unidad que piden un toque extra en «VER». | 5 pantallas |
| P11 | Al guardar, el aviso sale **arriba**, lejos de donde se tocó, y queda ahí. | — |
| P12 | **Inventario pesa 207 KB**: la lista de 200 piezas se repite una vez por cada repuesto. | 207 KB |
| P13 | Trailer 3D: en el celular, el modelo queda **debajo** de la lista de partes. | — |

## 3. Cambios hechos y su justificación

| Cambio | Resuelve | Por qué (fuente) |
|--------|----------|------------------|
| **Barra inferior fija** con 4 secciones de uso diario (Inicio, Viajes, Gastos, Trailer 3D) y «Más» para el resto. Cada una lleva ícono **y** texto. | P2 | <ul><li>La mitad de la gente usa el celular con una sola mano [3].</li><li>El pulgar no llega bien a las esquinas de arriba [2].</li><li>Esconder la navegación reduce casi a la mitad su descubrimiento y hace las tareas un 15 % más lentas [14].</li><li>Material recomienda 3–5 destinos abajo, con ícono y texto [6].</li><li>Menos opciones a la vista, decisión más rápida (Hick) [15].</li></ul> |
| **Cabecera compacta** en el celular: logo, nombre de la sección y punto de estado del bot (~56 px). Las cifras pasan al inicio. | P1 | <ul><li>«Visibilidad del estado del sistema»: dónde estoy y si el bot funciona [18].</li><li>Un dashboard debe aprovechar la pantalla, sin decoración [19].</li></ul> |
| **Objetivos táctiles de 48 px** (botones, campos, opciones, filas de listas), con 8–10 px de separación. | P3 | <ul><li>Con el pulgar, los errores dejan de bajar recién en ~9,6 mm [1].</li><li>48 dp ≈ 9 mm (Material) [5].</li><li>44 pt (Apple) [7].</li><li>WCAG 2.5.5 / 2.5.8 [4].</li></ul> |
| **Letra más grande en el celular:** 16 px de base, etiquetas de 12–13 px, campos de 16 px, chips de 11 px. MAYÚSCULAS solo en etiquetas cortas. | P4 | <ul><li>Lo que manda en la legibilidad es el tamaño de la letra. Las mayúsculas solo ayudan en tamaños muy chicos y en textos cortos [11].</li><li>No hay evidencia contra la fuente monoespaciada, así que se conserva la identidad visual.</li></ul> |
| **Formularios plegables** en el celular (registrar viaje, cerrar viaje, gasto, ingreso, reinversión, nueva ruta). Se abren al tocar su título o con su botón «+», que lleva al campo y lo enfoca. | P5 | <ul><li>Revelar de a poco y bajar la carga de memoria de trabajo (~4 bloques) [17][18].</li><li>Las pautas de formularios mejoran velocidad y satisfacción [8].</li></ul> |
| **«Atención hoy»** al inicio. Hasta 5 filas tocables, lo más urgente primero: partes por cambiar ya, mensajes por revisar, cuota de préstamo por vencer, partes próximas, unidades en ruta. Debajo, atajos «+ Gasto», «+ Viaje», «Registrar cambio». | P6 | <ul><li>Un dashboard es para excepciones y en una pantalla [19].</li><li>Lo que destaca de forma preatentiva se ve primero [20].</li><li>Unos 4 ítems caben en la memoria de trabajo [17].</li></ul> |
| **Estado con símbolo además del color:** ● OK, ▲ PRÓXIMO, ■ CAMBIAR / EXCEDIDO. Los cuadros y las barras usan **lisos, puntos y rayas**. | P7 | <ul><li>~8 % de los hombres no distingue rojo/verde [21].</li><li>WCAG 1.4.1 no permite usar el color como única señal [4].</li></ul> |
| **Contraste:** bordes de campos de 1,8 a 3,9:1; barra ámbar de 1,7 a 3,3:1. El tema claro sigue siendo el predeterminado. | P8 | <ul><li>WCAG 1.4.11 pide 3:1 en componentes [4].</li><li>El texto oscuro sobre fondo claro rinde mejor, con o sin luz fuerte [12][13].</li></ul> |
| **Tablas como tarjetas** en el celular: cada fila es un bloque con la etiqueta de cada dato. Las tablas de comparación de Estadísticas y Rentabilidad se dejan como tabla. | P9 | <ul><li>Reconocer en lugar de recordar qué columna era [18].</li></ul> |
| **Filtros que se aplican solos** al cambiar el mes o la unidad. | P10 | <ul><li>Un paso menos por tarea [8].</li></ul> |
| **Aviso de guardado abajo** («✓ Gasto guardado»), cerca del dedo. Se va solo a los 5 s o al tocarlo. | P11 | <ul><li>Retroalimentación inmediata [18][32].</li><li>Respuesta en menos de 1 s para no cortar el hilo [22].</li></ul> |
| **Validación al salir del campo**, con mensajes concretos («Escribe solo el número (ej. 120.50)») que se borran al corregir, y marca del campo correcto. Al enviar, el botón dice «Guardando…» y no se puede tocar dos veces. | — | <ul><li>Validar en línea: +22 % de éxito, −22 % de errores, −42 % de tiempo [9].</li><li>Validar al salir del campo y borrar el error al corregir [10].</li><li>Prevenir errores [18][32].</li></ul> |
| **Inventario de 207 a 68 KB:** la lista de piezas va una sola vez (plantilla) y se copia al abrir cada selector. | P12 | <ul><li>Cada segundo de carga cuenta: el 53 % abandona si tarda más de 3 s [23].</li><li>Límites de 0,1, 1 y 10 s [22].</li></ul> |
| **Trailer 3D:** en el celular el modelo va primero. Se agregan búsquedas frecuentes de un toque (Llanta, Frenos, Bolsa de aire, Amortiguador, Luces, Batería, Filtro). | P13 | <ul><li>Tocar piezas chicas en 3D es difícil [1].</li><li>Una lista o buscador es la alternativa [15].</li><li>Reconocer antes que recordar [18].</li></ul> |

Ya estaba bien y se mantiene:

- teclado numérico en montos y km (`inputmode="decimal"`) y fecha de hoy por defecto [8][10];
- la app Android funciona sin internet, con base de datos local y sincronización por Wi-Fi, que es la recomendación local-first [33][34];
- el chofer usa solo el bot de Telegram con fotos y audios, nunca la app mientras maneja. Las guías de NHTSA piden miradas de ≤ 2 s [29]. Escribir mensajes multiplica por 23 el riesgo en camiones [30]. El chat da datos de mejor calidad que los formularios [27] y sirve con poca alfabetización digital [26].

## 4. Resultado medido (celular 390 × 844, mismas pantallas y datos)

| Pantalla | Tocables < 44 px (antes → después) | Textos < 12 px | Alto de página |
|----------|------------------|----------------|----------------|
| Inicio | 16 → 4 | 48 → 16 | 2756 → 3419 px (se sumó «Atención hoy») |
| Viajes | 38 → 1 | 51 → 4 | 1939 → **1109** px |
| Finanzas | 44 → 1 | 70 → 16 | 2895 → **1850** px |
| Flota | 95 → 7 | 115 → 9 | 2601 → 2757 px |
| Reparaciones | 30 → 6 | 50 → 12 | 2084 → 3005 px (tabla en tarjetas) |
| Ajustes | 111 → 6 | 73 → 4 | 2938 → 3735 px |
| Rutas | 27 → 1 | 22 → 4 | 1282 → **844** px |
| Trailer 3D | 261 → 156* | 90 → 11 | — |
| Inventario (HTML) | — | — | **207 → 68 KB** |

\* El resto son los ~150 enlaces de la lista completa de piezas, que están plegados por grupo y
miden 44 px de alto al abrirse.

Algunas páginas son más altas porque la letra es más grande y las tablas pasan a tarjetas. Es un
cambio buscado: se lee sin hacer zoom, y la barra inferior y los formularios plegados acortan el
camino a cada tarea.

## 5. Pendiente (recomendado por la literatura, no hecho todavía)

1. **Deshacer** en lugar de «¿Está seguro?» para acciones reversibles, por ejemplo «Gasto guardado ·
   Deshacer» [18][32]. Requiere borrar o revertir en el núcleo para cada tipo de registro.
2. **Indicador de progreso con palabras** en operaciones de más de 1 s que pasan en el bot, como
   «Leyendo boleta…» [22][24].
3. **Medir con el SUS** (sección 7) cada 3 meses, con el dueño y 1–2 ayudantes. La meta es ≥ 72
   («bueno») [35][36][37]. Conviene además cronometrar 5 tareas clave: registrar un gasto, abrir un
   viaje, cerrar un viaje, registrar un cambio de llanta y ver la liquidación.
4. **Onboarding con pistas en contexto** cuando se reactive el registro de usuarios [27][38].

## 6. Bibliografía (verificada)

1. Parhi, P., Karlson, A. K., & Bederson, B. B. (2006). Target size study for one-handed thumb use on small touchscreen devices. *MobileHCI '06*. https://doi.org/10.1145/1152215.1152260
2. Bergstrom-Lehtovirta, J., & Oulasvirta, A. (2014). Modeling the functional area of the thumb on mobile touchscreen surfaces. *CHI '14*. https://doi.org/10.1145/2556288.2557354
3. Hoober, S. (2013). How do users really hold mobile devices? *UXmatters*. https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
4. W3C (2023). *WCAG 2.2*. https://www.w3.org/TR/WCAG22/
5. Google. Material Design: Accessibility – touch targets. https://m2.material.io/design/usability/accessibility.html
6. Google. Material Design 3: Navigation bar. https://m3.material.io/components/navigation-bar/guidelines
7. Apple. Human Interface Guidelines: Accessibility. https://developer.apple.com/design/human-interface-guidelines/accessibility
8. Seckler, M., Heinz, S., Bargas-Avila, J. A., Opwis, K., & Tuch, A. N. (2014). Designing usable web forms. *CHI '14*. https://doi.org/10.1145/2556288.2557265
9. Wroblewski, L. (2009). Inline validation in web forms. *A List Apart*. https://alistapart.com/article/inline-validation-in-web-forms/
10. Scott, E. (2024). Usability testing of inline form validation. *Baymard Institute*. https://baymard.com/blog/inline-form-validation
11. Arditi, A., & Cho, J. (2007). Letter case and text legibility in normal and low vision. *Vision Research, 47*. https://doi.org/10.1016/j.visres.2007.06.010
12. Buchner, A., & Baumgartner, N. (2007). Text–background polarity affects performance irrespective of ambient illumination and colour contrast. *Ergonomics, 50*(7). https://doi.org/10.1080/00140130701306413
13. Piepenbrock, C., Mayr, S., Mund, I., & Buchner, A. (2013). Positive display polarity is advantageous for both younger and older adults. *Ergonomics, 56*(7). https://doi.org/10.1080/00140139.2013.790485
14. Pernice, K., & Budiu, R. (2016). Hamburger menus and hidden navigation hurt UX metrics. *NN/g*. https://www.nngroup.com/articles/hamburger-menus/
15. Hick, W. E. (1952). On the rate of gain of information. *QJEP, 4*(1). https://doi.org/10.1080/17470215208416600
16. Miller, G. A. (1956). The magical number seven, plus or minus two. *Psychological Review, 63*(2). https://doi.org/10.1037/h0043158
17. Cowan, N. (2001). The magical number 4 in short-term memory. *BBS, 24*(1). https://doi.org/10.1017/S0140525X01003922
18. Nielsen, J. (1994/2024). 10 usability heuristics for user interface design. *NN/g*. https://www.nngroup.com/articles/ten-usability-heuristics/
19. Few, S. (2006). *Information dashboard design*. O'Reilly. https://openlibrary.org/works/OL8167542W
20. Healey, C. G., & Enns, J. T. (2012). Attention and visual memory in visualization and computer graphics. *IEEE TVCG, 18*(7). https://doi.org/10.1109/TVCG.2011.127
21. Birch, J. (2012). Worldwide prevalence of red-green color deficiency. *JOSA A, 29*(3). https://doi.org/10.1364/JOSAA.29.000313
22. Nielsen, J. (1993). Response times: The 3 important limits. *NN/g*. https://www.nngroup.com/articles/response-times-3-important-limits/
23. Google/DoubleClick (2016). *The need for mobile speed*. https://www.thinkwithgoogle.com/_qs/documents/2340/bc22e_The_Need_for_Mobile_Speed_-_FINAL_1.pdf
24. Mejtoft, T., Långström, A., & Söderström, U. (2018). The effect of skeleton screens. *ECCE '18*. https://doi.org/10.1145/3232078.3232086
25. Medhi, I., Sagar, A., & Toyama, K. (2006). Text-free user interfaces for illiterate and semi-literate users. *ICTD 2006*. https://doi.org/10.1109/ICTD.2006.301841
26. Medhi, I., et al. (2011). Designing mobile interfaces for novice and low-literacy users. *ACM TOCHI, 18*(1). https://doi.org/10.1145/1959022.1959024
27. Kim, S., Lee, J., & Gweon, G. (2019). Comparing data from chatbot and web surveys. *CHI '19*. https://doi.org/10.1145/3290605.3300316
28. Henry, J. V., et al. (2016). Enhancing the supervision of community health workers with WhatsApp mobile messaging. *GHSP, 4*(2). https://doi.org/10.9745/GHSP-D-15-00386
29. NHTSA (2013). Visual-manual NHTSA driver distraction guidelines. *Federal Register, 78*(81). https://www.federalregister.gov/documents/2013/04/26/2013-09883/visual-manual-nhtsa-driver-distraction-guidelines-for-in-vehicle-electronic-devices
30. Olson, R. L., Hanowski, R. J., Hickman, J. S., & Bocanegra, J. (2009). *Driver distraction in commercial vehicle operations* (FMCSA-RRR-09-042). https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/DriverDistractionStudy.pdf
31. Dingus, T. A., et al. (2016). Driver crash risk factors and prevalence evaluation using naturalistic driving data. *PNAS, 113*(10). https://doi.org/10.1073/pnas.1513271113
32. Norman, D. A. (1988). *The psychology of everyday things*. Basic Books. https://openlibrary.org/works/OL1879162W
33. Hartung, C., et al. (2010). Open Data Kit: Tools to build information services for developing regions. *ICTD '10*. https://doi.org/10.1145/2369220.2369236
34. Kleppmann, M., Wiggins, A., van Hardenberg, P., & McGranaghan, M. (2019). Local-first software. *Onward! '19*. https://doi.org/10.1145/3359591.3359737
35. Brooke, J. (1996). SUS: A "quick and dirty" usability scale. https://doi.org/10.1201/9781498710411-35
36. Bangor, A., Kortum, P. T., & Miller, J. T. (2008). An empirical evaluation of the System Usability Scale. *IJHCI, 24*(6). https://doi.org/10.1080/10447310802205776
37. Bangor, A., Kortum, P., & Miller, J. (2009). Determining what individual SUS scores mean. *JUS, 4*(3). https://dl.acm.org/doi/10.5555/2835587.2835589
38. Evangelista, P., & Sweeney, E. (2006). Technology usage in the supply chain: The case of small 3PLs. *IJLM, 17*(1). https://doi.org/10.1108/09574090610663437
39. Theissler, A., et al. (2021). Predictive maintenance enabled by machine learning: Use cases and challenges in the automotive industry. *RESS, 215*. https://doi.org/10.1016/j.ress.2021.107864

**Huecos de la literatura:**

- No hay estudios verificables sobre fuentes monoespaciadas frente a proporcionales en interfaces.
- No hay estudios académicos sobre la adopción de software de flotas en pymes de Perú o
  Latinoamérica.

## 7. Cuestionario SUS (para medir cada 3 meses)

Responder de 1 (muy en desacuerdo) a 5 (muy de acuerdo):

1. Creo que usaría esta app con frecuencia.
2. La app me pareció innecesariamente complicada.
3. La app me pareció fácil de usar.
4. Creo que necesitaría ayuda de alguien que sepa para poder usarla.
5. Las funciones de la app están bien integradas.
6. Hay demasiadas cosas inconsistentes en la app.
7. Creo que la mayoría de la gente aprendería a usarla muy rápido.
8. La app me pareció muy engorrosa de usar.
9. Me sentí seguro usando la app.
10. Tuve que aprender muchas cosas antes de poder usarla.

**Cálculo del puntaje:**

1. En las preguntas impares, se resta 1 a la respuesta.
2. En las preguntas pares, se resta la respuesta de 5.
3. Se suman los 10 resultados y se multiplica por 2,5. Queda un puntaje de 0 a 100.

**Cómo leer el puntaje** [36][37]: alrededor de 68 es el promedio, 72 es «bueno» y 85 es
«excelente».
