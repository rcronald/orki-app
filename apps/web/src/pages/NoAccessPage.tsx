import { Link } from 'react-router'
import { Page } from '../components/Page.tsx'
import { PATHS } from '../routes/paths.ts'

// Para quien abre a mano una ruta de administración sin el rol. La ruta
// existe, así que no es un "no encontrado", y no se redirige para no crear un
// bucle ni esconder el motivo.
export function NoAccessPage() {
  return (
    <Page title="No tienes acceso">
      <p className="text-neutral-700">
        Esta página es solo para quienes administran el catálogo.
      </p>
      <Link to={PATHS.home} className="orki-btn orki-btn--secondary">
        Ir al inicio
      </Link>
    </Page>
  )
}
