// Tareas con un tope de las que van a la vez (#285): las subidas de fotos van
// de tres en tres (cada una con su foto y su miniatura), y las escrituras de
// las filas de una planta, de una en una (ver gallery.ts y edit-plan.ts).

/** Fotos que se suben a la vez, como mucho (seis archivos). */
export const MAX_PARALLEL_PHOTO_UPLOADS = 3

/**
 * Llama a `worker` con cada elemento, como mucho `limit` a la vez y en orden
 * de salida: el siguiente empieza cuando termina uno. `worker` no debe
 * rechazar (si rechaza, el resto sigue y este rechazo se pierde).
 */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      try {
        await worker(items[index], index)
      } catch {
        // Lo trata worker.
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => lane()),
  )
}

/** Una cola: cada tarea empieza cuando terminó la anterior. */
export function serialQueue(): <R>(task: () => Promise<R>) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve()
  return <R>(task: () => Promise<R>) => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}
