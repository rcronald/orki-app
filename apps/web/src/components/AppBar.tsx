import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import { Logo } from './Logo.tsx'
import { Icon } from './ui/Icon.tsx'

/** Rutas que cuentan como «Mi colección» en la pestaña de la barra. */
const COLLECTION_AREA = [PATHS.collection, PATHS.ownershipCheck]

function isIn(pathname: string, area: string): boolean {
  return pathname === area || pathname.startsWith(`${area}/`)
}

/** Si `pathname` es «Mi colección» o una de sus pantallas hijas. */
function isCollectionArea(pathname: string): boolean {
  return COLLECTION_AREA.some((area) => isIn(pathname, area))
}

export interface AppBarProps {
  /** Lo de la derecha: el menú «Tu cuenta» (AccountMenu). */
  account?: ReactNode
}

// Barra de la app con sesión (orki-appbar, #206 y #207): el logotipo, que
// enlaza al inicio (con sesión lleva a «Mi colección»), las pestañas «Mi
// colección» y «Catálogo» (#232) con icono, subrayadas y con
// aria-current="page" en su zona (la colección con sus pantallas hijas:
// detalle, registro, edición y «¿Ya la tengo?»; el catálogo con sus géneros y
// fichas), y a la derecha la cuenta. Sin lupa: «¿Ya la tengo?» se abre desde «Mi
// colección». Hasta 720 px el logotipo queda en la flor (variante compact),
// las pestañas sin icono y «Tu cuenta» solo para el lector de pantalla: las
// dos pestañas caben en 360 px sin desbordarse.
export function AppBar({ account }: AppBarProps) {
  const { pathname } = useLocation()
  const inCollection = isCollectionArea(pathname)
  const inCatalog = isIn(pathname, PATHS.catalog)

  return (
    <header className="orki-appbar">
      {/* Nombre accesible: «Inicio de orqui.app» (el logotipo). */}
      <Link to={PATHS.home} className="orki-appbar__brand">
        <span className="sr-only">Inicio de</span>{' '}
        <Logo variant="compact" className="orki-appbar__logo" />
      </Link>
      <nav aria-label="Principal" className="orki-appbar__nav">
        <ul className="orki-appbar__tabs">
          <li>
            <Link
              to={PATHS.collection}
              className="orki-appbar__tab"
              aria-current={inCollection ? 'page' : undefined}
            >
              <Icon name="sprout" />
              Mi colección
            </Link>
          </li>
          <li>
            <Link
              to={PATHS.catalog}
              className="orki-appbar__tab"
              aria-current={inCatalog ? 'page' : undefined}
            >
              <Icon name="book-open" />
              Catálogo
            </Link>
          </li>
        </ul>
      </nav>
      {account != null && <div className="orki-appbar__end">{account}</div>}
    </header>
  )
}
