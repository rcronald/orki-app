import { useEffect, useRef } from 'react'
import type { OwnershipOutcome, Ownership } from '../collection/ownership.ts'

// Punto de enganche para medir "¿Ya la tengo?" (#19). El evento de producto
// lo envía el #146 ("búsqueda ¿Ya la tengo?": duración desde que se empieza
// a escribir hasta que se muestra la respuesta, y resultado); aquí solo se
// mide y se entrega a quien lo pida con la prop onMeasure de OwnershipPanel.
// No se envía nada a ningún sitio.
//
// La medida nunca lleva el texto buscado, ni nombres de plantas: solo
// números y valores cerrados.

/** Una respuesta mostrada. */
export interface OwnershipMeasurement {
  /**
   * Número de la búsqueda, que empieza al escribir en el buscador vacío (o al
   * abrir la pantalla con una búsqueda en la URL) y termina al vaciarlo.
   * Mientras se escribe se muestran varias respuestas con el mismo número:
   * la última de cada búsqueda es la que el usuario vio al final.
   */
  searchId: number
  /** Milisegundos desde que empezó la búsqueda hasta que se pintó esta respuesta. */
  durationMs: number
  /** Milisegundos que tardó en calcularse la respuesta local. */
  computeMs: number
  /** La tengo, parecidas o no la tengo. */
  outcome: OwnershipOutcome
  /** Por especie (o nombre) o por género. */
  scope: Ownership['scope']
  /** Si la respuesta salió solo de la colección local o la mejoró el catálogo. */
  source: 'local' | 'catalog'
  /** Ejemplares activos que coinciden. */
  matchCount: number
  /** Si el navegador decía tener conexión. */
  online: boolean
}

export type OnOwnershipMeasure = (measurement: OwnershipMeasurement) => void

let lastSearchId = 0

/** Mide `fn` con `now`. Fuera del componente: el render no llama al reloj. */
export function timed<T>(
  fn: () => T,
  now: () => number,
): { value: T; ms: number } {
  const start = now()
  const value = fn()
  return { value, ms: now() - start }
}

interface Shown {
  ownership: Ownership | null
  source: 'local' | 'catalog'
  computeMs: number
  online: boolean
}

/**
 * Llama a `onMeasure` cada vez que se pinta una respuesta distinta. `query` es
 * el texto del campo (no el diferido): la búsqueda empieza con su primera
 * letra.
 */
export function useOwnershipMeasurement(
  query: string,
  shown: Shown,
  onMeasure: OnOwnershipMeasure | undefined,
  now: () => number,
): void {
  const search = useRef<{ id: number; start: number } | null>(null)
  const { ownership, source, computeMs, online } = shown
  // Lo que acompaña a la medida, sin que su cambio cuente como otra respuesta.
  const latest = useRef({ computeMs, online, onMeasure, now })
  useEffect(() => {
    latest.current = { computeMs, online, onMeasure, now }
  })

  useEffect(() => {
    if (query.trim() === '') search.current = null
    else if (search.current === null) {
      lastSearchId += 1
      search.current = { id: lastSearchId, start: latest.current.now() }
    }
  }, [query])

  // Solo al cambiar la respuesta pintada.
  useEffect(() => {
    const { onMeasure: report, now: clock } = latest.current
    const current = search.current
    if (report === undefined || ownership === null || current === null) return
    report({
      searchId: current.id,
      durationMs: Math.max(0, clock() - current.start),
      computeMs: latest.current.computeMs,
      outcome: ownership.outcome,
      scope: ownership.scope,
      source,
      matchCount: ownership.matches.length,
      online: latest.current.online,
    })
  }, [ownership, source])
}
