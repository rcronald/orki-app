import { useEffect, useId, useRef, useState } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { Button } from '../components/ui/Button.tsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { Panel } from '../components/ui/Panel.tsx'
import { useLeaveGuard } from '../editing/useLeaveGuard.tsx'
import type {
  NewPlantPhoto,
  PlantPhotosProgress,
  UploadPlantPhotosResult,
} from '../photos/gallery.ts'
import { MAX_PLANT_PHOTOS, plantPhotoPaths } from '../photos/paths.ts'
import type { StoredPlantPhoto } from '../photos/photo-rows.ts'
import { PhotoStorageError, photoStorageErrorFrom } from '../photos/storage.ts'
import { adoptPhotoVersion } from '../photos/upload.ts'
import { useObjectUrls } from '../photos/useObjectUrls.ts'
import { canRetryUpload } from '../photos/usePhotoUpload.ts'
import { appDraftPhotoBackend, type DraftPhotoBackend } from './draft-photo.ts'
import {
  clearPendingUpload,
  planPendingUpload,
  readPendingUpload,
  writePendingUpload,
  type PendingUpload,
  type PendingUploadPhoto,
} from './pending-upload.ts'
import { PENDING_UPLOAD_TEXT } from './texts.ts'

/** Dónde lee las fotos de la planta y dónde sube las pendientes. */
export interface PendingPlantPhotosServices {
  /** Las fotos que ya tiene la planta (sus filas, en orden). */
  listPhotos: () => Promise<StoredPlantPhoto[]>
  /** uploadPlantPhotos de la planta, con las fotos ya conocidas. */
  upload: (
    photos: readonly NewPlantPhoto[],
    options: {
      knownPhotos: readonly StoredPlantPhoto[]
      signal: AbortSignal
      onProgress: (progress: PlantPhotosProgress) => void
    },
  ) => Promise<UploadPlantPhotosResult>
}

export interface PendingPlantPhotosProps {
  plant: CollectionPlant
  /** Dueño de las fotos (id de Clerk); sin él no hay nada que ofrecer. */
  userId: string | null
  /** Se puede escribir en la base (con conexión y la sesión confirmada). */
  canUpload: boolean
  /** id del motivo por el que no se puede subir, si no se puede. */
  reasonId?: string
  services: PendingPlantPhotosServices
  /** Las fotos de la planta tras subir (para la galería) y la planta releída. */
  onUploaded: (result: UploadPlantPhotosResult) => void
  /** Dónde están las fotos pendientes; por defecto, IndexedDB. */
  backend?: DraftPhotoBackend
  /** Reloj, para las pruebas. */
  now?: () => Date
}

type Phase =
  | { status: 'idle' }
  | { status: 'uploading'; done: number; total: number }
  | { status: 'failed'; error: PhotoStorageError; count: number }

const deviceNow = () => new Date()

/**
 * «Fotos pendientes de subir» en la ficha de una planta (#284): las fotos
 * del registro que no llegaron a subirse (se salió a mitad, se recargó o se
 * perdió la conexión) y siguen en el dispositivo (pending-upload.ts). Se
 * suben a la planta, sin pasar de seis (si entre tanto ya tiene fotos, solo
 * las que caben; las demás siguen aquí), o se descartan. Sin fotos
 * pendientes no se pinta nada.
 *
 * Mientras se suben, salir pide confirmación (useLeaveGuard); si se sale
 * igual, lo que no llegó sigue pendiente. Al terminar, o al descartarlas, el
 * resultado se anuncia (role="status") y el foco va a ese mensaje, porque el
 * botón pulsado desaparece con la sección.
 */
export function PendingPlantPhotos({
  plant,
  userId,
  canUpload,
  reasonId,
  services,
  onUploaded,
  backend = appDraftPhotoBackend(),
  now = deviceNow,
}: PendingPlantPhotosProps) {
  const text = PENDING_UPLOAD_TEXT
  const plantId = plant.id
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const [result, setResult] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  // Cuántas fotos tiene ya la planta, si se sabe (para decir cuántas caben).
  const [storedCount, setStoredCount] = useState<number | null>(null)
  const resultRef = useRef<HTMLParagraphElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const descriptionId = useId()

  useEffect(() => {
    if (userId === null) return
    let active = true
    void readPendingUpload(backend, userId, { plantId, now: now() }).then(
      (found) => {
        if (active) setPending(found)
      },
    )
    return () => {
      active = false
    }
  }, [backend, userId, plantId, now])

  // Cuántas caben: se leen las fotos de la planta al saber que hay pendientes.
  const hasPending = pending !== null
  useEffect(() => {
    if (!hasPending || !canUpload) return
    let active = true
    services.listPhotos().then(
      (photos) => {
        if (active) setStoredCount(photos.length)
      },
      () => undefined,
    )
    return () => {
      active = false
    }
    // services cambia en cada pintado de la ficha; basta con leer una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending, canUpload, plantId])

  const uploading = phase.status === 'uploading'
  const guard = useLeaveGuard({
    dirty: uploading,
    text: {
      title: text.leaveTitle,
      description: <p>{text.leaveKept}</p>,
      confirm: text.leaveConfirm,
      stay: text.leaveStay,
    },
  })

  const failed = phase.status === 'failed'
  useEffect(() => {
    if (failed) alertRef.current?.focus()
  }, [failed])
  const finished = result !== null && pending === null
  useEffect(() => {
    if (finished) resultRef.current?.focus()
  }, [finished])

  const thumbnails = useObjectUrls(
    pending?.photos.map((item) => item.photo.thumbnail.blob) ?? [],
  )

  const store = (photos: PendingUploadPhoto[]) => {
    if (userId === null || pending === null) return
    void writePendingUpload(backend, userId, {
      ...pending,
      savedAt: now().getTime(),
      photos,
    })
  }

  const upload = async () => {
    if (userId === null || pending === null || uploading || !canUpload) return
    const run = new AbortController()
    controller.current = run
    setResult(null)
    setPhase({ status: 'uploading', done: 0, total: pending.photos.length })
    let remaining = [...pending.photos]
    try {
      const known = await services.listPhotos()
      setStoredCount(known.length)
      const pathOf = (item: PendingUploadPhoto) =>
        plantPhotoPaths({
          userId,
          plantId,
          version: item.version,
          photoType: item.photo.photo.type,
          thumbnailType: item.photo.thumbnail.type,
        }).photoPath
      const plan = planPendingUpload(
        remaining,
        known.map((photo) => photo.photoPath),
        pathOf,
      )
      // Las que un intento anterior ya dejó guardadas no se suben otra vez.
      remaining = remaining.filter((item) => !plan.stored.includes(item))
      if (plan.upload.length === 0) {
        store(remaining)
        setPending(
          remaining.length > 0 ? { ...pending, photos: remaining } : null,
        )
        if (remaining.length === 0) setResult(text.uploaded(plan.stored.length))
        setPhase({ status: 'idle' })
        return
      }
      for (const item of plan.upload)
        adoptPhotoVersion(item.photo, item.version)
      setPhase({ status: 'uploading', done: 0, total: plan.upload.length })
      let done = 0
      const outcome = await services.upload(
        plan.upload.map((item) => ({
          files: item.photo,
          inBloom: item.inBloom,
        })),
        {
          knownPhotos: known,
          signal: run.signal,
          onProgress: (progress) => {
            if (progress.step !== 'done') return
            if (progress.result.status === 'uploaded') {
              const item = plan.upload[progress.index]
              remaining = remaining.filter((other) => other !== item)
              store(remaining)
              done += 1
              setPhase({
                status: 'uploading',
                done,
                total: plan.upload.length,
              })
            }
          },
        },
      )
      onUploaded(outcome)
      if (controller.current !== run) return
      setStoredCount(outcome.photos.length)
      controller.current = null
      setPending(
        remaining.length > 0 ? { ...pending, photos: remaining } : null,
      )
      const failures = outcome.results.filter(
        (item) => item.status !== 'uploaded',
      )
      if (failures.length === 0) {
        setPhase({ status: 'idle' })
        setResult(
          remaining.length === 0
            ? text.uploaded(plan.upload.length + plan.stored.length)
            : text.uploadedSome(plan.upload.length),
        )
        return
      }
      const first = failures[0]
      setPhase({
        status: 'failed',
        count: failures.length,
        error:
          first.status === 'failed'
            ? first.error
            : new PhotoStorageError('aborted'),
      })
    } catch (error) {
      if (controller.current !== run) return
      controller.current = null
      setPending(
        remaining.length > 0 ? { ...pending, photos: remaining } : null,
      )
      setPhase({
        status: 'failed',
        count: remaining.length,
        error: photoStorageErrorFrom(error),
      })
    }
  }

  const discard = () => {
    setConfirming(false)
    if (userId !== null) void clearPendingUpload(backend, userId, plantId)
    setPending(null)
    setPhase({ status: 'idle' })
    setResult(text.discarded)
  }

  const status = result !== null && (
    <p
      ref={resultRef}
      tabIndex={-1}
      className="text-md text-neutral-900 focus-visible:outline-none"
    >
      {result}
    </p>
  )
  if (pending === null) {
    // Región siempre presente: así se anuncia lo que se subió o descartó.
    // Vacía, no deja hueco entre los avisos de la ficha.
    return (
      <div role="status" className="empty:-mb-space-5">
        {status}
      </div>
    )
  }

  const count = pending.photos.length
  const known = storedCount ?? 0
  const room = Math.max(0, MAX_PLANT_PHOTOS - known)
  const full = storedCount !== null && room === 0
  const roomText = full
    ? text.noRoom(MAX_PLANT_PHOTOS)
    : storedCount !== null && room < count
      ? text.someRoom(room, count, MAX_PLANT_PHOTOS)
      : null
  const uploadBlocked = !canUpload || uploading || full
  const uploadDescribedBy =
    [!canUpload ? reasonId : undefined, full ? descriptionId : undefined]
      .filter(Boolean)
      .join(' ') || undefined
  const canRetry =
    phase.status === 'failed' && canRetryUpload(phase.error.reason)

  return (
    <Panel title={text.title}>
      {guard.dialog}
      <p className="orki-panel__text">{text.description(count)}</p>
      <ul aria-label={text.listLabel} className="flex flex-wrap gap-space-2">
        {pending.photos.map((item, index) => {
          const src = thumbnails.get(item.photo.thumbnail.blob)
          return (
            <li key={item.version} className="size-[64px] flex-none">
              {src ? (
                <img
                  src={src}
                  alt={text.photoLabel(index, count)}
                  width={64}
                  height={64}
                  className="size-[64px] rounded-md object-cover"
                />
              ) : (
                <span
                  role="img"
                  aria-label={text.photoLabel(index, count)}
                  className="block size-[64px] rounded-md bg-neutral-50"
                />
              )}
            </li>
          )
        })}
      </ul>
      {roomText !== null && (
        <p id={descriptionId} className="orki-panel__text">
          {roomText}
        </p>
      )}
      {/* Vacía, no deja hueco entre las piezas del panel. */}
      <div role="status" className="empty:-mt-space-4">
        {uploading && (
          <p className="text-sm text-neutral-900">
            {text.uploading(phase.done, phase.total)}
          </p>
        )}
        {status}
      </div>
      {phase.status === 'failed' && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="flex flex-col gap-space-2 rounded-lg bg-danger-soft p-space-4 text-sm text-neutral-900 focus-visible:outline-none"
        >
          <p className="flex items-start gap-space-2 font-semibold">
            <Icon
              name="triangle-alert"
              className="mt-[2px] size-[16px] flex-none text-danger"
            />
            {phase.error.reason === 'aborted'
              ? text.cancelled
              : text.failed(phase.count)}
          </p>
          {phase.error.reason !== 'aborted' && <p>{phase.error.message}</p>}
          {canRetry && <p>{text.retryHint}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-space-3">
        <Button
          variant="primary"
          aria-disabled={uploadBlocked || undefined}
          aria-describedby={uploadDescribedBy}
          onClick={() => void upload()}
        >
          {uploading
            ? text.uploadingButton
            : count === 1
              ? text.uploadOne
              : text.upload}
        </Button>
        {uploading ? (
          <Button onClick={() => controller.current?.abort()}>
            {text.uploadCancel}
          </Button>
        ) : (
          <Button onClick={() => setConfirming(true)}>
            {count === 1 ? text.discardOne : text.discard}
          </Button>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          title={text.discardTitle}
          description={text.discardDescription}
          confirmLabel={count === 1 ? text.discardOne : text.discard}
          confirmVariant="danger"
          cancelLabel={text.discardKeep}
          initialFocus="cancel"
          onConfirm={discard}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Panel>
  )
}
