import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { loadPhotoProcessing } from '../photos/load.ts'
import { MAX_PLANT_PHOTOS } from '../photos/paths.ts'
import type { StoredPlantPhoto } from '../photos/photo-rows.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import type { PhotoStorageError } from '../photos/storage.ts'

// Fotos de la galería del registro y la edición (#221), en su orden: la
// primera es la principal. Cada foto elegida se prepara como siempre
// (processPhoto: reducción, sin metadatos y miniatura), de una en una, con su
// hueco ya reservado mientras tanto, así el máximo cuenta también las que se
// están preparando. Al editar, la lista empieza con las ya guardadas.

/** Cómo va la subida de una foto nueva, después de guardar la planta. */
export type EntryUpload =
  | { status: 'idle' }
  | { status: 'uploading'; progress?: number }
  | { status: 'saved' }
  | { status: 'error'; error: PhotoStorageError }

export type PhotoEntry =
  /** Elegida, preparándose. */
  | { key: string; kind: 'preparing'; fileName: string }
  /** Preparada (también la recuperada del borrador), pendiente de subir. */
  | {
      key: string
      kind: 'new'
      fileName: string
      photo: ProcessedPhoto
      upload: EntryUpload
    }
  /** Ya guardada (al editar). */
  | { key: string; kind: 'stored'; stored: StoredPlantPhoto }

export type NewPhotoEntry = Extract<PhotoEntry, { kind: 'new' }>

/** Cuántas de `selected` caben con `current` ya en la galería. */
export function fitSelection(
  selected: number,
  current: number,
  max = MAX_PLANT_PHOTOS,
): { accepted: number; leftOut: number } {
  const accepted = Math.max(0, Math.min(selected, max - current))
  return { accepted, leftOut: selected - accepted }
}

let counter = 0
function newKey(): string {
  counter += 1
  return `foto-${String(counter)}`
}

export function newPhotoEntry(
  fileName: string,
  photo: ProcessedPhoto,
): NewPhotoEntry {
  return {
    key: newKey(),
    kind: 'new',
    fileName,
    photo,
    upload: { status: 'idle' },
  }
}

export function storedPhotoEntry(stored: StoredPlantPhoto): PhotoEntry {
  return { key: `guardada-${stored.id}`, kind: 'stored', stored }
}

export interface PhotoEntriesEvents {
  /** Se eligieron fotos: cuántas entraron y cuántas quedaron fuera. */
  onSelected?: (accepted: number, leftOut: number) => void
  /** Una foto quedó preparada (`count`: las que hay ahora). */
  onPrepared?: (count: number) => void
  /** No se pudo preparar una foto (ya se quitó de la lista). */
  onPrepareFailed?: (fileName: string, message: string) => void
}

export interface PhotoEntriesApi {
  entries: readonly PhotoEntry[]
  /** Sustituye la lista (borrador recuperado, fotos guardadas, descartar). */
  replace: (entries: readonly PhotoEntry[]) => void
  /** Cambia la lista a partir de la actual (estado de las subidas). */
  update: (change: (entries: readonly PhotoEntry[]) => PhotoEntry[]) => void
  /** Añade las que caben y las prepara de una en una. */
  add: (files: readonly File[]) => void
  /** Quita una foto (si se estaba preparando, deja de hacerlo). */
  remove: (key: string) => PhotoEntry | null
  /** Vuelve a poner una foto en `index` (deshacer al editar). */
  insert: (entry: PhotoEntry, index: number) => void
  /** La lista actual, también dentro de una tarea asíncrona. */
  current: () => readonly PhotoEntry[]
}

export function usePhotoEntries(
  events: PhotoEntriesEvents = {},
): PhotoEntriesApi {
  const [entries, setEntries] = useState<readonly PhotoEntry[]>([])
  const ref = useRef<readonly PhotoEntry[]>(entries)
  const eventsRef = useRef(events)
  useEffect(() => {
    eventsRef.current = events
  })
  // Las fotos se preparan de una en una, en el orden en que se eligieron.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const controller = useRef(new AbortController())
  useEffect(() => {
    const current = controller.current
    return () => current.abort()
  }, [])

  const commit = useCallback((next: readonly PhotoEntry[]) => {
    ref.current = next
    setEntries(next)
  }, [])

  const update = useCallback(
    (change: (entries: readonly PhotoEntry[]) => PhotoEntry[]) => {
      commit(change(ref.current))
    },
    [commit],
  )

  const prepare = useCallback(
    async (key: string, file: File) => {
      if (!ref.current.some((entry) => entry.key === key)) return
      const { signal } = controller.current
      let message: string
      try {
        const { processPhoto, PhotoProcessingError } =
          await loadPhotoProcessing()
        try {
          const photo = await processPhoto(file, { signal })
          if (!ref.current.some((entry) => entry.key === key)) return
          update((list) =>
            list.map((entry) =>
              entry.key === key
                ? {
                    key,
                    kind: 'new',
                    fileName: file.name,
                    photo,
                    upload: { status: 'idle' },
                  }
                : entry,
            ),
          )
          eventsRef.current.onPrepared?.(ref.current.length)
          return
        } catch (error) {
          if (signal.aborted) return
          message =
            error instanceof PhotoProcessingError
              ? error.message
              : 'Vuelve a intentarlo.'
        }
      } catch {
        message = 'No se pudo cargar el módulo de fotos. Revisa la conexión.'
      }
      if (!ref.current.some((entry) => entry.key === key)) return
      update((list) => list.filter((entry) => entry.key !== key))
      eventsRef.current.onPrepareFailed?.(file.name, message)
    },
    [update],
  )

  const add = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return
      const { accepted, leftOut } = fitSelection(
        files.length,
        ref.current.length,
      )
      const chosen = files.slice(0, accepted).map((file) => ({
        file,
        entry: {
          key: newKey(),
          kind: 'preparing',
          fileName: file.name,
        } as const,
      }))
      commit([...ref.current, ...chosen.map(({ entry }) => entry)])
      eventsRef.current.onSelected?.(accepted, leftOut)
      for (const { file, entry } of chosen) {
        queue.current = queue.current.then(() => prepare(entry.key, file))
      }
    },
    [commit, prepare],
  )

  const remove = useCallback(
    (key: string) => {
      const found = ref.current.find((entry) => entry.key === key) ?? null
      if (found) commit(ref.current.filter((entry) => entry.key !== key))
      return found
    },
    [commit],
  )

  const insert = useCallback(
    (entry: PhotoEntry, index: number) => {
      const next = [...ref.current]
      next.splice(Math.min(index, next.length), 0, entry)
      commit(next)
    },
    [commit],
  )

  const current = useCallback(() => ref.current, [])

  return { entries, replace: commit, update, add, remove, insert, current }
}

/** Los anuncios al elegir fotos, con los textos de cada pantalla. */
export interface PhotoSelectionText {
  photosLeftOut: (accepted: number, leftOut: number, max: number) => string
  photosAdding: (accepted: number) => string
  photoAdded: (count: number, max: number) => string
  photoPrepareFailed: (fileName: string, message: string) => string
}

export interface PhotoSelection {
  photos: PhotoEntriesApi
  /** Lo que se anuncia (role="status", solo para el lector). */
  photoStatus: string
  setPhotoStatus: Dispatch<SetStateAction<string>>
  /** A la vista: cuántas fotos quedaron fuera de la última selección. */
  leftOutNotice: string | null
  setLeftOutNotice: Dispatch<SetStateAction<string | null>>
  /** Las fotos que no se pudieron preparar, con su motivo. */
  prepareErrors: string[]
  setPrepareErrors: Dispatch<SetStateAction<string[]>>
}

/**
 * Las fotos de la galería (usePhotoEntries) con lo que el registro y la
 * edición dicen al elegirlas: el anuncio para el lector, el aviso de las que
 * quedaron fuera y los errores al prepararlas.
 */
export function usePhotoSelection(text: PhotoSelectionText): PhotoSelection {
  const [photoStatus, setPhotoStatus] = useState('')
  const [leftOutNotice, setLeftOutNotice] = useState<string | null>(null)
  const [prepareErrors, setPrepareErrors] = useState<string[]>([])
  const photos = usePhotoEntries({
    onSelected: (accepted, leftOut) => {
      const notice =
        leftOut > 0
          ? text.photosLeftOut(accepted, leftOut, MAX_PLANT_PHOTOS)
          : null
      setLeftOutNotice(notice)
      setPhotoStatus(notice ?? text.photosAdding(accepted))
    },
    onPrepared: (count) =>
      setPhotoStatus(text.photoAdded(count, MAX_PLANT_PHOTOS)),
    onPrepareFailed: (fileName, message) =>
      setPrepareErrors((list) => [
        ...list,
        text.photoPrepareFailed(fileName, message),
      ]),
  })
  return {
    photos,
    photoStatus,
    setPhotoStatus,
    leftOutNotice,
    setLeftOutNotice,
    prepareErrors,
    setPrepareErrors,
  }
}
