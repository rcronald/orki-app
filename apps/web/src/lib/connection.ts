// Lo que el navegador sabe de la conexión. navigator.onLine es fiable cuando
// dice que no hay red; cuando dice que la hay puede equivocarse (una wifi sin
// salida a internet), así que solo se usa para decir «sin conexión».

/** true si el navegador sabe que no hay conexión. */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * El motivo de un fallo de red: «offline» si el navegador sabe que no hay
 * conexión; si no, `otherwise` (normalmente «failed»).
 */
export function offlineOr<Reason extends string>(
  otherwise: Reason,
): 'offline' | Reason {
  return isBrowserOffline() ? 'offline' : otherwise
}
