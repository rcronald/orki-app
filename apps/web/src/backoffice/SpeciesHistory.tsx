import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from '../components/ui/Button.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import {
  catalogAdminFailure,
  CATALOG_ADMIN_ERROR_TEXT,
  type AuditRowChange,
  type AuditValues,
  type CatalogSpeciesDetail,
  type SpeciesHistoryEntry,
  type SpeciesHistoryPage,
} from '../lib/catalogAdmin.ts'
import { LoadError } from './parts.tsx'
import type { CatalogAdminSource } from './source.ts'
import {
  actorText,
  AUDIT_FIELD_LABEL,
  auditActionLabel,
  changeCountText,
  formatCount,
  formatDateTime,
  NAME_TYPE_LABEL,
  rowChangeLabel,
  SOURCE_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
} from './texts.ts'
import { useRemoteData, type RemoteFailure } from './useRemoteData.ts'

// Historial de una especie en su detalle (#133): lo que cambió en la especie
// y en sus nombres, de lo más reciente a lo más antiguo, leído de la
// auditoría del catálogo. Cada entrada es una acción: fecha, quién (el id de
// Clerk abreviado o la carga), qué hizo en palabras y los valores que
// cambiaron (antes → después). Una acción con sentido propio (una fusión) es
// una sola entrada con sus cambios dentro.
//
// - La primera página se lee con useRemoteData y se vuelve a leer cuando sube
//   `revision` (tras guardar un cambio en el panel), sin pasar por "cargando".
// - "Ver más" pide la página siguiente por clave y la añade; al volver a leer
//   la primera, las añadidas se descartan (la lista empieza de nuevo).
// - Al cargar más, el foco va a la primera entrada nueva y se anuncia cuántas
//   llegaron.

export interface SpeciesHistoryProps {
  species: CatalogSpeciesDetail
  source: CatalogAdminSource
  /** Cambia tras cada escritura: el historial se vuelve a leer. */
  revision: number
}

/** Páginas añadidas con "Ver más" a una primera página concreta. */
interface MoreState {
  base: SpeciesHistoryPage
  entries: SpeciesHistoryEntry[]
  hasMore: boolean
  status: 'idle' | 'loading' | 'error'
  reason?: RemoteFailure
  /** Cuántas llegaron en la última página, para anunciarlo. */
  added?: number
}

export function SpeciesHistory({
  species,
  source,
  revision,
}: SpeciesHistoryProps) {
  const headingId = useId()
  const entryIdPrefix = useId()
  const first = useRemoteData(
    species.id,
    (signal) => source.speciesHistory(species.id, { signal }),
    { revision },
  )
  const [more, setMore] = useState<MoreState | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  // Entrada que toma el foco en el pintado siguiente (la primera nueva).
  const focusEntry = useRef<number | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])
  useEffect(() => {
    if (focusEntry.current === null) return
    document.getElementById(`${entryIdPrefix}-${focusEntry.current}`)?.focus()
    focusEntry.current = null
  })

  const page = first.status === 'success' ? first.data : null
  // Lo añadido con "Ver más" solo vale para la primera página a la que se
  // añadió: si se vuelve a leer, se descarta.
  const extra = page !== null && more?.base === page ? more : null
  const entries = page ? [...page.entries, ...(extra?.entries ?? [])] : []
  const hasMore = extra ? extra.hasMore : (page?.hasMore ?? false)

  const loadMore = () => {
    const last = entries.at(-1)
    if (page === null || last === undefined || extra?.status === 'loading')
      return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const loaded = extra?.entries ?? []
    setMore({ base: page, entries: loaded, hasMore: true, status: 'loading' })
    source
      .speciesHistory(species.id, {
        before: last.id,
        signal: controller.signal,
      })
      .then(
        (next) => {
          if (controller.signal.aborted) return
          setMore({
            base: page,
            entries: [...loaded, ...next.entries],
            hasMore: next.hasMore,
            status: 'idle',
            added: next.entries.length,
          })
          const firstNew = next.entries[0]
          if (firstNew) focusEntry.current = firstNew.id
        },
        (error: unknown) => {
          const reason = catalogAdminFailure(error)
          if (controller.signal.aborted || reason === 'aborted') return
          setMore({
            base: page,
            entries: loaded,
            hasMore: true,
            status: 'error',
            reason,
          })
        },
      )
  }

  const names = new Map(species.names.map((name) => [name.id, name.name]))

  let body: ReactNode
  if (first.status === 'loading' || first.status === 'idle') {
    body = (
      <>
        <p role="status" className="sr-only">
          Cargando el historial…
        </p>
        <div aria-hidden="true" className="flex flex-col gap-space-2">
          {['w-1/2', 'w-3/4', 'w-1/2'].map((width, index) => (
            <div
              key={index}
              className={`h-space-4 rounded-sm bg-neutral-0 motion-safe:animate-pulse ${width}`}
            />
          ))}
        </div>
      </>
    )
  } else if (first.status === 'error') {
    body = (
      <LoadError
        compact
        reason={first.reason}
        message={first.message}
        onRetry={first.retry}
      />
    )
  } else if (entries.length === 0) {
    body = <p className="text-sm text-neutral-700">Sin cambios registrados.</p>
  } else {
    body = (
      <>
        <ol
          aria-labelledby={headingId}
          aria-busy={first.refreshing ? true : undefined}
          className="flex flex-col gap-space-2"
        >
          {entries.map((entry) => (
            <HistoryItem
              key={entry.id}
              id={`${entryIdPrefix}-${entry.id}`}
              entry={entry}
              names={names}
            />
          ))}
        </ol>
        {extra?.status === 'error' && extra.reason && (
          <p role="alert" className="text-sm text-neutral-900">
            No se pudieron cargar más cambios.{' '}
            {CATALOG_ADMIN_ERROR_TEXT[extra.reason]}
          </p>
        )}
        {hasMore && (
          <div>
            <Button
              onClick={loadMore}
              aria-disabled={extra?.status === 'loading' ? true : undefined}
              className="py-space-2"
            >
              {extra?.status === 'loading'
                ? 'Cargando…'
                : extra?.status === 'error'
                  ? 'Reintentar'
                  : 'Ver más'}{' '}
              <span className="sr-only">cambios del historial</span>
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-space-2">
      <h3 id={headingId} className="text-sm font-semibold text-neutral-900">
        Historial
      </h3>
      {body}
      <p role="status" className="sr-only">
        {extra?.status === 'loading'
          ? 'Cargando más cambios…'
          : extra?.added !== undefined
            ? `Se cargaron ${changeCountText(extra.added)} más del historial.`
            : ''}
      </p>
    </section>
  )
}

function HistoryItem({
  id,
  entry,
  names,
}: {
  id: string
  entry: SpeciesHistoryEntry
  names: ReadonlyMap<string, string>
}) {
  // La entrada se titula con la acción o, si son solo cambios de fila, con el
  // de la especie (una baja con sus nombres es "Baja"). Ese cambio se muestra
  // sin subtítulo; los demás, cada uno con el suyo.
  const main =
    entry.action === null
      ? (entry.changes.find((change) => change.table === 'species') ??
        entry.changes[0])
      : undefined
  const title =
    entry.action !== null
      ? auditActionLabel(entry.action)
      : main
        ? changeTitle(main, names)
        : 'Cambio'
  const rest = entry.changes.filter((change) => change !== main)

  return (
    <li
      id={id}
      tabIndex={-1}
      className="flex flex-col gap-space-1 rounded-md bg-neutral-0 p-space-3"
    >
      <p className="text-md font-semibold text-neutral-900 [overflow-wrap:anywhere]">
        {title}
      </p>
      <p className="text-sm text-neutral-700 [overflow-wrap:anywhere]">
        <time dateTime={entry.createdAt}>
          {formatDateTime(entry.createdAt)}
        </time>{' '}
        · por <span title={entry.actor}>{actorText(entry.actor)}</span>
      </p>
      {main && <ChangeValues change={main} genusNames={entry.genusNames} />}
      {rest.length > 0 && (
        <ul className="flex flex-col gap-space-1">
          {rest.map((change, index) => (
            <li key={index} className="flex flex-col gap-space-1">
              <p className="text-sm font-semibold text-neutral-900 [overflow-wrap:anywhere]">
                {changeTitle(change, names)}
              </p>
              <ChangeValues change={change} genusNames={entry.genusNames} />
            </li>
          ))}
        </ul>
      )}
      {entry.otherChangeCount > 0 && (
        <p className="text-sm text-neutral-700">
          Y {changeCountText(entry.otherChangeCount)} en otras filas del
          catálogo.
        </p>
      )}
    </li>
  )
}

/** "Nombre añadido: «Laelia purpurata»", "Edición"... */
function changeTitle(
  change: AuditRowChange,
  names: ReadonlyMap<string, string>,
): string {
  const label = rowChangeLabel(change.table, change.action)
  if (change.table !== 'species_names') return label
  const values = change.newValues ?? change.oldValues
  const name =
    typeof values?.name === 'string' ? values.name : names.get(change.rowId)
  return name === undefined ? label : `${label}: «${name}»`
}

/** Los valores que cambiaron: antes → después; en un alta o una baja, uno. */
function ChangeValues({
  change,
  genusNames,
}: {
  change: AuditRowChange
  genusNames: Record<string, string>
}) {
  const fields = (AUDIT_FIELD_LABEL[change.table] ?? []).filter(
    ([key]) =>
      (change.oldValues !== null && key in change.oldValues) ||
      (change.newValues !== null && key in change.newValues),
  )
  if (fields.length === 0) return null
  const show = (key: string, values: AuditValues | null) => (
    <FieldValue
      table={change.table}
      field={key}
      value={values?.[key]}
      genusNames={genusNames}
    />
  )
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-space-3 gap-y-space-1 text-sm">
      {fields.map(([key, label]) => (
        <Fragment key={key}>
          <dt className="font-semibold text-neutral-700">{label}</dt>
          <dd className="text-neutral-900 [overflow-wrap:anywhere]">
            {change.action === 'update' ? (
              <>
                <span className="sr-only">antes: </span>
                {show(key, change.oldValues)} <span aria-hidden="true">→</span>
                <span className="sr-only">, después:</span>{' '}
                {show(key, change.newValues)}
              </>
            ) : change.action === 'insert' ? (
              show(key, change.newValues)
            ) : (
              show(key, change.oldValues)
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

function FieldValue({
  table,
  field,
  value,
  genusNames,
}: {
  table: string
  field: string
  value: AuditValues[string]
  genusNames: Record<string, string>
}) {
  if (value === null || value === undefined) {
    return <span className="text-neutral-700">sin valor</span>
  }
  if (typeof value === 'string') {
    if (field === 'genus_id') {
      return <>{genusNames[value] ?? 'un género que ya no existe'}</>
    }
    if (table === 'species' && field === 'scientific_name') {
      return (
        <span className="scientific-name">
          <ScientificName name={value} />
        </span>
      )
    }
    const label = labelOf(table, field, value)
    return <>{label ?? value}</>
  }
  if (typeof value === 'number') return <>{formatCount(value)}</>
  if (typeof value === 'boolean') return <>{value ? 'Sí' : 'No'}</>
  return <>{JSON.stringify(value)}</>
}

/** Nombre en palabras de un valor de enumerado, si lo es. */
function labelOf(table: string, field: string, value: string): string | null {
  const labels: Partial<Record<string, string>> | null =
    field === 'status'
      ? STATUS_LABEL
      : field === 'source'
        ? SOURCE_LABEL
        : field === 'type'
          ? table === 'species_names'
            ? NAME_TYPE_LABEL
            : TYPE_LABEL
          : null
  return labels?.[value] ?? null
}
