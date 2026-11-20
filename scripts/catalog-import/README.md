# Importación del catálogo

Scripts en Python que preparan el catálogo de especies de orquídeas de Orki a partir del **Catalogue of Life eXtended Release** (COL26.10 XR, clave de ChecklistBank `316691`). La investigación de la fuente, la licencia y el formato está en [FUENTE.md](FUENTE.md); las decisiones aprobadas, en el issue #72.

Hay dos partes: lectura, filtrado y normalización (#73), con una CLI de solo lectura, y la carga en la base de datos con su reporte (#74, `orki-catalogo cargar`, ver [Carga en la base de datos](#carga-en-la-base-de-datos)). El workflow manual y la guía por ambiente llegan en #75.

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

En el CI, el job «Importación del catálogo (Python)» de `.github/workflows/ci.yml` ejecuta esos mismos tres pasos, con un Postgres 17 desechable para las pruebas de la carga (ver [Pruebas de la carga](#pruebas-de-la-carga)).

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
| `src/catalog_import/cli.py`       | CLI `orki-catalogo` (resumen de solo lectura; `cargar` pasa a `load_cli.py`)                                   |
| `src/catalog_import/load_cli.py`  | `orki-catalogo cargar`: opciones, conexión, errores sin credenciales                                           |
| `src/catalog_import/target.py`    | Ambiente, URL de conexión y protección contra cargar en la base equivocada                                     |
| `src/catalog_import/load.py`      | Carga: lectura de la base, plan (función pura) y escritura por conjuntos en una transacción                    |
| `src/catalog_import/report.py`    | Reporte CSV y resumen por pantalla                                                                             |
| `tests/`                          | Pruebas; la muestra real y su procedencia están en `tests/data/` ([PROCEDENCIA.md](tests/data/PROCEDENCIA.md)) |
| `tests/basedatos.py`              | Bases desechables con las migraciones para las pruebas de la carga                                             |

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

Aquí solo se describe la ejecución en local. El workflow manual y la guía para desarrollo y producción son del issue #75.

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
2. Comprueba el esquema y lee lo que hay: géneros con sus abreviaturas, especies, nombres alternativos y cuántas plantas tiene cada especie.
3. Decide qué hacer con cada registro de la fuente (`plan_load`, una función pura, sin base).
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

### Reporte

Un CSV (UTF-8 con BOM, para que una hoja de cálculo lea bien las tildes y el «×») y un resumen por pantalla. Columnas: `entidad` (`carga`, `genero`, `especie` o `sinonimo`), `resultado`, `codigo`, `source_ref` (clave de COL), `nombre`, `especie` (en los sinónimos, «Nombre (clave)» de su especie), `detalle` y `id_base`.

- `resultado` es `nuevo`, `actualizado` (con lo que cambió en `detalle`), `sin_cambios` (solo con `--detalle-sin-cambios`), `conflicto`, `rechazado` o `no_en_fuente`, con su código y su motivo. Los descartes y ajustes de la normalización van también, como `descartado` y `ajustado`, con sus códigos de la tabla de arriba.
- Las filas de `entidad = carga` (`resultado = info`) dan la fuente (alias, clave, DOI, versión, fecha y archivo), el ambiente y el destino (sin credenciales), el modo, la fecha, los totales por entidad y resultado (`TOTAL`, también los sin cambios), los recuentos de la base al terminar (`RECUENTO`), los tamaños en bytes de la base y de las cuatro tablas del catálogo con sus índices (`TAMANO`) y los tiempos (`TIEMPO`).

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

`tests/test_load_db.py` prueba la carga contra una base desechable: carga de la muestra, segunda carga sin cambios (ninguna fila distinta, tampoco `updated_at`), simulación que no escribe y da el mismo reporte, fallo a mitad (un disparador que falla al insertar una especie) que no deja nada, especie validada u observada que no cambia y sale como conflicto, especie importada editada sin cambiar el estado (la limitación), nombre de la lista curada o de una propuesta, género sin «×» que pasa a llevarlo conservando su abreviatura, nothogénero sin especies que solo renombra, sinónimos y nombres comunes añadidos a mano que se conservan, sinónimo de la fuente que ya es nombre común, claves cambiadas (importada, validada y clave que la fuente sigue usando), propagación a las plantas y que no se imprime la contraseña. `tests/test_target.py` prueba la protección de ambiente y que las credenciales no salen en ningún mensaje, sin base.

Las de la base necesitan `ORKI_TEST_DB_URL`, la misma variable que `npm run db:test`: un Postgres local con un superusuario (solo se aceptan hosts de esta máquina). Con ella, `tests/basedatos.py` crea una base plantilla con lo mínimo de Supabase (`scripts/db-desechable/supabase-minimo.sql`) y todas las migraciones, cada una en su transacción y con el rol `postgres`, y cada prueba trabaja en una copia que se borra al terminar. Sin la variable, se saltan; en el CI (variable `CI`) fallan, para que no se salten sin que nadie lo vea.

```sh
ORKI_TEST_DB_URL=postgresql://supabase_admin:desechable@127.0.0.1:55417/postgres uv run pytest
```

Las pruebas siguen bloqueando la red de Python; la conexión a la base la hace libpq, y solo a un host local.

### Limitaciones

- La protección del trabajo del administrador se basa solo en el estado (ver arriba).
- Las pruebas se conectan como superusuario; en Supabase la carga se conectará como `postgres`, que es el dueño de las tablas pero no superusuario. Lo que hace la carga (bloquear, `COPY` a tablas temporales, escribir las cuatro tablas, `analyze`) no necesita más que eso, pero no se ha probado contra un proyecto de Supabase.
- Con el pooler en modo transacción (puerto 6543) la carga también debería funcionar, porque es una sola transacción y no usa sentencias preparadas, pero no se ha probado; la conexión directa o el pooler en modo sesión (puerto 5432) son la opción segura.
- Los datos de ejemplo de desarrollo (`supabase/datos-ejemplo/`) tienen especies de fuente `curated` con nombres que COL también trae (por ejemplo Phalaenopsis amabilis): en desarrollo saldrán como `NOMBRE_DE_OTRA_FUENTE` y no se cargarán sus sinónimos.
