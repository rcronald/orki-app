import { useSyncExternalStore } from 'react'

// Si el navegador dice tener conexión, actualizado con los eventos online y
// offline. navigator.onLine es fiable cuando dice que no hay red; cuando dice
// que la hay puede equivocarse (una wifi sin salida a internet), así que
// quien escribe en la red sigue tratando el fallo de la petición.

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

function getSnapshot(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/** true salvo que el navegador sepa que no hay conexión. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}
