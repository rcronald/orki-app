import { useCallback, useEffect, useState } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import type { StoredPlantPhoto } from '../photos/photo-rows.ts'
import {
  photoStorageErrorFrom,
  type PhotoStorageErrorReason,
} from '../photos/storage.ts'
import {
  forgetAllPlantPhotos,
  recalledPlantPhotos,
  recentPlantPhotos,
  rememberPlantPhotos,
  SAVED_FRESH_MS,
} from '../photos/plant-photos-memory.ts'
import { usePlantPhotoRows } from '../photos/usePlantPhotoRows.ts'

// Las fotos de una planta para la galería del detalle (#183).
//
// - Al abrir el detalle se leen de plant_photos (listPlantPhotos). Mientras
//   tanto, o si no se pueden leer, se muestra lo que hay en la planta de la
//   colección: su foto principal, que es lo único que está garantizado sin
//   conexión (la colección y las miniaturas principales se guardan en el
//   dispositivo, #18 y #119).
// - Lo leído se recuerda en memoria mientras dura la pestaña, por persona y
//   planta (photos/plant-photos-memory.ts, que comparte con la edición): al
//   volver a la planta sin conexión se ve la galería entera (cada foto, si su
//   miniatura está en la caché). No se guarda en el dispositivo: sin conexión
//   tras recargar, solo la principal.
// - Al volver de guardar la edición no se lee otra vez (#285): se usan las
//   filas que devolvió la base al terminar el guardado, si son de hace menos
//   de SAVED_FRESH_MS. «Volver a cargar» y la vuelta de la conexión leen
//   siempre.
// - Si la lectura falla, se reintenta al recuperar la conexión.
// - Sin la lista leída (o recordada) no hay ids de fotos: la galería no deja
//   cambiar nada (`known` false).

/** Olvida lo recordado (pruebas). */
export function forgetPlantGalleries(): void {
  forgetAllPlantPhotos()
}

export type PlantGalleryLoad =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; reason: PhotoStorageErrorReason }

export interface PlantGallery {
  /** Las fotos que se muestran, en orden (la principal primero). */
  photos: StoredPlantPhoto[]
  /** true si son las de plant_photos (leídas o recordadas): se pueden cambiar. */
  known: boolean
  load: PlantGalleryLoad
  /** Vuelve a leerlas. */
  reload: () => void
  /** Las fotos tras un cambio hecho aquí (fecha, nota, orden). */
  replace: (photos: StoredPlantPhoto[]) => void
}

/** La principal de la planta de la colección, como foto de la galería. */
function mainPhotoOf(plant: CollectionPlant): StoredPlantPhoto[] {
  if (plant.photoPath === null || plant.thumbnailPath === null) return []
  return [
    {
      id: `principal:${plant.id}`,
      plantId: plant.id,
      photoPath: plant.photoPath,
      thumbnailPath: plant.thumbnailPath,
      inBloom: plant.photoInBloom,
      takenAt: null,
      note: null,
      position: 0,
      createdAt: plant.createdAt,
    },
  ]
}

/** Lo recordado sigue valiendo si su principal es la de la planta. */
function stillValid(photos: StoredPlantPhoto[], plant: CollectionPlant) {
  return (photos[0]?.photoPath ?? null) === plant.photoPath
}

interface Result {
  key: string
  photos?: StoredPlantPhoto[]
  error?: PhotoStorageErrorReason
}

export function usePlantGallery(
  plant: CollectionPlant,
  userId: string | null,
): PlantGallery {
  const rows = usePlantPhotoRows()
  const plantId = plant.id
  const key = userId === null ? null : `${userId}/${plantId}`
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    if (key === null || userId === null) return
    let active = true
    const saved =
      attempt === 0
        ? recentPlantPhotos(rows, userId, plantId, SAVED_FRESH_MS, {
            savedOnly: true,
          })
        : null
    const read = saved ? Promise.resolve(saved) : rows.list(plantId, userId)
    read.then(
      (photos) => {
        if (!active) return
        if (!saved) rememberPlantPhotos(rows, userId, plantId, photos)
        setResult({ key, photos })
      },
      (error: unknown) => {
        if (!active) return
        setResult({ key, error: photoStorageErrorFrom(error).reason })
      },
    )
    return () => {
      active = false
    }
  }, [rows, key, plantId, userId, attempt])

  const current = result?.key === key ? result : null
  const failed = current?.error !== undefined
  useEffect(() => {
    if (!failed) return
    const retry = () => setAttempt((count) => count + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [failed])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  const replace = useCallback(
    (photos: StoredPlantPhoto[]) => {
      if (key === null || userId === null) return
      rememberPlantPhotos(rows, userId, plantId, photos)
      setResult({ key, photos })
    },
    [rows, key, plantId, userId],
  )

  const load: PlantGalleryLoad = current?.photos
    ? { status: 'ready' }
    : current?.error
      ? { status: 'error', reason: current.error }
      : { status: 'loading' }
  const recalled =
    userId === null ? undefined : recalledPlantPhotos(rows, userId, plantId)
  const photos =
    current?.photos ??
    (recalled && stillValid(recalled, plant) ? recalled : undefined)
  return {
    photos: photos ?? mainPhotoOf(plant),
    known: photos !== undefined,
    load,
    reload,
    replace,
  }
}
