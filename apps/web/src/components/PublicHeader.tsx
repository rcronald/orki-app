import { Link } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import { Logo } from './Logo.tsx'

// NavBar del design system (orki-nav, #190, #199): la cabecera de la portada.
// El logotipo, que enlaza al inicio, y a la derecha dos botones: «Iniciar
// sesión» (orki-btn--secondary) y «Crear cuenta gratis» (orki-btn--strong, la
// acción principal de las páginas públicas). Sin enlaces de sección: el
// catálogo es un marcador hasta la consulta pública (#187).
//
// Hasta 720 px el sistema deja solo el logotipo, centrado: las acciones están
// en el bloque principal, justo debajo.
//
// `actions={false}` la deja solo con el logotipo en todos los anchos.
export function PublicHeader({ actions = true }: { actions?: boolean }) {
  return (
    <header className="orki-nav">
      {/* Nombre accesible: «Inicio de orqui.apps» (el logotipo). */}
      <Link
        to={PATHS.home}
        className="inline-flex min-h-[44px] items-center rounded-sm"
      >
        <span className="sr-only">Inicio de</span>{' '}
        <Logo className="orki-nav__logo" />
      </Link>
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
