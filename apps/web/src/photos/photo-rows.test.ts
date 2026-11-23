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
        'update',
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
    rpc(fn: string, args: unknown) {
      const call: Call = { table: `rpc:${fn}`, steps: [['args', args]] }
      calls.push(call)
      return Promise.resolve(reply(call))
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

  it('cambia la fecha, la nota y "en floración" de una foto (solo lo pasado)', async () => {
    const { calls, rows } = fakeClient(() => ({
      data: { ...ROW, note: 'Segunda vara', in_bloom: false },
      error: null,
      status: 200,
    }))
    const photo = await rows.update(ROW.id, USER_ID, {
      note: 'Segunda vara',
      inBloom: false,
    })
    expect(photo).toMatchObject({ note: 'Segunda vara', inBloom: false })
    expect(calls[0]).toEqual({
      table: 'plant_photos',
      steps: [
        ['update', { note: 'Segunda vara', in_bloom: false }],
        ['eq', 'id', ROW.id],
        ['eq', 'user_id', USER_ID],
        ['select', PLANT_PHOTO_SELECT],
        ['single'],
      ],
    })

    await rows.update(ROW.id, USER_ID, { takenAt: null })
    expect(calls[1].steps[0]).toEqual(['update', { taken_at: null }])
  })

  it('cambiar una foto que ya no existe es "not-found"', async () => {
    const { rows } = fakeClient(() => ({
      data: null,
      error: { code: 'PGRST116', message: 'JSON object requested' },
      status: 406,
    }))
    await expect(
      rows.update(ROW.id, USER_ID, { note: null }),
    ).rejects.toMatchObject({ reason: 'not-found' })
  })

  it('reordena con la función reorder_plant_photos y devuelve las fotos en orden', async () => {
    const second = { ...ROW, id: 'segunda', position: 0 }
    const { calls, rows } = fakeClient(() => ({
      data: [{ ...ROW, position: 1 }, second],
      error: null,
      status: 200,
    }))
    const photos = await rows.reorder(PLANT_ID, USER_ID, ['segunda', ROW.id])
    expect(photos.map((photo) => [photo.id, photo.position])).toEqual([
      ['segunda', 0],
      [ROW.id, 1],
    ])
    expect(calls[0]).toEqual({
      table: 'rpc:reorder_plant_photos',
      steps: [
        ['args', { target_plant_id: PLANT_ID, photo_ids: ['segunda', ROW.id] }],
      ],
    })
  })

  it('si las fotos de la planta cambiaron entre tanto (22023), es "position-taken"', async () => {
    const { rows } = fakeClient(() => ({
      data: null,
      error: { code: '22023', message: 'las fotos no son las de la planta' },
      status: 400,
    }))
    await expect(
      rows.reorder(PLANT_ID, USER_ID, [ROW.id]),
    ).rejects.toMatchObject({ reason: 'position-taken', uncertain: false })
  })

  it('sin la función en la base (PGRST202) falla sin cambiar nada', async () => {
    const { rows } = fakeClient(() => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
      status: 404,
    }))
    await expect(
      rows.reorder(PLANT_ID, USER_ID, [ROW.id]),
    ).rejects.toMatchObject({ reason: 'failed' })
  })
})
