import { Link } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import { Logo } from './Logo.tsx'

// NavBar del design system (orki-nav, #190, #191): la cabecera de la portada
// sin sesión. El logotipo, que enlaza al inicio, y a la derecha «Iniciar
// sesión» (enlace de la barra) y «Crear cuenta gratis» (orki-btn--strong, la
// acción principal de las páginas públicas). Sin enlaces de sección: el
// catálogo es un marcador hasta la consulta pública (#187).
//
// Hasta 720 px la cabecera queda solo con el logotipo, como en la maqueta de
// celular: el logotipo y los dos enlaces no caben en una línea a 360 px, y las
// dos acciones están en el bloque principal, justo debajo. El sistema solo
// oculta los enlaces de sección (orki-nav__links); ocultar también las
// acciones es una utilidad de la app y una propuesta para el sistema.
//
// `actions={false}` la deja solo con el logotipo en todos los anchos
// (mientras se comprueba una sesión recordada, ver HomeRoute).
export function PublicHeader({ actions = true }: { actions?: boolean }) {
  return (
    // Hasta 720 px, el margen lateral del Hero (16 px) para que el logotipo
    // quede alineado con el título (el sistema deja 32 px).
    <header className="orki-nav publico-estrecho:px-space-4">
      {/* Nombre accesible: «Inicio de orqui.apps» (el logotipo). */}
      <Link
        to={PATHS.home}
        className="inline-flex min-h-[44px] items-center rounded-sm"
      >
        <span className="sr-only">Inicio de</span>{' '}
        <Logo className="orki-nav__logo" />
      </Link>
      {actions && (
        <div className="orki-nav__actions publico-estrecho:hidden">
          {/* 44 px de alto para el dedo; el sistema no le da altura. */}
          <Link
            to={PATHS.signIn}
            className="orki-link orki-link--nav min-h-[44px]"
          >
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
