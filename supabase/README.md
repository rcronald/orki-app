# Supabase

Esta carpeta contiene lo que la CLI de Supabase necesita para gestionar la base de datos de Orki:

- `config.toml`: configuración mínima de la CLI. Orki no usa el entorno local de Supabase con Docker, así que aquí no se configuran servicios locales; la configuración de autenticación, almacenamiento y demás servicios vive en cada proyecto remoto.
- `migrations/`: las migraciones SQL, en orden. Cada archivo se aplica una sola vez en cada ambiente y la CLI registra cuáles ya se aplicaron.
- `.env.example`: plantilla de las credenciales del proyecto de desarrollo. Se copia a `supabase/.env`, que git ignora.

Hay dos ambientes, cada uno con su proyecto de Supabase: desarrollo y producción. Las migraciones se crean y se prueban en desarrollo desde tu máquina, y llegan a producción a través de un workflow de GitHub Actions al fusionar en `main`.

El flujo completo (crear una migración, aplicarla en desarrollo, qué pasa en producción y qué credenciales hacen falta) está documentado en la sección [Base de datos y migraciones](../README.md#base-de-datos-y-migraciones) del README principal.

## Reglas para las migraciones

- Una migración ya fusionada en `main` no se edita ni se borra: se aplicó en producción. Para corregirla, crea una migración nueva.
- Escribe migraciones que se puedan aplicar sin intervención manual y, cuando sea razonable, idempotentes (`if not exists`, `create or replace`).
- Las extensiones se instalan en el esquema `extensions`, no en `public`, siguiendo la convención de Supabase.
- No pongas datos personales ni secretos en las migraciones.
