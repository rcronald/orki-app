import type { ComponentPropsWithRef } from 'react'
import { Icon } from './Icon.tsx'

export type FiltersButtonProps = Omit<
  ComponentPropsWithRef<'button'>,
  'children'
> & {
  /** Cuántos filtros hay aplicados; con 0 no se pinta el indicador. */
  activeCount: number
  /** Texto del botón; por defecto, «Filtros». */
  label?: string
}

// Botón «Filtros» de la barra del inventario (#206): orki-btn--secondary con
// el icono sliders-horizontal y, con filtros aplicados, el indicador
// orki-count con su número. El número se lee también con el lector de
// pantalla: «Filtros, 2 activos». Si abre un panel, pásale aria-expanded y
// aria-controls como a cualquier botón.
export function FiltersButton({
  activeCount,
  label = 'Filtros',
  className,
  type = 'button',
  ...props
}: FiltersButtonProps) {
  const classes = ['orki-btn orki-btn--secondary', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button {...props} type={type} className={classes}>
      <Icon name="sliders-horizontal" />
      {label}
      {activeCount > 0 && (
        <>
          <span className="orki-count" aria-hidden="true">
            {activeCount}
          </span>
          <span className="sr-only">
            {`, ${activeCount} ${activeCount === 1 ? 'activo' : 'activos'}`}
          </span>
        </>
      )}
    </button>
  )
}
