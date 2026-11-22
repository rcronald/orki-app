import { plantFolder } from './paths.ts'
import { appPlantPhotoRecords, type PlantPhotoRecords } from './plant-record.ts'
import { appPhotoStorage, type PhotoStorage } from './storage.ts'

// Borrado de las fotos al eliminar una planta (#83, lo llamará el #16).
//
// Borrar la fila de plants no borra sus archivos (el esquema no puede tocar
// Storage): lo hace la app. Orden: primero la planta y después la carpeta.
// Si se borraran antes los archivos y fallara el borrado de la planta,
// quedaría una planta apuntando a archivos que no existen; así, lo peor que
// queda es una carpeta sin planta, que encuentra el script de limpieza.
//
// Con varias fotos por planta (#219) no cambia nada: todas (la principal y
// las secundarias de plant_photos) están en la carpeta de la planta, y sus
// filas se borran con la planta (on delete cascade).

export interface DeletePlantPhotosOptions {
  userId: string
  plantId: string
  storage?: PhotoStorage
}

/**
 * Borra todos los archivos de la carpeta de una planta
 * (<usuario>/<planta>/): la foto y la miniatura actuales y cualquier resto de
 * subidas anteriores. Devuelve las rutas borradas. Rechaza con
 * PhotoStorageError si no puede listar o borrar.
 */
export async function deletePlantPhotoFolder({
  userId,
  plantId,
  storage = appPhotoStorage(),
}: DeletePlantPhotosOptions): Promise<string[]> {
  const paths = await storage.list(plantFolder(userId, plantId))
  // Remove acepta varias rutas por petición; de 100 en 100 por prudencia.
  for (let index = 0; index < paths.length; index += 100) {
    await storage.remove(paths.slice(index, index + 100))
  }
  return paths
}

export interface DeletePlantWithPhotosOptions extends DeletePlantPhotosOptions {
  records?: PlantPhotoRecords
  /** Quita la planta de la colección (useCollection().removePlant). */
  onPlantRemoved?: (plantId: string) => void
}

export interface DeletePlantWithPhotosResult {
  /**
   * false si la planta se borró pero sus archivos no (sin conexión al
   * final): quedan para el script de limpieza.
   */
  photosDeleted: boolean
}

/**
 * Elimina una planta y sus fotos: 1) borra la fila; 2) la quita de la
 * colección; 3) borra la carpeta de sus fotos. Si falla 1, no se toca nada
 * y rechaza con PhotoStorageError; si falla 3, la planta ya no existe y
 * devuelve photosDeleted: false.
 */
export async function deletePlantWithPhotos({
  userId,
  plantId,
  storage = appPhotoStorage(),
  records = appPlantPhotoRecords(),
  onPlantRemoved,
}: DeletePlantWithPhotosOptions): Promise<DeletePlantWithPhotosResult> {
  await records.deletePlant(plantId, userId)
  onPlantRemoved?.(plantId)
  try {
    await deletePlantPhotoFolder({ userId, plantId, storage })
    return { photosDeleted: true }
  } catch {
    return { photosDeleted: false }
  }
}
