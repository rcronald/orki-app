import { Button } from '../components/ui/Button.tsx'

// Estados propios de las pantallas de acceso mientras Clerk no está listo. Se
// anuncian al lector de pantalla: la carga como estado (role="status", cortés)
// y el fallo como alerta (role="alert"), porque impide hacer lo que se vino a
// hacer.

export function AuthLoading() {
  return (
    <p role="status" className="text-md text-neutral-700">
      Cargando el acceso…
    </p>
  )
}

const UNAVAILABLE_TEXT = {
  offline: {
    title: 'Sin conexión',
    body: 'Para iniciar sesión o crear una cuenta necesitas conexión a internet. Mientras tanto, puedes seguir usando la app.',
  },
  failed: {
    title: 'No se pudo cargar el acceso',
    body: 'El servicio de inicio de sesión no respondió. Puedes volver a intentarlo o seguir usando la app.',
  },
} as const

export type AuthUnavailableReason = keyof typeof UNAVAILABLE_TEXT

interface AuthUnavailableProps {
  reason: AuthUnavailableReason
  /** Por defecto recarga la página, que vuelve a pedir el script de Clerk. */
  onRetry?: () => void
}

function reloadPage() {
  window.location.reload()
}

export function AuthUnavailable({
  reason,
  onRetry = reloadPage,
}: AuthUnavailableProps) {
  const text = UNAVAILABLE_TEXT[reason]
  return (
    <div
      role="alert"
      className="flex flex-col gap-space-3 rounded-md bg-neutral-50 p-space-4 text-neutral-900"
    >
      <p className="font-display text-xl">{text.title}</p>
      <p>{text.body}</p>
      <Button variant="primary" onClick={onRetry}>
        Volver a intentar
      </Button>
    </div>
  )
}

const NOTICE_TEXT: Record<AuthUnavailableReason, string> = {
  offline: 'Sin conexión: el acceso a tu cuenta no está disponible.',
  failed: 'El acceso a tu cuenta no está disponible ahora.',
}

/**
 * Aviso breve para la cabecera de la app pública: no interrumpe (es un estado,
 * no una alerta), porque la app se puede seguir usando.
 */
export function AuthNotice({ reason }: { reason: AuthUnavailableReason }) {
  return (
    <p role="status" className="text-sm text-neutral-700">
      {NOTICE_TEXT[reason]}
    </p>
  )
}
