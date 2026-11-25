import { useId, useRef, type ReactNode } from 'react'
import { Button } from './Button.tsx'
import { Modal } from './Modal.tsx'
import { tabbableIn } from './tabbable.ts'

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

/**
 * Diálogo de confirmación del sistema, modal (#16). Se monta abierto (quien
 * lo usa decide cuándo pintarlo). El foco atrapado, Escape, el foco devuelto
 * al cerrar y el resto de la página inerte son los de la base común (Modal).
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
  const descriptionId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const blocked = busy || confirmDisabled

  return (
    <Modal
      title={title}
      describedBy={descriptionId}
      busy={busy}
      initialFocus={() => {
        const first =
          initialFocus === 'content' && contentRef.current
            ? tabbableIn(contentRef.current)[0]
            : undefined
        ;(first ?? cancelRef.current)?.focus()
      }}
      onCancel={onCancel}
    >
      <div id={descriptionId} className="text-md text-neutral-900">
        {description}
      </div>
      {children && (
        <div ref={contentRef} className="flex flex-col gap-space-3">
          {children}
        </div>
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
