import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe.ts'
import { PLANT_ID, processedPhoto, USER_ID } from '../test/photos.ts'
import { PhotoProcessingError } from './errors.ts'
import { createMemoryPhotoStorage } from './memory-storage.ts'
import type { PlantPhotoPaths } from './paths.ts'
import { PhotoField, type PhotoFieldValue } from './PhotoField.tsx'
import type { ProcessedPhoto } from './process.ts'
import { PhotoStorageError } from './storage.ts'
import { uploadPhotoFiles } from './upload.ts'
import { usePhotoUpload } from './usePhotoUpload.ts'

// jsdom no tiene canvas: el procesamiento es un doble.
const processPhoto =
  vi.fn<
    (file: Blob, options: { signal?: AbortSignal }) => Promise<ProcessedPhoto>
  >()

vi.mock('./load.ts', () => ({
  loadPhotoProcessing: () =>
    Promise.resolve({ processPhoto, PhotoProcessingError }),
}))

const createObjectURL = vi.fn((blob: Blob) => `blob:vista-${blob.size}`)
const revokeObjectURL = vi.fn()

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Foto · orqui.apps'
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

afterEach(() => {
  processPhoto.mockReset()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

const file = () =>
  new File([new Uint8Array(10)], 'IMG_0001.jpg', { type: 'image/jpeg' })

function hiddenInputs(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')]
}

/** Formulario mínimo: el campo controlado y su subida, como lo usará el #87. */
function Harness({
  initial = null,
  camera = 'hide',
  storage = createMemoryPhotoStorage(),
}: {
  initial?: PhotoFieldValue | null
  camera?: 'auto' | 'show' | 'hide'
  storage?: ReturnType<typeof createMemoryPhotoStorage>
}) {
  const [value, setValue] = useState(initial)
  const upload = usePhotoUpload<PlantPhotoPaths>()
  return (
    <>
      <PhotoField
        value={value}
        onChange={(next) => {
          upload.reset()
          setValue(next)
        }}
        camera={camera}
        upload={upload.state}
        onRetryUpload={() => void upload.retry()}
        onCancelUpload={upload.cancel}
      />
      <button
        type="button"
        onClick={() => {
          if (value?.kind !== 'new') return
          const files = value.photo
          void upload.start(({ signal, onProgress }) =>
            uploadPhotoFiles(files, {
              userId: USER_ID,
              plantId: PLANT_ID,
              storage,
              signal,
              onProgress,
            }),
          )
        }}
      >
        Guardar
      </button>
    </>
  )
}

describe('PhotoField', () => {
  it('sin cámara (escritorio): un solo botón que abre el selector de archivos', async () => {
    const { container } = render(<Harness camera="hide" />)
    expect(
      screen.queryByRole('button', { name: 'Tomar foto' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Elegir foto' })).toBeVisible()
    const inputs = hiddenInputs(container)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toHaveAttribute('accept', 'image/*')
    expect(inputs[0]).not.toHaveAttribute('capture')
    await expectNoAxeViolations()
  })

  it('con cámara: "Tomar foto" usa capture y la galería no', () => {
    const { container } = render(<Harness camera="show" />)
    const [cameraInput, galleryInput] = hiddenInputs(container)
    expect(cameraInput).toHaveAttribute('capture', 'environment')
    expect(galleryInput).not.toHaveAttribute('capture')
    const click = vi.spyOn(cameraInput, 'click')
    screen.getByRole('button', { name: 'Tomar foto' }).click()
    expect(click).toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Elegir de la galería' }),
    ).toBeVisible()
  })

  it('auto: sin puntero táctil (jsdom, escritorio) no ofrece la cámara', () => {
    render(<Harness camera="auto" />)
    expect(
      screen.queryByRole('button', { name: 'Tomar foto' }),
    ).not.toBeInTheDocument()
  })

  it('prepara la foto, anuncia los estados y muestra la vista previa', async () => {
    let finish: (photo: ProcessedPhoto) => void = () => {}
    processPhoto.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const { container } = render(<Harness />)
    await userEvent.upload(hiddenInputs(container)[0], file())

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Preparando la foto…',
    )
    expect(screen.getByRole('group', { name: 'Foto' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Elegir foto' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expectNoAxeViolations()

    const photo = processedPhoto()
    await act(async () => {
      finish(photo)
      await Promise.resolve()
    })

    expect(screen.getByRole('status')).toHaveTextContent('Foto lista (182 KB)')
    expect(
      screen.getByRole('img', { name: 'Vista previa de la foto elegida' }),
    ).toHaveAttribute('src', `blob:vista-${photo.photo.blob.size}`)
    expect(createObjectURL).toHaveBeenCalledWith(photo.photo.blob)
    expect(
      screen.getByRole('button', { name: 'Elegir otra foto' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Quitar foto' })).toBeVisible()
    await expectNoAxeViolations()
  })

  it.each([
    [
      new PhotoProcessingError('unsupported-format', { format: 'heic' }),
      /no puede abrir fotos HEIC/,
    ],
    [new PhotoProcessingError('not-an-image'), /no es una imagen/],
    [new PhotoProcessingError('too-large'), /demasiado grande/],
    [new Error('raro'), /No se pudo preparar la foto/],
  ])('muestra el motivo del error (%s)', async (error, text) => {
    processPhoto.mockRejectedValue(error)
    const { container } = render(<Harness />)
    await userEvent.upload(hiddenInputs(container)[0], file())
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    await expectNoAxeViolations()
  })

  it('avisa con onProcessingChange al empezar y al terminar de preparar', async () => {
    let finish: (photo: ProcessedPhoto) => void = () => {}
    processPhoto.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const onProcessingChange = vi.fn()
    const { container } = render(
      <PhotoField
        value={null}
        onChange={() => {}}
        camera="hide"
        onProcessingChange={onProcessingChange}
      />,
    )
    expect(onProcessingChange).toHaveBeenLastCalledWith(false)
    await userEvent.upload(hiddenInputs(container)[0], file())
    await waitFor(() =>
      expect(onProcessingChange).toHaveBeenLastCalledWith(true),
    )
    await act(async () => {
      finish(processedPhoto())
      await Promise.resolve()
    })
    expect(onProcessingChange).toHaveBeenLastCalledWith(false)
  })

  it('cancelar la preparación devuelve el foco a elegir', async () => {
    processPhoto.mockImplementation(
      (_file, { signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new PhotoProcessingError('aborted')),
          )
        }),
    )
    const { container } = render(<Harness />)
    await userEvent.upload(hiddenInputs(container)[0], file())
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancelar' }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Se canceló')
    expect(screen.getByRole('button', { name: 'Elegir foto' })).toHaveFocus()
    expect(processPhoto.mock.calls[0]?.[1].signal?.aborted).toBe(true)
  })

  it('quitar con el teclado mueve el foco y revoca la vista previa', async () => {
    processPhoto.mockResolvedValue(processedPhoto())
    const { container } = render(<Harness />)
    await userEvent.upload(hiddenInputs(container)[0], file())
    const remove = await screen.findByRole('button', { name: 'Quitar foto' })

    remove.focus()
    await userEvent.keyboard('{Enter}')

    expect(screen.getByRole('status')).toHaveTextContent('Foto quitada.')
    expect(screen.getByRole('button', { name: 'Elegir foto' })).toHaveFocus()
    expect(
      screen.queryByRole('button', { name: 'Quitar foto' }),
    ).not.toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:vista-182400')
    await expectNoAxeViolations()
  })

  it('reemplazar prepara la nueva y libera la anterior', async () => {
    const first = processedPhoto()
    const second = processedPhoto('image/jpeg')
    second.photo.blob = new Blob([new Uint8Array(99)], { type: 'image/jpeg' })
    processPhoto.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const { container } = render(<Harness />)
    await userEvent.upload(hiddenInputs(container)[0], file())
    await screen.findByRole('button', { name: 'Quitar foto' })

    await userEvent.upload(hiddenInputs(container)[0], file())
    await waitFor(() => {
      expect(
        screen.getByRole('img', { name: 'Vista previa de la foto elegida' }),
      ).toHaveAttribute('src', 'blob:vista-99')
    })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:vista-182400')
  })

  it('libera la vista previa al desmontar', async () => {
    processPhoto.mockResolvedValue(processedPhoto())
    const { container, unmount } = render(<Harness />)
    await userEvent.upload(hiddenInputs(container)[0], file())
    await screen.findByRole('button', { name: 'Quitar foto' })
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:vista-182400')
  })

  it('muestra una foto ya subida (edición) sin URL de objeto', async () => {
    render(<Harness initial={{ kind: 'stored', src: '/foto.webp' }} />)
    expect(
      screen.getByRole('img', { name: 'Foto actual de la planta' }),
    ).toHaveAttribute('src', '/foto.webp')
    expect(screen.getByRole('button', { name: 'Quitar foto' })).toBeVisible()
    expect(createObjectURL).not.toHaveBeenCalled()
    await expectNoAxeViolations()
  })

  it('un fallo de red al subir permite reintentar sin volver a preparar la foto', async () => {
    processPhoto.mockResolvedValue(processedPhoto())
    const storage = createMemoryPhotoStorage()
    storage.failUploads = () =>
      new PhotoStorageError('offline', { uncertain: true })
    const { container } = render(<Harness storage={storage} />)
    await userEvent.upload(hiddenInputs(container)[0], file())
    await screen.findByRole('button', { name: 'Quitar foto' })

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Sin conexión')
    await expectNoAxeViolations()

    storage.failUploads = undefined
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Foto guardada.')
    })
    expect(processPhoto).toHaveBeenCalledTimes(1)
    expect(storage.objects.size).toBe(2)
    await expectNoAxeViolations()
  })

  it('anuncia la subida en curso y deja cancelarla', async () => {
    processPhoto.mockResolvedValue(processedPhoto())
    const storage = createMemoryPhotoStorage()
    // Las subidas quedan pendientes hasta que la prueba las termina.
    const pending: (() => void)[] = []
    const upload = storage.upload.bind(storage)
    vi.spyOn(storage, 'upload').mockImplementation(
      (path, blob, options) =>
        new Promise<void>((resolve) => {
          pending.push(() => void upload(path, blob, options).then(resolve))
        }),
    )
    const remove = vi.spyOn(storage, 'remove')
    const { container } = render(<Harness storage={storage} />)
    await userEvent.upload(hiddenInputs(container)[0], file())
    await screen.findByRole('button', { name: 'Quitar foto' })

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('status')).toHaveTextContent('Subiendo la foto…')
    expect(screen.getByRole('button', { name: 'Quitar foto' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expectNoAxeViolations()

    await userEvent.click(
      screen.getByRole('button', { name: 'Cancelar subida' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Se canceló la subida',
    )
    // Las subidas terminan después de cancelar: lo subido se borra.
    act(() => pending.forEach((finish) => finish()))
    await waitFor(() => {
      expect(remove).toHaveBeenCalledTimes(1)
    })
    expect(storage.objects.size).toBe(0)
  })

  it('una sesión terminada no ofrece reintentar', async () => {
    processPhoto.mockResolvedValue(processedPhoto())
    const storage = createMemoryPhotoStorage()
    storage.failUploads = () => new PhotoStorageError('session-ended')
    const { container } = render(<Harness storage={storage} />)
    await userEvent.upload(hiddenInputs(container)[0], file())
    await screen.findByRole('button', { name: 'Quitar foto' })
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tu sesión terminó',
    )
    expect(
      screen.queryByRole('button', { name: 'Reintentar' }),
    ).not.toBeInTheDocument()
  })
})
