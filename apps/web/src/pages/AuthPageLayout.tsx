import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo } from '../components/Logo.tsx'
import { useFocusOnNavigation, usePageTitle } from '../routes/navigation.ts'
import { PATHS } from '../routes/paths.ts'
import {
  textPageState,
  type TextPageOrigin,
} from '../routes/text-page-origin.ts'

interface AuthPageLayoutProps {
  /** Título de la pestaña, sin el nombre de la app. */
  title: string
  /** A dónde ofrecerá volver la privacidad (#202): en el registro, a él. */
  privacyOrigin?: TextPageOrigin
  children: ReactNode
}

// Envoltorio de las pantallas de inicio de sesión y de registro: la marca con
// un enlace al inicio y el contenido centrado. El título visible (h1) lo pone
// el componente de Clerk; aquí se cambia el de la pestaña y, al llegar
// navegando, el foco va al contenido principal (con su nombre accesible) para
// que el lector de pantalla anuncie la pantalla nueva.
export function AuthPageLayout({
  title,
  privacyOrigin = 'inicio',
  children,
}: AuthPageLayoutProps) {
  const mainRef = useRef<HTMLElement>(null)
  usePageTitle(title)
  useFocusOnNavigation(mainRef)

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-0 text-neutral-900">
      <header className="px-space-4 py-space-3">
        {/* Nombre accesible: «Volver al inicio de orqui.app» (el logotipo).
            44 px de alto (#174) sin mover nada: el margen negativo compensa
            lo que crece sobre el logotipo de 40 px. */}
        <Link
          to={PATHS.home}
          className="-my-[2px] inline-flex min-h-[44px] items-center rounded-md"
        >
          <span className="sr-only">Volver al inicio de</span>{' '}
          <Logo className="block h-[40px] w-auto" />
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
          {/* Antes de crear la cuenta, qué datos se guardan (#111), junto al
              formulario (#202). */}
          <p className="text-sm">
            {/* 44 px de alto (#174); el margen negativo lo deja en su línea
                de 20 px, así el diseño no cambia. */}
            <Link
              to={PATHS.privacy}
              state={textPageState(privacyOrigin)}
              className="-my-[12px] inline-flex min-h-[44px] items-center text-neutral-700 underline"
            >
              Privacidad
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
