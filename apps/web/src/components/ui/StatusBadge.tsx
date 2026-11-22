import type { ComponentPropsWithRef } from 'react'
import { Icon, type IconName } from './Icon.tsx'

export type ValidationStatus = 'validated' | 'pending' | 'unidentifiable'

const BADGES: Record<
  ValidationStatus,
  { className: string; icon: IconName; label: string }
> = {
  validated: {
    className: 'orki-badge--validated',
    icon: 'circle-check',
    label: 'Validada',
  },
  pending: {
    className: 'orki-badge--pending',
    icon: 'triangle-alert',
    label: 'Nombre por validar',
  },
  // El design system solo trae las dos insignias de arriba (bundle.css no se
  // edita): "no identificable" (#141) se arma con sus tokens, neutra y con
  // borde para que no se confunda con "por validar", que pide atención.
  unidentifiable: {
    className: 'border border-neutral-700 bg-neutral-0 text-neutral-900',
    icon: 'tag',
    label: 'No identificable',
  },
}

export type StatusBadgeProps = Omit<
  ComponentPropsWithRef<'span'>,
  'children'
> & {
  status: ValidationStatus
}

// Insignia de validación del nombre (orki-badge): validada, por validar o no
// identificable, siempre con palabra e icono: el color solo no comunica el
// estado.
export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const badge = BADGES[status]
  const classes = ['orki-badge', badge.className, className]
    .filter(Boolean)
    .join(' ')

  return (
    <span {...props} className={classes}>
      <Icon name={badge.icon} />
      {badge.label}
    </span>
  )
}
