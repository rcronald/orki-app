// Llevar a la vista el control con el foco dentro de un contenedor que se
// desplaza (#267): el formulario de la bitácora a pantalla completa en el
// celular. Con el teclado abierto, el área que se ve es la del viewport
// visual (visualViewport), más baja que el diálogo, y no todos los motores
// desplazan un control enfocado que ya asoma: el WebKit de Linux lo dejaba
// visible menos de la mitad. Aquí se calcula sobre el área realmente visible:
// el control entero si cabe; si es más alto que el hueco, su parte de arriba.

/** Margen entre el control y el borde del área visible, en px. */
const MARGIN = 8

/** El área visible del contenedor: su caja recortada por el viewport visual. */
export function visibleArea(scroller: HTMLElement): {
  top: number
  bottom: number
} {
  const box = scroller.getBoundingClientRect()
  const viewport = window.visualViewport
  const viewTop = viewport ? viewport.offsetTop : 0
  const viewBottom = viewport
    ? viewport.offsetTop + viewport.height
    : window.innerHeight
  return {
    top: Math.max(box.top, viewTop),
    bottom: Math.min(box.bottom, viewBottom),
  }
}

/**
 * Desplaza `scroller` lo justo para que `target` se vea entero (con un
 * margen) o, si no cabe, para que se vea su parte de arriba, sin animación.
 * Devuelve cuánto se desplazó.
 */
export function revealInScroller(
  scroller: HTMLElement,
  target: HTMLElement,
): number {
  const area = visibleArea(scroller)
  const top = area.top + MARGIN
  const bottom = area.bottom - MARGIN
  const box = target.getBoundingClientRect()
  let delta = 0
  if (box.height > bottom - top || box.top < top) delta = box.top - top
  else if (box.bottom > bottom) delta = box.bottom - bottom
  // Lo que ya se puede desplazar en ese sentido (no más allá del final).
  const max = scroller.scrollHeight - scroller.clientHeight
  delta = Math.max(
    -scroller.scrollTop,
    Math.min(delta, max - scroller.scrollTop),
  )
  if (Math.abs(delta) < 1) return 0
  // Sin animación, como el desplazamiento que hace el navegador al enfocar
  // (y así también con «menos movimiento»): el WebKit de Playwright no llega
  // a mover un desplazamiento suave lanzado desde el evento focus.
  if (typeof scroller.scrollBy === 'function') {
    scroller.scrollBy({ top: delta, behavior: 'instant' })
  } else {
    scroller.scrollTop += delta
  }
  return delta
}
