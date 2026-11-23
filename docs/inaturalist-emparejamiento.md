# iNaturalist: por qué casi la mitad de las especies quedan «sin taxón»

Investigación del 23 de noviembre de 2026 sobre la carga de fotos de referencia en desarrollo (`orki-catalogo cargar-fotos-inaturalist`, alcance por defecto, `--alternativas observaciones`), que dejó **1 696 de 3 521 especies (48 %) como `sin_taxon`** y solo **5 emparejadas por sinónimo**. La pregunta: ¿falta el taxón en iNaturalist o se queda corto el emparejamiento (normalización, rangos leídos, sinónimos o géneros leídos)? Contexto general en [inaturalist.md](inaturalist.md).

Trabajo de **solo lectura**: peticiones `GET` sin autenticación a `api.inaturalist.org` (una por segundo, con el cliente, la caché y el `User-Agent` genérico de la orden) y a la API de ChecklistBank para los sinónimos de COL. Nada contra la base ni contra GitHub. Todo lo de iNaturalist se consultó el 23 de noviembre de 2026.

## Resumen

- **La ausencia es real.** En los ocho géneros comunes, la carga emparejó prácticamente **todos** los taxones activos que iNaturalist tiene: Masdevallia 339 de 339, Paphiopedilum 145 de 146, Phalaenopsis 85 de 86, Vanda 86 de 87, Cymbidium 68 de 69, Oncidium 200 de 202, Cattleya 125 de 128 y Dendrobium 740 de 755. Lo que sobra en nuestro catálogo (1 640 Dendrobium frente a 755, 673 Masdevallia frente a 339…) **no está en iNaturalist de ninguna forma**: iNaturalist solo crea taxones a medida que hacen falta y no tiene la mitad de las especies de la WCVP en estos géneros.
- **Muestra de 380 de las 1 696** (todas las que alguien tiene en su colección y un reparto proporcional por género y tipo), buscadas una a una por nombre en iNaturalist (`/v1/taxa?q=` y `/v1/taxa/autocomplete`, que resuelven sinónimos) y con sus sinónimos de COL: **362 no existen (95,3 %), 17 son grex (4,5 %) y 1 existe como sinónimo en otro género (0,3 %)**. Ninguna existe con el mismo nombre sin emparejar, ninguna como subespecie o variedad y ninguna por un sinónimo de COL.
- **Comprobación exhaustiva** de las 1 696 contra la familia entera de iNaturalist (22 845 taxones de especie e híbrido, activos e inactivos, con sus sinónimos): solo **1** se habría emparejado leyendo la familia (_Vanda coelestis_ → _Rhynchostylis coelestis_). Entre los 24 taxones activos de los ocho géneros que ninguna especie tomó, solo hay **1** variante ortográfica de una de las nuestras (_Dendrobium aurantiiflammeum_ frente a _D. aurantiflammeum_).
- **Fotos que se ganarían corrigiendo:** **ninguna** hoy. Los dos taxones recuperables no tienen ninguna foto del taxón con licencia aceptada (todas CC BY-NC o con todos los derechos reservados); solo quedaría la búsqueda en observaciones de _Rhynchostylis coelestis_ (43 observaciones), que no comprobé.
- **Decisión: no se cambia el emparejamiento.** No hay un defecto que valga su coste o su riesgo (detalle en [Decisión](#decisión)). Los 17 «ambiguos» están bien rechazados: 9 son homónimos en los sinónimos de COL y 8 son especies que iNaturalist une a otra que ya tiene su propia ficha.

## Por qué las cifras de partida engañaban

- **«3 665 taxones leídos frente a 3 521 especies».** Los 3 665 incluyen los inactivos y los cuatro géneros que entraron por las colecciones: Epidendrum (1 110 taxones en iNaturalist), Maxillaria (418), Lycaste (34) y Miltoniopsis (5), de los que en el alcance solo hay 27 especies nuestras. En los ocho géneros comunes iNaturalist tiene **1 812 taxones activos** y nuestro catálogo **3 494 especies**: la mitad no puede emparejar.
- **«Solo 5 por sinónimo de 59 422».** El sinónimo solo se usa cuando el nombre aceptado no empareja (1 803 emparejan así). De las 1 696 restantes, los 392 sinónimos de COL de las 363 especies de la muestra que COL devolvió no coinciden con ningún taxón activo de toda la familia en iNaturalist, y la búsqueda por nombre (que mira también los sinónimos de iNaturalist) solo encontró uno.

## Cómo empareja hoy (lectura del código)

`scripts/catalog-import/src/catalog_import/inaturalist.py`, `inaturalist_match.py`, `reference_photos.py` y `reference_photos_cli.py` (rama `main` del 23 de noviembre de 2026):

- **Qué se lee.** De cada género de las especies del alcance, todos los taxones de rango `species` e `hybrid`, activos e inactivos, con todos sus nombres (`all_names=true`); con `--leer-familia` o `--todo-el-catalogo`, la familia entera (taxón 47217). No se leen `subspecies`, `variety` ni `form`.
- **Normalización.** `match_key(normalize_name(...))`: espacios limpios, sin el signo «×» y sin mayúsculas. Los nombres no llevan autores en ninguno de los dos lados. No hay equivalencias ortográficas (`-ii`/`-i`, `sz`/`sc`).
- **Sinónimos, en los dos sentidos.** (1) Por nombre aceptado; (2) si no, un sinónimo nuestro que es el nombre de un taxón activo **o** nuestro nombre aceptado que iNaturalist tiene como sinónimo (`names` con `is_valid = false`) o como taxón inactivo con `current_synonymous_taxon_ids`. No cuentan los taxones que ya tomó otra especie por su nombre aceptado.
- **Ambiguo.** Varios taxones con el mismo nombre, varios taxones posibles por sinónimo, todos los candidatos ya tomados por otra especie, o varias especies que llegan por sinónimo al mismo taxón.
- **Alcance del emparejamiento.** Se emparejan todas las especies de la base cuyo género (o el de un sinónimo, o un nombre en el índice) está entre los leídos, para que las de fuera del alcance también reclamen su taxón.

## Método

1. **Reporte de partida:** `reporte-carga-fotos-dev-escritura-20261123T065643Z.csv` (3 521 filas). Forma del nombre de las 1 696 `sin_taxon`: 1 395 binomios de especie, 247 híbridos naturales («Cattleya × adrienne») y 54 grex o nombres de cultivo («Oncidium Twinkle», «Phalaenopsis Baldan's Kaleidoscope»).
2. **Familia entera de iNaturalist:** `GET /v1/taxa?taxon_id=47217&rank=species,hybrid&is_active=any&all_names=true&per_page=200&order_by=id&order=asc&id_above=…`, con el cliente de la orden (`iter_taxa`). **Medido:** 22 845 taxones (19 733 activos), 115 peticiones, 154 s, sin reintentos.
3. **Simulación exhaustiva** con el código de la orden (`TaxonIndex.build` y `match_catalog`) sobre los 3 521 nombres del reporte, una vez con los taxones de los 12 géneros leídos y otra con la familia entera. Limitación: el reporte no trae nuestros sinónimos, así que la simulación solo prueba el sentido «nombre aceptado nuestro frente a nombres y sinónimos de iNaturalist».
4. **Muestra estratificada** (semilla fija 20261123): las 27 `sin_taxon` que alguien tiene en su colección y 353 más repartidas en proporción a cada estrato (género × especie, híbrido natural o grex), con al menos una por estrato. 380 en total: 186 Dendrobium, 72 Masdevallia, 41 Oncidium, 37 Cattleya, 15 Cymbidium, 7 de cada uno de Phalaenopsis, Paphiopedilum y Vanda, y 8 de los demás.
5. **Búsqueda por nombre** de cada una, con dos peticiones: `GET /v1/taxa?q=<nombre>&is_active=any&per_page=30` y `GET /v1/taxa/autocomplete?q=<nombre>&is_active=any&per_page=30` (las dos devuelven `matched_term`, el nombre que casó, también si es un sinónimo). Se quedan solo los resultados de Orchidaceae. **Medido:** 794 peticiones en 804 s, sin reintentos (380 de la muestra y los 17 ambiguos).
6. **Sinónimos de COL** de cada una: `GET https://api.checklistbank.org/dataset/316691/nameusage/search?q=<nombre>&content=SCIENTIFIC_NAME` y `GET …/taxon/{id}/info` (sinónimos homotípicos, heterotípicos y mal aplicados), una petición por segundo y con un `User-Agent` genérico. COL26.10 XR devolvió 363 de los 380 nombres, con 392 sinónimos.
7. **Clasificación**, en este orden: (a) mismo nombre en iNaturalist (activo de especie o híbrido, inactivo con sustituto o de otro rango); (b) nuestro nombre es sinónimo en iNaturalist; (c) un sinónimo de COL es un taxón activo de la familia; (d) grex; (e) parecido para revisar a mano: subespecie, variedad o forma con el mismo epíteto, o epíteto a una distancia de edición de 2 o menos en el mismo género; (f) si nada de lo anterior, ausente. Los intervalos son de Wilson al 95 %.

Los guiones de la medición no están en el repositorio (eran de un solo uso); el método de arriba basta para repetirla.

## Resultados

### Muestra (380 de 1 696)

| Clase | En colección (27) | Proporcional (353) | Total (380) | % [IC 95 %] |
| --- | ---: | ---: | ---: | --- |
| No existe en iNaturalist de ninguna forma | 25 | 337 | **362** | 95,3 [92,6–97,0] |
| Grex o nombre de cultivo (ausencia esperada) | 2 | 15 | **17** | 4,5 [2,8–7,0] |
| Existe como sinónimo o bajo otro género | 0 | 1 | **1** | 0,3 [0,0–1,5] |
| Existe con el mismo nombre y no se emparejó | 0 | 0 | **0** | 0 [0–1,0] |
| Existe como subespecie, variedad o forma | 0 | 0 | **0** | 0 [0–1,0] |
| Un sinónimo de COL es un taxón de iNaturalist | 0 | 0 | **0** | 0 [0–1,0] |
| Parecido ortográfico (para revisar) | 0 | 0 | **0** | 0 [0–1,0] |

Extrapolado a las 1 696: los grex son **54** (contados en el reporte entero, no estimados); de las 1 642 restantes (especies e híbridos naturales), la muestra da 362 de 363 ausentes (99,7 %) y, como mucho (cota superior del intervalo, 1,5 %), unas 25 recuperables. La comprobación exhaustiva de abajo deja lo recuperable en **2**, así que las ausentes de verdad son **unas 1 640 (96,7 %)**, más los 54 grex (3,2 %).

Ejemplos de cada clase:

- **Ausentes, en colección:** _Dendrobium cleistanthum_, _Masdevallia xylina_, _Cymbidium codonanthum_, _Oncidium hieroglyphicum_, _Lycaste zacapana_, _Maxillaria atwoodiana_ y los híbridos naturales _Cattleya_ × _adrienne_, _Lycaste_ × _panchita_ y _Miltoniopsis_ × _bleui_: ni `q` ni `autocomplete` devuelven nada en Orchidaceae, ni como nombre ni como sinónimo.
- **Ausentes, resto:** _Dendrobium patulum_, _D. leporinum_, _D. gibbosum_, _Masdevallia ruthiana_, _M. tatianae_, _Oncidium hauensteinii_; híbridos naturales _Cattleya_ × _wendlandii_, _Cymbidium_ × _jingdongense_, _Paphiopedilum_ × _fordianum_.
- **Grex:** «Oncidium Twinkle» y «Phalaenopsis Baldan's Kaleidoscope» (en colección), «Cattleya Bow Bells», «Paphiopedilum Magic Lantern», «Vanda Sansai Blue».
- **Sinónimo en otro género:** _Vanda coelestis_ es en iNaturalist un taxón inactivo (1483722) sustituido por _Rhynchostylis coelestis_ (1644687). Rhynchostylis no está entre los géneros leídos, así que el índice no lo tenía.

### Exhaustiva (las 1 696 contra la familia entera)

- **Mismo nombre, otro rango, inactivos y sinónimos de iNaturalist:** con el índice de la familia entera, **1** de las 1 696 cambia (la _Vanda coelestis_ de arriba). Las otras 1 695 no tienen en toda la familia ningún taxón, activo o inactivo, ni ningún sinónimo con su nombre.
- **Taxones de iNaturalist que nadie tomó.** En los ocho géneros comunes quedan 24 taxones activos sin especie nuestra (por ejemplo _Dendrobium radiatum_, _Oncidium suave_ y _Phalaenopsis hygrochila_, que en nuestro catálogo serán sinónimos de especies que ya emparejaron por su nombre). Solo uno se parece a una `sin_taxon`: **_Dendrobium aurantiflammeum_** (1096679) en iNaturalist frente a nuestro _D. aurantiiflammeum_: la misma especie con la vocal de unión corregida. El otro parecido (_D. sinense_ frente a _D. buinense_ y _D. tunense_) es otra especie.

### Los 17 ambiguos

Todos están bien rechazados: darles la foto del candidato sería poner la foto de otra especie de nuestro catálogo.

- **9 por homónimos en nuestros sinónimos** (COL los marca «ambiguous synonym» o son de otro autor): el catálogo guarda los sinónimos sin autor y el nombre choca con una especie aceptada que ya emparejó. Por ejemplo, _Cattleya braemii_ tiene como sinónimo «Cattleya gaskelliana Braem», que no es _C. gaskelliana_ (N.E.Br.) B.S.Williams; _Dendrobium kirchianum_ tiene «Dendrobium bulbophylloides J.J.Sm.» y _Oncidium khoochongyeei_, «Oncidium vierlingii Königer». Los demás: _Dendrobium obreniforme_, _D. puniceum_, _D. summerhayesianum_, _Masdevallia melanopus_, _Oncidium_ × _baronii_ y _O. sathishkumarii_.
- **8 porque iNaturalist une dos especies que nosotros separamos:** en iNaturalist, _Paphiopedilum leucochilum_ es sinónimo de _P. godefroyae_, _Masdevallia fonsecae_ de _M. attenuata_, _M. vittatula_ de _M. biflora_, _M. calosiphon_ de _M. fuchsii_, _Dendrobium brevimentum_ de _D. militare_, _D. bursigerum_ de _D. secundum_ y _D. platycaulon_ de _D. compressum_; _D. cerinum_ lo es de dos (_D. sanguinolentum_ y _D. austrocaledonicum_). Todas esas ya tienen su ficha y su foto.

No encontré una regla segura que les dé foto: ninguna tiene en iNaturalist un taxón propio, tampoco de rango inferior (la búsqueda por nombre solo devuelve la especie que las absorbe). Lo único mejorable es el texto: en las 9 primeras, «ambiguo» confunde, porque no hay ninguna duda: el sinónimo es de otra especie. Se podría dar como `sin_taxon` con el motivo en el detalle; no cambia ninguna foto.

### ¿Cambiaría alguna de las 1 808 emparejadas?

Con el índice de la familia entera en lugar del de los 12 géneros, la simulación da **el mismo resultado para todas las filas menos _Vanda coelestis_**: ninguna emparejada cambia de taxón por leer más. (La simulación no reproduce 4 de las 5 emparejadas por sinónimo porque el reporte no trae nuestros sinónimos, pero eso pasa igual con los dos índices.) Como no se cambia código, la carga de hoy no cambia ninguna.

## Coste de cada corrección

| Corrección | Gana | Peticiones | Tiempo | Riesgo |
| --- | --- | ---: | --- | --- |
| Leer la familia entera por defecto (`--leer-familia`, ya existe) | 1 especie, 0 fotos hoy | 115 (medido) en vez de unas 37 (estimado: 12 búsquedas de género y 25 páginas, según los taxones de cada género): **+78** la primera vez; después, de la caché | **+2 min** (154 s medidos para la familia) | Más especies emparejadas a la vez: alguna por sinónimo podría pasar a ambigua (es la dirección segura) |
| Buscar por nombre cada `sin_taxon` | 1 especie (la misma) | 1 696 (una por nombre) o 3 392 con las dos búsquedas | unos 28 min (1 s por petición, medido) | Un 19 % del tope diario para nada |
| Equivalencias ortográficas (`ii`/`i`, `sz`/`sc`) | 1 especie, 0 fotos hoy | 0 | 0 | Unir dos especies distintas que solo difieren en una letra; habría que medir las colisiones en toda la familia |

## Decisión

**No se cambia el emparejamiento.** El 48 % de `sin_taxon` no es un fallo: el 96,7 % son especies e híbridos naturales que iNaturalist no tiene y el 3,2 % son grex, que no puede tener. Los dos defectos que existen (géneros no leídos y variantes ortográficas) afectan a 2 especies de 1 696, y ninguna de las dos ganaría hoy una foto con licencia aceptada. Ninguna de las correcciones compensa: una cuesta 78 peticiones más por carga sin cuidado; otra, 28 minutos; y la tercera abre la puerta a falsos positivos (una foto de otra especie es peor que ninguna).

Lo que tendría que decidir el responsable:

1. **Si quiere `--leer-familia` en el workflow** (hoy no lo ofrece como entrada). Es barato (+78 peticiones, unos 2 minutos, y después de la caché) y deja el emparejamiento igual que en `emparejar-inaturalist` sobre la familia entera. Lo recomendaría solo si el alcance crece a géneros en los que iNaturalist y la WCVP difieren más que en los ocho comunes.
2. **Dónde buscar cobertura de verdad.** No está en el emparejamiento sino en las licencias: 1 152 de las 1 808 emparejadas (64 %) tienen taxón pero ninguna foto con licencia aceptada. Para las 1 637 que iNaturalist no tiene, haría falta otra fuente (por ejemplo, fotos cedidas por los usuarios) o aceptar quedarse sin foto.
3. **Si cambia el texto de los ambiguos por homonimia** a `sin_taxon` con motivo (no cambia ninguna foto).

## Lo que no pude comprobar

- **Nuestros sinónimos completos.** No tengo acceso a la base: los sinónimos son los de COL26.10 XR (ChecklistBank), que deberían ser los mismos que cargó el importador, y solo para la muestra (363 de 380 nombres encontrados; los 17 restantes, sobre todo híbridos naturales con «×», no se encontraron por la búsqueda de texto de ChecklistBank). En el sentido «sinónimo nuestro frente a nombre de iNaturalist», la cota es la de la muestra: 0 de 380 (como mucho un 1,0 %, unas 17 especies).
- **Subespecies y variedades** solo se miraron en la muestra, por la búsqueda por nombre: 0 de 380.
- **La foto de observación** de _Rhynchostylis coelestis_ (la única vía que le queda) no la busqué.
- La búsqueda por nombre **no** devuelve los nombres que solo existen como sinónimos de nuestro lado (por ejemplo, _Cattleya braemii_ no sale en iNaturalist de ninguna forma); por eso se completó con el índice de la familia y con los sinónimos de COL.
