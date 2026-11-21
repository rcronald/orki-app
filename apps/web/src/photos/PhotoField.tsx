import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import sinFoto from '../assets/sin-foto.svg?inline'
import { Button } from '../components/ui/Button.tsx'
import { loadPhotoProcessing } from './load.ts'
import { useCoarsePointer } from './useCoarsePointer.ts'
import type { ProcessedPhoto } from './process.ts'
import { canRetryUpload, type PhotoUploadState } from './usePhotoUpload.ts'

// Campo de foto reutilizable (#82): tomar con la cámara o elegir de la
// galería, vista previa, reemplazar y quitar. Prepara la imagen con el módulo
// de procesamiento (carga diferida) y entrega la foto y la miniatura ya
// preparadas; no sube nada: el formulario decide cuándo (ver upload.ts y
// usePhotoUpload.ts) y, si quiere, le pasa el estado de la subida para
// mostrarlo aquí con "Reintentar" y "Cancelar".
//
// Cámara y galería (documentación consultada el 21 de noviembre de 2026:
// MDN "HTML attribute: capture", web.dev "Capturing an image from the user"
// e informes de Chrome en Android 14 y 15):
// - <input type="file" accept="image/*"> sin capture: en el iPhone (Safari y
//   la app instalada) abre un menú con "Fototeca", "Hacer foto" y "Elegir
//   archivo"; en Android, Chrome 14+ abre el selector de fotos del sistema,
//   que en muchas versiones ya no ofrece la cámara.
// - Con capture="environment": abre directamente la cámara trasera en iOS y
//   en Android. capture es una pista: los navegadores de escritorio la
//   ignoran y muestran el selector de archivos de siempre.
// Por eso hay dos botones en el celular (cámara con capture y galería sin
// él) y uno solo, "Elegir foto", donde el puntero principal no es táctil
// (escritorio, con cámara o sin ella): ahí los dos abrirían lo mismo.
//
// Los <input type="file"> están ocultos: los abren los botones con click().
// Van fuera del orden de tabulación y del árbol de accesibilidad; el nombre
// y el estado los dan los botones.

/** Valor del campo. */
export type PhotoFieldValue =
  /** Foto recién elegida y ya preparada, pendiente de subir. */
  | { kind: 'new'; photo: ProcessedPhoto; fileName: string }
  /** Foto ya subida (edición, #16): la dirección para mostrarla. */
  | { kind: 'stored'; src: string }

export interface PhotoFieldProps {
  /** null: sin foto. */
  value: PhotoFieldValue | null
  /** Foto nueva preparada, o null al quitarla. */
  onChange: (value: PhotoFieldValue | null) => void
  /** Leyenda del grupo; "Foto" por defecto. */
  label?: string
  /** Texto de ayuda bajo la leyenda. */
  description?: ReactNode
  /** Texto alternativo de la vista previa; por defecto según el valor. */
  previewAlt?: string
  /**
   * auto (por defecto): botón de cámara solo con puntero táctil. show y
   * hide lo fuerzan (pruebas, página de muestra).
   */
  camera?: 'auto' | 'show' | 'hide'
  /** Deshabilita elegir y quitar (por ejemplo, mientras se guarda el formulario). */
  disabled?: boolean
  /** Estado de la subida, si el formulario quiere mostrarlo aquí. */
  upload?: PhotoUploadState
  onRetryUpload?: () => void
  onCancelUpload?: () => void
}

type Work =
  | { status: 'idle' }
  | { status: 'processing'; fileName: string }
  | { status: 'error'; message: string }

/** URL de objeto de un Blob, revocada al cambiar o al desmontar. */
function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [entry, setEntry] = useState<{ blob: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la URL es un recurso externo que se crea y se revoca aquí.
    setEntry({ blob, url })
    return () => {
      URL.revokeObjectURL(url)
      setEntry((current) => (current?.url === url ? null : current))
    }
  }, [blob])
  return entry && entry.blob === blob ? entry.url : undefined
}

function formatKilobytes(bytes: number): string {
  return `${(bytes / 1000).toLocaleString('es', { maximumFractionDigits: 0 })} KB`
}

function uploadStatusText(upload: PhotoUploadState | undefined): string {
  if (!upload) return ''
  if (upload.status === 'uploading') {
    const progress = upload.progress
    return progress
      ? `Subiendo la foto… (${progress.filesDone} de ${progress.filesTotal} archivos)`
      : 'Subiendo la foto…'
  }
  if (upload.status === 'done') return 'Foto guardada.'
  return ''
}

export function PhotoField({
  value,
  onChange,
  label = 'Foto',
  description,
  previewAlt,
  camera = 'auto',
  disabled = false,
  upload,
  onRetryUpload,
  onCancelUpload,
}: PhotoFieldProps) {
  const descriptionId = useId()
  const [work, setWork] = useState<Work>({ status: 'idle' })
  const [announcement, setAnnouncement] = useState('')
  const controller = useRef<AbortController | null>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const firstButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const cancelUploadButton = useRef<HTMLButtonElement>(null)
  const coarse = useCoarsePointer()
  const showCamera = camera === 'show' || (camera === 'auto' && coarse)

  useEffect(() => () => controller.current?.abort(), [])

  // "Reintentar" y "Cancelar subida" desaparecen al cambiar el estado de la
  // subida: si el foco estaba en uno de ellos, vuelve al campo.
  const uploadStatus = upload?.status
  const previousUploadStatus = useRef(uploadStatus)
  useEffect(() => {
    if (previousUploadStatus.current === uploadStatus) return
    previousUploadStatus.current = uploadStatus
    const active = document.activeElement
    if (active === null || active === document.body) {
      ;(cancelUploadButton.current ?? firstButton.current)?.focus()
    }
  }, [uploadStatus])

  const previewUrl = useObjectUrl(
    value?.kind === 'new' ? value.photo.photo.blob : undefined,
  )
  const previewSrc = value?.kind === 'stored' ? value.src : previewUrl
  const hasPhoto = value !== null
  const processing = work.status === 'processing'
  const uploading = upload?.status === 'uploading'
  const locked = disabled || processing || uploading

  /** Si el foco se perdió (botón que desaparece), lo devuelve al primero. */
  function restoreFocus() {
    const active = document.activeElement
    if (
      active === null ||
      active === document.body ||
      active === cancelButton.current
    ) {
      firstButton.current?.focus()
    }
  }

  async function process(file: File) {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setWork({ status: 'processing', fileName: file.name })
    setAnnouncement('Preparando la foto…')
    let message: string
    try {
      const { processPhoto, PhotoProcessingError } = await loadPhotoProcessing()
      try {
        const photo = await processPhoto(file, { signal: current.signal })
        if (controller.current !== current) return
        controller.current = null
        setWork({ status: 'idle' })
        setAnnouncement(
          `Foto lista (${formatKilobytes(photo.photo.bytes)}). Se guardará con la planta.`,
        )
        onChange({ kind: 'new', photo, fileName: file.name })
        restoreFocus()
        return
      } catch (error) {
        if (controller.current !== current) return
        if (
          error instanceof PhotoProcessingError &&
          error.reason === 'aborted'
        ) {
          controller.current = null
          setWork({ status: 'idle' })
          setAnnouncement(error.message)
          restoreFocus()
          return
        }
        message =
          error instanceof PhotoProcessingError
            ? error.message
            : 'No se pudo preparar la foto. Vuelve a intentarlo.'
      }
    } catch {
      if (controller.current !== current) return
      message = 'No se pudo cargar el módulo de fotos. Revisa la conexión.'
    }
    controller.current = null
    setWork({ status: 'error', message })
    setAnnouncement('')
    restoreFocus()
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Vaciar el campo permite volver a elegir la misma foto.
    event.target.value = ''
    if (file) void process(file)
  }

  function open(input: HTMLInputElement | null) {
    if (locked) return
    input?.click()
  }

  function cancel() {
    controller.current?.abort()
    controller.current = null
    setWork({ status: 'idle' })
    setAnnouncement('Se canceló la preparación de la foto.')
    firstButton.current?.focus()
  }

  function remove() {
    if (locked) return
    setWork({ status: 'idle' })
    setAnnouncement('Foto quitada.')
    onChange(null)
    // El botón de quitar desaparece: el foco va al primero de elegir.
    firstButton.current?.focus()
  }

  const alt =
    previewAlt ??
    (value?.kind === 'stored'
      ? 'Foto actual de la planta'
      : 'Vista previa de la foto elegida')

  const cameraText = hasPhoto ? 'Tomar otra foto' : 'Tomar foto'
  const galleryText = showCamera
    ? hasPhoto
      ? 'Elegir otra de la galería'
      : 'Elegir de la galería'
    : hasPhoto
      ? 'Elegir otra foto'
      : 'Elegir foto'

  const statusText = processing
    ? announcement
    : uploadStatusText(upload) || announcement

  return (
    <fieldset
      className="flex min-w-[0] flex-col gap-space-3"
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={processing || uploading}
    >
      <legend className="text-sm font-semibold text-neutral-900">
        {label}
      </legend>
      {description && (
        <p id={descriptionId} className="text-sm text-neutral-700">
          {description}
        </p>
      )}

      <div className="w-full max-w-xs overflow-hidden rounded-md bg-neutral-50">
        {/* Caja de 4:3 fija: la vista previa no mueve nada al aparecer. */}
        <img
          className="block aspect-[4/3] w-full object-cover"
          src={hasPhoto && previewSrc ? previewSrc : sinFoto}
          alt={hasPhoto ? alt : ''}
          decoding="async"
        />
      </div>

      <div className="flex flex-wrap gap-space-2">
        {showCamera && (
          <Button
            ref={firstButton}
            icon="camera"
            aria-disabled={locked || undefined}
            onClick={() => open(cameraInput.current)}
          >
            {cameraText}
          </Button>
        )}
        <Button
          ref={showCamera ? undefined : firstButton}
          icon="image"
          aria-disabled={locked || undefined}
          onClick={() => open(galleryInput.current)}
        >
          {galleryText}
        </Button>
        {hasPhoto && !processing && (
          <Button
            icon="trash-2"
            aria-disabled={locked || undefined}
            onClick={remove}
          >
            Quitar foto
          </Button>
        )}
        {processing && (
          <Button ref={cancelButton} icon="x" onClick={cancel}>
            Cancelar
          </Button>
        )}
      </div>

      {showCamera && (
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFile}
        />
      )}
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFile}
      />

      <p role="status" className="text-sm text-neutral-700">
        {statusText}
      </p>
      {work.status === 'error' && (
        <p role="alert" className="text-sm text-danger">
          {work.message}
        </p>
      )}
      {upload?.status === 'error' && (
        <div role="alert" className="flex flex-col items-start gap-space-2">
          <p className="text-sm text-danger">{upload.error.message}</p>
          {onRetryUpload && canRetryUpload(upload.error.reason) && (
            <Button onClick={onRetryUpload}>Reintentar</Button>
          )}
        </div>
      )}
      {uploading && onCancelUpload && (
        <div>
          <Button ref={cancelUploadButton} icon="x" onClick={onCancelUpload}>
            Cancelar subida
          </Button>
        </div>
      )}
    </fieldset>
  )
}
