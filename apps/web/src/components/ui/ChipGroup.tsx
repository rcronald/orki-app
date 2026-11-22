import type { ComponentPropsWithRef } from 'react'

export type ChipGroupProps = ComponentPropsWithRef<'div'> & {
  /**
   * Una sola fila con desplazamiento horizontal (orki-chips--scroll), sin
   * barra de desplazamiento visible: para los accesos por género de «Mi
   * colección» (#206). Con el teclado, Tab recorre los chips y el navegador
   * desplaza la fila hasta el que tiene el foco.
   */
  scroll?: boolean
}

// Contenedor de chips (orki-chips): fila que se parte con espacio space-2. Es
// un grupo para el lector de pantalla; ponle aria-label o aria-labelledby con
// lo que se filtra o se elige ("Género").
export function ChipGroup({
  className,
  role = 'group',
  scroll = false,
  ...props
}: ChipGroupProps) {
  const classes = ['orki-chips', scroll && 'orki-chips--scroll', className]
    .filter(Boolean)
    .join(' ')

  return <div role={role} {...props} className={classes} />
}
