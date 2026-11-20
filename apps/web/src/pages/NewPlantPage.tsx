import { Page } from '../components/Page.tsx'

// Provisional: el registro real de plantas llega en su issue. Exige sesión.
export function NewPlantPage() {
  return (
    <Page title="Registrar una planta">
      <p className="text-neutral-700">
        Aquí podrás registrar una planta de tu colección.
      </p>
    </Page>
  )
}
