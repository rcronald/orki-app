import {
  createContext,
  useContext,
  useEffect,
  useState,
  type RefObject,
} from 'react'
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
//
// Solo cuenta un cambio de página: al montarse la pantalla o al cambiar la
// ruta. Cambiar la búsqueda de la URL en la misma página (el buscador del
// inventario escribe ?q= en cada pulsación) no mueve el foco, que se queda en
// el campo.
export function useFocusOnNavigation(ref: RefObject<HTMLElement | null>) {
  const initialKey = useContext(InitialLocationKeyContext)
  const { key, pathname } = useLocation()
  const [mounted] = useState(() => ({ key, pathname }))

  useEffect(() => {
    if (initialKey === null) return
    const isAppLoad =
      mounted.key === initialKey && mounted.pathname === pathname
    if (isAppLoad) return
    ref.current?.focus()
  }, [initialKey, mounted, pathname, ref])
}

/** Título de la pestaña: "Página · orqui.app", o "orqui.app" a secas sin página. */
export function usePageTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · orqui.app` : 'orqui.app'
  }, [title])
}
