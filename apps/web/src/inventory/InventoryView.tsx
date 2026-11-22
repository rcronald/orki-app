import {
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link } from 'react-router'
import {
  applyFilters,
  countActiveFilters,
  DEFAULT_FILTERS,
  filterOptions,
  narrowsStatus,
  plantsWithStatus,
  resolveFilters,
  type PlantFilters,
} from '../collection/filters.ts'
import type { CollectionPlant } from '../collection/model.ts'
import {
  countGenera,
  filterByText,
  groupByGenus,
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
import { ExportAction } from './ExportAction.tsx'
import { activeFilterChips } from './filter-chips.ts'
import {
  ActiveFilters,
  FiltersPanel,
  FiltersToggle,
} from './InventoryFilters.tsx'
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
import {
  genusCountText,
  matchCountText,
  plantCountText,
  shownCountText,
} from './texts.ts'

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
  /**
   * Filtros (controlados: CollectionPage los guarda en la URL). Pueden traer
   * valores que no existen en la colección: la vista los ignora.
   */
  filters: PlantFilters
  /** Se llama con los filtros nuevos. */
  onFiltersChange: (filters: PlantFilters) => void
  /**
   * Bloque bajo el buscador: la respuesta de "¿Ya la tengo?" (#19). No queda
   * fijo arriba con el campo: se desplaza con la lista.
   */
  searchResult?: ReactNode
  /**
   * Solo lectura (sin conexión, #18): id del texto que explica por qué. Con
   * él, los accesos a registrar se ven desactivados y lo citan.
   */
  writeDisabledBy?: string
}

// En el celular, el acceso a registrar queda fijo abajo: se deja sitio para
// que no tape la última tarjeta (48 px del botón y su margen).
const ROOT_CLASSES =
  'flex flex-col gap-space-4 max-sm:pb-[calc(var(--space-6)_*_2_+_env(safe-area-inset-bottom))]'

// Chips de 44 px de alto o más (zona táctil): el chip del sistema mide 36.
const TOUCH_CHIP = 'py-space-3'

/**
 * Pantalla de inventario sin la carga de datos: recibe la colección y pinta
 * los contadores, el acceso a registrar, el buscador, los controles de vista,
 * los filtros y la lista o cuadrícula, agrupada por género o no, con sus
 * estados de carga, error, colección vacía y sin resultados. La usa
 * CollectionPage con useCollection() y la página de muestra con datos fijos.
 *
 * Por defecto solo muestra y cuenta las plantas activas (decisión del #14);
 * las dadas de baja se ven con el filtro de estado (#15).
 *
 * Contadores: la cabecera dice cuántas se ven. Sin búsqueda ni filtros que
 * reduzcan la lista, el total con el estado elegido ("12 orquídeas", "2
 * orquídeas perdidas"); con ellos, "N de M" ("3 de 12 orquídeas"). Los
 * géneros son siempre los de las plantas que se ven. Bajo el buscador (fijo
 * arriba, solo el campo y el contador) se anuncia lo mismo al buscar o filtrar, en una región de estado que
 * el lector de pantalla lee sin mover el foco.
 */
export function InventoryView({
  status,
  plants,
  error,
  onRetry,
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  searchResult,
  writeDisabledBy,
}: InventoryViewProps) {
  const [preferences, setPreferences] = useInventoryPreferences()
  const { view, grouped } = preferences
  const [filtersOpen, setFiltersOpen] = useState(false)
  const panelId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Opciones de los filtros y filtros resueltos contra ellas: lo que no está
  // en la colección (un género que ya no tiene, un valor de la URL) se ignora.
  const options = useMemo(
    () => (plants === null ? null : filterOptions(plants)),
    [plants],
  )
  const resolved = useMemo(
    () => (options === null ? filters : resolveFilters(filters, options)),
    [filters, options],
  )
  const activeCount = countActiveFilters(resolved)
  const chips = useMemo(
    () => (options === null ? [] : activeFilterChips(resolved, options)),
    [resolved, options],
  )

  // El campo y los chips muestran cada cambio al momento; la lista se calcula
  // con los valores diferidos, que React calcula sin bloquear la escritura ni
  // los toques.
  const deferredQuery = useDeferredValue(query)
  const deferredFilters = useDeferredValue(resolved)
  const searching = deferredQuery.trim() !== ''
  const narrowed = searching || narrowsStatus(deferredFilters)
  const shownStatus = deferredFilters.status

  // Derivados memoizados: cambiar de vista (lista o cuadrícula) no recalcula
  // nada; agrupar o desagrupar calcula solo la forma que se pinta.
  const withStatus = useMemo(
    () => (plants === null ? [] : plantsWithStatus(plants, shownStatus)),
    [plants, shownStatus],
  )
  const filtered = useMemo(
    () => applyFilters(withStatus, deferredFilters),
    [withStatus, deferredFilters],
  )
  const matches = useMemo(
    () => filterByText(filtered, deferredQuery, { includeInactive: true }),
    [filtered, deferredQuery],
  )
  const genusCount = useMemo(
    () => countGenera(matches, { includeInactive: true }),
    [matches],
  )
  // Agrupada, los géneros sin coincidencias desaparecen solos.
  const groups = useMemo(
    () => (grouped ? groupByGenus(matches, { includeInactive: true }) : null),
    [grouped, matches],
  )
  const newest = useMemo(
    () => (grouped ? null : sortByNewest(matches)),
    [grouped, matches],
  )

  const focusToggle = useCallback(() => toggleRef.current?.focus(), [])
  const closeFilters = useCallback(() => {
    setFiltersOpen(false)
    toggleRef.current?.focus()
  }, [])
  const clearQuery = () => {
    onQueryChange('')
    searchRef.current?.focus()
  }
  const clearFilters = () => {
    onFiltersChange(DEFAULT_FILTERS)
    focusToggle()
  }
  const registerLink = <RegisterLink disabledBy={writeDisabledBy} />

  if (plants !== null && plants.length === 0) {
    return (
      <div className={ROOT_CLASSES}>
        {status === 'error' && error && (
          <ReloadErrorBanner error={error} onRetry={onRetry} />
        )}
        <EmptyCollection
          hasInactive={false}
          registerDisabledBy={writeDisabledBy}
        />
      </div>
    )
  }

  const announce = plants !== null && (searching || activeCount > 0)

  // Solo el campo y su contador quedan fijos arriba al desplazar la página.
  // La respuesta de "¿Ya la tengo?" va debajo y se desplaza con la lista: con
  // sus ejemplares y el acceso a registrar, fija ocupaba media pantalla del
  // celular y, con el mismo fondo que la página, su parte de abajo parecía
  // montada sobre la primera tarjeta, tapándola a medias (#19). El margen
  // negativo anula el hueco de la columna: sin respuesta no queda espacio, y
  // con ella queda a la misma distancia del campo que antes.
  const controls = (
    <>
      <div className="sticky top-[0] z-10 -mx-space-1 bg-neutral-0 px-space-1 py-space-2">
        <InventorySearch
          value={query}
          onValueChange={onQueryChange}
          inputRef={searchRef}
          status={
            announce
              ? matchCountText(
                  matches.length,
                  withStatus.length,
                  shownStatus,
                  narrowed,
                )
              : null
          }
        />
      </div>
      {searchResult !== undefined && (
        <div className="-mt-space-4">{searchResult}</div>
      )}
      <div className="flex flex-wrap items-center gap-space-2">
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
        {options !== null && (
          <FiltersToggle
            ref={toggleRef}
            open={filtersOpen}
            count={activeCount}
            panelId={panelId}
            onToggle={() => setFiltersOpen(!filtersOpen)}
          />
        )}
      </div>
      {options !== null && (
        <>
          <FiltersPanel
            id={panelId}
            open={filtersOpen}
            options={options}
            filters={resolved}
            onChange={onFiltersChange}
            onClose={closeFilters}
          />
          {!filtersOpen && (
            <ActiveFilters
              chips={chips}
              onChange={onFiltersChange}
              onEmpty={focusToggle}
            />
          )}
        </>
      )}
    </>
  )

  const loading = plants === null && !(status === 'error' && error)
  // Sin activas pero con plantas dadas de baja, sin buscar ni filtrar.
  const onlyInactive =
    withStatus.length === 0 && shownStatus === 'active' && !narrowed

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
            <li>
              {shownCountText(
                matches.length,
                withStatus.length,
                shownStatus,
                narrowed,
              )}
            </li>
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
        ) : plants === null ? null : onlyInactive ? (
          <EmptyCollection hasInactive />
        ) : matches.length === 0 ? (
          <NoResults
            query={searching ? deferredQuery.trim() : ''}
            filtered={activeCount > 0}
            emptyStatusText={
              withStatus.length === 0 && !narrowed
                ? matchCountText(0, 0, shownStatus)
                : null
            }
            onClearQuery={clearQuery}
            onClearFilters={clearFilters}
          />
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
      {plants !== null && <ExportAction plants={plants} />}
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
//
// Sin conexión (#18), los dos se ven desactivados (aria-disabled, siguen en el
// orden del tabulador) y citan el motivo (disabledBy).
const REGISTER_CLASSES =
  'flex gap-space-2 max-sm:fixed max-sm:inset-x-space-4 max-sm:bottom-[calc(var(--space-4)_+_env(safe-area-inset-bottom))] max-sm:z-10'

function RegisterLink({ disabledBy }: { disabledBy?: string }) {
  if (disabledBy !== undefined) {
    return (
      <div className={REGISTER_CLASSES}>
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={disabledBy}
          className="orki-btn orki-btn--primary min-w-[0] max-sm:flex-1 max-sm:shadow-card"
        >
          <Icon name="plus" />
          Registrar orquídea
        </button>
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={disabledBy}
          aria-label="Registrar con foto"
          className="orki-btn orki-btn--secondary flex-none max-sm:shadow-card"
        >
          <Icon name="camera" />
          Con foto
        </button>
      </div>
    )
  }
  return (
    <div className={REGISTER_CLASSES}>
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
