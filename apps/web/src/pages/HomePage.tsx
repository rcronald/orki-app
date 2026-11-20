import { useRef } from 'react'
import { useFocusOnNavigation, usePageTitle } from '../routes/navigation.ts'

// Pantalla de inicio provisional. Es pública: se ve con o sin sesión y aunque
// Clerk no cargue (sin conexión).
export function HomePage() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  usePageTitle(null)
  useFocusOnNavigation(headingRef)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-space-3 text-center">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-display font-semibold text-neutral-900"
      >
        Orki
      </h1>
      <p className="max-w-sm text-lg text-neutral-700">
        Tu colección de orquídeas, siempre a mano.
      </p>
    </div>
  )
}
