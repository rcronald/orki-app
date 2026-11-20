import { Link } from 'react-router'
import { Page } from '../components/Page.tsx'
import { PATHS } from '../routes/paths.ts'

// Provisional: la colección real llega en su issue. Exige sesión.
export function CollectionPage() {
  return (
    <Page title="Mi colección">
      <p className="text-neutral-700">Aquí verás las plantas que registres.</p>
      <Link to={PATHS.newPlant} className="orki-btn orki-btn--primary">
        Registrar una planta
      </Link>
    </Page>
  )
}
