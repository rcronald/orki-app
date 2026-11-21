import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'

// Diálogo de confirmación del backoffice, propio porque la app no tenía
// ninguno y window.confirm no sirve para explicar a qué afecta un cambio.
// Patrón de diálogo modal de WAI-ARIA APG:
// - role="alertdialog" (las confirmaciones interrumpen) con aria-modal, el
//   título en aria-labelledby y la explicación en aria-describedby.
// - Al abrirse, el foco va al botón menos peligroso: "Cancelar" si la acción
//   destruye algo, la acción si no. Tab y Mayús+Tab no salen del diálogo.
// - Escape y "Cancelar" lo cierran sin hacer nada (salvo mientras se guarda).
// - Al cerrarse, el foco vuelve a donde estaba antes de abrirlo, o a
//   al que diga `returnFocusTo` si devuelve uno (por ejemplo, tras quitar
//   el elemento que lo abrió).
// Se pinta en document.body, sobre una capa que cubre la pantalla.

export interface ConfirmDialogProps {
  title: string
  /** Qué va a pasar y a qué afecta. */
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** danger para lo que no se puede deshacer (borrar). */
  variant?: 'primary' | 'danger'
  /** Mientras se guarda: los botones no responden y se anuncia. */
  busy?: boolean
  busyText?: string
  /** Error de la última confirmación, dentro del diálogo. */
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
  /**
   * Dónde poner el foco al cerrarse en lugar de donde estaba; si devuelve
   * null, vuelve a donde estaba (si sigue en la página).
   */
  returnFocusTo?: () => HTMLElement | null
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancelar',
  variant = 'primary',
  busy = false,
  busyText = 'Guardando…',
  error = null,
  onConfirm,
  onCancel,
  returnFocusTo,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const fallbackFocus = useEffectEvent(() => returnFocusTo?.() ?? null)
  const initialFocus = useEffectEvent(() =>
    (variant === 'danger' ? cancelRef : confirmRef).current?.focus(),
  )

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!busy) onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    )
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
    initialFocus()
    const dialog = dialogRef.current
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    dialog?.addEventListener('keydown', listener)
    return () => {
      dialog?.removeEventListener('keydown', listener)
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
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        className="flex max-h-[calc(100vh_-_2_*_var(--space-4))] w-full max-w-[480px] flex-col gap-space-4 overflow-y-auto rounded-lg bg-neutral-0 p-space-5 shadow-card"
      >
        <h2
          id={titleId}
          className="font-display text-xl text-neutral-900 [overflow-wrap:anywhere]"
        >
          {title}
        </h2>
        <div
          id={descriptionId}
          className="flex flex-col gap-space-2 text-md text-neutral-900"
        >
          {children}
        </div>
        {error && (
          <p
            role="alert"
            className="flex items-start gap-space-2 font-semibold text-danger"
          >
            <Icon
              name="triangle-alert"
              className="mt-space-1 size-[16px] flex-none"
            />
            {error}
          </p>
        )}
        <p role="status" className="sr-only">
          {busy ? busyText : ''}
        </p>
        <div className="flex flex-wrap justify-end gap-space-3">
          <Button
            ref={cancelRef}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onCancel()
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={variant}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onConfirm()
            }}
          >
            {busy ? busyText : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
