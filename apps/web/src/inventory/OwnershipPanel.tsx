import type { CollectionPlant } from '../collection/model.ts'
import type { Ownership, OwnershipExtras } from '../collection/ownership.ts'
import { OwnershipAnswer } from '../components/ui/OwnershipAnswer.tsx'
import type {
  CatalogSearchFunction,
  SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import type { OnOwnershipMeasure } from './ownership-measure.ts'
import { MatchList, RegisterAction } from './OwnershipMatches.tsx'
import { OWNERSHIP_TEXT, pastSpecimensText } from './texts.ts'
import {
  ownershipSubject,
  ownershipSubjectKind,
  useOwnershipAnswer,
} from './useOwnershipAnswer.ts'

export interface OwnershipPanelProps {
  /** Todas las plantas, también las dadas de baja; null si aún no hay datos. */
  plants: readonly CollectionPlant[] | null
  /** Texto del buscador, tal como está escrito. */
  query: string
  /** Si la lista tiene filtros: la respuesta es sobre toda la colección. */
  filtered?: boolean
  /** Sinónimos, nombres comunes y abreviaturas de la copia local (#18). */
  extras?: OwnershipExtras
  /**
   * Búsqueda del catálogo con la que se mejora la respuesta cuando hay
   * conexión (#124). Por defecto, searchSpecies; null, sin catálogo (la
   * página de muestra).
   */
  searchSpecies?: CatalogSearchFunction<SpeciesSearchResult> | null
  /** Si hay conexión; por defecto, useOnlineStatus(). */
  online?: boolean
  /**
   * Sin conexión (#18): id del texto con el motivo. Con él, el acceso a
   * registrar lo buscado se ve desactivado y lo cita.
   */
  registerDisabledBy?: string
  /** Punto de enganche para medir cada respuesta mostrada (#146). */
  onMeasure?: OnOwnershipMeasure
  /** Reloj en milisegundos, para las pruebas. Por defecto, performance.now. */
  now?: () => number
}

/**
 * Ejemplares que se listan bajo la respuesta; el resto, "Y N más". Pocos: la
 * respuesta va entre el buscador y la lista, y en el celular no debe empujar
 * la lista, que ya muestra todos los que coinciden por texto, fuera de la
 * pantalla.
 */
const LISTED_MATCHES = 3

// Respuesta de "¿Ya la tengo?" (#123) bajo el buscador del inventario. Sale de
// la colección en memoria (collection/ownership.ts) mientras se escribe, sin
// esperar a la red, y es sobre toda la colección, sin los filtros de la lista.
// Con conexión, el catálogo la mejora cuando llega (#124, useCatalogOwnership):
// un sinónimo de una especie que el usuario tiene pasa a "Sí".
//
// Accesibilidad: la región role="status" está siempre montada (vacía sin
// respuesta), y dentro van la respuesta (OwnershipAnswer sin región propia) y
// sus notas: el lector de pantalla la anuncia al aparecer y al cambiar sin
// mover el foco, que sigue en el buscador. La lista de ejemplares y el acceso
// a registrar van fuera de la región, para no leerlos en cada pulsación.
export function OwnershipPanel({
  plants,
  query,
  filtered = false,
  extras,
  searchSpecies,
  online,
  onMeasure,
  registerDisabledBy,
  now,
}: OwnershipPanelProps) {
  const {
    ownership,
    registerName: name,
    catalogName,
  } = useOwnershipAnswer({
    plants,
    query,
    extras,
    searchSpecies,
    online,
    onMeasure,
    now,
  })

  return (
    <div className="flex flex-col gap-space-3">
      <div role="status">
        {ownership !== null && (
          <AnswerSummary
            ownership={ownership}
            typed={name}
            catalogName={catalogName}
          />
        )}
      </div>
      {ownership !== null && (
        <>
          <MatchList ownership={ownership} limit={LISTED_MATCHES} />
          <RegisterAction
            ownership={ownership}
            name={name}
            disabledBy={registerDisabledBy}
          />
          {filtered && (
            <p className="text-sm text-neutral-700">
              {OWNERSHIP_TEXT.wholeCollection}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function AnswerSummary({
  ownership,
  typed,
  catalogName,
}: {
  ownership: Ownership
  typed: string
  catalogName: string | null
}) {
  const owned = ownership.outcome !== 'not-owned'
  const name = ownershipSubject(ownership, typed)
  const nameKind = ownershipSubjectKind(ownership, catalogName)
  const past = pastSpecimensText(
    ownership.pastMatches.filter(({ plant }) => plant.status === 'lost').length,
    ownership.pastMatches.filter(({ plant }) => plant.status === 'gifted')
      .length,
    owned,
  )
  return (
    <div className="flex flex-col gap-space-2">
      {owned ? (
        <OwnershipAnswer
          owned
          specimenCount={ownership.matches.length}
          scientificName={name}
          nameKind={nameKind}
          announce={false}
        />
      ) : (
        <OwnershipAnswer
          owned={false}
          scientificName={name}
          nameKind={nameKind}
          announce={false}
        />
      )}
      {ownership.outcome === 'similar' && (
        <p className="text-sm text-neutral-900">{OWNERSHIP_TEXT.similar}</p>
      )}
      {ownership.scope === 'genus' && ownership.genera.length > 1 && (
        <p className="text-sm text-neutral-900">
          {ownership.genera
            .map(
              ({ genus, activeCount }) =>
                `${genus.name}: ${activeCount === 1 ? '1 ejemplar' : `${activeCount} ejemplares`}`,
            )
            .join('. ')}
          .
        </p>
      )}
      {past !== null && <p className="text-sm text-neutral-900">{past}</p>}
    </div>
  )
}
