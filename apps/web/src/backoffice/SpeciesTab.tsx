import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Autocomplete } from '../components/ui/Autocomplete.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import {
  CATALOG_PAGE_SIZE,
  type CatalogSpeciesFilters,
  type CatalogSpeciesRow,
} from '../lib/catalogAdmin.ts'
import type { WrittenSpecies } from '../lib/catalogWrites.ts'
import { prepareSearchQuery, speciesMatchText } from '../lib/catalogSearch.ts'
import { useCatalogSearch } from '../lib/useCatalogSearch.ts'
import { BatchStatusBar } from './BatchStatusBar.tsx'
import {
  LoadError,
  Notice,
  Pagination,
  SearchField,
  SpeciesStatusBadge,
} from './parts.tsx'
import type { CatalogAdminSource } from './source.ts'
import {
  SpeciesDetailPanel,
  type SpeciesDetailData,
} from './SpeciesDetailPanel.tsx'
import { SpeciesForm } from './SpeciesForm.tsx'
import {
  formatCount,
  pageText,
  SOURCE_LABEL,
  SOURCE_OPTIONS,
  speciesCountText,
  STATUS_LABEL,
  STATUS_OPTIONS,
  TYPE_LABEL,
  TYPE_OPTIONS,
} from './texts.ts'
import {
  hasSpeciesCriteria,
  INITIAL_CATALOG_ADMIN_STATE,
  withSpeciesCriteria,
  type CatalogAdminState,
  type SpeciesViewState,
} from './url-state.ts'
import { useDebouncedValue, useRemoteData } from './useRemoteData.ts'

// Pestaña "Especies": buscador, filtros, tabla paginada en el servidor,
// detalle de la especie elegida (con su edición y su baja), alta de especies y
// cambio de estado por lote de las filas seleccionadas.
//
// Sin texto (o con menos de 2 caracteres) la tabla es el listado alfabético,
// paginado por clave; con texto, la búsqueda por relevancia, paginada por
// número. Cada petición trae una sola página (CATALOG_PAGE_SIZE filas).

interface TableData {
  rows: CatalogSpeciesRow[]
  total: number
  page: number
  pageCount: number
  hasPrevious: boolean
  hasNext: boolean
  searching: boolean
}

export interface SpeciesTabProps {
  state: SpeciesViewState
  onChange: (next: SpeciesViewState, options?: { replace?: boolean }) => void
  source: CatalogAdminSource
  /** Estado completo, para componer los enlaces al detalle. */
  fullState: CatalogAdminState
  /**
   * Dirección de un estado, para que el nombre de cada especie sea un enlace
   * a su detalle (se puede abrir en otra pestaña o copiar). Sin ella, como en
   * la página de muestra, es un botón.
   */
  hrefFor?: (state: CatalogAdminState) => string
  /** Cambia tras cada escritura: la tabla y el detalle se vuelven a leer. */
  revision?: number
  /** Se guardó un cambio en el catálogo: la pantalla lo anuncia y relee. */
  onCatalogChanged?: (message: string) => void
}

const CHIP = 'py-space-3'
const CHECKBOX = 'size-[24px] cursor-pointer accent-secondary'
const NAME_LINK =
  'scientific-name text-md text-neutral-900 underline decoration-neutral-700 underline-offset-2 [overflow-wrap:anywhere]'

export function SpeciesTab({
  state,
  onChange,
  source,
  fullState,
  hrefFor,
  revision = 0,
  onCatalogChanged = () => {},
}: SpeciesTabProps) {
  const statusId = useId()
  const captionId = useId()
  const tableRef = useRef<HTMLDivElement>(null)

  // El texto se busca cuando se deja de escribir; mientras tanto, la tabla
  // está "cargando" (no se ven los resultados del texto anterior).
  const settledQuery = useDebouncedValue(state.query)
  const typing = settledQuery !== state.query
  const prepared = prepareSearchQuery(settledQuery)
  const { filters, cursor, page } = state

  const key = JSON.stringify(
    prepared === null
      ? { modo: 'lista', filters, cursor }
      : { modo: 'busqueda', q: prepared, filters, page },
  )
  const table = useRemoteData<TableData>(
    key,
    async (signal) => {
      if (prepared !== null) {
        const result = await source.searchSpecies(prepared, {
          filters,
          page,
          signal,
        })
        const pageCount = Math.ceil(result.total / CATALOG_PAGE_SIZE)
        return {
          rows: result.rows,
          total: result.total,
          page: result.page,
          pageCount,
          hasPrevious: result.page > 1,
          hasNext: result.page < pageCount,
          searching: true,
        }
      }
      const result = await source.listSpecies({ filters, cursor, signal })
      const pageCount = Math.ceil(result.total / CATALOG_PAGE_SIZE)
      const shownPage =
        cursor.kind === 'first'
          ? 1
          : cursor.kind === 'last'
            ? pageCount
            : Math.min(Math.max(page, result.hasPrevious ? 2 : 1), pageCount)
      return {
        rows: result.rows,
        total: result.total,
        page: result.hasPrevious ? shownPage : 1,
        pageCount,
        hasPrevious: result.hasPrevious,
        hasNext: result.hasNext,
        searching: false,
      }
    },
    { revision },
  )
  const loading = typing || table.status === 'loading'
  const data = !typing && table.status === 'success' ? table.data : null

  // Género del filtro: su nombre, para mostrarlo (en la URL solo va el id).
  const genusId = filters.genusId ?? null
  const genus = useRemoteData(
    genusId,
    (signal) => source.genus(genusId ?? '', { signal }),
    { revision },
  )

  // Detalle.
  const detailId = state.detailId
  const detail = useRemoteData<SpeciesDetailData>(
    detailId,
    async (signal) => {
      const id = detailId ?? ''
      const [species, plantCount] = await Promise.all([
        source.speciesDetail(id, { signal }),
        source.plantCount(id, { signal }),
      ])
      return { species, plantCount }
    },
    { revision },
  )
  const [creating, setCreating] = useState(false)
  const createHeadingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (creating) createHeadingRef.current?.focus()
  }, [creating])
  const addButtonRef = useRef<HTMLButtonElement>(null)

  // Selección para el cambio de estado por lote: solo filas de la página que
  // se ve. Cambiar de página, de búsqueda o de filtros la vacía.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [selectionKey, setSelectionKey] = useState(key)
  if (selectionKey !== key) {
    setSelectionKey(key)
    setSelected(new Set())
  }
  const pageRows = data?.rows ?? []
  const selectedRows = pageRows.filter((row) => selected.has(row.id))
  const toggleSelected = (ids: readonly string[], value: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (value) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const [focusRequest, setFocusRequest] = useState(0)
  const [returnFocusTo, setReturnFocusTo] = useState<string | null>(null)
  // Al cerrar el detalle, el foco vuelve al nombre de la especie en la tabla
  // (o a la tabla, si la especie no está en esta página).
  useEffect(() => {
    if (detailId !== null || returnFocusTo === null) return
    const row = document.getElementById(rowLinkId(returnFocusTo))
    if (row) row.focus()
    else
      tableRef.current?.querySelector<HTMLElement>('[role="region"]')?.focus()
  }, [detailId, returnFocusTo])

  const setCriteria = (
    changes: Partial<Pick<SpeciesViewState, 'query' | 'filters'>>,
    replace = false,
  ) => onChange(withSpeciesCriteria(state, changes), { replace })
  const setFilter = <K extends keyof CatalogSpeciesFilters>(
    name: K,
    value: CatalogSpeciesFilters[K] | undefined,
  ) => {
    const next = { ...filters }
    if (value === undefined) delete next[name]
    else next[name] = value
    setCriteria({ filters: next })
  }
  const clearAll = () =>
    onChange({
      ...INITIAL_CATALOG_ADMIN_STATE.species,
      detailId: state.detailId,
    })

  const goTo = (next: Pick<SpeciesViewState, 'page' | 'cursor'>) => {
    onChange({ ...state, ...next })
    const region = tableRef.current
    if (region && typeof region.scrollIntoView === 'function') {
      if (region.getBoundingClientRect().top < 0) {
        region.scrollIntoView({ block: 'start' })
      }
    }
  }

  const openDetail = (id: string) => {
    setFocusRequest((value) => value + 1)
    setReturnFocusTo(id)
  }
  const detailHref = hrefFor
    ? (id: string) =>
        hrefFor({ ...fullState, species: { ...state, detailId: id } })
    : null

  const statusText = (() => {
    if (loading) return 'Cargando especies…'
    if (table.status !== 'success' || data === null) return ''
    if (data.total === 0) return 'Ninguna especie coincide.'
    const count = data.searching
      ? `${speciesCountText(data.total)} ${data.total === 1 ? 'coincide' : 'coinciden'} con «${prepared ?? ''}».`
      : `${speciesCountText(data.total)}.`
    return `${count} ${pageText(data.page, data.pageCount)}.`
  })()

  const criteria = hasSpeciesCriteria(state)
  const shortQuery =
    state.query.trim() !== '' && prepareSearchQuery(state.query) === null
  const skeletonRows = Math.min(
    CATALOG_PAGE_SIZE,
    Math.max(
      10,
      table.status === 'loading' && table.previous
        ? table.previous.rows.length
        : 10,
    ),
  )

  return (
    <div className="flex flex-col gap-space-4">
      <div className="grid gap-space-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SearchField
          label="Buscar especies"
          placeholder="Nombre científico, sinónimo o nombre común"
          value={state.query}
          onValueChange={(query) => setCriteria({ query }, true)}
          hint={
            shortQuery
              ? 'Escribe al menos 2 caracteres para buscar.'
              : 'Tolera errores de tipeo, tildes y abreviaturas de género (Phal. amab).'
          }
        />
        <GenusFilter
          source={source}
          genusId={genusId}
          genusName={
            genus.status === 'success' ? (genus.data?.name ?? null) : null
          }
          onChange={(id) => setFilter('genusId', id ?? undefined)}
        />
      </div>

      <div className="flex flex-col gap-space-3">
        <FilterChips
          label="Estado"
          options={STATUS_OPTIONS}
          labels={STATUS_LABEL}
          all="Todos"
          value={filters.status}
          onChange={(value) => setFilter('status', value)}
        />
        <FilterChips
          label="Tipo"
          options={TYPE_OPTIONS}
          labels={TYPE_LABEL}
          all="Todos"
          value={filters.type}
          onChange={(value) => setFilter('type', value)}
        />
        <FilterChips
          label="Fuente"
          options={SOURCE_OPTIONS}
          labels={SOURCE_LABEL}
          all="Todas"
          value={filters.source}
          onChange={(value) => setFilter('source', value)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <p id={statusId} role="status" className="text-sm text-neutral-700">
          {statusText}
        </p>
        <div className="flex flex-wrap gap-space-3">
          {criteria && (
            <Button icon="x" onClick={clearAll}>
              Limpiar búsqueda y filtros
            </Button>
          )}
          <Button
            ref={addButtonRef}
            icon="plus"
            aria-expanded={creating}
            onClick={() => setCreating(true)}
          >
            Añadir especie o híbrido
          </Button>
        </div>
      </div>

      {selectedRows.length > 0 && (
        <BatchStatusBar
          rows={selectedRows}
          source={source}
          onClear={() => setSelected(new Set())}
          onDone={(message) => {
            setSelected(new Set())
            onCatalogChanged(message)
          }}
        />
      )}

      <div
        className={`grid gap-space-4 ${detailId || creating ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]' : ''}`}
      >
        <div ref={tableRef} className="flex min-w-[0] flex-col gap-space-3">
          {table.status === 'error' && !typing ? (
            <LoadError
              reason={table.reason}
              message={table.message}
              onRetry={table.retry}
            />
          ) : data !== null && data.rows.length === 0 ? (
            cursor.kind !== 'first' || page > 1 ? (
              <Notice
                action={
                  <Button
                    onClick={() => goTo({ page: 1, cursor: { kind: 'first' } })}
                  >
                    Ir a la primera página
                  </Button>
                }
              >
                Esta página ya no tiene especies: el catálogo cambió desde que
                se abrió el enlace.
              </Notice>
            ) : criteria ? (
              <Notice
                action={
                  <Button icon="x" onClick={clearAll}>
                    Limpiar búsqueda y filtros
                  </Button>
                }
              >
                Ninguna especie coincide con la búsqueda y los filtros.
              </Notice>
            ) : (
              <Notice icon="sprout">
                El catálogo está vacío. Se llena con la importación del{' '}
                <span lang="en">Catalogue of Life</span> (ver{' '}
                <code>scripts/catalog-import</code>).
              </Notice>
            )
          ) : (
            <SpeciesTable
              captionId={captionId}
              searching={prepared !== null}
              query={prepared}
              rows={data?.rows ?? null}
              skeletonRows={skeletonRows}
              selectedId={detailId}
              checked={selected}
              onCheck={toggleSelected}
              detailHref={detailHref}
              onOpen={(id) => {
                openDetail(id)
                if (!detailHref) onChange({ ...state, detailId: id })
              }}
            />
          )}
          {data !== null && data.total > CATALOG_PAGE_SIZE && (
            <Pagination
              label="Páginas de especies"
              page={data.page}
              pageCount={data.pageCount}
              hasPrevious={data.hasPrevious}
              hasNext={data.hasNext}
              onFirst={() => goTo({ page: 1, cursor: { kind: 'first' } })}
              onPrevious={() => {
                const first = data.rows[0]
                if (data.searching || data.page <= 2 || !first) {
                  goTo({
                    page: Math.max(data.page - 1, 1),
                    cursor: { kind: 'first' },
                  })
                } else {
                  goTo({
                    page: data.page - 1,
                    cursor: { kind: 'before', id: first.id },
                  })
                }
              }}
              onNext={() => {
                const last = data.rows.at(-1)
                if (data.searching || !last) {
                  goTo({ page: data.page + 1, cursor: { kind: 'first' } })
                } else {
                  goTo({
                    page: data.page + 1,
                    cursor: { kind: 'after', id: last.id },
                  })
                }
              }}
              onLast={() =>
                goTo({
                  page: data.pageCount,
                  cursor: data.searching ? { kind: 'first' } : { kind: 'last' },
                })
              }
            />
          )}
        </div>
        {creating ? (
          <section
            aria-labelledby={`${statusId}-alta`}
            className="flex flex-col gap-space-3 self-start rounded-lg bg-neutral-50 p-space-4"
          >
            <h2
              id={`${statusId}-alta`}
              ref={createHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold text-secondary"
            >
              Alta en el catálogo
            </h2>
            <SpeciesForm
              source={source}
              onCancel={() => {
                setCreating(false)
                addButtonRef.current?.focus()
              }}
              onSaved={(written) => {
                setCreating(false)
                setFocusRequest((value) => value + 1)
                setReturnFocusTo(written.id)
                onChange({ ...state, detailId: written.id })
                onCatalogChanged(createdMessage(written))
              }}
            />
          </section>
        ) : (
          detailId && (
            <SpeciesDetailPanel
              detail={detail}
              focusRequest={focusRequest}
              source={source}
              onChanged={onCatalogChanged}
              onDeleted={(message) => {
                setReturnFocusTo(detailId)
                onChange({ ...state, detailId: null })
                onCatalogChanged(message)
              }}
              onClose={() => {
                setReturnFocusTo(detailId)
                onChange({ ...state, detailId: null })
              }}
            />
          )
        )}
      </div>
    </div>
  )
}

function createdMessage(written: WrittenSpecies): string {
  const kind = written.type === 'hybrid' ? 'híbrido' : 'especie'
  return `Se dio de alta «${written.scientificName}» (${kind}, ${STATUS_LABEL[written.status].toLowerCase()}).`
}

function rowLinkId(speciesId: string): string {
  return `especie-${speciesId}`
}

// Tabla de especies. Con rows null, filas vacías con la forma de las reales
// (esqueleto) mientras llega la página. La tabla se desplaza en horizontal
// dentro de su contenedor, que es enfocable para poder moverla con el teclado.
function SpeciesTable({
  captionId,
  searching,
  query,
  rows,
  skeletonRows,
  selectedId,
  checked,
  onCheck,
  detailHref,
  onOpen,
}: {
  captionId: string
  searching: boolean
  query: string | null
  rows: readonly CatalogSpeciesRow[] | null
  skeletonRows: number
  selectedId: string | null
  /** Filas marcadas para el cambio de estado por lote. */
  checked: ReadonlySet<string>
  onCheck: (ids: readonly string[], value: boolean) => void
  detailHref: ((id: string) => string) | null
  onOpen: (id: string) => void
}) {
  const pageIds = rows?.map((row) => row.id) ?? []
  const checkedCount = pageIds.filter((id) => checked.has(id)).length
  const allChecked = pageIds.length > 0 && checkedCount === pageIds.length
  const th =
    'border-b-2 border-secondary px-space-3 py-space-2 text-left text-sm font-semibold whitespace-nowrap text-neutral-900'
  const td = 'border-b border-neutral-50 px-space-3 py-space-2 align-top'
  return (
    <div
      role="region"
      aria-labelledby={captionId}
      // La tabla se desplaza en horizontal dentro de este contenedor: es
      // enfocable para moverla con el teclado (regla scrollable-region-focusable).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-busy={rows === null}
      className="overflow-x-auto rounded-lg"
    >
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <caption id={captionId} className="sr-only">
          {searching
            ? `Especies que coinciden con «${query ?? ''}», por relevancia`
            : 'Especies del catálogo, en orden alfabético'}
        </caption>
        <thead>
          <tr>
            <th scope="col" className={`${th} w-[48px]`}>
              <input
                type="checkbox"
                className={CHECKBOX}
                aria-label="Seleccionar todas las especies de esta página"
                checked={allChecked}
                disabled={pageIds.length === 0}
                ref={(element) => {
                  if (element)
                    element.indeterminate = checkedCount > 0 && !allChecked
                }}
                onChange={(event) => onCheck(pageIds, event.target.checked)}
              />
            </th>
            <th scope="col" className={th}>
              Nombre científico
            </th>
            <th scope="col" className={th}>
              Género
            </th>
            <th scope="col" className={th}>
              Tipo
            </th>
            <th scope="col" className={th}>
              Estado
            </th>
            <th scope="col" className={th}>
              Fuente
            </th>
            <th scope="col" className={`${th} text-right`}>
              Sinónimos
            </th>
            <th scope="col" className={`${th} text-right`}>
              Nombres comunes
            </th>
          </tr>
        </thead>
        <tbody>
          {rows === null
            ? Array.from({ length: skeletonRows }, (_, index) => (
                <tr key={index} aria-hidden="true">
                  {Array.from({ length: 8 }, (_, cell) => (
                    <td key={cell} className={`${td} h-[49px]`}>
                      <span className="block h-space-4 w-3/4 rounded-sm bg-neutral-50 motion-safe:animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => {
                const match =
                  row.matchedName !== undefined && row.matchedNameType
                    ? speciesMatchText({
                        matchedName: row.matchedName,
                        matchedNameType: row.matchedNameType,
                      })
                    : undefined
                const selected = row.id === selectedId
                return (
                  <tr
                    key={row.id}
                    className={selected ? 'bg-primary-soft' : undefined}
                  >
                    <td className={td}>
                      <input
                        type="checkbox"
                        className={CHECKBOX}
                        aria-label={`Seleccionar ${row.scientificName}`}
                        checked={checked.has(row.id)}
                        onChange={(event) =>
                          onCheck([row.id], event.target.checked)
                        }
                      />
                    </td>
                    <th scope="row" className={`${td} text-left font-normal`}>
                      {detailHref ? (
                        <Link
                          id={rowLinkId(row.id)}
                          to={detailHref(row.id)}
                          aria-current={selected ? 'true' : undefined}
                          onClick={() => onOpen(row.id)}
                          className={NAME_LINK}
                        >
                          <ScientificName name={row.scientificName} />
                        </Link>
                      ) : (
                        <button
                          type="button"
                          id={rowLinkId(row.id)}
                          aria-current={selected ? 'true' : undefined}
                          onClick={() => onOpen(row.id)}
                          className={`${NAME_LINK} cursor-pointer text-left`}
                        >
                          <ScientificName name={row.scientificName} />
                        </button>
                      )}
                      {match && (
                        <span className="block text-xs text-neutral-700">
                          {match}
                        </span>
                      )}
                    </th>
                    <td className={td}>{row.genusName}</td>
                    <td className={td}>{TYPE_LABEL[row.type]}</td>
                    <td className={td}>
                      <SpeciesStatusBadge status={row.status} />
                    </td>
                    <td className={td}>{SOURCE_LABEL[row.source]}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {formatCount(row.synonymCount)}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {formatCount(row.commonNameCount)}
                    </td>
                  </tr>
                )
              })}
        </tbody>
      </table>
    </div>
  )
}

// Un filtro de una sola elección con chips: "Todos" y un chip por valor.
function FilterChips<T extends string>({
  label,
  options,
  labels,
  all,
  value,
  onChange,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  all: string
  value: T | undefined
  onChange: (value: T | undefined) => void
}) {
  const labelId = useId()
  return (
    <div className="flex flex-wrap items-center gap-space-2">
      <span
        id={labelId}
        className="w-[64px] text-sm font-semibold text-secondary"
      >
        {label}
      </span>
      <ChipGroup aria-labelledby={labelId}>
        <Chip
          className={CHIP}
          selected={value === undefined}
          onClick={() => onChange(undefined)}
        >
          {all}
        </Chip>
        {options.map((option) => (
          <Chip
            key={option}
            className={CHIP}
            selected={value === option}
            onClick={() => onChange(option)}
          >
            {labels[option]}
          </Chip>
        ))}
      </ChipGroup>
    </div>
  )
}

// Filtro por género: buscador de géneros (el del registro) y, con un género
// elegido, su nombre y "Quitar".
function GenusFilter({
  source,
  genusId,
  genusName,
  onChange,
}: {
  source: CatalogAdminSource
  genusId: string | null
  genusName: string | null
  onChange: (genusId: string | null) => void
}) {
  const [text, setText] = useState('')
  const search = useCatalogSearch(source.searchGenera, text, {
    enabled: genusId === null,
  })
  const labelId = useId()

  if (genusId !== null) {
    return (
      <div className="orki-field">
        <span id={labelId} className="orki-field__label">
          Género
        </span>
        <div
          role="group"
          aria-labelledby={labelId}
          className="flex flex-wrap items-center gap-space-3"
        >
          <span className="text-md font-semibold text-neutral-900">
            {genusName ?? 'Género elegido'}
          </span>
          <Button
            icon="x"
            onClick={() => {
              setText('')
              onChange(null)
            }}
          >
            Quitar <span className="sr-only">el filtro de género</span>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Autocomplete
      label="Género"
      value={text}
      onValueChange={setText}
      options={search.results.map((genus) => ({
        id: genus.id,
        label: genus.name,
        secondary: genus.matchedAbbreviation
          ? `Abreviatura: ${genus.matchedAbbreviation}`
          : undefined,
      }))}
      onOptionSelect={(option) => onChange(option.id)}
      loading={search.status === 'loading'}
      error={search.error?.message}
      minQueryLength={2}
      placeholder="Nombre o abreviatura"
      emptyText="Ningún género coincide"
    />
  )
}
