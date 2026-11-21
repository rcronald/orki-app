import { parsePhotoPath } from './paths.ts'

// Lógica pura del script de limpieza de fotos (scripts/fotos-huerfanas.mjs,
// #83): compara los objetos del bucket con las rutas que guardan las plantas.
// Vive aquí, en TypeScript con sintaxis borrable, para probarla con Vitest;
// el script la importa con Node, que quita los tipos al cargarla.

/** Un objeto del bucket. */
export interface BucketObject {
  /** Ruta dentro del bucket. */
  name: string
  /** Fecha de creación (ISO 8601); null si Storage no la dio. */
  createdAt: string | null
}

/** Lo que el script lee de cada planta. */
export interface PlantPhotoRow {
  id: string
  user_id: string
  photo_path: string | null
  thumbnail_path: string | null
}

export type OrphanReason =
  /** Sigue la convención, pero ninguna planta apunta a él. */
  | 'sin-planta'
  /** No sigue la convención de rutas (ni es de ninguna planta). */
  | 'fuera-de-convencion'

export interface Orphan extends BucketObject {
  reason: OrphanReason
}

export interface MissingFile {
  plantId: string
  column: 'photo_path' | 'thumbnail_path'
  path: string
}

export interface OrphanReport {
  /** Huérfanos con la antigüedad mínima: los que se borrarían. */
  orphans: Orphan[]
  /**
   * Sin planta, pero más nuevos que la antigüedad mínima (o sin fecha): puede
   * ser una subida en curso cuya planta aún no apunta a ellos. No se tocan.
   */
  recent: Orphan[]
  /** Plantas que apuntan a un archivo que no está en el bucket. */
  missing: MissingFile[]
  /** Objetos que sí son de alguna planta. */
  referenced: number
}

export interface FindOrphansInput {
  objects: readonly BucketObject[]
  plants: readonly PlantPhotoRow[]
  /** Momento de referencia (Date.now()). */
  now: number
  /** Antigüedad mínima para dar un huérfano por borrable, en milisegundos. */
  minAgeMs: number
}

/** Clasifica los objetos del bucket frente a las rutas de las plantas. */
export function findOrphans({
  objects,
  plants,
  now,
  minAgeMs,
}: FindOrphansInput): OrphanReport {
  const referenced = new Set<string>()
  for (const plant of plants) {
    if (plant.photo_path) referenced.add(plant.photo_path)
    if (plant.thumbnail_path) referenced.add(plant.thumbnail_path)
  }
  const existing = new Set(objects.map((object) => object.name))

  const orphans: Orphan[] = []
  const recent: Orphan[] = []
  let referencedCount = 0
  for (const object of objects) {
    if (referenced.has(object.name)) {
      referencedCount += 1
      continue
    }
    const orphan: Orphan = {
      ...object,
      reason:
        parsePhotoPath(object.name) === null
          ? 'fuera-de-convencion'
          : 'sin-planta',
    }
    const created =
      object.createdAt === null ? Number.NaN : Date.parse(object.createdAt)
    // Sin fecha válida no se puede saber si es una subida en curso.
    if (Number.isFinite(created) && now - created >= minAgeMs) {
      orphans.push(orphan)
    } else {
      recent.push(orphan)
    }
  }

  const missing: MissingFile[] = []
  for (const plant of plants) {
    for (const column of ['photo_path', 'thumbnail_path'] as const) {
      const path = plant[column]
      if (path && !existing.has(path)) {
        missing.push({ plantId: plant.id, column, path })
      }
    }
  }

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  return {
    orphans: orphans.sort(byName),
    recent: recent.sort(byName),
    missing: missing.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
    referenced: referencedCount,
  }
}

/** Parte una lista en lotes de `size`. */
export function inBatches<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

export interface CleanupArguments {
  ambiente: 'desarrollo' | 'produccion'
  borrar: boolean
  confirmarProduccion: boolean
  antiguedadMinimaHoras: number
}

/**
 * Lee los argumentos del script. Lanza Error con un texto en español si
 * falta algo o sobra algo. Por defecto solo lista (modo de prueba).
 */
export function parseCleanupArguments(
  argv: readonly string[],
): CleanupArguments {
  let ambiente: CleanupArguments['ambiente'] | undefined
  let borrar = false
  let confirmarProduccion = false
  let antiguedadMinimaHoras = 24
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    switch (argument) {
      case '--ambiente': {
        const value = argv[index + 1]
        index += 1
        if (value !== 'desarrollo' && value !== 'produccion') {
          throw new Error('--ambiente debe ser "desarrollo" o "produccion".')
        }
        ambiente = value
        break
      }
      case '--borrar':
        borrar = true
        break
      case '--confirmar-produccion':
        confirmarProduccion = true
        break
      case '--antiguedad-minima-horas': {
        const value = Number(argv[index + 1])
        index += 1
        if (!Number.isFinite(value) || value < 1) {
          throw new Error(
            '--antiguedad-minima-horas debe ser un número de horas mayor o igual que 1.',
          )
        }
        antiguedadMinimaHoras = value
        break
      }
      default:
        throw new Error(`argumento desconocido: ${String(argument)}`)
    }
  }
  if (!ambiente) {
    throw new Error(
      'indica el ambiente: --ambiente desarrollo o --ambiente produccion.',
    )
  }
  if (ambiente === 'produccion' && borrar && !confirmarProduccion) {
    throw new Error(
      'para borrar en producción hace falta además --confirmar-produccion.',
    )
  }
  return { ambiente, borrar, confirmarProduccion, antiguedadMinimaHoras }
}

export interface OrphanCleanupIo {
  listObjects: () => Promise<BucketObject[]>
  listPlants: () => Promise<PlantPhotoRow[]>
  /** Borra un lote de rutas; rechaza si falla. */
  removeObjects: (paths: string[]) => Promise<void>
  log: (line: string) => void
  now: number
}

export interface OrphanCleanupResult {
  report: OrphanReport
  /** Objetos borrados (0 en modo de prueba). */
  deleted: number
}

const DELETE_BATCH = 100

/**
 * Ejecuta la limpieza: lista, compara, informa y, solo con `borrar`, borra
 * los huérfanos con la antigüedad mínima en lotes de 100.
 */
export async function runOrphanCleanup(
  {
    borrar,
    antiguedadMinimaHoras,
  }: Pick<CleanupArguments, 'borrar' | 'antiguedadMinimaHoras'>,
  io: OrphanCleanupIo,
): Promise<OrphanCleanupResult> {
  const [objects, plants] = await Promise.all([
    io.listObjects(),
    io.listPlants(),
  ])
  const report = findOrphans({
    objects,
    plants,
    now: io.now,
    minAgeMs: antiguedadMinimaHoras * 3600 * 1000,
  })
  io.log(
    `Objetos: ${objects.length}. Plantas: ${plants.length}. En uso: ${report.referenced}.`,
  )
  io.log(
    `Huérfanos con más de ${antiguedadMinimaHoras} h: ${report.orphans.length}.`,
  )
  for (const orphan of report.orphans) {
    io.log(
      `  ${orphan.name} (${orphan.reason}, ${orphan.createdAt ?? 'sin fecha'})`,
    )
  }
  io.log(
    `Huérfanos recientes o sin fecha (no se tocan): ${report.recent.length}.`,
  )
  for (const orphan of report.recent) {
    io.log(`  ${orphan.name} (${orphan.createdAt ?? 'sin fecha'})`)
  }
  io.log(
    `Plantas que apuntan a un archivo que no existe: ${report.missing.length}.`,
  )
  for (const missing of report.missing) {
    io.log(`  planta ${missing.plantId}, ${missing.column}: ${missing.path}`)
  }

  if (!borrar) {
    io.log('Modo de prueba: no se ha borrado nada.')
    return { report, deleted: 0 }
  }
  let deleted = 0
  for (const batch of inBatches(
    report.orphans.map((orphan) => orphan.name),
    DELETE_BATCH,
  )) {
    try {
      await io.removeObjects(batch)
    } catch (error) {
      throw new Error(
        `falló el borrado tras ${deleted} objetos (${error instanceof Error ? error.message : String(error)}). Vuelve a ejecutarlo para seguir.`,
        { cause: error },
      )
    }
    deleted += batch.length
  }
  io.log(`Borrados: ${deleted}.`)
  return { report, deleted }
}
