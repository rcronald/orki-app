import {
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { tabbableIn } from './tabbable.ts'

export interface ModalProps {
  /** alertdialog para las confirmaciones que interrumpen; dialog para lo demás. */
  role?: 'dialog' | 'alertdialog'
  /** Título: el nombre accesible del diálogo (aria-labelledby). */
  title: ReactNode
  /** id del contenido que explica el diálogo (aria-describedby). */
  describedBy?: string
  /** Mientras se guarda: Escape no lo cierra y se marca aria-busy. */
  busy?: boolean
  /**
   * Pone el foco al abrirse. Si no se indica, va al primer control del
   * diálogo o, si no hay ninguno, al diálogo mismo.
   */
  initialFocus?: () => void
  /** Escape (salvo mientras está ocupado). */
  onCancel: () => void
  /**
   * Dónde poner el foco al cerrarse en lugar de donde estaba (por ejemplo,
   * tras quitar el elemento que lo abrió); si devuelve null, vuelve a donde
   * estaba, si sigue en la página.
   */
  returnFocusTo?: () => HTMLElement | null
  /** Clases de la capa que cubre la pantalla. */
  overlayClassName?: string
  /** Clases de la caja del diálogo. */
  panelClassName?: string
  /** Clases del título (un h2). */
  titleClassName?: string
  /** La caja del diálogo, para quien necesite llevarle el foco. */
  panelRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}

/**
 * Base de todos los diálogos modales de la app (#151): la de confirmación
 * del sistema (ConfirmDialog), la del backoffice (ModalDialog) y la de
 * eliminar la cuenta. Sigue el patrón de diálogo modal de WAI-ARIA APG:
 *
 * - role="dialog" o "alertdialog" con aria-modal, el título en
 *   aria-labelledby y, si se indica, la explicación en aria-describedby.
 * - Se pinta en document.body, sobre una capa que cubre la pantalla, y el
 *   resto de la página queda inerte (`inert`): ni el ratón, ni el tabulador,
 *   ni el lector de pantalla llegan detrás.
 * - Al abrirse, el foco entra (ver `initialFocus`). Tab y Mayús+Tab dan la
 *   vuelta dentro, también si el foco se quedó sin destino (en el body,
 *   porque el botón pulsado desapareció).
 * - Escape lo cierra (salvo mientras está ocupado), si no lo usó antes un
 *   control de dentro: Escape primero cierra la lista de un buscador o borra
 *   su texto (el control llama a preventDefault).
 * - Al cerrarse, el foco vuelve a donde estaba antes de abrirlo, o al que
 *   diga `returnFocusTo`.
 *
 * Se pueden abrir uno encima de otro (una confirmación dentro de un
 * formulario en diálogo): el de abajo queda inerte y solo responde al
 * teclado el de arriba. El teclado se escucha en document, después de que
 * React haya pasado el evento por los controles del diálogo: así se sabe si
 * alguno ya usó el Escape.
 *
 * No usa <dialog> con showModal(): jsdom no lo tiene y el foco atrapado y
 * devuelto se comporta distinto según el navegador; así es igual en todos.
 */
export function Modal({
  role = 'dialog',
  title,
  describedBy,
  busy = false,
  initialFocus,
  onCancel,
  returnFocusTo,
  overlayClassName = 'fixed inset-[0] z-50 flex items-end justify-center bg-neutral-900/40 p-space-4 sm:items-center',
  panelClassName = 'flex max-h-full w-full max-w-md flex-col gap-space-4 overflow-y-auto rounded-lg bg-neutral-0 p-space-5 pb-[calc(var(--space-5)_+_env(safe-area-inset-bottom))] shadow-card',
  titleClassName = 'font-display text-lg font-semibold text-neutral-900',
  panelRef,
  children,
}: ModalProps) {
  const titleId = useId()
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const focusFirst = useEffectEvent(() => {
    if (initialFocus) {
      initialFocus()
      return
    }
    const dialog = dialogRef.current
    if (dialog) (tabbableIn(dialog)[0] ?? dialog).focus()
  })
  const fallbackFocus = useEffectEvent(() => returnFocusTo?.() ?? null)

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const dialog = dialogRef.current
    // Solo el de arriba: el que tiene otro diálogo encima está inerte.
    if (dialog === null || dialog.closest('[inert]') !== null) return
    if (event.key === 'Escape') {
      if (event.defaultPrevented) return
      event.preventDefault()
      if (!busy) onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = tabbableIn(dialog)
    const first = focusable.at(0)
    const last = focusable.at(-1)
    if (!first || !last) {
      event.preventDefault()
      dialog.focus()
      return
    }
    // En la caja misma o fuera (en el body) cuenta como fuera: Tab va al
    // primero y Mayús+Tab al último.
    const active = document.activeElement
    const inside = active !== dialog && dialog.contains(active)
    if (
      event.shiftKey ? !inside || active === first : !inside || active === last
    ) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  })

  // Al abrir: lo de detrás inerte, el foco dentro y el teclado escuchado. Al
  // cerrar, en orden inverso: primero se quita el inert (en un elemento
  // inerte no se puede poner el foco) y luego vuelve el foco. En el momento,
  // no en una tarea aparte: en desarrollo, StrictMode monta, desmonta y
  // vuelve a montar el diálogo, y un foco diferido llegaría después del del
  // segundo montaje y lo sacaría del diálogo.
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    // Los que ya estaban inertes (otro diálogo abierto debajo) se dejan como
    // están: los suelta quien los marcó. Se usa el atributo (no la
    // propiedad), que también entiende jsdom.
    const others = Array.from(document.body.children).filter(
      (element) => element !== overlay && !element.hasAttribute('inert'),
    )
    for (const element of others) element.setAttribute('inert', '')
    focusFirst()
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    document.addEventListener('keydown', listener)
    return () => {
      document.removeEventListener('keydown', listener)
      for (const element of others) element.removeAttribute('inert')
      const target =
        fallbackFocus() ?? (previous && previous.isConnected ? previous : null)
      target?.focus()
    }
  }, [])

  return createPortal(
    <div ref={overlayRef} className={overlayClassName}>
      <div
        ref={(node) => {
          dialogRef.current = node
          if (panelRef) panelRef.current = node
        }}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={`${panelClassName} outline-none`}
      >
        <h2 id={titleId} className={titleClassName}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
