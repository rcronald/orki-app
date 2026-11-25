import { useClerk, useReverification, useUser } from '@clerk/react'
import { useCallback, useId, useMemo } from 'react'
import { Link } from 'react-router'
import { AccountView } from '../account/AccountView.tsx'
import { deleteClerkAccount } from '../account/clerk-deletion.ts'
import type { AccountDeletionEffects } from '../account/deletion.ts'
import { setAccountDeletionPhase } from '../account/deletion-status.ts'
import { appAccountDataEffects } from '../account/supabase-effects.ts'
import { ACCOUNT_TEXT } from '../account/texts.ts'
import { useProfileEditor } from '../auth/profile-editor.ts'
import { identityUserId, useAppIdentity } from '../auth/useAppIdentity.ts'
import { useSignOutHere } from '../auth/useSignOutHere.ts'
import { COLLECTION_ERROR_TEXT } from '../collection/source.ts'
import { useCollection } from '../collection/useCollection.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { ActionRow } from '../components/ui/ActionRow.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ProfileSummary } from '../components/ui/ProfileSummary.tsx'
import { Page } from '../components/Page.tsx'
import { useInventoryExport } from '../inventory/useInventoryExport.ts'
import { ensureProfile, forgetEnsuredProfile } from '../lib/profile.ts'
import { PATHS } from '../routes/paths.ts'

type DataEffects = Omit<AccountDeletionEffects, 'deleteAccount'>

interface AccountPageProps {
  /** Solo para pruebas: pasos de datos sin Supabase. */
  dataEffects?: DataEffects
}

/**
 * Pantalla «Tu cuenta» (/cuenta, #110; rediseño del #214). Va dentro de
 * RequireAuth, así que aquí ya hay sesión (confirmada o recordada). Conecta
 * AccountView con Clerk (perfil, editor, permiso y borrado de la cuenta), con
 * la colección (exportar a CSV, la misma de «Mi colección») y con Supabase
 * (fotos, plantas y perfil).
 *
 * La eliminación de la cuenta de Clerk va envuelta en useReverification():
 * Clerk pide por defecto volver a verificar la identidad para eliminar la
 * cuenta y abre su propia ventana (ver account/clerk-deletion.ts).
 *
 * Sin conexión o con la sesión sin confirmar (#120: sin Clerk, con el último
 * usuario recordado), la pantalla se abre igual: el perfil queda en un estado
 * neutro con la explicación, «Editar perfil» y la eliminación deshabilitados
 * con su motivo, y exportar (con la copia local), la privacidad y cerrar
 * sesión siguen funcionando.
 */
export function AccountPage({ dataEffects }: AccountPageProps) {
  const { user } = useUser()
  const { setActive } = useClerk()
  const identity = useAppIdentity()
  const signOut = useSignOutHere()
  const deleteUser = useReverification(async () => {
    if (!user) throw new Error('No hay usuario con sesión.')
    await user.delete()
  })

  const effects = useMemo<AccountDeletionEffects>(
    () => ({
      ...(dataEffects ?? appAccountDataEffects()),
      deleteAccount: () => deleteClerkAccount(deleteUser),
    }),
    [dataEffects, deleteUser],
  )

  // Como el <UserProfile> de Clerk: tras eliminar, se cierra la sesión del
  // cliente. Si ya no existía, no pasa nada. Antes, la eliminación ya cerró la
  // sesión de la app (account/device-cleanup.ts, markSignedOut). Después,
  // AccountDeletionGate lleva al inicio con el aviso.
  const onDeleted = useCallback(async () => {
    try {
      await setActive({ session: null })
    } catch {
      // La sesión ya no existe en Clerk: el cliente la quita solo.
    }
    setAccountDeletionPhase('done')
  }, [setActive])

  const userId = user?.id ?? identityUserId(identity)
  const exportData = useAccountExport()

  return (
    <Page
      title={ACCOUNT_TEXT.title}
      width="medium"
      header={{
        art: false,
        back: (
          <Link to={PATHS.collection} className="orki-link orki-pagehead__back">
            <Icon name="arrow-left" />
            {ACCOUNT_TEXT.back}
          </Link>
        ),
      }}
    >
      <div className="mt-space-3 flex flex-col gap-space-5">
        {userId === null ? (
          // RequireAuth no deja llegar aquí sin usuario; por si acaso.
          <p role="status" className="text-md text-neutral-700">
            {ACCOUNT_TEXT.loadingAccount}
          </p>
        ) : (
          <AccountView
            userId={userId}
            canDeleteAccount={user?.deleteSelfEnabled ?? false}
            accountReady={user != null}
            effects={effects}
            onDeleted={onDeleted}
            profile={<AccountProfile />}
            exportRow={exportData.row}
            dataFooter={exportData.footer}
            onSignOut={signOut}
            onKeepUsing={() => {
              forgetEnsuredProfile(userId)
              void ensureProfile(userId)
            }}
          />
        )}
      </div>
    </Page>
  )
}

/**
 * Panel «Perfil»: foto, nombre y correo principal de Clerk, y «Editar perfil»
 * (el editor de Clerk, useProfileEditor). useUser() es reactivo: al cerrar el
 * editor, los datos nuevos se ven sin recargar. Sin usuario de Clerk (sin
 * conexión o con la sesión sin confirmar), el avatar neutro y la explicación,
 * que es también el motivo del botón deshabilitado.
 */
function AccountProfile() {
  const { user } = useUser()
  const editor = useProfileEditor()
  const readOnly = useReadOnly()
  const reasonId = useId()

  const explanation =
    user == null
      ? readOnly === null
        ? null
        : ACCOUNT_TEXT.profileUnavailable[readOnly]
      : readOnly === 'offline'
        ? ACCOUNT_TEXT.profileOffline
        : null

  return (
    <>
      <ProfileSummary
        name={user?.fullName}
        email={user?.primaryEmailAddress?.emailAddress}
        imageUrl={user?.hasImage ? user.imageUrl : null}
        action={
          <Button
            disabled={!editor.available}
            aria-describedby={explanation ? reasonId : undefined}
            onClick={editor.open}
          >
            {ACCOUNT_TEXT.editProfile}
          </Button>
        }
      />
      {user == null && readOnly === null && (
        <p role="status" className="orki-panel__text text-neutral-700">
          {ACCOUNT_TEXT.profileLoading}
        </p>
      )}
      {explanation && (
        <p id={reasonId} className="orki-panel__text text-neutral-700">
          {explanation}
        </p>
      )}
    </>
  )
}

/**
 * «Exportar tu colección a CSV» con la colección del usuario: la misma
 * exportación de «Mi colección» (useInventoryExport). Sin conexión usa la
 * copia local. Mientras carga, o si la lectura falla sin datos, la fila queda
 * deshabilitada con el motivo (y, tras un fallo, se ofrece volver a cargar).
 */
function useAccountExport() {
  const { status, plants, error, reload } = useCollection()
  const { exportCsv, message } = useInventoryExport(plants)
  const loadError = plants === null && status === 'error' ? error : null
  const failed = loadError !== null
  const disabledReason =
    plants !== null
      ? undefined
      : loadError !== null
        ? COLLECTION_ERROR_TEXT[loadError.reason]
        : ACCOUNT_TEXT.exportLoading

  const common = {
    icon: 'file',
    title: ACCOUNT_TEXT.exportTitle,
    description: ACCOUNT_TEXT.exportDescription,
  } as const
  const row =
    disabledReason === undefined ? (
      <ActionRow {...common} onClick={exportCsv} />
    ) : (
      <ActionRow {...common} disabledReason={disabledReason} />
    )

  return {
    row,
    footer: (
      <>
        {failed && (
          <Button className="self-start" onClick={reload}>
            {ACCOUNT_TEXT.exportRetry}
          </Button>
        )}
        {/* Siempre montada, para que se anuncie el resultado. Vacía, sin
            el hueco de la separación. */}
        <p
          role="status"
          className="text-sm text-neutral-700 empty:mt-[calc(var(--space-2)*-1)]"
        >
          {message}
        </p>
      </>
    ),
  }
}
