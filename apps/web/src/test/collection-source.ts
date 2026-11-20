import type { CollectionPlant } from '../collection/model.ts'
import type {
  CollectionLoadRequest,
  CollectionSource,
} from '../collection/source.ts'

// Fuente de la colección controlada por la prueba: cada llamada a load() queda
// pendiente hasta que la prueba la resuelve o la rechaza.

export interface PendingLoad {
  request: CollectionLoadRequest
  resolve: (plants: readonly CollectionPlant[]) => void
  reject: (error: unknown) => void
}

export interface FakeCollectionSource extends CollectionSource {
  /** Llamadas a load(), en orden. */
  readonly loads: PendingLoad[]
  /** La última llamada; falla si no hubo ninguna. */
  last(): PendingLoad
}

export function fakeCollectionSource(): FakeCollectionSource {
  const loads: PendingLoad[] = []
  return {
    loads,
    load(request) {
      return new Promise((resolve, reject) => {
        loads.push({ request, resolve, reject })
      })
    },
    last() {
      const load = loads.at(-1)
      if (load === undefined) throw new Error('No se ha pedido la colección.')
      return load
    },
  }
}
