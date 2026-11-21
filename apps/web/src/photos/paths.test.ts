import { describe, expect, it } from 'vitest'
import {
  extensionFor,
  parsePhotoPath,
  plantFolder,
  plantPhotoPaths,
} from './paths.ts'

const USER = 'user_2abcDEF123'
const PLANT = '0F1C2A4E-8B3D-4E5F-9A7B-0C1D2E3F4A5B'
const plant = PLANT.toLowerCase()

describe('rutas de las fotos', () => {
  it('sigue la convención exacta, con el id de la planta en minúsculas', () => {
    expect(
      plantPhotoPaths({
        userId: USER,
        plantId: PLANT,
        version: 'v1',
        photoType: 'image/webp',
        thumbnailType: 'image/webp',
      }),
    ).toEqual({
      photoPath: `${USER}/${plant}/photo-v1.webp`,
      thumbnailPath: `${USER}/${plant}/thumb-v1.webp`,
    })
  })

  it('usa jpg para JPEG y la misma versión en las dos', () => {
    const paths = plantPhotoPaths({
      userId: USER,
      plantId: plant,
      version: '3f2b9c1e-0000-4000-8000-000000000000',
      photoType: 'image/jpeg',
      thumbnailType: 'image/jpeg',
    })
    expect(paths.photoPath).toBe(
      `${USER}/${plant}/photo-3f2b9c1e-0000-4000-8000-000000000000.jpg`,
    )
    expect(paths.thumbnailPath).toBe(
      `${USER}/${plant}/thumb-3f2b9c1e-0000-4000-8000-000000000000.jpg`,
    )
    expect(extensionFor('image/webp')).toBe('webp')
  })

  it('rechaza ids que romperían la carpeta del dueño', () => {
    expect(() => plantFolder('', plant)).toThrow()
    expect(() => plantFolder('a/b', plant)).toThrow()
    expect(() => plantFolder(USER, 'no-es-un-uuid')).toThrow()
    expect(() =>
      plantPhotoPaths({
        userId: USER,
        plantId: plant,
        version: '../x',
        photoType: 'image/webp',
        thumbnailType: 'image/webp',
      }),
    ).toThrow()
  })

  it('descompone una ruta válida y descarta las demás', () => {
    expect(parsePhotoPath(`${USER}/${plant}/thumb-v1.jpg`)).toEqual({
      userId: USER,
      plantId: plant,
      kind: 'thumb',
      version: 'v1',
      extension: 'jpg',
    })
    expect(parsePhotoPath(`${USER}/${plant}/foto.png`)).toBeNull()
    expect(parsePhotoPath(`${USER}/photo-v1.webp`)).toBeNull()
    expect(parsePhotoPath(`${USER}/${PLANT}/photo-v1.webp`)).toBeNull()
    expect(parsePhotoPath(`${USER}/${plant}/x/photo-v1.webp`)).toBeNull()
  })
})
