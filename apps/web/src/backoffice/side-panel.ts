// Paneles laterales del backoffice (detalle de una especie, alta, género)
// y avisos de resultado: clases y desplazamiento (#257).

/**
 * Panel lateral (detalle, alta, género): en escritorio, columna junto a la
 * tabla que se queda a la vista al desplazar la página, con su propio
 * desplazamiento si no cabe; en pantallas estrechas, debajo de la tabla.
 */
export const SIDE_PANEL =
  'flex flex-col self-start rounded-lg bg-neutral-50 p-space-4 scroll-mt-[var(--space-4)] lg:sticky lg:top-space-4 lg:max-h-[calc(100dvh-var(--space-4)*2)] lg:overflow-y-auto lg:overscroll-contain'

/** Columnas de la tabla con un panel lateral abierto. */
export const WITH_SIDE_PANEL =
  'lg:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_480px]'

/** Desplazamiento suave, salvo que el sistema pida movimiento reducido. */
export function scrollBehavior(): ScrollBehavior {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
}

/**
 * Lleva a la vista un panel recién abierto y el foco a su encabezado: primero
 * se desplaza la página hasta el panel (sin animación si se pide movimiento
 * reducido) y luego se enfoca sin volver a desplazar.
 */
export function revealPanel(
  panel: HTMLElement | null,
  heading: HTMLElement | null,
) {
  if (panel && typeof panel.scrollIntoView === 'function') {
    const top = panel.getBoundingClientRect().top
    // Ya está arriba del todo (pegado en escritorio, o recién llegado).
    if (top < 0 || top > window.innerHeight / 4) {
      panel.scrollIntoView({
        block: 'start',
        behavior: scrollBehavior(),
      })
    }
  }
  heading?.focus({ preventScroll: true })
}

/** Aviso de resultado y dónde se ve (ver ResultNotice en parts.tsx). */
export interface PlacedNotice<Place> {
  /** Sube con cada aviso, para volver a mostrarlo aunque se repita el texto. */
  id: number
  message: string
  place: Place
}
