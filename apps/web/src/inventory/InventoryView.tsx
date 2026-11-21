import { useDeferredValue, useId, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import {
  countGenera,
  filterByText,
  groupByGenus,
  plantsByStatus,
  sortByNewest,
  type GenusGroup,
} from '../collection/selectors.ts'
import type { CollectionLoadError } from '../collection/source.ts'
import type { CollectionStatus } from '../collection/store.ts'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { PHOTO_FIRST_PATH } from '../registration/photo-first.ts'
import { PATHS } from '../routes/paths.ts'
import {
  EmptyCollection,
  LoadErrorPanel,
  LoadingList,
  LoadingSummary,
  NoResults,
  ReloadErrorBanner,
} from './InventoryStates.tsx'
import { InventorySearch } from './InventorySearch.tsx'
import { PlantCard } from './PlantCard.tsx'
import {
  useInventoryPreferences,
  type InventoryView as View,
} from './preferences.ts'
import { VIEW_CLASSES } from './view-classes.ts'
import { genusCountText, matchCountText, plantCountText } from './texts.ts'

export interface InventoryViewProps {
  /** Estado de la colección (useCollection().status). */
  status: CollectionStatus
  /** Todas las plantas, también las dadas de baja; null si aún no hay datos. */
  plants: readonly CollectionPlant[] | null
  /** Error de la última lectura. */
  error: CollectionLoadError | null
  /** Vuelve a leer la colección (useCollection().reload). */
  onRetry: () => void
  /** Texto del buscador (controlado: CollectionPage lo guarda en la URL). */
  query: string
  /** Se llama con el texto nuevo del buscador. */
  onQueryChange: (query: string) => void
  /** Bloque bajo el buscador; lo usará "¿Ya la tengo?" (#19). */
  searchResult?: ReactNode
}

// En el celular, el acceso a registrar queda fijo abajo: se deja sitio para
// que no tape la última tarjeta (48 px del botón y su margen).
const ROOT_CLASSES =
  'flex flex-col gap-space-4 max-sm:pb-[calc(var(--space-6)_*_2_+_env(safe-area-inset-bottom))]'

// Chips de 44 px de alto o más (zona táctil): el chip del sistema mide 36.
const TOUCH_CHIP = 'py-space-3'

/**
 * Pantalla de inventario sin la carga de datos: recibe la colección y pinta
 * los contadores, el acceso a registrar, el buscador, los controles de vista y
 * la lista o cuadrícula, agrupada por género o no, con sus estados de carga,
 * error, colección vacía y búsqueda sin resultados. La usa CollectionPage con
 * useCollection() y la página de muestra con datos fijos.
 *
 * Solo muestra y cuenta las plantas activas (decisión del #14); las dadas de
 * baja llegan con el filtro de estado (#15). Los contadores de cabecera son
 * siempre los de toda la colección; cuántas coinciden con la búsqueda va
 * aparte, bajo el buscador.
 */
export function InventoryView({
  status,
  plants,
  error,
  onRetry,
  query,
  onQueryChange,
  searchResult,
}: InventoryViewProps) {
  const [preferences, setPreferences] = useInventoryPreferences()
  const { view, grouped } = preferences

  // El campo muestra cada pulsación al momento; la lista se filtra con el
  // valor diferido, que React calcula sin bloquear la escritura.
  const deferredQuery = useDeferredValue(query)
  const searching = deferredQuery.trim() !== ''

  // Derivados memoizados: cambiar de vista (lista o cuadrícula) no recalcula
  // nada; agrupar o desagrupar calcula solo la forma que se pinta.
  const active = useMemo(
    () => (plants === null ? [] : plantsByStatus(plants)),
    [plants],
  )
  const genusCount = useMemo(() => countGenera(active), [active])
  const matches = useMemo(
    () => filterByText(active, deferredQuery),
    [active, deferredQuery],
  )
  // Agrupada, los géneros sin coincidencias desaparecen solos.
  const groups = useMemo(
    () => (grouped ? groupByGenus(matches) : null),
    [grouped, matches],
  )
  const newest = useMemo(
    () => (grouped ? null : sortByNewest(matches)),
    [grouped, matches],
  )

  const clearQuery = () => onQueryChange('')
  const registerLink = <RegisterLink />

  if (plants !== null && active.length === 0) {
    return (
      <div className={ROOT_CLASSES}>
        {status === 'error' && error && (
          <ReloadErrorBanner error={error} onRetry={onRetry} />
        )}
        <EmptyCollection hasInactive={plants.length > 0} />
      </div>
    )
  }

  const controls = (
    <>
      <div className="sticky top-[0] z-10 -mx-space-1 bg-neutral-0 px-space-1 py-space-2">
        <InventorySearch
          value={query}
          onValueChange={onQueryChange}
          status={
            plants !== null && searching
              ? matchCountText(matches.length, active.length)
              : null
          }
        >
          {searchResult}
        </InventorySearch>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-space-2">
        <ChipGroup aria-label="Vista">
          <Chip
            className={TOUCH_CHIP}
            selected={view === 'list'}
            onClick={() => setPreferences({ view: 'list' })}
          >
            Lista
          </Chip>
          <Chip
            className={TOUCH_CHIP}
            selected={view === 'grid'}
            onClick={() => setPreferences({ view: 'grid' })}
          >
            Cuadrícula
          </Chip>
        </ChipGroup>
        <Chip
          className={TOUCH_CHIP}
          selected={grouped}
          onClick={() => setPreferences({ grouped: !grouped })}
        >
          Agrupar por género
        </Chip>
      </div>
    </>
  )

  const loading = plants === null && !(status === 'error' && error)

  // Un solo árbol para todos los estados, con cada parte siempre en el mismo
  // sitio: al llegar los datos, el buscador no se vuelve a montar y conserva
  // el foco y lo escrito mientras cargaba.
  return (
    <div className={ROOT_CLASSES}>
      <div className="flex flex-wrap items-center justify-between gap-space-3">
        {plants === null ? (
          loading && <LoadingSummary />
        ) : (
          <ul
            aria-label="Resumen de tu colección"
            className="flex flex-wrap gap-x-space-4 gap-y-space-1 text-md text-neutral-700"
          >
            <li>{plantCountText(active.length)}</li>
            <li>{genusCountText(genusCount)}</li>
          </ul>
        )}
        {registerLink}
      </div>
      {status === 'error' && error && plants !== null && (
        <ReloadErrorBanner error={error} onRetry={onRetry} />
      )}
      {status === 'error' && error && plants === null ? (
        <LoadErrorPanel error={error} onRetry={onRetry} />
      ) : (
        controls
      )}
      <div aria-busy={loading} className="flex flex-col">
        {loading ? (
          <LoadingList view={view} />
        ) : plants === null ? null : matches.length === 0 ? (
          <NoResults query={deferredQuery} onClear={clearQuery} />
        ) : groups ? (
          <div className="flex flex-col gap-space-5">
            {groups.map((group) => (
              <GenusSection key={group.genus.id} group={group} view={view} />
            ))}
          </div>
        ) : (
          <PlantList plants={newest ?? []} view={view} headingLevel={2} />
        )}
      </div>
    </div>
  )
}

function PlantList({
  plants,
  view,
  headingLevel,
}: {
  plants: readonly CollectionPlant[]
  view: View
  headingLevel: 2 | 3
}) {
  return (
    <ul className={VIEW_CLASSES[view]}>
      {plants.map((plant) => (
        <li key={plant.id} className="min-w-[0]">
          <PlantCard plant={plant} view={view} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  )
}

// Un género con su contador. El encabezado se lee "Phalaenopsis, 3
// orquídeas"; a la vista, el número va en una píldora. Los géneros van sin
// cursiva, como en los chips del sistema.
function GenusSection({ group, view }: { group: GenusGroup; view: View }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-space-3">
      <h2
        id={headingId}
        className="flex items-center gap-space-2 text-lg font-semibold text-secondary"
      >
        <span className="min-w-[0] [overflow-wrap:anywhere]">
          {group.genus.name}
        </span>
        <span
          aria-hidden="true"
          className="rounded-pill bg-neutral-50 px-space-2 text-sm font-semibold text-neutral-900"
        >
          {group.count}
        </span>
        <span className="sr-only">, {plantCountText(group.count)}</span>
      </h2>
      <PlantList plants={group.plants} view={view} headingLevel={3} />
    </section>
  )
}

// Acceso a registrar una planta, con dos entradas: escribir el nombre primero
// o empezar por la foto (#87, la misma pantalla con ?foto=1). En el celular
// quedan fijas abajo, al alcance del pulgar; desde 640 px van en su sitio,
// junto a los contadores. En el orden del tabulador van siempre aquí, antes
// del buscador y de la lista.
//
// "Con foto" no abre la cámara: lleva al formulario con "Tomar foto" arriba
// del todo. Los navegadores solo abren la cámara como respuesta directa a un
// toque, y así ese toque es el del propio botón de la cámara, ya en el
// formulario que conserva lo escrito si iOS recarga la app.
function RegisterLink() {
  return (
    <div className="flex gap-space-2 max-sm:fixed max-sm:inset-x-space-4 max-sm:bottom-[calc(var(--space-4)_+_env(safe-area-inset-bottom))] max-sm:z-10">
      <Link
        to={PATHS.newPlant}
        className="orki-btn orki-btn--primary min-w-[0] max-sm:flex-1 max-sm:shadow-card"
      >
        <Icon name="plus" />
        Registrar orquídea
      </Link>
      <Link
        to={PHOTO_FIRST_PATH}
        aria-label="Registrar con foto"
        className="orki-btn orki-btn--secondary flex-none max-sm:bg-neutral-0 max-sm:shadow-card"
      >
        <Icon name="camera" />
        Con foto
      </Link>
    </div>
  )
}
