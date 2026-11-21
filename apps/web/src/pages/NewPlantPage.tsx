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
  // planta nueva se suma a ella al guardar.
  const { upsertPlant } = useCollection()
  const online = useOnlineStatus()

  return (
    <Page title={PLANT_FORM_TEXT.title}>
      <PlantForm
        services={SUPABASE_SERVICES}
        online={online}
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
