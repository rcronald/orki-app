import { useEffect, useState } from 'react'
import {
  getSpeciesReferencePhoto,
  type ReferencePicture,
} from './referencePhotos.ts'
import { useOnlineStatus } from './useOnlineStatus.ts'

/** Lee la foto de referencia de una especie (getSpeciesReferencePhoto). */
export type LoadReferencePhoto = (
  speciesId: string,
  options: { signal: AbortSignal },
) => Promise<ReferencePicture | null>

/**
 * Lo ya leído, por especie, mientras dura la pestaña (solo en memoria: las
 * fotos de referencia no se guardan en el dispositivo). Así volver al detalle
 * o elegir otra vez la misma especie no repite la consulta.
 */
const remembered = new Map<string, ReferencePicture | null>()

/** Olvida lo leído (pruebas). */
export function forgetReferencePhotos(): void {
  remembered.clear()
}

/**
 * La foto de referencia de `speciesId` (#234), o null mientras llega, si no
 * tiene, si falla o sin conexión (entonces no se pide). Con null en
 * `speciesId` no se pide nada. Como mucho una consulta por especie.
 */
export function useReferencePhoto(
  speciesId: string | null,
  load: LoadReferencePhoto = getSpeciesReferencePhoto,
): ReferencePicture | null {
  const online = useOnlineStatus()
  const [result, setResult] = useState<{
    speciesId: string
    picture: ReferencePicture | null
  } | null>(null)
  const known = speciesId !== null && remembered.has(speciesId)

  useEffect(() => {
    if (speciesId === null || !online || known) return
    const controller = new AbortController()
    load(speciesId, { signal: controller.signal }).then(
      (picture) => {
        if (controller.signal.aborted) return
        remembered.set(speciesId, picture)
        setResult({ speciesId, picture })
      },
      () => undefined,
    )
    return () => controller.abort()
  }, [speciesId, online, known, load])

  if (speciesId === null) return null
  if (result?.speciesId === speciesId) return result.picture
  return remembered.get(speciesId) ?? null
}
