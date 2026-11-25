import { useSyncExternalStore } from 'react'

// Puntero principal táctil (celular o tableta), con media query: decide si
// el campo de foto ofrece el botón de cámara (ver PhotoField.tsx).

const COARSE_POINTER = '(pointer: coarse)'

function subscribePointer(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(COARSE_POINTER)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function coarsePointer(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(COARSE_POINTER).matches
  )
}

/** ¿Es táctil el puntero principal? (celular o tableta) */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribePointer, coarsePointer, () => false)
}

function touchDevice(): boolean {
  return (
    coarsePointer() ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  )
}

/**
 * ¿Es un dispositivo táctil? Puntero principal grueso o pantalla táctil
 * (maxTouchPoints). La galería del registro (#221) ofrece «Tomar foto» solo
 * aquí: un navegador no dice si hay cámara sin pedir permiso, y en el
 * escritorio capture se ignora y abriría el mismo selector que «Añadir fotos».
 */
export function useTouchDevice(): boolean {
  return useSyncExternalStore(subscribePointer, touchDevice, () => false)
}
