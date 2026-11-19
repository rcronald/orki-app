import type { LucideProps } from 'lucide-react'
import { ICONS, type IconName } from './icons.ts'

export type { IconName } from './icons.ts'

type IconProps = Omit<
  LucideProps,
  'ref' | 'size' | 'width' | 'height' | 'color' | 'strokeWidth'
> & {
  name: IconName
}

// Icono en línea con stroke="currentColor": toma el color del texto. Siempre
// acompaña a una palabra, así que es decorativo para el lector de pantalla. El
// tamaño lo fija bundle.css según dónde va (14, 16, 20 o 24 px). Es el único
// punto de entrada de los iconos: ningún componente importa lucide-react.
export function Icon({ name, ...props }: IconProps) {
  const LucideComponent = ICONS[name]
  return <LucideComponent {...props} aria-hidden="true" />
}
