import { useClerk, useReverification, useUser } from '@clerk/react'
import { useCallback, useMemo } from 'react'
import { AccountView } from '../account/AccountView.tsx'
import { deleteClerkAccount } from '../account/clerk-deletion.ts'
import type { AccountDeletionEffects } from '../account/deletion.ts'
import { setAccountDeletionPhase } from '../account/deletion-status.ts'
import { appAccountDataEffects } from '../account/supabase-effects.ts'
import { ACCOUNT_TEXT } from '../account/texts.ts'
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
 */
export function AccountPage({ dataEffects }: AccountPageProps) {
  const { user } = useUser()
  const { setActive } = useClerk()
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
  // cliente. Si ya no existía, no pasa nada. Después, AccountDeletionGate
  // lleva al inicio con el aviso.
  const onDeleted = useCallback(async () => {
    try {
      await setActive({ session: null })
    } catch {
      // La sesión ya no existe en Clerk: el cliente la quita solo.
    }
    setAccountDeletionPhase('done')
  }, [setActive])

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
        onKeepUsing={() => {
          forgetEnsuredProfile(user.id)
          void ensureProfile(user.id)
        }}
      />
    </Page>
  )
}
