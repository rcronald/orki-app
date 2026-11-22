import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import { Logo } from './Logo.tsx'
import { Icon } from './ui/Icon.tsx'

/** Rutas que cuentan como «Mi colección» en la pestaña de la barra. */
const COLLECTION_AREA = [PATHS.collection, PATHS.ownershipCheck]

/** Si `pathname` es «Mi colección» o una de sus pantallas hijas. */
function isCollectionArea(pathname: string): boolean {
  return COLLECTION_AREA.some(
    (area) => pathname === area || pathname.startsWith(`${area}/`),
  )
}

export interface AppBarProps {
  /** Lo de la derecha: el menú «Tu cuenta» (AccountMenu). */
  account?: ReactNode
}

// Barra de la app con sesión (orki-appbar, #206 y #207): el logotipo, que
// enlaza al inicio (con sesión lleva a «Mi colección»), la pestaña «Mi
// colección» con icono, subrayada y con aria-current="page" en la colección y
// en sus pantallas hijas (detalle, registro, edición y «¿Ya la tengo?»), y a
// la derecha la cuenta. Sin lupa: «¿Ya la tengo?» se abre desde «Mi
// colección». Hasta 720 px el logotipo se achica y «Tu cuenta» queda solo
// para el lector de pantalla: cabe en 360 px sin desbordarse.
export function AppBar({ account }: AppBarProps) {
  const { pathname } = useLocation()
  const inCollection = isCollectionArea(pathname)

  return (
    <header className="orki-appbar">
      {/* Nombre accesible: «Inicio de orqui.app» (el logotipo). */}
      <Link to={PATHS.home} className="orki-appbar__brand">
        <span className="sr-only">Inicio de</span>{' '}
        <Logo className="orki-appbar__logo" />
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
        </ul>
      </nav>
      {account != null && <div className="orki-appbar__end">{account}</div>}
    </header>
  )
}
