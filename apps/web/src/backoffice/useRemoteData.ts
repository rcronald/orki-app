import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import {
  CATALOG_ADMIN_ERROR_TEXT,
  catalogAdminFailure,
  type CatalogAdminFailure,
} from '../lib/catalogAdmin.ts'

// Lectura de la base para una pantalla, identificada por una clave (la
// consulta con sus filtros y su página, serializada).
//
// - Cancelación: al cambiar la clave, al reintentar o al desmontar se cancela
//   la petición en curso (AbortController) y la espera.
// - Espera opcional (debounceMs): la petición sale cuando la clave lleva ese
//   tiempo sin cambiar; escribir rápido hace una sola petición.
// - Nunca se muestran datos de otra petición: el resultado guardado lleva la
//   clave y el intento a los que responde, y solo se usa si coinciden con los
//   actuales. Mientras llega el nuevo, el estado es "loading". `previous` da
//   el último resultado de otra clave solo para que quien pinta reserve su
//   sitio (el número de filas del esqueleto), nunca para mostrarlo.

export type RemoteFailure = Exclude<CatalogAdminFailure, 'aborted'>

export type RemoteData<T> =
  | { status: 'idle' }
  | { status: 'loading'; previous: T | null }
  | { status: 'success'; data: T }
  | { status: 'error'; reason: RemoteFailure; message: string }

type Outcome<T> =
  | { key: string; attempt: number; ok: true; data: T }
  | { key: string; attempt: number; ok: false; reason: RemoteFailure }

export interface UseRemoteDataOptions {
  /** Espera antes de pedir, en milisegundos. Por defecto 0. */
  debounceMs?: number
}

/**
 * Lee con `load` cada vez que cambia `key`; con key null no lee nada (idle).
 * `load` puede cambiar en cada pintado: se usa la versión del momento en que
 * sale la petición.
 */
export function useRemoteData<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  { debounceMs = 0 }: UseRemoteDataOptions = {},
): RemoteData<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null)
  const run = useEffectEvent(load)

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    const start = () => {
      run(controller.signal).then(
        (data) => {
          if (controller.signal.aborted) return
          setOutcome({ key, attempt, ok: true, data })
        },
        (error: unknown) => {
          const reason = catalogAdminFailure(error)
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
  }, [key, attempt, debounceMs])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  if (key === null) return { status: 'idle', retry }
  if (outcome === null || outcome.key !== key || outcome.attempt !== attempt) {
    return {
      status: 'loading',
      previous: outcome?.ok ? outcome.data : null,
      retry,
    }
  }
  if (!outcome.ok) {
    return {
      status: 'error',
      reason: outcome.reason,
      message: CATALOG_ADMIN_ERROR_TEXT[outcome.reason],
      retry,
    }
  }
  return { status: 'success', data: outcome.data, retry }
}

/** Espera entre pulsaciones del buscador, en milisegundos. */
export const SEARCH_DEBOUNCE_MS = 250

/** El valor, `delay` milisegundos después de que deje de cambiar. */
export function useDebouncedValue<T>(value: T, delay = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}
