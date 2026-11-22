# Datos sin dueño

Script de mantenimiento que detecta los datos de usuarios que ya no existen en Clerk (#112, parte de #26). La app borra fotos, plantas y perfil antes de eliminar la cuenta de Clerk, pero pueden quedar restos si la cuenta se elimina desde el panel de Clerk o si la eliminación falla a mitad.

Está en Node, como `scripts/fotos-huerfanas.mjs`, porque borrar fotos exige la API de Storage (Supabase no deja borrar objetos con SQL) y así reutiliza `@supabase/supabase-js` y las mismas credenciales y protecciones de ese script.

## Uso

Desde la raíz del repositorio:

```sh
# Solo lista (modo de prueba, el de por defecto)
npm run datos:sin-dueno -- --ambiente desarrollo

# Borra lo listado en desarrollo
npm run datos:sin-dueno -- --ambiente desarrollo --borrar

# Producción: lista
npm run datos:sin-dueno -- --ambiente produccion

# Producción: borra (exige escribir el identificador del proyecto de producción)
npm run datos:sin-dueno -- --ambiente produccion --borrar --confirmar-produccion fzundhfxnbyjbxyhkgtg
```

| Opción                       | Qué hace                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ambiente <a>`             | Obligatoria: `desarrollo` o `produccion`.                                                                                                          |
| `--borrar`                   | Borra lo detectado. Sin ella no se borra nada.                                                                                                     |
| `--confirmar-produccion <r>` | Obligatoria para borrar en producción: el ref del proyecto de producción, como en la importación del catálogo. Solo vale con `produccion`.         |
| `--permitir-proporcion-alta` | Permite borrar aunque más del 25 % de los usuarios consultados estén sin dueño (ver [Tope de seguridad](#tope-de-seguridad)). Solo con `--borrar`. |

Ejemplo de salida en modo de prueba:

```text
Proyecto de desarrollo (xaitolsnmjlpyptntfwi) e instancia de desarrollo de Clerk. Modo de prueba: no se borra nada.
Usuarios en Supabase: 11. Consultados en Clerk: 10 (la instancia tiene 8). Existen: 8. Sin dueño: 2.
  user_solofotos: sin perfil, 0 plantas, 0 eventos, 1 fotos
  user_viejo: perfil, 2 plantas, 1 eventos, 3 fotos
Ids con formato desconocido (no se consultan ni se borran): 1.
  "raro con espacios": perfil, 1 plantas, 0 eventos
Modo de prueba: no se ha borrado nada (usa --borrar para borrar).
```

## Qué hace

1. **Protección de ambiente**, antes de conectarse a nada: `SUPABASE_PROJECT_REF` tiene que ser el ref del ambiente indicado (los de `scripts/supabase-db.mjs`) y `CLERK_SECRET_KEY` una clave de la instancia de Clerk de ese ambiente (`sk_test_` en desarrollo, `sk_live_` en producción). Si no coincide, no se ejecuta nada.
2. **Reúne los usuarios** que aparecen en `profiles.id`, `plants.user_id`, `product_events.user_id` y en las carpetas del primer nivel del bucket `plant-photos` (`<usuario>/<planta>/...`). Las tablas se leen de 1 000 en 1 000.
3. **Comprueba la clave de Clerk** pidiendo el total de usuarios (`GET /v1/users/count`).
4. **Pregunta a Clerk por cada usuario**, de uno en uno y con una pausa de 120 ms (unas 8 peticiones por segundo, bajo el límite de las instancias de desarrollo): `GET /v1/users/<id>`. Los ids que no tienen el formato de Clerk (`user_` y letras o números) no se consultan ni se borran: solo se informa de ellos.
5. **Lista** los usuarios sin dueño con lo que tienen (perfil, plantas, eventos y fotos, recorriendo su carpeta del bucket).
6. **Solo con `--borrar`**, y si pasa el tope de seguridad, borra usuario por usuario en el orden de la app: fotos (en lotes de 100), plantas, eventos de producto y, al final, el perfil. Borra solo las filas y los archivos detectados: cada borrado de filas filtra por los ids listados y además por el usuario, y las fotos tienen que estar dentro de la carpeta del usuario. Si algo falla se detiene y lo dice; lo ya borrado no se vuelve a detectar, así que basta con volver a ejecutarlo.

### Cuándo un usuario no existe

Un usuario solo cuenta como sin dueño si Clerk responde **404 con el código `resource_not_found`** a `GET /v1/users/<id>`. Cualquier otra respuesta detiene el script antes de borrar nada y sin dar a nadie por inexistente: límite de peticiones (429, con el tiempo de espera si Clerk lo da), clave rechazada (401 o 403), error del servidor, red caída o sin respuesta en 15 segundos, un 404 sin ese código (por ejemplo, de un proxy), un cuerpo que no es JSON o un 200 que no trae el usuario pedido. Como el borrado empieza solo cuando todos los usuarios tienen respuesta, un error a mitad no borra nada aunque ya se hubieran visto usuarios inexistentes.

Un usuario bloqueado o baneado en Clerk existe: sus datos no se tocan.

### Tope de seguridad

Si más del 25 % de los usuarios consultados estarían sin dueño, `--borrar` se niega y no borra nada, salvo con `--permitir-proporcion-alta`. Una proporción así suele indicar una clave de otra instancia de Clerk (con la instancia equivocada, todos los usuarios parecerían inexistentes) más que bajas reales. En desarrollo, con pocos usuarios de prueba, puede hacer falta la opción: revisa antes la lista del modo de prueba.

### Eventos de producto

Además de perfiles, plantas y fotos, el script detecta y borra `product_events` del usuario. Al borrar un perfil la base ya borra sus eventos (disparador `delete_product_events`), pero puede haber eventos sin perfil, y son datos del usuario. `service_role` puede leerlos y borrarlos.

## Credenciales

| Variable               | Qué es                                                                                                                                               | Dónde se obtiene                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `SUPABASE_PROJECT_REF` | Ref del proyecto de Supabase del ambiente.                                                                                                           | Project Settings > General (Project ID).                             |
| `SUPABASE_SECRET_KEY`  | Clave secreta del proyecto (`sb_secret_...`, o la `service_role` heredada). Hace falta para ver los datos de todos los usuarios y borrar en Storage. | Project Settings > API Keys.                                         |
| `CLERK_SECRET_KEY`     | Clave secreta de la instancia de Clerk del ambiente (`sk_test_...` en desarrollo, `sk_live_...` en producción). Solo se usa para consultar usuarios. | Panel de Clerk > Configure > API keys, en la instancia del ambiente. |

- Se leen del entorno. En desarrollo, si no están en el entorno, también de `supabase/.env` (ignorado por git; la plantilla es `supabase/.env.example`). Con `--ambiente produccion` **solo** del entorno: `supabase/.env` es del proyecto de desarrollo y las credenciales de producción no se guardan en ninguna máquina.
- Nunca se imprimen ni se registran: la clave de Clerk va solo en la cabecera `Authorization` y los mensajes de error nombran las variables, no sus valores. Una prueba lo comprueba.
- No están en GitHub ni en ningún workflow: el script se ejecuta a mano.

Para producción, defínelas solo en la terminal en la que vas a ejecutarlo, sin guardarlas en archivos ni en el historial (por ejemplo, con `read -s` o desde un gestor de contraseñas), y ciérrala al terminar.

## Riesgos

- **La clave secreta de Supabase se salta RLS**: puede leer y borrar los datos de todos los usuarios del proyecto. **La clave secreta de Clerk** da acceso completo a la instancia (puede, por ejemplo, eliminar usuarios), aunque el script solo hace lecturas con ella. Tenlas en tu máquina solo mientras ejecutas el script.
- **El borrado no se puede deshacer.** Supabase no guarda copia de los archivos de Storage borrados, y las copias de la base dependen del plan. Empieza siempre por el modo de prueba y revisa la lista antes de `--borrar`.
- **La instancia de Clerk equivocada haría parecer inexistentes a todos.** Lo cubren la comprobación del prefijo de la clave y el tope de seguridad; pero dos instancias del mismo tipo (dos `sk_live_`) no se distinguen por el prefijo. Comprueba que la clave es la de la instancia de Orki del ambiente.
- **Una eliminación en curso desde la app** puede coincidir con el script: si Clerk ya borró al usuario, el script borra lo que quede y la app, al reintentar, no encuentra nada (todos los pasos son idempotentes). Si el usuario todavía existe, el script no lo toca.
- **Límites de la API de Clerk:** con muchos usuarios el script tarda (unos 8 por segundo); si Clerk responde 429, se detiene sin borrar nada y basta con repetirlo más tarde.

## Pruebas

`datos-sin-dueno.test.mjs`, con `node:test` y sin red: Clerk es un `fetch` simulado y Supabase un doble en memoria de la parte de `supabase-js` que usa el script. Cubren que el modo de prueba no borra nada; que se niega con el proyecto o la instancia de Clerk de otro ambiente y sin `--confirmar-produccion` correcto (sin crear el cliente ni hacer peticiones); que cada tipo de error de Clerk detiene el script sin borrar; que el borrado afecta solo a lo detectado y sigue el orden de la app; el tope de seguridad; y que las credenciales no aparecen en la salida.

```sh
npm run test:scripts
```

Las ejecuta el job "Lint, formato, typecheck, pruebas y build" del CI. La lógica está en `datos-sin-dueno.mjs`; `index.mjs` solo conecta las dependencias reales.

**Sin comprobar contra servicios reales:** el script no se ha ejecutado contra Clerk ni Supabase. En particular, que Clerk responda exactamente 404 con `resource_not_found` para un usuario eliminado (es lo documentado en su API de backend) y el límite de peticiones de cada instancia. Antes del primer `--borrar` en producción, conviene ejecutarlo en desarrollo con un usuario de prueba eliminado desde el panel de Clerk.
