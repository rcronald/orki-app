import type { ReactNode } from 'react'
import { PublicHeader } from './PublicHeader.tsx'
import { SiteFooter } from './SiteFooter.tsx'

interface PublicShellProps {
  /** Con «Iniciar sesión» y «Crear cuenta gratis» en la cabecera (por defecto). */
  actions?: boolean
  children: ReactNode
}

// Estructura de la portada (#191, #200): como AppShell, pero con la cabecera
// pública y sin la navegación principal (sin chips). Conserva el enlace para
// saltar al contenido y lleva el pie del sistema (SiteFooter). El contenido
// ocupa todo el ancho: la foto de la portada llega hasta el borde derecho.
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
      <SiteFooter />
    </div>
  )
}
