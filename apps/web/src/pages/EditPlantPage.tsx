import { useLocation, useNavigate, useParams } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { Page } from '../components/Page.tsx'
import { cameFromDetail } from '../detail/navigation.ts'
import { leavePlantNotice } from '../detail/notice.ts'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { usePlantLookup } from '../detail/usePlantLookup.ts'
import { LoadErrorPanel } from '../inventory/InventoryStates.tsx'
import { searchGenera, searchSpecies } from '../lib/catalogSearch.ts'
import { removePlantPhoto, replacePlantPhoto } from '../photos/upload.ts'
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
// - La foto: la ya subida se ve en el campo; una nueva la reemplaza
//   (replacePlantPhoto sube, apunta y borra la anterior) y "Quitar foto" la
//   quita (removePlantPhoto).
// - Al terminar o cancelar se vuelve al detalle: con "atrás" si se llegó
//   desde él, para no apilar otra entrada en el historial.

const SERVICES: PlantFormBaseServices = {
  searchSpecies,
  searchGenera,
  loadQuickGenera: () => loadQuickAccessGenera(),
  uploadPhoto: (files, options) => replacePlantPhoto(files, options),
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
        <Page title={PLANT_EDIT_TEXT.title}>
          <PlantForm
            // Se precarga al montarse: con otra planta, otro formulario.
            key={plant.id}
            services={SERVICES}
            editing={{
              plant,
              updatePlant: (id, patch) => updatePlant(id, owner, patch),
              removePhoto: (options) => removePlantPhoto(options),
            }}
            online={online}
            knownPlants={status === 'loading' ? null : plants}
            draftUserId={userId}
            onPlantStored={upsertPlant}
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
