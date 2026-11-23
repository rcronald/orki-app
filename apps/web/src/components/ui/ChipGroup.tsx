import type { ComponentPropsWithRef } from 'react'

export type ChipGroupProps = ComponentPropsWithRef<'div'> & {
  /**
   * Una sola fila con desplazamiento horizontal (orki-chips--scroll), sin
   * barra de desplazamiento visible: para los accesos por género de «Mi
   * colección» (#206). Con el teclado, Tab recorre los chips y el navegador
   * desplaza la fila hasta el que tiene el foco.
   */
  scroll?: boolean
  /**
   * Hasta 720 px, una fila de ancho completo con aspecto de control
   * segmentado (orki-chips--segmented), para dos o tres opciones cortas como
   * el tipo del registro (#220). Los chips siguen siendo botones de alternar
   * (aria-pressed) dentro del grupo, como en SegmentedControl.
   */
  segmented?: boolean
}

// Contenedor de chips (orki-chips): fila que se parte con espacio space-2. Es
// un grupo para el lector de pantalla; ponle aria-label o aria-labelledby con
// lo que se filtra o se elige ("Género").
export function ChipGroup({
  className,
  role = 'group',
  scroll = false,
  segmented = false,
  ...props
}: ChipGroupProps) {
  const classes = [
    'orki-chips',
    scroll && 'orki-chips--scroll',
    segmented && 'orki-chips--segmented',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return <div role={role} {...props} className={classes} />
}
