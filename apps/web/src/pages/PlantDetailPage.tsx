import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { PLANT_STATUS_LABEL } from '../collection/labels.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { useReadOnly, type ReadOnlyReason } from '../collection/useReadOnly.ts'
import { Page } from '../components/Page.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Collapsible } from '../components/ui/Collapsible.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ActionNotice } from '../detail/ActionNotice.tsx'
import { BackToCollection } from '../detail/BackToCollection.tsx'
import { cameFromInventory, FROM_DETAIL } from '../detail/navigation.ts'
import { updatePlantNotes } from '../detail/notes.ts'
import {
  clearPlantNotice,
  leavePlantNotice,
  peekPlantNotice,
} from '../detail/notice.ts'
import {
  PlantActions,
  type PlantActionServices,
} from '../detail/PlantActions.tsx'
import {
  PlantDetailView,
  PlantMeta,
  PlantName,
} from '../detail/PlantDetailView.tsx'
import {
  PlantGallery,
  type PlantGalleryServices,
} from '../detail/PlantGallery.tsx'
import { PlantLogSection } from '../detail/PlantLogSection.tsx'
import { PlantNotes } from '../detail/PlantNotes.tsx'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { usePlantGallery } from '../detail/usePlantGallery.ts'
import { usePlantLookup } from '../detail/usePlantLookup.ts'
import { LoadErrorPanel } from '../inventory/InventoryStates.tsx'
import { deletePlantWithPhotos } from '../photos/delete.ts'
import { reorderPlantPhotos, updatePlantPhoto } from '../photos/gallery.ts'
import { useReferencePhoto } from '../lib/useReferencePhoto.ts'
import { usePlantPhotoRows } from '../photos/usePlantPhotoRows.ts'
import { updatePlant } from '../registration/save-plant.ts'
import { PATHS, plantEditPath } from '../routes/paths.ts'

// Detalle de un ejemplar (#16), en /coleccion/:plantId. Exige sesión y va en
// su propio chunk (App.tsx lo carga de forma diferida). Los datos salen de la
// colección en memoria (usePlantLookup); las fotos, de plant_photos
// (usePlantGallery, #183), con la principal de la colección mientras tanto o
// sin conexión; sin fotos propias, la foto de referencia de su especie
// (useReferencePhoto, #234).
//
// Diseño (#265, maqueta «Ficha de la planta» del #263): la cabecera de
// pantalla (PageHeader) con «Mi colección» de regreso, el nombre como título,
// debajo la insignia de validación, el identificador, el tipo y el estado
// (PlantMeta) y «Editar planta» a la derecha (a todo el ancho hasta 720 px).
// Luego PlantDetailView: la galería a la izquierda; «Datos de la planta» y
// «Notas» (PlantNotes, editables aquí) a la derecha; la bitácora
// (PlantLogSection, la monta el #267) y «Gestionar planta» al final, plegado,
// con dar de baja y eliminar (PlantActions).
//
// Sin conexión o sin la sesión confirmada, un solo motivo arriba (región
// role="status"), al que remiten «Editar planta», las notas y las acciones.
//
// Siempre se pinta una sola <Page>: al pasar de "cargando" a la planta, el h1
// es el mismo elemento y conserva el foco que le dio la navegación.
//
// Tras cada acción se queda en un sitio coherente, con un aviso:
// - guardar la edición o dar de baja o reactivar: aquí, con la planta ya
//   actualizada en la colección (upsertPlant);
// - eliminar: el inventario ("atrás" si se llegó desde él, para conservar la
//   búsqueda, los filtros y la posición), con el aviso de lo eliminado;
// - cambiar la principal o su «en flor» desde la galería: aquí, con la planta
//   releída en la colección (la tarjeta del inventario ya muestra la nueva).

type DetailNotice =
  | { kind: 'saved' }
  | { kind: 'retired'; label: string }
  | { kind: 'reactivated' }

/** El aviso que dejó la edición para esta planta, si lo hay. */
function savedNoticeFor(plantId: string | undefined) {
  const notice = peekPlantNotice()
  return notice?.kind === 'saved' && notice.plantId === plantId ? notice : null
}

/**
 * «Mi colección» de regreso (#265), de 44 px de alto (#174). Para el lector,
 * «Volver a Mi colección»: el nombre contiene el texto visible.
 */
function Back() {
  return (
    <BackToCollection className="orki-link orki-pagehead__back">
      <Icon name="arrow-left" />
      {/* El espacio va fuera: en un contenedor flex no se pinta, pero separa
          las dos palabras en el nombre accesible. */}
      <span className="sr-only">{DETAIL_TEXT.backPrefix}</span>{' '}
      {DETAIL_TEXT.backShort}
    </BackToCollection>
  )
}

/** «Editar planta», junto al nombre; sin conexión, desactivado con el motivo. */
function EditPlant({
  plantId,
  reasonId,
}: {
  plantId: string
  reasonId: string | null
}) {
  return reasonId === null ? (
    <Link
      to={plantEditPath(plantId)}
      state={FROM_DETAIL}
      className="orki-btn orki-btn--secondary"
    >
      <Icon name="pencil" />
      {DETAIL_TEXT.edit}
    </Link>
  ) : (
    <Button icon="pencil" aria-disabled aria-describedby={reasonId}>
      {DETAIL_TEXT.edit}
    </Button>
  )
}

export default function PlantDetailPage() {
  const { plantId } = useParams()
  const { lookup, collection } = usePlantLookup(plantId)
  const { userId, upsertPlant, removePlant } = collection
  // Sin conexión o sin poder confirmar la sesión (#18): solo lectura.
  const readOnly = useReadOnly()
  const reasonId = useId()
  const writable = readOnly === null
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
  const header = (meta?: ReactNode) => ({ art: false, meta, back: <Back /> })

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
        width="wide"
        header={{
          ...header(<PlantMeta plant={plant} />),
          actions: (
            <EditPlant
              plantId={plant.id}
              reasonId={writable ? null : reasonId}
            />
          ),
        }}
      >
        <PlantDetailContent
          plant={plant}
          userId={userId}
          readOnly={readOnly}
          reasonId={writable ? undefined : reasonId}
          onPlantUpdated={upsertPlant}
          notice={
            <>
              {/* Región siempre presente: así se anuncia al perder la conexión. */}
              <div role="status" className="empty:-mb-space-5">
                {!writable && (
                  <p
                    id={reasonId}
                    className="flex items-start gap-space-2 rounded-lg bg-neutral-50 p-space-4 text-md text-neutral-900"
                  >
                    <Icon
                      name="cloud-off"
                      className="mt-[2px] size-[20px] flex-none"
                    />
                    {readOnly === 'unverified'
                      ? DETAIL_TEXT.unverified
                      : DETAIL_TEXT.offline}
                  </p>
                )}
              </div>
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
              online={writable}
              reasonId={writable ? undefined : reasonId}
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
        <Page title={DETAIL_TEXT.errorTitle} width="wide" header={header()}>
          <LoadErrorPanel error={lookup.error} onRetry={collection.reload} />
        </Page>
      )
    case 'not-found':
      return (
        <Page title={DETAIL_TEXT.notFoundTitle} width="wide" header={header()}>
          <p className="text-md text-neutral-700">{DETAIL_TEXT.notFound}</p>
        </Page>
      )
    default:
      return (
        <Page title={DETAIL_TEXT.loadingTitle} width="wide" header={header()}>
          <p role="status" className="text-md text-neutral-700">
            {DETAIL_TEXT.loading}
          </p>
        </Page>
      )
  }
}

interface PlantDetailContentProps {
  plant: CollectionPlant
  userId: string | null
  readOnly: ReadOnlyReason | null
  /** id del motivo de arriba si no se puede escribir. */
  reasonId?: string
  onPlantUpdated: (plant: CollectionPlant) => void
  notice: ReactNode
  actions: ReactNode
}

/**
 * Galería, datos, notas, bitácora y «Gestionar planta», con las fotos de
 * plant_photos.
 */
function PlantDetailContent({
  plant,
  userId,
  readOnly,
  reasonId,
  onPlantUpdated,
  notice,
  actions,
}: PlantDetailContentProps) {
  const gallery = usePlantGallery(plant, userId)
  // Sin fotos propias, la foto de referencia de su especie (#234): una
  // consulta solo aquí, no en la colección (pesaría en «Mi colección» y en
  // su copia del dispositivo). Con fotos propias no se pide.
  const reference = useReferencePhoto(
    plant.species !== null &&
      plant.photoPath === null &&
      gallery.photos.length === 0
      ? plant.species.id
      : null,
  )
  const rows = usePlantPhotoRows()
  const owner = userId ?? ''
  const services: PlantGalleryServices = {
    updatePhoto: ({ photo, main, details }) =>
      updatePlantPhoto({
        userId: owner,
        plantId: plant.id,
        photo,
        main,
        changes: details,
        rows,
        onPlantUpdated,
      }),
    reorderPhotos: ({ photos, order }) =>
      reorderPlantPhotos({
        userId: owner,
        plantId: plant.id,
        photos,
        order,
        rows,
        onPlantUpdated,
      }),
  }
  return (
    <PlantDetailView
      plant={plant}
      canEdit={readOnly === null}
      notice={notice}
      notes={
        <PlantNotes
          plant={plant}
          canEdit={readOnly === null}
          reasonId={reasonId}
          onSave={(notes) => updatePlantNotes(plant.id, owner, notes)}
          onSaved={onPlantUpdated}
        />
      }
      log={<PlantLogSection plant={plant} readOnly={readOnly} />}
      manage={
        <Collapsible
          headingLevel={2}
          className="rounded-lg border border-neutral-200"
          title={
            <span className="flex items-center gap-space-3">
              <Icon name="settings" className="size-[24px] flex-none" />
              {DETAIL_TEXT.actionsLabel}
            </span>
          }
        >
          {actions}
        </Collapsible>
      }
      gallery={
        <PlantGallery
          key={plant.id}
          plant={plant}
          gallery={gallery}
          readOnly={readOnly}
          services={services}
          onPlantUpdated={onPlantUpdated}
          reference={reference}
          reasonId={reasonId}
        />
      }
    />
  )
}
