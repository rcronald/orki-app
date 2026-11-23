import { PlantLogError, type PlantLogEntries } from './entries.ts'
import type { LogEntry } from './model.ts'

// Bitácora en memoria con las reglas de la base que importan a la app (#267):
// la clave de reintento (la misma clave en la misma planta devuelve el
// registro que existía; en otra planta, error), el orden (created_at desc, id
// desc), el filtro por tipo, el cursor y el borrado solo de lo propio. La
// usan las pruebas y /muestra. Puede tardar y fallar a voluntad.

export interface StoredLogEntry extends LogEntry {
  userId: string
  idempotencyKey: string | null
}

export type MemoryLogFailure =
  /** Falla sin guardar nada. */
  | { when: 'before'; error: PlantLogError }
  /** Guarda y después falla (la respuesta se perdió). */
  | { when: 'after'; error: PlantLogError }

export interface MemoryPlantLogEntries extends PlantLogEntries {
  readonly rows: Map<string, StoredLogEntry>
  /** Dueño de cada planta: solo se crean registros en las propias. */
  readonly plants: Map<string, string>
  /** Usuario con el que se crean (el del token). */
  userId: string
  /** Si devuelve un fallo, la próxima operación de ese tipo falla con él. */
  fail:
    | ((operation: 'list' | 'add' | 'remove') => MemoryLogFailure | null)
    | undefined
  delayMs: number
  /** Los registros de una planta, del más reciente al más antiguo. */
  entriesOf(plantId: string): StoredLogEntry[]
}

function wait(ms: number) {
  return ms > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, ms))
    : Promise.resolve()
}

function newest(a: LogEntry, b: LogEntry): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
}

function publicEntry(row: StoredLogEntry): LogEntry {
  return {
    id: row.id,
    plantId: row.plantId,
    type: row.type,
    title: row.title,
    description: row.description,
    photoPath: row.photoPath,
    thumbnailPath: row.thumbnailPath,
    inBloom: row.inBloom,
    createdAt: row.createdAt,
  }
}

export function createMemoryPlantLogEntries({
  userId = 'muestra',
  delayMs = 0,
  start = Date.parse('2026-11-23T12:00:00.000Z'),
}: {
  userId?: string
  delayMs?: number
  start?: number
} = {}): MemoryPlantLogEntries {
  const rows = new Map<string, StoredLogEntry>()
  const plants = new Map<string, string>()
  let clock = start
  let counter = 0

  const log: MemoryPlantLogEntries = {
    rows,
    plants,
    userId,
    fail: undefined,
    delayMs,

    entriesOf(plantId) {
      return [...rows.values()]
        .filter((row) => row.plantId === plantId)
        .sort(newest)
    },

    async list({ plantId, type, before, pageSize }) {
      await wait(log.delayMs)
      const failure = log.fail?.('list')
      if (failure) throw failure.error
      return log
        .entriesOf(plantId)
        .filter((row) => row.userId === log.userId)
        .filter((row) => type === null || row.type === type)
        .filter(
          (row) =>
            before === null ||
            row.createdAt < before.createdAt ||
            (row.createdAt === before.createdAt && row.id < before.id),
        )
        .slice(0, Math.min(Math.max(pageSize, 1), 100))
        .map(publicEntry)
    },

    async add(input) {
      await wait(log.delayMs)
      const failure = log.fail?.('add')
      if (failure?.when === 'before') throw failure.error
      const existing = [...rows.values()].find(
        (row) =>
          row.userId === log.userId &&
          row.idempotencyKey === input.idempotencyKey,
      )
      let saved: StoredLogEntry
      if (existing) {
        if (existing.plantId !== input.plantId) {
          throw new PlantLogError('invalid')
        }
        saved = existing
      } else {
        if (plants.get(input.plantId) !== log.userId) {
          throw new PlantLogError('not-found')
        }
        clock += 60_000
        counter += 1
        saved = {
          id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
          plantId: input.plantId,
          userId: log.userId,
          type: input.type,
          title: input.title,
          description: input.description,
          photoPath: input.photoPath,
          thumbnailPath: input.thumbnailPath,
          inBloom: input.inBloom,
          // Como la base: con microsegundos.
          createdAt: new Date(clock).toISOString().replace('Z', '123+00:00'),
          idempotencyKey: input.idempotencyKey,
        }
        rows.set(saved.id, saved)
      }
      if (failure?.when === 'after') throw failure.error
      return publicEntry(saved)
    },

    async remove(entryId, owner) {
      await wait(log.delayMs)
      const failure = log.fail?.('remove')
      if (failure?.when === 'before') throw failure.error
      const row = rows.get(entryId)
      if (!row || row.userId !== owner || owner !== log.userId) return null
      rows.delete(entryId)
      if (failure?.when === 'after') throw failure.error
      return publicEntry(row)
    },
  }
  return log
}
