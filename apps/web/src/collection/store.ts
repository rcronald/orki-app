import type { CollectionPlant } from './model.ts'
import {
  collectionErrorFrom,
  type CollectionLoadError,
  type CollectionSource,
} from './source.ts'

// Almacén de la colección en memoria (issue #93), sin React: lo envuelven
// CollectionProvider y useCollection().
//
// - Una colección por usuario: setUser() fija el usuario activo. Si cambia (o
//   se cierra la sesión, null), aborta la lectura en curso, descarta los datos
//   y vuelve a "idle". Cada lectura lleva un número de generación: la
//   respuesta de una lectura que ya no es la actual (de otro usuario o
//   anterior a una recarga) se ignora aunque la fuente no atienda el aborto.
// - Carga bajo demanda: no se lee nada hasta que alguien la necesita. Cada
//   pantalla que usa la colección la "retiene" mientras está montada
//   (retain()); con el usuario fijado, la primera retención lanza la lectura.
//   Las siguientes, en esta u otra pantalla, reutilizan la misma lectura o los
//   datos ya cargados. Soltarla no aborta ni descarta nada: los datos siguen en
//   memoria para la próxima pantalla. Así el doble montaje de React.StrictMode
//   no lanza una segunda petición.
// - Tras un error, no se reintenta solo: reload() lo hace (el botón de
//   "Reintentar"). Una pantalla nueva que se monta tampoco lo reintenta.
// - Actualización en segundo plano (refresh(), #141): con la colección ya
//   cargada, la vuelve a leer sin pasar por "loading" (las pantallas siguen
//   con lo de antes, sin parpadeos ni perder la búsqueda o la posición) y
//   cambia los datos cuando llegan. Si falla, no se muestra ningún error: se
//   sigue con lo que había. La usa CollectionProvider al volver a la app tras
//   un rato en segundo plano, para ver lo que cambió fuera de este dispositivo
//   (por ejemplo, una propuesta que resolvió un administrador), y al
//   recuperar la conexión o confirmarse la sesión (resume(), #18).
// - Operaciones locales (upsertPlant, removePlant): reflejan en memoria lo que
//   otra pantalla ya escribió en la base (#11, #16) sin volver a leerlo todo.
//   Se aplican al momento sobre los datos que haya en memoria; durante una
//   lectura (también la de segundo plano), además, se guardan y se aplican
//   sobre su resultado, porque la respuesta puede haber salido antes o
//   después de la escritura. Sin datos ni
//   lectura en curso se ignoran: la próxima lectura ya traerá el cambio.
//   Con la colección completa, el resultado se pasa además a source.save()
//   (si la fuente lo tiene) para que la copia local del #18 lo guarde.

/**
 * Tiempo en segundo plano a partir del cual, al volver a la app, la colección
 * se vuelve a leer (#141, ver CollectionProvider). Menos que eso (cambiar un
 * momento de aplicación) no merece una petición.
 */
export const COLLECTION_REFRESH_AFTER_MS = 2 * 60 * 1000

export type CollectionStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Estado de la colección del usuario activo. */
export interface CollectionSnapshot {
  /** Usuario al que pertenecen estos datos; null sin sesión. */
  userId: string | null
  /**
   * - idle: aún no se ha pedido (o no hay usuario).
   * - loading: lectura en curso. Si ya había datos (recarga) o la fuente
   *   entregó un resultado provisional, `plants` los trae mientras tanto.
   * - ready: `plants` es la colección completa.
   * - error: falló la última lectura; `plants` conserva los datos anteriores
   *   si los había (recarga fallida) o es null.
   */
  status: CollectionStatus
  /** Todas las plantas del usuario, también las dadas de baja; null si no hay datos. */
  plants: readonly CollectionPlant[] | null
  /** Error de la última lectura, con su motivo; null si no falló. */
  error: CollectionLoadError | null
}

type LocalOperation =
  { kind: 'upsert'; plant: CollectionPlant } | { kind: 'remove'; id: string }

const EMPTY: CollectionSnapshot = {
  userId: null,
  status: 'idle',
  plants: null,
  error: null,
}

export class CollectionStore {
  private readonly source: CollectionSource
  private snapshot: CollectionSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()
  private retainers = 0
  private generation = 0
  private controller: AbortController | null = null
  /** Operaciones locales recibidas durante la lectura en curso. */
  private pending: LocalOperation[] = []

  constructor(source: CollectionSource) {
    this.source = source
  }

  // Suscripción (para useSyncExternalStore) -----------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): CollectionSnapshot => this.snapshot

  // Usuario y demanda ---------------------------------------------------------

  /** Fija el usuario activo. Con otro usuario o null, descarta lo anterior. */
  setUser(userId: string | null): void {
    if (userId === this.snapshot.userId) return
    this.cancel()
    this.update({ ...EMPTY, userId })
    this.loadIfNeeded()
  }

  /**
   * Marca que una pantalla necesita la colección; la carga si aún no se pidió.
   * Devuelve la función que suelta esa retención.
   */
  retain(): () => void {
    this.retainers += 1
    this.loadIfNeeded()
    let released = false
    return () => {
      if (released) return
      released = true
      this.retainers -= 1
    }
  }

  /** Vuelve a leer la colección del usuario activo, aunque ya esté cargada. */
  reload(): void {
    if (this.snapshot.userId === null) return
    this.cancel()
    this.start(this.snapshot.userId)
  }

  /**
   * Vuelve a leer en segundo plano la colección ya cargada (ver arriba). Sin
   * datos listos (aún no se pidió, se está leyendo o falló) no hace nada.
   */
  refresh(): void {
    const { userId, status } = this.snapshot
    if (userId === null || status !== 'ready') return
    this.cancel()
    this.start(userId, true)
  }

  /**
   * Al recuperar la conexión (#18): con la colección lista, la actualiza en
   * segundo plano (refresh); si la última lectura falló, la vuelve a leer
   * (reload: la pantalla pasa del error a la carga). Sin pedir o con una
   * lectura en curso, nada.
   */
  resume(): void {
    const { userId, status } = this.snapshot
    if (userId === null) return
    if (status === 'ready') this.refresh()
    else if (status === 'error') this.reload()
  }

  // Operaciones locales -------------------------------------------------------

  /** Añade una planta nueva o sustituye la que tiene su id. */
  upsertPlant(plant: CollectionPlant): void {
    this.apply({ kind: 'upsert', plant })
  }

  /** Quita una planta borrada de la base. */
  removePlant(id: string): void {
    this.apply({ kind: 'remove', id })
  }

  // Internos ------------------------------------------------------------------

  private loadIfNeeded(): void {
    const { userId, status } = this.snapshot
    if (userId !== null && status === 'idle' && this.retainers > 0) {
      this.start(userId)
    }
  }

  private start(userId: string, background = false): void {
    const generation = ++this.generation
    const controller = new AbortController()
    this.controller = controller
    this.pending = []
    if (!background) {
      this.update({ ...this.snapshot, status: 'loading', error: null })
    }

    const isCurrent = () => generation === this.generation

    this.source
      .load({
        userId,
        signal: controller.signal,
        provide: (plants) => {
          if (!isCurrent()) return
          this.update({
            ...this.snapshot,
            plants: applyAll(plants, this.pending),
          })
        },
      })
      .then(
        (plants) => {
          if (!isCurrent()) return
          this.controller = null
          const changed = this.pending.length > 0
          const result = applyAll(plants, this.pending)
          this.update({
            userId,
            status: 'ready',
            plants: result,
            error: null,
          })
          this.pending = []
          // La fuente guardó lo que leyó; los cambios hechos mientras tanto
          // también deben quedar en su copia.
          if (changed) this.source.save?.(userId, result)
        },
        (error: unknown) => {
          if (!isCurrent()) return
          this.controller = null
          this.pending = []
          // En segundo plano, un fallo no cambia nada: siguen los datos de
          // antes (con las operaciones locales ya aplicadas).
          if (background) return
          this.update({
            ...this.snapshot,
            status: 'error',
            error: collectionErrorFrom(error),
          })
        },
      )
  }

  /** Aborta la lectura en curso y hace que su respuesta se ignore. */
  private cancel(): void {
    this.generation += 1
    this.controller?.abort()
    this.controller = null
    this.pending = []
  }

  private apply(operation: LocalOperation): void {
    const { status, plants, userId } = this.snapshot
    if (this.controller !== null) this.pending.push(operation)
    if (plants === null) return
    const result = applyAll(plants, [operation])
    this.update({ ...this.snapshot, plants: result })
    // Solo con la colección completa (también durante una lectura de fondo,
    // que la vuelve a guardar al terminar). Durante una lectura con carga se
    // guarda al terminar, y tras un error lo que hay en memoria puede estar
    // incompleto.
    if (status === 'ready' && userId !== null) {
      this.source.save?.(userId, result)
    }
  }

  private update(next: CollectionSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

function applyAll(
  plants: readonly CollectionPlant[],
  operations: readonly LocalOperation[],
): readonly CollectionPlant[] {
  let result = plants
  for (const operation of operations) {
    if (operation.kind === 'upsert') {
      const index = result.findIndex((plant) => plant.id === operation.plant.id)
      result =
        index === -1
          ? [...result, operation.plant]
          : result.with(index, operation.plant)
    } else {
      result = result.filter((plant) => plant.id !== operation.id)
    }
  }
  return result
}
