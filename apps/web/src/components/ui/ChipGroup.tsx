import type { ComponentPropsWithRef } from 'react'

export type ChipGroupProps = ComponentPropsWithRef<'div'>

// Contenedor de chips (orki-chips): fila que se parte con espacio space-2. Es
// un grupo para el lector de pantalla; ponle aria-label o aria-labelledby con
// lo que se filtra o se elige ("Género").
export function ChipGroup({
  className,
  role = 'group',
  ...props
}: ChipGroupProps) {
  const classes = ['orki-chips', className].filter(Boolean).join(' ')

  return <div role={role} {...props} className={classes} />
}
