import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../components/ui/Button.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import { DELETION_STEPS, type DeletionStep } from './deletion.ts'
import {
  DIALOG_TEXT,
  failureText,
  isConfirmationWord,
  runningText,
  STEP_LABEL,
  STEP_STATE_TEXT,
  type StepState,
} from './texts.ts'
import type { AccountDeletionState } from './useAccountDeletion.ts'

interface DeleteAccountDialogProps {
  state: AccountDeletionState
  /** Sin conexión: el botón de eliminar queda deshabilitado con el motivo. */
  online: boolean
  /** Empezar la eliminación, o reintentarla tras un fallo. */
  onConfirm: () => void
  /** Cerrar (Cancelar, Escape o Cerrar tras un fallo). */
  onClose: () => void
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo modal de confirmación y progreso de la eliminación de la cuenta.
 *
 * Patrón de diálogo modal de WAI-ARIA (role="dialog", aria-modal): el foco
 * entra al abrirlo (en el campo de confirmación), queda atrapado dentro con
 * Tab y Mayús+Tab y vuelve al botón que lo abrió al cerrarlo. Escape cancela,
 * salvo mientras se está eliminando. El resto de la página queda inerte
 * (atributo inert), así que no se puede salir por la navegación de la app a
 * mitad de la eliminación. No se usa <dialog> con showModal() porque jsdom no
 * lo implementa y las pruebas no podrían cubrirlo.
 */
export function DeleteAccountDialog({
  state,
  online,
  onConfirm,
  onClose,
}: DeleteAccountDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const offlineId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLInputElement>(null)
  const [word, setWord] = useState('')
  const running = state.status === 'running'
  const failed = state.status === 'failed'

  // Foco inicial y devolución del foco al cerrar.
  useLayoutEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    fieldRef.current?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  // El resto de la página, inerte mientras el diálogo está abierto.
  useLayoutEffect(() => {
    const container = dialogRef.current?.parentElement
    if (!container) return
    const siblings = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element !== container &&
        !element.hasAttribute('inert'),
    )
    // El atributo (no la propiedad), que también entiende jsdom.
    for (const element of siblings) element.setAttribute('inert', '')
    return () => {
      for (const element of siblings) element.removeAttribute('inert')
    }
  }, [])

  // Si el foco se queda sin destino (el botón pulsado desaparece al empezar o
  // al fallar), vuelve al diálogo.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus()
  }, [state.status])

  // Salir de la página (recargar, cerrar la pestaña) a mitad: aviso del
  // navegador.
  useEffect(() => {
    if (!running) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  // Teclado del patrón de diálogo: Escape y foco atrapado con Tab.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (!running) onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
      )
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog)
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => dialog.removeEventListener('keydown', onKeyDown)
  }, [running, onClose])

  const confirmed = isConfirmationWord(word)
  const canConfirm = confirmed && online && !running

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/50 p-space-3 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-lg flex-col gap-space-3 overflow-y-auto rounded-lg bg-neutral-0 p-space-4 text-neutral-900 shadow-card"
      >
        <h2 id={titleId} className="font-display text-xl font-semibold">
          {DIALOG_TEXT.title}
        </h2>
        <div id={descriptionId} className="flex flex-col gap-space-2">
          <p className="text-md">{DIALOG_TEXT.intro}</p>
          <ul className="list-disc pl-space-4 text-md">
            {DIALOG_TEXT.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-md font-semibold">{DIALOG_TEXT.irreversible}</p>
        </div>

        <form
          className="flex flex-col gap-space-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (canConfirm) onConfirm()
          }}
        >
          <TextField
            ref={fieldRef}
            label={DIALOG_TEXT.confirmLabel}
            hint={DIALOG_TEXT.confirmHint}
            value={word}
            onChange={(event) => setWord(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            readOnly={running}
          />

          {state.status !== 'idle' && <Progress state={state} />}
          {/* Siempre montada, para que el lector de pantalla anuncie cada paso. */}
          <p role="status" className="text-md">
            {announcementOf(state)}
          </p>

          {failed && (
            <p
              role="alert"
              className="rounded-md bg-danger-soft p-space-3 text-md"
            >
              {failureText(state.step, state.reason)}
            </p>
          )}

          {!online && (
            <p id={offlineId} className="text-md text-neutral-700">
              Sin conexión: para eliminar la cuenta hace falta conexión.
            </p>
          )}

          <div className="flex flex-wrap gap-space-2">
            <Button
              type="submit"
              variant="danger"
              disabled={!canConfirm}
              aria-describedby={online ? undefined : offlineId}
            >
              {failed ? DIALOG_TEXT.retry : DIALOG_TEXT.confirm}
            </Button>
            {!running && (
              <Button onClick={onClose}>
                {failed ? DIALOG_TEXT.close : DIALOG_TEXT.cancel}
              </Button>
            )}
          </div>
          {running && (
            <p className="text-sm text-neutral-700">
              {DIALOG_TEXT.leaveWarning}
            </p>
          )}
        </form>
      </div>
    </div>,
    document.body,
  )
}

function stepState(step: DeletionStep, state: AccountDeletionState): StepState {
  if (state.status === 'done') return 'done'
  if (state.status === 'idle') return 'pending'
  if (state.done.includes(step)) return 'done'
  if (state.status === 'running' && state.current === step) return 'running'
  if (state.status === 'failed' && state.step === step) return 'failed'
  return 'pending'
}

function announcementOf(state: AccountDeletionState): string {
  if (state.status === 'running') return runningText(state.current)
  if (state.status === 'done') return 'Cuenta eliminada.'
  return ''
}

/** Lista de pasos con su estado. */
function Progress({ state }: { state: AccountDeletionState }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-space-2">
      <h3 id={headingId} className="text-md font-semibold">
        {DIALOG_TEXT.progressHeading}
      </h3>
      <ol className="flex flex-col gap-space-1 text-md">
        {DELETION_STEPS.map((step) => {
          const current = stepState(step, state)
          return (
            <li key={step} className="flex justify-between gap-space-2">
              <span>{STEP_LABEL[step]}</span>
              <span
                className={
                  current === 'failed'
                    ? 'font-semibold text-danger'
                    : current === 'done'
                      ? 'font-semibold'
                      : 'text-neutral-700'
                }
              >
                {STEP_STATE_TEXT[current]}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
