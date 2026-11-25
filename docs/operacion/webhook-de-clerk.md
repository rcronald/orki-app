# Webhook `user.deleted` de Clerk

Valoración, sin implementar (#293). Pregunta: ¿conviene que Clerk avise a orqui.app cuando se borra un usuario, para borrar sus datos en el momento?

## El hueco que cubriría

La app borra los datos del usuario antes de eliminar su cuenta de Clerk. Pero si la cuenta se borra desde el panel de Clerk o con la API de Clerk (`user.delete()`), sus datos se quedan en Supabase hasta que alguien ejecuta `npm run datos:sin-dueno -- --borrar`. Hoy eso lo detecta el [informe semanal](retencion-y-limpieza.md#informe-semanal-de-datos-sin-dueño): como mucho una semana para enterarse, y el borrado sigue siendo a mano.

## Qué haría falta

- **Endpoint público** que reciba `POST` de Clerk. orqui.app es una SPA en Vercel sin servidor propio; hoy solo tiene el middleware de cabeceras. Las opciones: una función de Vercel (`api/clerk-webhook`) o una Edge Function de Supabase. La de Supabase queda más cerca de los datos y de la clave secreta, que ya vive allí; la de Vercel obligaría a guardar la clave secreta de Supabase en Vercel.
- **Verificación de la firma.** Clerk firma cada envío (con Svix, cabeceras `svix-id`, `svix-timestamp` y `svix-signature`) con un secreto propio del endpoint (`CLERK_WEBHOOK_SIGNING_SECRET`), y su SDK trae `verifyWebhook()`. Sin firma válida o con una marca de tiempo vieja, se responde 400 y no se hace nada. El secreto es nuevo, por ambiente.
- **El borrado**, con la clave secreta de Supabase: lo mismo que `scripts/datos-sin-dueno`, en el mismo orden (archivos del bucket en `<usuario>/`, `plant_photos`, `plant_log_entries`, `plants`, `product_events`, `profiles`). Borrar archivos exige la API de Storage, no basta SQL. Tiene que ser idempotente: Clerk reintenta ante cualquier respuesta que no sea 2xx y puede entregar el mismo evento dos veces o fuera de orden.
- **Pruebas**: firma válida, inválida y vieja; usuario sin datos; repetición; fallo a mitad (Clerk reintenta).
- **Configuración**: el endpoint en el panel de Clerk (Webhooks), suscrito solo a `user.deleted`, en cada instancia.

## Riesgos

- **Un endpoint público que borra datos.** Toda la seguridad depende de verificar bien la firma; un fallo ahí deja borrar los datos de cualquiera conociendo su id. Hoy no existe ningún punto de entrada así.
- **La clave secreta de Supabase en un servicio siempre encendido**, en vez de solo en la máquina de quien limpia o en un environment de GitHub.
- **Instancia equivocada:** un endpoint de producción apuntado desde la instancia de desarrollo de Clerk borraría ids que en producción existen. Hay que comprobar, como el script, que el evento viene de la instancia del ambiente (el secreto de firma es por endpoint, lo que ya lo separa).
- **Entrega no garantizada:** la propia documentación de Clerk dice que las entregas no están garantizadas ([Sync Clerk data to your app with webhooks](https://clerk.com/docs/webhooks/sync-data): «Webhook deliveries are not guaranteed»). El informe semanal seguiría haciendo falta de red de seguridad.
- **Código y mantenimiento** nuevos para un caso raro: con pocos usuarios, las cuentas se borran desde la app, que ya lo hace bien.

## Recomendación

**No implementarlo por ahora.** El informe semanal ya detecta los datos de cuentas borradas fuera de la app, sin abrir ningún endpoint público ni dejar la clave secreta en un servicio. El retraso (hasta una semana para verlo y el borrado a mano) es aceptable con el número de usuarios actual, y la privacidad no promete un plazo para ese caso.

Conviene replantearlo si se empieza a borrar usuarios desde el panel de Clerk con frecuencia (por ejemplo, por soporte o por spam), si el informe muestra datos sin dueño a menudo o si se publica un plazo de borrado para cuentas borradas fuera de la app. En ese caso, la opción preferida es una Edge Function de Supabase con `verifyWebhook()`, que reutilice la lógica de `scripts/datos-sin-dueno` y mantenga el informe semanal.
