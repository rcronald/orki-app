import { useEffect, type ReactNode } from 'react'

interface AuthPageLayoutProps {
  /** Título de la pestaña, sin el nombre de la app. */
  title: string
  children: ReactNode
}

// Envoltorio de las pantallas de inicio de sesión y de registro: la marca con
// un enlace al inicio y el contenido centrado. El título visible lo pone el
// componente de Clerk; aquí solo se cambia el de la pestaña.
export function AuthPageLayout({ title, children }: AuthPageLayoutProps) {
  useEffect(() => {
    const previous = document.title
    document.title = `${title} · Orki`
    return () => {
      document.title = previous
    }
  }, [title])

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-0 text-neutral-900">
      <header className="px-space-4 py-space-3">
        <a
          href="/"
          className="font-display text-xl font-semibold text-neutral-900"
        >
          <span className="sr-only">Volver al inicio de</span> Orki
        </a>
      </header>
      <main className="flex flex-1 flex-col items-center px-space-4 pb-space-6">
        <div className="flex w-full max-w-md flex-col items-center gap-space-4">
          {children}
        </div>
      </main>
    </div>
  )
}
