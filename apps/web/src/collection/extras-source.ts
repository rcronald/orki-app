import { getSupabase, type OrkiSupabaseClient } from '../lib/supabase.ts'
import type { CollectionPlant } from './model.ts'
import type { OwnershipExtras, SpeciesExtraName } from './ownership.ts'

// Lo que "¿Ya la tengo?" necesita además de las plantas (#19, #118): los
// sinónimos y nombres comunes de las especies de la colección
// (public.species_names) y las abreviaturas de sus géneros
// (public.genus_abbreviations). Las dos tablas son de lectura pública. Se piden
// con cada lectura de la colección desde la red y se guardan en la copia
// local, así que sin conexión la respuesta reconoce "Blc." o un sinónimo.
//
// Consultas, por grupo de ids (IDS_PER_REQUEST, para que la dirección no
// pase de unos 2 kB) y paginadas por id como la colección (PAGE_SIZE, el
// max-rows del proyecto):
//   GET /rest/v1/species_names?select=id,species_id,name,type
//       &species_id=in.(…)[&id=gt.<último>]&order=id.asc&limit=1000
//   GET /rest/v1/genus_abbreviations?select=id,genus_id,abbreviation
//       &genus_id=in.(…)[&id=gt.<último>]&order=id.asc&limit=1000

/** Ids por petición. */
const IDS_PER_REQUEST = 50
/** Filas por página: el max-rows de la API. */
const PAGE_SIZE = 1000

/** Devuelve los extras de las especies y géneros de estas plantas. */
export type ExtrasFetcher = (
  plants: readonly CollectionPlant[],
  signal: AbortSignal,
) => Promise<OwnershipExtras>

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

interface Row {
  id: string
}

/** Lee todas las filas de una consulta paginando por id. */
async function readAll<T extends Row>(
  page: (
    after: string | null,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  let after: string | null = null
  for (;;) {
    const { data, error } = await page(after)
    if (error) throw error instanceof Error ? error : new Error('PostgREST')
    const list = data ?? []
    rows.push(...list)
    const last = list.at(-1)
    if (list.length < PAGE_SIZE || last === undefined) return rows
    after = last.id
  }
}

/** Crea el lector de extras con un cliente de Supabase. */
export function createExtrasFetcher(
  getClient: () => Promise<OrkiSupabaseClient> = getSupabase,
): ExtrasFetcher {
  return async (plants, signal) => {
    const speciesIds = [
      ...new Set(
        plants.flatMap((plant) => (plant.species ? [plant.species.id] : [])),
      ),
    ].sort()
    const genusIds = [...new Set(plants.map((plant) => plant.genus.id))].sort()
    const speciesNames = new Map<string, SpeciesExtraName[]>()
    const genusAbbreviations = new Map<string, string[]>()
    if (speciesIds.length === 0 && genusIds.length === 0) {
      return { speciesNames, genusAbbreviations }
    }
    const supabase = await getClient()
    signal.throwIfAborted()

    // Todos los grupos a la vez: son consultas independientes y en serie
    // cada una añadía un viaje de ida y vuelta a la carga (#169).
    const [nameRows, abbreviationRows] = await Promise.all([
      Promise.all(
        chunks(speciesIds, IDS_PER_REQUEST).map((ids) =>
          readAll((after) => {
            let query = supabase
              .from('species_names')
              .select('id, species_id, name, type')
              .in('species_id', ids)
            if (after !== null) query = query.gt('id', after)
            return query
              .order('id', { ascending: true })
              .limit(PAGE_SIZE)
              .abortSignal(signal)
          }),
        ),
      ),
      Promise.all(
        chunks(genusIds, IDS_PER_REQUEST).map((ids) =>
          readAll((after) => {
            let query = supabase
              .from('genus_abbreviations')
              .select('id, genus_id, abbreviation')
              .in('genus_id', ids)
            if (after !== null) query = query.gt('id', after)
            return query
              .order('id', { ascending: true })
              .limit(PAGE_SIZE)
              .abortSignal(signal)
          }),
        ),
      ),
    ])
    for (const row of nameRows.flat()) {
      const list = speciesNames.get(row.species_id) ?? []
      list.push({ name: row.name, type: row.type })
      speciesNames.set(row.species_id, list)
    }
    for (const row of abbreviationRows.flat()) {
      const list = genusAbbreviations.get(row.genus_id) ?? []
      list.push(row.abbreviation)
      genusAbbreviations.set(row.genus_id, list)
    }

    signal.throwIfAborted()
    return { speciesNames, genusAbbreviations }
  }
}

/** Lector de la app, con el cliente compartido. */
export const supabaseExtrasFetcher = createExtrasFetcher()
