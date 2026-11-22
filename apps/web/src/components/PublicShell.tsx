import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import { PublicHeader } from './PublicHeader.tsx'

interface PublicShellProps {
  /** Con «Iniciar sesión» y «Crear cuenta gratis» en la cabecera (por defecto). */
  actions?: boolean
  children: ReactNode
}

// Estructura de la portada (#191): como AppShell, pero con la cabecera
// pública y sin la navegación principal (sin chips) ni los controles de
// cuenta, porque solo se ve sin sesión. Conserva el enlace para saltar al
// contenido y el pie con la privacidad. El contenido ocupa todo el ancho: la
// foto de la portada llega hasta el borde derecho.
export function PublicShell({ actions = true, children }: PublicShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-neutral-0 text-neutral-900">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-space-2 focus:left-space-2 focus:z-50 focus:rounded-md focus:bg-neutral-0 focus:p-space-2"
      >
        Saltar al contenido
      </a>
      <PublicHeader actions={actions} />
      <main id="contenido" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
      <footer className="px-space-4 pb-space-4 text-center text-sm">
        <Link to={PATHS.privacy} className="text-neutral-700 underline">
          Privacidad
        </Link>
      </footer>
    </div>
  )
}
