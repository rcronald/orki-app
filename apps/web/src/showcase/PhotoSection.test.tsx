import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoProcessingError } from '../photos/errors.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import { fixture } from '../test/photo-fixtures.ts'
import { PhotoSection } from './PhotoSection.tsx'

// jsdom no tiene canvas: el procesamiento se sustituye por uno fijo. La
// sección se prueba de verdad en un navegador (ver README, "Fotos").

const processPhoto = vi.fn<(file: Blob) => Promise<ProcessedPhoto>>()

vi.mock('../photos/load.ts', () => ({
  loadPhotoProcessing: () =>
    Promise.resolve({
      processPhoto,
      PhotoProcessingError,
      encodesWebp: () => Promise.resolve(true),
    }),
}))

const webp = () =>
  new Blob([fixture('sin-metadatos.webp')], { type: 'image/webp' })

const RESULT: ProcessedPhoto = {
  photo: {
    blob: webp(),
    type: 'image/webp',
    width: 1200,
    height: 1600,
    bytes: 182_400,
    quality: 0.8,
    withinBudget: true,
    attempts: [{ width: 1200, height: 1600, quality: 0.8, bytes: 182_400 }],
  },
  thumbnail: {
    blob: webp(),
    type: 'image/webp',
    width: 300,
    height: 400,
    bytes: 18_200,
    quality: 0.75,
    withinBudget: true,
    attempts: [{ width: 300, height: 400, quality: 0.75, bytes: 18_200 }],
  },
  source: {
    bytes: 3_100_000,
    declaredType: 'image/jpeg',
    format: 'jpeg',
    width: 3024,
    height: 4032,
    orientation: 6,
  },
  orientationAppliedBy: 'browser',
  durationMs: 420,
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:prueba')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  processPhoto.mockReset()
})

const cameraFile = () =>
  new File([fixture('exif-gps-orientacion-6.jpg')], 'IMG_0001.jpg', {
    type: 'image/jpeg',
  })

describe('PhotoSection', () => {
  it('muestra el resultado y los metadatos que quedan', async () => {
    processPhoto.mockResolvedValue(RESULT)
    render(<PhotoSection />)

    await userEvent.upload(screen.getByLabelText('Foto'), cameraFile())

    expect(await screen.findByText('Lista en 420 ms.')).toBeInTheDocument()
    expect(
      screen.getByText(/image\/webp, 1200 × 1600 px, 182,4 KB, calidad 0.8/),
    ).toBeInTheDocument()
    expect(screen.getByText(/300 × 400 px, 18,2 KB/)).toBeInTheDocument()
    // El original trae EXIF, XMP y comentario; el resultado solo el ICC.
    expect(
      screen.getByText('EXIF, XMP, comentario, perfil de color ICC'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('perfil de color ICC')).toHaveLength(2)
    expect(screen.getByText('6: la aplicó el navegador')).toBeInTheDocument()
  })

  it('muestra el motivo si falla', async () => {
    processPhoto.mockRejectedValue(
      new PhotoProcessingError('unsupported-format', { format: 'heic' }),
    )
    render(<PhotoSection />)

    await userEvent.upload(screen.getByLabelText('Foto'), cameraFile())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no puede abrir fotos HEIC.*unsupported-format/,
    )
  })
})
