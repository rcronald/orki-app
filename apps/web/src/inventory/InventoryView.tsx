import {
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  applyFilters,
  countActiveFilters,
  DEFAULT_FILTERS,
  filterOptions,
  narrowsStatus,
  plantsWithStatus,
  resolveFilters,
  toggleValue,
  type FilterOptions,
  type PlantFilters,
} from '../collection/filters.ts'
import type { CollectionPlant } from '../collection/model.ts'
import {
  matchPlantNames,
  ownershipIndexFor,
  type OwnershipExtras,
} from '../collection/ownership.ts'
import {
  filterByText,
  groupByGenus,
  sortByNewest,
  type GenusGroup,
} from '../collection/selectors.ts'
import type { CollectionLoadError } from '../collection/source.ts'
import type { CollectionStatus } from '../collection/store.ts'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { FiltersButton } from '../components/ui/FiltersButton.tsx'
import { SearchField } from '../components/ui/SearchField.tsx'
import {
  SegmentedControl,
  type SegmentedOption,
} from '../components/ui/SegmentedControl.tsx'
import { ExportAction } from './ExportAction.tsx'
import { activeFilterChips, countPanelFilters } from './filter-chips.ts'
import { ActiveFilters, FiltersPanel } from './InventoryFilters.tsx'
import {
  EmptyCollection,
  LoadErrorPanel,
  LoadingList,
  NoResults,
  ReloadErrorBanner,
} from './InventoryStates.tsx'
import { PlantCard } from './PlantCard.tsx'
import {
  useInventoryPreferences,
  type InventoryView as View,
} from './preferences.ts'
import { VIEW_CLASSES } from './view-classes.ts'
import {
  FILTERS_TEXT,
  matchCountText,
  plantCountText,
  SEARCH_TEXT,
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
   * Sinónimos, nombres comunes y abreviaturas de la copia local (#18), los
   * mismos que usa "¿Ya la tengo?": con ellos, la lista encuentra también las
   * plantas por esos nombres. Sin ellos, solo por los campos de cada planta.
   */
  extras?: OwnershipExtras
  /**
   * Solo lectura (sin conexión, #18): id del texto que explica por qué. Con
   * él, el acceso a registrar de la colección vacía se ve desactivado y lo
   * cita. (Los de la cabecera los pinta CollectionActions.)
   */
  writeDisabledBy?: string
}

const ROOT_CLASSES = 'flex flex-col gap-space-4'

const VIEW_OPTIONS: readonly SegmentedOption<View>[] = [
  { value: 'grid', label: 'Cuadrícula', icon: 'layout-grid' },
  { value: 'list', label: 'Lista', icon: 'list' },
]

// Chips de 44 px de alto o más (zona táctil): el chip del sistema mide 36.
const TOUCH_CHIP = 'py-space-3'

/**
 * Pantalla de inventario sin la carga de datos ni la cabecera: recibe la
 * colección y pinta el buscador único con «Filtros» y la vista (cuadrícula o
 * lista), los accesos por género, la lista o cuadrícula, agrupada por género o
 * no, con sus estados de carga, error, colección vacía y sin resultados, y
 * «Exportar a CSV». La usa CollectionPage con useCollection() (que pone la
 * cabecera con el contador y las acciones, #208) y la página de muestra con
 * datos fijos.
 *
 * Por defecto solo muestra y cuenta las plantas activas (decisión del #14);
 * las dadas de baja se ven con el filtro de estado (#15).
 *
 * Al buscar o filtrar, bajo el buscador se dice cuántas coinciden ("3 de 12
 * orquídeas coinciden.", "2 orquídeas perdidas."), en una región de estado
 * que el lector de pantalla lee sin mover el foco.
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
  extras,
  writeDisabledBy,
}: InventoryViewProps) {
  const [preferences, setPreferences] = useInventoryPreferences()
  const { view, grouped } = preferences
  const [filtersOpen, setFiltersOpen] = useState(false)
  const panelId = useId()
  const statusId = useId()
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
  const panelCount = countPanelFilters(resolved)
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
  // Las coincidencias por nombre de "¿Ya la tengo?" (también sinónimos y
  // nombres comunes), sobre toda la colección y con el mismo índice que esa
  // consulta (ownershipIndexFor lo crea una vez por plantas y extras). Solo
  // dependen de la búsqueda: cambiar los filtros no las recalcula.
  const index = useMemo(
    () => (plants === null ? null : ownershipIndexFor(plants, extras)),
    [plants, extras],
  )
  const nameMatches = useMemo(
    () => (index === null ? null : matchPlantNames(index, deferredQuery)),
    [index, deferredQuery],
  )
  const matches = useMemo(
    () =>
      filterByText(filtered, deferredQuery, {
        includeInactive: true,
        nameMatches,
      }),
    [filtered, deferredQuery, nameMatches],
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
  const loading = plants === null && !(status === 'error' && error)
  // Sin activas pero con plantas dadas de baja, sin buscar ni filtrar.
  const onlyInactive =
    withStatus.length === 0 && shownStatus === 'active' && !narrowed

  // Barra del buscador (#208): el campo, «Filtros» y la vista, en una fila
  // que se parte en el celular (el campo arriba, a todo el ancho). Ya no queda
  // fija arriba: sin barras fijas, el foco no puede quedar tapado. Debajo, el
  // contador de coincidencias (role="status", siempre montado: el lector lo
  // anuncia sin mover el foco; vacío, sin el hueco de la columna).
  const controls = (
    <>
      <div role="search" className="flex flex-col gap-space-2">
        <div className="orki-toolbar">
          <SearchField
            label={SEARCH_TEXT.label}
            // Etiqueta visible en el celular, como en la maqueta; en
            // escritorio, solo para el lector (el campo es evidente).
            className="min-[721px]:[&>label]:sr-only"
            placeholder={SEARCH_TEXT.placeholder}
            value={query}
            onValueChange={onQueryChange}
            clearLabel={SEARCH_TEXT.clear}
            inputRef={searchRef}
            aria-describedby={statusId}
          />
          {options !== null && (
            <FiltersButton
              ref={toggleRef}
              activeCount={panelCount}
              aria-expanded={filtersOpen}
              aria-controls={panelId}
              onClick={() => setFiltersOpen(!filtersOpen)}
            />
          )}
          <SegmentedControl
            label="Vista"
            iconOnly
            value={view}
            onValueChange={(next) => setPreferences({ view: next })}
            options={VIEW_OPTIONS}
          />
        </div>
        <p
          id={statusId}
          role="status"
          className="text-sm text-neutral-700 empty:mt-[calc(var(--space-2)*-1)]"
        >
          {announce
            ? matchCountText(
                matches.length,
                withStatus.length,
                shownStatus,
                narrowed,
              )
            : null}
        </p>
      </div>
      {options !== null && (
        <>
          <FiltersPanel
            id={panelId}
            open={filtersOpen}
            options={options}
            filters={resolved}
            onChange={onFiltersChange}
            grouped={grouped}
            onGroupedChange={(next) => setPreferences({ grouped: next })}
            onClose={closeFilters}
          />
          {!filtersOpen && (
            <ActiveFilters
              chips={chips}
              filters={resolved}
              onChange={onFiltersChange}
              onEmpty={focusToggle}
            />
          )}
          <GenusChips
            options={options}
            filters={resolved}
            onChange={onFiltersChange}
          />
        </>
      )}
    </>
  )

  // Un solo árbol para todos los estados, con cada parte siempre en el mismo
  // sitio: al llegar los datos, el buscador no se vuelve a montar y conserva
  // el foco y lo escrito mientras cargaba.
  return (
    <div className={ROOT_CLASSES}>
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

/**
 * Accesos por género (#208): «Todos» y los géneros de la colección, de más a
 * menos plantas (a igualdad, alfabético sin el «×»: las opciones ya vienen en
 * ese orden y el orden es estable), en una fila con desplazamiento
 * horizontal. Selección múltiple, como el filtro de género de siempre: cada
 * chip suma o quita su género, y «Todos» los quita todos.
 */
function GenusChips({
  options,
  filters,
  onChange,
}: {
  options: FilterOptions
  filters: PlantFilters
  onChange: (filters: PlantFilters) => void
}) {
  const genera = useMemo(
    () => options.genera.toSorted((a, b) => b.count - a.count),
    [options],
  )
  if (genera.length === 0) return null
  return (
    <ChipGroup aria-label={FILTERS_TEXT.genus} scroll>
      <Chip
        className={TOUCH_CHIP}
        selected={filters.genera.length === 0}
        onClick={() => onChange({ ...filters, genera: [] })}
      >
        {FILTERS_TEXT.allGenera}
      </Chip>
      {genera.map(({ genus }) => (
        <Chip
          key={genus.id}
          className={TOUCH_CHIP}
          selected={filters.genera.includes(genus.id)}
          onClick={() =>
            onChange({
              ...filters,
              genera: toggleValue(filters.genera, genus.id),
            })
          }
        >
          {genus.name}
        </Chip>
      ))}
    </ChipGroup>
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
