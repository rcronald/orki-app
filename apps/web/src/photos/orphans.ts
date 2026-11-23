import { parsePhotoPath } from './paths.ts'

// Lógica pura del script de limpieza de fotos (scripts/fotos-huerfanas.mjs,
// #83): compara los objetos del bucket con las rutas que guardan las plantas.
// Desde el #219, un archivo está en uso si lo cita una fila de plant_photos
// (cualquiera de las hasta 6 fotos de una planta) o las columnas de plants (la
// copia de la principal, que también escribe la app antigua). Desde el #264,
// también si lo cita un registro de la bitácora (plant_log_entries), cuyas
// fotos van en <usuario>/<planta>/log/<archivo>.
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

/** Lo que el script lee de cada fila de plant_photos. */
export interface GalleryPhotoRow {
  id: string
  plant_id: string
  photo_path: string
  thumbnail_path: string
}

/**
 * Lo que el script lee de cada registro de la bitácora con foto (#264). Los
 * registros sin foto no se leen: no citan ningún archivo.
 */
export interface LogPhotoRow {
  id: string
  plant_id: string
  photo_path: string
  thumbnail_path: string
}

export type OrphanReason =
  /** Sigue la convención, pero ninguna planta ni ninguna foto apunta a él. */
  | 'sin-planta'
  /** Está en la carpeta log/ de una planta, pero ningún registro lo cita. */
  | 'sin-registro'
  /** No sigue la convención de rutas (ni es de ninguna planta). */
  | 'fuera-de-convencion'

export interface Orphan extends BucketObject {
  reason: OrphanReason
}

export interface MissingFile {
  plantId: string
  column: 'photo_path' | 'thumbnail_path'
  path: string
  /** Id de la fila de plant_photos, si la ruta sale de ahí y no de plants. */
  photoId?: string
  /** Id del registro de la bitácora, si la ruta sale de plant_log_entries. */
  logEntryId?: string
}

export interface OrphanReport {
  /** Huérfanos con la antigüedad mínima: los que se borrarían. */
  orphans: Orphan[]
  /**
   * Sin planta, pero más nuevos que la antigüedad mínima (o sin fecha): puede
   * ser una subida en curso cuya planta aún no apunta a ellos. No se tocan.
   */
  recent: Orphan[]
  /**
   * Plantas o fotos de plant_photos que apuntan a un archivo que no está en el
   * bucket (una vez por ruta: la principal está en las dos tablas).
   */
  missing: MissingFile[]
  /** Objetos que sí son de alguna planta o foto. */
  referenced: number
}

export interface FindOrphansInput {
  objects: readonly BucketObject[]
  plants: readonly PlantPhotoRow[]
  /** Filas de plant_photos; vacío si la tabla no existe todavía. */
  photos?: readonly GalleryPhotoRow[]
  /** Registros de la bitácora con foto; vacío si la tabla no existe todavía. */
  logPhotos?: readonly LogPhotoRow[]
  /** Momento de referencia (Date.now()). */
  now: number
  /** Antigüedad mínima para dar un huérfano por borrable, en milisegundos. */
  minAgeMs: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * ¿Es una ruta de foto de la bitácora (<usuario>/<planta>/log/<archivo>)? La
 * misma forma que exige la restricción plant_log_entries_photo_path_valid.
 */
export function isLogPhotoPath(path: string): boolean {
  const segments = path.split('/')
  return (
    segments.length === 4 &&
    segments[0] !== '' &&
    UUID.test(segments[1] ?? '') &&
    segments[2] === 'log' &&
    segments[3] !== ''
  )
}

/**
 * Clasifica los objetos del bucket frente a las rutas de las plantas, de
 * plant_photos y de la bitácora.
 */
export function findOrphans({
  objects,
  plants,
  photos = [],
  logPhotos = [],
  now,
  minAgeMs,
}: FindOrphansInput): OrphanReport {
  const referenced = new Set<string>()
  for (const plant of plants) {
    if (plant.photo_path) referenced.add(plant.photo_path)
    if (plant.thumbnail_path) referenced.add(plant.thumbnail_path)
  }
  for (const photo of photos) {
    referenced.add(photo.photo_path)
    referenced.add(photo.thumbnail_path)
  }
  for (const entry of logPhotos) {
    referenced.add(entry.photo_path)
    referenced.add(entry.thumbnail_path)
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
      reason: isLogPhotoPath(object.name)
        ? 'sin-registro'
        : parsePhotoPath(object.name) === null
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
  const reported = new Set<string>()
  for (const plant of plants) {
    for (const column of ['photo_path', 'thumbnail_path'] as const) {
      const path = plant[column]
      if (path && !existing.has(path) && !reported.has(path)) {
        reported.add(path)
        missing.push({ plantId: plant.id, column, path })
      }
    }
  }
  for (const photo of photos) {
    for (const column of ['photo_path', 'thumbnail_path'] as const) {
      const path = photo[column]
      if (!existing.has(path) && !reported.has(path)) {
        reported.add(path)
        missing.push({
          plantId: photo.plant_id,
          column,
          path,
          photoId: photo.id,
        })
      }
    }
  }
  for (const entry of logPhotos) {
    for (const column of ['photo_path', 'thumbnail_path'] as const) {
      const path = entry[column]
      if (!existing.has(path) && !reported.has(path)) {
        reported.add(path)
        missing.push({
          plantId: entry.plant_id,
          column,
          path,
          logEntryId: entry.id,
        })
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
  /** Filas de plant_photos (vacío si la tabla no existe en ese proyecto). */
  listPlantPhotos: () => Promise<GalleryPhotoRow[]>
  /** Registros de la bitácora con foto (vacío si la tabla no existe). */
  listLogPhotos: () => Promise<LogPhotoRow[]>
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
  const [objects, plants, photos, logPhotos] = await Promise.all([
    io.listObjects(),
    io.listPlants(),
    io.listPlantPhotos(),
    io.listLogPhotos(),
  ])
  const report = findOrphans({
    objects,
    plants,
    photos,
    logPhotos,
    now: io.now,
    minAgeMs: antiguedadMinimaHoras * 3600 * 1000,
  })
  io.log(
    `Objetos: ${objects.length}. Plantas: ${plants.length}. Fotos (plant_photos): ${photos.length}. ` +
      `Registros de bitácora con foto: ${logPhotos.length}. En uso: ${report.referenced}.`,
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
    `Plantas o fotos que apuntan a un archivo que no existe: ${report.missing.length}.`,
  )
  for (const missing of report.missing) {
    const photo = missing.photoId
      ? `, foto ${missing.photoId}`
      : missing.logEntryId
        ? `, registro ${missing.logEntryId}`
        : ''
    io.log(
      `  planta ${missing.plantId}${photo}, ${missing.column}: ${missing.path}`,
    )
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
