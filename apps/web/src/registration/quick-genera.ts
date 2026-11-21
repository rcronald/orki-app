import { CatalogSearchError } from '../lib/catalogSearch.ts'
import {
  getSupabase,
  sessionTokenFailure,
  type OrkiSupabaseClient,
} from '../lib/supabase.ts'
import type { FormGenus } from './form-state.ts'

// Géneros de acceso rápido del registro: los de genera con is_quick_access
// (hoy, los cinco de la especificación), leídos del catálogo en lugar de
// escritos en el código.
//
//   GET /rest/v1/genera?select=id,name&is_quick_access=eq.true&order=name.asc
//
// genera es de lectura pública y la consulta es diminuta. Se pide una vez por
// sesión de la app: la primera pantalla de registro la lanza y las siguientes
// reutilizan la misma promesa. Si falla, se olvida y el siguiente intento
// vuelve a pedirla.

/** Tope defensivo: los géneros de acceso rápido son unos pocos chips. */
const QUICK_ACCESS_LIMIT = 12

let cached: Promise<readonly FormGenus[]> | null = null

async function fetchQuickAccessGenera(
  getClient: () => Promise<OrkiSupabaseClient>,
): Promise<readonly FormGenus[]> {
  const offline = () =>
    typeof navigator !== 'undefined' && navigator.onLine === false
  let supabase: OrkiSupabaseClient
  try {
    supabase = await getClient()
  } catch (error) {
    throw new CatalogSearchError(offline() ? 'offline' : 'failed', {
      cause: error,
    })
  }
  const { data, error, status } = await supabase
    .from('genera')
    .select('id, name')
    .eq('is_quick_access', true)
    .order('name', { ascending: true })
    .limit(QUICK_ACCESS_LIMIT)
  if (error) {
    const isOffline =
      sessionTokenFailure(error) === 'offline' || (status === 0 && offline())
    throw new CatalogSearchError(isOffline ? 'offline' : 'failed', {
      cause: error,
    })
  }
  return data.map((row) => ({ id: row.id, name: row.name }))
}

/**
 * Géneros de acceso rápido, en orden alfabético. Se rechaza con
 * CatalogSearchError ('offline' o 'failed').
 */
export function loadQuickAccessGenera(
  getClient: () => Promise<OrkiSupabaseClient> = getSupabase,
): Promise<readonly FormGenus[]> {
  if (cached === null) {
    const pending = fetchQuickAccessGenera(getClient)
    cached = pending
    pending.catch(() => {
      if (cached === pending) cached = null
    })
  }
  return cached
}

/** Olvida los géneros guardados; para las pruebas. */
export function clearQuickAccessGeneraCache(): void {
  cached = null
}
