import { describe, expect, it, vi } from 'vitest'
import {
  findOrphans,
  inBatches,
  parseCleanupArguments,
  runOrphanCleanup,
  type BucketObject,
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
