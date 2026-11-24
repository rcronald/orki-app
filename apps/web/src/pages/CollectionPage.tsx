import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import type { PlantFilters } from '../collection/filters.ts'
import { countGenera, countPlants } from '../collection/selectors.ts'
import { useCollection } from '../collection/useCollection.ts'
import {
  useCollectionCopy,
  useOwnershipExtras,
} from '../collection/useCollectionCopy.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { Page } from '../components/Page.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { ActionNotice } from '../detail/ActionNotice.tsx'
import { clearPlantNotice, peekPlantNotice } from '../detail/notice.ts'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { CollectionActions } from '../inventory/CollectionActions.tsx'
import { readFilters, writeFilters } from '../inventory/filter-params.ts'
import { InventoryView } from '../inventory/InventoryView.tsx'
import {
  OfflineNotice,
  type OfflineNoticeReason,
} from '../inventory/OfflineNotice.tsx'
import { readRegisteredPlant } from '../inventory/registered-plant.ts'
import { RegisteredNotice } from '../inventory/RegisteredNotice.tsx'
import { useScrollMemory } from '../inventory/scroll-memory.ts'
import { collectionSummaryText } from '../inventory/texts.ts'
import { useUrlFieldText } from '../routes/useUrlFieldText.ts'

/** Parámetro de la URL con el texto del buscador: /coleccion?q=phal. */
const SEARCH_PARAM = 'q'

// Inventario de la colección del usuario (#14): conecta la pantalla con la
// colección compartida (useCollection). Exige sesión.
//
// El texto buscado (?q=) y los filtros del #15 (?estado=, ?genero=, ?color=,
// ?origen=; ver inventory/filter-params.ts) viven en la URL: se conservan al
// volver con "atrás" desde el registro, el detalle o «¿Ya la tengo?», al
// recargar y al
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
// Cabecera (#208, PageHeader a través de Page): «Mi colección», el contador
// de ejemplares activos y sus géneros, y las acciones «Registrar orquídea» y
// «¿Ya la tengo?» (CollectionActions). La consulta «¿Ya la tengo?» vive en su
// propia pantalla (#209): aquí hay un único buscador, que filtra las
// tarjetas. Con los sinónimos, nombres comunes y abreviaturas de la copia
// local (#18, useCollectionCopy), la lista encuentra también las plantas por
// esos nombres, también sin conexión (InventoryView, extras). /coleccion?q=…
// abre el inventario con ese texto en el buscador: es lo que usa «Ver en mi
// colección» desde la consulta.
//
// Sin conexión (#18, #120): bajo la cabecera, el indicador con la fecha de la
// última actualización de la copia local, y los accesos a registrar
// desactivados citándolo. Buscar, filtrar, ver el detalle, «¿Ya la tengo?» y
// exportar siguen funcionando.

function deletedNotice() {
  const notice = peekPlantNotice()
  return notice?.kind === 'deleted' ? notice : null
}

export function CollectionPage() {
  const { status, plants, error, reload } = useCollection()
  const copy = useCollectionCopy()
  const extras = useOwnershipExtras()
  const readOnly = useReadOnly()
  const offlineNoticeId = useId()
  const offlineReason: OfflineNoticeReason | null =
    readOnly ?? (copy?.unreachable === 'offline' ? 'unreachable' : null)
  const writeDisabledBy = readOnly === null ? undefined : offlineNoticeId
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get(SEARCH_PARAM) ?? ''
  // El campo tiene estado propio y la dirección solo manda en las navegaciones
  // que no son de esta pantalla (ver useUrlFieldText): lo que escribe aquí en
  // la dirección (el buscador, los filtros, limpiar el estado) va siempre con
  // `replace`.
  const [query, setQueryText] = useUrlFieldText(urlQuery)
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
      setQueryText(value)
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
    [setSearchParams, setQueryText],
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

  // El contador de la cabecera: solo cambia con la colección, no al buscar.
  const summary = useMemo(() => {
    if (plants === null) return null
    const count = countPlants(plants)
    return count === 0
      ? null
      : collectionSummaryText(count, countGenera(plants))
  }, [plants])
  // Con la colección vacía, la llamada a registrar la primera va en el cuerpo
  // (EmptyCollection): sin acciones arriba, una sola acción principal.
  const empty = plants !== null && plants.length === 0

  return (
    <Page
      title="Mi colección"
      width="wide"
      header={{
        meta: summary ?? undefined,
        actions: empty ? undefined : (
          <CollectionActions disabledBy={writeDisabledBy} />
        ),
      }}
    >
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
        extras={extras}
        writeDisabledBy={writeDisabledBy}
      />
    </Page>
  )
}
