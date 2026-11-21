import { useId, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button.tsx'
import {
  clearAccountDeletionMarker,
  isAccountDeletionPending,
  subscribeToAccountDeletionMarker,
} from '../lib/account-deletion-marker.ts'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import { PATHS } from '../routes/paths.ts'
import { DeleteAccountDialog } from './DeleteAccountDialog.tsx'
import type { AccountDeletionEffects } from './deletion.ts'
import { ACCOUNT_TEXT } from './texts.ts'
import { useAccountDeletion } from './useAccountDeletion.ts'

export interface AccountViewProps {
  userId: string
  /** Correo principal según Clerk; null si la cuenta no tiene. */
  email: string | null
  /** user.deleteSelfEnabled de Clerk. */
  canDeleteAccount: boolean
  effects: AccountDeletionEffects
  /** Con la cuenta eliminada: cerrar la sesión e ir al inicio. */
  onDeleted: () => Promise<void> | void
  /** La persona abandona una eliminación a medias y sigue usando Orki. */
  onKeepUsing?: () => void
}

/**
 * Contenido de la pantalla de cuenta (#110), sin Clerk ni Supabase: los datos
 * y los efectos llegan por props. AccountPage la conecta; la página de
 * muestra la pinta con efectos simulados.
 */
export function AccountView({
  userId,
  email,
  canDeleteAccount,
  effects,
  onDeleted,
  onKeepUsing,
}: AccountViewProps) {
  const online = useOnlineStatus()
  const [open, setOpen] = useState(false)
  const deletion = useAccountDeletion({
    userId,
    effects,
    canDeleteAccount,
    onDeleted,
  })
  const pending = useSyncExternalStore(
    subscribeToAccountDeletionMarker,
    () => isAccountDeletionPending(userId),
    () => false,
  )
  const sessionHeadingId = useId()
  const deleteHeadingId = useId()
  const reasonId = useId()
  const pendingHeadingId = useId()

  const reason = !online
    ? ACCOUNT_TEXT.offline
    : !canDeleteAccount
      ? ACCOUNT_TEXT.notAllowed
      : null

  function close() {
    deletion.reset()
    setOpen(false)
  }

  return (
    <>
      <section
        aria-labelledby={sessionHeadingId}
        className="flex flex-col gap-space-2"
      >
        <h2 id={sessionHeadingId} className="text-lg font-semibold">
          {ACCOUNT_TEXT.sessionHeading}
        </h2>
        <dl className="flex flex-col gap-space-1 text-md">
          <dt className="font-semibold">{ACCOUNT_TEXT.emailLabel}</dt>
          <dd className="break-words">{email ?? ACCOUNT_TEXT.noEmail}</dd>
        </dl>
        <p className="text-sm text-neutral-700">{ACCOUNT_TEXT.manageHint}</p>
        <p className="text-sm">
          <Link
            to={PATHS.privacy}
            className="font-semibold text-secondary underline"
          >
            {ACCOUNT_TEXT.privacyLink}
          </Link>
        </p>
      </section>

      <section
        aria-labelledby={deleteHeadingId}
        className="mt-space-4 flex flex-col gap-space-3"
      >
        <h2 id={deleteHeadingId} className="text-lg font-semibold">
          {ACCOUNT_TEXT.deleteHeading}
        </h2>

        <p className="text-md">{ACCOUNT_TEXT.deleteIntro}</p>

        {/* Mientras el diálogo está abierto, la marca ya está puesta: se
            sigue mostrando el mismo botón (con otro texto) para que el foco
            pueda volver a él al cerrar. */}
        {pending && !open && (
          <section
            aria-labelledby={pendingHeadingId}
            className="flex flex-col gap-space-2 rounded-md bg-danger-soft p-space-3"
          >
            <h3 id={pendingHeadingId} className="text-md font-semibold">
              {ACCOUNT_TEXT.pendingHeading}
            </h3>
            <p className="text-md">{ACCOUNT_TEXT.pendingText}</p>
            <div>
              <Button
                onClick={() => {
                  clearAccountDeletionMarker(userId)
                  onKeepUsing?.()
                }}
              >
                {ACCOUNT_TEXT.pendingKeep}
              </Button>
            </div>
          </section>
        )}

        {reason && (
          <p id={reasonId} className="text-md text-neutral-700">
            {reason}
          </p>
        )}
        <div>
          <Button
            variant="danger"
            disabled={reason !== null}
            aria-describedby={reason ? reasonId : undefined}
            onClick={() => setOpen(true)}
          >
            {pending && !open
              ? ACCOUNT_TEXT.pendingContinue
              : ACCOUNT_TEXT.deleteButton}
          </Button>
        </div>
      </section>

      {open && (
        <DeleteAccountDialog
          state={deletion.state}
          online={online}
          onConfirm={() => void deletion.start()}
          onClose={close}
        />
      )}
    </>
  )
}
