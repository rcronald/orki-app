import {
  getSupabase,
  sessionTokenFailure,
  type OrkiSupabaseClient,
} from '../lib/supabase.ts'
import { PLANT_PHOTOS_BUCKET, type PlantPhotoType } from './paths.ts'

// Acceso al bucket de fotos de plantas (#82, #83) detrás de una interfaz
// mínima, PhotoStorage: la subida, la lectura y el borrado no saben de
// storage-js, y las pruebas y la página de muestra pasan un doble.
//
// Lo comprobado en la documentación de supabase-js Storage (referencia y
// tipos de @supabase/storage-js 2.119, 21 de noviembre de 2026):
// - upload(path, body, { cacheControl, contentType, upsert }): con un Blob,
//   storage-js envía un FormData; el campo cacheControl va en el formulario
//   y el tipo de contenido lo toma Storage de la parte del archivo, es decir,
//   del type del Blob (contentType solo se usa con cuerpos que no son Blob).
//   Por eso se sube siempre un Blob con el type correcto. cacheControl se
//   guarda con el objeto y Storage lo sirve como "Cache-Control: max-age=N"
//   (por defecto 3600). upsert por defecto es false: si la ruta existe,
//   responde 409 (Duplicate).
// - upload no acepta AbortSignal (FileOptions no tiene signal). Cancelar una
//   subida es dejar de esperarla y borrar lo que llegue a subirse (ver
//   upload.ts).
// - remove(paths): borra varias rutas en una petición; una ruta que no
//   existe no da error (devuelve la lista de lo borrado).
// - list(prefijo, { limit, offset }): lista una "carpeta"; hasta 100 por
//   defecto.
// - download(path, opciones, { signal }): descarga autenticada a Blob, con
//   AbortSignal.
// - createSignedUrls(paths, segundos): firma varias rutas en una petición.
//   Ver read.ts para por qué la app no las usa.
// - Errores: StorageApiError con status (HTTP) y statusCode (texto, a veces
//   el código real cuando Storage responde 400, como "413" o "403") y code
//   ("EntityTooLarge", "InvalidMimeType", "InvalidJWT"...); un fallo de red o
//   el SessionTokenError del token de Clerk llegan como StorageUnknownError
//   con originalError.
// - Permisos que exige cada orden (#80): subir, insert; descargar, listar y
//   firmar, select; borrar, select y delete.

/**
 * Por qué falló una operación con el bucket o con la planta:
 * - offline: sin conexión o la red falló antes de responder.
 * - session-ended: la sesión terminó o Supabase no acepta el token.
 * - too-large: el bucket rechazó el archivo por su tamaño (tope de 1 MiB).
 * - unsupported-type: el bucket rechazó el tipo de contenido.
 * - forbidden: las políticas no lo permiten (una ruta que no es del usuario).
 * - not-found: la planta o el archivo no existen.
 * - too-many-photos: la planta ya tiene el máximo de fotos (6, #219).
 * - position-taken: la posición de la foto ya está ocupada (23505 de
 *   plant_photos); la galería lo resuelve eligiendo otra o lo traduce a
 *   too-many-photos.
 * - failed: cualquier otro fallo.
 * - aborted: se canceló.
 */
export type PhotoStorageErrorReason =
  | 'offline'
  | 'session-ended'
  | 'too-large'
  | 'unsupported-type'
  | 'forbidden'
  | 'not-found'
  | 'too-many-photos'
  | 'position-taken'
  | 'failed'
  | 'aborted'

/** Textos para mostrar en pantalla, uno por motivo. */
export const PHOTO_STORAGE_ERROR_TEXT: Record<PhotoStorageErrorReason, string> =
  {
    offline: 'Sin conexión: no se pudo subir la foto. Vuelve a intentarlo.',
    'session-ended':
      'Tu sesión terminó. Vuelve a iniciar sesión para guardar la foto.',
    'too-large':
      'La foto pesa demasiado para guardarla. Elige otra o vuelve a hacerla.',
    'unsupported-type':
      'No se pudo guardar la foto en ese formato. Elige otra foto.',
    forbidden: 'No tienes permiso para guardar esta foto.',
    'not-found': 'La planta ya no existe.',
    'too-many-photos':
      'Una planta puede tener como mucho 6 fotos. Quita alguna para añadir otra.',
    'position-taken':
      'Otra foto ocupó ese lugar de la galería. Vuelve a intentarlo.',
    failed: 'No se pudo guardar la foto. Vuelve a intentarlo.',
    aborted: 'Se canceló la subida de la foto.',
  }

/** Error de una operación de fotos, con su motivo. */
export class PhotoStorageError extends Error {
  readonly reason: PhotoStorageErrorReason
  /**
   * true si no se sabe si la operación llegó a aplicarse en el servidor: la
   * petición salió y no llegó la respuesta (red caída a mitad). Quien
   * compensa (borrar lo subido) no debe dar por hecho que falló.
   */
  readonly uncertain: boolean

  constructor(
    reason: PhotoStorageErrorReason,
    options?: { cause?: unknown; uncertain?: boolean },
  ) {
    super(
      PHOTO_STORAGE_ERROR_TEXT[reason],
      options?.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'PhotoStorageError'
    this.reason = reason
    this.uncertain = options?.uncertain ?? false
  }
}

/** Un error cualquiera como PhotoStorageError (los ajenos, failed). */
export function photoStorageErrorFrom(error: unknown): PhotoStorageError {
  if (error instanceof PhotoStorageError) return error
  return new PhotoStorageError('failed', { cause: error })
}

interface StorageErrorLike {
  name?: unknown
  message?: unknown
  status?: unknown
  statusCode?: unknown
  code?: unknown
  originalError?: unknown
}

/**
 * Motivo de un error de storage-js. Los rechazos del servidor
 * (StorageApiError) son seguros: la operación no se aplicó. Un fallo de red
 * (StorageUnknownError con un TypeError de fetch) es incierto.
 */
export function classifyStorageError(error: unknown): PhotoStorageError {
  if (error instanceof PhotoStorageError) return error
  const token = sessionTokenFailure(
    (error as StorageErrorLike | null)?.originalError ?? error,
  )
  if (token !== null) {
    // El token no llegó: la petición no se envió.
    return new PhotoStorageError(token, { cause: error })
  }
  if (typeof error !== 'object' || error === null) {
    return new PhotoStorageError('failed', { cause: error })
  }
  const value = error as StorageErrorLike
  if (value.name === 'AbortError') {
    return new PhotoStorageError('aborted', { cause: error })
  }
  const status = typeof value.status === 'number' ? value.status : undefined
  if (status === undefined) {
    // Sin respuesta del servidor: red caída, DNS o CORS de un portal cautivo.
    return new PhotoStorageError('offline', { cause: error, uncertain: true })
  }
  // Storage a veces responde 400 con el código real en statusCode.
  const statusCode = Number(value.statusCode)
  const effective =
    status === 400 && Number.isInteger(statusCode) ? statusCode : status
  const code = typeof value.code === 'string' ? value.code : ''
  if (effective === 413 || code === 'EntityTooLarge') {
    return new PhotoStorageError('too-large', { cause: error })
  }
  if (effective === 415 || code === 'InvalidMimeType') {
    return new PhotoStorageError('unsupported-type', { cause: error })
  }
  if (effective === 401 || code === 'InvalidJWT') {
    return new PhotoStorageError('session-ended', { cause: error })
  }
  if (effective === 403 || code === 'AccessDenied') {
    return new PhotoStorageError('forbidden', { cause: error })
  }
  if (effective === 404 || code === 'NoSuchKey') {
    return new PhotoStorageError('not-found', { cause: error })
  }
  // 5xx: el servidor respondió, pero no se sabe si guardó.
  return new PhotoStorageError('failed', {
    cause: error,
    uncertain: effective >= 500,
  })
}

/** ¿Rechazó Storage la subida porque la ruta ya existe? (409, Duplicate) */
export function isDuplicate(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const value = error as StorageErrorLike & { error?: unknown }
  return (
    value.status === 409 ||
    Number(value.statusCode) === 409 ||
    value.code === 'Duplicate' ||
    value.error === 'Duplicate'
  )
}

/**
 * Caché de los objetos: un año. Cada ruta lleva su versión y nunca cambia de
 * contenido, así que el navegador y la CDN de Storage pueden guardarla
 * indefinidamente.
 */
export const PHOTO_CACHE_CONTROL = '31536000'

export interface PhotoUploadOptions {
  contentType: PlantPhotoType
}

/** Lo que la app necesita del bucket. Todas rechazan con PhotoStorageError. */
export interface PhotoStorage {
  /**
   * Sube un objeto nuevo. Si la ruta ya existe (409), lo da por bueno: la
   * versión es aleatoria y nueva, así que solo puede ser un intento anterior
   * de esta misma subida cuya respuesta se perdió.
   */
  upload(path: string, blob: Blob, options: PhotoUploadOptions): Promise<void>
  /** Borra rutas; las que no existen se ignoran. */
  remove(paths: readonly string[]): Promise<void>
  /** Nombres completos (con la carpeta) de los objetos bajo una carpeta. */
  list(folder: string): Promise<string[]>
  /** Descarga autenticada de un objeto. */
  download(path: string, options?: { signal?: AbortSignal }): Promise<Blob>
}

interface SupabasePhotoStorageOptions {
  getClient?: () => Promise<OrkiSupabaseClient>
}

const LIST_PAGE = 100

/** Implementación con storage-js y el cliente compartido de la app. */
export function createSupabasePhotoStorage({
  getClient = getSupabase,
}: SupabasePhotoStorageOptions = {}): PhotoStorage {
  async function bucket() {
    let client: OrkiSupabaseClient
    try {
      client = await getClient()
    } catch (error) {
      // El chunk del cliente de Supabase no llegó o la app no se inicializó.
      throw new PhotoStorageError(
        navigator.onLine === false ? 'offline' : 'failed',
        { cause: error },
      )
    }
    return client.storage.from(PLANT_PHOTOS_BUCKET)
  }

  return {
    async upload(path, blob, { contentType }) {
      const files = await bucket()
      // El type del Blob es el que ve Storage (ver arriba).
      const body =
        blob.type === contentType
          ? blob
          : new Blob([blob], { type: contentType })
      const { error } = await files.upload(path, body, {
        contentType,
        cacheControl: PHOTO_CACHE_CONTROL,
        upsert: false,
      })
      if (!error) return
      if (isDuplicate(error)) return
      throw classifyStorageError(error)
    },

    async remove(paths) {
      if (paths.length === 0) return
      const files = await bucket()
      const { error } = await files.remove([...paths])
      if (error) throw classifyStorageError(error)
    },

    async list(folder) {
      const files = await bucket()
      const prefix = folder.endsWith('/') ? folder.slice(0, -1) : folder
      const names: string[] = []
      for (let offset = 0; ; offset += LIST_PAGE) {
        const { data, error } = await files.list(prefix, {
          limit: LIST_PAGE,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        })
        if (error) throw classifyStorageError(error)
        // Las "carpetas" llegan con id null; dentro de una planta no hay.
        for (const entry of data) {
          if (entry.id !== null) names.push(`${prefix}/${entry.name}`)
        }
        if (data.length < LIST_PAGE) return names
      }
    },

    async download(path, options = {}) {
      const files = await bucket()
      const { data, error } = await files.download(
        path,
        {},
        options.signal ? { signal: options.signal } : undefined,
      )
      if (error) throw classifyStorageError(error)
      return data
    },
  }
}

let shared: PhotoStorage | undefined

/** Bucket de la app con el cliente compartido (se crea al pedirlo). */
export function appPhotoStorage(): PhotoStorage {
  shared ??= createSupabasePhotoStorage()
  return shared
}
