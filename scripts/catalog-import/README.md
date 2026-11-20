# Importación del catálogo

Scripts en Python que preparan el catálogo de especies de orquídeas de Orki a partir del **Catalogue of Life eXtended Release** (COL26.10 XR, clave de ChecklistBank `316691`). La investigación de la fuente, la licencia y el formato está en [FUENTE.md](FUENTE.md); las decisiones aprobadas, en el issue #72.

Por ahora hay lectura, filtrado y normalización (#73), con una CLI de solo lectura. La carga en la base de datos, con su reporte, llega en #74: nada de lo que hay aquí se conecta a una base.

## Requisitos e instalación

- [uv](https://docs.astral.sh/uv/) 0.10 (al menos 0.10.4; lo fija `required-version` en `pyproject.toml`).
- Python 3.13, fijado en `.python-version`. Si no está instalado, uv lo descarga.

Se usa **uv con lockfile** porque `uv.lock` fija la versión y el hash de cada dependencia, y uv instala también Python: `uv sync --locked` deja el mismo entorno en local y en GitHub Actions con una sola herramienta.

Desde esta carpeta:

```sh
uv sync --locked              # crea .venv con Python 3.13 y las dependencias de desarrollo
uv run pytest                 # pruebas (sin red: cualquier conexión hace fallar la prueba)
uv run ruff check             # lint
uv run ruff format --check    # formato (uv run ruff format para aplicarlo)
```

El código solo usa la biblioteca estándar. Las únicas dependencias, de desarrollo, son pytest 9.2.0 y ruff 0.17.4. Para actualizarlas: mover la fecha `exclude-newer` de `pyproject.toml` (solo se aceptan versiones publicadas antes de esa fecha), cambiar las versiones y ejecutar `uv lock`.

En el CI, el job «Importación del catálogo (Python)» de `.github/workflows/ci.yml` ejecuta esos mismos tres pasos.

## Uso de la CLI

Descarga la exportación de la versión fijada **fuera del repositorio** (unos 137 MB; no se versiona) y pásala a la CLI. Lee el zip directamente, sin descomprimirlo:

```sh
curl -L -o /tmp/col-316691.zip 'https://api.checklistbank.org/dataset/316691/export.zip?format=ColDP'
uv run orki-catalogo /tmp/col-316691.zip                              # resumen
uv run orki-catalogo /tmp/col-316691.zip --salida /tmp/catalogo.json  # y salida normalizada
```

También acepta el TSV suelto. Imprime los recuentos de géneros, especies, híbridos y sinónimos, y los descartes y ajustes por motivo. Con `--salida` escribe un JSON con `summary`, `genera`, `species` (cada una con sus `synonyms`) e `issues`. La salida es determinista: el mismo archivo da el mismo JSON byte a byte. Con COL26.10 XR tarda unos 4 segundos, usa unos 145 MB de memoria y el JSON ocupa 31 MB.

## Código

| Archivo                           | Qué hace                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/catalog_import/reader.py`    | Lee la exportación línea a línea (del zip o del TSV), valida la cabecera y devuelve las filas de la familia    |
| `src/catalog_import/names.py`     | Limpieza de espacios, signo de híbrido uniforme y análisis de la forma del nombre (binomio, fórmula)           |
| `src/catalog_import/normalize.py` | Filtrado, normalización y deduplicación al modelo intermedio, con el motivo de cada descarte o ajuste          |
| `src/catalog_import/model.py`     | Modelo intermedio y códigos de motivo                                                                          |
| `src/catalog_import/cli.py`       | CLI `orki-catalogo`                                                                                            |
| `tests/`                          | Pruebas; la muestra real y su procedencia están en `tests/data/` ([PROCEDENCIA.md](tests/data/PROCEDENCIA.md)) |

### Modelo intermedio

Dataclasses inmutables, independientes de la base:

- `Genus`: `name` (los nothogéneros con «× » delante, como los escribe la fuente: «× Anacamptorchis»), `source_ref` (identificador de COL) e `is_hybrid`.
- `Species`: `scientific_name` (sin autoría), `authorship` (aparte, o `None`), `source_ref` (identificador de COL), `genus` y `genus_ref` (nombre e identificador del género padre), `type` (`species` o `hybrid`, los valores del enumerado `species_type`) y `synonyms`.
- `Synonym`: `name` (sin autoría; los de rango inferior conservan el marcador, «_Cattleya labiata_ f. _alba_»), `authorship`, `source_ref`, `status` (`synonym` o `ambiguous synonym`), `rank` y `via` (el taxón infraespecífico aceptado al que apuntaba, si se reasignó a la especie).
- `Issue`: un registro descartado o ajustado, con `action` (`descartado` o `ajustado`), `code` (código estable) y `message` (texto con el detalle), además de su identificador, nombre, autoría, rango y estado.

## Reglas

Los recuentos son los de COL26.10 XR (ejecución del 20 de noviembre de 2026).

- **Familia:** solo las filas con `col:family = Orchidaceae` (114 009). Las de otras familias (8 390 536, incluida la fila de la propia familia, que trae esa columna vacía) solo se cuentan.
- **Nombres:** sin autoría (va en su propio campo), sin espacios al principio ni al final y con uno solo entre palabras, igual que exigen las restricciones de la base. El signo de híbrido es siempre «×» (U+00D7) como palabra suelta: se corrigen «×Nombre» pegado, la «x» latina suelta y aspas parecidas. En COL26.10 XR ningún nombre que se importa necesitó limpieza; la «x» latina solo aparece en fórmulas, que se descartan.
- **Géneros:** los aceptados con al menos una especie importada.
- **Especies:** rango especie y estado `accepted`. El género es el **género padre en la clasificación**, buscado hacia arriba por `col:parentID`. Si el género escrito en el nombre no coincide con él (sin contar el «×»), se mantiene el padre y se anota `GENERO_DISTINTO_DEL_NOMBRE` para revisarlo: el nombre sigue siendo el aceptado por la fuente y el género padre es el que da su clasificación, así que no hay motivo para descartar la especie ni para inventar un género que la fuente no acepta. En COL26.10 XR no hay **ningún** caso entre las especies importadas (ver más abajo).
- **Híbridos:** tipo `hybrid` si el nombre lleva «×» o su género es un nothogénero. Si el «×» del nombre y el del género no coinciden, se importa como híbrido y se anota `HIBRIDO_INCONSISTENTE`.
- **Fórmulas híbridas:** un «×» que une dos nombres («_Anacamptis morio_ × _Orchis mascula_», «_Dactylorhiza incarnata_ × _maculata_») es una fórmula y se descarta, sea especie aceptada o sinónimo. Un «×» es de un híbrido nombrado solo delante del género o delante de un epíteto que sigue al género o a un marcador de rango.
- **Sinónimos:** estado `synonym` o `ambiguous synonym`, de rango especie o inferior. Se sigue `col:parentID`; si apunta a un taxón infraespecífico aceptado, se sube hasta su especie y se anota `SINONIMO_REASIGNADO`. Solo se cargan si llegan a una especie importada.
- **Deduplicación** (lo que la base rechazaría): especies con el mismo nombre sin distinguir mayúsculas (se conserva la que tiene autoría y, a igualdad, la de identificador menor), géneros repetidos, sinónimos iguales al nombre aceptado de su especie y sinónimos repetidos dentro de una especie (se conserva el directo antes que el reasignado, el no ambiguo antes que el ambiguo y, a igualdad, el de identificador menor).

### Códigos de motivo

| Código                       | Acción     | Qué significa                                                                  | COL26.10 XR |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------ | ----------: |
| `SIN_RANGO`                  | descartado | Identificador molecular sin rango (UNITE o BOLD)                               |      13 252 |
| `MAL_APLICADO`               | descartado | Nombre mal aplicado (`misapplied`)                                             |          33 |
| `PROVISIONAL`                | descartado | Taxón provisionalmente aceptado (358 especies, 6 géneros, 47 infraespecíficos) |         411 |
| `ESTADO_DESCONOCIDO`         | descartado | Estado que no es ninguno de los conocidos                                      |           0 |
| `RANGO_NO_IMPORTADO`         | descartado | Rango que no se importa (sinónimos de familia)                                 |           9 |
| `INFRAESPECIFICO_ACEPTADO`   | descartado | Subespecie, variedad o forma aceptada                                          |       1 846 |
| `SINONIMO_DE_GENERO`         | descartado | Sinónimo de rango género                                                       |       1 712 |
| `FORMULA_HIBRIDA`            | descartado | Fórmula «A × B» (104 especies aceptadas y 97 sinónimos)                        |         201 |
| `NOMBRE_NO_VALIDO`           | descartado | Especie aceptada cuyo nombre no es un binomio                                  |           0 |
| `SIN_GENERO`                 | descartado | Especie que no cuelga de un género aceptado                                    |           0 |
| `NOMBRE_REPETIDO`            | descartado | Especie con el nombre de otra, sin distinguir mayúsculas                       |           0 |
| `GENERO_REPETIDO`            | descartado | Género con el nombre de otro, sin distinguir mayúsculas                        |           0 |
| `GENERO_SIN_ESPECIES`        | descartado | Género aceptado sin especies importadas                                        |          50 |
| `SINONIMO_DE_PROVISIONAL`    | descartado | Sinónimo de un taxón provisional                                               |       1 399 |
| `SINONIMO_DE_EXCLUIDO`       | descartado | Sinónimo de una especie descartada por otro motivo                             |           1 |
| `SINONIMO_SIN_DESTINO`       | descartado | Sinónimo que no llega a una especie (su infraespecífico cuelga del género)     |           4 |
| `SINONIMO_IGUAL_AL_ACEPTADO` | descartado | Sinónimo igual al nombre aceptado de su especie (otro autor)                   |         390 |
| `SINONIMO_REPETIDO`          | descartado | Sinónimo repetido dentro de la especie (mismo nombre, otro autor)              |       1 485 |
| `NOMBRE_NORMALIZADO`         | ajustado   | Se limpiaron espacios o el signo de híbrido                                    |           0 |
| `SINONIMO_REASIGNADO`        | ajustado   | Sinónimo de un infraespecífico aceptado, pasado a su especie                   |       7 141 |
| `GENERO_DISTINTO_DEL_NOMBRE` | ajustado   | El género del nombre no es el género padre; se usa el padre                    |           0 |
| `HIBRIDO_INCONSISTENTE`      | ajustado   | El «×» del nombre no coincide con el de su género                              |          18 |

## Resultado con COL26.10 XR frente a FUENTE.md

| Concepto                         | FUENTE.md (API de búsqueda) | Esta salida | Explicación                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | --------------------------: | ----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registros de la familia          |                     114 010 |     114 009 | La API cuenta también la fila de la familia (`DPL`), que en la exportación trae `col:family` vacía                                                                                                                                                                                                                                                                                                                       |
| Géneros aceptados                |                         802 |         752 | 50 sin especies importadas: 33 nothogéneros hortícolas («× Aliceara», «× Mokara»…) y variantes como «Bulbopyllum», «Bulbophylum» o «Coralliorrhiza»                                                                                                                                                                                                                                                                      |
| Nothogéneros                     |                          81 |          48 | Los otros 33 no tienen especies aceptadas                                                                                                                                                                                                                                                                                                                                                                                |
| Especies aceptadas               |                      32 568 |      32 464 | Se descartan 104 fórmulas aceptadas. No hay nombres repetidos: el único caso, _Dendrobium thyrsiflorum_, se resuelve al excluir la provisional                                                                                                                                                                                                                                                                           |
| Híbridos                         |                       1 400 |       1 408 | 1 240 nothoespecies y 160 especies con «×» delante, como en FUENTE.md, más 8 especies sin «×» en el nombre que cuelgan de un nothogénero («Brassocattleya hybrida», «Dactylodenia cookei»…)                                                                                                                                                                                                                              |
| Sinónimos de rango especie       |              47 696 + 2 441 |      48 019 | De los 47 696 sinónimos: 771 son de provisionales, 378 iguales al aceptado, 780 repetidos, 95 fórmulas y 1 de una fórmula. De los 2 441 ambiguos: 6 de provisionales, 12 iguales al aceptado y 75 repetidos. Salen 45 671 sinónimos y 2 348 ambiguos                                                                                                                                                                     |
| Sinónimos de rango inferior      |                      12 854 |      11 981 | FUENTE.md cuenta subespecies, variedades y formas no ambiguas; con los ambiguos y los rangos menores (lusus, proles…) la exportación trae 13 239. De ellos: 622 de provisionales, 630 repetidos, 4 sin especie de destino y 2 fórmulas                                                                                                                                                                                   |
| Sinónimos en total               |                           — |      60 000 | De ellos 2 385 ambiguos y 7 141 reasignados desde un infraespecífico aceptado                                                                                                                                                                                                                                                                                                                                            |
| Género del nombre ≠ género padre |        221 (87 + 134 prov.) |           0 | Comparando el género del nombre con el género padre sin el «×», ninguna especie aceptada que se importa difiere. Las 87 aceptadas de FUENTE.md coinciden en número con las 87 fórmulas aceptadas que tienen género padre (todas descartadas); es una deducción, no se repitió la consulta a la API. De las provisionales difieren 120 (más 14 fórmulas), como _Epipactis atrorubens_ bajo _Goodyera_; todas quedan fuera |
| Sin rango                        |             13 252 («BOLD») |      13 252 | Son 13 226 identificadores de UNITE («SH1132364.10FU») y solo 26 de BOLD                                                                                                                                                                                                                                                                                                                                                 |

Ojo para la carga y la búsqueda: 593 sinónimos coinciden con el nombre aceptado de **otra** especie y 1 028 nombres de sinónimo aparecen en más de una especie (homónimos de distintos autores o sinónimos ambiguos). La base los admite, porque la unicidad de `species_names` es por especie, pero la búsqueda devolverá varias especies para esos nombres.
