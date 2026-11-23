import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { catalogSearchFailure } from '../lib/catalogSearch.ts'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'

// Lectura del catálogo público para una pantalla (#232), identificada por una
// clave ("generos", "especie:<id>", "busqueda:<texto>"…).
//
// - Memoria de la visita: cada respuesta se guarda en memoria mientras la
//   pestaña está abierta (como mucho MAX_ENTRIES, las más recientes). Volver a
//   una página ya vista la pinta al momento, sin pedirla otra vez, y también
//   sin conexión: el catálogo no se guarda en el dispositivo (ni en IndexedDB
//   ni en el precaché), pero lo que ya se cargó en esta visita se sigue
//   viendo.
// - Cancelación y espera opcional (debounceMs, para el buscador), como
//   backoffice/useRemoteData.ts: nunca se muestran datos de otra clave.
// - Sin conexión: el error es «offline»; al volver la conexión se pide otra
//   vez sola. «Reintentar» (retry) también.

const MAX_ENTRIES = 100
const cache = new Map<string, unknown>()

/**
 * Guarda `data` en la memoria de la visita con otra clave: por ejemplo, la
 * última página de un género cuando se pidió una mayor.
 */
export function rememberCatalogData(key: string, data: unknown): void {
  remember(key, data)
}

function remember(key: string, data: unknown): void {
  cache.delete(key)
  cache.set(key, data)
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/** Vacía la memoria de la visita (para las pruebas). */
export function forgetCatalogData(): void {
  cache.clear()
}

export type CatalogFailure = 'offline' | 'failed'

export type CatalogData<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; reason: CatalogFailure }

type Outcome<T> =
  | { key: string; attempt: number; ok: true; data: T }
  | { key: string; attempt: number; ok: false; reason: CatalogFailure }

export interface UseCatalogDataOptions {
  /** Espera antes de pedir, en milisegundos. Por defecto 0. */
  debounceMs?: number
}

/**
 * Lee con `load` cada vez que cambia `key`; con key null no lee nada (idle).
 * `load` puede cambiar en cada pintado: se usa la del momento de la petición.
 */
export function useCatalogData<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  { debounceMs = 0 }: UseCatalogDataOptions = {},
): CatalogData<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null)
  const online = useOnlineStatus()
  const run = useEffectEvent(load)
  const cached = key !== null && cache.has(key)

  useEffect(() => {
    if (key === null || cached) return
    const controller = new AbortController()
    const start = () => {
      run(controller.signal).then(
        (data) => {
          if (controller.signal.aborted) return
          remember(key, data)
          setOutcome({ key, attempt, ok: true, data })
        },
        (error: unknown) => {
          const reason = catalogSearchFailure(error)
          if (controller.signal.aborted || reason === 'aborted') return
          setOutcome({ key, attempt, ok: false, reason })
        },
      )
    }
    const timer = debounceMs > 0 ? setTimeout(start, debounceMs) : null
    if (timer === null) start()
    return () => {
      if (timer !== null) clearTimeout(timer)
      controller.abort()
    }
    // `online`: al volver la conexión, se pide otra vez lo que faltó.
  }, [key, cached, attempt, debounceMs, online])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  if (key === null) return { status: 'idle', retry }
  if (cached) return { status: 'success', data: cache.get(key) as T, retry }
  if (outcome === null || outcome.key !== key || outcome.attempt !== attempt) {
    return { status: 'loading', retry }
  }
  if (!outcome.ok) {
    // Sin conexión según el navegador, aunque la petición fallara de otra
    // forma: lo que hay que decir es que falta la conexión.
    const reason = online ? outcome.reason : 'offline'
    return { status: 'error', reason, retry }
  }
  return { status: 'success', data: outcome.data, retry }
}
