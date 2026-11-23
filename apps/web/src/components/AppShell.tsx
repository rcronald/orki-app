import { Outlet, useLocation } from 'react-router'
import { AccountMenu } from '../auth/AccountMenu.tsx'
import { AuthNotice } from '../auth/AuthStatus.tsx'
import { useAppIdentity } from '../auth/useAppIdentity.ts'
import { useAuthAvailability } from '../auth/useAuthAvailability.ts'
import { PATHS } from '../routes/paths.ts'
import {
  textPageOrigin,
  type TextPageOrigin,
} from '../routes/text-page-origin.ts'
import { AppBar } from './AppBar.tsx'
import { PublicHeader } from './PublicHeader.tsx'
import { SiteFooter } from './SiteFooter.tsx'

// Estructura común de las páginas de la app (no de las de acceso ni de la
// portada, que tiene la suya: PublicShell): enlace para saltar al contenido,
// la barra (la de la app con sesión o la pública sin ella, #207), el
// contenido de la ruta y el pie. Los enlaces son de React Router: no recargan.
//
// `isolate` crea un contexto de apilamiento propio: así el fondo por género del
// registro (GenusBackdrop, con z-index negativo) se pinta encima del fondo de
// este contenedor y debajo de todo su contenido.
export function AppShell() {
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
      <AppHeader />
      <main
        id="contenido"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center px-space-4 pt-space-5 pb-space-6"
      >
        <Outlet />
      </main>
      {/* Pie del sistema (#202), con la privacidad y los créditos. */}
      <SiteFooter origin={footerOrigin(pathname, state)} />
    </div>
  )
}

/**
 * Barra según la sesión (#207; useAppIdentity):
 * - Con sesión, o con la sesión recordada sin confirmar (sin conexión o sin
 *   Clerk): la barra de la app (AppBar) con el menú «Tu cuenta».
 * - Sin sesión: la barra pública de la portada (PublicHeader), con «Iniciar
 *   sesión» y «Crear cuenta gratis».
 * - Mientras Clerk carga: la barra pública solo con el logotipo, sin
 *   adelantar si hay sesión.
 * - Sin Clerk y sin nadie recordado, o sin sesión y sin poder iniciarla (sin
 *   conexión o con Clerk caído): la barra pública solo con el logotipo y,
 *   debajo, el aviso breve (role="status"); la página se sigue viendo.
 */
function AppHeader() {
  const identity = useAppIdentity()
  const availability = useAuthAvailability()

  switch (identity.kind) {
    case 'signed-in':
    case 'unverified':
      return <AppBar account={<AccountMenu />} />
    case 'loading':
      return <PublicHeader actions={false} />
    case 'unavailable':
      return <UnavailableHeader reason={identity.reason} />
    case 'signed-out':
      // Cerró sesión aquí sin conexión y Clerk aún no lo sabe, o Clerk no
      // está: iniciar sesión tampoco funcionaría.
      if (availability === 'offline' || availability === 'failed') {
        return <UnavailableHeader reason={availability} />
      }
      return <PublicHeader />
  }
}

function UnavailableHeader({ reason }: { reason: 'offline' | 'failed' }) {
  return (
    <>
      <PublicHeader actions={false} />
      <div className="border-b border-neutral-200 bg-neutral-50 px-space-4 py-space-2 text-center">
        <AuthNotice reason={reason} />
      </div>
    </>
  )
}

// A dónde ofrecen volver la privacidad y los créditos abiertos desde el pie
// (#202): desde las pantallas con sesión (la colección, la cuenta, la
// administración), a «Mi colección»; desde el catálogo (#232), al catálogo;
// desde las propias páginas de texto, al mismo sitio que ya ofrecían; desde
// el resto, al inicio.
const SIGNED_IN_AREAS = [
  PATHS.collection,
  PATHS.ownershipCheck,
  PATHS.account,
  '/administracion',
]

function footerOrigin(pathname: string, state: unknown): TextPageOrigin {
  if (pathname === PATHS.privacy || pathname === PATHS.credits) {
    return textPageOrigin(state) ?? 'inicio'
  }
  if (pathname === PATHS.catalog || pathname.startsWith(`${PATHS.catalog}/`)) {
    return 'catalogo'
  }
  return SIGNED_IN_AREAS.some(
    (area) => pathname === area || pathname.startsWith(`${area}/`),
  )
    ? 'coleccion'
    : 'inicio'
}
