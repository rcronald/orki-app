import { useId, useRef, type ReactNode } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ModalDialog } from './ModalDialog.tsx'

// Diálogo de confirmación del backoffice, propio porque la app no tenía
// ninguno y window.confirm no sirve para explicar a qué afecta un cambio.
// Es un ModalDialog (patrón de diálogo modal de WAI-ARIA APG) con:
// - role="alertdialog" (las confirmaciones interrumpen) y la explicación en
//   aria-describedby.
// - Al abrirse, el foco va al botón menos peligroso: "Cancelar" si la acción
//   destruye algo, la acción si no. Tab y Mayús+Tab no salen del diálogo.
// - Escape y "Cancelar" lo cierran sin hacer nada (salvo mientras se guarda).
// - Al cerrarse, el foco vuelve a donde estaba antes de abrirlo, o a
//   al que diga `returnFocusTo` si devuelve uno.

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
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  return (
    <ModalDialog
      role="alertdialog"
      title={title}
      describedBy={descriptionId}
      busy={busy}
      initialFocus={() =>
        (variant === 'danger' ? cancelRef : confirmRef).current?.focus()
      }
      onCancel={onCancel}
      returnFocusTo={returnFocusTo}
    >
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
    </ModalDialog>
  )
}
