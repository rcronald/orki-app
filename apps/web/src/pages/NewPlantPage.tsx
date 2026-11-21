import { useNavigate } from 'react-router'
import { useCollection } from '../collection/useCollection.ts'
import { Page } from '../components/Page.tsx'
import { registeredPlantState } from '../inventory/registered-plant.ts'
import { searchGenera, searchSpecies } from '../lib/catalogSearch.ts'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import {
  PlantForm,
  type PlantFormServices,
} from '../registration/PlantForm.tsx'
import { loadQuickAccessGenera } from '../registration/quick-genera.ts'
import { insertPlant } from '../registration/save-plant.ts'
import { PLANT_FORM_TEXT } from '../registration/texts.ts'
import { PATHS } from '../routes/paths.ts'

// Registro de una planta (#85), en /coleccion/nueva. Exige sesión. Va en su
// propio chunk (App.tsx lo carga de forma diferida).

const SUPABASE_SERVICES: PlantFormServices = {
  searchSpecies,
  searchGenera,
  loadQuickGenera: () => loadQuickAccessGenera(),
  savePlant: (insert) => insertPlant(insert),
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
  const online = useOnlineStatus()

  return (
    <Page title={PLANT_FORM_TEXT.title}>
      <PlantForm
        // El borrador se lee al montarse: con otra cuenta, otro formulario.
        key={userId ?? ''}
        services={SUPABASE_SERVICES}
        online={online}
        knownPlants={knownPlants}
        draftUserId={userId}
        onSaved={(plant) => {
          upsertPlant(plant)
          // Sustituye la entrada del registro: "atrás" desde el inventario no
          // vuelve al formulario ya guardado.
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
