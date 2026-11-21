import {
  createContext,
  useContext,
  useEffect,
  useState,
  type RefObject,
} from 'react'
import {
  appPlantImageSource,
  type PlantImageKind,
  type PlantImageSource,
} from './read.ts'

// Hooks de lectura de fotos para las pantallas (#83). Las pantallas no saben
// de dónde sale la imagen: piden una ruta y reciben una dirección. La fuente
// se puede sustituir con <PlantImagesContext value={...}> (pruebas, página de
// muestra o la caché sin conexión del #18).

/** Fuente de imágenes; null usa la de la app (bucket real y Cache Storage). */
export const PlantImagesContext = createContext<PlantImageSource | null>(null)

export function usePlantImageSource(): PlantImageSource {
  return useContext(PlantImagesContext) ?? appPlantImageSource()
}

export type PlantImageState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; src: string }
  | { status: 'error' }

/**
 * Dirección de la imagen de `path` (miniatura o foto). Con path null o
 * enabled false no pide nada. Si falla, vuelve a intentarlo al recuperar la
 * conexión (evento online) o cuando el componente se vuelve a montar.
 */
export function usePlantImage(
  path: string | null,
  kind: PlantImageKind,
  enabled = true,
): PlantImageState {
  const source = usePlantImageSource()
  const [state, setState] = useState<{
    key: string
    value: PlantImageState
  } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${kind}:${path ?? ''}:${attempt}`

  useEffect(() => {
    if (path === null || !enabled) return
    const controller = new AbortController()
    let acquired = false
    source.acquire(path, kind, { signal: controller.signal }).then(
      (src) => {
        acquired = true
        setState({ key, value: { status: 'ready', src } })
      },
      () => {
        if (!controller.signal.aborted) {
          setState({ key, value: { status: 'error' } })
        }
      },
    )
    return () => {
      controller.abort()
      if (acquired) source.release(path)
    }
  }, [source, path, kind, enabled, key])

  const failed = state?.key === key && state.value.status === 'error'
  useEffect(() => {
    if (!failed) return
    const retry = () => setAttempt((count) => count + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [failed])

  if (path === null) return { status: 'none' }
  if (state?.key === key) return state.value
  return { status: 'loading' }
}

/**
 * true cuando el elemento está en pantalla o cerca (margen `rootMargin`), y
 * desde entonces siempre: una imagen ya pedida no se suelta al desplazarse.
 * Sin IntersectionObserver (navegadores muy antiguos), true desde el inicio.
 */
export function useNearViewport(
  ref: RefObject<Element | null>,
  rootMargin = '300px',
): boolean {
  const [near, setNear] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  useEffect(() => {
    const element = ref.current
    if (near || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, rootMargin, near])
  return near
}
