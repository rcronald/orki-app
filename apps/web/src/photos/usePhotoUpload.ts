import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PhotoStorageError,
  photoStorageErrorFrom,
  type PhotoStorageErrorReason,
} from './storage.ts'
import type { UploadProgress } from './upload.ts'

// Estado de una subida para la interfaz (#82): en curso con su progreso,
// hecha o fallida con su motivo, con cancelar y reintentar. No sabe qué se
// sube: recibe una tarea (por ejemplo, uploadPhotoFiles con la foto ya
// preparada) y la vuelve a lanzar tal cual al reintentar, así que no hay que
// elegir ni preparar la foto otra vez. Lo usa la sección «Fotos» de /muestra;
// el formulario con galería (#221) lleva el estado de cada foto él mismo.
//
//   const upload = usePhotoUpload<PlantPhotoPaths>()
//   upload.start(({ signal, onProgress }) =>
//     uploadPhotoFiles(files, { userId, plantId, signal, onProgress }))

export interface PhotoUploadContext {
  signal: AbortSignal
  onProgress: (progress: UploadProgress) => void
}

export type PhotoUploadTask<T> = (context: PhotoUploadContext) => Promise<T>

export type PhotoUploadState<T = unknown> =
  | { status: 'idle' }
  | { status: 'uploading'; progress: UploadProgress | null }
  | { status: 'done'; result: T }
  | { status: 'error'; error: PhotoStorageError }

export interface PhotoUploadApi<T> {
  state: PhotoUploadState<T>
  /** Lanza la tarea; cancela la anterior si seguía en curso. */
  start: (task: PhotoUploadTask<T>) => Promise<T | undefined>
  /** Vuelve a lanzar la última tarea. */
  retry: () => Promise<T | undefined>
  /** Cancela la subida en curso (queda en error con motivo "aborted"). */
  cancel: () => void
  /** Vuelve a "idle" (por ejemplo, al elegir otra foto). */
  reset: () => void
}

/** ¿Tiene sentido ofrecer "Reintentar" para este motivo? */
export function canRetryUpload(reason: PhotoStorageErrorReason): boolean {
  return (
    reason !== 'session-ended' &&
    reason !== 'not-found' &&
    reason !== 'too-many-photos'
  )
}

export function usePhotoUpload<T>(): PhotoUploadApi<T> {
  const [state, setState] = useState<PhotoUploadState<T>>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const lastTask = useRef<PhotoUploadTask<T> | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  const start = useCallback(async (task: PhotoUploadTask<T>) => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    lastTask.current = task
    setState({ status: 'uploading', progress: null })
    try {
      const result = await task({
        signal: current.signal,
        onProgress: (progress) => {
          if (controller.current === current) {
            setState({ status: 'uploading', progress })
          }
        },
      })
      if (controller.current !== current) return undefined
      controller.current = null
      setState({ status: 'done', result })
      return result
    } catch (error) {
      if (controller.current !== current) return undefined
      controller.current = null
      setState({ status: 'error', error: photoStorageErrorFrom(error) })
      return undefined
    }
  }, [])

  const retry = useCallback(async () => {
    const task = lastTask.current
    return task ? start(task) : undefined
  }, [start])

  const cancel = useCallback(() => {
    const current = controller.current
    if (!current) return
    controller.current = null
    current.abort()
    setState({ status: 'error', error: new PhotoStorageError('aborted') })
  }, [])

  const reset = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    lastTask.current = null
    setState({ status: 'idle' })
  }, [])

  return { state, start, retry, cancel, reset }
}
