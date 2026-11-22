import { useSyncExternalStore } from 'react'

// Preferencia de movimiento reducido del sistema, con media query: se sigue en
// vivo, así que cambiarla con la app abierta se aplica al momento.

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION).matches
  )
}

/** ¿Pide el sistema movimiento reducido? */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}
