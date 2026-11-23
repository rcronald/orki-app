import { useRef } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { Page } from '../components/Page.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { cameFromDetail } from '../detail/navigation.ts'
import { leavePlantNotice } from '../detail/notice.ts'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { usePlantLookup } from '../detail/usePlantLookup.ts'
import { LoadErrorPanel } from '../inventory/InventoryStates.tsx'
import { searchGenera, searchSpecies } from '../lib/catalogSearch.ts'
import {
  listPlantPhotos,
  removeStoredPlantPhoto,
  uploadPlantPhotos,
} from '../photos/gallery.ts'
import {
  PlantForm,
  type PlantFormBaseServices,
} from '../registration/PlantForm.tsx'
import { loadQuickAccessGenera } from '../registration/quick-genera.ts'
import { updatePlant } from '../registration/save-plant.ts'
import { PLANT_EDIT_TEXT } from '../registration/texts.ts'
import { plantDetailPath } from '../routes/paths.ts'

// Edición de una planta (#16), en /coleccion/:plantId/editar. Exige sesión y
// va en su propio chunk, que comparte con el registro el formulario
// (PlantForm) y su estado: es el mismo formulario, precargado con la planta.
//
// - Sin borrador: los datos ya están en la base; uno propio se mezclaría con
//   el del registro, que es de una planta nueva.
// - Se guarda solo lo que cambió (plantPatch), sin validation ni user_id; con
//   la planta devuelta se actualiza la colección en memoria (upsertPlant).
// - Las fotos (#221): la galería muestra las guardadas (listPlantPhotos). Las
//   que se quitan se borran al guardar (removeStoredPlantPhoto; hasta
//   entonces, "Deshacer" o "Cancelar" las conservan) y las nuevas se suben
//   después (uploadPlantPhotos), hasta 6 en total.
// - Al terminar o cancelar se vuelve al detalle: con "atrás" si se llegó
//   desde él, para no apilar otra entrada en el historial. El enlace de volver
//   de la cabecera hace lo mismo que "Cancelar" (pregunta si hay cambios).

const SERVICES: PlantFormBaseServices = {
  searchSpecies,
  searchGenera,
  loadQuickGenera: () => loadQuickAccessGenera(),
  uploadPhotos: (photos, options) => uploadPlantPhotos(photos, options),
}

export default function EditPlantPage() {
  const { plantId } = useParams()
  const { lookup, collection } = usePlantLookup(plantId)
  const { upsertPlant, plants, status, userId } = collection
  // Solo con conexión y la sesión confirmada (#18): si no, el formulario se
  // desactiva con su aviso de sin conexión.
  const online = useReadOnly() === null
  const navigate = useNavigate()
  const location = useLocation()
  const fromDetail = cameFromDetail(location.state)
  const cancelRef = useRef<(() => void) | null>(null)

  const backToDetail = (id: string) => {
    if (fromDetail) void navigate(-1)
    else void navigate(plantDetailPath(id), { replace: true })
  }

  switch (lookup.status) {
    case 'loading':
      return (
        <Page title={PLANT_EDIT_TEXT.title}>
          <p role="status" className="text-md text-neutral-700">
            {DETAIL_TEXT.loading}
          </p>
        </Page>
      )
    case 'error':
      return (
        <Page title={PLANT_EDIT_TEXT.title}>
          <LoadErrorPanel error={lookup.error} onRetry={collection.reload} />
        </Page>
      )
    case 'not-found':
      return (
        <Page title={DETAIL_TEXT.notFoundTitle}>
          <p className="text-md text-neutral-700">{DETAIL_TEXT.notFound}</p>
        </Page>
      )
    case 'found': {
      const { plant } = lookup
      const owner = userId ?? ''
      return (
        <Page
          title={PLANT_EDIT_TEXT.title}
          width="wide"
          header={{
            art: false,
            back: (
              <Link
                to={plantDetailPath(plant.id)}
                className="orki-link orki-pagehead__back"
                onClick={(event) => {
                  // Como "Cancelar": pregunta antes de perder los cambios.
                  event.preventDefault()
                  cancelRef.current?.()
                }}
              >
                <Icon name="arrow-left" />
                {PLANT_EDIT_TEXT.back}
              </Link>
            ),
          }}
        >
          <PlantForm
            // Se precarga al montarse: con otra planta, otro formulario.
            key={plant.id}
            services={SERVICES}
            editing={{
              plant,
              updatePlant: (id, patch) => updatePlant(id, owner, patch),
              listPhotos: (options) => listPlantPhotos(options),
              removePhoto: (options) => removeStoredPlantPhoto(options),
            }}
            online={online}
            knownPlants={status === 'loading' ? null : plants}
            draftUserId={userId}
            onPlantStored={upsertPlant}
            cancelRef={cancelRef}
            onSaved={(saved: CollectionPlant, { changed }) => {
              if (changed)
                leavePlantNotice({ kind: 'saved', plantId: saved.id })
              backToDetail(saved.id)
            }}
            onCancel={() => backToDetail(plant.id)}
          />
        </Page>
      )
    }
  }
}
