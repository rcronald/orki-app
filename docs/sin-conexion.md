# Orki sin conexión (#18)

Cómo se comporta la app sin red con una sesión iniciada: qué hace Clerk, cómo
sabe la app quién es el usuario y qué guarda en el dispositivo. Es el resultado
del #117 y la referencia de #118, #119 y #120. Lo que solo se puede comprobar
en un celular está marcado como **hipótesis** y va en el guion de prueba del
final (#121).

## 1. Qué hace Clerk sin red (#117)

Versión instalada: `@clerk/react` 6.19.2 (Core 3), que descarga `clerk-js` 6
desde la Frontend API de la instancia.

### Confirmado leyendo el código instalado o la documentación oficial

- **El script de Clerk no está en la app.** `@clerk/react` no trae `clerk-js`:
  al montarse, `ClerkProvider` lo descarga de
  `https://<frontend-api>/npm/@clerk/clerk-js@6/dist/clerk.browser.js` (y la
  interfaz, `@clerk/ui`, de la misma forma). Ver `loadClerkJSScript` en
  `node_modules/@clerk/shared/dist/loadClerkJsScript.mjs` y
  `getEntryChunks()` en `node_modules/@clerk/react/dist/ClerkProvider-*.mjs`.
  La dirección lleva la versión mayor (`@6`), no una exacta.
- **El service worker de Orki no lo guarda.** `vite.config.ts` no tiene
  `runtimeCaching`: las peticiones a otros orígenes (el script y la API de
  Clerk) van siempre a la red.
- **Si el script no llega, `status` pasa a `error`.** El cargador espera como
  mucho 15 s (`scriptLoadTimeout`, 15e3) y rechaza; `getEntryChunks()` captura
  el error y emite el estado `error`. Si el script llega pero `clerk.load()`
  falla, también `error`. `degraded` es "parcialmente operativo" (la
  documentación de `Clerk.status` no dice más) y, igual que `ready`, deja
  `loaded` en true.
- **Sin Clerk cargado, `useAuth()` no sabe nada.** `resolveAuthState`
  (`@clerk/shared/dist/authorization.mjs`) devuelve `isLoaded: false`,
  `isSignedIn: undefined` y `userId: undefined` mientras no hay sesión
  resuelta. Con el estado `error` no sale de ahí: la app nunca recibe el id
  del usuario.
- **`getToken()` sin red lanza `ClerkOfflineError`** (código
  `clerk_offline`), tras agotar sus reintentos, en lugar de devolver `null`
  (cambio de Core 3; `null` significa ahora "sin sesión"). Los tokens se
  guardan en memoria y duran 60 s: dentro de ese minuto `getToken()` responde
  sin red. Fuente: comentario de `getToken` en
  `@clerk/shared/dist/types/session.d.ts` y la guía de actualización a Core 3
  (<https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3>).
  La app ya lo traduce al motivo `offline` (`lib/supabase.ts`).
- **No hay modo sin conexión para web.** Las opciones experimentales que
  existen no lo son:
  - `experimental.persistClient` (por defecto `true`) "persiste el cliente de
    Clerk para asociar el dispositivo a un cliente"; es la cookie del
    cliente, no una copia legible sin red.
  - `experimental.rethrowOfflineNetworkErrors` solo cambia cómo se propagan
    los errores de red.
  - `resourceCache` (token guardado y devuelto sin red) es de Expo y necesita
    `expo-secure-store`; no existe en `@clerk/react`.
  - `experimental.runtimeEnvironment: 'headless'` es para React Native.

### Consecuencia

- **Abrir la app desde cero sin red:** Clerk no carga (`status: 'error'` o el
  límite de 10 s de `useAuthAvailability`, lo que llegue antes; sin red,
  `navigator.onLine === false` lo adelanta a `offline` al momento). La app no
  puede preguntarle a Clerk quién es el usuario.
- **Perder la red con la app abierta:** Clerk ya cargó y conserva en memoria
  la sesión, así que `isSignedIn` e `userId` siguen ahí; lo que falla son las
  peticiones a Supabase, porque el token caduca al minuto y `getToken()` lanza
  `ClerkOfflineError`.

### Hipótesis (verificar en el dispositivo, #121)

1. Al abrir en frío sin red, el script de Clerk no sale de la caché HTTP del
   navegador. Si saliera (la dirección `@6` puede tener una caché corta),
   `clerk.load()` igualmente pide `/v1/environment` y `/v1/client` a la red,
   que fallan: se espera `error`, quizá `degraded`. En los dos casos la app
   hace lo mismo (ver 2), porque no usa `isSignedIn` sin red.
2. Con la app abierta y sin red durante mucho rato, Clerk no cierra la sesión
   por su cuenta (no recibe respuesta para saber que caducó). Si la cerrara,
   la app pasaría al modo sin conexión con el usuario recordado.
3. En iPhone, la app instalada (pantalla de inicio) y Safari tienen
   almacenamientos separados; la copia guardada en uno no se ve en el otro.
4. Safari borra el almacenamiento de un sitio tras 7 días sin abrirlo salvo
   que la app esté instalada; `navigator.storage.persist()` puede responder
   `false` en Safari y `true` en Chrome para una app instalada.

## 2. Cómo sabe la app quién es el usuario sin red (decisión)

Se aplica la propuesta del #18: **la app recuerda al último usuario con
sesión** y, si Clerk no está disponible, muestra la copia local de ese usuario
en solo lectura.

- Mientras Clerk dice que hay sesión, se guarda su id de usuario (el de
  Clerk, opaco) en `localStorage` (`orki-ultimo-usuario`). Solo el id: ni
  correo ni nombre.
- Cuando Clerk dice que no hay sesión (`isLoaded && !isSignedIn`: cierre de
  sesión aquí o en otra pestaña, sesión caducada) se borran el recuerdo, la
  copia local y las miniaturas.
- Si Clerk no está disponible (`offline` o `failed` en
  `useAuthAvailability`) y hay un usuario recordado, la colección es la suya
  y la app está en **solo lectura**. Sin usuario recordado, se ve el aviso de
  siempre ("sin conexión").
- Se acepta el riesgo que señala el #18: quien tenga el celular desbloqueado
  ve el inventario del último usuario hasta que haya conexión.
- Cerrar sesión sin conexión: el botón de Clerk no existe sin Clerk, así que
  la app muestra su propio "Cerrar sesión" que borra el recuerdo, la copia y
  las miniaturas. La sesión de Clerk en el servidor sigue abierta hasta que
  vuelva la red; al volver, Clerk puede reconocerla otra vez (es lo mismo que
  pasa al borrar los datos de un sitio sin salir de la cuenta).

La copia local y las miniaturas van siempre por id de usuario: aunque falle
algún borrado, la app nunca lee la copia de un id distinto del activo.

## Guion de prueba en el dispositivo (#117, #121)

En un iPhone y en un Android, con la app **instalada** (pantalla de inicio) y
una colección con fotos. Anotar modelo, versión del sistema y navegador.

1. **Con conexión:** entrar, abrir "Mi colección" y esperar a que carguen
   todas las tarjetas. Abrir `/diagnostico` (fuera de producción) y anotar
   "Almacenamiento persistente".
2. **En frío sin red:** activar el modo avión, cerrar la app del todo (quitarla
   de las recientes) y reabrirla.
   - Anotar qué se ve en la cabecera y cuánto tarda en aparecer.
   - Ir a "Mi colección": ¿aparece el inventario con el aviso "Sin conexión"
     y la fecha de la última actualización? ¿Se ven las miniaturas?
   - Buscar un nombre que se tiene, un sinónimo, una abreviatura ("Blc.") y
     uno que no se tiene; filtrar por género y estado.
   - Abrir una planta: ¿se ve el detalle? ¿Editar, Dar de baja, Eliminar y
     Registrar están deshabilitados con el motivo?
3. **Recuperar la red** sin cerrar la app: ¿desaparece el aviso y cambia la
   fecha sola? Registrar o editar una planta y comprobar que el cambio sigue
   ahí tras volver al modo avión y reabrir.
4. **Red perdida con la app abierta:** con la app abierta y cargada, activar
   el modo avión y esperar más de un minuto: ¿se mantiene el inventario y el
   aviso? ¿Sigue la sesión de Clerk (el avatar)?
5. **Cerrar sesión** (con red y otra vez sin red): comprobar en Ajustes del
   navegador o con las herramientas de desarrollo remotas que no quedan la
   base `orki-coleccion`, cachés `orki-miniaturas-v1:*` ni la clave
   `orki-ultimo-usuario`. Entrar con otra cuenta: no se ve nada de la primera.
