import { useMemo, useRef } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { Page } from '../components/Page.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { cameFromDetail } from '../detail/navigation.ts'
import { leavePlantNotice } from '../detail/notice.ts'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { usePlantLookup } from '../detail/usePlantLookup.ts'
import {
  EditPlantForm,
  type EditPlantServices,
} from '../editing/EditPlantForm.tsx'
import { EDIT_TEXT } from '../editing/texts.ts'
import { LoadErrorPanel } from '../inventory/InventoryStates.tsx'
import { searchGenera, searchSpecies } from '../lib/catalogSearch.ts'
import { getSpeciesReferencePhoto } from '../lib/referencePhotos.ts'
import { appPhotoStorage } from '../photos/storage.ts'
import { usePlantPhotoRows } from '../photos/usePlantPhotoRows.ts'
import type { PlantPatch } from '../registration/form-state.ts'
import { loadQuickAccessGenera } from '../registration/quick-genera.ts'
import { updatePlant } from '../registration/save-plant.ts'
import { plantDetailPath } from '../routes/paths.ts'

// Edición de una planta (#16, rediseñada en el #266), en
// /coleccion/:plantId/editar. Exige sesión y va en su propio chunk. El
// formulario (editing/EditPlantForm.tsx) reutiliza los campos y la
// validación del registro; nada se guarda hasta «Guardar cambios» (ver
// editing/edit-plan.ts).
//
// - La cabecera: «Volver a la ficha» (hace lo mismo que «Cancelar»: pregunta
//   si hay cambios), «Editar planta» y el identificador (CAT-012), que no se
//   edita (lo trae la planta de la colección, #265).
// - Al terminar o cancelar se vuelve a la ficha: con «atrás» si se llegó
//   desde ella, para no apilar otra entrada en el historial.

const SEARCH = {
  searchSpecies,
  searchGenera,
  loadQuickGenera: () => loadQuickAccessGenera(),
  loadReferencePhoto: getSpeciesReferencePhoto,
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
  const rows = usePlantPhotoRows()
  const services = useMemo<EditPlantServices>(
    () => ({
      ...SEARCH,
      rows,
      storage: appPhotoStorage(),
      updatePlant: (id: string, patch: PlantPatch) =>
        updatePlant(id, userId ?? '', patch),
    }),
    [rows, userId],
  )

  const backToDetail = (id: string) => {
    if (fromDetail) void navigate(-1)
    else void navigate(plantDetailPath(id), { replace: true })
  }

  switch (lookup.status) {
    case 'loading':
      return (
        <Page title={EDIT_TEXT.title}>
          <p role="status" className="text-md text-neutral-700">
            {DETAIL_TEXT.loading}
          </p>
        </Page>
      )
    case 'error':
      return (
        <Page title={EDIT_TEXT.title}>
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
      const { code } = plant
      return (
        <Page
          title={EDIT_TEXT.title}
          width="wide"
          header={{
            art: false,
            meta:
              code !== null ? (
                <>
                  <span className="sr-only">{EDIT_TEXT.codePrefix} </span>
                  {code}
                </>
              ) : undefined,
            back: (
              <Link
                to={plantDetailPath(plant.id)}
                className="orki-link orki-pagehead__back"
                // Lo gestiona el formulario: es «Cancelar».
                data-sin-aviso=""
                onClick={(event) => {
                  event.preventDefault()
                  cancelRef.current?.()
                }}
              >
                <Icon name="arrow-left" />
                {EDIT_TEXT.back}
              </Link>
            ),
          }}
        >
          <EditPlantForm
            // Se precarga al montarse: con otra planta, otro formulario.
            key={plant.id}
            plant={plant}
            userId={userId}
            services={services}
            online={online}
            knownPlants={status === 'loading' ? null : plants}
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
