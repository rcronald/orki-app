import { Navigate } from 'react-router'
import { AuthLoading } from '../auth/AuthStatus.tsx'
import { useOfflineIdentity } from '../auth/offline-identity.ts'
import { useAppIdentity } from '../auth/useAppIdentity.ts'
import { PublicShell } from '../components/PublicShell.tsx'
import { PATHS } from '../routes/paths.ts'
import { HomePage } from './HomePage.tsx'

/**
 * Qué se ve en `/` (#191). La portada solo tiene sentido sin sesión:
 *
 * - Con sesión (signed-in), o con la sesión recordada sin confirmar
 *   (unverified: sin conexión o sin Clerk, ver useAppIdentity), a «Mi
 *   colección», sin pintar la portada.
 * - Sin sesión (signed-out), o sin Clerk y sin nadie recordado (unavailable),
 *   la portada. También al llegar tras eliminar la cuenta, con su aviso.
 * - Mientras Clerk no ha dicho nada (loading):
 *   - si este dispositivo recuerda a alguien (orki-ultimo-usuario), lo más
 *     probable es que tenga sesión: la cabecera con solo el logotipo y
 *     «Cargando el acceso…», sin pintar la portada para quitarla un momento
 *     después. Si no hay red no se llega a esperar: el navegador lo dice y
 *     la identidad pasa enseguida a unverified (colección). Con red, Clerk
 *     responde o, a los 10 s, se da por no disponible y también pasa a
 *     unverified.
 *   - si no recuerda a nadie, lo normal es una visita nueva: la portada al
 *     momento, sin esperar a Clerk (es el primer pintado de la página). Si
 *     resultara tener sesión (por ejemplo, con el almacenamiento borrado),
 *     va a la colección en cuanto Clerk lo confirma.
 */
export function HomeRoute() {
  const identity = useAppIdentity()
  const { lastUserId } = useOfflineIdentity()

  switch (identity.kind) {
    case 'signed-in':
    case 'unverified':
      return <Navigate to={PATHS.collection} replace />
    case 'loading':
      if (lastUserId !== null) {
        return (
          <PublicShell actions={false}>
            <div className="flex flex-1 flex-col items-center px-space-4 pt-space-6">
              <AuthLoading />
            </div>
          </PublicShell>
        )
      }
      break
    case 'signed-out':
    case 'unavailable':
      break
  }
  return (
    <PublicShell>
      <HomePage />
    </PublicShell>
  )
}
