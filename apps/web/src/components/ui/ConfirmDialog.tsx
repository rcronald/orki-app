import { useId, useRef, type ReactNode } from 'react'
import { Button } from './Button.tsx'
import { Icon } from './Icon.tsx'
import { Modal, type ModalProps } from './Modal.tsx'
import { tabbableIn } from './tabbable.ts'

export interface ConfirmDialogProps {
  /** Título (el nombre accesible del diálogo). */
  title: string
  /** Qué pasará y a qué afecta; es la descripción accesible del diálogo. */
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
  /**
   * Anunciar `busyLabel` mientras dura la acción, en una región role="status"
   * solo para el lector (el backoffice).
   */
  announceBusy?: boolean
  /** Confirmar no se puede ahora (por ejemplo, sin conexión). */
  confirmDisabled?: boolean
  /** Id de lo que explica por qué no se puede confirmar. */
  confirmDescribedBy?: string
  /** Error de la última confirmación, dentro del diálogo (role="alert"). */
  error?: string | null
  /**
   * Qué recibe el foco al abrir: el primer control del contenido (por
   * defecto, si lo hay; si no, "Cancelar"), "Cancelar" o la acción. Para lo
   * destructivo, cancel: la acción segura queda a mano de Enter.
   */
  initialFocus?: 'content' | 'cancel' | 'confirm'
  /** alertdialog para las confirmaciones que interrumpen (el backoffice). */
  role?: 'dialog' | 'alertdialog'
  /**
   * Dónde poner el foco al cerrarse en lugar de donde estaba; si devuelve
   * null, vuelve a donde estaba (si sigue en la página).
   */
  returnFocusTo?: () => HTMLElement | null
  /** Otro aspecto para la capa, la caja y el título (el del backoffice). */
  classNames?: Pick<
    ModalProps,
    'overlayClassName' | 'panelClassName' | 'titleClassName'
  >
  onConfirm: () => void
  onCancel: () => void
}

/**
 * El diálogo de confirmación de toda la app, modal (#16; uno solo desde el
 * #338, también para el backoffice). Se monta abierto (quien lo usa decide
 * cuándo pintarlo). El foco atrapado, Escape, el foco devuelto al cerrar y el
 * resto de la página inerte son los de la base común (Modal). Mientras está
 * ocupado (`busy`) no se cierra ni se vuelve a confirmar; el error de la
 * última confirmación va dentro, con role="alert".
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
  announceBusy = false,
  confirmDisabled = false,
  confirmDescribedBy,
  error = null,
  initialFocus = 'content',
  role = 'dialog',
  returnFocusTo,
  classNames,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const descriptionId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  const blocked = busy || confirmDisabled

  return (
    <Modal
      {...classNames}
      role={role}
      title={title}
      describedBy={descriptionId}
      busy={busy}
      initialFocus={() => {
        if (initialFocus === 'confirm') {
          confirmRef.current?.focus()
          return
        }
        const first =
          initialFocus === 'content' && contentRef.current
            ? tabbableIn(contentRef.current)[0]
            : undefined
        ;(first ?? cancelRef.current)?.focus()
      }}
      onCancel={onCancel}
      returnFocusTo={returnFocusTo}
    >
      <div
        id={descriptionId}
        className="flex flex-col gap-space-2 text-md text-neutral-900"
      >
        {description}
      </div>
      {children && (
        <div ref={contentRef} className="flex flex-col gap-space-3">
          {children}
        </div>
      )}
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
      {announceBusy && (
        <p role="status" className="sr-only">
          {busy ? busyLabel : ''}
        </p>
      )}
      {/* El mismo orden en todos los diálogos (#290): en el celular, uno
          sobre otro y a todo el ancho, la confirmación arriba; desde 640 px,
          en fila con la confirmación a la derecha. Antes, con wrap-reverse,
          dependía del largo del texto. */}
      <div className="flex flex-col-reverse gap-space-3 sm:flex-row sm:justify-end">
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
          ref={confirmRef}
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
    </Modal>
  )
}
