import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { PLANT_STATUS_LABEL } from '../collection/labels.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { Page } from '../components/Page.tsx'
import { ActionNotice } from '../detail/ActionNotice.tsx'
import { BackToCollection } from '../detail/BackToCollection.tsx'
import { cameFromInventory } from '../detail/navigation.ts'
import {
  clearPlantNotice,
  leavePlantNotice,
  peekPlantNotice,
} from '../detail/notice.ts'
import {
  PlantActions,
  type PlantActionServices,
} from '../detail/PlantActions.tsx'
import { PlantDetailView, PlantName } from '../detail/PlantDetailView.tsx'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { usePlantLookup } from '../detail/usePlantLookup.ts'
import { LoadErrorPanel } from '../inventory/InventoryStates.tsx'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import { deletePlantWithPhotos } from '../photos/delete.ts'
import { updatePlant } from '../registration/save-plant.ts'
import { PATHS } from '../routes/paths.ts'

// Detalle de un ejemplar (#16), en /coleccion/:plantId. Exige sesión y va en
// su propio chunk (App.tsx lo carga de forma diferida). Los datos salen de la
// colección en memoria (usePlantLookup); la foto completa se pide aquí.
//
// Siempre se pinta una sola <Page>: al pasar de "cargando" a la planta, el h1
// es el mismo elemento y conserva el foco que le dio la navegación.
//
// Tras cada acción se queda en un sitio coherente, con un aviso:
// - guardar la edición o dar de baja o reactivar: aquí, con la planta ya
//   actualizada en la colección (upsertPlant);
// - eliminar: el inventario ("atrás" si se llegó desde él, para conservar la
//   búsqueda, los filtros y la posición), con el aviso de lo eliminado.

type DetailNotice =
  | { kind: 'saved' }
  | { kind: 'retired'; label: string }
  | { kind: 'reactivated' }

/** El aviso que dejó la edición para esta planta, si lo hay. */
function savedNoticeFor(plantId: string | undefined) {
  const notice = peekPlantNotice()
  return notice?.kind === 'saved' && notice.plantId === plantId ? notice : null
}

export default function PlantDetailPage() {
  const { plantId } = useParams()
  const { lookup, collection } = usePlantLookup(plantId)
  const { userId, upsertPlant, removePlant } = collection
  const online = useOnlineStatus()
  const navigate = useNavigate()
  const location = useLocation()
  // "Guardaste los cambios" al volver de la edición: se lee al montarse y se
  // recoge, para que no vuelva a salir.
  const [pendingSaved] = useState(() => savedNoticeFor(plantId))
  const [notice, setNotice] = useState<DetailNotice | null>(
    pendingSaved ? { kind: 'saved' } : null,
  )
  // Cada aviso nuevo es otra región: así se vuelve a anunciar.
  const [noticeKey, setNoticeKey] = useState(0)
  useEffect(() => {
    if (pendingSaved !== null) clearPlantNotice(pendingSaved)
  }, [pendingSaved])
  // La planta mientras se elimina: ya no está en la colección, pero se sigue
  // viendo hasta salir (y no "no encontrada").
  const [departed, setDeparted] = useState<CollectionPlant | null>(null)

  const services: PlantActionServices = {
    setStatus: (plant, status) =>
      updatePlant(plant.id, userId ?? '', { status }),
    deletePlant: (plant) =>
      deletePlantWithPhotos({
        userId: userId ?? '',
        plantId: plant.id,
        onPlantRemoved: (id) => {
          setDeparted(plant)
          removePlant(id)
        },
      }),
  }

  const shown = lookup.status === 'found' ? lookup.plant : departed

  if (shown !== null) {
    const plant = shown
    const noticeText =
      notice === null
        ? null
        : notice.kind === 'saved'
          ? DETAIL_TEXT.saved
          : notice.kind === 'retired'
            ? DETAIL_TEXT.retired(notice.label)
            : DETAIL_TEXT.reactivated
    return (
      <Page
        title={plant.displayName}
        heading={<PlantName plant={plant} />}
        before={<BackToCollection />}
      >
        <PlantDetailView
          plant={plant}
          notice={
            <>
              {noticeText && (
                <ActionNotice key={noticeKey} onDismiss={() => setNotice(null)}>
                  {noticeText}
                </ActionNotice>
              )}
              {plant.status !== 'active' && (
                <p className="flex items-start gap-space-2 rounded-lg bg-neutral-50 p-space-4 text-md text-neutral-900">
                  {DETAIL_TEXT.inactive(PLANT_STATUS_LABEL[plant.status])}
                </p>
              )}
            </>
          }
          actions={
            <PlantActions
              plant={plant}
              online={online}
              services={services}
              onStatusChanged={(updated) => {
                upsertPlant(updated)
                setNoticeKey((key) => key + 1)
                setNotice(
                  updated.status === 'active'
                    ? { kind: 'reactivated' }
                    : {
                        kind: 'retired',
                        label: PLANT_STATUS_LABEL[updated.status],
                      },
                )
              }}
              onDeleted={({ photosDeleted }) => {
                // Si ya no existía, también sale de la colección.
                removePlant(plant.id)
                leavePlantNotice({
                  kind: 'deleted',
                  plantId: plant.id,
                  name: plant.displayName,
                  scientific: plant.displayNameIsScientific,
                  photosDeleted,
                })
                if (cameFromInventory(location.state)) void navigate(-1)
                else void navigate(PATHS.collection, { replace: true })
              }}
            />
          }
        />
      </Page>
    )
  }

  switch (lookup.status) {
    case 'error':
      return (
        <Page title={DETAIL_TEXT.errorTitle} before={<BackToCollection />}>
          <LoadErrorPanel error={lookup.error} onRetry={collection.reload} />
        </Page>
      )
    case 'not-found':
      return (
        <Page title={DETAIL_TEXT.notFoundTitle} before={<BackToCollection />}>
          <p className="text-md text-neutral-700">{DETAIL_TEXT.notFound}</p>
        </Page>
      )
    default:
      return (
        <Page title={DETAIL_TEXT.loadingTitle} before={<BackToCollection />}>
          <p role="status" className="text-md text-neutral-700">
            {DETAIL_TEXT.loading}
          </p>
        </Page>
      )
  }
}
