# Supabase

Esta carpeta contiene lo que la CLI de Supabase necesita para gestionar la base de datos de Orki:

- `config.toml`: configuración mínima de la CLI. Orki no usa el entorno local de Supabase con Docker, así que aquí no se configuran servicios locales; la configuración de autenticación, almacenamiento y demás servicios vive en cada proyecto remoto.
- `migrations/`: las migraciones SQL, en orden. Cada archivo se aplica una sola vez en cada ambiente y la CLI registra cuáles ya se aplicaron.
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
