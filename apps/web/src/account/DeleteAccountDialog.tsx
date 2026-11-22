import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button.tsx'
import { Modal } from '../components/ui/Modal.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import { privacyLinkProps } from '../routes/text-page-origin.ts'
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

/**
 * Diálogo modal de confirmación y progreso de la eliminación de la cuenta.
 *
 * El patrón de diálogo modal es el de la base común (Modal): el foco entra al
 * abrirlo (en el campo de confirmación), queda atrapado dentro con Tab y
 * Mayús+Tab y vuelve al botón que lo abrió al cerrarlo. Escape cancela, salvo
 * mientras se está eliminando. El resto de la página queda inerte, así que no
 * se puede salir por la navegación de la app a mitad de la eliminación.
 */
export function DeleteAccountDialog({
  state,
  online,
  onConfirm,
  onClose,
}: DeleteAccountDialogProps) {
  const descriptionId = useId()
  const offlineId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLInputElement>(null)
  const [word, setWord] = useState('')
  const running = state.status === 'running'
  const failed = state.status === 'failed'

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

  const confirmed = isConfirmationWord(word)
  const canConfirm = confirmed && online && !running

  return (
    <Modal
      title={DIALOG_TEXT.title}
      describedBy={descriptionId}
      initialFocus={() => fieldRef.current?.focus()}
      onCancel={() => {
        // Sin aria-busy mientras se elimina: el lector de pantalla tiene que
        // anunciar cada paso en la región de estado.
        if (!running) onClose()
      }}
      panelRef={dialogRef}
      overlayClassName="fixed inset-[0] z-50 flex items-end justify-center bg-neutral-900/50 p-space-3 sm:items-center"
      panelClassName="flex max-h-full w-full max-w-lg flex-col gap-space-3 overflow-y-auto rounded-lg bg-neutral-0 p-space-4 text-neutral-900 shadow-card"
      titleClassName="font-display text-xl font-semibold"
    >
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
        {failed && state.reason === 'not-allowed' && (
          <p className="text-md">
            <Link
              {...privacyLinkProps('cuenta')}
              className="font-semibold text-secondary underline"
            >
              Ver la página de privacidad
            </Link>
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
          <p className="text-sm text-neutral-700">{DIALOG_TEXT.leaveWarning}</p>
        )}
      </form>
    </Modal>
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
