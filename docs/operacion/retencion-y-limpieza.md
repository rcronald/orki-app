# Retención y limpieza de datos

Cuánto se conserva cada dato del servidor, qué tareas periódicas lo garantizan y qué hay que configurar para que funcionen (#293, parte de #277).

## Plazos de conservación

| Dato                                                       | Plazo                                                                  | Quién lo cumple                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Perfil, plantas, notas, bitácora y fotos (Supabase)        | Mientras exista la cuenta.                                             | La eliminación de cuenta desde la app; lo que quede, el [informe semanal](#informe-semanal-de-datos-sin-dueño) y el borrado a mano. |
| Eventos de uso (`product_events`)                          | 13 meses desde que ocurren (`occurred_at`), o hasta borrar la cuenta.  | [Retención de eventos](#retención-de-eventos), cada día, y el disparador de `profiles` al borrar el perfil.                         |
| Informes de errores y avisos de sesión (Sentry)            | 30 o 90 días según el plan de Sentry; no se borran al borrar la cuenta. | Sentry ([abajo](#sentry)).                                                                                                          |
| Cuenta de acceso, correo y sesión (Clerk)                  | Hasta borrar la cuenta.                                                | Clerk.                                                                                                                             |
| Registro de cambios del catálogo (`catalog_audit_log`)     | Sin plazo. No lleva de quién era un nombre.                            | —                                                                                                                                  |

La privacidad (`apps/web/src/privacy/PrivacyPage.tsx`) dice que los eventos de uso se borran a los 13 meses. Ese plazo solo se cumple si el workflow «Retención de eventos» corre: si falla, falla en rojo, y hay que arreglarlo.

## Tareas periódicas

| Tarea                                 | Frecuencia                                   | Qué hace                                                              | Borra |
| ------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- | ----- |
| Retención de eventos (workflow)       | Cada día, 04:17 UTC, en producción           | Borra los eventos de producto de más de 13 meses.                     | Sí    |
| Informe de datos sin dueño (workflow) | Cada lunes, 07:23 UTC, en producción         | Cuenta fotos huérfanas y datos de usuarios que ya no existen en Clerk. | No    |
| Revisión del informe (a mano)         | El primer lunes de cada mes, o con un aviso  | Lee el resumen; si hay algo, lista y borra a mano con los scripts.    | A mano |

Los dos workflows se pueden lanzar también a mano (Actions > el workflow > Run workflow), en `dev` o en `prod`; producción solo desde `main`.

GitHub no avisa de una ejecución programada que termina bien. El informe deja un aviso (warning) en la ejecución cuando hay algo que revisar, pero alguien tiene que mirarlo: por eso la revisión mensual. Una ejecución que falla sí avisa por correo a quien modificó por última vez el `schedule` del workflow. En un repositorio público, GitHub desactiva los workflows programados tras 60 días sin actividad en el repositorio; si pasa, hay que volver a activarlos en la pestaña Actions.

### Retención de eventos

`.github/workflows/retencion-de-eventos.yml` ejecuta `npm run eventos:retencion -- --ambiente produccion` (`scripts/retencion-de-eventos/`), que llama a `public.purge_expired_product_events()` con la clave secreta del proyecto. El plazo está en esa función (migración `20261125120000_retencion_de_eventos.sql`), no en el workflow: quien la llama solo decide cuándo. La prueban `supabase/tests/retencion_de_eventos.sql` (un evento de 14 meses se borra y uno de 12 no, de las dos cuentas; `anon` y `authenticated` no la ejecutan) y `scripts/retencion-de-eventos/retencion-de-eventos.test.mjs`.

El resumen de la ejecución dice cuántos eventos borró. Si falta el secreto, el proyecto no es el del ambiente o la migración no está aplicada, falla con un error que lo dice.

**Alternativa sin GitHub:** `pg_cron` en Supabase. Ninguna migración lo activa y no se ha probado aquí (el Postgres de las pruebas no lo trae). Si se prefiere, se activa en el panel (Integrations > Cron), se programa desde el editor SQL `select cron.schedule('retencion-de-eventos', '17 4 * * *', 'select public.purge_expired_product_events()');` y se desactiva el workflow. La función es la misma.

### Informe semanal de datos sin dueño

`.github/workflows/informe-datos-sin-dueno.yml` ejecuta, sin `--borrar`:

- `npm run fotos:huerfanas -- --ambiente produccion --solo-recuentos`: archivos del bucket que no cita ninguna planta, foto ni registro de la bitácora, y filas que apuntan a un archivo que no existe ([Limpieza de fotos huérfanas](../../supabase/README.md#limpieza-de-fotos-huérfanas)).
- `npm run datos:sin-dueno -- --ambiente produccion --solo-recuentos`: perfiles, plantas, fotos, bitácora, eventos y archivos de usuarios que Clerk dice que no existen ([su README](../../scripts/datos-sin-dueno/README.md)).

El repositorio es público, y con él el registro y el resumen de cada ejecución. Por eso los scripts van con `--solo-recuentos` (solo totales, sin ids de Clerk ni rutas de fotos) y la salida pasa además por un filtro que tapa cualquier `user_...`. Por la misma razón el informe no abre issues: un issue público tampoco puede llevar esos datos, y uno semanal con solo totales sería ruido. Basta el resumen de la ejecución y el aviso cuando hay algo.

**Cuando hay algo:** en tu máquina, con las credenciales de producción solo en esa terminal (ver los README de cada script), ejecuta el script sin `--solo-recuentos` para ver la lista, revísala y, si es correcta, repite con `--borrar` y la confirmación de producción. Un usuario sin dueño suele ser una cuenta borrada desde el panel de Clerk; ver [Webhook `user.deleted` de Clerk](webhook-de-clerk.md).

### Qué hay que configurar

En GitHub, Settings > Environments > `prod` (y lo mismo en `dev` para lanzarlos a mano allí):

1. Comprobar que existen la variable `SUPABASE_PROJECT_REF` y el secreto `SUPABASE_SECRET_KEY` (la clave secreta del proyecto, `sb_secret_...`, de Project Settings > API Keys). Son los de «Fotos de referencia»; si ese workflow ya escribió en producción, están. Si falta la clave, «Retención de eventos» falla cada día y el informe avisa y no hace nada.
2. Crear el secreto `CLERK_SECRET_KEY` con la clave secreta de la instancia de producción de Clerk (`sk_live_...`, panel de Clerk > Configure > API keys), sin que quede en el historial:

   ```sh
   gh secret set CLERK_SECRET_KEY --env prod --repo rcronald/orki-app
   ```

   Pega la clave cuando la pida. En `dev`, la de la instancia de desarrollo (`sk_test_...`). Sin él, el informe hace solo la parte de fotos huérfanas y lo avisa. El script solo hace lecturas con ella, pero la clave da acceso completo a la instancia de Clerk.

3. Revisar las reglas del environment `prod`. Si tiene revisores obligatorios (Required reviewers), cada ejecución programada espera a que alguien la apruebe: la retención, cada día. Lo razonable es aprobar cada ejecución o quitar los revisores de `prod` asumiendo que sus secretos solo los usan workflows de `main`; en ese caso conviene limitar el environment a la rama `main` (Deployment branches). Hoy las migraciones ya usan `prod` en cada push a `main`.
4. Después de fusionar, lanzar los dos workflows a mano en `prod` una vez (Actions > Run workflow, desde `main`) y comprobar el resumen.

Nada de esto se ha ejecutado contra los servicios reales: ni los workflows ni los scripts.

## Sentry

Sentry recibe los informes de errores y un aviso por cada sesión, con el id de Clerk del usuario ([Errores en Sentry](errores-en-sentry.md)). Al eliminar la cuenta no se borran: la privacidad lo dice («No se borran los informes de errores que ya se enviaron a Sentry»).

Según la documentación pública de Sentry, [Data Retention Periods](https://docs.sentry.io/security-legal-pii/security/data-retention-periods/) (consultada el 24 de noviembre de 2026):

- Los errores se conservan **30 días en el plan Developer** y **90 días en Team y Business/Enterprise**.
- «Retention periods are set at the time data is ingested, based on the then-current plan»: el plazo es el del plan en el momento en que llegó el informe; cambiar de plan solo afecta a lo que llegue después.
- «When data reaches the end of its retention period, it can no longer be accessed.»

Esa página no habla de las sesiones (release health) ni del borrado de los datos de un usuario concreto. Así que un informe con el id de una cuenta borrada sigue en Sentry hasta 30 o 90 días después de llegar, según el plan del proyecto (se ve en Settings > Subscription). No se ha cambiado ninguna configuración de Sentry. Si alguien pide que se borren antes, se pueden borrar a mano los issues que lleven su id desde Sentry.
