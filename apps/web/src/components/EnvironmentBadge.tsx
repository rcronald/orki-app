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
    <p className="pointer-events-none fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-[max(0.5rem,env(safe-area-inset-left))] z-50 rounded-full border border-amber-700 bg-amber-100/90 px-2 py-0.5 text-xs font-semibold text-amber-900">
      <span className="sr-only">Ambiente: </span>
      {LABELS[env]}
    </p>
  )
}
