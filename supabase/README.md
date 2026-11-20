# Supabase

Esta carpeta contiene lo que la CLI de Supabase necesita para gestionar la base de datos de Orki:

- `config.toml`: configuración mínima de la CLI. Orki no usa el entorno local de Supabase con Docker, así que aquí no se configuran servicios locales; la configuración de autenticación, almacenamiento y demás servicios vive en cada proyecto remoto.
- `migrations/`: las migraciones SQL, en orden. Cada archivo se aplica una sola vez en cada ambiente y la CLI registra cuáles ya se aplicaron.
- `tests/`: las pruebas de base de datos, en SQL, que ejecuta `npm run db:test` (ver [Pruebas de base de datos](#pruebas-de-base-de-datos)).
- `.env.example`: plantilla de las credenciales del proyecto de desarrollo. Se copia a `supabase/.env`, que git ignora.

Hay dos ambientes, cada uno con su proyecto de Supabase: desarrollo y producción. Las migraciones se crean y se prueban en desarrollo desde tu máquina, y llegan a producción a través de un workflow de GitHub Actions al fusionar en `main`.

El flujo completo (crear una migración, aplicarla en desarrollo, qué pasa en producción y qué credenciales hacen falta) está documentado en la sección [Base de datos y migraciones](../README.md#base-de-datos-y-migraciones) del README principal.

## Esquema

Las tablas viven en el esquema `public` y sus identificadores están en inglés:

- Catálogo, de lectura pública (también sin sesión): `genera` (géneros, con la marca de acceso rápido), `genus_abbreviations` (abreviaturas de género, como Phal.), `species` (especies e híbridos, con su estado, su fuente y la referencia externa de la fuente) y `species_names` (sinónimos y nombres comunes). La migración del catálogo carga los cinco géneros de acceso rápido y sus abreviaturas estándar de la RHS.
- Inventario: `profiles` (perfil de cada usuario de Clerk) y `plants` (ejemplares). El usuario es el id de Clerk, de tipo texto, y por defecto se toma del claim `sub` del token de sesión. Tienen Row Level Security activada y todavía no tienen políticas, así que no se pueden leer ni escribir desde la API.
- Disparadores, con sus funciones en el esquema `private` (no expuesto en la API): al enlazar una planta a una especie, la planta toma el género y el tipo de la especie y queda validada; al desenlazarla vuelve a "por validar"; si cambian el género o el tipo de una especie, se propagan a sus plantas; y `updated_at` se actualiza solo en todas las tablas.

Todas las tablas tienen Row Level Security activada y privilegios explícitos: `anon` y `authenticated` solo pueden leer el catálogo, y `service_role` puede leer y escribir todo.

## Reglas para las migraciones

- Una migración ya fusionada en `main` no se edita ni se borra: se aplicó en producción. Para corregirla, crea una migración nueva.
- Escribe migraciones que se puedan aplicar sin intervención manual y, cuando sea razonable, idempotentes (`if not exists`, `create or replace`).
- Las extensiones se instalan en el esquema `extensions`, no en `public`, siguiendo la convención de Supabase.
- No pongas datos personales ni secretos en las migraciones.
- Cada migración llega con sus pruebas en `tests/`, y `npm run db:test` debe pasar antes de abrir el pull request.
- Cada migración llega también con los tipos de TypeScript regenerados: ejecuta `npm run db:types` e incluye `apps/web/src/lib/database.types.ts` en el mismo commit. El CI falla si no coinciden (ver [Tipos de TypeScript](#tipos-de-typescript)).

## Pruebas de base de datos

`npm run db:test` aplica todas las migraciones en una base Postgres desechable, con lo mínimo de Supabase simulado, y ejecuta las pruebas de esta carpeta. Cómo se ejecuta (en local y en el CI), qué simula de Supabase y qué no cubre está en la sección [Pruebas de la base de datos](../README.md#pruebas-de-la-base-de-datos) del README principal.

Las pruebas están organizadas por tema, un archivo por tema:

| Archivo                  | Qué comprueba                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `esquema.sql`            | Que las migraciones dejan las tablas, enumerados, extensiones, disparadores y funciones esperados, con su dueño.       |
| `datos_referencia.sql`   | Los cinco géneros de acceso rápido con su abreviatura, y que las migraciones no cargan perfiles ni plantas.            |
| `catalogo_unicidad.sql`  | Unicidad sin distinguir mayúsculas y nombres sin espacios sobrantes en géneros, abreviaturas, especies y nombres.      |
| `borrados.sql`           | Borrados en cascada (abreviaturas, nombres alternativos) y restringidos (géneros y especies en uso).                   |
| `plantas_y_perfiles.sql` | Restricciones de `plants` y `profiles`: validación y especie, textos, fecha, enumerados, idioma y valores por defecto. |
| `sincronizacion.sql`     | Sincronización de género y tipo al enlazar, desenlazar y cambiar la especie, y `updated_at` y `created_at`.            |
| `acceso_por_rol.sql`     | Qué pueden leer y escribir `anon`, `authenticated` y `service_role`, y el usuario por defecto tomado del token.        |
| `seguridad_general.sql`  | Reglas que valen para cualquier tabla o función futura: RLS en todo `public`, `anon` solo lee, funciones protegidas.   |

`seguridad_general.sql` no nombra tablas concretas: recorre el catálogo de Postgres, así que falla sola si una migración nueva crea una tabla sin Row Level Security, concede escritura a `anon` o deja una función de `private` ejecutable desde la API.

### Formato de un archivo de pruebas

Cada prueba empieza con una línea `-- prueba: <qué comprueba>` y llega hasta la siguiente. Lo que haya antes de la primera prueba son los datos de partida del archivo, que se ejecutan al comienzo de cada prueba.

Cada prueba corre en su propia sesión, dentro de una transacción que se revierte al terminar, con el rol `postgres` (el dueño de las tablas). Por eso las pruebas son independientes entre sí y no dejan datos, y pueden usar `set local role anon` (o `authenticated`, `service_role`) y `set local request.jwt.claims = '{"sub": "user_a"}'` para actuar como una petición de la API. Una prueba no puede abrir, confirmar ni revertir transacciones (`begin`, `commit`, `rollback`); el comando la rechaza.

Una prueba falla en cuanto una sentencia da error. Para comprobar resultados se usan las funciones del esquema `pruebas` (`tests/soporte/ayudantes.sql`), que solo existen en la base desechable:

- `pruebas.iguales(descripcion, obtenido, esperado)`: falla mostrando los dos valores si son distintos.
- `pruebas.comprobar(descripcion, condicion)`: falla si la condición no es verdadera.
- `pruebas.debe_fallar(descripcion, sentencia, codigo, restriccion)`: ejecuta la sentencia (texto, normalmente entre `$$`) y falla si no da el error con ese código SQLSTATE (por ejemplo `23505` para un duplicado, `23514` para un `check`, `23503` para una clave foránea o `42501` para un permiso denegado). La restricción es opcional; si se indica, exige que el error venga de esa restricción o índice único.
- `pruebas.debe_funcionar(descripcion, sentencia)`: ejecuta la sentencia y falla mostrando el error si lo da.
- `pruebas.genero(nombre)` y `pruebas.especie(nombre)`: devuelven el id de un género o una especie por su nombre.

Por ejemplo:

```sql
-- prueba: géneros: no se repite un nombre con otras mayúsculas
select pruebas.debe_fallar(
  'PHALAENOPSIS ya existe como Phalaenopsis',
  $$insert into public.genera (name) values ('PHALAENOPSIS')$$,
  '23505', 'genera_name_key'
);
```

### Añadir pruebas al escribir una migración

1. Escribe la migración con `npm run db:new -- <nombre>`.
2. Añade sus pruebas al archivo del tema que corresponda, o crea uno nuevo en `tests/` (cualquier `.sql` de la carpeta se ejecuta, en orden alfabético). Prueba lo que la migración promete: cada restricción con un caso que la cumple y otro que la incumple (con el nombre de la restricción en `pruebas.debe_fallar`), cada disparador con su efecto, y el acceso por rol de cada tabla nueva.
3. Si la migración crea una tabla, añádela a la lista de `esquema.sql`. Las comprobaciones de `seguridad_general.sql` ya la cubren sin tocarlas.
4. Ejecuta `npm run db:test` (o `npm run db:test -- <tema>` mientras trabajas). Comprueba también que la prueba nueva falla si quitas de la migración lo que prueba: una prueba que nunca falla no protege nada.
5. Ejecuta `npm run db:types` para regenerar los tipos de TypeScript y versiona el archivo que cambie.

## Tipos de TypeScript

La app usa tipos generados a partir de estas migraciones (`apps/web/src/lib/database.types.ts`), con los que el cliente de Supabase comprueba al compilar tablas, columnas y enumerados. Cuándo regenerarlos:

- Después de crear o cambiar una migración (antes de hacer commit).
- Después de actualizar la CLI de Supabase o Prettier, si `npm run db:types:check` dice que no coinciden.

`npm run db:types` los genera sin Docker ni credenciales, sobre la misma base desechable que las pruebas, y solo con el esquema `public`. `npm run db:types:check` hace lo mismo sin escribir y falla si el archivo versionado es distinto; es lo que ejecuta el CI. Si la migración añade una tabla o un enumerado, añade también su alias en `apps/web/src/lib/database.ts`. El detalle está en la sección [Tipos de TypeScript del esquema](../README.md#tipos-de-typescript-del-esquema) del README principal.
