# Importación del catálogo

Scripts en Python que preparan el catálogo de especies de orquídeas de Orki a partir del **Catalogue of Life eXtended Release** (COL26.10 XR, clave de ChecklistBank `316691`). La investigación de la fuente, la licencia y el formato está en [FUENTE.md](FUENTE.md); las decisiones aprobadas, en el issue #72.

Hay cuatro partes: lectura, filtrado y normalización (#73), con una CLI de solo lectura; la carga en la base de datos con su reporte (#74, `orki-catalogo cargar`, ver [Carga en la base de datos](#carga-en-la-base-de-datos)); la lista curada de híbridos, con su validación y su carga por el mismo flujo (#77, `orki-catalogo validar-hibridos` y `orki-catalogo cargar-hibridos`, ver [Lista curada de híbridos](#lista-curada-de-híbridos)); y el workflow manual con la guía por ambiente (#75, ver [Ejecución por ambiente](#ejecución-por-ambiente)).

## Requisitos e instalación

- [uv](https://docs.astral.sh/uv/) 0.10 (al menos 0.10.4; lo fija `required-version` en `pyproject.toml`).
- Python 3.13, fijado en `.python-version`. Si no está instalado, uv lo descarga.

Se usa **uv con lockfile** porque `uv.lock` fija la versión y el hash de cada dependencia, y uv instala también Python: `uv sync --locked` deja el mismo entorno en local y en GitHub Actions con una sola herramienta.

Desde esta carpeta:

```sh
uv sync --locked              # crea .venv con Python 3.13 y las dependencias de desarrollo
uv run pytest                 # pruebas (sin red; las de la carga, solo con ORKI_TEST_DB_URL)
uv run ruff check             # lint
uv run ruff format --check    # formato (uv run ruff format para aplicarlo)
```

La lectura y la normalización solo usan la biblioteca estándar. La carga usa [psycopg](https://www.psycopg.org/psycopg3/) 3.3.8 con el extra `binary`, que trae libpq compilada (no hace falta instalar el cliente de PostgreSQL). Las dependencias de desarrollo son pytest 9.2.0 y ruff 0.17.4. Para actualizarlas: mover la fecha `exclude-newer` de `pyproject.toml` (solo se aceptan versiones publicadas antes de esa fecha), cambiar las versiones y ejecutar `uv lock`.

En el CI, el job «Importación del catálogo (Python)» de `.github/workflows/ci.yml` ejecuta esos mismos tres pasos, con un Postgres 17 desechable para las pruebas de la carga (ver [Pruebas de la carga](#pruebas-de-la-carga)), y además valida el formato de la lista curada de híbridos (`uv run --locked orki-catalogo validar-hibridos data/hibridos.csv`).

## Uso de la CLI

Descarga la exportación de la versión fijada en [`fuente.json`](fuente.json) **fuera del repositorio** (unos 137 MB; no se versiona), comprueba su SHA-256 y pásala a la CLI. Lee el zip directamente, sin descomprimirlo:

```sh
curl -L -o /tmp/col-316691.zip 'https://api.checklistbank.org/dataset/316691/export.zip?format=ColDP'
shasum -a 256 /tmp/col-316691.zip   # tiene que dar el sha256 de fuente.json
uv run orki-catalogo /tmp/col-316691.zip                              # resumen
uv run orki-catalogo /tmp/col-316691.zip --salida /tmp/catalogo.json  # y salida normalizada
```

También acepta el TSV suelto. Imprime los recuentos de géneros, especies, híbridos y sinónimos, y los descartes y ajustes por motivo. Con `--salida` escribe un JSON con `summary`, `genera`, `species` (cada una con sus `synonyms`) e `issues`. La salida es determinista: el mismo archivo da el mismo JSON byte a byte. Con COL26.10 XR tarda unos 4 segundos, usa unos 145 MB de memoria y el JSON ocupa 31 MB.

## Código

| Archivo                              | Qué hace                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/catalog_import/reader.py`       | Lee la exportación línea a línea (del zip o del TSV), valida la cabecera y devuelve las filas de la familia                             |
| `src/catalog_import/names.py`        | Limpieza de espacios, signo de híbrido uniforme y análisis de la forma del nombre (binomio, fórmula)                                    |
| `src/catalog_import/normalize.py`    | Filtrado, normalización y deduplicación al modelo intermedio, con el motivo de cada descarte o ajuste                                   |
| `src/catalog_import/model.py`        | Modelo intermedio y códigos de motivo                                                                                                   |
| `src/catalog_import/cli.py`          | CLI `orki-catalogo` (resumen de solo lectura; `cargar` pasa a `load_cli.py`; los híbridos, a `hybrids_cli.py`)                          |
| `src/catalog_import/load_cli.py`     | `orki-catalogo cargar`: opciones, conexión, errores sin credenciales (comunes con `cargar-hibridos`)                                    |
| `src/catalog_import/target.py`       | Ambiente, URL de conexión y protección contra cargar en la base equivocada                                                              |
| `src/catalog_import/load.py`         | Carga: lectura de la base, plan (función pura) y escritura por conjuntos en una transacción                                             |
| `src/catalog_import/report.py`       | Reporte CSV y resumen por pantalla (de las dos cargas)                                                                                  |
| `src/catalog_import/hybrids.py`      | Lista curada de híbridos: formato del CSV y validación, sin base                                                                        |
| `src/catalog_import/hybrids_load.py` | Plan de la carga de la lista curada (función pura); el resto es el flujo de `load.py`                                                   |
| `src/catalog_import/hybrids_cli.py`  | `orki-catalogo validar-hibridos` y `orki-catalogo cargar-hibridos`                                                                      |
| `data/hibridos.csv`                  | La lista curada de híbridos (ver [Lista curada de híbridos](#lista-curada-de-híbridos))                                                 |
| `fuente.json`                        | Versión fijada de la fuente: clave, DOI, licencia, URL y SHA-256 de la exportación (la usan el workflow y la atribución del backoffice) |
| `tests/`                             | Pruebas; la muestra real y su procedencia están en `tests/data/` ([PROCEDENCIA.md](tests/data/PROCEDENCIA.md))                          |
| `tests/basedatos.py`                 | Bases desechables con las migraciones para las pruebas de la carga                                                                      |

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

## Carga en la base de datos

`orki-catalogo cargar` lee la exportación, la normaliza con las reglas de arriba y la carga en Postgres por conexión directa, en **una sola transacción**: o entra todo o no entra nada. Es repetible (una segunda ejecución con la misma fuente no cambia ninguna fila, ni su `updated_at`) y **nunca borra**. Necesita las migraciones `20261120220000_fuente_col_en_especies.sql` y `20261120220100_col_exige_referencia.sql`, que añaden la fuente `col`; si faltan, se niega a cargar.

Aquí se describe la ejecución en local, que sirve para probar. Cómo se carga en desarrollo y en producción está en [Ejecución por ambiente](#ejecución-por-ambiente).

### En local

Con un Postgres 17 desechable (como en la sección de rendimiento de [supabase/README.md](../../supabase/README.md#rendimiento-de-la-búsqueda); con Podman o Docker) y las migraciones aplicadas, desde la raíz del repositorio:

```sh
podman run -d --rm --name orki-carga -e POSTGRES_USER=supabase_admin -e POSTGRES_PASSWORD=desechable -p 127.0.0.1:55417:5432 postgres:17
export ORKI_CATALOG_DB_URL='postgresql://supabase_admin:desechable@127.0.0.1:55417/postgres'
psql "$ORKI_CATALOG_DB_URL" -X -q -1 -v ON_ERROR_STOP=1 -f scripts/db-desechable/supabase-minimo.sql
for f in supabase/migrations/*.sql; do psql "$ORKI_CATALOG_DB_URL" -X -q -1 -v ON_ERROR_STOP=1 -c 'set role postgres' -f "$f" || break; done

cd scripts/catalog-import
uv run orki-catalogo cargar /tmp/col-316691.zip --ambiente local             # simulación
uv run orki-catalogo cargar /tmp/col-316691.zip --ambiente local --escribir  # carga de verdad
```

| Opción                        | Qué hace                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `archivo`                     | `export.zip` de ChecklistBank o su TSV.                                                                                             |
| `--ambiente local\|dev\|prod` | Obligatoria. Base de destino; tiene que coincidir con la URL (ver más abajo).                                                       |
| `--escribir`                  | Confirma los cambios. Sin ella, la carga es una simulación.                                                                         |
| `--confirmar-produccion REF`  | Obligatoria para escribir en producción: el identificador del proyecto de producción de Supabase.                                   |
| `--reporte RUTA`              | Ruta del CSV. Por defecto `reporte-carga-<ambiente>-<simulacion\|escritura>-<fecha UTC>.csv` en la carpeta actual (git los ignora). |
| `--detalle-sin-cambios`       | Escribe también una fila por cada registro sin cambios (por defecto solo se cuentan).                                               |

La URL de la base llega **solo** por la variable de entorno `ORKI_CATALOG_DB_URL` (`postgresql://usuario:clave@host:puerto/base`, con `sslmode` como único parámetro admitido), nunca por argumento. No se imprime en ningún caso: los mensajes no la incluyen y los errores de la base pasan por un filtro que quita la contraseña. Mientras conecta, se ignoran las variables `PG*` del entorno, para que libpq use solo la URL comprobada.

### Modo de prueba

Es el modo por defecto: sin `--escribir`, la carga hace **todo** el trabajo dentro de la transacción (bloqueos, altas, cambios, disparadores y comprobaciones) y al final la revierte. Por eso el reporte de la simulación es exacto: dice lo mismo que diría la carga real sobre la misma base (salvo los ids de las filas nuevas, que genera la base). Lo comprueba `test_simulation_writes_nothing_and_reports_exactly`. El tamaño que mide la simulación es el de dentro de la transacción, antes de revertirla.

Se eligió así, en vez de un modo de prueba que solo calcule sin escribir, porque es lo más seguro: sin una opción explícita no se escribe nada, y lo que se simula es exactamente lo que se ejecutaría.

### Protección de ambiente

El destino se indica siempre con `--ambiente`, y el comando se niega a conectarse si la URL no corresponde a ese ambiente:

- `local`: el host tiene que ser de esta máquina (`localhost`, `127.x.x.x` o `::1`) y nunca de Supabase.
- `dev` y `prod`: la URL tiene que ser del proyecto de Supabase de ese ambiente. El proyecto se reconoce por su identificador (ref), en el host de la conexión directa (`db.<ref>.supabase.co`) o en el usuario del pooler (`postgres.<ref>` en `*.pooler.supabase.com`); si el host y el usuario dicen proyectos distintos, también se niega. Los identificadores son los mismos que comprueba `scripts/supabase-db.mjs`. Sin `sslmode` en la URL, se exige TLS.
- Escribir en producción exige además `--confirmar-produccion` con el identificador del proyecto de producción. Una simulación en producción no lo necesita, pero bloquea la escritura del catálogo mientras dura (unos segundos).

Todas estas comprobaciones se hacen antes de leer la fuente y de conectar.

### Qué hace, paso a paso

Todo dentro de la misma transacción:

1. Fija `lock_timeout` (15 s) y `statement_timeout` (15 min) para esa transacción y bloquea `genera`, `species` y `species_names` en modo `share row exclusive`: se pueden seguir leyendo (la búsqueda funciona), pero nadie más escribe en ellas hasta que acaba. Así lo que se lee en el paso 2 sigue siendo cierto al escribir.
2. Comprueba el esquema (también que existan la auditoría del catálogo y la memoria de las fusiones: sin ellas, una carga con `--escribir` termina aquí) y lee lo que hay: géneros con sus abreviaturas, especies, nombres alternativos, cuántas plantas tiene cada especie y la memoria de las fusiones (ver [Fusiones de especies](#fusiones-de-especies)).
3. Decide qué hacer con cada registro de la fuente (`plan_load`, una función pura, sin base) y deja la fila de resumen en la auditoría (ver [Resumen en la auditoría](#resumen-en-la-auditoría)).
4. Escribe por conjuntos: copia con `COPY` las altas y los cambios a tablas temporales y los aplica con una sentencia por tabla (géneros renombrados, géneros nuevos, especies nuevas, especies actualizadas y sinónimos nuevos). Cada sentencia tiene que afectar exactamente a las filas previstas; si no, falla y se revierte todo. Solo se actualizan las filas que cambian, así que `updated_at` no se mueve sin motivo.
5. Si escribe, actualiza las estadísticas (`analyze`) de las tres tablas, para que la búsqueda use bien los índices desde el principio.
6. Mide el tamaño de la base y de las tablas del catálogo y cuenta géneros, especies y nombres.
7. Confirma o, en simulación, revierte.

### Reglas de la carga

**Géneros.** La base no guarda la clave de COL de los géneros, así que se casan por nombre, sin distinguir mayúsculas y sin contar el signo «×».

- Si hay un género con el mismo nombre (sin distinguir mayúsculas), es ese. Si solo difiere en mayúsculas, se usa igualmente pero no se cambia: va al reporte como conflicto (`GENERO_MAYUSCULAS_DISTINTAS`).
- Si solo hay uno que difiere en el signo «×», se **renombra** como lo escribe la fuente (decisión de producto: el nothogénero lleva «× » delante), conservando su id, sus abreviaturas, su marca de acceso rápido y sus especies (`GENERO_RENOMBRADO`, con el nombre anterior en el detalle). Con COL26.10 XR pasa con tres de los géneros que precargan las migraciones: Brassocattleya (Bc.), Cattlianthe (Ctt.) y Laeliocattleya (Lc.).
- Si hay varios que solo se distinguen por el «×», no se toca ninguno y sus especies se rechazan (`GENERO_AMBIGUO`, `GENERO_EN_CONFLICTO`).
- Si no hay ninguno, se crea (`GENERO_NUEVO`), sin acceso rápido.
- Los **nothogéneros aceptados sin especies importadas** (33 en COL26.10 XR, casi todos de vivero, como «× Aliceara» o «× Mokara») no se crean, porque un género sin especies no aporta nada al catálogo. Pero sí se usan para poner el signo a un género que ya exista sin él: la fuente sigue siendo la autoridad sobre cómo se escribe ese nombre, y el género ya está en la base (lo creó un administrador o una migración), así que solo se alinea su grafía. Con COL26.10 XR ninguno coincide con un género precargado.
- Los géneros de la base que la fuente no trae no se tocan y se listan como `GENERO_NO_EN_FUENTE`. Con COL26.10 XR son tres de los precargados: Rhyncholaeliocattleya (Rlc.), Odontoglossum (Odm.) y Sophronitis (Soph.), que COL trata como sinónimos de otros géneros. Rhyncholaeliocattleya se queda **sin** «×», porque la fuente no dice nada de él. En cambio, Ascocenda, Brassolaeliocattleya, Doritaenopsis y Sophrolaeliocattleya están en COL como géneros aceptados **sin** «×» y con especies, así que se quedan como están.
- Nunca se borra ni se fusiona un género.

**Especies.** Se insertan o se actualizan por `(source = 'col', source_ref)`, con estado `imported` y tipo `species` o `hybrid`. Lo que se compara es el nombre científico, el género y el tipo (la base no guarda la autoría).

| Situación en la base                                                                 | Qué hace                                                                           | Código                  |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------- |
| No hay nada con esa clave ni con ese nombre                                          | La inserta                                                                         | `ESPECIE_NUEVA`         |
| Misma clave, mismos datos                                                            | Nada                                                                               | `ESPECIE_SIN_CAMBIOS`   |
| Misma clave, datos distintos, estado `imported`                                      | La actualiza; el detalle dice qué cambió y a cuántas plantas se propaga            | `ESPECIE_ACTUALIZADA`   |
| Misma clave, datos distintos, estado `validated` u `observed`                        | No la toca                                                                         | `ESPECIE_PROTEGIDA`     |
| Mismo nombre con otra fuente (`curated`, `user_proposal`, `gbif`)                    | No la toca y no carga sus sinónimos                                                | `NOMBRE_DE_OTRA_FUENTE` |
| Mismo nombre de `col` con otra clave que la fuente ya no trae, estado `imported`     | Actualiza la clave (COL cambió claves por error en 2026, ver FUENTE.md, sección 6) | `CLAVE_ACTUALIZADA`     |
| Lo mismo, pero `validated` u `observed`                                              | No la toca ni carga sus sinónimos                                                  | `ESPECIE_PROTEGIDA`     |
| Mismo nombre de `col` con otra clave que la fuente sigue trayendo para otro registro | No la toca y no carga sus sinónimos                                                | `CLAVE_DISTINTA`        |
| Misma clave, la fuente le cambia el nombre a uno que ya usa otra especie             | No la cambia                                                                       | `NOMBRE_OCUPADO`        |
| Su género está en conflicto                                                          | La rechaza                                                                         | `GENERO_EN_CONFLICTO`   |
| Especie de `col` cuya clave la fuente ya no trae                                     | La conserva y la lista                                                             | `ESPECIE_NO_EN_FUENTE`  |

Un nombre nuevo nunca se asigna si en ese momento lo tiene otra fila, aunque esa fila también fuera a cambiar: así ninguna sentencia puede chocar a mitad con el índice único de nombres.

Cambiar el género o el tipo de una especie dispara `propagate_species_to_plants`, que lleva el cambio a las plantas de los usuarios enlazadas a ella. Es lo esperado (la planta sigue a su especie), pero el reporte lo anota («se propaga a N plantas de usuarios»). Una especie protegida nunca cambia, así que tampoco sus plantas.

**Especie «editada» por un administrador.** El esquema no tiene todavía auditoría (#23) ni marca de edición: la única señal segura de que un administrador revisó una especie es que su estado ya no es `imported` (la validó o la marcó como observada). Eso es lo que protege la carga. **Limitación:** si un administrador cambia el género, el tipo o el nombre de una especie y la deja como `imported`, la siguiente carga lo devuelve a lo que dice la fuente (y lo anota como `ESPECIE_ACTUALIZADA`, con el cambio). `updated_at` no sirve para distinguirlo, porque también lo mueve la propia carga. Quien edite una especie importada debe validarla u observarla para protegerla; cuando exista la auditoría, la carga podrá usarla. Los géneros no tienen estado: la carga solo les cambia el signo «×».

**Sinónimos.** Se cargan en `species_names` con tipo `synonym`, sin idioma. La base no guarda su clave de COL, así que se identifican por especie y nombre (sin distinguir mayúsculas), como su índice único.

- Si la especie no tiene ese nombre, se añade (`SINONIMO_NUEVO`). También a las especies protegidas: añadir un nombre alternativo no cambia nada de lo que el administrador validó y mejora la búsqueda.
- Si ya lo tiene como sinónimo, nada (`SINONIMO_SIN_CAMBIOS`); si lo tiene como nombre común, no se cambia (`SINONIMO_ES_NOMBRE_COMUN`, conflicto); si coincide con el nombre científico que la especie tiene en la base, no se carga (`SINONIMO_IGUAL_AL_NOMBRE`).
- Los sinónimos de especies que no se cargaron se rechazan (`SINONIMO_SIN_ESPECIE`).
- Nunca se cambia ni se borra un nombre que ya esté. Los sinónimos de especies de COL que la fuente ya no trae se conservan y solo se cuentan; la cuenta incluye los añadidos a mano, porque la base no distingue uno de otro. Si COL mueve un sinónimo de una especie a otra, queda en las dos.

### Fusiones de especies

Un administrador puede fusionar una especie duplicada (la absorbida) en otra (la conservada) desde el backoffice (#21). La fusión borra la absorbida, pasa sus nombres a la conservada y guarda su clave de fuente en la memoria de las fusiones, `public.species_merge_keys` (`(source, source_ref)` → `species_id` de la conservada; ver [Memoria de las fusiones](../../supabase/README.md#memoria-de-las-fusiones)). Las dos cargas (`cargar` y `cargar-hibridos`) leen la memoria entera, unida a `species`, justo después de bloquear las tablas y antes de planificar (#137), y la usan así:

| Caso                                                                                                                                                                                               | Qué hace                                                                                                                                       | Código                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Registro de la fuente cuya clave está en la memoria (de COL, o fila revisada de la lista curada)                                                                                                   | No se crea ni se actualiza; tampoco se mira su género (no se crea uno nuevo para él). El detalle dice en qué especie vive su clave y su estado | `ESPECIE_FUSIONADA` (resultado `omitido_por_fusion`) |
| Sus nombres: el nombre del registro (como sinónimo), sus sinónimos y, en la lista, sus nombres comunes                                                                                             | Se añaden a la conservada los que no tiene                                                                                                     | `NOMBRE_A_LA_CONSERVADA` (`nuevo`)                   |
| Un nombre que la conservada ya tiene (de cualquier tipo, o su nombre científico) o que esta carga ya le añade; entre ellos, el nombre científico absorbido, que la fusión ya convirtió en sinónimo | No se añade ni falla                                                                                                                           | `NOMBRE_EN_LA_CONSERVADA` (`sin_cambios`)            |
| Además hay en la base una especie con esa clave (la recreó una carga anterior a #137)                                                                                                              | No se toca; el detalle de `ESPECIE_FUSIONADA` pide fusionarla otra vez en la conservada                                                        | `ESPECIE_FUSIONADA`                                  |
| Registro nuevo (su clave no está en la memoria) con el nombre de una especie absorbida, sin distinguir mayúsculas ni el «×» (por ejemplo, COL le cambió la clave)                                  | No se crea, para no deshacer la fusión, y sus nombres se rechazan                                                                              | `NOMBRE_FUSIONADO` (`conflicto`)                     |
| Fila de la lista sin revisar cuyo identificador está en la memoria                                                                                                                                 | Lo de siempre; el detalle avisa de que, aunque se revise, no se creará                                                                         | `NO_REVISADA` (`omitido`)                            |

**La conservada no se pisa.** La carga nunca escribe la especie conservada con los datos de un registro absorbido (ni nombre, ni género, ni tipo). La conservada se trata por su propia clave con las reglas de siempre: la fusión la deja `validated` si era `imported`, así que la importación de COL ya no la cambia (`ESPECIE_PROTEGIDA` si la fuente trae otra cosa). Lo único que recibe son nombres alternativos, igual que cualquier especie protegida (añadir un nombre no cambia nada de lo validado), y sea cual sea su fuente: la fusión la decidió un administrador.

**Cómo se comparan los nombres.** `species_names` no guarda de qué fuente viene cada nombre, y la fusión ya pasó a la conservada los de la absorbida, así que lo normal es que la siguiente carga los encuentre allí. Hay dos comparaciones en juego:

- La carga, en el resto de casos, compara en minúsculas (`lower`), que es lo que impone el índice único `species_names_species_id_name_key`.
- La fusión compara con `public.normalize_search_text()`, que además quita las tildes y el signo «×» (y una «x» suelta). Por eso descartó, por ejemplo, «Cymbidium amábile» si la conservada ya tenía «Cymbidium amabile»: en minúsculas son distintos, pero la búsqueda los confunde.

Para los nombres que van a una conservada, un nombre **ya está** si coincide con alguno de la conservada (o con uno que esta carga ya le añade) en **cualquiera** de las dos: en minúsculas, para no chocar con el índice, o tras `normalize_search_text()`, para no volver a meter lo que la fusión descartó. Es lo seguro: en el peor caso no se añade un nombre que la búsqueda ya encuentra por otro igual tras normalizar. La clave normalizada la calcula la propia base (una consulta con los nombres de la fuente y de las conservadas, solo si hay fusiones), así que es exactamente la de la fusión, sin reimplementar `unaccent` en Python. Los nombres de los registros absorbidos se planifican después de todos los demás, para saber qué añade la carga a cada conservada (su propio registro puede traer el mismo nombre nuevo) y no insertarlo dos veces.

**Sin fusiones**, la carga hace exactamente lo mismo que antes: el plan, el reporte (filas y totales) y el resumen por pantalla no cambian; solo el resumen de la auditoría lleva `omitted_by_merge: 0`. Con fusiones solo de otra fuente (una entrada de la lista curada fusionada), la carga de COL tampoco cambia, salvo que traiga uno de los nombres absorbidos (`NOMBRE_FUSIONADO`).

**Si la base no tiene la memoria** (falta `public.species_merge_keys`, de la migración `20261121160000_fusion_de_especies.sql`) o el usuario no la puede leer entera (sin permiso de `select`, o con RLS aplicada, que solo deja verla a un administrador con token y daría una memoria vacía), se hace lo mismo que sin la auditoría: una carga con `--escribir` **se niega** antes de escribir nada, y la simulación funciona como si no hubiera fusiones y avisa de que la escritura se negaría (en el resumen y en la fila `FUSIONES` del reporte, con `nombre = sin memoria`). Sin la tabla tampoco puede haber fusiones (la función está en la misma migración), así que escribir sería inofensivo en ese caso concreto, pero no con un usuario que no la ve entera; y así el orden es el de siempre: aplicar las migraciones y después cargar.

**Concurrencia.** La fusión escribe en `species` y `species_names`, que la carga tiene bloqueadas: la carga ve las fusiones confirmadas antes de su bloqueo, y una fusión que empiece mientras dura la carga espera a que termine (o, si llegan a chocar, una de las dos falla entera y no deja nada).

**Limitaciones.** En el registro propio de la conservada, los nombres que le pasó la fusión cuentan como «en la base y no en la fuente» (`NOMBRE_NO_EN_LISTA` en la lista curada; la cuenta de sinónimos que la fuente no trae, en COL), porque la base no sabe de dónde vino cada nombre. Si se borra la conservada, su memoria se va con ella y la siguiente carga vuelve a crear las absorbidas (ver la memoria en `supabase/README.md`).

### Reporte

Un CSV (UTF-8 con BOM, para que una hoja de cálculo lea bien las tildes y el «×») y un resumen por pantalla. Columnas: `entidad` (`carga`, `genero`, `especie` o `sinonimo`), `resultado`, `codigo`, `source_ref` (clave de COL), `nombre`, `especie` (en los sinónimos, «Nombre (clave)» de su especie), `detalle` y `id_base`.

- `resultado` es `nuevo`, `actualizado` (con lo que cambió en `detalle`), `sin_cambios` (solo con `--detalle-sin-cambios`), `conflicto`, `rechazado`, `no_en_fuente` u `omitido_por_fusion` (ver [Fusiones de especies](#fusiones-de-especies)), con su código y su motivo. Los descartes y ajustes de la normalización van también, como `descartado` y `ajustado`, con sus códigos de la tabla de arriba.
- Las filas de `entidad = carga` (`resultado = info`) dan la fuente (alias, clave, DOI, versión, fecha y archivo), el ambiente y el destino (sin credenciales), el modo, la fecha, los totales por entidad y resultado (`TOTAL`, también los sin cambios), los recuentos de la base al terminar (`RECUENTO`), los tamaños en bytes de la base y de las cuatro tablas del catálogo con sus índices (`TAMANO`) y los tiempos (`TIEMPO`). La fila `AUDITORIA` da el identificador de la carga y qué pasó con su resumen en la auditoría. La fila `FUSIONES` solo aparece si hay claves de esta fuente en la memoria de las fusiones (cuántas, y cuántos registros se omitieron por fusión) o si la base no tiene la memoria (`sin memoria`). El resumen por pantalla añade en esos casos una línea `Fusiones: …` o el aviso, y la cuenta `omitidos por fusión` en la línea de especies (o de híbridos).

### Resumen en la auditoría

Cada ejecución de `cargar` y de `cargar-hibridos` con `--escribir` deja **exactamente una fila** en `public.catalog_audit_log` (la auditoría del catálogo, #23), con `private.log_catalog_action()` y **en la misma transacción que la carga**: si la carga falla y se revierte, el resumen también, así que nunca queda el resumen de una carga que no terminó. La conexión de la carga no trae token de usuario, así que el disparador de la auditoría no registra sus cambios fila a fila (una importación de COL toca decenas de miles); este resumen es el único registro de la carga.

| Columna                                            | Valor                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action`                                           | `catalog_import`                                                                                                                                                                                                                                                  |
| `actor`                                            | El identificador de la carga (ver abajo)                                                                                                                                                                                                                          |
| `table_name`, `row_id`, `old_values`, `new_values` | `null`                                                                                                                                                                                                                                                            |
| `details.load_type`                                | `catalogo` o `hibridos`                                                                                                                                                                                                                                           |
| `details.environment`                              | `local`, `dev` o `prod`                                                                                                                                                                                                                                           |
| `details.source`                                   | COL: `name`, `alias`, `key`, `doi`, `published` y `sha256` de [`fuente.json`](fuente.json), y `file`, `file_sha256` y `file_matches_pinned` del archivo cargado. Híbridos: `name`, `file`, `sha256` del CSV (su versión), `entries` y `reviewed`                  |
| `details.counts`                                   | Por tabla (`genera`, `species` y `species_names`), filas `created`, `updated` y `unchanged`, los mismos totales del reporte (`nuevo`, `actualizado` y `sin_cambios`; en `species_names` se suman sinónimos y nombres comunes)                                     |
| `details.omitted_by_merge`                         | Registros de la fuente que no se crearon ni se actualizaron porque su clave está en la memoria de las fusiones (el total `especie omitido_por_fusion` del reporte); `0` si no hay fusiones. Los nombres que reciben las conservadas van en `counts.species_names` |
| `details.run`                                      | En GitHub Actions, `github_run_id`, `github_run_number`, `github_run_attempt` y `commit`; en local, `null`                                                                                                                                                        |

Repetir la misma carga deja un segundo resumen, con todo en `unchanged`. Los conflictos, rechazos y filas que no están en la fuente no van al resumen: están en el reporte CSV.

**Identificador de la carga.** En GitHub Actions (workflow «Importar catálogo»), `github-actions:<GITHUB_RUN_ID>:<GITHUB_RUN_ATTEMPT>`: con el id se llega a la ejecución (`https://github.com/rcronald/orki-app/actions/runs/<id>`), con su registro y su reporte, y el intento distingue una repetición. Las variables las pone el propio ejecutor; si se está en Actions y no son números, la carga termina sin conectarse. En cualquier otro sitio, `local:` y un uuid aleatorio, distinto en cada ejecución. Nunca se usa el usuario de GitHub (`GITHUB_ACTOR`), el del sistema, un correo ni el nombre de la máquina. El identificador sale en el resumen por pantalla y en la fila `AUDITORIA` del reporte.

**Simulaciones.** No dejan registro: el resumen se inserta igual dentro de la transacción (para ensayar también ese paso) y se revierte con todo lo demás.

**Si la base no tiene la auditoría** (falta `private.log_catalog_action()`, de la migración `20261121140000_auditoria_del_catalogo.sql`; por ejemplo, producción antes de fusionar esa migración): una carga con `--escribir` **se niega** con un mensaje que lo dice, antes de escribir nada en el catálogo (la comprobación va justo después del bloqueo, antes de leer la base). Se eligió así para que no pueda haber una carga escrita sin su resumen; la alternativa, escribir sin resumen y avisar, dejaría cargas sin rastro. La simulación sí funciona y avisa de que la escritura se negaría. El orden es el de siempre: aplicar la migración y después cargar.

### Resultado con COL26.10 XR

Medido el 20 de noviembre de 2026 con el archivo completo (`export.zip` de 137 MB) sobre un Postgres 17.12 en un contenedor `postgres:17` (Podman, máquina virtual de 4 CPU y 3,7 GB, en un Apple M4 Pro), en una base nueva con todas las migraciones:

- **Primera carga:** 712 géneros nuevos y 3 renombrados con «×» (Brassocattleya, Cattlianthe, Laeliocattleya), 37 sin cambios; 32 464 especies nuevas; 60 000 sinónimos nuevos; ningún conflicto ni rechazo. Quedan 755 géneros, 32 464 especies y 60 000 sinónimos. Tarda unos 7,4 s en total: 4,0 s leer y normalizar la fuente y 2,8 s en la base (2,7 s de escritura). El reporte tiene 121 161 filas.
- **Segunda carga:** 0 altas, 0 cambios, 0 conflictos; 752 géneros, 32 464 especies y 60 000 sinónimos sin cambios. Ninguna fila cambia (comprobado con una suma de control de ids, nombres y `updated_at` antes y después). Tarda 1,2 s en la base.
- **La simulación** sobre la base vacía da el mismo reporte que la carga real y tarda lo mismo.
- **Tamaño** tras `vacuum analyze`: la base completa ocupa 42 MB, `species` 14 MB (con el índice de trigramas de 5,6 MB), `species_names` 19 MB (índice de trigramas 7,1 MB), `genera` 0,5 MB y `genus_abbreviations` 0,1 MB: unos 34 MB de catálogo, muy por debajo de los 500 MB del plan gratuito. Justo después de la carga, sin `vacuum`, el reporte da 49,7 MB.

Primera medición de `public.search_species` con datos reales, sobre esa misma base y como `anon` (tiempo dentro de la base, 3 llamadas de calentamiento y 30 medidas, 10 resultados):

| Consulta             | Mediana (ms) | p95 (ms) | Primer resultado                                                                                                         |
| -------------------- | -----------: | -------: | ------------------------------------------------------------------------------------------------------------------------ |
| `phal amab`          |         18,6 |     20,8 | Phalaenopsis amabilis                                                                                                    |
| `catleya`            |         20,3 |     20,8 | Cattleya × cattleyioides                                                                                                 |
| `ph`                 |         18,2 |     19,2 | Phalaenopsis amabilis                                                                                                    |
| `dendrob`            |         43,9 |     48,6 | Dendrobium aberrans                                                                                                      |
| `rlc`                |         15,6 |     16,5 | × Laeliocattleya calimaniana                                                                                             |
| `bc`                 |         15,2 |     16,0 | × Brassocattleya arauji                                                                                                  |
| `den nob`            |         42,9 |     46,8 | Dendrobium nobile                                                                                                        |
| `phal x interm`      |         15,1 |     16,2 | Bulbophyllum phalaenopsis (la buscada sale cuarta)                                                                       |
| `doritis pulch`      |          6,1 |      6,4 | Phalaenopsis parishii (por el sinónimo Doritis parishii; Phalaenopsis pulcherrima sale tercera)                          |
| `cymbidium amabile`  |         15,5 |     16,2 | Phalaenopsis amabilis (por el sinónimo)                                                                                  |
| `epidendrum amabile` |         26,9 |     29,0 | Encyclia jenischiana (por el sinónimo homónimo Epidendrum amabile; Phalaenopsis amabilis también lo tiene, como ambiguo) |
| `catleya labiatta`   |         15,3 |     18,0 | Cattleya labiata                                                                                                         |
| `grandiflora`        |         26,5 |     38,5 | Aeranthes grandiflora                                                                                                    |
| `alba`               |         22,4 |     23,5 | Appendicula alba                                                                                                         |
| `xqzvkjw`            |          0,2 |      0,3 | (ninguno)                                                                                                                |

Todas quedan muy por debajo del objetivo de 300 ms y en el orden de lo medido con el catálogo sintético. Dos observaciones sobre los resultados, para la búsqueda (#7), no para la carga: `rlc` no encuentra ninguna especie de Rhyncholaeliocattleya porque COL no trae ese género, y `phal x interm` pone delante nombres que contienen «phalaenopsis» como epíteto.

### Pruebas de la carga

`tests/test_load_db.py` prueba la carga contra una base desechable: carga de la muestra, segunda carga sin cambios (ninguna fila distinta, tampoco `updated_at`), simulación que no escribe y da el mismo reporte, fallo a mitad (un disparador que falla al insertar una especie) que no deja nada, especie validada u observada que no cambia y sale como conflicto, especie importada editada sin cambiar el estado (la limitación), nombre de la lista curada o de una propuesta, género sin «×» que pasa a llevarlo conservando su abreviatura, nothogénero sin especies que solo renombra, sinónimos y nombres comunes añadidos a mano que se conservan, sinónimo de la fuente que ya es nombre común, claves cambiadas (importada, validada y clave que la fuente sigue usando), propagación a las plantas y que no se imprime la contraseña. `tests/test_audit_db.py` prueba el resumen en la auditoría: una sola fila con su fuente, versión y recuentos tras escribir (COL e híbridos), un segundo resumen con todo sin cambios al repetir, ninguno tras una simulación ni tras un fallo a mitad, que las filas de la carga no se auditan una a una (con el rol `postgres`, no superusuario), la negativa a escribir sin la función de auditoría (y el aviso de la simulación) y el identificador en GitHub Actions sin el usuario de GitHub; `tests/test_merges_db.py`, la carga después de una fusión hecha de verdad con `merge_species()` como administrador (COL y lista curada): la absorbida no se recrea ni se toca la conservada validada, sus nombres nuevos van a la conservada sin duplicar (iguales en minúsculas, sin tildes o sin «×», o que la conservada también trae), su recuento en el reporte, en el resumen y en la auditoría, el nombre absorbido con otra clave, la especie recreada antes de la memoria, el mismo plan sin fusiones o con fusiones de otra fuente, la negativa a escribir sin la memoria (y el aviso de la simulación) y la memoria oculta por RLS; `tests/test_audit.py`, el identificador y los recuentos sin base. `tests/test_target.py` prueba la protección de ambiente y que las credenciales no salen en ningún mensaje, sin base. `tests/test_hybrids.py` prueba la validación de la lista curada sin base (cada código de error, BOM, comillas, el signo «×», el CSV versionado y que la carga no conecta con una lista con errores ni escribe en producción sin confirmación), y `tests/test_hybrids_db.py`, su carga contra la base desechable: carga, recarga sin cambios, fila añadida, fila revisada después, conflictos con una especie de COL (también por el signo) y con una curada sin referencia, géneros con y sin signo, filas no revisadas omitidas, entrada protegida, entrada corregida y nombres quitados que se conservan, edición del administrador revertida (la limitación), simulación que no escribe, fallo a mitad sin efectos y que el borrador sin revisar no escribe nada.

Las de la base necesitan `ORKI_TEST_DB_URL`, la misma variable que `npm run db:test`: un Postgres local con un superusuario (solo se aceptan hosts de esta máquina). Con ella, `tests/basedatos.py` crea una base plantilla con lo mínimo de Supabase (`scripts/db-desechable/supabase-minimo.sql`) y todas las migraciones, cada una en su transacción y con el rol `postgres`, y cada prueba trabaja en una copia que se borra al terminar. Sin la variable, se saltan; en el CI (variable `CI`) fallan, para que no se salten sin que nadie lo vea.

```sh
ORKI_TEST_DB_URL=postgresql://supabase_admin:desechable@127.0.0.1:55417/postgres uv run pytest
```

Las pruebas siguen bloqueando la red de Python; la conexión a la base la hace libpq, y solo a un host local.

### Limitaciones

- La protección del trabajo del administrador se basa solo en el estado (ver arriba).
- Las pruebas se conectan como superusuario; en Supabase la carga se conectará como `postgres`, que es el dueño de las tablas pero no superusuario. Lo que hace la carga (bloquear, `COPY` a tablas temporales, escribir las cuatro tablas, `analyze`, el resumen en la auditoría) no necesita más que eso, y una prueba la ejecuta con el rol `postgres` (`test_load_rows_are_not_audited_one_by_one`), pero no se ha probado contra un proyecto de Supabase.
- Con el pooler en modo transacción (puerto 6543) la carga también debería funcionar, porque es una sola transacción y no usa sentencias preparadas, pero no se ha probado; la conexión directa o el pooler en modo sesión (puerto 5432) son la opción segura.
- Los datos de ejemplo de desarrollo (`supabase/datos-ejemplo/`) tienen especies de fuente `curated` con nombres que COL también trae (por ejemplo Phalaenopsis amabilis): en desarrollo saldrán como `NOMBRE_DE_OTRA_FUENTE` y no se cargarán sus sinónimos.

## Lista curada de híbridos

El Catalogue of Life casi no trae híbridos de vivero (grex), que son la mayoría de lo que se vende. La lista curada, [`data/hibridos.csv`](data/hibridos.csv), los añade al catálogo con sus nombres comerciales o de etiqueta (issue #9; especificación, sección 11). La cura una persona: cada fila se marca como revisada antes de cargarse. Para especies manda el Catalogue of Life; para híbridos, la lista.

### Formato del CSV

UTF-8 (con o sin BOM), separado por **comas**, una fila por híbrido y esta cabecera, exacta y en este orden:

```csv
id,nombre,genero,nombres_comunes,otros_nombres,revisado,notas
HIB-0001,Phalaenopsis Sogo Yukidian,Phalaenopsis,,Doritaenopsis Sogo Yukidian,sí,Verificado en la RHS.
HIB-0016,Cattlianthe Chocolate Drop,× Cattlianthe,,Cattleya Chocolate Drop,no,Etiquetas antiguas: Cattleya Chocolate Drop.
HIB-0026,Oncidium Sharry Baby,Oncidium,orquídea chocolate,Oncidium Sharry Baby 'Sweet Fragrance',sí,"Huele a chocolate, sobre todo de mañana."
```

| Columna           | Obligatoria | Qué lleva                                                                                                                                                                                                                                                                |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`              | Sí          | Identificador estable: `HIB-` y cuatro cifras. Es el `source_ref` de la especie en la base. **Nunca se cambia ni se reutiliza**, aunque se corrija el nombre o se borre la fila: es lo que permite recargar sin duplicar. Una fila nueva toma el siguiente número libre. |
| `nombre`          | Sí          | Nombre aceptado: el grex completo con el género («Phalaenopsis Sogo Yukidian»). El grex empieza por mayúscula, sin el signo «×» (en los grex no se escribe, tampoco en los de nothogéneros) y sin el clon entre comillas.                                                |
| `genero`          | Sí          | El género del nombre (la primera palabra), con o sin «× » delante: «× Cattlianthe» o «Cattlianthe». Se casa con los géneros de la base sin distinguir mayúsculas ni el signo; conviene escribirlo como está en el catálogo. Todas las filas de un género, igual.         |
| `nombres_comunes` | No          | Nombres comunes o comerciales con los que se vende ese híbrido («orquídea chocolate»), separados por `\|`. Se cargan como nombres comunes, sin idioma. No pongas aquí el nombre de un género entero («orquídea mariposa»): no identifica el híbrido.                     |
| `otros_nombres`   | No          | Otras grafías y nombres de etiqueta: el género antiguo («Doritaenopsis Sogo Yukidian», «Potinara Toshie Aoki») o la etiqueta con el clon («Oncidium Sharry Baby 'Sweet Fragrance'»), separados por `\|`. Se cargan como sinónimos.                                       |
| `revisado`        | Sí          | `sí` o `no`, exactamente (con tilde). Solo se cargan las filas con `sí`.                                                                                                                                                                                                 |
| `notas`           | No          | Texto libre: fuente consultada, dudas. No se carga. Hasta 500 caracteres.                                                                                                                                                                                                |

Editarlo en una hoja de cálculo sin romperlo:

- **Comas y comillas.** Una celda que lleve comas va entre comillas dobles (`"Huele a chocolate, sobre todo de mañana."`), como hace cualquier hoja de cálculo al exportar a CSV. En los nombres no se usan comillas dobles; el apóstrofo es el recto `'` («Robert's Delight»), no el tipográfico `’` que ponen algunos programas al escribir.
- **Separador de listas.** La barra `|`; los espacios junto a ella no cuentan (`orquídea chocolate | chocolate`).
- **Exportar.** En Google Sheets, Archivo > Descargar > CSV. En Excel, «CSV UTF-8 (delimitado por comas)»: con la configuración regional de Perú o España, el «CSV» normal puede salir separado por punto y coma o en otra codificación, y la validación lo rechaza (y lo dice). LibreOffice: juego de caracteres UTF-8 y separador coma.
- **El signo «×»** solo va en la columna `genero`, y siempre como «× » (U+00D7 y un espacio). Una «x» latina o un «×» pegado al nombre son un error.

### Validación

`orki-catalogo validar-hibridos data/hibridos.csv` comprueba el formato sin conectarse a nada; la carga ejecuta la misma validación antes de conectar y, con un solo error, termina sin escribir nada. La lista **entera** pasa la validación de formato también con filas sin revisar (el CI la ejecuta sobre el CSV versionado). Cada error dice la fila de la hoja de cálculo (la cabecera es la fila 1), la columna y un código:

| Código                      | Qué comprueba                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CODIFICACION`              | El archivo está en UTF-8 (con o sin BOM al principio, nunca en medio).                                                                                                                                       |
| `COMILLAS`                  | El CSV está bien formado (por ejemplo, ninguna comilla doble sin cerrar).                                                                                                                                    |
| `CABECERA`                  | La cabecera es exactamente la de arriba; si parece separada por punto y coma, lo dice.                                                                                                                       |
| `FILA_VACIA`, `COLUMNAS`    | Ninguna fila vacía (tampoco `,,,,,,`) y cada fila con sus 7 columnas.                                                                                                                                        |
| `VACIO`                     | `id`, `nombre` y `genero` no están vacíos.                                                                                                                                                                   |
| `ID_FORMATO`, `ID_REPETIDO` | El identificador tiene el formato `HIB-0000` y no se repite.                                                                                                                                                 |
| `ESPACIOS`, `CARACTER`      | Sin espacios al principio, al final ni dobles (tampoco de no separación) y sin caracteres invisibles; en los nombres, sin «×», comillas dobles o tipográficas ni la barra.                                   |
| `LONGITUD`                  | Cada nombre, hasta 100 caracteres (lo más largo que acepta el buscador), y las notas, hasta 500.                                                                                                             |
| `GENERO`                    | El género es una sola palabra con mayúscula inicial, con «× » delante si es un nothogénero.                                                                                                                  |
| `GENERO_DISTINTO`           | El nombre empieza por el género de la columna `genero` (sin el signo).                                                                                                                                       |
| `GENERO_ESCRITO_DISTINTO`   | Un mismo género se escribe igual en todas las filas (no «× Cattlianthe» en una y «Cattlianthe» en otra).                                                                                                     |
| `NOMBRE`                    | El nombre es género y grex, el grex empieza por mayúscula (un epíteto en minúscula es una especie, que viene de COL) y no lleva el clon entre comillas.                                                      |
| `FORMULA`                   | Ningún nombre lleva una «x» suelta («A x B» es una fórmula, no un grex).                                                                                                                                     |
| `LISTA`                     | Ninguna lista tiene elementos vacíos (`a \|\| b`, una barra al principio o al final).                                                                                                                        |
| `REPETIDO_EN_ENTRADA`       | Dentro de una fila, cada nombre una sola vez y distinto del aceptado, sin distinguir mayúsculas ni el signo.                                                                                                 |
| `NOMBRE_REPETIDO`           | En todo el archivo, cada nombre aceptado una sola vez; ningún nombre común u otro nombre es el aceptado de otra fila, y un otro nombre no está en dos filas. Un nombre común sí puede repetirse entre filas. |
| `REVISADO`                  | `revisado` es `sí` o `no`.                                                                                                                                                                                   |

Lo que la validación no puede saber sin la base (si el género existe, si el nombre ya es una especie de COL) lo decide la carga y va al reporte.

### Carga

`orki-catalogo cargar-hibridos` usa **el mismo flujo** que `orki-catalogo cargar` (ver [Carga en la base de datos](#carga-en-la-base-de-datos)): las mismas opciones (`--ambiente`, `--escribir`, `--confirmar-produccion`, `--reporte`, `--detalle-sin-cambios`), la misma protección de ambiente, la URL solo en `ORKI_CATALOG_DB_URL`, simulación por defecto, una sola transacción con las tablas bloqueadas, escritura por conjuntos que comprueba cada sentencia, `analyze`, medida de la base, el mismo reporte CSV y su fila de resumen en la auditoría (con `load_type = hibridos`, ver [Resumen en la auditoría](#resumen-en-la-auditoría)). Lo único propio es el plan (`plan_hybrids`, en `hybrids_load.py`), que decide qué hacer con cada fila; la lectura de la base, la escritura (`apply_plan`) y la transacción (`run_plan`) son las de `load.py`, con la fuente `curated`.

```sh
cd scripts/catalog-import
uv run orki-catalogo validar-hibridos data/hibridos.csv
uv run orki-catalogo cargar-hibridos data/hibridos.csv --ambiente local             # simulación
uv run orki-catalogo cargar-hibridos data/hibridos.csv --ambiente local --escribir  # carga de verdad
```

El reporte por defecto se llama `reporte-carga-hibridos-<ambiente>-<simulacion|escritura>-<fecha UTC>.csv` (git lo ignora). Repetible: una segunda carga con el mismo CSV no cambia ninguna fila, ni su `updated_at`. Nunca borra nada.

**Reglas.** Cada fila revisada es una especie con fuente `curated`, `source_ref` = su `id`, tipo `hybrid` y estado `validated` (la revisó una persona). Los nombres comunes y otros nombres van a `species_names` como `common` y `synonym`, sin idioma.

| Situación                                                                                              | Qué hace                                                                           | Código                    |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------- |
| Fila con `revisado = no`                                                                               | No la carga; si ya estaba en la base, no la toca                                   | `NO_REVISADA` (`omitido`) |
| No hay nada con ese `id` ni con ese nombre                                                             | La inserta                                                                         | `ESPECIE_NUEVA`           |
| Mismo `id`, mismos datos                                                                               | Nada                                                                               | `ESPECIE_SIN_CAMBIOS`     |
| Mismo `id`, nombre, género o tipo distinto (corrección en el CSV o edición a mano), estado `validated` | La actualiza (el cambio de género o de tipo se propaga a las plantas, como en COL) | `ESPECIE_ACTUALIZADA`     |
| Lo mismo, pero un administrador la dejó `observed` o `imported`                                        | No la toca                                                                         | `ESPECIE_PROTEGIDA`       |
| El nombre nuevo ya lo tiene otra especie                                                               | No cambia el nombre                                                                | `NOMBRE_OCUPADO`          |
| El nombre (sin mayúsculas ni signo) ya es de una especie de COL, `gbif` o una propuesta                | No la carga ni toca la especie; sus nombres se rechazan                            | `NOMBRE_DE_OTRA_FUENTE`   |
| El nombre ya es de una especie curada con otra referencia o sin ella (datos de ejemplo)                | No la carga ni toca la especie; el detalle dice cómo resolverlo                    | `NOMBRE_DE_OTRA_ENTRADA`  |
| Especie de la lista en la base cuyo `id` ya no está en el CSV                                          | La conserva y la lista                                                             | `ENTRADA_NO_EN_LISTA`     |
| Fila revisada cuyo `id` un administrador fusionó en otra especie                                       | No la crea ni la actualiza; sus nombres van a la conservada                        | `ESPECIE_FUSIONADA`       |

Las fusiones se tratan igual que en la carga de COL: ver [Fusiones de especies](#fusiones-de-especies).

Géneros: se casan con los de la base sin distinguir mayúsculas ni el signo «×», igual que en la importación de COL. Si existe, se usa el de la base **sin renombrarlo**, aunque la lista lo escriba de otra forma (la grafía de los géneros la decide la importación de COL; el detalle lo anota con `--detalle-sin-cambios`). Si hay varios que solo se distinguen por el signo, es `GENERO_AMBIGUO` y sus filas se rechazan (`GENERO_EN_CONFLICTO`). Si no existe, **se crea** (`GENERO_NUEVO`), sin abreviatura ni acceso rápido, como hace la importación de COL. Se eligió crearlo en vez de rechazar la fila porque los nothogéneros de vivero son justo los que COL no trae (descarta 33 nothogéneros sin especies, como «× Aliceara» o «× Mokara»), y rechazarlos obligaría a una migración por cada género de la lista. El riesgo es crear un género mal escrito: por eso cada género nuevo va al reporte con su propia fila y hay que mirarlo en la simulación antes de escribir.

Nombres de una fila: se añaden los que faltan (`NOMBRE_NUEVO`); los que ya están con el mismo tipo no cambian (`NOMBRE_SIN_CAMBIOS`); si la especie ya tiene ese nombre con el otro tipo (común en vez de sinónimo), no se cambia (`NOMBRE_DE_OTRO_TIPO`); si coincide con el nombre aceptado que tiene la especie en la base, no se carga (`NOMBRE_IGUAL_AL_ACEPTADO`). Los de una entrada que no se cargó se rechazan (`NOMBRE_SIN_ESPECIE`).

**Cuando una entrada cambia en el CSV entre cargas.**

- Nombre aceptado o género corregidos: se actualiza la misma fila de la base (mismo id, mismas plantas enlazadas), salvo que esté protegida o que el nombre nuevo ya lo tenga otra especie. El nombre anterior no se guarda como sinónimo: si era una grafía válida que se sigue viendo en etiquetas, añádelo a `otros_nombres`.
- Nombre común u otro nombre añadido: se añade.
- Nombre común u otro nombre quitado: **no se borra**; va al reporte como `NOMBRE_NO_EN_LISTA` (`no_en_fuente`), una fila por nombre. Si hay que quitarlo de verdad, lo borra un administrador. Lo mismo con una fila borrada del CSV (`ENTRADA_NO_EN_LISTA`).
- Fila que vuelve a `revisado = no`: no se carga ni se toca lo que ya hay.

**Al revés: la importación de COL** no pisa las entradas de la lista: si una versión nueva de COL trae un nombre que ya tiene la lista, sale como `NOMBRE_DE_OTRA_FUENTE` en su reporte. Pero COL compara el nombre solo sin mayúsculas, no sin el signo: si trajera «Vanda × rothschildiana» y la lista tuviera «Vanda Rothschildiana», entrarían las dos y la búsqueda mostraría ambas. Revisa en el reporte de COL los híbridos nuevos cuando cambie de versión.

**Ediciones de un administrador.** Como las entradas entran ya como `validated`, el estado no distingue «la cargó la lista» de «la validó un administrador». La regla es: **para híbridos manda la lista**, y las correcciones se hacen en el CSV (con su revisión en un pull request). Si un administrador edita en el backoffice el nombre, el género o el tipo de una entrada de la lista y la deja `validated`, la siguiente carga lo devuelve a lo que dice el CSV (`ESPECIE_ACTUALIZADA`, con el cambio en el detalle). Para que la carga no toque una entrada, el administrador la marca como `observed` (o la devuelve a `imported`): desde entonces sale como `ESPECIE_PROTEGIDA` mientras el CSV diga otra cosa. **Limitación**, la misma que en COL: sin auditoría (#23) no hay otra señal; `updated_at` no sirve porque también lo mueve la carga. Los nombres que añada un administrador nunca se tocan (salen como `NOMBRE_NO_EN_LISTA`).

### Cómo añadir un híbrido

1. Comprueba el nombre del grex y su género actual en el registro de híbridos de orquídeas de la Royal Horticultural Society (RHS), la autoridad internacional de registro.
2. Añade una fila al final con el siguiente `id` libre (no reutilices los de filas borradas), el nombre con el género, la columna `genero` como está en el catálogo, los nombres comunes y los otros nombres (géneros antiguos de las etiquetas) y `revisado = sí`. Anota en `notas` qué consultaste.
3. `uv run orki-catalogo validar-hibridos data/hibridos.csv`.
4. Simula contra una base local con COL cargado (o contra desarrollo) y revisa el reporte: géneros nuevos, conflictos con COL (`NOMBRE_DE_OTRA_FUENTE`: ese híbrido ya está en COL como nothoespecie y no hace falta en la lista) y nombres que no se cargan.
5. Abre un pull request; tras fusionarlo, carga en cada ambiente (ver [Ejecución por ambiente](#ejecución-por-ambiente)).

### Cómo revisar el borrador

La lista versionada empezó como un **borrador preparado por un agente** (issue #77): 76 filas, todas con `revisado = no`. El responsable del proyecto revisó 75 el 21 nov 2026 (#78) y la última, HIB-0004, el 22 nov 2026, sin verificarlas en la RHS. Son de los géneros que más se ven en viveros y mercados (Phalaenopsis, Cattleya y sus nothogéneros, Oncidium y afines, Dendrobium, Vanda, Cymbidium, Miltoniopsis, Paphiopedilum, Phragmipedium, Masdevallia). Mientras ninguna fila esté revisada, la carga no escribe nada. No sustituye a la revisión: los nombres salen de memoria, no de una consulta al registro de la RHS, y las dudas concretas están en `notas`. Para cada fila (issue #78):

1. Busca el grex en el registro de la RHS: que exista, la grafía exacta (mayúsculas, apóstrofos, guiones, «St.» o «Saint») y el **género actual** (la RHS reclasificó muchos híbridos: Doritaenopsis → Phalaenopsis, Ascocenda → Vanda, Potinara y Brassolaeliocattleya → Rhyncholaeliocattleya, los de Odontoglossum → Oncidium).
2. Corrige lo que haga falta; pon el género antiguo de las etiquetas en `otros_nombres` y los nombres con los que de verdad se vende en Perú en `nombres_comunes`.
3. Si no existe o no se vende en Perú, borra la fila (mientras ninguna se haya cargado, los `id` todavía se pueden renumerar; después, nunca).
4. Cambia `revisado` a `sí` y deja en `notas` la fuente.
5. Valida y simula como en «Cómo añadir un híbrido». Con COL26.10 XR, el borrador entero marcado como revisado da 76 altas, 2 géneros nuevos (Burrageara y Miltassia, que conviene comprobar) y ningún conflicto: Paphiopedilum Maudiae, Paphiopedilum Leeanum y Phragmipedium Sedenii se quitaron del borrador porque COL ya los trae como nothoespecies («Paphiopedilum × maudiae»…).

## Ejecución por ambiente

| Ambiente   | Dónde se ejecuta                                                        | Credenciales                                                                |
| ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Local      | Tu máquina, contra un Postgres desechable                               | Las del contenedor, que no son secretas                                     |
| Desarrollo | Tu máquina o el workflow, contra el proyecto de desarrollo              | La contraseña de la base de desarrollo, solo en la variable de entorno      |
| Producción | **Solo** el workflow `importar-catalogo.yml`, con el environment `prod` | Secretos y variables del environment `prod` de GitHub; nunca en una máquina |

### Antes de cargar: las migraciones

La carga necesita que el ambiente tenga aplicadas todas las migraciones del catálogo: las de la fuente `col` (`20261120220000_fuente_col_en_especies.sql` y `20261120220100_col_exige_referencia.sql`) las de la búsqueda (`search_species`, `search_genera` y sus índices) y, para escribir, la de la auditoría (`20261121140000_auditoria_del_catalogo.sql`) y la de la fusión de especies (`20261121160000_fusion_de_especies.sql`, con la memoria de las fusiones), además de las anteriores del catálogo. `orki-catalogo cargar` solo comprueba que exista el valor `col` de la fuente y, al escribir, la función de la auditoría y la memoria de las fusiones; si falta algo, termina sin escribir nada. El resto no lo comprueba, así que mira antes que no quede ninguna migración pendiente. El orden es siempre:

1. Aplicar las migraciones en el ambiente: `npm run db:push` en desarrollo o el workflow «Migraciones» en producción, que corre solo al fusionar en `main` (ver [Base de datos y migraciones](../../README.md#base-de-datos-y-migraciones)). `npm run db:status` dice cuáles están aplicadas.
2. Simular la carga y revisar el reporte.
3. Escribir.

No lances una importación mientras corre el workflow de migraciones en el mismo ambiente: son grupos de concurrencia distintos y no se esperan entre sí. La carga bloquea las tablas del catálogo mientras dura, así que una migración que las toque esperaría o fallaría por `lock_timeout`.

### En local

Ver [En local](#en-local), arriba: un Postgres desechable, las migraciones aplicadas con `psql` y `--ambiente local`. Sirve para probar un cambio del script o una versión nueva de la fuente sin tocar Supabase.

### En desarrollo, desde tu máquina

Se conecta al proyecto de desarrollo (`xaitolsnmjlpyptntfwi`). La conexión directa (`db.<ref>.supabase.co`) solo funciona por IPv6; si tu red no tiene IPv6, usa el **pooler en modo sesión**, que funciona por IPv4. Las dos URL se copian del panel de Supabase del proyecto de desarrollo, botón **Connect**:

- Conexión directa: `postgresql://postgres:<contraseña>@db.xaitolsnmjlpyptntfwi.supabase.co:5432/postgres`.
- Pooler en modo sesión («Session pooler»): `postgresql://postgres.xaitolsnmjlpyptntfwi:<contraseña>@aws-<n>-<región>.pooler.supabase.com:5432/postgres`. Copia el host tal cual: el número del principio es el del clúster y no se deduce de la región.

La contraseña es la de la base de desarrollo, la misma que `SUPABASE_DB_PASSWORD` de tu `supabase/.env` (se puede restablecer en Project Settings > Database). Si lleva caracteres especiales (`@`, `:`, `/`, `#`, `?`, `%`, espacio), hay que codificarlos en la URL (`@` es `%40`, por ejemplo).

La URL no se escribe en ningún archivo versionado ni en una orden que quede en el historial del shell. Pégala en una lectura oculta, en la misma terminal donde vas a cargar:

```sh
read -rs ORKI_CATALOG_DB_URL && export ORKI_CATALOG_DB_URL   # pega la URL y pulsa Intro; no se ve ni queda en el historial

cd scripts/catalog-import
uv run orki-catalogo cargar /tmp/col-316691.zip --ambiente dev             # simulación
# revisa el resumen y el CSV (ver «Cómo leer el reporte»)
uv run orki-catalogo cargar /tmp/col-316691.zip --ambiente dev --escribir  # carga de verdad

unset ORKI_CATALOG_DB_URL
```

`--ambiente dev` se niega a conectar si la URL no es del proyecto de desarrollo (por ejemplo, si pegaste la de producción). Las credenciales de producción no se usan nunca desde una máquina.

Los datos de ejemplo de desarrollo (`npm run db:seed:dev`) traen especies de fuente `curated` con nombres que COL también tiene: en desarrollo saldrán como `NOMBRE_DE_OTRA_FUENTE` y no se cargarán sus sinónimos. Es lo esperado.

Con la lista de híbridos pasa algo parecido: los datos de ejemplo traen híbridos curados **sin** `source_ref` (Phalaenopsis Sogo Yukidian, Cattleya Bow Bells, Dendrobium Berry Oda, Oncidium Sharry Baby, Oncidium Twinkle, Vanda Robert's Delight, Paphiopedilum Maudiae). Si la lista tiene alguno revisado, en desarrollo sale como `NOMBRE_DE_OTRA_ENTRADA` y no se carga; el detalle dice qué `source_ref` ponerle para que la lista lo adopte.

También se puede cargar desarrollo con el workflow, igual que producción (sin la confirmación), desde cualquier rama.

### En producción, con el workflow

El workflow **Importar catálogo** (`.github/workflows/importar-catalogo.yml`) solo se lanza a mano. Sus entradas:

| Entrada                | Valores                               | Qué hace                                                                                                                                                                                       |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `carga`                | `catalogo` (por defecto) o `hibridos` | `catalogo` carga la exportación de COL fijada en `fuente.json` (`orki-catalogo cargar`); `hibridos`, la lista curada `data/hibridos.csv` del commit lanzado (`orki-catalogo cargar-hibridos`). |
| `ambiente`             | `dev` (por defecto) o `prod`          | Environment de GitHub del que toma los secretos y base de destino. `prod` solo desde `main`.                                                                                                   |
| `modo`                 | `simular` (por defecto) o `escribir`  | `simular` hace toda la carga y la revierte; solo el valor exacto `escribir` añade `--escribir`.                                                                                                |
| `confirmar_produccion` | texto                                 | Solo al escribir en producción: hay que escribir el identificador del proyecto de producción (`fzundhfxnbyjbxyhkgtg`). Se pasa a `--confirmar-produccion`.                                     |

Qué hace, en orden:

1. Comprueba las entradas antes de obtener el código: producción solo desde `main`, las variables del environment presentes y, al escribir en producción, que la confirmación sea el identificador del proyecto.
2. Solo con `carga = catalogo`: descarga la exportación fijada en [`fuente.json`](fuente.json) (o la toma de la caché de Actions, con clave por versión y hash) y **verifica su SHA-256**. Si no coincide, falla sin conectarse a nada. Con `carga = hibridos` no descarga nada: la fuente es el CSV del propio commit, que ya pasó la validación del CI en su pull request.
3. Instala Python y las dependencias con `uv sync --locked --no-dev`.
4. Compone la URL de conexión con los secretos del environment, la enmascara en el registro y ejecuta `orki-catalogo cargar` (o `orki-catalogo cargar-hibridos data/hibridos.csv`, que vuelve a validar el CSV y, con errores, termina sin conectar) con `--ambiente` igual al environment.
   Al escribir, la carga deja su fila de resumen en la auditoría del catálogo con el identificador `github-actions:<id de ejecución>:<intento>` (ver [Resumen en la auditoría](#resumen-en-la-auditoría)); el id y el intento los toma de las variables `GITHUB_RUN_ID` y `GITHUB_RUN_ATTEMPT` que pone el ejecutor.
5. Escribe un resumen en la página de la ejecución (el resumen de la CLI, con los recuentos, los conflictos y el tamaño de la base, y una tabla de filas del reporte por entidad y resultado) y sube el reporte CSV y la salida de la CLI como artefacto `reporte-carga-<carga>-<ambiente>-<modo>-<id de ejecución>`, con 30 días de retención. Las dos cosas se hacen también cuando la carga falla.

Las dos cargas comparten el grupo de concurrencia del ambiente: nunca corren dos a la vez contra el mismo ambiente, sean del catálogo o de los híbridos (la segunda espera), y la ejecución se corta a los 30 minutos. La carga completa tarda unos segundos; casi todo el tiempo es la descarga. Se eligió una entrada más en este workflow, en vez de uno propio para los híbridos, para que las protecciones (comprobación de entradas, confirmación de producción, credenciales enmascaradas, rama `main`) estén escritas una sola vez.

Para la lista de híbridos, los mismos pasos de abajo con `-f carga=hibridos` (por ejemplo `gh workflow run importar-catalogo.yml -R rcronald/orki-app --ref main -f carga=hibridos -f ambiente=prod -f modo=simular`). Carga primero el catálogo de COL: así los conflictos con especies de COL salen en el reporte de los híbridos.

**Pasos para producción:**

1. Comprueba que las migraciones están aplicadas en producción (ver arriba).
2. **Simula.** En GitHub: Actions > Importar catálogo > Run workflow, rama `main`, ambiente `prod`, modo `simular`, confirmación vacía. O con la CLI de GitHub:

   ```sh
   gh workflow run importar-catalogo.yml -R rcronald/orki-app --ref main -f ambiente=prod -f modo=simular
   gh run watch -R rcronald/orki-app                  # elige la ejecución y espera a que termine
   gh run download <id> -R rcronald/orki-app          # descarga el reporte a la carpeta actual
   ```

   La simulación bloquea la escritura del catálogo de producción unos segundos (la lectura y la búsqueda siguen funcionando).

3. **Revisa** el resumen de la ejecución y el CSV (ver [Cómo leer el reporte](#cómo-leer-el-reporte)). No sigas si hay rechazos o conflictos que no entiendas.
4. **Escribe**, con la misma versión de la fuente y la confirmación:

   ```sh
   gh workflow run importar-catalogo.yml -R rcronald/orki-app --ref main -f ambiente=prod -f modo=escribir -f confirmar_produccion=fzundhfxnbyjbxyhkgtg
   ```

   En la interfaz: modo `escribir` y el identificador en `confirmar_produccion`.

5. Comprueba que el reporte de la escritura dice lo mismo que el de la simulación (salvo que algo cambiara entre medias) y anota en el issue el tamaño de la base y los recuentos.

La confirmación no es un secreto (el identificador está en el código); sirve para que escribir en producción no pueda ser un clic por descuido.

#### Credenciales que usa el workflow

Del environment elegido (`dev` o `prod`), en Settings > Environments:

| Nombre                 | Tipo     | Para qué                                                                  | Estado                         |
| ---------------------- | -------- | ------------------------------------------------------------------------- | ------------------------------ |
| `SUPABASE_DB_PASSWORD` | Secreto  | Contraseña de la base (la misma que usa el workflow de migraciones)       | Ya existe en `dev` y en `prod` |
| `SUPABASE_PROJECT_REF` | Variable | Identificador del proyecto: forma el usuario del pooler, `postgres.<ref>` | Ya existe en `dev` y en `prod` |
| `SUPABASE_POOLER_HOST` | Variable | Host del pooler del proyecto, `aws-<n>-<región>.pooler.supabase.com`      | **Hay que crearla** en los dos |

No usa `SUPABASE_ACCESS_TOKEN` (el token de la API de gestión): la carga solo necesita la base.

**Por qué el pooler.** Los ejecutores de GitHub Actions no tienen IPv6 de salida, y la conexión directa de Supabase (`db.<ref>.supabase.co`) solo funciona por IPv6 en los planes sin el complemento de IPv4. El workflow de migraciones lo resuelve con `supabase link`, que pide la dirección del pooler a la API de gestión. Aquí se usa directamente el **pooler en modo sesión** (Supavisor, puerto 5432, usuario `postgres.<ref>`), que funciona por IPv4 y mantiene una conexión propia durante toda la sesión, como la directa. El host no es un secreto, pero no se puede deducir solo de la región (lleva el número del clúster), por eso es una variable.

**Crear `SUPABASE_POOLER_HOST`** (una vez por environment). El host sale del panel de Supabase de cada proyecto: Connect > Session pooler, la parte entre `@` y `:5432` (por ejemplo `aws-0-us-east-1.pooler.supabase.com`; copia el tuyo). Después:

```sh
gh variable set SUPABASE_POOLER_HOST --env dev  -R rcronald/orki-app --body 'aws-<n>-<región>.pooler.supabase.com'
gh variable set SUPABASE_POOLER_HOST --env prod -R rcronald/orki-app --body 'aws-<n>-<región>.pooler.supabase.com'
```

Si los dos proyectos están en la misma región, el host suele ser el mismo; compruébalo en cada uno. Si falta o no tiene ese formato, el workflow falla en el primer paso y lo dice.

**Que no salgan credenciales en el registro.** La contraseña llega solo como variable de entorno del paso que carga; GitHub la enmascara, y el paso enmascara además su versión codificada para URL y la URL completa. La URL se compone en ese mismo paso, no se guarda en ningún archivo ni en `GITHUB_ENV`, y se borra la contraseña del entorno antes de lanzar la CLI. Ningún paso usa `set -x`. La CLI no imprime la URL y quita la contraseña de los errores de la base. Las entradas del formulario llegan a los scripts solo por variables de entorno, nunca escritas dentro del código del paso, así que no se pueden inyectar órdenes.

**Repositorio público.** Los registros, el resumen y los artefactos de las ejecuciones los puede ver cualquiera que pueda ver el repositorio. Solo contienen datos públicos (nombres del catálogo, claves de COL, el identificador del proyecto y el host del pooler) y los recuentos y tamaños de la base.

### Cómo leer el reporte

Empieza por el resumen (en la terminal o en la página de la ejecución): dice el modo, los recuentos por entidad y resultado, los registros de la base al terminar, el tamaño y los tiempos. Después abre el CSV con una hoja de cálculo y filtra por `resultado`:

- `nuevo`, `actualizado` y `sin_cambios`: lo que la carga hace (o haría). En `actualizado`, `detalle` dice qué cambia y a cuántas plantas de usuarios se propaga; revisa los cambios de género o de tipo que afecten a plantas.
- `descartado` y `ajustado`: decisiones de la normalización, con los códigos de [Códigos de motivo](#códigos-de-motivo). Sus totales deberían parecerse a los de esa tabla para la misma versión; una diferencia grande indica que la fuente cambió.
- `no_en_fuente`: está en la base pero esta fuente ya no lo trae. No se borra nunca.
- `conflicto` y `rechazado`: no se cargaron; hay que mirarlos uno a uno.
- `entidad = carga` (`resultado = info`): fuente, ambiente, destino sin credenciales, modo, identificador de la carga en la auditoría (`AUDITORIA`), totales (`TOTAL`), recuentos de la base (`RECUENTO`), tamaños en bytes (`TAMANO`) y tiempos (`TIEMPO`).

Qué hacer con cada código de conflicto, rechazo o baja:

| Código                        | Resultado          | Qué hacer                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ESPECIE_PROTEGIDA`           | conflicto          | Un administrador la validó u observó y la fuente dice otra cosa. Decide si el cambio de la fuente es correcto; si lo es, edítala a mano en el backoffice. La carga no la tocará nunca.                                                            |
| `NOMBRE_DE_OTRA_FUENTE`       | conflicto          | Ya hay una especie con ese nombre de la lista curada, de una propuesta o de `gbif`. Si es la misma especie, no hace falta nada (la de la base manda); si conviene, un administrador puede pasarla a `col` con su clave para que reciba sinónimos. |
| `CLAVE_DISTINTA`              | conflicto          | La base tiene ese nombre con otra clave de COL que la fuente sigue usando para otro registro. Busca las dos claves en COL (`https://www.catalogueoflife.org/data/taxon/<clave>`) y corrige a mano la que esté mal.                                |
| `NOMBRE_OCUPADO`              | conflicto          | La fuente renombra la especie a un nombre que ya tiene otra. Suele ser un sinónimo que pasó a aceptado: candidato a fusionar especies (#21).                                                                                                      |
| `GENERO_MAYUSCULAS_DISTINTAS` | conflicto          | El género de la base solo difiere en mayúsculas. Corrige el nombre a mano si el de la fuente es el bueno.                                                                                                                                         |
| `GENERO_AMBIGUO`              | conflicto          | Hay varios géneros que solo se distinguen por el «×». Deja uno (fusionando a mano) y vuelve a cargar.                                                                                                                                             |
| `GENERO_EN_CONFLICTO`         | rechazado          | La especie no se carga porque su género está en conflicto. Se resuelve con el conflicto del género.                                                                                                                                               |
| `SINONIMO_SIN_ESPECIE`        | rechazado          | Su especie no se cargó (por uno de los conflictos de arriba). Se resuelve con el de la especie.                                                                                                                                                   |
| `SINONIMO_ES_NOMBRE_COMUN`    | conflicto          | La especie ya tiene ese nombre como nombre común. Normalmente es un nombre común mal clasificado: corrígelo a mano si procede.                                                                                                                    |
| `SINONIMO_IGUAL_AL_NOMBRE`    | conflicto          | El sinónimo coincide con el nombre de la especie en la base. Nada que hacer.                                                                                                                                                                      |
| `ESPECIE_FUSIONADA`           | omitido_por_fusion | Un administrador fusionó esa clave en otra especie: no hay que hacer nada. Si el detalle dice que hay además una especie con esa clave (recreada antes de la memoria de las fusiones), fusiónala otra vez en la conservada.                       |
| `NOMBRE_FUSIONADO`            | conflicto          | La fuente trae con otra clave el nombre de una especie absorbida (COL le cambió la clave). Si es la misma especie, nada que hacer; si no, revísalo a mano.                                                                                        |
| `ESPECIE_NO_EN_FUENTE`        | no_en_fuente       | La fuente ya no trae esa clave (sinónimo nuevo, clave cambiada o baja). Se conserva; revisa en COL qué pasó y si hay plantas enlazadas.                                                                                                           |
| `GENERO_NO_EN_FUENTE`         | no_en_fuente       | Género de la base que COL no trae (con COL26.10 XR, Rhyncholaeliocattleya, Odontoglossum y Sophronitis). Nada que hacer.                                                                                                                          |

`CLAVE_ACTUALIZADA` (resultado `actualizado`) no es un conflicto: COL cambió la clave de una especie importada sin tocar el nombre y la carga la sigue. Conviene revisar si son muchas.

El reporte de la lista de híbridos tiene las mismas columnas y entidades (más `nombre_comun`, y `omitido` para las filas sin revisar); sus códigos están en [Carga](#carga) de la lista curada. Allí, `GENERO_NUEVO` y `NOMBRE_DE_OTRA_FUENTE` son los que hay que mirar antes de escribir.

Si la carga falla (error de la base, esquema incompleto, conexión), la transacción se revierte entera y no se ha escrito nada: corrige la causa y vuelve a lanzarla.

### Nueva versión de la fuente

La versión está fijada en [`fuente.json`](fuente.json): `alias`, `clave` de ChecklistBank, `doi`, `publicada`, `licencia` y `licencia_url`, `url` y `sha256` del zip. El workflow descarga esa URL y se niega a cargar si el SHA-256 no coincide. La pantalla del backoffice (`/administracion/catalogo`) lee de este mismo archivo, al compilar, la versión, el DOI y la licencia de la atribución, así que no hay que cambiarlos en ningún otro sitio. Para pasar a una versión nueva de COL XR:

1. Busca la versión en ChecklistBank (`https://api.checklistbank.org/dataset?releasedFrom=3&origin=xrelease`) y anota su clave, alias, DOI y fecha.
2. Descárgala fuera del repositorio, calcula su SHA-256 (`shasum -a 256`) y ejecuta `uv run orki-catalogo <zip>`: el resumen dice la clave y el alias que trae `metadata.yaml`, que tienen que coincidir. Compara los recuentos con los de [Resultado con COL26.10 XR frente a FUENTE.md](#resultado-con-col2610-xr-frente-a-fuentemd).
3. Cambia `fuente.json` (todos los campos) y actualiza FUENTE.md y las cifras de este README en el mismo pull request.
4. Simula en local o en desarrollo y revisa sobre todo las **bajas** (`no_en_fuente`) y las **claves cambiadas** (`CLAVE_ACTUALIZADA`, `CLAVE_DISTINTA`): COL cambió claves por error en 2026 (FUENTE.md, sección 6). Si hay muchas, mira los informes `deleted.tsv` y `superseded.tsv` de la versión antes de seguir.
5. Carga en desarrollo, y después en producción con el workflow (simular, revisar, escribir).

**Si ChecklistBank regenera el archivo** de la misma versión, el zip puede cambiar de bytes (otra fecha de generación) aunque los datos sean los mismos, y el workflow fallará con «El SHA-256 de la exportación … no coincide». No cambies el hash a ciegas: descarga el archivo nuevo, comprueba que `metadata.yaml` sigue diciendo la misma clave y versión y que el resumen de la CLI da los mismos recuentos, y solo entonces actualiza `sha256` en `fuente.json` (y la nota de la sección 8 de FUENTE.md) en un pull request. Las versiones mensuales se conservan un año en ChecklistBank; si la fijada desaparece, hay que pasar a una nueva.

### Atribución y licencia

Los datos del Catalogue of Life tienen licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Hay que citar la versión importada con su DOI (hoy «Catalogue of Life (2026-10-16 XR), https://doi.org/10.48580/dgzlf»), indicar la licencia y decir que los datos están filtrados a Orchidaceae y normalizados por Orki; conviene citar también la WCVP de Kew, que aporta casi todas las especies aceptadas. Las citas completas están en [FUENTE.md, sección 2](FUENTE.md#2-licencia-y-atribución). El reporte de cada carga anota la fuente, la versión y el DOI. Al cambiar de versión, actualiza también la cita donde se muestre en la app (pendiente: página pública de créditos y fuentes, issue #72).
