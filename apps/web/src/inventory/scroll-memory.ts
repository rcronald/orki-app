import { useEffect, useRef } from 'react'
import { NavigationType, useLocation, useNavigationType } from 'react-router'

// Posición de desplazamiento del inventario por entrada del historial, para
// volver a ella con "atrás" desde el registro u otra ruta.
//
// La app usa <BrowserRouter> (modo declarativo), donde <ScrollRestoration> de
// React Router no está disponible, y la restauración del navegador no es
// fiable en una SPA: llega antes de que la lista esté pintada. Así que se
// guarda aquí, en memoria (dura la sesión de la pestaña; al recargar, la
// página empieza arriba), con la clave de la entrada del historial
// (location.key). Solo se restaura al volver con atrás o adelante (POP): un
// enlace a /coleccion empieza arriba, como cualquier página nueva.

const positions = new Map<string, number>()

/**
 * Guarda la posición mientras la pantalla está montada y la restaura una vez,
 * cuando `ready` (los datos pintados) es true, si se llegó con atrás o
 * adelante. Úsalo en el componente de la página, no dentro de <Page>: su
 * efecto corre después del de <Page>, que mueve el foco al título.
 */
export function useScrollMemory(ready: boolean): void {
  const { key } = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    let y = window.scrollY
    const onScroll = () => {
      y = window.scrollY
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      positions.set(key, y)
    }
  }, [key])

  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !ready) return
    restored.current = true
    if (navigationType !== NavigationType.Pop) return
    const y = positions.get(key)
    if (y !== undefined) window.scrollTo(0, y)
  }, [ready, key, navigationType])
}
