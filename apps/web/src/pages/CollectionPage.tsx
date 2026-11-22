import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { countActiveFilters, type PlantFilters } from '../collection/filters.ts'
import { useCollection } from '../collection/useCollection.ts'
import { useCollectionCopy } from '../collection/useCollectionCopy.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { Page } from '../components/Page.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { ActionNotice } from '../detail/ActionNotice.tsx'
import { clearPlantNotice, peekPlantNotice } from '../detail/notice.ts'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { readFilters, writeFilters } from '../inventory/filter-params.ts'
import { InventoryView } from '../inventory/InventoryView.tsx'
import {
  OfflineNotice,
  type OfflineNoticeReason,
} from '../inventory/OfflineNotice.tsx'
import { OwnershipPanel } from '../inventory/OwnershipPanel.tsx'
import { readRegisteredPlant } from '../inventory/registered-plant.ts'
import { RegisteredNotice } from '../inventory/RegisteredNotice.tsx'
import { useScrollMemory } from '../inventory/scroll-memory.ts'
import { useHaveItSearchEvents } from '../telemetry/useHaveItSearchEvents.ts'

/** Parámetro de la URL con el texto del buscador: /coleccion?q=phal. */
const SEARCH_PARAM = 'q'

// Inventario de la colección del usuario (#14): conecta la pantalla con la
// colección compartida (useCollection). Exige sesión.
//
// El texto buscado (?q=) y los filtros del #15 (?estado=, ?genero=, ?color=,
// ?origen=; ver inventory/filter-params.ts) viven en la URL: se conservan al
// volver con "atrás" desde el registro o el detalle, al recargar y al
// compartir el enlace, sin estado propio que sincronizar. Cada pulsación y
// cada toque de un filtro sustituyen la entrada del historial (replace) en
// lugar de añadir una: "atrás" sale del inventario en vez de deshacer los
// toques uno a uno, y la entrada del inventario guarda siempre el último
// estado, que es el que se recupera al volver del detalle. La posición de
// desplazamiento la guarda useScrollMemory.
//
// Al volver del registro (#85), el estado de la navegación trae la planta
// recién registrada: se muestra un aviso de confirmación y se borra ese
// estado del historial, para que recargar o volver con "atrás" no lo repita.
// Al volver de eliminar una planta (#16), "Eliminaste…" (detail/notice.ts).
//
// Bajo el buscador, la respuesta de "¿Ya la tengo?" (#19, OwnershipPanel),
// sobre toda la colección y sin esperar a la red. Con los sinónimos, nombres
// comunes y abreviaturas de la copia local (#18, useOwnershipExtras), también
// sin conexión; la lista recibe los mismos extras para encontrar también las
// plantas por esos nombres (InventoryView, extras). Su prop onMeasure envía el evento de producto de esa búsqueda
// (#146, useHaveItSearchEvents: uno por búsqueda, nunca el texto).
//
// Sin conexión (#18, #120): arriba, el indicador con la fecha de la última
// actualización de la copia local, y los accesos a registrar desactivados
// citándolo. Buscar, filtrar, ver el detalle y exportar siguen funcionando.

const NO_EXTRAS = {}

function deletedNotice() {
  const notice = peekPlantNotice()
  return notice?.kind === 'deleted' ? notice : null
}

export function CollectionPage() {
  const { status, plants, error, reload } = useCollection()
  const copy = useCollectionCopy()
  const extras = copy?.extras ?? NO_EXTRAS
  const readOnly = useReadOnly()
  const offlineNoticeId = useId()
  const offlineReason: OfflineNoticeReason | null =
    readOnly ?? (copy?.unreachable === 'offline' ? 'unreachable' : null)
  const writeDisabledBy = readOnly === null ? undefined : offlineNoticeId
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get(SEARCH_PARAM) ?? ''
  const onOwnershipMeasure = useHaveItSearchEvents({
    searching: query.trim() !== '',
    offline: readOnly !== null,
  })
  const location = useLocation()
  const navigate = useNavigate()
  const [registered, setRegistered] = useState(() =>
    readRegisteredPlant(location.state),
  )
  const hasRegisteredState = readRegisteredPlant(location.state) !== null
  const [pendingDeleted] = useState(deletedNotice)
  const [deleted, setDeleted] = useState(pendingDeleted)
  useEffect(() => {
    if (pendingDeleted !== null) clearPlantNotice(pendingDeleted)
  }, [pendingDeleted])

  useEffect(() => {
    if (!hasRegisteredState) return
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null, preventScrollReset: true },
    )
  }, [hasRegisteredState, location.pathname, location.search, navigate])

  const setQuery = useCallback(
    (value: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === '') next.delete(SEARCH_PARAM)
          else next.set(SEARCH_PARAM, value)
          return next
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [setSearchParams],
  )

  // Un objeto nuevo solo cuando cambian los filtros, no al escribir en el
  // buscador: los derivados de la vista dependen de su identidad.
  const filterSearch = writeFilters(
    new URLSearchParams(),
    readFilters(searchParams),
  ).toString()
  const filters = useMemo(
    () => readFilters(new URLSearchParams(filterSearch)),
    [filterSearch],
  )
  const setFilters = useCallback(
    (next: PlantFilters) => {
      setSearchParams((current) => writeFilters(current, next), {
        replace: true,
        preventScrollReset: true,
      })
    },
    [setSearchParams],
  )

  useScrollMemory(plants !== null)

  return (
    <Page title="Mi colección" width="wide">
      {/* Región siempre montada: así se anuncia al perder la conexión. Vacía,
          sin el hueco de la separación de la página. */}
      <div role="status" className="empty:mt-[calc(var(--space-3)*-1)]">
        {offlineReason !== null && (
          <OfflineNotice
            id={offlineNoticeId}
            reason={offlineReason}
            savedAt={copy?.savedAt ?? null}
          />
        )}
      </div>
      {registered && (
        <RegisteredNotice
          key={registered.id}
          plant={registered}
          onDismiss={() => setRegistered(null)}
        />
      )}
      {deleted && (
        <ActionNotice key={deleted.plantId} onDismiss={() => setDeleted(null)}>
          {DETAIL_TEXT.deleted}{' '}
          {deleted.scientific ? (
            <span className="font-display italic">
              <ScientificName name={deleted.name} />
            </span>
          ) : (
            <span className="font-semibold">{deleted.name}</span>
          )}
          .{!deleted.photosDeleted && ` ${DETAIL_TEXT.deletedPhotosLeft}`}
        </ActionNotice>
      )}
      <InventoryView
        status={status}
        plants={plants}
        error={error}
        onRetry={reload}
        query={query}
        onQueryChange={setQuery}
        filters={filters}
        onFiltersChange={setFilters}
        searchResult={
          <OwnershipPanel
            plants={plants}
            query={query}
            filtered={countActiveFilters(filters) > 0}
            extras={extras}
            registerDisabledBy={writeDisabledBy}
            onMeasure={onOwnershipMeasure}
          />
        }
        extras={extras}
        writeDisabledBy={writeDisabledBy}
      />
    </Page>
  )
}
