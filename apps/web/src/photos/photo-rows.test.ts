import { describe, expect, it } from 'vitest'
import type { OrkiSupabaseClient } from '../lib/supabase.ts'
import { plantRow } from '../test/collection.ts'
import { PLANT_ID, USER_ID } from '../test/photos.ts'
import {
  createSupabasePlantPhotoRows,
  PLANT_PHOTO_SELECT,
  photoRowError,
} from './photo-rows.ts'

interface Call {
  table: string
  steps: [string, ...unknown[]][]
}

/**
 * Doble mínimo de supabase-js: anota la cadena de cada consulta y responde
 * con `reply` al esperarla.
 */
function fakeClient(
  reply: (call: Call) => { data: unknown; error: unknown; status: number },
) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, steps: [] }
      calls.push(call)
      const builder: Record<string, unknown> = {}
      for (const step of [
        'select',
        'insert',
        'delete',
        'eq',
        'order',
        'single',
      ]) {
        builder[step] = (...args: unknown[]) => {
          call.steps.push([step, ...args])
          return builder
        }
      }
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise.resolve(reply(call)).then(resolve, reject)
      return builder
    },
  }
  return {
    calls,
    rows: createSupabasePlantPhotoRows({
      getClient: () => Promise.resolve(client as unknown as OrkiSupabaseClient),
    }),
  }
}

const ROW = {
  id: 'f0000000-0000-4000-8000-000000000001',
  plant_id: PLANT_ID,
  photo_path: `${USER_ID}/${PLANT_ID}/photo-v1.webp`,
  thumbnail_path: `${USER_ID}/${PLANT_ID}/thumb-v1.webp`,
  in_bloom: true,
  taken_at: '2026-11-20',
  note: 'Primera flor',
  position: 0,
  created_at: '2026-11-22T12:00:00+00:00',
}

describe('filas de plant_photos con PostgREST', () => {
  it('lee las fotos de la planta y del usuario, en orden de posición', async () => {
    const second = { ...ROW, id: 'segunda', position: 3 }
    const { calls, rows } = fakeClient(() => ({
      data: [second, ROW],
      error: null,
      status: 200,
    }))

    const photos = await rows.list(PLANT_ID, USER_ID)

    expect(photos.map((photo) => photo.position)).toEqual([0, 3])
    expect(photos[0]).toEqual({
      id: ROW.id,
      plantId: PLANT_ID,
      photoPath: ROW.photo_path,
      thumbnailPath: ROW.thumbnail_path,
      inBloom: true,
      takenAt: '2026-11-20',
      note: 'Primera flor',
      position: 0,
      createdAt: ROW.created_at,
    })
    expect(calls[0]).toEqual({
      table: 'plant_photos',
      steps: [
        ['select', PLANT_PHOTO_SELECT],
        ['eq', 'plant_id', PLANT_ID],
        ['eq', 'user_id', USER_ID],
        ['order', 'position', { ascending: true }],
      ],
    })
  })

  it('inserta con todas las columnas y devuelve la fila', async () => {
    const { calls, rows } = fakeClient(() => ({
      data: ROW,
      error: null,
      status: 201,
    }))
    const stored = await rows.insert({
      plantId: PLANT_ID,
      userId: USER_ID,
      photoPath: ROW.photo_path,
      thumbnailPath: ROW.thumbnail_path,
      inBloom: true,
      takenAt: '2026-11-20',
      note: 'Primera flor',
      position: 0,
    })
    expect(stored.id).toBe(ROW.id)
    expect(calls[0].steps[0]).toEqual([
      'insert',
      {
        plant_id: PLANT_ID,
        user_id: USER_ID,
        photo_path: ROW.photo_path,
        thumbnail_path: ROW.thumbnail_path,
        in_bloom: true,
        taken_at: '2026-11-20',
        note: 'Primera flor',
        position: 0,
      },
    ])
  })

  it('una posición ocupada (23505) es "position-taken"', async () => {
    const { rows } = fakeClient(() => ({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "plant_photos_plant_id_position_key"',
      },
      status: 409,
    }))
    await expect(
      rows.insert({
        plantId: PLANT_ID,
        userId: USER_ID,
        photoPath: ROW.photo_path,
        thumbnailPath: ROW.thumbnail_path,
        inBloom: false,
        takenAt: null,
        note: null,
        position: 0,
      }),
    ).rejects.toMatchObject({ reason: 'position-taken', uncertain: false })
  })

  it('traduce los demás errores de la base y de la red', () => {
    expect(photoRowError({ code: '23503' }, 409).reason).toBe('not-found')
    expect(photoRowError({ code: '42501' }, 403).reason).toBe('forbidden')
    expect(photoRowError({ code: '23514' }, 400)).toMatchObject({
      reason: 'failed',
      uncertain: false,
    })
    expect(photoRowError({ message: 'TypeError' }, 0)).toMatchObject({
      reason: 'offline',
      uncertain: true,
    })
    expect(photoRowError({}, 401).reason).toBe('session-ended')
  })

  it('borrar devuelve la fila borrada, o null si no existía', async () => {
    let data: unknown[] = [ROW]
    const { calls, rows } = fakeClient(() => ({
      data,
      error: null,
      status: 200,
    }))
    expect((await rows.remove(ROW.id, USER_ID))?.photoPath).toBe(ROW.photo_path)
    expect(calls[0].steps).toEqual([
      ['delete'],
      ['eq', 'id', ROW.id],
      ['eq', 'user_id', USER_ID],
      ['select', PLANT_PHOTO_SELECT],
    ])
    data = []
    expect(await rows.remove(ROW.id, USER_ID)).toBeNull()
  })

  it('relee la planta con las columnas de la colección', async () => {
    const { calls, rows } = fakeClient(() => ({
      data: plantRow({ id: PLANT_ID, photo_path: ROW.photo_path }),
      error: null,
      status: 200,
    }))
    const plant = await rows.readPlant(PLANT_ID, USER_ID)
    expect(plant.photoPath).toBe(ROW.photo_path)
    expect(calls[0].table).toBe('plants')
  })
})
