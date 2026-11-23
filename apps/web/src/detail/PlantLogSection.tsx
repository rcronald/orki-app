import { useEffect, useId, useRef, useState, type ComponentType } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import type { ReadOnlyReason } from '../collection/useReadOnly.ts'
import { Button } from '../components/ui/Button.tsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import type { PlantLogEntryType } from '../lib/database.ts'
import type { AddLogEntryDialogProps } from '../log/AddLogEntryDialog.tsx'
import { plantLogErrorFrom } from '../log/entries.ts'
import { LogEntryItem } from '../log/LogEntryItem.tsx'
import { LOG_ENTRY_TYPES, LOG_TYPE_LABEL, type LogEntry } from '../log/model.ts'
import { deleteLogEntry } from '../log/save.ts'
import { usePlantLogServices } from '../log/services.ts'
import {
  LOG_DELETE_ERROR_TEXT,
  LOG_LOAD_ERROR_TEXT,
  LOG_TEXT,
} from '../log/texts.ts'
import { usePlantLog } from '../log/usePlantLog.ts'

export interface PlantLogSectionProps {
  plant: CollectionPlant
  /** null si se puede escribir; si no, por qué no (#18). */
  readOnly: ReadOnlyReason | null
  /** Dueño de la planta (id de Clerk); sin él no se lee ni se escribe. */
  userId: string | null
}

// El formulario «Nuevo registro de bitácora» va en su propio chunk (lleva la
// preparación de fotos y el formulario): se pide al montar la sección con
// conexión y, si aún no llegó, al pulsar «Añadir registro».
type DialogComponent = ComponentType<AddLogEntryDialogProps>
let dialogModule: Promise<DialogComponent> | undefined
function loadDialog(): Promise<DialogComponent> {
  dialogModule ??= import('../log/AddLogEntryDialog.tsx').then(
    (module) => module.AddLogEntryDialog,
    (error: unknown) => {
      dialogModule = undefined
      throw error
    },
  )
  return dialogModule
}

interface Deleting {
  entry: LogEntry
  busy: boolean
  error: string | null
}

/**
 * Bitácora del ejemplar en la ficha (#267, maqueta «Ficha de la planta» del
 * #263): a todo el ancho, entre las dos columnas y «Gestionar planta».
 *
 * - Cabecera: el título «Bitácora» (h2) y «Añadir registro», la acción
 *   principal de la sección; debajo, el filtro por actividad (un desplegable,
 *   «Todas las actividades», como la maqueta de la ficha).
 * - La lista, del más reciente al más antiguo (LogEntryItem), y «Cargar más»
 *   si hay más páginas.
 * - Estados: cargando, sin registros (con la invitación a añadir), filtro sin
 *   resultados (con «Ver todas»), error con «Reintentar».
 * - Sin conexión (o sin la sesión confirmada) no hay copia en el dispositivo:
 *   lo dice, y «Añadir registro» y «Eliminar» quedan desactivados con el
 *   motivo. Lo ya leído se sigue viendo.
 * - Tras guardar, el registro nuevo queda arriba: si el filtro lo escondería,
 *   se quita y se dice. El foco vuelve a «Añadir registro» (lo devuelve el
 *   diálogo) y la región de estado lo anuncia una vez.
 * - Eliminar pide confirmación (ConfirmDialog); al borrar, el foco pasa al
 *   registro siguiente (o al anterior, o a «Añadir registro» si no queda
 *   ninguno).
 */
export function PlantLogSection({
  plant,
  readOnly,
  userId,
}: PlantLogSectionProps) {
  const titleId = useId()
  const filterId = useId()
  const reasonId = useId()
  const services = usePlantLogServices()
  const writable = readOnly === null && userId !== null
  const log = usePlantLog(plant.id, writable)
  const addButton = useRef<HTMLButtonElement>(null)
  const filterRef = useRef<HTMLSelectElement>(null)
  const loadMoreRef = useRef<HTMLButtonElement>(null)
  const articles = useRef(new Map<string, HTMLElement>())
  const [Dialog, setDialog] = useState<DialogComponent | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Deleting | null>(null)
  // Anuncio de la región de estado. Un mismo texto dos veces seguidas lleva
  // un espacio de ancho cero al final, para que cambie y se vuelva a leer.
  const [status, setStatus] = useState('')
  // A dónde llevar el foco cuando la lista se haya pintado.
  const pendingFocus = useRef<
    ((entries: readonly LogEntry[]) => HTMLElement | null) | null
  >(null)
  // Vuelve a pintar para llevar el foco cuando la lista ya cambió antes.
  const [, setFocusTick] = useState(0)

  const announce = (text: string) =>
    setStatus((current) => (current === text ? `${text}\u200b` : text))

  useEffect(() => {
    if (!writable) return
    let active = true
    loadDialog().then(
      (component) => {
        if (active) setDialog(() => component)
      },
      () => {},
    )
    return () => {
      active = false
    }
  }, [writable])

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    target(log.entries)?.focus()
  })

  const openAdd = () => {
    if (!writable) return
    if (Dialog) {
      setAdding(true)
      return
    }
    loadDialog().then(
      (component) => {
        setDialog(() => component)
        setAdding(true)
      },
      () => announce(LOG_LOAD_ERROR_TEXT.offline),
    )
  }

  const onSaved = (entry: LogEntry) => {
    setAdding(false)
    const hidden = log.filter !== null && log.filter !== entry.type
    if (hidden) {
      const previous = LOG_TYPE_LABEL[log.filter ?? entry.type]
      log.setFilter(null)
      announce(
        `${LOG_TEXT.saved(entry.title)} ${LOG_TEXT.filterCleared(previous)}`,
      )
    } else {
      log.prepend(entry)
      announce(LOG_TEXT.saved(entry.title))
    }
  }

  const confirmDelete = async () => {
    if (deleting === null || deleting.busy || userId === null) return
    const { entry } = deleting
    setDeleting({ entry, busy: true, error: null })
    try {
      await deleteLogEntry({
        userId,
        entry,
        entries: services.entries,
        storage: services.storage,
      })
    } catch (error) {
      setDeleting({
        entry,
        busy: false,
        error: LOG_DELETE_ERROR_TEXT[plantLogErrorFrom(error).reason],
      })
      return
    }
    const index = log.entries.findIndex((item) => item.id === entry.id)
    const next = log.entries[index + 1] ?? log.entries[index - 1] ?? null
    pendingFocus.current = () =>
      (next && articles.current.get(next.id)) ?? addButton.current
    setDeleting(null)
    log.remove(entry.id)
    announce(LOG_TEXT.deleted(entry.title))
  }

  const loadMore = async () => {
    const before = log.entries.length
    const added = await log.loadMore()
    if (added === 0) return
    // Si «Cargar más» sigue, el foco se queda en él; si desaparece (no hay
    // más), va al primero de los nuevos.
    pendingFocus.current = (entries) => {
      if (loadMoreRef.current) return null
      const first = entries[before]
      return first ? (articles.current.get(first.id) ?? null) : null
    }
    setFocusTick((tick) => tick + 1)
    announce(LOG_TEXT.loadedMore(added))
  }

  const filterLabel = log.filter === null ? null : LOG_TYPE_LABEL[log.filter]
  const unavailable = !writable
  const reason =
    readOnly === 'unverified' ? LOG_TEXT.unverified : LOG_TEXT.offline

  let body
  if (log.status === 'error' && log.entries.length === 0) {
    body = (
      <p className="orki-viewer__notice">
        <Icon name="triangle-alert" />
        <span>{LOG_LOAD_ERROR_TEXT[log.error ?? 'failed']}</span>
        {writable && <Button onClick={log.reload}>{LOG_TEXT.retry}</Button>}
      </p>
    )
  } else if (log.status === 'loading' && log.entries.length === 0) {
    body = <p className="text-md text-neutral-700">{LOG_TEXT.loading}</p>
  } else if (log.status === 'ready' && log.entries.length === 0) {
    body =
      filterLabel === null ? (
        <div className="flex flex-col gap-space-1 rounded-lg border border-dashed border-neutral-200 p-space-5 text-center">
          <p className="text-md font-semibold text-neutral-900">
            {LOG_TEXT.emptyTitle}
          </p>
          <p className="text-md text-neutral-700">{LOG_TEXT.empty}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-space-3 rounded-lg border border-dashed border-neutral-200 p-space-5 text-center">
          <p className="text-md text-neutral-900">
            {LOG_TEXT.filterEmpty(filterLabel)}
          </p>
          <Button
            onClick={() => {
              pendingFocus.current = () => filterRef.current
              log.setFilter(null)
              announce(LOG_TEXT.showing(null))
            }}
          >
            {LOG_TEXT.showAll}
          </Button>
        </div>
      )
  } else if (log.entries.length > 0) {
    body = (
      <ol
        className="flex flex-col gap-space-3"
        aria-label={LOG_TEXT.listLabel}
        aria-busy={log.status === 'loading' || undefined}
      >
        {log.entries.map((entry) => (
          <LogEntryItem
            key={entry.id}
            entry={entry}
            articleRef={(node) => {
              if (node) articles.current.set(entry.id, node)
              else articles.current.delete(entry.id)
            }}
            canDelete={writable}
            reasonId={unavailable ? reasonId : undefined}
            onDelete={(target) =>
              setDeleting({ entry: target, busy: false, error: null })
            }
          />
        ))}
      </ol>
    )
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-space-4 border-t border-neutral-200 pt-space-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <h2 id={titleId} className="orki-panel__title">
          {LOG_TEXT.title}
        </h2>
        <Button
          ref={addButton}
          variant="primary"
          icon="plus"
          aria-disabled={unavailable || undefined}
          aria-describedby={unavailable ? reasonId : undefined}
          onClick={openAdd}
        >
          {LOG_TEXT.add}
        </Button>
      </div>

      {unavailable && (
        <p
          id={reasonId}
          className="flex items-start gap-space-2 rounded-lg bg-neutral-50 p-space-4 text-md text-neutral-900"
        >
          <Icon name="cloud-off" className="mt-[2px] size-[20px] flex-none" />
          {reason}
        </p>
      )}

      {(writable || log.entries.length > 0) && (
        // Sin el aspecto nativo (Safari ignora el alto de un select nativo
        // y lo deja en 26 px), con la flecha del sistema encima.
        <div className="relative flex self-start">
          <label htmlFor={filterId} className="sr-only">
            {LOG_TEXT.filterLabel}
          </label>
          <select
            ref={filterRef}
            id={filterId}
            className="orki-field__input min-h-[48px] w-auto max-w-[100%] min-w-[240px] cursor-pointer appearance-none pr-[44px] publico-estrecho:min-w-[200px]"
            value={log.filter ?? ''}
            onChange={(event) => {
              const value = event.target.value
              const next = value === '' ? null : (value as PlantLogEntryType)
              log.setFilter(next)
              announce(
                LOG_TEXT.showing(next === null ? null : LOG_TYPE_LABEL[next]),
              )
            }}
          >
            <option value="">{LOG_TEXT.allTypes}</option>
            {LOG_ENTRY_TYPES.map((type) => (
              <option key={type} value={type}>
                {LOG_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
          <Icon
            name="chevron-down"
            className="pointer-events-none absolute top-[50%] right-space-3 size-[20px] -translate-y-[50%] text-neutral-900"
          />
        </div>
      )}

      {body}

      {log.entries.length > 0 && log.moreError !== null && (
        <p className="orki-viewer__notice">
          <Icon name="triangle-alert" />
          <span>{LOG_LOAD_ERROR_TEXT[log.moreError]}</span>
          {writable && (
            <Button onClick={() => void loadMore()}>{LOG_TEXT.retry}</Button>
          )}
        </p>
      )}
      {log.entries.length > 0 && log.hasMore && log.moreError === null && (
        <div className="flex justify-center">
          <Button
            ref={loadMoreRef}
            aria-disabled={unavailable || log.loadingMore || undefined}
            aria-describedby={unavailable ? reasonId : undefined}
            onClick={() => {
              if (!unavailable && !log.loadingMore) void loadMore()
            }}
          >
            {log.loadingMore ? LOG_TEXT.loadingMore : LOG_TEXT.loadMore}
          </Button>
        </div>
      )}

      <p role="status" className="sr-only">
        {status}
      </p>

      {adding && Dialog && userId !== null && (
        <Dialog
          plant={plant}
          userId={userId}
          online={writable}
          onCancel={() => setAdding(false)}
          onSaved={onSaved}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={LOG_TEXT.deleteTitle}
          description={LOG_TEXT.deleteDescription(
            deleting.entry.title,
            deleting.entry.photoPath !== null,
          )}
          confirmLabel={LOG_TEXT.deleteConfirm}
          busyLabel={LOG_TEXT.deleteBusy}
          confirmVariant="danger"
          initialFocus="cancel"
          busy={deleting.busy}
          confirmDisabled={unavailable}
          confirmDescribedBy={unavailable ? reasonId : undefined}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        >
          {deleting.error && (
            <p role="alert" className="orki-viewer__error">
              <Icon name="triangle-alert" />
              {deleting.error}
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  )
}
