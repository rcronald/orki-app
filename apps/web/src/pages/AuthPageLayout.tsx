import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useFocusOnNavigation, usePageTitle } from '../routes/navigation.ts'
import { PATHS } from '../routes/paths.ts'

interface AuthPageLayoutProps {
  /** Título de la pestaña, sin el nombre de la app. */
  title: string
  children: ReactNode
}

// Envoltorio de las pantallas de inicio de sesión y de registro: la marca con
// un enlace al inicio y el contenido centrado. El título visible (h1) lo pone
// el componente de Clerk; aquí se cambia el de la pestaña y, al llegar
// navegando, el foco va al contenido principal (con su nombre accesible) para
// que el lector de pantalla anuncie la pantalla nueva.
export function AuthPageLayout({ title, children }: AuthPageLayoutProps) {
  const mainRef = useRef<HTMLElement>(null)
  usePageTitle(title)
  useFocusOnNavigation(mainRef)

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-0 text-neutral-900">
      <header className="px-space-4 py-space-3">
        <Link
          to={PATHS.home}
          className="font-display text-xl font-semibold text-neutral-900"
        >
          <span className="sr-only">Volver al inicio de</span> Orki
        </Link>
      </header>
      <main
        ref={mainRef}
        tabIndex={-1}
        aria-label={title}
        className="flex flex-1 flex-col items-center px-space-4 pb-space-6"
      >
        <div className="flex w-full max-w-md flex-col items-center gap-space-4">
          {children}
        </div>
      </main>
    </div>
  )
}
