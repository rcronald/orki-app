import { useId, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ActionList, ActionRow } from '../components/ui/ActionRow.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Panel } from '../components/ui/Panel.tsx'
import {
  clearAccountDeletionMarker,
  isAccountDeletionPending,
  subscribeToAccountDeletionMarker,
} from '../lib/account-deletion-marker.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { privacyLinkProps } from '../routes/text-page-origin.ts'
import { DeleteAccountDialog } from './DeleteAccountDialog.tsx'
import type { AccountDeletionEffects } from './deletion.ts'
import type { AccountDeletionDevice } from './device-cleanup.ts'
import { ACCOUNT_TEXT } from './texts.ts'
import { useAccountDeletion } from './useAccountDeletion.ts'

export interface AccountViewProps {
  userId: string
  /** user.deleteSelfEnabled de Clerk. */
  canDeleteAccount: boolean
  /**
   * Si Clerk ya trajo al usuario. Sin él (Clerk aún carga), la eliminación
   * queda deshabilitada con «Cargando tu cuenta…». Por defecto, sí.
   */
  accountReady?: boolean
  effects: AccountDeletionEffects
  /** Con la cuenta eliminada: cerrar la sesión e ir al inicio. */
  onDeleted: () => Promise<void> | void
  /** La persona abandona una eliminación a medias y sigue usando Orki. */
  onKeepUsing?: () => void
  /** Lo que se hace en el dispositivo; por defecto, el de la app. */
  device?: AccountDeletionDevice
  /** Contenido del panel «Perfil» (ProfileSummary con «Editar perfil»). */
  profile?: ReactNode
  /**
   * Fila «Exportar tu colección a CSV» (un ActionRow) del panel «Datos y
   * privacidad», con lo que haga falta debajo (el resultado en una región de
   * estado). Sin ella, el panel solo lleva el aviso de privacidad.
   */
  exportRow?: ReactNode
  /** Lo que va bajo la lista de «Datos y privacidad»: el resultado de exportar. */
  dataFooter?: ReactNode
  /** «Cerrar sesión», fuera del panel de peligro. Sin él, no se muestra. */
  onSignOut?: () => void
  /** Nivel de los títulos de los paneles: 2 en la app, 3 en la muestra. */
  headingLevel?: 2 | 3
}

/**
 * Contenido de la pantalla de cuenta (#110, rediseño del #214), sin Clerk ni
 * Supabase: los datos y los efectos llegan por props. Tres paneles (Perfil,
 * Datos y privacidad, y Eliminar cuenta, en tono de peligro) y «Cerrar
 * sesión» debajo. AccountPage la conecta; la página de muestra la pinta con
 * efectos simulados.
 */
export function AccountView({
  userId,
  canDeleteAccount,
  accountReady = true,
  effects,
  onDeleted,
  onKeepUsing,
  device,
  profile,
  exportRow,
  dataFooter,
  onSignOut,
  headingLevel = 2,
}: AccountViewProps) {
  // Solo lectura (#120): sin conexión, o con la sesión sin confirmar.
  const readOnly = useReadOnly()
  const online = readOnly === null
  const [open, setOpen] = useState(false)
  const deletion = useAccountDeletion({
    userId,
    effects,
    canDeleteAccount,
    onDeleted,
    device,
  })
  const pending = useSyncExternalStore(
    subscribeToAccountDeletionMarker,
    () => isAccountDeletionPending(userId),
    () => false,
  )
  const reasonId = useId()
  const pendingHeadingId = useId()
  const privacy = privacyLinkProps('cuenta')

  const reason =
    readOnly === 'offline'
      ? ACCOUNT_TEXT.offline
      : readOnly === 'unverified'
        ? ACCOUNT_TEXT.unverified
        : !accountReady
          ? ACCOUNT_TEXT.loadingAccount
          : !canDeleteAccount
            ? ACCOUNT_TEXT.notAllowed
            : null

  function close() {
    deletion.reset()
    setOpen(false)
  }

  return (
    <>
      <Panel title={ACCOUNT_TEXT.profileHeading} headingLevel={headingLevel}>
        {profile}
      </Panel>

      <Panel title={ACCOUNT_TEXT.dataHeading} headingLevel={headingLevel}>
        <div className="flex flex-col gap-space-2">
          {/* Una fila deshabilitada (aria-disabled) se ve atenuada, con el
              motivo en lugar del texto secundario: lo ponen orki-action y
              ActionRow. */}
          <ActionList>
            {exportRow != null && <li>{exportRow}</li>}
            <li>
              <ActionRow
                icon="shield"
                title={ACCOUNT_TEXT.privacyTitle}
                description={ACCOUNT_TEXT.privacyDescription}
                to={privacy.to}
                state={privacy.state}
              />
            </li>
          </ActionList>
          {dataFooter}
        </div>
      </Panel>

      <Panel
        title={ACCOUNT_TEXT.deleteHeading}
        headingLevel={headingLevel}
        tone="danger"
      >
        <p className="orki-panel__text">{ACCOUNT_TEXT.deleteSummary}</p>

        {/* Mientras el diálogo está abierto, la marca ya está puesta: se
            sigue mostrando el mismo botón (con otro texto) para que el foco
            pueda volver a él al cerrar. */}
        {pending && !open && (
          <section
            aria-labelledby={pendingHeadingId}
            className="flex flex-col gap-space-2 rounded-md border border-danger bg-neutral-0 p-space-3"
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
          <p id={reasonId} className="orki-panel__text text-neutral-700">
            {reason}
          </p>
        )}
        <Button
          variant="danger-outline"
          className="self-start publico-estrecho:self-stretch"
          disabled={reason !== null}
          aria-describedby={reason ? reasonId : undefined}
          onClick={() => setOpen(true)}
        >
          {pending && !open
            ? ACCOUNT_TEXT.pendingContinue
            : ACCOUNT_TEXT.deleteButton}
        </Button>
      </Panel>

      {onSignOut && (
        <p>
          <button
            type="button"
            className="orki-link min-h-[44px] cursor-pointer"
            onClick={onSignOut}
          >
            {ACCOUNT_TEXT.signOut}
          </button>
        </p>
      )}

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
