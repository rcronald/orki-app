import type { AppEnv } from '../config/env.ts'

const LABELS: Record<Exclude<AppEnv, 'prod'>, string> = {
  dev: 'Desarrollo',
}

interface EnvironmentBadgeProps {
  env: AppEnv
}

// Marca discreta del ambiente para reconocer a simple vista una vista previa o
// el servidor local. En producción no se muestra.
export function EnvironmentBadge({ env }: EnvironmentBadgeProps) {
  if (env === 'prod') return null

  return (
    <p className="pointer-events-none fixed bottom-[max(var(--space-2),env(safe-area-inset-bottom))] left-[max(var(--space-2),env(safe-area-inset-left))] z-50 rounded-sm bg-warning px-space-2 py-space-1 text-xs font-semibold text-neutral-900">
      <span className="sr-only">Ambiente: </span>
      {LABELS[env]}
    </p>
  )
}
