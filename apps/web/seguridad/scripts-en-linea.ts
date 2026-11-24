// Hashes de los scripts en línea de index.html (la portada prerrenderada,
// prerender/portada-previa-plugin.ts), que la CSP permite en script-src.
//
// Generado por `npm run cabeceras -- --actualizar` a partir del build: no se
// edita a mano. No dependen del ambiente (solo del código y de los nombres con
// hash de las fotos de la portada), así que valen para todos.
// `npm run cabeceras` falla si el build tiene un script en línea que no está
// aquí (ver docs/operacion/cabeceras-de-seguridad.md).
export const SCRIPTS_EN_LINEA: readonly string[] = [
  'sha256-/KuMluTY+UcUWOTaVCenKtzGd08nBdCYET+Aj7TZTNQ=',
  'sha256-7LvWapSjiHtMfuF3nFKV0krBqWGvan+5pxe4H2HfcvE=',
]
