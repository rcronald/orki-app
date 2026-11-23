import { Link, useLocation } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import { Logo } from './Logo.tsx'

// NavBar del design system (orki-nav, #190, #199): la cabecera de la portada.
// El logotipo, que enlaza al inicio, y a la derecha dos botones: «Iniciar
// sesión» (orki-btn--secondary) y «Crear cuenta gratis» (orki-btn--strong, la
// acción principal de las páginas públicas). Entre los dos, los enlaces de
// sección (orki-nav__links): «Catálogo» (#232), con aria-current="page" en
// todo /catalogo. No dependen de la sesión, así que se ven también mientras
// Clerk carga.
//
// Hasta 720 px el sistema deja solo el logotipo, centrado: las acciones están
// en el bloque principal, justo debajo, y el catálogo se abre desde la
// portada («Explorar el catálogo»).
//
// `actions={false}` quita los botones de acceso en todos los anchos.
export function PublicHeader({ actions = true }: { actions?: boolean }) {
  const { pathname } = useLocation()
  const inCatalog =
    pathname === PATHS.catalog || pathname.startsWith(`${PATHS.catalog}/`)
  return (
    <header className="orki-nav">
      {/* Nombre accesible: «Inicio de orqui.app» (el logotipo). */}
      <Link
        to={PATHS.home}
        className="inline-flex min-h-[44px] items-center rounded-sm"
      >
        <span className="sr-only">Inicio de</span>{' '}
        <Logo className="orki-nav__logo" />
      </Link>
      <nav aria-label="Secciones" className="orki-nav__links">
        <Link
          to={PATHS.catalog}
          className="orki-link orki-link--nav inline-flex min-h-[44px] items-center"
          aria-current={inCatalog ? 'page' : undefined}
        >
          Catálogo
        </Link>
      </nav>
      {actions && (
        <div className="orki-nav__actions">
          <Link to={PATHS.signIn} className="orki-btn orki-btn--secondary">
            Iniciar sesión
          </Link>
          <Link to={PATHS.signUp} className="orki-btn orki-btn--strong">
            Crear cuenta gratis
          </Link>
        </div>
      )}
    </header>
  )
}
