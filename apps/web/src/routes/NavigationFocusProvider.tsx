import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { InitialLocationKeyContext } from './navigation.ts'

// Recuerda la ubicación con la que arrancó la app, para que las páginas
// distingan una carga (el foco se queda donde lo deja el navegador) de una
// navegación dentro de la app (el foco va al título; ver useFocusOnNavigation).
export function NavigationFocusProvider({ children }: { children: ReactNode }) {
  const { key } = useLocation()
  const [initialKey] = useState(key)
  return (
    <InitialLocationKeyContext value={initialKey}>
      {children}
    </InitialLocationKeyContext>
  )
}
