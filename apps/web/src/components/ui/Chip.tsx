import type { ComponentPropsWithRef } from 'react'
import { Icon } from './Icon.tsx'

export type ChipProps = Omit<
  ComponentPropsWithRef<'button'>,
  'aria-pressed'
> & {
  /** Seleccionado: se anuncia con aria-pressed y lleva el icono check. */
  selected: boolean
}

// Chip del design system (orki-chip) para filtrar o elegir una opción corta.
// Es un botón de alternar: quien lo usa cambia selected en onClick. Los géneros
// van con mayúscula inicial y sin cursiva. No sirve para acciones (eso es
// Button).
export function Chip({
  selected,
  className,
  type = 'button',
  children,
  ...props
}: ChipProps) {
  const classes = ['orki-chip', className].filter(Boolean).join(' ')

  return (
    <button {...props} type={type} className={classes} aria-pressed={selected}>
      {selected && <Icon name="check" />}
      {children}
    </button>
  )
}
