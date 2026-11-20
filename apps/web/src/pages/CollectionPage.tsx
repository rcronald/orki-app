import { Link } from 'react-router'
import { countPlants } from '../collection/selectors.ts'
import { useCollection } from '../collection/useCollection.ts'
import { Page } from '../components/Page.tsx'
import { PATHS } from '../routes/paths.ts'

// Provisional: la lista, la cuadrícula y el buscador llegan en #94 y #95. Por
// ahora solo muestra cuántas plantas activas tiene el usuario, para comprobar
// que la capa de datos de la colección (#93) funciona. Exige sesión.
export function CollectionPage() {
  const { status, plants, error } = useCollection()

  return (
    <Page title="Mi colección">
      <p className="text-neutral-700" role="status">
        {status === 'error' && error
          ? error.message
          : plants === null
            ? 'Cargando tu colección…'
            : activePlantsText(countPlants(plants))}
      </p>
      <Link to={PATHS.newPlant} className="orki-btn orki-btn--primary">
        Registrar una planta
      </Link>
    </Page>
  )
}

function activePlantsText(count: number): string {
  if (count === 0) return 'Aún no tienes plantas registradas.'
  return count === 1
    ? 'Tienes 1 planta activa.'
    : `Tienes ${count} plantas activas.`
}
