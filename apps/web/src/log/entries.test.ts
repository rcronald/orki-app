import { describe, expect, it, vi } from 'vitest'
import type { OrkiSupabaseClient } from '../lib/supabase.ts'
import { SessionTokenError } from '../lib/supabase.ts'
import {
  createSupabasePlantLogEntries,
  PlantLogError,
  plantLogErrorFromPostgrest,
} from './entries.ts'
import { createMemoryPlantLogEntries } from './memory-entries.ts'
import { formatLogDateTime } from './model.ts'

const PLANT = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
const USER = 'user_prueba'

const ROW = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  plant_id: PLANT,
  user_id: USER,
  type: 'watering' as const,
  title: 'Riego por inmersión',
  description: null,
  photo_path: null,
  thumbnail_path: null,
  in_bloom: null,
  idempotency_key: 'k',
  created_at: '2026-11-23T12:40:00.123456+00:00',
}

function fakeClient(response: {
  data: unknown
  error: unknown
  status: number
}) {
  const rpc = vi.fn(() => Promise.resolve(response))
  const calls: string[] = []
  const query = {
    delete: () => {
      calls.push('delete')
      return query
    },
    eq: (column: string, value: string) => {
      calls.push(`${column}=${value}`)
      return query
    },
    select: (columns: string) => {
      calls.push(`select ${columns}`)
      return Promise.resolve(response)
    },
  }
  const from = vi.fn(() => query)
  const client = { rpc, from } as unknown as OrkiSupabaseClient
  return { client, rpc, from, calls }
}

describe('createSupabasePlantLogEntries', () => {
  it('list pasa el filtro, el cursor tal como llegó (texto) y el tamaño', async () => {
    const fake = fakeClient({ data: [ROW], error: null, status: 200 })
    const entries = createSupabasePlantLogEntries({
      getClient: () => Promise.resolve(fake.client),
    })
    const page = await entries.list({
      plantId: PLANT,
      type: 'nutrition',
      before: { createdAt: ROW.created_at, id: ROW.id },
      pageSize: 21,
    })
    expect(fake.rpc).toHaveBeenCalledWith('list_plant_log_entries', {
      target_plant_id: PLANT,
      entry_type: 'nutrition',
      before_created_at: '2026-11-23T12:40:00.123456+00:00',
      before_id: ROW.id,
      page_size: 21,
    })
    expect(page).toEqual([
      {
        id: ROW.id,
        plantId: PLANT,
        type: 'watering',
        title: 'Riego por inmersión',
        description: null,
        photoPath: null,
        thumbnailPath: null,
        inBloom: null,
        createdAt: ROW.created_at,
      },
    ])
  })

  it('list sin filtro ni cursor no envía esos parámetros (la función los toma como null)', async () => {
    const fake = fakeClient({ data: [], error: null, status: 200 })
    const entries = createSupabasePlantLogEntries({
      getClient: () => Promise.resolve(fake.client),
    })
    await entries.list({
      plantId: PLANT,
      type: null,
      before: null,
      pageSize: 5,
    })
    const [, args] = fake.rpc.mock.calls[0] as unknown as [string, object]
    expect(JSON.parse(JSON.stringify(args))).toEqual({
      target_plant_id: PLANT,
      page_size: 5,
    })
  })

  it('add llama a add_plant_log_entry con la clave de reintento', async () => {
    const fake = fakeClient({ data: ROW, error: null, status: 200 })
    const entries = createSupabasePlantLogEntries({
      getClient: () => Promise.resolve(fake.client),
    })
    await entries.add({
      plantId: PLANT,
      type: 'watering',
      title: 'Riego por inmersión',
      description: null,
      photoPath: `${USER}/${PLANT}/log/photo-v.webp`,
      thumbnailPath: `${USER}/${PLANT}/log/thumb-v.webp`,
      inBloom: false,
      idempotencyKey: 'clave',
    })
    const [name, args] = fake.rpc.mock.calls[0] as unknown as [string, object]
    expect(name).toBe('add_plant_log_entry')
    expect(JSON.parse(JSON.stringify(args))).toEqual({
      target_plant_id: PLANT,
      entry_type: 'watering',
      title: 'Riego por inmersión',
      photo_path: `${USER}/${PLANT}/log/photo-v.webp`,
      thumbnail_path: `${USER}/${PLANT}/log/thumb-v.webp`,
      in_bloom: false,
      idempotency_key: 'clave',
    })
  })

  it('remove borra por id y usuario y devuelve el registro (null si no estaba)', async () => {
    const fake = fakeClient({ data: [ROW], error: null, status: 200 })
    const entries = createSupabasePlantLogEntries({
      getClient: () => Promise.resolve(fake.client),
    })
    await expect(entries.remove(ROW.id, USER)).resolves.toMatchObject({
      id: ROW.id,
    })
    expect(fake.from).toHaveBeenCalledWith('plant_log_entries')
    expect(fake.calls.slice(0, 3)).toEqual([
      'delete',
      `id=${ROW.id}`,
      `user_id=${USER}`,
    ])
    const empty = fakeClient({ data: [], error: null, status: 200 })
    await expect(
      createSupabasePlantLogEntries({
        getClient: () => Promise.resolve(empty.client),
      }).remove(ROW.id, USER),
    ).resolves.toBeNull()
  })

  it('traduce los errores', async () => {
    const fake = fakeClient({
      data: null,
      error: { code: '23514' },
      status: 400,
    })
    const entries = createSupabasePlantLogEntries({
      getClient: () => Promise.resolve(fake.client),
    })
    await expect(
      entries.list({ plantId: PLANT, type: null, before: null, pageSize: 1 }),
    ).rejects.toMatchObject({ reason: 'invalid', uncertain: false })
  })
})

describe('plantLogErrorFromPostgrest', () => {
  it.each([
    [{}, 0, 'offline', true],
    [{}, 401, 'session-ended', false],
    [{ code: '42501' }, 403, 'not-found', false],
    [{ code: '22023' }, 400, 'invalid', false],
    [{}, 503, 'failed', true],
    [{}, 400, 'failed', false],
  ])('%o con %i: %s', (error, status, reason, uncertain) => {
    expect(plantLogErrorFromPostgrest(error, status)).toMatchObject({
      reason,
      uncertain,
    })
  })

  it('sin token de la sesión, la petición no salió', () => {
    const error = plantLogErrorFromPostgrest(
      new SessionTokenError('offline'),
      0,
    )
    expect(error).toBeInstanceOf(PlantLogError)
    expect(error).toMatchObject({ reason: 'offline', uncertain: false })
  })
})

describe('createMemoryPlantLogEntries', () => {
  async function seeded() {
    const log = createMemoryPlantLogEntries({ userId: USER })
    log.plants.set(PLANT, USER)
    const types = [
      'watering',
      'nutrition',
      'watering',
      'preventive_health',
    ] as const
    for (const [index, type] of types.entries()) {
      await log.add({
        plantId: PLANT,
        type,
        title: `Registro ${String(index + 1)}`,
        description: null,
        photoPath: null,
        thumbnailPath: null,
        inBloom: null,
        idempotencyKey: `clave-${String(index)}`,
      })
    }
    return log
  }

  it('lista del más reciente al más antiguo, con filtro y cursor', async () => {
    const log = await seeded()
    const all = await log.list({
      plantId: PLANT,
      type: null,
      before: null,
      pageSize: 2,
    })
    expect(all.map((entry) => entry.title)).toEqual([
      'Registro 4',
      'Registro 3',
    ])
    const last = all.at(-1)
    if (!last) throw new Error('Sin registros')
    const next = await log.list({
      plantId: PLANT,
      type: null,
      before: { createdAt: last.createdAt, id: last.id },
      pageSize: 10,
    })
    expect(next.map((entry) => entry.title)).toEqual([
      'Registro 2',
      'Registro 1',
    ])
    const watering = await log.list({
      plantId: PLANT,
      type: 'watering',
      before: null,
      pageSize: 10,
    })
    expect(watering.map((entry) => entry.title)).toEqual([
      'Registro 3',
      'Registro 1',
    ])
  })

  it('la misma clave devuelve el mismo registro; en otra planta, error', async () => {
    const log = await seeded()
    const again = await log.add({
      plantId: PLANT,
      type: 'nutrition',
      title: 'Otro',
      description: null,
      photoPath: null,
      thumbnailPath: null,
      inBloom: null,
      idempotencyKey: 'clave-0',
    })
    expect(again.title).toBe('Registro 1')
    expect(log.rows.size).toBe(4)
    const other = '11111111-2222-4333-8444-555555555555'
    log.plants.set(other, USER)
    await expect(
      log.add({
        plantId: other,
        type: 'nutrition',
        title: 'Otro',
        description: null,
        photoPath: null,
        thumbnailPath: null,
        inBloom: null,
        idempotencyKey: 'clave-0',
      }),
    ).rejects.toMatchObject({ reason: 'invalid' })
  })
})

describe('formatLogDateTime', () => {
  it('fecha y hora cortas en el horario del dispositivo, sin punto en el mes', () => {
    // La hora depende del huso de la máquina: solo se comprueba la forma.
    const text = formatLogDateTime('2026-11-23T12:40:00.123456+00:00')
    expect(text).toMatch(/^\d{1,2} nov 2026, \d{1,2}:40$/)
  })

  it('una fecha que no se entiende se devuelve tal cual', () => {
    expect(formatLogDateTime('ayer')).toBe('ayer')
  })
})
