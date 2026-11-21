import type { SessionTokenFailure } from '../lib/supabase.ts'
import type { CollectionPlant } from './model.ts'

// Fuente de datos de la colección: de dónde sale la lista completa de plantas
// de un usuario. El almacén (store.ts) no sabe de Supabase: recibe una fuente
// por inyección (prop `source` de <CollectionProvider>). La de la app es
// supabaseCollectionSource (supabase-source.ts); la caché local del #18 podrá
// envolverla (leer primero la copia del dispositivo, entregarla como
// provisional y después la de la red) sin tocar el almacén ni las pantallas.

/**
 * Por qué no se pudo leer la colección. Los mismos motivos que los del token
 * de sesión (lib/supabase.ts):
 * - offline: sin conexión (o la red falló antes de llegar a Supabase).
 * - session-ended: la sesión terminó o Supabase no la acepta.
 * - failed: cualquier otro fallo.
 */
export type CollectionErrorReason = SessionTokenFailure

/** Textos para mostrar en pantalla, uno por motivo. */
export const COLLECTION_ERROR_TEXT: Record<CollectionErrorReason, string> = {
  offline: 'Sin conexión: no se pudo cargar tu colección.',
  'session-ended':
    'Tu sesión terminó. Vuelve a iniciar sesión para ver tu colección.',
  failed: 'No se pudo cargar tu colección. Vuelve a intentarlo.',
}

/** Error al leer la colección, con su motivo. */
export class CollectionLoadError extends Error {
  readonly reason: CollectionErrorReason

  constructor(reason: CollectionErrorReason, options?: { cause?: unknown }) {
    super(COLLECTION_ERROR_TEXT[reason], options)
    this.name = 'CollectionLoadError'
    this.reason = reason
  }
}

/** Lo que recibe una fuente al pedirle la colección. */
export interface CollectionLoadRequest {
  /** Usuario cuya colección se pide (id de Clerk). */
  userId: string
  /**
   * Se aborta cuando el resultado ya no interesa (cambio de usuario, recarga).
   * La fuente debería cancelar sus peticiones; si aun así responde, el
   * almacén descarta la respuesta.
   */
  signal: AbortSignal
  /**
   * Entrega un resultado provisional antes del definitivo, por ejemplo la
   * copia local de la caché (#18) mientras llega la de la red. Opcional: una
   * fuente que solo tiene un resultado no la llama.
   */
  provide: (plants: readonly CollectionPlant[]) => void
}

/**
 * Fuente de la colección. load() devuelve todas las plantas del usuario (también
 * las dadas de baja), en un orden estable. Si falla, debería rechazar con un
 * CollectionLoadError; cualquier otro error se trata como 'failed'.
 */
export interface CollectionSource {
  load(request: CollectionLoadRequest): Promise<readonly CollectionPlant[]>
}

/** Motivo de un error cualquiera devuelto por una fuente. */
export function collectionErrorFrom(error: unknown): CollectionLoadError {
  if (error instanceof CollectionLoadError) return error
  return new CollectionLoadError('failed', { cause: error })
}
