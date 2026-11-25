import type { ReactNode } from 'react'
import { Modal } from '../components/ui/Modal.tsx'
import { backofficeClassNames } from './confirm.ts'

// Diálogo modal del backoffice: la base común (Modal, el patrón de diálogo
// modal de WAI-ARIA APG con el foco atrapado, Escape, el foco devuelto y el
// resto de la página inerte) con el aspecto del backoffice, para la fusión de
// especies (SpeciesMergeDialog) y los diálogos de la cola de propuestas. Las
// confirmaciones usan el ConfirmDialog de la app con BACKOFFICE_CONFIRM
// (confirm.ts).

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

export function ModalDialog({
  widthClassName = 'max-w-[480px]',
  ...props
}: ModalDialogProps) {
  return <Modal {...props} {...backofficeClassNames(widthClassName)} />
}
