import type { ComponentPropsWithRef } from 'react'
import { Icon, type IconName } from './Icon.tsx'

export type ValidationStatus = 'validated' | 'pending'

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
}

export type StatusBadgeProps = Omit<
  ComponentPropsWithRef<'span'>,
  'children'
> & {
  status: ValidationStatus
}

// Insignia de validación del nombre (orki-badge). Solo dos estados y siempre
// con palabra e icono: el color solo no comunica el estado.
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
