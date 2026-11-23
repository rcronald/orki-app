import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlantLogEntryType } from '../lib/database.ts'
import { plantLogErrorFrom, type PlantLogErrorReason } from './entries.ts'
import type { LogEntry } from './model.ts'
import { usePlantLogServices } from './services.ts'

// Estado de la bitácora de la ficha (#267): la primera página con el filtro
// elegido, «Cargar más» con el cursor del último registro y los cambios
// locales al añadir o borrar uno. Solo lee con `enabled` (con conexión y la
// sesión confirmada): sin conexión no hay copia en el dispositivo. Lo que ya
// se leyó se conserva si se pierde la conexión.

/** Registros por página. */
export const LOG_PAGE_SIZE = 20

export type PlantLogStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PlantLogState {
  filter: PlantLogEntryType | null
  entries: readonly LogEntry[]
  status: PlantLogStatus
  /** Por qué falló la primera página (status error). */
  error: PlantLogErrorReason | null
  hasMore: boolean
  loadingMore: boolean
  /** Por qué falló «Cargar más». */
  moreError: PlantLogErrorReason | null
}

export interface PlantLogApi extends PlantLogState {
  /** Cambia el filtro y vuelve a leer la primera página. */
  setFilter: (filter: PlantLogEntryType | null) => void
  /** Vuelve a leer la primera página con el filtro de ahora. */
  reload: () => void
  /** Lee la página siguiente; devuelve cuántos registros llegaron. */
  loadMore: () => Promise<number>
  /** Pone un registro recién creado arriba (sin repetirlo). */
  prepend: (entry: LogEntry) => void
  /** Quita un registro borrado. */
  remove: (entryId: string) => void
}

const INITIAL: PlantLogState = {
  filter: null,
  entries: [],
  status: 'idle',
  error: null,
  hasMore: false,
  loadingMore: false,
  moreError: null,
}

export function usePlantLog(plantId: string, enabled: boolean): PlantLogApi {
  const { entries: api } = usePlantLogServices()
  const [state, setState] = useState<PlantLogState>(INITIAL)
  const stateRef = useRef(state)
  // Cada lectura de la primera página tiene su número: una respuesta vieja
  // (de otro filtro) no pisa la nueva.
  const request = useRef(0)
  const [attempt, setAttempt] = useState(0)

  const commit = useCallback(
    (change: (current: PlantLogState) => PlantLogState) => {
      setState((current) => {
        const next = change(current)
        stateRef.current = next
        return next
      })
    },
    [],
  )

  const filter = state.filter
  const loaded = state.status === 'ready'
  useEffect(() => {
    if (!enabled || loaded) return
    const current = ++request.current
    commit((s) => ({ ...s, status: 'loading', error: null }))
    api
      .list({
        plantId,
        type: filter,
        before: null,
        pageSize: LOG_PAGE_SIZE + 1,
      })
      .then(
        (page) => {
          if (request.current !== current) return
          commit((s) => ({
            ...s,
            status: 'ready',
            entries: page.slice(0, LOG_PAGE_SIZE),
            hasMore: page.length > LOG_PAGE_SIZE,
            moreError: null,
          }))
        },
        (error: unknown) => {
          if (request.current !== current) return
          commit((s) => ({
            ...s,
            status: 'error',
            error: plantLogErrorFrom(error).reason,
          }))
        },
      )
    // `loaded` vuelve a false al cambiar el filtro o reintentar.
  }, [api, plantId, enabled, filter, loaded, attempt, commit])

  const setFilter = useCallback(
    (next: PlantLogEntryType | null) => {
      request.current += 1
      commit((s) => ({
        ...INITIAL,
        filter: next,
        // Mientras llega, se sigue viendo la lista anterior.
        entries: s.entries,
      }))
      setAttempt((value) => value + 1)
    },
    [commit],
  )

  const reload = useCallback(() => {
    request.current += 1
    commit((s) => ({ ...s, status: 'idle', error: null }))
    setAttempt((value) => value + 1)
  }, [commit])

  const loadMore = useCallback(async () => {
    const current = stateRef.current
    const last = current.entries.at(-1)
    if (current.loadingMore || !current.hasMore || !last) return 0
    const first = request.current
    commit((s) => ({ ...s, loadingMore: true, moreError: null }))
    try {
      const page = await api.list({
        plantId,
        type: current.filter,
        before: { createdAt: last.createdAt, id: last.id },
        pageSize: LOG_PAGE_SIZE + 1,
      })
      if (request.current !== first) return 0
      const added = page.slice(0, LOG_PAGE_SIZE)
      commit((s) => {
        const known = new Set(s.entries.map((entry) => entry.id))
        return {
          ...s,
          loadingMore: false,
          entries: [
            ...s.entries,
            ...added.filter((entry) => !known.has(entry.id)),
          ],
          hasMore: page.length > LOG_PAGE_SIZE,
        }
      })
      return added.length
    } catch (error) {
      if (request.current === first) {
        commit((s) => ({
          ...s,
          loadingMore: false,
          moreError: plantLogErrorFrom(error).reason,
        }))
      }
      return 0
    }
  }, [api, plantId, commit])

  const prepend = useCallback(
    (entry: LogEntry) => {
      commit((s) => ({
        ...s,
        entries: [entry, ...s.entries.filter((item) => item.id !== entry.id)],
      }))
    },
    [commit],
  )

  const remove = useCallback(
    (entryId: string) => {
      commit((s) => ({
        ...s,
        entries: s.entries.filter((entry) => entry.id !== entryId),
      }))
    },
    [commit],
  )

  return { ...state, setFilter, reload, loadMore, prepend, remove }
}
