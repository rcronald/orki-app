import { useClerk, useReverification, useUser } from '@clerk/react'
import { useCallback, useMemo } from 'react'
import { AccountView } from '../account/AccountView.tsx'
import { deleteClerkAccount } from '../account/clerk-deletion.ts'
import type { AccountDeletionEffects } from '../account/deletion.ts'
import { setAccountDeletionPhase } from '../account/deletion-status.ts'
import { appAccountDataEffects } from '../account/supabase-effects.ts'
import { ACCOUNT_TEXT } from '../account/texts.ts'
import { useProfileEditor } from '../auth/profile-editor.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { Button } from '../components/ui/Button.tsx'
import { Page } from '../components/Page.tsx'
import { ensureProfile, forgetEnsuredProfile } from '../lib/profile.ts'

type DataEffects = Omit<AccountDeletionEffects, 'deleteAccount'>

interface AccountPageProps {
  /** Solo para pruebas: pasos de datos sin Supabase. */
  dataEffects?: DataEffects
}

/**
 * Pantalla de cuenta (/cuenta, #110). Va dentro de RequireAuth, así que aquí
 * ya hay sesión. Conecta AccountView con Clerk (correo, permiso y borrado de
 * la cuenta) y con Supabase (fotos, plantas y perfil).
 *
 * La eliminación de la cuenta de Clerk va envuelta en useReverification():
 * Clerk pide por defecto volver a verificar la identidad para eliminar la
 * cuenta y abre su propia ventana (ver account/clerk-deletion.ts).
 *
 * Con la sesión sin confirmar (#120: sin Clerk, con el último usuario
 * recordado), RequireAuth deja entrar, pero Clerk no tiene usuario: la
 * pantalla explica que eliminar la cuenta necesita la sesión confirmada, en
 * lugar de quedarse cargando.
 */
export function AccountPage({ dataEffects }: AccountPageProps) {
  const { user } = useUser()
  const { setActive } = useClerk()
  const readOnly = useReadOnly()
  // El menú de Clerk ya no está en la barra (#207): el editor de perfil se
  // abre desde aquí hasta el rediseño de esta pantalla (#214).
  const profileEditor = useProfileEditor()
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

  if (!user && readOnly === 'unverified') {
    return (
      <Page title={ACCOUNT_TEXT.title}>
        <p role="status" className="text-md">
          {ACCOUNT_TEXT.unverified}
        </p>
      </Page>
    )
  }

  if (!user) {
    return (
      <Page title={ACCOUNT_TEXT.title}>
        <p role="status" className="text-md text-neutral-700">
          Cargando tu cuenta…
        </p>
      </Page>
    )
  }

  return (
    <Page title={ACCOUNT_TEXT.title}>
      <AccountView
        userId={user.id}
        email={user.primaryEmailAddress?.emailAddress ?? null}
        canDeleteAccount={user.deleteSelfEnabled}
        effects={effects}
        onDeleted={onDeleted}
        profileAction={
          <Button
            className="self-start"
            disabled={!profileEditor.available}
            onClick={profileEditor.open}
          >
            {ACCOUNT_TEXT.editProfile}
          </Button>
        }
        onKeepUsing={() => {
          forgetEnsuredProfile(user.id)
          void ensureProfile(user.id)
        }}
      />
    </Page>
  )
}
