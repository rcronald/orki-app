import type { ComponentPropsWithRef } from 'react'
import { Icon } from './Icon.tsx'

export type MatchBadgeProps = ComponentPropsWithRef<'span'>

// Insignia de coincidencia (orki-match, #220): bajo el campo de nombre del
// registro, dice que el nombre elegido es una especie del catálogo. Icono check
// y texto en color-secondary-strong sobre color-secondary-soft. Es texto: va
// dentro de la ayuda del campo, así el lector la lee con él.
export function MatchBadge({
  className,
  children = 'Coincidencia en el catálogo',
  ...props
}: MatchBadgeProps) {
  return (
    <span
      {...props}
      className={['orki-match', className].filter(Boolean).join(' ')}
    >
      <Icon name="check" />
      {children}
    </span>
  )
}
