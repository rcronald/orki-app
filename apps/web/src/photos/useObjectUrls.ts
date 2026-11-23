import { useEffect, useState } from 'react'

/**
 * URL de objeto de cada Blob (miniaturas de las fotos elegidas, #221). Se
 * crean al aparecer el Blob y se revocan al quitarlo o al desmontar. Mientras
 * no hay URL (el primer pintado), el Blob no está en el mapa.
 */
export function useObjectUrls(
  blobs: readonly Blob[],
): ReadonlyMap<Blob, string> {
  const [urls, setUrls] = useState<ReadonlyMap<Blob, string>>(() => new Map())
  // Cambia solo si cambia algún Blob, no con cada lista nueva.
  const [key, setKey] = useState<readonly Blob[]>(blobs)
  if (
    key.length !== blobs.length ||
    key.some((blob, index) => blob !== blobs[index])
  ) {
    setKey(blobs)
  }

  useEffect(() => {
    const created = new Map(
      key.map((blob) => [blob, URL.createObjectURL(blob)]),
    )
    // eslint-disable-next-line react-hooks/set-state-in-effect -- las URL son un recurso externo que se crea y se revoca aquí.
    setUrls(created)
    return () => {
      for (const url of created.values()) URL.revokeObjectURL(url)
    }
  }, [key])

  return urls
}
