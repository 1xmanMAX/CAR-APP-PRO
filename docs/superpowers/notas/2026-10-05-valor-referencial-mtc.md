# Valor referencial MTC para la factura 1004

Estado: **VERIFICADA** en lo esencial (norma vigente leída). Dos puntos son inferencia nuestra y se marcan abajo.

## Fuentes
- D.S. 020-2021-MTC (12/06/2021, El Peruano, norma 1962212-2; vigente desde 01/07/2021). PDF leído el 2026-10-05: https://cdn.www.gob.pe/uploads/document/file/1950396/DS%20020-2021-MTC.pdf.pdf?v=1623856026 (ficha: https://www.gob.pe/institucion/mtc/normas-legales/1967222-020-2021-mtc). **Deroga expresamente** el D.S. 010-2006-MTC y el D.S. 033-2006-MTC (Disposición Complementaria Derogatoria Única). La tabla que cita la guía XML de SUNAT ("Anexo II del D.S. 010-2006-MTC") quedó desactualizada.
- D.S. 011-2023-MTC (18/07/2023, El Peruano, NL 2197008-4): https://busquedas.elperuano.pe/dispositivo/NL/2197008-4 . Solo modifica el segundo párrafo del art. 9 y los Anexos I y II (valores por TM). No toca los arts. 3 ni 4 ni el Anexo III. Puede haber actualizaciones anuales posteriores de los Anexos I y II (no revisadas aquí; solo cambian los S/ por TM).
- SUNAT, Orientación, "Detracciones en el transporte de bienes por vía terrestre" (leída 2026-10-05): https://orientacion.sunat.gob.pe/detracciones-en-el-transporte-de-bienes-por-via-terrestre . Remite al D.S. 020-2021-MTC y a la R.S. 073-2006/SUNAT.
- SUNAT, estructuras y reglas de validación de la factura electrónica 2.1 (archivos locales descargados antes): regla 1004, errores 3122 a 3126 y 4272; campos .DET "tipReferencialServicio 01 / varReferencialServicio", "tipCargaEfectiva 02", "tipCargaUtil 03".
- No leí el texto de la R.S. 073-2006/SUNAT ni de la R.S. 183-2004/SUNAT directamente (solo lo que resume la página de Orientación).

## Definiciones (citadas textualmente)
La norma no define los tres códigos 01/02/03 con esos nombres. Define el valor referencial y su piso; los nombres de los códigos vienen de SUNAT. Textos:

- Valor referencial del servicio de transporte (DeliveryTerms 01): D.S. 020-2021-MTC, art. 3, segundo y tercer párrafo: "El valor referencial del servicio de transporte de bienes por carretera se obtiene de multiplicar el valor por tonelada (TM) indicado en las tablas del Anexo II que corresponda a la ruta en que se realiza el transporte por la carga efectiva que transporta el vehículo. En ningún caso dicho valor puede ser inferior al que corresponda al 70% de la capacidad de carga útil nominal del vehículo conforme al Anexo III." Es decir, el valor final del servicio ya incluye el piso del 70 %. (Asignar esta definición al código 01 es inferencia nuestra, coherente con la regla SUNAT 3124 y con la página de Orientación.)
- Valor referencial sobre la carga efectiva (DeliveryTerms 02): es la multiplicación base del art. 3: "multiplicar el valor por tonelada (TM) [...] por la carga efectiva que transporta el vehículo". SUNAT Orientación: "Dicho valor referencial se obtiene de multiplicar el valor por tonelada métrica (TM) establecido en las Tablas de valores publicadas en el D.S. N° 020-2021-MTC y norma modificatoria, por la carga efectiva de acuerdo a la ruta a la que corresponde el servicio."
- Valor referencial sobre la carga útil nominal (DeliveryTerms 03): el mismo valor por TM por la capacidad de carga útil nominal del vehículo del Anexo III ("TABLA DE DETERMINACIÓN DE CARGA ÚTIL EN FUNCIÓN A LAS CONFIGURACIONES VEHICULARES CONTEMPLADAS EN EL REGLAMENTO NACIONAL DE VEHÍCULOS", de 10 t para C2 hasta 30 t para T3S3 y similares). La norma solo menciona la capacidad nominal como base del piso (art. 3, último párrafo). Que el campo 03 sea valor por TM x carga útil nominal (sin el 70 %) es inferencia nuestra: no hay texto de SUNAT/MTC que lo defina.
- Regla de carga mínima: SÍ existe, y es 70 %, no 90 %. Art. 3, último párrafo: "En ningún caso dicho valor puede ser inferior al que corresponda al 70% de la capacidad de carga útil nominal del vehículo conforme al Anexo III." SUNAT Orientación: "el monto de valor referencial no puede ser inferior al 70% de la capacidad de carga útil nominal del vehículo".

Otras reglas que afectan el cálculo (no estaban en la fórmula provisional):
- Art. 4, factor de retorno al vacío: "El valor del servicio de transporte de bienes por carretera que se obtenga mediante la aplicación de la fórmula indicada en el artículo precedente y siempre que la ruta exceda los 200 kilómetros virtuales, es multiplicada por el factor de retorno al vacío equivalente a 1.4", para: contenedores llenos en un sentido y vacíos en el otro; cargas peligrosas; cargas líquidas en cisterna; cargas a granel en tolvas con mecanismo de descarga propio; furgones refrigerados; vehículos acondicionados para transportar otros vehículos (cigüeñas).
- SUNAT Orientación: el valor referencial preliminar se determina "por cada viaje [...] y por cada vehículo utilizado para la prestación del servicio, siendo la suma de dichos valores el valor referencial correspondiente al servicio prestado".
- SUNAT Orientación: "el monto del depósito resulta de aplicar el porcentaje de cuatro por ciento (4%) sobre el importe de la operación o el valor referencial, el que resulte mayor."
- Arts. 5 y 7: rutas que no son desde/hacia Lima-Callao se calculan por diferencia o suma de tramos del Anexo II; si el origen o destino no está en las tablas, "no es exigible la determinación del valor referencial" y el 4 % se aplica sobre el importe de la operación.
- SUNAT Orientación: no hay valor referencial cuando "los bienes transportados en un mismo vehículo correspondan a dos (2) o más usuarios".

## Fórmula que implementa la app
VR02 = vrPorTm × cargaEfectivaTm
VR03 = vrPorTm × cargaUtilNominalTm
VR01 = max(VR02, 0.70 × VR03)    (FACTOR_CARGA_UTIL_MINIMA = 0.70; art. 3 D.S. 020-2021-MTC)
Cada VR se redondea a 2 decimales (formato n(12,2) de SUNAT). Si el viaje aplica retorno al vacío (ruta > 200 km virtuales y uno de los supuestos del art. 4), vrPorTm se multiplica por 1.4 antes de calcular VR01, VR02 y VR03 (la norma multiplica "el valor del servicio"; por linealidad es equivalente para VR01 y VR02; para VR03 es inferencia, ver abajo).
Base de la detracción = max(importe de la operación con IGV, VR01)
Detracción = 4 % × base, redondeada a soles enteros (el redondeo a entero viene del plan; no lo verifiqué en las fuentes de arriba)

## Caso numérico
vrPorTm = S/ 85.50, carga efectiva = 31.87 TM, carga útil nominal = 30.00 TM, total factura = S/ 2,500.00
VR02 = 85.50 × 31.87 = 2,724.885 -> S/ 2,724.89 (redondeo half-up)
VR03 = 85.50 × 30.00 = S/ 2,565.00
VR01 = max(2,724.89, 0.70 × 2,565.00 = 1,795.50) = S/ 2,724.89
base = max(2,500.00, 2,724.89) = S/ 2,724.89
detracción = 4 % × 2,724.89 = 108.9956 -> S/ 109

Caso de piso (para la prueba de la Tarea 3): vrPorTm 85.50, carga efectiva 10.00 TM, carga útil nominal 30.00 TM, total S/ 2,500.00 -> VR02 = 855.00, VR03 = 2,565.00, VR01 = max(855.00, 1,795.50) = 1,795.50, base = 2,500.00, detracción = 100. Con el 0.9 provisional el VR01 sería 2,308.50, un valor distinto.

## ¿Coincide con la fórmula provisional max(VR02, 0.9 × VR03)?
No en el factor. La estructura max(VR02, k × VR03) es correcta, pero k = 0.70 (art. 3 del D.S. 020-2021-MTC), no 0.90. Cambia: `FACTOR_CARGA_UTIL_MINIMA = 0.7` y `FORMULA_VR_VERIFICADA = true`. Además la Tarea 3 debe contemplar, aunque sea como dato opcional: factor de retorno al vacío 1.4 (art. 4), suma por viaje y por vehículo cuando hay varios, y que la tabla de valores por ruta es la del D.S. 020-2021-MTC actualizada (Anexos I y II), no la del D.S. 010-2006-MTC.

Puntos que siguen siendo inferencia (no hay texto de SUNAT/MTC): (a) que el campo 03 sea valor por TM x carga útil nominal sin el 70 %; (b) cómo se refleja el factor 1.4 en los campos 02 y 03. La regla de validación de SUNAT no compara los tres montos entre sí (solo exige presencia, formato y unicidad: errores 3122 a 3126), así que ninguno de los dos puntos produce rechazo.
