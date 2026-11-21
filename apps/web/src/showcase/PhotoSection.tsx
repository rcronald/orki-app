import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import { Button } from '../components/ui/Button.tsx'
import type { MetadataKind } from '../photos/metadata.ts'
import { loadPhotoProcessing } from '../photos/load.ts'
import type { EncodedImage, ProcessedPhoto } from '../photos/process.ts'
import { Example, Section } from './layout.tsx'

// Banco de pruebas del procesamiento de fotos (#81) para probarlo a mano en
// un navegador real, también en iPhone y Android (#84): eliges una foto y se
// ve qué sale (formato, tamaño, peso, calidad, tiempo y metadatos que
// quedan). El módulo se carga al elegir la primera foto, como en la app.

const KIND_TEXT: Record<MetadataKind, string> = {
  exif: 'EXIF',
  xmp: 'XMP',
  iptc: 'IPTC',
  mpf: 'MPF (imágenes adicionales)',
  comment: 'comentario',
  'app-other': 'otro segmento APP',
  icc: 'perfil de color ICC',
}

const ORIENTATION_TEXT: Record<ProcessedPhoto['orientationAppliedBy'], string> =
  {
    browser: 'la aplicó el navegador',
    module: 'la aplicó el módulo (el navegador no orienta)',
    none: 'no hacía falta',
  }

function formatBytes(bytes: number): string {
  return `${(bytes / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} KB`
}

function formatKinds(kinds: MetadataKind[]): string {
  if (kinds.length === 0) return 'ninguno'
  return [...new Set(kinds)].map((kind) => KIND_TEXT[kind]).join(', ')
}

interface ImageReport {
  image: EncodedImage
  url: string
  metadata: MetadataKind[]
}

type State =
  | { status: 'idle' }
  | { status: 'working'; name: string }
  | { status: 'error'; message: string }
  | {
      status: 'done'
      result: ProcessedPhoto
      photo: ImageReport
      thumbnail: ImageReport
      originalMetadata: MetadataKind[]
      webp: boolean
    }

async function metadataKinds(blob: Blob): Promise<MetadataKind[]> {
  const { findMetadata } = await import('../photos/metadata.ts')
  const report = findMetadata(new Uint8Array(await blob.arrayBuffer()))
  return report.findings.map((finding) => finding.kind)
}

export function PhotoSection() {
  const inputId = useId()
  const [state, setState] = useState<State>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)

  // Libera las vistas previas al cambiar de resultado o al salir.
  useEffect(() => {
    if (state.status !== 'done') return
    const urls = [state.photo.url, state.thumbnail.url]
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [state])

  useEffect(() => () => controller.current?.abort(), [])

  async function process(file: File) {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setState({ status: 'working', name: file.name })
    try {
      const { processPhoto, PhotoProcessingError, encodesWebp } =
        await loadPhotoProcessing()
      try {
        const result = await processPhoto(file, { signal: current.signal })
        const [photoKinds, thumbnailKinds, originalKinds, webp] =
          await Promise.all([
            metadataKinds(result.photo.blob),
            metadataKinds(result.thumbnail.blob),
            metadataKinds(file),
            encodesWebp(),
          ])
        if (current.signal.aborted) return
        setState({
          status: 'done',
          result,
          photo: {
            image: result.photo,
            url: URL.createObjectURL(result.photo.blob),
            metadata: photoKinds,
          },
          thumbnail: {
            image: result.thumbnail,
            url: URL.createObjectURL(result.thumbnail.blob),
            metadata: thumbnailKinds,
          },
          originalMetadata: originalKinds,
          webp,
        })
      } catch (error) {
        if (controller.current !== current) return
        setState({
          status: 'error',
          message:
            error instanceof PhotoProcessingError
              ? `${error.message} (motivo: ${error.reason})`
              : 'Fallo inesperado.',
        })
      }
    } catch {
      setState({
        status: 'error',
        message: 'No se pudo cargar el módulo de fotos. ¿Hay conexión?',
      })
    }
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Vaciar el campo permite volver a elegir la misma foto.
    event.target.value = ''
    if (file) void process(file)
  }

  return (
    <Section
      id="fotos"
      title="Fotos"
      description="Procesamiento de fotos en el navegador (src/photos/): compresión, miniatura, orientación y retirada de metadatos. Elige una foto de la galería o haz una con la cámara para ver el resultado real en este dispositivo."
    >
      <Example
        title="Preparar una foto"
        description="Topes: foto de 1600 px y menos de 300 KB; miniatura de 400 px y menos de 30 KB."
      >
        <div className="flex flex-col gap-space-2">
          <label
            htmlFor={inputId}
            className="text-sm font-semibold text-neutral-900"
          >
            Foto
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/*"
            onChange={onChange}
            className="text-sm text-neutral-900"
          />
        </div>
        <div role="status" className="text-sm text-neutral-700">
          {state.status === 'working' && `Preparando ${state.name}…`}
          {state.status === 'done' &&
            `Lista en ${state.result.durationMs.toLocaleString('es')} ms.`}
        </div>
        {state.status === 'working' && (
          <div>
            <Button
              onClick={() => {
                controller.current?.abort()
                setState({
                  status: 'error',
                  message: 'Se canceló la preparación de la foto.',
                })
              }}
            >
              Cancelar
            </Button>
          </div>
        )}
        {state.status === 'error' && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}
        {state.status === 'done' && <PhotoReport state={state} />}
      </Example>
    </Section>
  )
}

function PhotoReport({ state }: { state: Extract<State, { status: 'done' }> }) {
  const { result } = state
  const { source } = result
  return (
    <div className="flex flex-col gap-space-4">
      <dl className="grid grid-cols-1 gap-space-2 text-sm text-neutral-900 md:grid-cols-2">
        <Item term="Original">
          {source.width} × {source.height} px, {formatBytes(source.bytes)},{' '}
          {source.format} (declarado: {source.declaredType || 'sin tipo'})
        </Item>
        <Item term="Metadatos del original">
          {formatKinds(state.originalMetadata)}
        </Item>
        <Item term="Orientación EXIF">
          {source.orientation}: {ORIENTATION_TEXT[result.orientationAppliedBy]}
        </Item>
        <Item term="Codifica WebP este navegador">
          {state.webp ? 'sí' : 'no (se usa JPEG)'}
        </Item>
        <Item term="Tiempo total">
          {result.durationMs.toLocaleString('es')} ms
        </Item>
      </dl>
      <div className="grid grid-cols-1 gap-space-4 md:grid-cols-2">
        <ImageResult title="Foto" report={state.photo} />
        <ImageResult title="Miniatura" report={state.thumbnail} />
      </div>
    </div>
  )
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-secondary">{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function ImageResult({
  title,
  report,
}: {
  title: string
  report: ImageReport
}) {
  const { image } = report
  const attempts = image.attempts
    .map((attempt) => `${attempt.width}px q${attempt.quality}`)
    .join(' → ')
  return (
    <figure className="flex flex-col gap-space-2">
      <img
        src={report.url}
        alt={`${title} preparada`}
        className="w-full max-w-xs self-start rounded-md"
      />
      <figcaption>
        <dl className="flex flex-col gap-space-1 text-sm text-neutral-900">
          <Item term={title}>
            {image.type}, {image.width} × {image.height} px,{' '}
            {formatBytes(image.bytes)}, calidad {image.quality}
            {image.withinBudget ? '' : ' (no llegó al tope)'}
          </Item>
          <Item term="Intentos">{attempts}</Item>
          <Item term="Metadatos que quedan">
            {formatKinds(report.metadata)}
          </Item>
        </dl>
      </figcaption>
    </figure>
  )
}
