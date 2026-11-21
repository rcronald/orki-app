import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button.tsx'

export interface ConfirmDialogProps {
  /** Título (el nombre accesible del diálogo). */
  title: string
  /** Qué pasará; es la descripción accesible del diálogo. */
  description: ReactNode
  /** Contenido de más entre la descripción y los botones (un campo, un error). */
  children?: ReactNode
  /** Texto del botón que confirma: un verbo, como "Eliminar definitivamente". */
  confirmLabel: string
  /** Texto mientras se hace la acción, como "Eliminando…". */
  busyLabel?: string
  /** danger para lo que no se puede deshacer; primary para lo demás. */
  confirmVariant?: 'primary' | 'danger'
  cancelLabel?: string
  /** La acción está en curso: no se cierra ni se vuelve a confirmar. */
  busy?: boolean
  /** Confirmar no se puede ahora (por ejemplo, sin conexión). */
  confirmDisabled?: boolean
  /** Id de lo que explica por qué no se puede confirmar. */
  confirmDescribedBy?: string
  /**
   * Qué recibe el foco al abrir: el primer control del contenido (por
   * defecto, si lo hay) o "Cancelar". Para lo destructivo, cancel: la
   * acción segura queda a mano de Enter.
   */
  initialFocus?: 'content' | 'cancel'
  onConfirm: () => void
  onCancel: () => void
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo de confirmación del sistema, modal (#16). Se monta abierto (quien
 * lo usa decide cuándo pintarlo) en un portal sobre el resto de la página,
 * que queda inerte (`inert`): ni el ratón, ni el tabulador, ni el lector de
 * pantalla llegan detrás. El foco entra al abrir, queda atrapado dentro
 * (Tab y Mayús+Tab dan la vuelta), Escape cancela y, al cerrar, vuelve al
 * elemento que lo tenía (el botón que lo abrió).
 *
 * No usa <dialog> con showModal(): jsdom no lo tiene y el foco atrapado y
 * devuelto se comporta distinto según el navegador; así es igual en todos.
 */
export function ConfirmDialog({
  title,
  description,
  children,
  confirmLabel,
  busyLabel,
  confirmVariant = 'primary',
  cancelLabel = 'Cancelar',
  busy = false,
  confirmDisabled = false,
  confirmDescribedBy,
  initialFocus = 'content',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Lo de detrás, inerte mientras está abierto; el foco vuelve al cerrar.
  useLayoutEffect(() => {
    const root = rootRef.current
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const others = [...document.body.children].filter(
      (element) => element !== root && !element.hasAttribute('inert'),
    )
    for (const element of others) element.setAttribute('inert', '')
    return () => {
      for (const element of others) element.removeAttribute('inert')
      previous?.focus()
    }
  }, [])

  useEffect(() => {
    const first =
      initialFocus === 'content'
        ? contentRef.current?.querySelector<HTMLElement>(FOCUSABLE)
        : null
    ;(first ?? cancelRef.current)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir.
  }, [])

  // Escape cancela y Tab da la vuelta dentro. Se escucha en el documento:
  // con lo de detrás inerte, el foco solo puede estar aquí.
  const latest = useRef({ busy, onCancel })
  useLayoutEffect(() => {
    latest.current = { busy, onCancel }
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!latest.current.busy) latest.current.onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [
        ...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
      ]
      const first = focusable.at(0)
      const last = focusable.at(-1)
      if (!first || !last) return
      const inside = panelRef.current?.contains(document.activeElement) ?? false
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !inside)
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const blocked = busy || confirmDisabled

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-[0] z-50 flex items-end justify-center bg-neutral-900/40 p-space-4 sm:items-center"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        className="flex max-h-full w-full max-w-md flex-col gap-space-4 overflow-y-auto rounded-lg bg-neutral-0 p-space-5 pb-[calc(var(--space-5)_+_env(safe-area-inset-bottom))] shadow-card"
      >
        <h2
          id={titleId}
          className="font-display text-lg font-semibold text-neutral-900"
        >
          {title}
        </h2>
        <div id={descriptionId} className="text-md text-neutral-900">
          {description}
        </div>
        {children && (
          <div ref={contentRef} className="flex flex-col gap-space-3">
            {children}
          </div>
        )}
        <div className="flex flex-wrap-reverse justify-end gap-space-3">
          <Button
            ref={cancelRef}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onCancel()
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            aria-disabled={blocked || undefined}
            aria-describedby={confirmDescribedBy}
            onClick={() => {
              if (!blocked) onConfirm()
            }}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
