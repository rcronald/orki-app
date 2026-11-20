import { useId, useMemo } from 'react'
import { Link } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import {
  countGenera,
  groupByGenus,
  plantsByStatus,
  sortByNewest,
  type GenusGroup,
} from '../collection/selectors.ts'
import type { CollectionLoadError } from '../collection/source.ts'
import type { CollectionStatus } from '../collection/store.ts'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { PATHS } from '../routes/paths.ts'
import { PlantCard } from './PlantCard.tsx'
import {
  useInventoryPreferences,
  type InventoryView as View,
} from './preferences.ts'
import { genusCountText, plantCountText } from './texts.ts'

export interface InventoryViewProps {
  /** Estado de la colección (useCollection().status). */
  status: CollectionStatus
  /** Todas las plantas, también las dadas de baja; null si aún no hay datos. */
  plants: readonly CollectionPlant[] | null
  /** Error de la última lectura. */
  error: CollectionLoadError | null
  /** Vuelve a leer la colección (useCollection().reload). */
  onRetry: () => void
}

// Clases de cada vista. Cuadrícula: dos por fila en el celular (360 px) y más
// en pantallas anchas. Lista: una por fila, dos en escritorio.
const VIEW_CLASSES: Record<View, string> = {
  list: 'grid grid-cols-1 gap-space-3 lg:grid-cols-2',
  grid: 'grid grid-cols-2 gap-space-3 sm:grid-cols-3 lg:grid-cols-4',
}

// En el celular, el acceso a registrar queda fijo abajo: se deja sitio para
// que no tape la última tarjeta (48 px del botón y su margen).
const ROOT_CLASSES =
  'flex flex-col gap-space-4 max-sm:pb-[calc(var(--space-6)_*_2_+_env(safe-area-inset-bottom))]'

// Chips de 44 px de alto o más (zona táctil): el chip del sistema mide 36.
const TOUCH_CHIP = 'py-space-3'

/**
 * Pantalla de inventario sin la carga de datos: recibe la colección y pinta
 * los contadores, el acceso a registrar, los controles de vista y la lista o
 * cuadrícula, agrupada por género o no. La usa CollectionPage con
 * useCollection() y la página de muestra con datos fijos.
 *
 * Solo muestra y cuenta las plantas activas (decisión del #14); las dadas de
 * baja llegan con el filtro de estado (#15).
 */
export function InventoryView({
  status,
  plants,
  error,
  onRetry,
}: InventoryViewProps) {
  const [preferences, setPreferences] = useInventoryPreferences()
  const { view, grouped } = preferences

  // Derivados memoizados: cambiar de vista (lista o cuadrícula) no recalcula
  // nada; agrupar o desagrupar calcula solo la forma que se pinta.
  const active = useMemo(
    () => (plants === null ? [] : plantsByStatus(plants)),
    [plants],
  )
  const genusCount = useMemo(() => countGenera(active), [active])
  const groups = useMemo(
    () => (grouped ? groupByGenus(active) : null),
    [grouped, active],
  )
  const newest = useMemo(
    () => (grouped ? null : sortByNewest(active)),
    [grouped, active],
  )

  const summary = (
    <div className="flex flex-wrap items-center justify-between gap-space-3">
      {plants !== null && (
        <ul
          aria-label="Resumen de tu colección"
          className="flex flex-wrap gap-x-space-4 gap-y-space-1 text-md text-neutral-700"
        >
          <li>{plantCountText(active.length)}</li>
          <li>{genusCountText(genusCount)}</li>
        </ul>
      )}
      <RegisterLink />
    </div>
  )

  if (plants === null) {
    return (
      <div className={ROOT_CLASSES}>
        {summary}
        {status === 'error' && error ? (
          <div role="alert" className="flex flex-col items-start gap-space-3">
            <p>{error.message}</p>
            <Button onClick={onRetry}>Reintentar</Button>
          </div>
        ) : (
          <p role="status" className="text-neutral-700">
            Cargando tu colección…
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={ROOT_CLASSES}>
      {summary}

      {active.length === 0 ? (
        <p className="text-neutral-700">Aún no tienes orquídeas registradas.</p>
      ) : (
        <>
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

          {groups ? (
            <div className="flex flex-col gap-space-5">
              {groups.map((group) => (
                <GenusSection key={group.genus.id} group={group} view={view} />
              ))}
            </div>
          ) : (
            <PlantList plants={newest ?? []} view={view} headingLevel={2} />
          )}
        </>
      )}
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
        <li key={plant.id} className="min-w-0">
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
        <span className="min-w-0 [overflow-wrap:anywhere]">
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

// Acceso a registrar una planta. En el celular queda fijo abajo, al alcance
// del pulgar; desde 640 px va en su sitio, junto a los contadores. En el
// orden del tabulador va siempre aquí, antes de la lista.
function RegisterLink() {
  return (
    <Link
      to={PATHS.newPlant}
      className="orki-btn orki-btn--primary max-sm:fixed max-sm:inset-x-space-4 max-sm:bottom-[calc(var(--space-4)_+_env(safe-area-inset-bottom))] max-sm:z-10 max-sm:shadow-card"
    >
      <Icon name="plus" />
      Registrar orquídea
    </Link>
  )
}
