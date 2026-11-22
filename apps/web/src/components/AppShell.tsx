import { Link, NavLink, Outlet } from 'react-router'
import { AccountControls } from '../auth/AccountControls.tsx'
import { useIsCatalogAdmin } from '../auth/roles.ts'
import { PATHS } from '../routes/paths.ts'

// Estructura común de las páginas de la app (no de las de acceso): enlace para
// saltar al contenido, cabecera con la marca y la cuenta, navegación principal
// y el contenido de la ruta. Los enlaces son de React Router: no recargan.
//
// `isolate` crea un contexto de apilamiento propio: así el fondo por género del
// registro (GenusBackdrop, con z-index negativo) se pinta encima del fondo de
// este contenedor y debajo de todo su contenido.
export function AppShell() {
  const isCatalogAdmin = useIsCatalogAdmin()

  return (
    <div className="isolate flex min-h-dvh flex-col bg-neutral-0 text-neutral-900">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-space-2 focus:left-space-2 focus:z-50 focus:rounded-md focus:bg-neutral-0 focus:p-space-2"
      >
        Saltar al contenido
      </a>
      <header className="flex flex-wrap items-center justify-between gap-space-3 px-space-4 py-space-3">
        <p className="font-display text-xl font-semibold">orqui.apps</p>
        <AccountControls />
      </header>
      <nav aria-label="Principal" className="px-space-4 pb-space-3">
        <ul className="orki-chips">
          <NavItem to={PATHS.home}>Inicio</NavItem>
          <NavItem to={PATHS.catalog}>Catálogo</NavItem>
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
      {/* Pie discreto con la página de privacidad (#111), pública. */}
      <footer className="px-space-4 pb-space-4 text-center text-sm">
        <Link to={PATHS.privacy} className="text-neutral-700 underline">
          Privacidad
        </Link>
      </footer>
    </div>
  )
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
