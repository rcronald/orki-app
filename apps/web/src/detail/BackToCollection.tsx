import type { MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import { cameFromInventory } from './navigation.ts'
import { DETAIL_TEXT } from './texts.ts'

/**
 * Enlace "Volver a mi colección" del detalle. Si se llegó desde el inventario,
 * es "atrás" en el historial: el inventario vuelve con su búsqueda, sus
 * filtros y su posición. Si no, va al inventario como un enlace normal. Es un
 * enlace de verdad en los dos casos (se puede abrir en otra pestaña).
 */
export function BackToCollection() {
  const location = useLocation()
  const navigate = useNavigate()
  const back = cameFromInventory(location.state)

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Con una tecla modificadora (otra pestaña o ventana), lo de siempre.
    if (!back || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    void navigate(-1)
  }

  return (
    <Link
      to={PATHS.collection}
      onClick={onClick}
      className="self-start text-md font-semibold text-secondary underline underline-offset-4"
    >
      {DETAIL_TEXT.back}
    </Link>
  )
}
