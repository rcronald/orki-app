import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Diálogo modal del backoffice: la capa, la caja y el manejo del foco, para
// la confirmación (ConfirmDialog) y la fusión de especies (SpeciesMergeDialog).
// Patrón de diálogo modal de WAI-ARIA APG:
// - role="dialog" o "alertdialog" con aria-modal, el título en
//   aria-labelledby y, si se indica, la explicación en aria-describedby.
// - Al abrirse, el foco va a donde diga `initialFocus`. Tab y Mayús+Tab no
//   salen del diálogo.
// - Escape lo cierra sin hacer nada (salvo mientras se guarda), si no lo usó
//   antes un control de dentro: Escape primero cierra la lista de un buscador
//   o borra su texto (el control llama a preventDefault).
// - Al cerrarse, el foco vuelve a donde estaba antes de abrirlo, o al que
//   diga `returnFocusTo` si devuelve uno (por ejemplo, tras quitar el
//   elemento que lo abrió).
// Se pinta en document.body, sobre una capa que cubre la pantalla. El teclado
// se escucha en document, después de que React haya pasado el evento por los
// controles del diálogo: así se sabe si alguno ya usó el Escape.

export interface ModalDialogProps {
  role?: 'dialog' | 'alertdialog'
  title: ReactNode
  /** id del contenido que explica el diálogo (aria-describedby). */
  describedBy?: string
  /** Mientras se guarda: Escape no lo cierra y se marca aria-busy. */
  busy?: boolean
  /** Pone el foco al abrirse. */
  initialFocus: () => void
  onCancel: () => void
  /**
   * Dónde poner el foco al cerrarse en lugar de donde estaba; si devuelve
   * null, vuelve a donde estaba (si sigue en la página).
   */
  returnFocusTo?: () => HTMLElement | null
  /** Ancho máximo de la caja (una clase de Tailwind). */
  widthClassName?: string
  children: ReactNode
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ModalDialog({
  role = 'dialog',
  title,
  describedBy,
  busy = false,
  initialFocus,
  onCancel,
  returnFocusTo,
  widthClassName = 'max-w-[480px]',
  children,
}: ModalDialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const fallbackFocus = useEffectEvent(() => returnFocusTo?.() ?? null)
  const focusFirst = useEffectEvent(initialFocus)

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const dialog = dialogRef.current
    if (
      dialog === null ||
      !(event.target instanceof Node) ||
      !dialog.contains(event.target)
    )
      return
    if (event.key === 'Escape') {
      if (event.defaultPrevented) return
      event.preventDefault()
      if (!busy) onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((element) => !element.closest('[hidden]'))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    focusFirst()
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    document.addEventListener('keydown', listener)
    return () => {
      document.removeEventListener('keydown', listener)
      const target =
        fallbackFocus() ?? (previous && previous.isConnected ? previous : null)
      // En el momento, no en una tarea aparte: en desarrollo, StrictMode
      // monta, desmonta y vuelve a montar el diálogo, y un foco diferido
      // llegaría después del del segundo montaje y lo sacaría del diálogo.
      // Las limpiezas de efectos corren con el DOM ya actualizado.
      target?.focus()
    }
  }, [])

  return createPortal(
    <div className="fixed inset-[0] z-[50] flex items-center justify-center bg-[rgba(31,31,31,0.5)] p-space-4">
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy}
        className={`flex max-h-[calc(100vh_-_2_*_var(--space-4))] w-full ${widthClassName} flex-col gap-space-4 overflow-y-auto rounded-lg bg-neutral-0 p-space-5 shadow-card`}
      >
        <h2
          id={titleId}
          className="font-display text-xl text-neutral-900 [overflow-wrap:anywhere]"
        >
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
