import { useRef, type ReactNode } from 'react'
import { useFocusOnNavigation, usePageTitle } from '../routes/navigation.ts'

interface PageProps {
  /** Título visible (h1) y de la pestaña. */
  title: string
  /** Título de la pestaña si difiere; null deja solo "Orki". */
  tabTitle?: string | null
  /**
   * Ancho máximo: narrow (por defecto, 512 px) para textos y formularios;
   * wide (1024 px) para listas y cuadrículas que aprovechan el escritorio;
   * full (1280 px) para las tablas del backoffice.
   */
  width?: 'narrow' | 'wide' | 'full'
  children?: ReactNode
}

const WIDTH_CLASSES = {
  narrow: 'max-w-lg',
  wide: 'max-w-5xl',
  full: 'max-w-7xl',
} as const

// Contenido de una página dentro de AppShell: pone el título de la pestaña y
// el h1, que recibe el foco al llegar navegando (tabIndex -1 lo hace enfocable
// por código sin meterlo en el orden del tabulador).
export function Page({
  title,
  tabTitle = title,
  width = 'narrow',
  children,
}: PageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  usePageTitle(tabTitle)
  useFocusOnNavigation(headingRef)

  return (
    <div className={`flex w-full flex-col gap-space-3 ${WIDTH_CLASSES[width]}`}>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-xl font-semibold text-neutral-900"
      >
        {title}
      </h1>
      {children}
    </div>
  )
}
