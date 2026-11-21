import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from '../components/ui/Icon.tsx'

interface ActionNoticeProps {
  /** Qué se hizo. */
  children: ReactNode
  /** Acción del aviso, como "Reactivar" o "Deshacer". */
  action?: ReactNode
  onDismiss: () => void
}

/**
 * Aviso de confirmación de una acción sobre una planta (#16: guardar, dar de
 * baja, reactivar, eliminar), con su botón de cerrar, como RegisteredNotice.
 * La región role="status" se pinta vacía y el texto llega en el pintado
 * siguiente: un lector de pantalla anuncia un cambio dentro de una región ya
 * presente, no una región que aparece con su contenido. Cambiar `key` lo
 * vuelve a anunciar.
 */
export function ActionNotice({
  children,
  action,
  onDismiss,
}: ActionNoticeProps) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div role="status">
      {visible && (
        <div className="flex flex-wrap items-center gap-space-3 rounded-lg bg-neutral-50 p-space-4">
          <p className="flex min-w-[0] flex-1 items-start gap-space-2 text-md text-neutral-900">
            <Icon
              name="circle-check"
              className="mt-[2px] size-[20px] flex-none text-success"
            />
            <span className="[overflow-wrap:anywhere]">{children}</span>
          </p>
          <div className="flex items-center gap-space-2">
            {action}
            <button
              type="button"
              aria-label="Cerrar el aviso"
              className="inline-flex size-[44px] items-center justify-center rounded-md text-neutral-900 hover:bg-neutral-0"
              onClick={onDismiss}
            >
              <Icon name="x" className="size-[20px]" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
