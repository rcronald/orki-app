import { describe, expect, it, vi } from 'vitest'
import {
  findOrphans,
  inBatches,
  parseCleanupArguments,
  runOrphanCleanup,
  type BucketObject,
  isLogPhotoPath,
  type GalleryPhotoRow,
  type LogPhotoRow,
  type PlantPhotoRow,
} from './orphans.ts'

const NOW = Date.parse('2026-11-21T12:00:00Z')
const HOUR = 3600 * 1000
const USER = 'user_a'
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

const old = '2026-11-19T12:00:00Z'
const fresh = '2026-11-21T11:30:00Z'

const objects: BucketObject[] = [
  { name: `${USER}/${P1}/photo-v2.webp`, createdAt: old },
  { name: `${USER}/${P1}/thumb-v2.webp`, createdAt: old },
  // Foto anterior que no se llegó a borrar al reemplazar.
  { name: `${USER}/${P1}/photo-v1.webp`, createdAt: old },
  // Subida en curso (la planta aún no apunta a ella).
  { name: `${USER}/${P2}/photo-v9.webp`, createdAt: fresh },
  { name: 'suelto.png', createdAt: old },
  { name: `${USER}/${P2}/thumb-sin-fecha.webp`, createdAt: null },
]

const plants: PlantPhotoRow[] = [
  {
    id: P1,
    user_id: USER,
    photo_path: `${USER}/${P1}/photo-v2.webp`,
    thumbnail_path: `${USER}/${P1}/thumb-v2.webp`,
  },
  {
    id: P2,
    user_id: USER,
    photo_path: `${USER}/${P2}/photo-v3.webp`,
    thumbnail_path: null,
  },
]

describe('findOrphans', () => {
  it('separa los huérfanos viejos, los recientes y las rutas que faltan', () => {
    const report = findOrphans({
      objects,
      plants,
      now: NOW,
      minAgeMs: 24 * HOUR,
    })
    expect(report.referenced).toBe(2)
    expect(report.orphans).toEqual([
      { name: 'suelto.png', createdAt: old, reason: 'fuera-de-convencion' },
      {
        name: `${USER}/${P1}/photo-v1.webp`,
        createdAt: old,
        reason: 'sin-planta',
      },
    ])
    expect(report.recent.map((orphan) => orphan.name)).toEqual([
      `${USER}/${P2}/photo-v9.webp`,
      `${USER}/${P2}/thumb-sin-fecha.webp`,
    ])
    expect(report.missing).toEqual([
      {
        plantId: P2,
        column: 'photo_path',
        path: `${USER}/${P2}/photo-v3.webp`,
      },
    ])
  })

  it('con antigüedad mínima de una hora, el reciente de hace 30 min sigue a salvo', () => {
    const report = findOrphans({ objects, plants, now: NOW, minAgeMs: HOUR })
    expect(report.recent.map((orphan) => orphan.name)).toContain(
      `${USER}/${P2}/photo-v9.webp`,
    )
  })
})

// Varias fotos por planta (#219): la principal está en plants y en
// plant_photos; las secundarias, solo en plant_photos.
const P3 = '33333333-3333-4333-8333-333333333333'
const galleryObjects: BucketObject[] = [
  { name: `${USER}/${P3}/photo-a.webp`, createdAt: old },
  { name: `${USER}/${P3}/thumb-a.webp`, createdAt: old },
  { name: `${USER}/${P3}/photo-b.webp`, createdAt: old },
  { name: `${USER}/${P3}/thumb-b.webp`, createdAt: old },
  { name: `${USER}/${P3}/photo-c.webp`, createdAt: old },
  { name: `${USER}/${P3}/thumb-c.webp`, createdAt: old },
  // Resto de una subida cuya fila no se llegó a crear.
  { name: `${USER}/${P3}/photo-z.webp`, createdAt: old },
  { name: `${USER}/${P3}/thumb-z.webp`, createdAt: old },
]
const galleryPlant: PlantPhotoRow = {
  id: P3,
  user_id: USER,
  photo_path: `${USER}/${P3}/photo-a.webp`,
  thumbnail_path: `${USER}/${P3}/thumb-a.webp`,
}
const galleryPhotos: GalleryPhotoRow[] = ['a', 'b', 'c', 'd'].map(
  (version) => ({
    id: `foto-${version}`,
    plant_id: P3,
    photo_path: `${USER}/${P3}/photo-${version}.webp`,
    thumbnail_path: `${USER}/${P3}/thumb-${version}.webp`,
  }),
)

describe('findOrphans con plant_photos', () => {
  it('las fotos secundarias están en uso; solo es huérfano lo que no cita nadie', () => {
    const report = findOrphans({
      objects: galleryObjects,
      plants: [galleryPlant],
      photos: galleryPhotos,
      now: NOW,
      minAgeMs: 24 * HOUR,
    })
    expect(report.referenced).toBe(6)
    expect(report.orphans.map((orphan) => orphan.name)).toEqual([
      `${USER}/${P3}/photo-z.webp`,
      `${USER}/${P3}/thumb-z.webp`,
    ])
    // La foto "d" tiene fila y no tiene archivos: se informa con su id.
    expect(report.missing).toEqual([
      {
        plantId: P3,
        column: 'photo_path',
        path: `${USER}/${P3}/photo-d.webp`,
        photoId: 'foto-d',
      },
      {
        plantId: P3,
        column: 'thumbnail_path',
        path: `${USER}/${P3}/thumb-d.webp`,
        photoId: 'foto-d',
      },
    ])
  })

  it('una ruta que falta en plants y en su principal se informa una sola vez', () => {
    const report = findOrphans({
      objects: [],
      plants: [galleryPlant],
      photos: galleryPhotos.slice(0, 1),
      now: NOW,
      minAgeMs: 24 * HOUR,
    })
    expect(report.missing.map((missing) => missing.path)).toEqual([
      `${USER}/${P3}/photo-a.webp`,
      `${USER}/${P3}/thumb-a.webp`,
    ])
    expect(report.missing.every((missing) => !missing.photoId)).toBe(true)
  })

  it('sin leer plant_photos, las secundarias parecerían huérfanas (lo que evita el script)', () => {
    const report = findOrphans({
      objects: galleryObjects,
      plants: [galleryPlant],
      now: NOW,
      minAgeMs: 24 * HOUR,
    })
    expect(report.orphans).toHaveLength(6)
  })

  it('--borrar con plantas de varias fotos no se lleva ninguna foto en uso', async () => {
    const removeObjects = vi.fn((paths: string[]) => {
      void paths
      return Promise.resolve()
    })
    const log = vi.fn()
    const result = await runOrphanCleanup(
      { borrar: true, antiguedadMinimaHoras: 24 },
      {
        listObjects: () => Promise.resolve(galleryObjects),
        listPlants: () => Promise.resolve([galleryPlant]),
        listPlantPhotos: () => Promise.resolve(galleryPhotos),
        listLogPhotos: () => Promise.resolve([]),
        removeObjects,
        log,
        now: NOW,
      },
    )
    expect(removeObjects).toHaveBeenCalledTimes(1)
    expect(removeObjects).toHaveBeenCalledWith([
      `${USER}/${P3}/photo-z.webp`,
      `${USER}/${P3}/thumb-z.webp`,
    ])
    expect(result.deleted).toBe(2)
    expect(log).toHaveBeenCalledWith(
      'Objetos: 8. Plantas: 1. Fotos (plant_photos): 4. Registros de bitácora con foto: 0. En uso: 6.',
    )
    expect(log).toHaveBeenCalledWith(
      `  planta ${P3}, foto foto-d, photo_path: ${USER}/${P3}/photo-d.webp`,
    )
  })
})

describe('findOrphans con la bitácora', () => {
  const P4 = '44444444-4444-4444-8444-444444444444'
  const logObjects: BucketObject[] = [
    { name: `${USER}/${P4}/photo-a.webp`, createdAt: old },
    { name: `${USER}/${P4}/thumb-a.webp`, createdAt: old },
    // Foto de un registro vigente.
    { name: `${USER}/${P4}/log/photo-r1.webp`, createdAt: old },
    { name: `${USER}/${P4}/log/thumb-r1.webp`, createdAt: old },
    // Restos de un registro que no llegó a guardarse.
    { name: `${USER}/${P4}/log/photo-r2.webp`, createdAt: old },
    { name: `${USER}/${P4}/log/thumb-r2.webp`, createdAt: fresh },
  ]
  const logPlant: PlantPhotoRow = {
    id: P4,
    user_id: USER,
    photo_path: `${USER}/${P4}/photo-a.webp`,
    thumbnail_path: `${USER}/${P4}/thumb-a.webp`,
  }
  const logPhotos: LogPhotoRow[] = [
    {
      id: 'registro-1',
      plant_id: P4,
      photo_path: `${USER}/${P4}/log/photo-r1.webp`,
      thumbnail_path: `${USER}/${P4}/log/thumb-r1.webp`,
    },
    {
      // Su foto no está en el bucket.
      id: 'registro-3',
      plant_id: P4,
      photo_path: `${USER}/${P4}/log/photo-r3.webp`,
      thumbnail_path: `${USER}/${P4}/log/thumb-r1.webp`,
    },
  ]

  it('las fotos de registros vigentes están en uso; las sueltas de log/ son huérfanas sin registro', () => {
    const report = findOrphans({
      objects: logObjects,
      plants: [logPlant],
      logPhotos,
      now: NOW,
      minAgeMs: 24 * HOUR,
    })
    expect(report.referenced).toBe(4)
    expect(report.orphans).toEqual([
      {
        name: `${USER}/${P4}/log/photo-r2.webp`,
        createdAt: old,
        reason: 'sin-registro',
      },
    ])
    expect(report.recent).toEqual([
      {
        name: `${USER}/${P4}/log/thumb-r2.webp`,
        createdAt: fresh,
        reason: 'sin-registro',
      },
    ])
    expect(report.missing).toEqual([
      {
        plantId: P4,
        column: 'photo_path',
        path: `${USER}/${P4}/log/photo-r3.webp`,
        logEntryId: 'registro-3',
      },
    ])
  })

  it('sin leer la bitácora, sus fotos parecerían huérfanas (lo que evita el script)', () => {
    const report = findOrphans({
      objects: logObjects,
      plants: [logPlant],
      now: NOW,
      minAgeMs: 24 * HOUR,
    })
    expect(report.orphans.map((orphan) => orphan.name)).toContain(
      `${USER}/${P4}/log/photo-r1.webp`,
    )
  })

  it('--borrar no se lleva las fotos de la bitácora en uso', async () => {
    const removeObjects = vi.fn((paths: string[]) => {
      void paths
      return Promise.resolve()
    })
    const log = vi.fn()
    await runOrphanCleanup(
      { borrar: true, antiguedadMinimaHoras: 24 },
      {
        listObjects: () => Promise.resolve(logObjects),
        listPlants: () => Promise.resolve([logPlant]),
        listPlantPhotos: () => Promise.resolve([]),
        listLogPhotos: () => Promise.resolve(logPhotos),
        removeObjects,
        log,
        now: NOW,
      },
    )
    expect(removeObjects).toHaveBeenCalledTimes(1)
    expect(removeObjects).toHaveBeenCalledWith([
      `${USER}/${P4}/log/photo-r2.webp`,
    ])
    expect(log).toHaveBeenCalledWith(
      `  planta ${P4}, registro registro-3, photo_path: ${USER}/${P4}/log/photo-r3.webp`,
    )
  })

  it('reconoce la ruta de la carpeta log', () => {
    expect(isLogPhotoPath(`${USER}/${P4}/log/photo-r1.webp`)).toBe(true)
    expect(isLogPhotoPath(`${USER}/${P4}/photo-r1.webp`)).toBe(false)
    expect(isLogPhotoPath(`${USER}/${P4}/log/`)).toBe(false)
    expect(isLogPhotoPath(`${USER}/${P4}/log/x/photo.webp`)).toBe(false)
    expect(isLogPhotoPath(`${USER}/no-es-uuid/log/photo.webp`)).toBe(false)
  })
})

describe('parseCleanupArguments', () => {
  it('por defecto solo lista, con 24 horas de antigüedad mínima', () => {
    expect(parseCleanupArguments(['--ambiente', 'desarrollo'])).toEqual({
      ambiente: 'desarrollo',
      borrar: false,
      confirmarProduccion: false,
      antiguedadMinimaHoras: 24,
    })
  })

  it('exige el ambiente y la confirmación para borrar en producción', () => {
    expect(() => parseCleanupArguments([])).toThrow(/ambiente/)
    expect(() => parseCleanupArguments(['--ambiente', 'local'])).toThrow()
    expect(() =>
      parseCleanupArguments(['--ambiente', 'produccion', '--borrar']),
    ).toThrow(/confirmar-produccion/)
    expect(
      parseCleanupArguments([
        '--ambiente',
        'produccion',
        '--borrar',
        '--confirmar-produccion',
        '--antiguedad-minima-horas',
        '48',
      ]),
    ).toMatchObject({ borrar: true, antiguedadMinimaHoras: 48 })
    expect(() =>
      parseCleanupArguments([
        '--ambiente',
        'desarrollo',
        '--antiguedad-minima-horas',
        '0',
      ]),
    ).toThrow()
    expect(() =>
      parseCleanupArguments(['--ambiente', 'desarrollo', '--todo']),
    ).toThrow(/desconocido/)
  })
})

describe('runOrphanCleanup', () => {
  function io() {
    return {
      listObjects: () => Promise.resolve(objects),
      listPlants: () => Promise.resolve(plants),
      listPlantPhotos: () => Promise.resolve([] as GalleryPhotoRow[]),
      listLogPhotos: () => Promise.resolve([] as LogPhotoRow[]),
      removeObjects: vi.fn(() => Promise.resolve()),
      log: vi.fn(),
      now: NOW,
    }
  }

  it('en modo de prueba lista los huérfanos y no borra nada', async () => {
    const fake = io()
    const result = await runOrphanCleanup(
      { borrar: false, antiguedadMinimaHoras: 24 },
      fake,
    )
    expect(fake.removeObjects).not.toHaveBeenCalled()
    expect(result.deleted).toBe(0)
    expect(fake.log).toHaveBeenCalledWith(
      `  ${USER}/${P1}/photo-v1.webp (sin-planta, ${old})`,
    )
    expect(fake.log).toHaveBeenCalledWith(
      'Modo de prueba: no se ha borrado nada.',
    )
  })

  it('con --borrar borra solo los huérfanos con la antigüedad mínima', async () => {
    const fake = io()
    const result = await runOrphanCleanup(
      { borrar: true, antiguedadMinimaHoras: 24 },
      fake,
    )
    expect(fake.removeObjects).toHaveBeenCalledWith([
      'suelto.png',
      `${USER}/${P1}/photo-v1.webp`,
    ])
    expect(result.deleted).toBe(2)
  })

  it('borra en lotes de 100', () => {
    const batches = inBatches(
      Array.from({ length: 250 }, (_, index) => index),
      100,
    )
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50])
  })
})
