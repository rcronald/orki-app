import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { AccountControls } from '../auth/AccountControls.tsx'
import { useIsCatalogAdmin } from '../auth/roles.ts'
import { PATHS } from '../routes/paths.ts'
import {
  textPageOrigin,
  type TextPageOrigin,
} from '../routes/text-page-origin.ts'
import { Logo } from './Logo.tsx'
import { SiteFooter } from './SiteFooter.tsx'

// Estructura común de las páginas de la app (no de las de acceso ni de la
// portada, que tiene la suya: PublicShell): enlace para
// saltar al contenido, cabecera con la marca y la cuenta, navegación principal
// y el contenido de la ruta. Los enlaces son de React Router: no recargan.
//
// `isolate` crea un contexto de apilamiento propio: así el fondo por género del
// registro (GenusBackdrop, con z-index negativo) se pinta encima del fondo de
// este contenedor y debajo de todo su contenido.
export function AppShell() {
  const isCatalogAdmin = useIsCatalogAdmin()
  const location = useLocation()
  const { pathname } = location
  const state: unknown = location.state

  return (
    <div className="isolate flex min-h-dvh flex-col bg-neutral-0 text-neutral-900">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-space-2 focus:left-space-2 focus:z-50 focus:rounded-md focus:bg-neutral-0 focus:p-space-2"
      >
        Saltar al contenido
      </a>
      <header className="flex flex-wrap items-center justify-between gap-space-3 px-space-4 py-space-3">
        {/* Nombre accesible: «Inicio de orqui.apps» (el logotipo). Con
            sesión, el inicio lleva a la colección (#191). */}
        <Link to={PATHS.home} className="inline-block rounded-md">
          <span className="sr-only">Inicio de</span>{' '}
          <Logo className="block h-[40px] w-auto" />
        </Link>
        <AccountControls />
      </header>
      <nav aria-label="Principal" className="px-space-4 pb-space-3">
        <ul className="orki-chips">
          {/* Sin «Inicio» (el logotipo ya lleva a él) ni «Catálogo», que es
              un marcador hasta la consulta pública (#187); la ruta existe. */}
          <NavItem to={PATHS.collection}>Mi colección</NavItem>
          {/* Solo comodidad: la protección real es la de la base de datos (#6). */}
          {isCatalogAdmin && (
            <NavItem to={PATHS.catalogAdmin}>Administración</NavItem>
          )}
        </ul>
      </nav>
      <main
        id="contenido"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center px-space-4 pt-space-3 pb-space-6"
      >
        <Outlet />
      </main>
      {/* Pie del sistema (#202), con la privacidad y los créditos. */}
      <SiteFooter origin={footerOrigin(pathname, state)} />
    </div>
  )
}

// A dónde ofrecen volver la privacidad y los créditos abiertos desde el pie
// (#202): desde las pantallas con sesión (la colección, la cuenta, la
// administración), a «Mi colección»; desde las propias páginas de texto, al
// mismo sitio que ya ofrecían; desde el resto, al inicio.
const SIGNED_IN_AREAS = [PATHS.collection, PATHS.account, '/administracion']

function footerOrigin(pathname: string, state: unknown): TextPageOrigin {
  if (pathname === PATHS.privacy || pathname === PATHS.credits) {
    return textPageOrigin(state) ?? 'inicio'
  }
  return SIGNED_IN_AREAS.some(
    (area) => pathname === area || pathname.startsWith(`${area}/`),
  )
    ? 'coleccion'
    : 'inicio'
}

// Enlace de la navegación con el aspecto de un chip del sistema. NavLink pone
// aria-current="page" en el de la página actual (con `end`, solo si la ruta
// coincide entera) y el estilo seleccionado sale de ese atributo.
function NavItem({ to, children }: { to: string; children: string }) {
  return (
    <li>
      <NavLink
        to={to}
        end
        className="orki-chip aria-[current=page]:border-primary aria-[current=page]:bg-primary-soft aria-[current=page]:font-semibold"
      >
        {children}
      </NavLink>
    </li>
  )
}
