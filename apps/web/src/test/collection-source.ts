import { act, waitFor } from '@testing-library/react'
import type { CollectionPlant } from '../collection/model.ts'
import type {
  CollectionLoadRequest,
  CollectionSource,
} from '../collection/source.ts'

// Fuente de la colección controlada por la prueba: cada llamada a load() queda
// pendiente hasta que la prueba la resuelve o la rechaza.
//
// Para responder, `await source.respond(plantas)` o `await source.fail(error)`
// (o `(await source.pending()).resolve(plantas)` para hacerlo a mano): esperan
// a que la petición exista, en vez de contar cuántas promesas encadena el código
// antes de hacerla, que se rompe con añadir un solo await en la app (#295). La
// regla de ESLint del proyecto no deja escribir `last().resolve` ni
// `last().reject`. La espera va fuera de act(): dentro, React no pinta hasta
// que act() termina, y una petición que sale de un efecto no llegaría nunca.

export interface PendingLoad {
  request: CollectionLoadRequest
  resolve: (plants: readonly CollectionPlant[]) => void
  reject: (error: unknown) => void
  /** Si ya se resolvió o se rechazó. */
  readonly settled: boolean
}

export interface FakeCollectionSource extends CollectionSource {
  /** Llamadas a load(), en orden. */
  readonly loads: PendingLoad[]
  /** La última llamada; falla si no hubo ninguna. */
  last(): PendingLoad
  /**
   * Espera a que la última llamada sea una sin responder y la devuelve: la
   * primera, o una nueva tras responder a la anterior. Falla si no llega.
   */
  pending(): Promise<PendingLoad>
  /**
   * pending() y la resuelve con "plants" dentro de act(), para que React pinte
   * lo que llega.
   */
  respond(plants: readonly CollectionPlant[]): Promise<void>
  /** pending() y la rechaza con "error" dentro de act(). */
  fail(error: unknown): Promise<void>
}

export function fakeCollectionSource(): FakeCollectionSource {
  const loads: PendingLoad[] = []
  const unanswered = () => {
    const load = loads.at(-1)
    return load !== undefined && !load.settled ? load : undefined
  }
  const source: FakeCollectionSource = {
    loads,
    load(request) {
      return new Promise((resolve, reject) => {
        let settled = false
        loads.push({
          request,
          resolve: (plants) => {
            settled = true
            resolve(plants)
          },
          reject: (error) => {
            settled = true
            // La prueba elige con qué falla, también con algo que no es un
            // Error: la app tiene que tratarlo igual.
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            reject(error)
          },
          get settled() {
            return settled
          },
        })
      })
    },
    last() {
      const load = loads.at(-1)
      if (load === undefined) throw new Error('No se ha pedido la colección.')
      return load
    },
    pending() {
      // Si ya está, sin pasar por waitFor (hay pruebas con temporizadores
      // falsos). waitFor, el de Testing Library, deja que React pinte y
      // ejecute los efectos mientras espera, sin avisos de act().
      const ready = unanswered()
      if (ready !== undefined) return Promise.resolve(ready)
      return waitFor(() => {
        const load = unanswered()
        if (load === undefined)
          throw new Error(
            'No hay ninguna petición de la colección sin responder.',
          )
        return load
      })
    },
    async respond(plants) {
      const load = await source.pending()
      await act(async () => {
        load.resolve(plants)
        await Promise.resolve()
      })
    },
    async fail(error) {
      const load = await source.pending()
      await act(async () => {
        load.reject(error)
        await Promise.resolve()
      })
    },
  }
  return source
}
