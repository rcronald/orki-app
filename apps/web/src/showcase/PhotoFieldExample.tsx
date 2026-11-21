import { useState } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { createMemoryPhotoStorage } from '../photos/memory-storage.ts'
import type { PlantPhotoPaths } from '../photos/paths.ts'
import { PhotoField, type PhotoFieldValue } from '../photos/PhotoField.tsx'
import { PhotoStorageError } from '../photos/storage.ts'
import { uploadPhotoFiles } from '../photos/upload.ts'
import { usePhotoUpload } from '../photos/usePhotoUpload.ts'
import fotoMuestra from './foto-muestra.svg'
import { Example } from './layout.tsx'

// Campo de foto (#82) con la subida simulada: /muestra no tiene sesión de
// Clerk, así que sube a un bucket en memoria (memory-storage.ts) que tarda un
// poco y puede fallar a voluntad, con las rutas reales de la convención.

const USER_ID = 'user_muestra'
const PLANT_ID = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'

type Camera = 'auto' | 'show' | 'hide'
type Failure = 'none' | 'offline' | 'thumbnail' | 'too-large'

const CAMERA_TEXT: Record<Camera, string> = {
  auto: 'Según el dispositivo',
  show: 'Con cámara',
  hide: 'Sin cámara',
}

const FAILURE_TEXT: Record<Failure, string> = {
  none: 'Ninguno',
  offline: 'Sin conexión',
  thumbnail: 'Falla la miniatura',
  'too-large': 'Archivo rechazado por tamaño',
}

const storage = createMemoryPhotoStorage(700)

export function PhotoFieldExample() {
  const [value, setValue] = useState<PhotoFieldValue | null>(null)
  const [camera, setCamera] = useState<Camera>('auto')
  const [failure, setFailure] = useState<Failure>('none')
  const upload = usePhotoUpload<PlantPhotoPaths>()
  const [, refresh] = useState(0)

  // El fallo elegido se aplica al bucket simulado justo antes de cada subida.
  function applyFailure() {
    storage.failUploads =
      failure === 'none'
        ? undefined
        : (path) => {
            if (failure === 'offline') {
              return new PhotoStorageError('offline', { uncertain: true })
            }
            if (failure === 'too-large') {
              return new PhotoStorageError('too-large')
            }
            return path.includes('/thumb-')
              ? new PhotoStorageError('failed')
              : null
          }
  }

  async function retry() {
    applyFailure()
    await upload.retry()
    refresh((count) => count + 1)
  }

  function onChange(next: PhotoFieldValue | null) {
    upload.reset()
    setValue(next)
  }

  async function save() {
    if (value?.kind !== 'new') return
    const files = value.photo
    applyFailure()
    await upload.start(({ signal, onProgress }) =>
      uploadPhotoFiles(files, {
        userId: USER_ID,
        plantId: PLANT_ID,
        storage,
        signal,
        onProgress,
      }),
    )
    refresh((count) => count + 1)
  }

  const objects = [...storage.objects.keys()].sort()

  return (
    <Example
      title="Campo de foto"
      description="Tomar o elegir, vista previa, reemplazar y quitar. La subida va a un bucket simulado en memoria (sin sesión ni Supabase), con las rutas de la convención; se puede simular un fallo para ver el reintento sin volver a elegir la foto."
    >
      <div className="flex flex-col gap-space-2">
        <ChipGroup aria-label="Botón de cámara">
          {(Object.keys(CAMERA_TEXT) as Camera[]).map((option) => (
            <Chip
              key={option}
              selected={camera === option}
              onClick={() => setCamera(option)}
            >
              {CAMERA_TEXT[option]}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup aria-label="Fallo simulado al subir">
          {(Object.keys(FAILURE_TEXT) as Failure[]).map((option) => (
            <Chip
              key={option}
              selected={failure === option}
              onClick={() => setFailure(option)}
            >
              {FAILURE_TEXT[option]}
            </Chip>
          ))}
        </ChipGroup>
      </div>

      <PhotoField
        value={value}
        onChange={onChange}
        camera={camera}
        description="Opcional. Se prepara en este dispositivo: menos de 300 KB, sin ubicación."
        upload={upload.state}
        onRetryUpload={() => void retry()}
        onCancelUpload={upload.cancel}
      />

      <div className="flex flex-wrap gap-space-2">
        <Button
          variant="primary"
          aria-disabled={value?.kind !== 'new' || undefined}
          onClick={() => void save()}
        >
          Subir foto
        </Button>
        <Button
          onClick={() => {
            upload.reset()
            setValue({ kind: 'stored', src: fotoMuestra })
          }}
        >
          Mostrar una foto ya subida
        </Button>
      </div>

      <div className="flex flex-col gap-space-1 text-sm text-neutral-900">
        <p className="font-semibold text-secondary">
          Objetos en el bucket simulado
        </p>
        {objects.length === 0 ? (
          <p>Ninguno.</p>
        ) : (
          <ul className="flex flex-col gap-space-1 break-all">
            {objects.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Example>
  )
}
