import { useRef, type ReactNode } from 'react'
import { useFocusOnNavigation, usePageTitle } from '../routes/navigation.ts'
import { PageHeader, type PageHeaderProps } from './ui/PageHeader.tsx'

interface PageProps {
  /** Título visible (h1) y de la pestaña. */
  title: string
  /** Título de la pestaña si difiere; null deja solo "orqui.app". */
  tabTitle?: string | null
  /**
   * Contenido del h1 si no es el texto de `title` tal cual; por ejemplo, un
   * nombre científico en cursiva. `title` sigue siendo el de la pestaña.
   */
  heading?: ReactNode
  /** Lo que va antes del h1, como un enlace para volver. */
  before?: ReactNode
  /**
   * Ancho máximo: narrow (por defecto, 512 px) para textos y formularios;
   * medium (896 px) para pantallas de paneles, como «Tu cuenta»; wide
   * (1024 px) para listas y cuadrículas que aprovechan el escritorio; full
   * (1280 px) para las tablas del backoffice.
   */
  width?: 'narrow' | 'medium' | 'wide' | 'full'
  /**
   * Cabecera de pantalla del sistema (PageHeader, orki-pagehead, #206) en
   * lugar del h1 sencillo: título grande, contador o frase, acciones e
   * ilustración. El h1 sigue recibiendo el foco al navegar.
   */
  header?: Omit<PageHeaderProps, 'title' | 'headingRef'>
  children?: ReactNode
}

const WIDTH_CLASSES = {
  narrow: 'max-w-lg',
  medium: 'max-w-[56rem]',
  wide: 'max-w-5xl',
  full: 'max-w-7xl',
} as const

// Contenido de una página dentro de AppShell: pone el título de la pestaña y
// el h1, que recibe el foco al llegar navegando (tabIndex -1 lo hace enfocable
// por código sin meterlo en el orden del tabulador).
export function Page({
  title,
  tabTitle = title,
  heading,
  before,
  width = 'narrow',
  header,
  children,
}: PageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  usePageTitle(tabTitle)
  useFocusOnNavigation(headingRef)

  return (
    <div className={`flex w-full flex-col gap-space-3 ${WIDTH_CLASSES[width]}`}>
      {before}
      {header ? (
        <PageHeader
          {...header}
          title={heading ?? title}
          headingRef={headingRef}
        />
      ) : (
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-xl font-semibold text-neutral-900 [overflow-wrap:anywhere]"
        >
          {heading ?? title}
        </h1>
      )}
      {children}
    </div>
  )
}
