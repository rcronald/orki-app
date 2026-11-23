# iNaturalist: fotos de referencia para el catálogo

Investigación del sub-issue #233 (padre #180): de dónde y cómo sacar una foto de referencia por especie del catálogo desde iNaturalist, en qué condiciones, con qué licencias y atribución, y cuántas especies quedarían cubiertas. Es trabajo de **solo lectura**: no se descargó ni se guardó ninguna imagen, ni se tocó la base ni la app. La herramienta de emparejamiento está en el importador del catálogo: `orki-catalogo emparejar-inaturalist` (ver [Herramienta de emparejamiento](#herramienta-de-emparejamiento)).

Todo lo que se afirma sobre iNaturalist lleva su fuente y la fecha de consulta. Las páginas de `www.inaturalist.org` responden a los clientes automáticos con un desafío de Cloudflare (HTTP 403, comprobado el 22 de noviembre de 2026), así que dos de ellas (prácticas recomendadas y condiciones de uso) se leyeron en la copia del Internet Archive más reciente, que se indica. Lo medido se distingue siempre de lo estimado.

## Resumen y recomendación

- **Licencias aceptadas:** **CC0**, **dominio público** (`pd`), **CC BY** y **CC BY-SA** (decisión del responsable tras esta investigación, comentario del 23 de noviembre de 2026 en #180). Con BY-SA, las versiones reducidas que genera Orki se publican con esa misma licencia, y así se indica. Fuera: las «no comercial» (NC), las «sin obra derivada» (ND) y «todos los derechos reservados». Esta investigación se hizo antes, con la decisión del 22 de noviembre (solo CC0 y CC BY): las cifras de cobertura de abajo son con esas dos licencias, así que la cobertura real con las cuatro es algo mayor (al menos las 682 fotos por defecto CC BY-SA y las 46 de dominio público de la tabla).
- **Vía:** la **API** (`api.inaturalist.org/v1`) para los metadatos, tanto en la carga inicial como en el mantenimiento. Para toda la familia son unas 115 peticiones de taxones y unas 610 de fotos de los taxones (medido), muy por debajo del tope diario de 10 000. El conjunto de datos abierto de AWS no trae la foto por defecto de cada taxón: solo fotos de observaciones, en un `photos.csv.gz` de 21 GB (ver [la comparación](#5-recomendación)).
- **Imágenes:** **copiarlas** a nuestro almacenamiento (Supabase Storage) desde el bucket abierto de AWS (`inaturalist-open-data.s3.amazonaws.com`), y no enlazarlas en caliente. Guardar **dos tamaños en WebP**: uno medio (500 px, a partir de `medium`) y una miniatura (unos 160 px, sacada del medio). La copia tiene que conservar el identificador de la foto, la licencia, el autor, el enlace y la fecha, y la reducción cuenta como modificación (hay que decirlo en la atribución).
- **Cobertura medida** (iNaturalist, 22 de noviembre de 2026; ver [Cobertura](#cobertura-medida)): solo el **7,0 %** de los 19 730 taxones activos de especie e híbrido tiene la foto por defecto con licencia aceptada. Buscando entre las fotos del taxón se llega al **17,1 %** en toda la familia; en los ocho géneros comunes, añadiendo observaciones con grado de investigación, al **28,7 %**. Es la cifra que más pesa en la decisión: con solo CC0 y CC BY, la mayoría de las especies se quedaba sin foto de referencia; por eso se añadieron CC BY-SA y dominio público, que no se volvieron a medir.

## 1. Cómo obtener la foto de cada taxón, con su licencia y su autor

### Por la API

Documentación: [API v1 (Swagger)](https://api.inaturalist.org/v1/docs/), cuyo texto está en `https://api.inaturalist.org/v1/swagger.json` (consultado el 22 de noviembre de 2026). Comprobado con peticiones reales ese mismo día.

- **Búsqueda de taxones**, `GET /v1/taxa`. Parámetros documentados: `q`, `is_active`, `id`, `parent_id`, `rank` (lista separada por comas, con los rangos `genus`, `genushybrid`, `species`, `hybrid`, `subspecies`, `variety`, `form`…), `rank_level`, `id_above`, `id_below`, `per_page` («The maximum value is generally 200»), `only_id`, `all_names`, `order` y `order_by` (`id`, `created_at`, `observations_count`). Además acepta `taxon_id` (el taxón y sus descendientes), que no está en la lista del Swagger pero funciona: `taxon_id=47217&rank=species` devolvió 19 185 resultados y `is_active=any` incluye los inactivos (22 173). **Medido.**
- **Paginación.** Las prácticas recomendadas dicen que `page` y `per_page` llegan a 10 000 resultados como mucho y que, para pasar de ahí, hay que ordenar por id (`order_by=id&order=asc`) y usar `id_above` con el último id de la página anterior ([API Recommended Practices](https://www.inaturalist.org/pages/api+recommended+practices), copia del Internet Archive del 16 de octubre de 2026, consultada el 22 de noviembre de 2026). Es lo que hace la herramienta.
- **Foto por defecto.** Cada taxón trae `default_photo` con `id`, `license_code` (`cc0`, `cc-by`, `cc-by-nc`, `cc-by-sa`, `cc-by-nd`, `cc-by-nc-sa`, `cc-by-nc-nd`, o `null` si son todos los derechos reservados), `attribution` («(c) Rodrigo Sala, some rights reserved (CC BY-ND)»), `attribution_name`, `url` (tamaño `square`), `square_url`, `medium_url`, `original_dimensions` y `flags`. **Medido** (taxón 47215, _Calypso bulbosa_).
- **Fotos del taxón.** `GET /v1/taxa/{ids}` (hasta 30 ids separados por comas: «A maximum of 30 results will be returned», Swagger) trae `taxon_photos`: las fotos que la comunidad eligió para el taxón, en orden, cada una con su licencia, su atribución, el enlace de origen (`native_page_url`, por ejemplo de Flickr) y las URL de todos los tamaños (`square_url`, `small_url`, `medium_url`, `large_url`, `original_url`). **Medido.**
- **Sinónimos.** Con `all_names=true`, cada taxón trae `names` con todos sus nombres; los científicos van con `lexicon = "scientific-names"` y los que no son válidos (`is_valid = false`) son sus sinónimos («Doritis pulcherrima» en _Phalaenopsis pulcherrima_). Los taxones inactivos traen `current_synonymous_taxon_ids`: los activos que los sustituyen. **Medido.**
- **Tamaños.** El Swagger dice: «Photos served from https://static.inaturalist.org and https://inaturalist-open-data.s3.amazonaws.com have multiple size variants […] the photo URL can be modified to replace only the size qualifier (each variant shares the exact same extension)». Tamaños: `original` (máximo 2048 px), `large` (1024), `medium` (500), `small` (240), `thumb` (100) y `square` (75 × 75). Y añade algo útil: «The domain a photo is hosted under reflects the license under which the photo is being shared […] Photos in the `inaturalist-open-data` domain are shared under open licenses […] Photos in the `static.inaturalist.org` domain do not have open licenses».
- **Página de cada foto:** `https://www.inaturalist.org/photos/{id}`; del taxón, `https://www.inaturalist.org/taxa/{id}`; de la observación, `https://www.inaturalist.org/observations/{id}` (formatos que da el propio conjunto de datos abierto, ver abajo).

### Por el conjunto de datos abierto (AWS)

Fuentes: [iNaturalist Licensed Observation Images, Registry of Open Data on AWS](https://registry.opendata.aws/inaturalist-open-data/), el [README del repositorio `inaturalist-open-data`](https://github.com/inaturalist/inaturalist-open-data) y su [descripción de las tablas](https://github.com/inaturalist/inaturalist-open-data/tree/main/Metadata) con `Metadata/structure.sql` (todo consultado el 22 de noviembre de 2026).

- **Qué es.** Un bucket público de S3 (`arn:aws:s3:::inaturalist-open-data`, región `us-east-1`, «No AWS account required») con las imágenes de observaciones que tienen licencia abierta, más unos metadatos en TSV comprimido. Licencia: «Creative Commons or Public Domain (CC0), varying by image».
- **Tablas** (TSV sin comillas: «beware there are single and double quotes in some fields, such as taxon names»):
  - `taxa.csv.gz`: `taxon_id`, `ancestry` (ids desde la raíz, separados por `/`), `rank_level`, `rank`, `name`, `active`. **No trae la foto por defecto ni los sinónimos.**
  - `photos.csv.gz`: `photo_uuid`, `photo_id`, `observation_uuid`, `observer_id`, `extension`, `license`, `width`, `height`, `position`. «All photos in the dataset have open licenses (e.g. Creative Commons) and unlicensed (CC0 / public domain)»: incluye también NC, ND y SA, que hay que filtrar.
  - `observations.csv.gz`: `observation_uuid`, `observer_id`, `latitude`, `longitude`, `positional_accuracy`, `taxon_id`, `quality_grade`, `observed_on`, `anomaly_score`.
  - `observers.csv.gz`: `observer_id`, `login`, `name` (para la atribución).
  - Además `projects` y `observations_projects`.
- **URL de cada tamaño:** `https://inaturalist-open-data.s3.amazonaws.com/photos/[photo_id]/medium.[extension]`, cambiando `medium` por `original`, `large`, `small`, `thumb` o `square` (los mismos tamaños de arriba).
- **Frecuencia:** «These files are a snapshot of iNaturalist observations and will be generated monthly»; las imágenes «are posted in real time». La última instantánea es del 27 de octubre de 2026 (fecha `Last-Modified` de los archivos, **medido**).
- **Tamaños de los archivos** (cabecera `Content-Length`, **medido** el 22 de noviembre de 2026): `taxa.csv.gz` 40 MB, `observers.csv.gz` 18 MB, `observations.csv.gz` 13,7 GB, `photos.csv.gz` 21,1 GB y el paquete `metadata/inaturalist-open-data-latest.tar.gz` 36,7 GB.

## 2. Límites y normas de uso

| Norma | Qué dice | Fuente |
| --- | --- | --- |
| Ritmo | «Please keep requests to about 1 per second, and around 10k API requests a day». El Swagger añade: «we throttle API usage to a max of 100 requests per minute, though we ask that you try to keep it to 60 requests per minute or lower, and to keep under 10,000 requests per day». Más allá, HTTP 429 y posible bloqueo de la IP. | Prácticas recomendadas (Internet Archive, 16 oct 2026) y Swagger (22 nov 2026) |
| Descargas masivas | «The API is meant to be used for building applications and for fetching small to medium batches of data. It is not meant to be a way to download data in bulk». «The API is intended to support application development, not data scraping». Para muchos datos recomiendan las exportaciones, el conjunto de GBIF o, para fotos, el conjunto abierto de AWS. | Prácticas recomendadas; Swagger |
| Imágenes | «Downloading over 5 GB of media per hour or 24 GB of media per day may result in a permanent block». | Prácticas recomendadas |
| Una sola IP | «Please use a single IP address for fetching data». | Prácticas recomendadas |
| `User-Agent` | «please consider using a custom User Agent to identify your application […] this could be set to the name of your app, an iNaturalist username, or anything we might use to differentiate your requests». | Prácticas recomendadas |
| Claves | No hacen falta para leer: la autenticación (JWT de 24 h) es para escribir o ver datos privados, y piden «Authenticate API requests only when required». | Prácticas recomendadas; Swagger |
| Condiciones | El uso de la API está sujeto a las [Terms of Use](https://www.inaturalist.org/pages/terms) (revisadas el 11 de julio de 2023; copia del Internet Archive del 27 de octubre de 2026). Prohíben usar los datos para entrenar IA comercial. Sobre las fotos: quien sube contenido conserva sus derechos y, si no elige otra cosa, lo licencia como CC BY-NC. | Condiciones de uso |
| Enlazar frente a copiar | **No encontré** ninguna norma explícita de iNaturalist sobre enlazar sus imágenes en caliente desde otra aplicación. Lo que sí dicen: el tope de descarga de medios de arriba, que el conjunto abierto existe para descargas masivas, y que el dominio de una foto «may change over time if the license changes» (Swagger), así que una URL enlazada puede dejar de valer. | — |

La herramienta cumple con esto (y la carga, `orki-catalogo cargar-fotos-inaturalist`, usa el mismo cliente para la API y las mismas reglas para las imágenes: una descarga por segundo como mucho, solo la versión `medium` del bucket abierto, el mismo `User-Agent`, reintentos con espera y un tope de 4 GiB al día, por debajo de los 5 GB por hora): una petición por segundo como mucho, un tope de 9 000 peticiones por día contado en la caché, `User-Agent` genérico (`orki-catalogo/0.1 (emparejamiento de fotos de referencia; solo lectura)`, sin nombre, correo ni repositorio de nadie), sin claves, solo `GET` a `api.inaturalist.org`, caché en disco y reintentos con espera ante 429 y 5xx.

## 3. Licencias y atribución

**Licencias en iNaturalist.** Cada foto tiene la licencia que eligió quien la subió; por defecto CC BY-NC; se puede elegir otra Creative Commons, CC0 o reservar todos los derechos («C»). Un cambio de licencia por defecto solo afecta a lo nuevo, salvo que se marque «Update existing…». Fuentes: [Can I use the photos and sounds that are posted on iNaturalist?](https://help.inaturalist.org/en/support/solutions/articles/151000169918), [How do licenses work on iNaturalist?](https://help.inaturalist.org/en/support/solutions/articles/151000173511) y [What are licenses? How can I update the licenses on my content?](https://help.inaturalist.org/en/support/solutions/articles/151000175695) (consultadas el 22 de noviembre de 2026). La ayuda añade que iNaturalist no puede decidir si un uso concreto cumple una licencia («consult a lawyer»).

**Versión de la licencia.** La API solo da el código (`cc-by`), sin versión. La ayuda enlaza la versión 4.0; **no pude confirmar** que todas las fotos sean 4.0 (las antiguas podrían ser de otra versión). Por eso el texto de atribución enlaza a la página de la foto, donde está la licencia exacta.

**Qué pide CC BY 4.0** ([texto legal, sección 3(a)](https://creativecommons.org/licenses/by/4.0/legalcode.en), consultado el 22 de noviembre de 2026): al compartir el material, también modificado, hay que conservar la identificación del autor (como pida, también con seudónimo), el aviso de derechos, la referencia a la licencia y a la exención de garantías, y un enlace al material «to the extent reasonably practicable»; **indicar si se modificó**; e indicar la licencia con su texto o enlace. Se puede cumplir «in any reasonable manner based on the medium, means, and context» (3(a)(2)), y si el autor lo pide hay que quitar la atribución (3(a)(3)). La sección 2(a)(6) prohíbe dar a entender que el autor respalda el uso. Reducir y convertir a WebP es una modificación: se dice «adaptada».

**CC0** no exige atribución, pero el conjunto abierto propone darla igual: «Photos with a CC0 license can be attributed as "[observer name, or observer login], no rights reserved (CC0)"», y para las demás «"© [observer name, or observer login], some rights reserved ([license abbreviation])"» ([README del conjunto abierto](https://github.com/inaturalist/inaturalist-open-data)).

**Qué pide iNaturalist además.** Nada específico para las fotos más allá de la licencia de cada una. Para las marcas: las condiciones de uso no dan permiso para usar el logotipo ni la marca iNaturalist; se puede nombrar como fuente, pero no usar su logotipo.

**La foto por defecto con licencia no aceptada.** Pasa casi siempre (ver [Cobertura](#cobertura-medida)). La herramienta busca otra en dos pasos:

1. Entre las fotos del taxón (`taxon_photos` de `GET /v1/taxa/{ids}`, 30 taxones por petición), la primera con licencia aceptada y sin marcas.
2. Si no hay, en observaciones del taxón con grado de investigación y al menos una foto con licencia aceptada: `GET /v1/observations?taxon_id=…&photo_license=cc-by,cc-by-sa,cc0&quality_grade=research&photos=true&order_by=votes&order=desc&per_page=10` (el filtro `photo_license` documenta las licencias CC y `cc0`, no la marca de dominio público, así que una foto `pd` de observación no se busca) (una petición por taxón). `taxon_id` incluye los descendientes, también los híbridos que cuelgan de la especie (pidiendo _Calypso bulbosa_ salió _Calypso bulbosa_ × _kostiukiae_, **medido**): se aceptan solo las del propio taxón o de una subespecie, variedad o forma suya, y la primera foto con licencia aceptada, sin marcas ni oculta. La atribución se construye con el nombre del observador (o su usuario), porque la de una foto CC0 de observación es solo «no rights reserved».

Una foto de observación no la eligió la comunidad como representativa del taxón (puede ser una hoja o una cápsula): conviene revisarlas en el backoffice.

### Texto de atribución propuesto

En la app, junto a la foto o a un toque, siempre con la marca de foto de referencia:

> Foto de referencia: © Ana Pérez, CC BY, vía iNaturalist (adaptada)

con «Ana Pérez» enlazando a la página de la foto (`https://www.inaturalist.org/photos/{id}`) y «CC BY» a la licencia (`https://creativecommons.org/licenses/by/4.0/`). Con CC0: «Foto de referencia: Ana Pérez, sin derechos reservados (CC0), vía iNaturalist»; con dominio público, «…, dominio público, vía iNaturalist»; con CC BY-SA, como con CC BY y «CC BY-SA» enlazando a `https://creativecommons.org/licenses/by-sa/4.0/`, y además hay que decir que la versión adaptada se publica con esa misma licencia (CC BY-SA 4.0, sección 3(b)). La carga guarda en la base un texto que ya lo lleva todo (ver [su README](../scripts/catalog-import/README.md#atribución)). El autor es `attribution_name` o, en las de observaciones, el nombre del observador o su usuario. El reporte de la herramienta ya trae este texto en la columna `atribucion` (sin «de referencia» ni «adaptada», que dependen de dónde y cómo se muestre).

En «Créditos y fuentes»:

> **Fotos de referencia de las especies.** Proceden de [iNaturalist](https://www.inaturalist.org) y de su conjunto de datos abierto en AWS. Cada una es obra de su autor, que conserva sus derechos, y se usa con la licencia que eligió: [CC0](https://creativecommons.org/publicdomain/zero/1.0/), [dominio público](https://creativecommons.org/publicdomain/mark/1.0/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) o [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Orki las reduce y las convierte a WebP; las versiones reducidas de las fotos CC BY-SA se publican con esa misma licencia. El autor y la licencia de cada foto se muestran junto a ella, con un enlace a la original. Son fotos de referencia: pueden no coincidir con la planta de cada colección y pueden estar mal identificadas en origen. iNaturalist no respalda Orki. Si eres autor de una foto y quieres que la quitemos o cambiemos su atribución, escríbenos.

## 4. Híbridos, variedades y nombres

Comprobado en la API el 22 de noviembre de 2026 (**medido**, Orchidaceae, taxón 47217):

| Rango | Taxones | Ejemplos |
| --- | ---: | --- |
| `species` (activos) | 19 185 | _Calypso bulbosa_ |
| `hybrid` | 545 | «Cypripedium × andrewsii», «Epidendrum × obrienianum» |
| `genushybrid` | 29 | «× Beallara», «× Brassidium», «× Aliceara» |
| `genus` | 707 | |
| `variety` / `subspecies` / `form` | 361 / 655 / 19 | «Calypso bulbosa americana» (sin «var.») |
| Especies e híbridos, activos e inactivos | 22 842 | |

- El signo es «×» (U+00D7) **suelto, con espacios**: «Phalaenopsis × intermedia», «× Beallara». Es la misma forma que el importador (`normalize_name`), así que la clave de emparejamiento (`match_key`: sin el signo, sin mayúsculas) casa los dos lados sin más.
- Los híbridos de vivero (grex, la lista curada) **no** son taxones de iNaturalist: «Phalaenopsis Sogo Yukidian» no empareja, como se esperaba en #180. Sí hay 29 nothogéneros (`genushybrid`), pero no grex dentro.
- Los infraespecíficos se escriben **sin marcador** de rango («Calypso bulbosa americana»); el catálogo no los importa, y sus sinónimos de rango inferior conservan el marcador («Cattleya labiata f. alba»), así que no se emparejan con especies.
- **Sinónimos:** los nombres científicos no válidos de cada taxón (`names` con `is_valid = false`) y los taxones inactivos con `current_synonymous_taxon_ids`. iNaturalist sigue su propia taxonomía (en plantas, en general la de POWO/WCVP, la misma fuente de la mayoría de los nombres de COL; no lo pude confirmar en una página oficial durante esta investigación), así que coinciden casi siempre, pero no siempre: _Phalaenopsis braceana_ es a la vez un taxón activo (1598483) y un nombre inactivo que apunta a _P. taenialis_ (852336). Gana siempre el nombre aceptado.

## 5. Recomendación

### API o conjunto de datos abierto

| | API | Conjunto abierto (AWS) |
| --- | --- | --- |
| Foto por defecto del taxón | Sí (`default_photo`) | No |
| Fotos elegidas del taxón | Sí (`taxon_photos`) | No |
| Sinónimos e inactivos | Sí | Solo `active`, sin sinónimos |
| Licencia y autor | Sí, por foto | Sí (`photos.license`, `observers`) |
| Volumen para Orchidaceae | 115 peticiones de taxones (unos 50 MB de JSON) + unas 610 de fotos del taxón + hasta unas 10 100 de observaciones (medido, ver abajo) | Descargar y filtrar 21 GB de `photos.csv.gz` y 13,7 GB de `observations.csv.gz` |
| Actualización | Al momento | Mensual |
| Imágenes | Las URL apuntan al mismo bucket abierto | El bucket |

**Recomendación:** la **API** para los metadatos, en la carga inicial y en el mantenimiento, con la herramienta tal como está (caché, ritmo, tope y reanudación). El conjunto abierto no da la foto por defecto, que es lo que más vale (la eligió la comunidad como representativa), y obliga a procesar 35 GB para unas decenas de miles de filas. Las **imágenes** se descargan del bucket abierto (`inaturalist-open-data.s3.amazonaws.com`, que es donde apuntan las URL de las fotos con licencia abierta), muy por debajo del tope de 5 GB por hora (ver la estimación).

Mantenimiento: repetir el emparejamiento (por ejemplo, cada mes, como la instantánea del conjunto abierto) con la caché vacía o caducada, y comparar por `foto_id`: si la foto elegida cambió de licencia o desapareció, sustituirla o quitarla.

### Copiar o enlazar

**Copiar**, por tres motivos: la app es una PWA que tiene que funcionar sin conexión y con un presupuesto de tamaño y de LCP (enlazar dependería de un tercero en cada vista); enlazar en caliente cargaría a iNaturalist en cada visita de cada usuario, y el dominio de una foto cambia si cambia su licencia (Swagger), lo que rompería el enlace o, peor, mostraría una foto cuya licencia ya no es la que guardamos. La copia exige guardar, por foto, el `photo_id`, la licencia, el autor, la URL de la página de la foto (y de la observación, si sale de ahí), la fecha de obtención y que está adaptada.

### Tamaños

- **Medio:** WebP de 500 px de lado mayor, a partir de `medium` (el original pesa mucho más y no hace falta para una foto de referencia).
- **Miniatura:** WebP de unos 160 px, sacada del medio (para listas y el buscador).

Medido el 22 de noviembre de 2026 con una muestra de 21 fotos de _Phalaenopsis_ (solo la cabecera `Content-Length`, sin descargarlas): JPEG `medium` 101 KB de media, `small` 32 KB y `large` 340 KB. **Estimado:** en WebP de calidad media, unos 60 KB el medio y 10 KB la miniatura, unos **70 KB por especie**.

### Estimación de almacenamiento y de tiempo

Todo esto es **estimado** a partir de las cifras medidas de cobertura y tamaño (ver [Cobertura](#cobertura-medida)):

- **Alcance inicial** (los ocho géneros comunes): 520 taxones con foto usable (medido) × 70 KB ≈ **36 MB**.
- **Catálogo entero** (32 464 especies): 3 372 taxones con foto usable sin buscar en observaciones (medido); con observaciones, unos 4 500 (**estimado**: el 11 % de éxito medido en los géneros comunes aplicado a los 10 132 taxones que quedan con alguna observación). 4 500 × 70 KB ≈ **315 MB**. Cabe en el 1 GB del plan gratuito, pero con poco margen si se suman las fotos de las plantas de los usuarios.
- **Supabase** ([precios](https://supabase.com/pricing), consultado el 22 de noviembre de 2026): el plan gratuito incluye 1 GB de almacenamiento de archivos y 5 GB de transferencia; Pro, 100 GB y 250 GB (después, 0,0213 $ por GB al mes y 0,09 $ por GB). Las transformaciones de imagen de Supabase no entran en el plan gratuito: la reducción a WebP la tiene que hacer el proceso de carga.
- **Tiempo** (medido): los metadatos de toda la familia con las fotos de los taxones fueron 946 peticiones (115 de taxones y el resto de fotos; unas 210 se repitieron por un cambio en el orden de los lotes durante el desarrollo, así que lo justo son unas 730) y tardaron en conjunto 1 h 15 min, porque cada respuesta de `/v1/taxa/{ids}` tarda unos 5 s. Las búsquedas en observaciones de los ocho géneros comunes fueron 1 094 peticiones en 21 min. Para toda la familia harían falta unas 10 100 más (los taxones sin foto aceptada que tienen alguna observación): **estimado**, unas 3 h 15 min, repartidas en dos días por el tope diario. La descarga de imágenes (**estimado**), a una por segundo: unos 520 archivos `medium` para el alcance inicial (unos 9 min, 53 MB) y unos 4 500 para la familia entera (1 h 15 min, unos 450 MB), muy por debajo de los 5 GB por hora y de los 24 GB por día.

## Cobertura medida

Medido el 22 de noviembre de 2026 con `orki-catalogo emparejar-inaturalist` contra la API real. Dos recorridos:

1. **Familia entera** (taxón 47217, `--alternativas taxon`): 22 842 taxones leídos (especie e híbrido, activos e inactivos), de ellos 19 730 activos (19 185 especies y 545 híbridos).
2. **Los ocho géneros comunes** (`--generos-comunes --alternativas observaciones`): 1 976 taxones leídos, 1 812 activos.

### Licencia de la foto por defecto (familia entera, 19 730 taxones activos)

| Foto por defecto              | Taxones |      % |
| ----------------------------- | ------: | -----: |
| Sin foto                      |   7 018 |   35,6 |
| CC BY-NC                      |   6 290 |   31,9 |
| Todos los derechos reservados |   3 353 |   17,0 |
| **CC BY**                     | **1 146** | **5,8** |
| CC BY-SA                      |     682 |    3,5 |
| CC BY-NC-SA                   |     608 |    3,1 |
| CC BY-NC-ND                   |     345 |    1,7 |
| **CC0**                       | **228** | **1,2** |
| Dominio público (`pd`)        |      46 |    0,2 |
| CC BY-ND                      |      14 |    0,1 |

De los 7 018 sin foto, 6 073 no tienen ninguna observación. Con las fotos del taxón se recuperan 1 998 más (1 761 CC BY y 237 CC0): **3 372 taxones con foto usable, el 17,1 %**.

### Alcance inicial (los ocho géneros, con observaciones)

| Género | Taxones activos | Por defecto aceptada | Por defecto no aceptada | Sin foto | Con foto usable (solo taxón) | Con foto usable (taxón y observaciones) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Phalaenopsis | 86 | 9 | 62 | 15 | 21 (24,4 %) | 23 (26,7 %) |
| Cattleya | 128 | 10 | 99 | 19 | 24 (18,8 %) | 47 (36,7 %) |
| Dendrobium | 755 | 73 | 521 | 161 | 177 (23,4 %) | 231 (30,6 %) |
| Oncidium | 202 | 17 | 140 | 45 | 67 (33,2 %) | 90 (44,6 %) |
| Vanda | 87 | 8 | 51 | 28 | 23 (26,4 %) | 27 (31,0 %) |
| Cymbidium | 69 | 3 | 45 | 21 | 17 (24,6 %) | 24 (34,8 %) |
| Paphiopedilum | 146 | 1 | 86 | 59 | 4 (2,7 %) | 11 (7,5 %) |
| Masdevallia | 339 | 20 | 171 | 148 | 31 (9,1 %) | 67 (19,8 %) |
| **Total** | **1 812** | **141** | **1 175** | **496** | **364 (20,1 %)** | **520 (28,7 %)** |

De las 520: 141 por defecto, 223 del taxón y 156 de observaciones. Las observaciones solo dieron foto en 156 de unas 1 450 búsquedas (11 %).

### Lado del catálogo: qué es medido y qué es estimado

- **Medido, pero con un catálogo pequeño.** En este equipo no está la exportación de COL (137 MB) ni hay acceso a la base, así que el catálogo de entrada fue el que el importador sabe producir en local: la muestra de pruebas (10 especies reales de COL26.10 XR) y la lista curada de híbridos (76 grex). En la familia entera, 7 de las 10 especies de la muestra emparejan por nombre aceptado y 3 de ellas acaban con foto aceptada; los 76 grex quedan `sin_taxon`, como se esperaba. No son cifras representativas del catálogo.
- **Estimado.** Lo que importa es el lado de iNaturalist: el catálogo tiene 32 464 especies e iNaturalist 19 730 taxones activos de especie e híbrido. Si casi todos estos emparejan (los dos siguen en buena parte la WCVP de Kew; no lo comprobé), las especies del catálogo con foto usable serían unas **3 400 (10 %) sin observaciones y unas 4 500 (14 %) con ellas**; en los ocho géneros, unas 520. Las **especies que ya están en alguna colección** no se pudieron medir: hace falta la exportación de la base con la columna `plantas` (formato en el README del importador).
- **Para tener las cifras reales:** descargar la exportación de COL como dice el README del importador y ejecutar `uv run orki-catalogo emparejar-inaturalist --catalogo /tmp/col-316691.zip --catalogo data/hibridos.csv` (con la caché de esta investigación, unos segundos; sin ella, más de una hora), o lo mismo con la exportación de la base.

## Herramienta de emparejamiento

`orki-catalogo emparejar-inaturalist`, en `scripts/catalog-import` (detalle en [su README](../scripts/catalog-import/README.md#emparejamiento-con-inaturalist)). Lee los taxones de iNaturalist por la API con caché, los empareja con el catálogo usando la normalización del importador y los sinónimos, clasifica la licencia de la foto, busca alternativas y escribe un reporte CSV y un resumen. No descarga imágenes ni se conecta a ninguna base.

Por qué casi la mitad de las especies de la primera carga quedan sin taxón (ausencia real en iNaturalist, no un fallo del emparejamiento) está medido en [inaturalist-emparejamiento.md](inaturalist-emparejamiento.md).

La carga de las fotos (#234) es `orki-catalogo cargar-fotos-inaturalist`, en el mismo paquete ([su README](../scripts/catalog-import/README.md#fotos-de-referencia)): empareja el catálogo de la base con el mismo código y la misma caché, elige la foto con las cuatro licencias aceptadas, la descarga del bucket abierto, la convierte a WebP sin metadatos, la sube a Storage y escribe las filas en una transacción.

## Riesgos y decisiones pendientes

**Legales** (para que decida el responsable):

1. **La cobertura con CC0 y CC BY es baja** (17 % de los taxones; 29 % en los géneros comunes con observaciones). **Decidido** (23 de noviembre de 2026): se acepta **CC BY-SA** (al menos 682 fotos por defecto más), y las adaptaciones (la versión media y la miniatura WebP lo son) se publican con la misma licencia. **CC BY-NC** (6 290 por defecto) solo serviría si Orki no es ni será comercial; queda fuera por decisión.
2. **Dominio público (`pd`)**: 46 fotos por defecto llevan la marca de dominio público. **Decidido** (23 de noviembre de 2026): se acepta, como CC0.
3. **Versión de la licencia:** la API no la da; la ayuda enlaza la 4.0. No confirmado para las fotos antiguas: la atribución enlaza a la página de la foto, que muestra la exacta.
4. **Atribución y retirada:** CC BY exige autor, licencia, enlace e indicar la modificación, y quitar la atribución si el autor lo pide (3(a)(3)). Hace falta poder quitar o sustituir una foto desde el backoffice (#180 ya lo prevé) y un contacto en «Créditos y fuentes».
5. **Cambios de licencia en origen:** un autor puede cambiar la licencia después. Una licencia CC no se puede revocar para lo ya obtenido, pero conviene guardar la fecha de obtención, revisar periódicamente y retirar si el autor lo pide.
6. **Condiciones de uso de iNaturalist:** no encontré una norma sobre enlazar en caliente ni sobre copiar fotos con licencia abierta más allá de la licencia de cada foto; sí el tope de medios (5 GB por hora, 24 GB por día) y la prohibición de usar sus datos para entrenar IA comercial. No pude leer en directo `www.inaturalist.org` (Cloudflare): las prácticas recomendadas y las condiciones se leyeron en copias del Internet Archive de octubre de 2026.
7. **Marca:** se puede nombrar a iNaturalist como fuente, pero no usar su logotipo ni dar a entender que respalda Orki.

**Técnicos:**

1. **Fotos de observaciones:** no las eligió la comunidad como representativas (pueden ser una hoja, un fruto o una planta mal identificada). Revisar las `de_observacion` antes de publicarlas, o empezar solo con las `por_defecto` y `del_taxon`.
2. **Identificación errónea en origen:** etiquetar siempre como foto de referencia y permitir quitarla (previsto en #180).
3. **Taxonomías distintas:** iNaturalist y COL no coinciden siempre (por ejemplo, _Phalaenopsis braceana_ es a la vez taxón activo y nombre inactivo). La herramienta prioriza el nombre aceptado y deja como `ambiguo` lo dudoso; los ambiguos hay que revisarlos a mano.
4. **Caché sin caducidad:** el mantenimiento tiene que empezar con la caché vacía; si no, repite datos antiguos.
5. **API lenta e inestable:** `/v1/taxa/{ids}` tarda unos 5 s por respuesta y en la primera ejecución hubo un corte de TLS (ahora los fallos de red se reintentan). Un recorrido completo lleva más de una hora; la herramienta es reanudable.
6. **Almacenamiento y transferencia:** los unos 315 MB estimados para la familia caben en el 1 GB del plan gratuito de Supabase, junto a las fotos de las plantas; la transferencia (5 GB en el plan gratuito) puede ser el límite real si muchas vistas cargan fotos de referencia: miniatura en las listas y tamaño medio solo en la ficha.
7. **URL del bucket abierto:** el dominio de una foto cambia si cambia su licencia (Swagger); es otro motivo para copiarlas y no enlazarlas.
