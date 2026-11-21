import { isAccountDeletionPending } from './account-deletion-marker.ts'
import { getSupabase } from './supabase.ts'

// Creación del perfil en el primer ingreso (issue #66).
//
// Cada usuario de Clerk tiene una fila en public.profiles. No hay backend ni
// webhook de Clerk que la cree, así que la crea la app al ver una sesión
// iniciada (auth/ProfileBootstrap.tsx), con la política "Cada usuario crea su
// perfil" (with check: id = requesting_user_id()).
//
// La inserción es idempotente: upsert con ignoreDuplicates, que supabase-js
// envía como POST /profiles?on_conflict=id con
// "Prefer: resolution=ignore-duplicates" y que PostgREST traduce a
// "insert ... on conflict (id) do nothing". Si el perfil ya existe no da error,
// no lo modifica (el idioma elegido se conserva) y solo necesita el permiso de
// insert, no el de update. Sin .select(), la respuesta no trae filas.
//
// Se envía el id explícitamente (el userId de Clerk, que es el claim sub del
// token) en lugar de dejar que lo ponga el valor por defecto de la columna:
// - La columna del conflicto va en el cuerpo y la petición nunca es un objeto
//   vacío, cuyo manejo dependería de cómo PostgREST trate un insert sin
//   columnas.
// - No cambia la seguridad: la política exige id = sub del token, así que solo
//   se puede crear el perfil propio. Si por algún motivo no coincidieran (por
//   ejemplo, la petición salió con el token de otro usuario tras cambiar de
//   cuenta), la base la rechaza y se reintenta más tarde; nunca se crea un
//   perfil ajeno.
//
// Una vez por usuario y carga de la página: se recuerda la promesa de cada
// usuario. Mientras está en curso o si salió bien, las llamadas siguientes la
// reutilizan sin otra petición (así el doble montaje de React.StrictMode no
// duplica la inserción). Si falla, se olvida, y la siguiente llamada (otro
// ingreso, una recarga o la vuelta de la conexión) lo intenta de nuevo.
//
// Eliminación de la cuenta (#110): mientras hay una eliminación en curso
// (lib/account-deletion-marker.ts), no se crea el perfil ni se envía nada. Si
// no, entre el borrado del perfil y el de la cuenta de Clerk, una recarga o la
// vuelta de la conexión lo volverían a crear.

const attempts = new Map<string, Promise<boolean>>()

/**
 * Se asegura de que existe el perfil del usuario con sesión iniciada. Nunca
 * lanza: devuelve true si el perfil existe (creado ahora o antes) y false si
 * no se pudo comprobar (sin conexión, sin token, error de red o del servidor).
 */
export function ensureProfile(userId: string): Promise<boolean> {
  if (isAccountDeletionPending(userId)) return Promise.resolve(false)
  const previous = attempts.get(userId)
  if (previous !== undefined) return previous
  const attempt = insertProfile(userId).then((ok) => {
    if (!ok && attempts.get(userId) === attempt) attempts.delete(userId)
    return ok
  })
  attempts.set(userId, attempt)
  return attempt
}

async function insertProfile(userId: string): Promise<boolean> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true })
    if (error) {
      warn(error.message)
      return false
    }
    return true
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error))
    return false
  }
}

// Solo para quien depura: el usuario no ve nada y la app sigue funcionando.
function warn(detail: string) {
  console.warn(`No se pudo asegurar el perfil; se reintentará. (${detail})`)
}

/**
 * Olvida el intento recordado de un usuario, para que la siguiente llamada a
 * ensureProfile() vuelva a enviar la petición. Lo usa la pantalla de cuenta
 * cuando la persona abandona una eliminación a medias y sigue usando Orki: el
 * perfil pudo borrarse después de que se recordara como creado.
 */
export function forgetEnsuredProfile(userId: string): void {
  attempts.delete(userId)
}

/** Solo para pruebas: olvida los intentos hechos en esta carga de la página. */
export function resetEnsuredProfiles(): void {
  attempts.clear()
}
