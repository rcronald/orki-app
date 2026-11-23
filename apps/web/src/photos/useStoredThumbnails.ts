import { useEffect, useState } from 'react'
import { usePlantImageSource } from './usePlantImage.ts'

/**
 * Miniaturas de varias fotos ya guardadas (la galería de la edición, #221):
 * la dirección de cada ruta que ya llegó. Usa la misma fuente que
 * usePlantImage (Cache Storage y descargas de 6 en 6) y suelta las imágenes al
 * cambiar la lista o al desmontar. Una que falla no aparece: la miniatura se
 * queda en su hueco con su nombre.
 */
export function useStoredThumbnails(
  paths: readonly string[],
): ReadonlyMap<string, string> {
  const source = usePlantImageSource()
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map())
  const key = paths.join('\n')

  useEffect(() => {
    const list = key === '' ? [] : key.split('\n')
    const controller = new AbortController()
    const acquired: string[] = []
    for (const path of list) {
      source.acquire(path, 'thumbnail', { signal: controller.signal }).then(
        (src) => {
          acquired.push(path)
          setUrls((current) => new Map(current).set(path, src))
        },
        () => undefined,
      )
    }
    return () => {
      controller.abort()
      for (const path of acquired) source.release(path)
      setUrls(new Map())
    }
  }, [source, key])

  return urls
}
