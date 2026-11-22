import { useDeferredValue, useMemo } from 'react'
import { Link } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import {
  answerOwnership,
  buildOwnershipIndex,
  type Ownership,
  type OwnershipExtras,
  type OwnershipMatch,
} from '../collection/ownership.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { OwnershipAnswer } from '../components/ui/OwnershipAnswer.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { PLANT_STATUS_LABEL } from '../collection/labels.ts'
import {
  searchSpecies as catalogSearchSpecies,
  type CatalogSearchFunction,
  type SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import { newPlantPathWithName } from '../registration/prefill-name.ts'
import { plantDetailPath } from '../routes/paths.ts'
import {
  timed,
  useOwnershipMeasurement,
  type OnOwnershipMeasure,
} from './ownership-measure.ts'
import { joinNames, OWNERSHIP_TEXT, pastSpecimensText } from './texts.ts'
import { useCatalogOwnership } from './useCatalogOwnership.ts'

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
 * respuesta va en la cabecera fija del inventario y en el celular no debe
 * tapar la lista, que ya muestra todos los que coinciden por texto.
 */
const LISTED_MATCHES = 3

const performanceNow = () => performance.now()

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
  searchSpecies = catalogSearchSpecies,
  online: onlineProp,
  onMeasure,
  registerDisabledBy,
  now = performanceNow,
}: OwnershipPanelProps) {
  const deferredQuery = useDeferredValue(query)
  const index = useMemo(
    () => (plants === null ? null : buildOwnershipIndex(plants, extras)),
    [plants, extras],
  )
  const local = useMemo(
    () =>
      index === null
        ? { value: null, ms: 0 }
        : timed(() => answerOwnership(index, deferredQuery), now),
    [index, deferredQuery, now],
  )
  const deviceOnline = useOnlineStatus()
  const online = onlineProp ?? deviceOnline
  const improved = useCatalogOwnership({
    local: local.value,
    index,
    query: deferredQuery,
    search: searchSpecies,
    online,
  })
  const ownership = improved?.ownership ?? null

  useOwnershipMeasurement(
    query,
    {
      ownership,
      source: improved?.improved ? 'catalog' : 'local',
      computeMs: local.ms,
      online,
    },
    onMeasure,
    now,
  )

  const typed = deferredQuery.trim().replace(/\s+/g, ' ')
  // Para "Aún no la tienes", el nombre del catálogo si lo escrito es una
  // especie; si no, lo escrito.
  const name = improved?.catalogName ?? typed

  return (
    <div className="flex flex-col gap-space-3">
      <div role="status">
        {ownership !== null && (
          <AnswerSummary ownership={ownership} typed={name} />
        )}
      </div>
      {ownership !== null && (
        <>
          <MatchList ownership={ownership} />
          {ownership.outcome !== 'owned' &&
            (registerDisabledBy === undefined ? (
              <Link
                to={newPlantPathWithName(name)}
                className={registerClasses(ownership)}
              >
                <Icon name="plus" />
                {registerText(ownership)}
              </Link>
            ) : (
              <button
                type="button"
                aria-disabled="true"
                aria-describedby={registerDisabledBy}
                className={registerClasses(ownership)}
              >
                <Icon name="plus" />
                {registerText(ownership)}
              </button>
            ))}
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

function registerClasses(ownership: Ownership): string {
  return `orki-btn self-start ${
    ownership.outcome === 'not-owned'
      ? 'orki-btn--primary'
      : 'orki-btn--secondary'
  }`
}

function registerText(ownership: Ownership): string {
  return ownership.outcome === 'not-owned'
    ? OWNERSHIP_TEXT.register
    : OWNERSHIP_TEXT.registerAnyway
}

/** El nombre del que se habla en la respuesta. */
function answerName(ownership: Ownership, typed: string): string {
  if (ownership.scope === 'genus') {
    return joinNames(ownership.genera.map(({ genus }) => genus.name))
  }
  const names = new Set(ownership.matches.map(({ plant }) => plant.displayName))
  if (names.size === 1) return [...names][0]
  return typed
}

function AnswerSummary({
  ownership,
  typed,
}: {
  ownership: Ownership
  typed: string
}) {
  const owned = ownership.outcome !== 'not-owned'
  const name = answerName(ownership, typed)
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
          announce={false}
        />
      ) : (
        <OwnershipAnswer owned={false} scientificName={name} announce={false} />
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

function MatchList({ ownership }: { ownership: Ownership }) {
  const current = ownership.matches.length > 0
  const list = current ? ownership.matches : ownership.pastMatches
  if (list.length === 0) return null
  const shown = list.slice(0, LISTED_MATCHES)
  const rest = list.length - shown.length
  return (
    <div className="flex flex-col gap-space-1">
      <ul
        aria-label={
          current ? OWNERSHIP_TEXT.matchesLabel : OWNERSHIP_TEXT.pastLabel
        }
        className="flex flex-col"
      >
        {shown.map((match) => (
          <li key={match.plant.id}>
            <MatchLink match={match} past={!current} />
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="text-sm text-neutral-700">{OWNERSHIP_TEXT.more(rest)}</p>
      )}
    </div>
  )
}

function matchedByText(match: OwnershipMatch): string | null {
  const { kind, matchedName, plant } = match
  if (kind === 'scientific' || kind === 'genus') return null
  if (kind === 'entered' && matchedName === plant.displayName) return null
  return OWNERSHIP_TEXT.matchedBy[kind](matchedName)
}

// Un ejemplar que coincidió, con enlace a su detalle: el nombre que se
// muestra, por qué nombre coincidió si es otro, el apodo y, si ya no está, su
// estado. 44 px de alto como mínimo (zona táctil).
function MatchLink({ match, past }: { match: OwnershipMatch; past: boolean }) {
  const { plant } = match
  const details = [
    matchedByText(match),
    plant.nickname,
    past ? PLANT_STATUS_LABEL[plant.status] : null,
  ].filter((detail): detail is string => detail !== null && detail !== '')
  return (
    <Link
      to={plantDetailPath(plant.id)}
      className="flex min-h-[44px] flex-col justify-center rounded-md px-space-2 py-space-1 text-md text-neutral-900 hover:bg-neutral-50"
    >
      <span className="[overflow-wrap:anywhere] text-secondary underline">
        {plant.displayNameIsScientific ? (
          <span className="font-display italic">
            <ScientificName name={plant.displayName} />
          </span>
        ) : (
          plant.displayName
        )}
      </span>
      {details.length > 0 && (
        <span className="text-sm text-neutral-700 [overflow-wrap:anywhere]">
          {details.join(' · ')}
        </span>
      )}
    </Link>
  )
}
