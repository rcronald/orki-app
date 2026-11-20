# Fuente, licencia y formato de la taxonomía de orquídeas

Investigación del sub-issue #72 (parte de #8). Todas las consultas se hicieron el **20 de noviembre de 2026**; salvo que se diga otra cosa, esa es la fecha de consulta de cada fuente citada. Las cifras salen de consultas a las API públicas de ChecklistBank y de GBIF ese mismo día, sin credenciales.

## Resumen de la recomendación

- **Fuente:** la taxonomía que GBIF usa hoy como principal ya no es el «GBIF Backbone Taxonomy» (congelado desde agosto de 2023), sino el **Catalogue of Life eXtended Release (COL XR)**. Propongo importar de COL XR, que es lo que GBIF publica y usa, y no del backbone antiguo.
- **Versión:** la última publicada es **COL26.10 XR**, del 16 de octubre de 2026: clave de ChecklistBank `316691`, DOI [10.48580/dgzlf](https://doi.org/10.48580/dgzlf). Es la misma que usa hoy el servicio de emparejamiento de GBIF. El script debe fijar la versión (la clave del dataset) y no apuntar a «la última».
- **Forma de descarga:** la exportación plana de esa versión, sin cuenta: `https://api.checklistbank.org/dataset/316691/export.zip?format=ColDP` (unos 137 MB comprimidos, un único TSV), filtrada en local por la familia Orchidaceae. Si esa URL resulta poco fiable, la alternativa es paginar la API de búsqueda de ChecklistBank restringida a Orchidaceae (unas 90 a 115 peticiones).
- **Clave para `source_ref`:** el identificador alfanumérico de COL (por ejemplo `4FR2J` para _Phalaenopsis amabilis_). Es el mismo que devuelve la API v2 de GBIF. No es la clave numérica del backbone antiguo (`5311007`).
- **Licencia y atribución:** CC BY 4.0. Hay que citar el Catalogue of Life con su versión y su DOI, indicar la licencia y decir que los datos están filtrados y modificados. Conviene mencionar también a la WCVP de Kew, que aporta el 98 % de las especies aceptadas de orquídeas. Propongo una página pública de «Créditos y fuentes».

## 1. Taxonomía base vigente de GBIF

**Comprobado:**

- El 23 de junio de 2026 GBIF cambió su taxonomía por defecto para organizar las ocurrencias, que pasó a ser el **Catalogue of Life eXtended Release (COL XR)**. El GBIF Backbone «se actualizó por última vez en 2023 y no se volverá a actualizar». Fuente: [GBIF Data Blog, «How to migrate from the legacy GBIF Backbone Taxonomy to Catalogue of Life Extended Release»](https://data-blog.gbif.org/post/catalogue-of-life-taxonomic-backbone/), publicado el 23 de junio de 2026.
- La documentación técnica de GBIF llama a COL XR «la taxonomía principal» y al backbone «taxonomía heredada», que «ya no se actualizará, pero seguirá disponible por compatibilidad». Fuente: [techdocs.gbif.org, Taxonomy interpretation](https://techdocs.gbif.org/en/data-processing/taxonomy-interpretation).
- Aun así, varias API de GBIF siguen usando el backbone por defecto si no se pasa `checklistKey` (la búsqueda de ocurrencias v1, rgbif y pygbif). Hay que pasar siempre la clave de COL XR. Fuentes: las dos anteriores.
- Claves de dataset en GBIF:
  - COL XR: `7ddf754f-d193-4cc9-b351-99906754a03b`, título «Catalogue of Life», licencia CC BY 4.0 ([registro de GBIF](https://api.gbif.org/v1/dataset/7ddf754f-d193-4cc9-b351-99906754a03b)).
  - Backbone heredado: `d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`, DOI [10.15468/39omei](https://doi.org/10.15468/39omei), fecha de publicación 28 de agosto de 2023, licencia CC BY 4.0 ([registro de GBIF](https://api.gbif.org/v1/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c)). Su última descarga es la carpeta `2023-08-28` de [hosted-datasets.gbif.org/datasets/backbone/](https://hosted-datasets.gbif.org/datasets/backbone/).
- COL XR se publica cada mes en ChecklistBank, cada versión con su propio DOI. Últimas versiones XR ([API de ChecklistBank](https://api.checklistbank.org/dataset?releasedFrom=3&origin=xrelease)):

| Versión     | Fecha      | Clave ChecklistBank | DOI            |
| ----------- | ---------- | ------------------- | -------------- |
| COL26.10 XR | 2026-10-16 | 316691              | 10.48580/dgzlf |
| COL26.9 XR  | 2026-09-25 | 316441              | 10.48580/dgz9s |
| COL26.8 XR  | 2026-08-26 | 316165              | 10.48580/dgyy9 |
| COL26.6 XR  | 2026-06-19 | 315557              | 10.48580/dgy8b |

- El alias `3LXR` de ChecklistBank resuelve hoy a la clave `316691` ([api.checklistbank.org/dataset/3LXR](https://api.checklistbank.org/dataset/3LXR)).
- El emparejamiento de nombres de GBIF (API v2) usa hoy exactamente esa versión: `"clbDatasetKey":"316691"`, `"datasetAlias":"COL26.10 XR"`, índice creado el 19 de noviembre de 2026 ([api.gbif.org/v2/species/match/metadata](https://api.gbif.org/v2/species/match/metadata?checklistKey=7ddf754f-d193-4cc9-b351-99906754a03b)).
- Ya existe una versión base más nueva, **COL26.11** (11 de noviembre de 2026, DOI 10.48580/dgzy8), pero todavía no su versión XR ([api.checklistbank.org/dataset/3LR](https://api.checklistbank.org/dataset/3LR)).
- La API v1 de especies de GBIF (`/v1/species/...`) figura como **obsoleta** («use Taxon instead»), y solo sirve el backbone heredado ([techdocs.gbif.org, API reference](https://techdocs.gbif.org/en/openapi/)).

**Detalle a tener en cuenta:** la cita que muestra el registro de GBIF para COL XR todavía dice «2026-08-26 XR» (DOI dgyy9), aunque su punto de descarga y el emparejamiento ya apuntan a la clave 316691 (COL26.10 XR). Para citar vale la versión que se importe de verdad, con su DOI de ChecklistBank.

**Recomendación para un proyecto nuevo:** el blog de GBIF recomienda usar los identificadores de COL XR para el trabajo nuevo y pasar `checklistKey` de COL XR en cada llamada. Por eso propongo COL XR y no el backbone.

## 2. Licencia y atribución

**Comprobado:**

- **COL XR:** CC BY 4.0, tanto en el registro de GBIF (`http://creativecommons.org/licenses/by/4.0/legalcode`) como en ChecklistBank (`"license": "cc by"` en la versión 316691).
- **Backbone heredado:** también CC BY 4.0 (registro de GBIF).
- **WCVP (Kew)**, fuente principal de las orquídeas en COL XR: CC BY 4.0. Versión 16.0, publicada el 4 de junio de 2026, DOI [10.48580/d4nz](https://doi.org/10.48580/d4nz) ([ChecklistBank, dataset 2232](https://api.checklistbank.org/dataset/2232); en GBIF con DOI 10.15468/6h8ucr y la misma licencia).
- Otras fuentes que aportan alguna especie aceptada de orquídea a COL XR: World Plants (CC BY), WFO Plant List (CC0), Dyntaxa (CC0) y una lista de Baviera (CC BY). Todas permiten el uso con atribución o sin condiciones.
- **Cita recomendada** que da ChecklistBank para la versión 316691 ([api.checklistbank.org/dataset/316691](https://api.checklistbank.org/dataset/316691)):

  > Bánki, O., Roskov, Y., Döring, M., Ower, G., Hernández Robles, D. R., Plata Corredor, C. A., Stjernegaard Jeppesen, T., Örn, A., Pape, T., Hobern, D., Garnett, S., Little, H., DeWalt, R. E., Miller, J., Orrell, T., Aalbu, R., Abbott, J., Abreu, C., Acero P, A., et al. (2026). Catalogue of Life (2026-10-16 XR). Catalogue of Life Foundation, Amsterdam, Netherlands. https://doi.org/10.48580/dgzlf

- Cita de la WCVP (misma fuente): «Govaerts, R. (2026). The World Checklist of Vascular Plants (WCVP) (16.0). The Royal Botanic Gardens, Kew, London, United Kingdom. https://doi.org/10.48580/d4nz».
- El Catalogue of Life «recomienda encarecidamente» citar el DOI de la versión usada en cualquier uso de los datos. Cada versión incluye la cita de todas sus fuentes ([página «How to cite» del portal de COL, código fuente](https://raw.githubusercontent.com/CatalogueOfLife/portal/HEAD/src/content/articles/howto/cite.mdx)).
- **Lo que exige CC BY 4.0** (sección 3(a) del [texto legal](https://creativecommons.org/licenses/by/4.0/legalcode.en)):
  - identificar al autor y a quien se designe para la atribución;
  - indicar la licencia con un enlace;
  - mantener el aviso de exención de garantías si lo hay;
  - enlazar al material;
  - **indicar si se modificó**.

  Se puede cumplir «de cualquier forma razonable según el medio». Además, no se pueden añadir condiciones que restrinjan a terceros (sección 2(a)(5)(B)). La sección 4 aclara que copiar una parte sustancial de una base de datos convierte la base propia en material adaptado, así que la atribución aplica a todo el catálogo importado.

**Según resultados de búsqueda, sin abrir la página** (gbif.org devuelve 403 a clientes automáticos): el acuerdo de uso de datos de GBIF ([gbif.org/terms/data-user](https://www.gbif.org/terms/data-user)) pide reconocer al publicador y mantener esa atribución en usos posteriores. No encontré nada específico para apps.

**API y descarga:** no encontré condiciones distintas para la API y para la descarga. La licencia es la del dataset en ambos casos. Para la API, GBIF recomienda poner en el `User-Agent` una URL o un correo de contacto y avisa que puede limitar el ritmo (HTTP 429) ([techdocs.gbif.org/en/openapi](https://techdocs.gbif.org/en/openapi/)).

**Propuesta para la app** (para aprobar):

1. Una página pública «Créditos y fuentes», accesible sin sesión y enlazada desde el pie o el menú de la app. Llevaría:
   - el texto «Catálogo de especies derivado del Catalogue of Life (COL26.10 XR), https://doi.org/10.48580/dgzlf, con licencia CC BY 4.0; filtrado a la familia Orchidaceae y normalizado por Orki»;
   - la mención a la WCVP de Kew con su DOI;
   - un enlace a la licencia.
2. En el backoffice, junto a cada especie importada, la fuente y un enlace a su ficha en COL (`https://www.catalogueoflife.org/data/taxon/{source_ref}`).
3. La versión y la fecha de los datos se anotan además en este documento y en el reporte de cada carga.

## 3. Formas de obtener los datos de Orchidaceae

En COL XR, Orchidaceae es el taxón `DPL` (_Orchidaceae_ Juss.). En el backbone heredado es la clave `7689`.

| Opción                                                                                                                                                    | Tamaño                                                                                                         | ¿Cuenta?               | Estabilidad de la URL                                                                                                                                                                                                                                                      | Esfuerzo                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Exportación plana de una versión fijada** `api.checklistbank.org/dataset/316691/export.zip?format=ColDP`                                             | 137 MB comprimido, 1,5 GB sin comprimir; un único `dataset-316691.tsv` con todos los reinos                    | No                     | La URL lleva la clave de la versión y redirige (302) a un archivo ya generado. Ese archivo es `download.checklistbank.org/job/fd/fd5642b7-….zip`, creado el 27 de octubre de 2026. Las versiones mensuales se conservan un año en ChecklistBank y las anuales para siempre | Bajo: descargar y filtrar en streaming por la columna `col:family`                                                                                                                 |
| **B. API de búsqueda de ChecklistBank** `api.checklistbank.org/dataset/316691/nameusage/search?TAXON_ID=DPL&rank=…&status=…`                              | 114 010 registros en total; unos 3 MB y 6 s por página de 1000                                                 | No                     | La API se declara «todavía en desarrollo activo, no finalizada»                                                                                                                                                                                                            | Medio: 85 a 115 páginas, reintentos y control de ritmo. El máximo por página es 1000 (con 5000 devuelve 400). El offset más allá de 100 000 funcionó                               |
| **C. Archivo completo «último» de COL XR** `download.checklistbank.org/col/xr_latest_coldp.zip` (ColDP) o `xr_latest_dwca.zip` (Darwin Core Archive)      | ColDP 1,39 GB (solo `NameUsage.tsv` ocupa 3,6 GB sin comprimir); DwC-A 914 MB. Ambos del 22 de octubre de 2026 | No                     | La URL es estable pero cambia de contenido cada mes, así que no es reproducible sin anotar la versión                                                                                                                                                                      | Medio: descarga pesada para un workflow                                                                                                                                            |
| **D. Exportación de un subárbol en ChecklistBank** (`POST /dataset/{key}/export` con raíz `DPL`)                                                          | Pequeña (no medida)                                                                                            | **Sí**: cuenta de GBIF | Genera un trabajo bajo demanda                                                                                                                                                                                                                                             | Bajo, pero obliga a guardar credenciales de GBIF como secreto. Sin ellas responde 401, y el `GET export.zip` ignora el filtro `taxonID` (comprobado: devuelve el dataset completo) |
| **E. Backbone heredado** (`hosted-datasets.gbif.org/datasets/backbone/current/`: `simple.txt.gz` o `backbone.zip`, o la API v1 con `highertaxonKey=7689`) | `simple.txt.gz` 466 MB, `backbone.zip` (DwC-A) 926 MB                                                          | No                     | Congelado en 2023-08-28                                                                                                                                                                                                                                                    | Bajo, pero son datos de 2023 y API obsoleta. **No recomendado**                                                                                                                    |

Cabecera real del TSV de la opción A (se leyeron solo los primeros 64 KB del zip):

```
col:ID  col:parentID  col:status  col:rank  col:scientificName  col:authorship  col:kingdom … col:family  col:subfamily  col:tribe  col:subtribe  col:genus  col:subgenus  col:section  col:species  clb:taxGroup
```

Fuentes: [página de descarga de COL (código fuente)](https://raw.githubusercontent.com/CatalogueOfLife/portal/HEAD/src/content/articles/data/download.mdx), que dice además que las descargas parciales personalizadas exigen iniciar sesión con una cuenta gratuita de GBIF; [OpenAPI de ChecklistBank](https://api.checklistbank.org/openapi.json); [metadatos del trabajo de exportación](https://api.checklistbank.org/export/fd5642b7-8735-4d1a-ba79-dee978407890); y cabeceras HTTP de las URL citadas. La web catalogueoflife.org y gbif.org devuelven 403 a clientes automáticos, por eso cito el código fuente del portal publicado por COL.

**Recomendación:** la opción **A** para la carga, con la clave de la versión como parámetro del script, sin credenciales y con una sola descarga reproducible. La opción **B** sirve como plan alternativo y para las pruebas puntuales. Para las pruebas del CI sin red basta una muestra pequeña del TSV versionada en el repositorio.

## 4. Campos disponibles

| Necesidad de la carga        | COL XR (ChecklistBank / exportación A)                                                                                                                                                                | Backbone heredado (API v1)                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Clave estable (`source_ref`) | `id` / `col:ID`, alfanumérica (`4FR2J`)                                                                                                                                                               | `key`, entera (`5311007`)                                                                                            |
| Rango                        | `rank` (`species`, `genus`, `subspecies`, `variety`, `form`, `unranked`…)                                                                                                                             | `rank`                                                                                                               |
| Estado                       | `status`: `accepted`, `provisionally accepted`, `synonym`, `ambiguous synonym`, `misapplied`. **No existe «doubtful»**                                                                                | `taxonomicStatus`: `ACCEPTED`, `DOUBTFUL`, `SYNONYM`, `HOMOTYPIC_SYNONYM`, `HETEROTYPIC_SYNONYM`, `PROPARTE_SYNONYM` |
| Nombre sin autoría           | `scientificName` ya viene sin autoría (`Phalaenopsis amabilis`)                                                                                                                                       | `canonicalName`, pero **quita el marcador de rango** (`Phalaenopsis amabilis ramosa` para un `var.`)                 |
| Autoría                      | `authorship` (`(L.) Blume`), además desglosada en `combinationAuthorship` y `basionymAuthorship`                                                                                                      | `authorship`                                                                                                         |
| Sinónimo → aceptado          | En la API: `accepted.id` y `parentId`. En la exportación: `col:parentID` del sinónimo apunta al aceptado (comprobado en #73, ver la sección 8)                                                        | `acceptedKey`                                                                                                        |
| Género                       | `name.genus` (epíteto genérico) y `parentId` (taxón padre). **Pueden no coincidir**, ver más abajo                                                                                                    | `genus`, `genusKey`                                                                                                  |
| Híbridos                     | `name.notho`: `["specific"]` (`Phalaenopsis × intermedia`) o `["generic"]` (`× Anacamptorchis bassoulsii`). El signo `×` va dentro de `scientificName`. Las fórmulas `A × B` tienen `type: "formula"` | `nameType: HYBRID` (409 nombres)                                                                                     |
| Nombres comunes              | Existen (`vernacularNames` en `/taxon/{id}/info`), pero son escasos para orquídeas: _P. amabilis_ solo tiene uno en sueco                                                                             | Endpoint `/vernacularNames`                                                                                          |
| Otros                        | `identifier` con IPNI, WFO, GRIN; `link` a POWO                                                                                                                                                       |                                                                                                                      |

Registros reales de COL26.10 XR (fuente: `https://api.checklistbank.org/dataset/316691/nameusage/{id}` y `/taxon/{id}/info`):

```
4FR2J  accepted          Phalaenopsis amabilis     (L.) Blume   species  parentId=8W2B9 (Phalaenopsis Blume)
7VKDG  synonym           Cymbidium amabile         (L.) Roxb.   species  accepted=4FR2J
7VX9T  ambiguous synonym Epidendrum amabile        L.           species  accepted=4FR2J
8X2QV  misapplied        Phalaenopsis amabilis     Lindl.       species  accepted=4FR2M (Phalaenopsis aphrodite)
4FR3H  accepted          Phalaenopsis × intermedia Lindl.       species  notho=specific
RWFC   accepted          Cattleya labiata          Lindl.       species
7THCP  synonym           Cattleya bullieri         Carrière     species  accepted=RWFC
7Z22G  synonym           Cattleya labiata f. alba  (Linden & Rodigas) F.Barros & J.A.N.Bat.  form  accepted=RWFC
```

El mismo taxón en GBIF v2 (`api.gbif.org/v2/species/match?checklistKey=7ddf…&scientificName=Phalaenopsis amabilis`) devuelve `"key":"4FR2J"`, `"canonicalName":"Phalaenopsis amabilis"`, `"status":"ACCEPTED"`. GBIF y ChecklistBank comparten la clave.

**Particularidades que el script debe tratar** (comprobadas sobre las 32 926 especies aceptadas o provisionalmente aceptadas de COL26.10 XR):

- **Nombres mal aplicados con el mismo nombre que un aceptado:** «_Phalaenopsis amabilis_ Lindl.» (misapplied) comparte nombre sin autoría con la aceptada. No se deben cargar como sinónimos.
- **Nombres aceptados repetidos sin autoría:** hay 1 caso, _Dendrobium thyrsiflorum_ B.S.Williams (aceptada) y _D. thyrsiflorum_ Rchb.f. ex André (provisional). Chocaría con el índice único de `lower(scientific_name)`.
- **Género del nombre distinto del género padre** en 221 especies (87 aceptadas y 134 provisionales). Ejemplo: _Epipactis atrorubens_ cuelga de _Goodyera_, porque en COL XR «_Epipactis_ Ség.» figura como sinónimo de _Goodyera_. Propongo tomar el género del propio nombre y mandar los desacuerdos al reporte. _Revisado en #73 (sección 8): en la exportación ninguna especie aceptada que no sea fórmula tiene este problema; todos los casos reales son provisionales o fórmulas, que se excluyen. Se usa el género padre._
- **Nombres sin autoría:** 123 aceptados, casi todos fórmulas híbridas y 5 nombres normales.
- **Registros `unranked`:** 13 252 bajo Orchidaceae son identificadores moleculares y se descartan. _Revisado en #73: 13 226 son de UNITE (`SH1132364.10FU`) y solo 26 de BOLD (`BOLD:AAM4945`)._

## 5. Órdenes de magnitud para Orchidaceae (COL26.10 XR)

Conteos con `nameusage/search?TAXON_ID=DPL&limit=0` en la versión 316691:

| Rango                                | Aceptado   | Prov. aceptado | Sinónimo   | Sinónimo ambiguo | Mal aplicado |
| ------------------------------------ | ---------- | -------------- | ---------- | ---------------- | ------------ |
| Género                               | 802        | 6              | 1 712      | 0                | 0            |
| Especie                              | 32 568     | 358            | 47 696     | 2 441            | 30           |
| Subespecie                           | 863        | 27             | 2 377      | 6                | 0            |
| Variedad                             | 929        | 20             | 8 350      | 42               | 3            |
| Forma                                | 54         | 0              | 2 127      | 0                | 0            |
| **Total familia (todos los rangos)** | **48 393** | **487**        | **62 597** | **2 500**        | **33**       |

- Total de registros bajo Orchidaceae: **114 010**. Incluye 13 252 `unranked` (BOLD) y algunos rangos menores (lusus, subvariedad, proles).
- **Híbridos (`notho`):** 1 400 especies aceptadas (1 240 de nothoespecie, como _Phalaenopsis × intermedia_, y 160 en nothogéneros, como _× Anacamptorchis bassoulsii_), más 183 provisionales. Hay 81 nothogéneros aceptados (87 con los provisionales), algunos artificiales de horticultura («× Aliceara hort.»). También hay 118 fórmulas híbridas entre especies aceptadas o provisionales (por ejemplo «Anacamptis morio × Orchis mascula»).
- **Especies por género de acceso rápido** (aceptadas y provisionales): _Dendrobium_ 1 633, _Oncidium_ 380, _Cattleya_ 286, _Vanda_ 102, _Phalaenopsis_ 94. Los géneros con más especies son _Bulbophyllum_ (2 234) y _Epidendrum_ (1 928).
- **Fuente de las especies aceptadas:** 32 010 de 32 568 vienen de la WCVP (dataset 2232). El resto viene de World Plants (331), WFO (70), Dyntaxa (56) y otras.
- **Comparación con el backbone heredado** (API v1, `highertaxonKey=7689`): 114 790 nombres, 33 355 especies aceptadas, 850 géneros aceptados, 3 211 especies dudosas (`DOUBTFUL`), 6 748 dudosos en total y 7 516 OTU.

**Tamaño en Postgres (estimación, no medida):** con la propuesta por defecto (especies aceptadas sin rangos inferiores ni fórmulas, unos 31 500 a 33 000 registros en `species`, y unos 48 000 a 63 000 sinónimos en `species_names`), los índices de trigramas incluidos, debería quedar en el orden de decenas de MB, muy por debajo de los 500 MB del plan gratuito. Hay que medirlo tras la primera carga, como pide #8.

**Prueba de rendimiento de la búsqueda:** el orden a simular es de unas 33 000 especies y unas 50 000 a 63 000 sinónimos.

## 6. Estabilidad de las claves

**Comprobado:**

- La política de COL es mantener el mismo identificador para el mismo nombre en todas las versiones. Solo un cambio en el propio nombre genera un identificador nuevo; los cambios de estado o de clasificación no lo hacen desde COL22.3. Añadir o quitar por completo la autoría sí lo cambia ([portal de COL, «Identifiers»](https://raw.githubusercontent.com/CatalogueOfLife/portal/HEAD/src/content/articles/building/identifier.md)).
- La nota de COL sobre el historial de identificadores (noviembre de 2026) reconoce **inestabilidades reales en 2026**: unos 35 000 nombres cambiaron de identificador sin querer en COL26.9, y los tres fallos de fondo se corrigieron en septiembre de 2026. Ahora los identificadores retirados redirigen a su sucesor cuando hay evidencia (`supersededBy` en `/taxon/{id}/info`). Cada versión publica informes `created.tsv`, `deleted.tsv`, `resurrected.tsv` y `superseded.tsv` en `download.checklistbank.org/releases/3/{attempt}/`. La recomendación literal es: «If you store COL identifiers, keep the name and its author next to them» ([portal de COL, noticia del 10 de noviembre de 2026](https://raw.githubusercontent.com/CatalogueOfLife/portal/HEAD/src/content/news/2026-11-10-col-identifier-history.md)).
- **Muestra propia:** de 1 000 especies aceptadas de orquídeas en COL26.10 XR (orden alfabético, desde la posición 5000), las que existían con el mismo nombre y autor en COL26.6 XR (939) y en COL26.3 XR (942) conservaban el mismo identificador en el 99,8 % de los casos (937 y 940). _Phalaenopsis amabilis_ es `4FR2J` en todas las versiones XR de 2026 consultadas.
- **Cambio de backbone a COL:** las claves cambian por completo (enteras a alfanuméricas). GBIF publica una tabla de correspondencia (`download.checklistbank.org/col/gbif/`, no la pude abrir porque pide un desafío anti-robots), y la API v2 convierte una clave: `v2/species/match?checklistKey=…&scientificNameID=gbif:5311007` devuelve `4FR2J`.

**Implicaciones para `(source, source_ref)`:**

- Como la base aún no tiene datos importados, empezar directamente con claves de COL evita cualquier migración de claves.
- Para recargar sin duplicar, el script debe:
  1. guardar el nombre y la autoría junto a la clave (ya se guarda el nombre);
  2. si una clave nueva no existe pero su nombre ya está en el catálogo con otra clave de la misma fuente, tratarlo como **conflicto en el reporte**, no como alta. El índice único sobre `lower(scientific_name)` ya impide el duplicado;
  3. opcionalmente, usar `supersededBy` para remapear una clave retirada.
- Que `source` siga siendo `gbif` con claves de COL es una decisión pendiente (ver más abajo).

## 7. Alternativa: importar directamente de la WCVP

**Comprobado:**

- WCVP 16.0 (4 de junio de 2026), CC BY 4.0. Se descarga sin cuenta desde `https://sftp.kew.org/pub/data-repositories/WCVP/`: `wcvp.zip` (84 MB) y `wcvp_dwca.zip` (84 MB), con un archivo de versiones anteriores ([listado del servidor de Kew](https://sftp.kew.org/pub/data-repositories/WCVP/); [ChecklistBank 2232](https://api.checklistbank.org/dataset/2232)).
- Orchidaceae en la WCVP (vista de ChecklistBank): 95 105 nombres, 32 112 especies aceptadas y 3 000 géneros aceptados, de los cuales **2 305 son nothogéneros**, muchos artificiales de horticultura. COL XR deja fuera casi todos esos nothogéneros.
- Sus claves son las de IPNI o POWO (por ejemplo `ipni:650501-1`). COL las conserva en `identifier`.

**Valoración:**

- Ventajas de la WCVP: archivo más pequeño (84 MB) y fuente de autoridad directa para plantas, que aporta el 98 % de las especies aceptadas de orquídeas en COL XR.
- Desventajas:
  - se publica con menos frecuencia (16.0 es de junio de 2026);
  - no es «lo que usa GBIF», que es lo que dice la especificación;
  - obliga a filtrar miles de nothogéneros hortícolas;
  - sus claves no coinciden con las de GBIF ni con las de COL.
- No la recomiendo como fuente principal para la Fase 1. Sí conviene citarla en los créditos.

## 8. Formato real de la exportación (comprobado en #73)

Comprobado el 20 de noviembre de 2026 sobre la exportación completa de la opción A, descargada una vez fuera del repositorio y leída entera.

- **Archivo:** zip de 137 MB (SHA-256 `6f2a6b6a645ea8306cea2149027c84dd7f08cd781b1079c5aee453a0a13adc73`), generado el 27 de octubre de 2026, con dos miembros: `dataset-316691.tsv` (1 536 938 134 bytes) y `metadata.yaml`, que trae `key: 316691`, `alias: COL26.10 XR`, `version: 2026-10-16 XR`, `issued: 2026-10-16` y `doi: 10.48580/dgzlf`. La CLI lee y muestra esos datos.
- **TSV:** una cabecera y 8 504 545 filas, todas con las 23 columnas de la sección 3. No usa comillas: 22 nombres llevan comillas dobles dentro y hay que leerlo sin interpretarlas. Se puede leer línea a línea directamente del zip. Leer el archivo entero y quedarse con Orchidaceae tarda unos 4 segundos.
- **No hay columnas** de nombre aceptado, de tipo de nombre ni de híbrido (`notho`). El aceptado sale de `col:parentID`; el híbrido, del signo «×» de `col:scientificName`, y la fórmula, de la forma del nombre. Algunas fórmulas usan la «x» latina («_Anacamptis morio_ x _palustris_», 46 especies aceptadas) y otras «×».
- **`col:family` va rellena en los sinónimos** y en todos los rangos por debajo de la familia: hay 114 009 filas con `col:family = Orchidaceae`, y ninguna fila de todo el archivo cuyo padre esté entre ellas tiene otra familia. Basta con filtrar por esa columna, sin recorrer el árbol. La fila de la propia familia (`DPL`) trae `col:family` vacía; con ella son las 114 010 de la API.
- **`col:ID` es único**, también para los sinónimos ambiguos: cada uno es una fila con su propio identificador que apunta a un solo aceptado. Un nombre «pro parte» aparece como varias filas con distinto identificador.
- **`col:parentID` de un sinónimo** apunta siempre a un taxón aceptado o provisional, nunca a otro sinónimo. A veces ese taxón es infraespecífico: 1 992 sinónimos de rango especie apuntan a una subespecie aceptada y 1 286 a una variedad. Las subespecies, variedades y formas aceptadas cuelgan de su especie, salvo 54 que cuelgan directamente del género.
- **Especies aceptadas:** 32 551 cuelgan de un género aceptado y 17 directamente de la familia (todas fórmulas). `col:genus` es siempre el nombre del género padre (con «×» si es nothogénero), no el género escrito en el nombre.
- **Género del nombre frente al género padre:** sin contar el «×», no difiere en ninguna especie aceptada que no sea fórmula. Difiere en 120 provisionales (más 14 fórmulas provisionales), como _Epipactis atrorubens_ bajo _Goodyera_. Las 87 aceptadas de la sección 4 coinciden en número con las 87 fórmulas aceptadas que cuelgan de un género (supuesto: la API no da `name.genus` para las fórmulas; no se volvió a consultar).
- **Signo de híbrido:** en Orchidaceae siempre es «×» (U+00D7) seguido de un espacio. No hay «×» pegado, ni espacios dobles, ni espacios en los extremos, ni espacios de no separación. En 18 especies aceptadas el «×» del nombre no coincide con el de su género: 8 sin «×» en un nothogénero («_Brassocattleya hybrida_» bajo «× _Brassocattleya_»), 8 nothoespecies dentro de un nothogénero («_Serapicamptis_ × _garriuscola_») y 2 con «×» bajo un género sin él («× _Orchiserapias dhiorii_» bajo «_Orchiserapias_»).
- **Géneros aceptados sin especies aceptadas:** 50, de ellos 33 nothogéneros hortícolas («× _Aliceara_») y variantes ortográficas aceptadas como géneros («_Bulbopyllum_», «_Bulbophylum_», «_Coralliorrhiza_», «_Schomburkgia_»).
- **Rangos menores:** además de subespecie, variedad y forma aparecen `subvariety`, `subform`, `lusus`, `proles`, `infraspecific name` y `other`; estos dos últimos son trinomios sin marcador («_Cattleya labiata autumnalis_»).

Los recuentos que da la normalización con estas reglas están en el [README de la carpeta](README.md#resultado-con-col2610-xr-frente-a-fuentemd).

## Decisiones para aprobar

Las cifras son de COL26.10 XR, Orchidaceae.

**(a) No importar subespecies ni variedades.** Recomendado.

- Deja fuera 1 846 taxones aceptados por debajo de especie (863 subespecies, 929 variedades y 54 formas), más 47 provisionales y algunos lusus y proles.
- Entre ellos están los autónimos, como «_Phalaenopsis amabilis_ subsp. _amabilis_», que no aportan nada al buscador.
- Sub-decisión: los **sinónimos de rango inferior** que apuntan a una especie aceptada (por ejemplo «_Cattleya labiata_ f. _alba_» → _C. labiata_) son nombres que un coleccionista puede escribir.
  - Propongo cargarlos como `species_names` de su especie.
  - En total hay 12 854 sinónimos de rango inferior. Los que apuntan a un taxón infraespecífico aceptado habría que reasignarlos a su especie o descartarlos.

**(b) Excluir los nombres dudosos.** Recomendado, reformulado.

- En COL XR no existe el estado «doubtful» del backbone heredado (que tenía 3 211 especies dudosas de orquídeas).
- Los equivalentes son:
  - **provisionalmente aceptado:** 358 especies y 6 géneros. Propongo excluirlos o, como mucho, cargarlos como sinónimos. Incluyen casos raros, como _Doritis apollinus_ colgado de _Phalaenopsis_, y uno de los dos _Dendrobium thyrsiflorum_.
  - **sinónimo ambiguo:** 2 441 nombres de especie. Propongo cargarlos como sinónimos, porque apuntan a un aceptado, y anotarlos en el reporte.
  - **mal aplicado:** 30 nombres de especie. Propongo **excluirlos siempre**, porque comparten nombre con otra especie (como «_Phalaenopsis amabilis_ Lindl.»).

**(c) Importar los híbridos naturales (nombres con «×») con tipo híbrido.** Recomendado, con matices.

- Añade 1 400 especies aceptadas de híbridos: 1 240 nothoespecies, como _Phalaenopsis × intermedia_, y 160 especies de nothogéneros. Con las provisionales serían 183 más.
- Obliga a crear hasta 81 géneros con «×» (por ejemplo «× Anacamptorchis»).
- Sub-decisiones:
  - **Excluir las 118 fórmulas híbridas** («A × B»), que no son nombres de especie.
  - Para los nothogéneros, decidir si el género se guarda como «× Anacamptorchis» o como «Anacamptorchis». El campo `genus` de la API trae el nombre sin «×» y `scientificName` lo trae con él. Hay que tenerlo en cuenta para la búsqueda y para la lista curada de híbridos de la especificación.

**(d) Fuente.** Pasar de «GBIF Backbone Taxonomy» a **COL XR (la taxonomía actual de GBIF)**, versión fijada COL26.10 XR (clave 316691).

- Sub-decisión: el valor de `source`.
  - Opción 1: mantener `gbif`, entendido como «taxonomía de GBIF», y documentar que `source_ref` es la clave de COL. No cambia el esquema.
  - Opción 2: añadir `col` al enumerado `species_source` con una migración, que es más preciso.
- En ambos casos hay que actualizar la sección 11 de `docs/specification.md`, que todavía nombra el «GBIF Backbone Taxonomy».

**(e) Atribución en la app.** Página pública «Créditos y fuentes» enlazada desde la app, más la fuente y el enlace a COL en el backoffice (ver sección 2). Pendiente de que una persona elija el lugar exacto del enlace.

## Lo que no pude verificar

- **Páginas web de COL y de GBIF:** catalogueoflife.org y gbif.org (términos de uso, acuerdo de usuario de datos, pautas de cita) devuelven 403 a clientes automáticos. Lo del portal de COL lo verifiqué en su código fuente público (`CatalogueOfLife/portal`). Lo del acuerdo de usuario de GBIF sale solo de fragmentos de resultados de búsqueda.
- **Atribución en apps:** no encontré una pauta de GBIF ni de COL específica para apps. La propuesta de la sección 2 es mi interpretación de CC BY 4.0, sección 3(a).
- **Límites de ritmo de la API de ChecklistBank:** no están documentados en lo que encontré. Los de GBIF no dan cifras («no garantizamos ningún ritmo»).
- ~~**Contenido completo de la exportación A:** solo leí la cabecera.~~ Comprobado en #73: los sinónimos traen `col:family` y su `col:parentID` es el aceptado (sección 8).
- **Exportación de otras versiones:** no sé si `export.zip` sin cuenta responde igual de rápido para una versión cuyo archivo no esté ya generado. Puede que lance un trabajo y tarde.
- **Fecha exacta del archivo `xr_latest_coldp.zip`:** su fecha (22 de octubre de 2026) coincide con COL26.10 XR, pero el archivo no dice explícitamente qué versión es.
- **Tabla de correspondencia GBIF → COL:** no pude abrir `download.checklistbank.org/col/gbif/` (desafío anti-robots).
- **Tamaño en Postgres:** es una estimación. Se medirá tras la carga.
- **Muestra de estabilidad de claves:** cubre 1 000 especies y no es exhaustiva. Hay dos casos con el mismo nombre y clave distinta que no investigué.
- **Nombres comunes:** no conté cuántos hay para orquídeas en COL XR. Solo vi dos fichas, una con un nombre en sueco y otra sin ninguno.
- **Nothogéneros de la WCVP:** no comprobé el desglose entre naturales y artificiales.
