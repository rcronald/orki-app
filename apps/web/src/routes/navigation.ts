import { createContext, useContext, useEffect, type RefObject } from 'react'
import { useLocation } from 'react-router'

/**
 * Clave (location.key) de la primera ubicación de la sesión de navegación, la
 * que se abrió al cargar la app. La fija NavigationFocusProvider. Sin
 * proveedor vale null y nunca se mueve el foco.
 */
export const InitialLocationKeyContext = createContext<string | null>(null)

/**
 * Lleva el foco a `ref` (el título de la página) cada vez que se llega por
 * navegación dentro de la app, no al cargarla. Así el lector de pantalla
 * anuncia la página nueva y el teclado sigue desde ahí, en lugar de quedarse
 * en el enlace pulsado de una página que ya no está.
 */
export function useFocusOnNavigation(ref: RefObject<HTMLElement | null>) {
  const initialKey = useContext(InitialLocationKeyContext)
  const { key } = useLocation()

  useEffect(() => {
    if (initialKey === null || key === initialKey) return
    ref.current?.focus()
  }, [initialKey, key, ref])
}

/** Título de la pestaña: "Página · Orki", o "Orki" a secas sin página. */
export function usePageTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · Orki` : 'Orki'
  }, [title])
}
