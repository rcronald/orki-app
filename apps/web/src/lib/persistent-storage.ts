// Almacenamiento persistente (#18, #118): se pide al navegador que no borre
// los datos de la app (la copia local y las miniaturas) cuando le falte
// espacio. Cada navegador decide: Chrome suele concederlo a una app instalada
// sin preguntar; Safari puede responder false y aun así conservarlos mientras
// la app esté instalada. Lo que responda cada plataforma se ve en
// /diagnostico (fuera de producción) y se anota en el #118.

export type PersistentStorageState = 'granted' | 'denied' | 'unsupported'

let requested: Promise<PersistentStorageState> | undefined

function storageManager(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage
}

/**
 * Pide el almacenamiento persistente una vez por carga de la app (las
 * siguientes llamadas devuelven la misma respuesta). Nunca rechaza.
 */
export function requestPersistentStorage(): Promise<PersistentStorageState> {
  requested ??= (async () => {
    const storage = storageManager()
    if (typeof storage?.persist !== 'function') return 'unsupported'
    try {
      if (await storage.persisted()) return 'granted'
      return (await storage.persist()) ? 'granted' : 'denied'
    } catch {
      return 'unsupported'
    }
  })()
  return requested
}

/** Si el almacenamiento ya es persistente, sin pedirlo. Nunca rechaza. */
export async function persistentStorageState(): Promise<PersistentStorageState> {
  const storage = storageManager()
  if (typeof storage?.persisted !== 'function') return 'unsupported'
  try {
    return (await storage.persisted()) ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/** Solo para las pruebas: olvida la respuesta guardada. */
export function resetPersistentStorageRequest(): void {
  requested = undefined
}
