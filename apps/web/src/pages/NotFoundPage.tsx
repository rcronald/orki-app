import { Link } from 'react-router'
import { Page } from '../components/Page.tsx'
import { PATHS } from '../routes/paths.ts'

// Cualquier ruta que no existe, también /muestra en producción.
export function NotFoundPage() {
  return (
    <Page title="Página no encontrada">
      <p className="text-neutral-700">
        Esta dirección no existe o ya no está disponible.
      </p>
      <Link to={PATHS.home} className="orki-btn orki-btn--secondary">
        Ir al inicio
      </Link>
    </Page>
  )
}
