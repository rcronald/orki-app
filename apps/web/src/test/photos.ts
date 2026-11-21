import { vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import type { PlantPhotoPaths } from '../photos/paths.ts'
import type { PlantPhotoRecords } from '../photos/plant-record.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import { plant } from './collection.ts'

// Dobles de las fotos: una foto ya preparada y las escrituras de la planta.

export const USER_ID = 'user_prueba'
export const PLANT_ID = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'

/** Foto preparada como la devuelve processPhoto (los bytes no importan). */
export function processedPhoto(
  type: 'image/webp' | 'image/jpeg' = 'image/webp',
): ProcessedPhoto {
  const image = (bytes: number, width: number, height: number) => ({
    blob: new Blob([new Uint8Array(bytes)], { type }),
    type,
    width,
    height,
    bytes,
    quality: 0.8,
    withinBudget: true,
    attempts: [{ width, height, quality: 0.8, bytes }],
  })
  return {
    photo: image(182_400, 1200, 1600),
    thumbnail: image(18_200, 300, 400),
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
}

export interface FakeRecords extends PlantPhotoRecords {
  setPhotoPaths: ReturnType<
    typeof vi.fn<
      (
        plantId: string,
        userId: string,
        paths: PlantPhotoPaths | null,
      ) => Promise<CollectionPlant>
    >
  >
}

/** Escrituras de la planta que devuelven la planta con las rutas nuevas. */
export function fakeRecords(): FakeRecords {
  return {
    setPhotoPaths: vi.fn((plantId, _userId, paths) =>
      Promise.resolve(
        plant({
          id: plantId,
          photoPath: paths?.photoPath ?? null,
          thumbnailPath: paths?.thumbnailPath ?? null,
        }),
      ),
    ),
  }
}
