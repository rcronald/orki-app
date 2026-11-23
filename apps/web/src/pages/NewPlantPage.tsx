import { getSpeciesReferencePhoto } from '../lib/referencePhotos.ts'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useCollection } from '../collection/useCollection.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { Page } from '../components/Page.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { registeredPlantState } from '../inventory/registered-plant.ts'
import { searchGenera, searchSpecies } from '../lib/catalogSearch.ts'
import { uploadPlantPhotos } from '../photos/gallery.ts'
import {
  PlantForm,
  type PlantFormServices,
} from '../registration/PlantForm.tsx'
import {
  prefilledName,
  prefilledSpecies,
} from '../registration/prefill-name.ts'
import { loadQuickAccessGenera } from '../registration/quick-genera.ts'
import { insertPlant } from '../registration/save-plant.ts'
import { PLANT_FORM_TEXT } from '../registration/texts.ts'
import { PATHS } from '../routes/paths.ts'
import { useRegistrationEvent } from '../telemetry/useRegistrationEvent.ts'

// Registro de una planta (#85, con galería desde el #221), en
// /coleccion/nueva. Exige sesión. Va en su propio chunk (App.tsx lo carga de
// forma diferida). Con ?nombre= (#123, desde "Aún no la tienes"), con ese
// nombre ya escrito; si además el estado de la navegación trae la especie
// del catálogo con ese nombre (#232, «Registrar esta especie»), con ella ya
// elegida. Al terminar, el evento de producto "registro completado"
// (#146, useRegistrationEvent). La antigua entrada "desde la cámara"
// (?foto=1) ya no existe: la dirección sigue abriendo el registro y el
// parámetro se ignora.

const SUPABASE_SERVICES: PlantFormServices = {
  searchSpecies,
  searchGenera,
  loadQuickGenera: () => loadQuickAccessGenera(),
  loadReferencePhoto: (speciesId, options) =>
    getSpeciesReferencePhoto(speciesId, options),
  savePlant: (insert) => insertPlant(insert),
  // Con la planta ya guardada: sube las fotos y crea sus filas en orden.
  uploadPhotos: (photos, options) => uploadPlantPhotos(photos, options),
}

export default function NewPlantPage() {
  const navigate = useNavigate()
  // También retiene la colección: si aún no estaba cargada, se carga, y la
  // planta nueva se suma a ella al guardar. Con ella salen las sugerencias de
  // origen y el aviso de duplicado (#88); mientras se lee, o si falla, el
  // formulario funciona sin ellos. No hace falta otra consulta: la colección
  // se pide igualmente y llega en una sola lectura.
  //
  // Su usuario es el dueño del borrador (#86). Se toma de la colección y no
  // de Clerk para no sumar Clerk a este chunk. Al abrir esta ruta
  // directamente (una recarga), el primer pintado llega antes de que
  // CollectionProvider fije el usuario (userId null, sin borrador); el
  // formulario se vuelve a montar con él antes de que se vea (key).
  const { upsertPlant, plants, status, userId } = useCollection()
  const knownPlants = status === 'loading' ? null : plants
  // Solo con conexión y la sesión confirmada (#18): si no, el formulario se
  // desactiva con su aviso de sin conexión.
  const online = useReadOnly() === null
  const [search] = useSearchParams()
  const location = useLocation()
  const initialName = prefilledName(search)
  const registration = useRegistrationEvent({ offline: !online })

  return (
    <Page
      title={PLANT_FORM_TEXT.title}
      width="wide"
      header={{
        art: false,
        back: (
          // Salir por aquí conserva el borrador, como cualquier enlace de la
          // app: lo escrito se recupera al volver.
          <Link to={PATHS.collection} className="orki-link orki-pagehead__back">
            <Icon name="arrow-left" />
            {PLANT_FORM_TEXT.back}
          </Link>
        ),
      }}
    >
      <PlantForm
        // El borrador se lee al montarse: con otra cuenta, otro formulario.
        key={userId ?? ''}
        services={SUPABASE_SERVICES}
        online={online}
        knownPlants={knownPlants}
        draftUserId={userId}
        initialName={initialName}
        initialSpecies={prefilledSpecies(location.state, initialName)}
        autoFocusName
        // En cuanto la planta existe (y otra vez al cambiar su principal), a
        // la colección: si una foto falla o se sale a mitad, ya está en el
        // inventario.
        onPlantStored={upsertPlant}
        onSaved={(plant, { photos }) => {
          registration.onRegistered(plant, { hasPhoto: photos > 0 })
          // La colección ya tiene la última versión (onPlantStored). Sustituye
          // la entrada del registro: "atrás" desde el inventario no vuelve al
          // formulario ya guardado.
          void navigate(PATHS.collection, {
            replace: true,
            state: registeredPlantState(plant),
          })
        }}
        onCancel={() => void navigate(PATHS.collection)}
      />
    </Page>
  )
}
