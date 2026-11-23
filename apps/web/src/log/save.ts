import type { PlantLogEntryType } from '../lib/database.ts'
import { LOG_SUBFOLDER, type PlantPhotoPaths } from '../photos/paths.ts'
import {
  photoStorageErrorFrom,
  type PhotoStorage,
  type PhotoStorageError,
} from '../photos/storage.ts'
import {
  removeQuietly,
  uploadPhotoFiles,
  type PhotoFiles,
} from '../photos/upload.ts'
import {
  plantLogErrorFrom,
  type PlantLogEntries,
  type PlantLogError,
} from './entries.ts'
import type { LogEntry } from './model.ts'

// Guardar y borrar un registro de la bitácora (#267).
//
// Guardar, en dos pasos y sin duplicar nada al reintentar:
//
// 1. Si hay foto, subir la foto y la miniatura a <usuario>/<planta>/log/.
//    Cada foto preparada tiene su versión fija (photoVersionFor), así que un
//    reintento sube a las mismas rutas y Storage responde 409 si ya estaban
//    (se dan por subidas). Si la subida falla, uploadPhotoFiles borra lo que
//    subió.
// 2. Crear el registro con add_plant_log_entry y la clave de reintento del
//    formulario (una por formulario, la misma en cada intento): si un intento
//    anterior llegó a crearlo aunque se perdiera la respuesta, la base
//    devuelve ese mismo registro en lugar de otro.
//
// Archivos sueltos: si el paso 2 falla con seguridad (la base respondió que
// no), la foto subida se borra; el reintento la vuelve a subir a la misma
// ruta. Si falla sin saberse si se guardó (red caída a mitad o error del
// servidor), la foto se queda: quizá el registro existe y la cita. Desde ese
// momento el formulario no borra nada más (ni al fallar ni al cancelar): lo
// que sobre lo encuentra el script de fotos huérfanas («sin-registro», con
// su antigüedad mínima). Cancelar sin un fallo dudoso borra lo subido
// (discardLogUpload).

/** Lo que se escribe en el formulario, ya normalizado. */
export interface LogEntryDraft {
  type: PlantLogEntryType
  title: string
  description: string | null
  inBloom: boolean | null
}

export interface SaveLogEntryInput {
  userId: string
  plantId: string
  draft: LogEntryDraft
  /** La foto preparada (processPhoto), o null. */
  photo: PhotoFiles | null
  idempotencyKey: string
  entries: PlantLogEntries
  storage: PhotoStorage
  /**
   * No borrar la foto subida si el registro falla: un intento anterior quedó
   * en duda y quizá el registro ya la cita.
   */
  keepUploadOnFailure?: boolean
}

/** Por qué no se guardó: la subida de la foto o el registro. */
export class SaveLogEntryError extends Error {
  readonly step: 'upload' | 'entry'
  readonly failure: PhotoStorageError | PlantLogError
  /** Si no se sabe si el registro llegó a guardarse. */
  readonly uncertain: boolean
  /** Rutas de la foto que quedaron subidas tras el fallo (o null). */
  readonly uploaded: PlantPhotoPaths | null

  constructor(
    step: 'upload' | 'entry',
    failure: PhotoStorageError | PlantLogError,
    uploaded: PlantPhotoPaths | null,
  ) {
    super(failure.message, { cause: failure })
    this.name = 'SaveLogEntryError'
    this.step = step
    this.failure = failure
    this.uncertain = step === 'entry' && failure.uncertain
    this.uploaded = uploaded
  }
}

/** Sube la foto (si hay) y crea el registro. Rechaza con SaveLogEntryError. */
export async function saveLogEntry({
  userId,
  plantId,
  draft,
  photo,
  idempotencyKey,
  entries,
  storage,
  keepUploadOnFailure = false,
}: SaveLogEntryInput): Promise<LogEntry> {
  let paths: PlantPhotoPaths | null = null
  if (photo !== null) {
    try {
      paths = await uploadPhotoFiles(photo, {
        userId,
        plantId: plantId.toLowerCase(),
        storage,
        subfolder: LOG_SUBFOLDER,
      })
    } catch (error) {
      throw new SaveLogEntryError('upload', photoStorageErrorFrom(error), null)
    }
  }
  try {
    return await entries.add({
      plantId,
      type: draft.type,
      title: draft.title,
      description: draft.description,
      photoPath: paths?.photoPath ?? null,
      thumbnailPath: paths?.thumbnailPath ?? null,
      inBloom: draft.inBloom,
      idempotencyKey,
    })
  } catch (error) {
    const failure = plantLogErrorFrom(error)
    if (paths !== null && !failure.uncertain && !keepUploadOnFailure) {
      await removeQuietly(storage, [paths.photoPath, paths.thumbnailPath])
      paths = null
    }
    throw new SaveLogEntryError('entry', failure, paths)
  }
}

/** Borra sin fallar la foto que subió un formulario que no llegó a guardarse. */
export async function discardLogUpload(
  storage: PhotoStorage,
  paths: PlantPhotoPaths | null,
): Promise<void> {
  if (paths === null) return
  await removeQuietly(storage, [paths.photoPath, paths.thumbnailPath])
}

export interface DeleteLogEntryInput {
  userId: string
  entry: LogEntry
  entries: PlantLogEntries
  storage: PhotoStorage
}

export interface DeleteLogEntryResult {
  /** false si el registro se borró pero su foto no (queda para la limpieza). */
  photoDeleted: boolean
}

/**
 * Borra un registro y después su foto. Primero la fila: si fallara al revés,
 * quedaría un registro con la foto rota; así lo peor es un archivo sin
 * registro, que encuentra el script de fotos huérfanas. Si el registro ya no
 * existía, también cuenta como borrado. Rechaza con PlantLogError si no pudo
 * borrar la fila.
 */
export async function deleteLogEntry({
  userId,
  entry,
  entries,
  storage,
}: DeleteLogEntryInput): Promise<DeleteLogEntryResult> {
  try {
    await entries.remove(entry.id, userId)
  } catch (error) {
    throw plantLogErrorFrom(error)
  }
  const files = [entry.photoPath, entry.thumbnailPath].filter(
    (path): path is string => path !== null,
  )
  const left = await removeQuietly(storage, files)
  return { photoDeleted: left.length === 0 }
}
