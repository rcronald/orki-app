// Recuento de peticiones y de viajes de ida y vuelta (#285), sobre los dobles
// en memoria de las filas, del bucket y de la planta.
//
// Cada llamada envuelta cuenta como una petición (en la app, cada una es una
// petición HTTP del cliente de Supabase). Los viajes se cuentan con un reloj lógico:
// una petición empieza en el instante en que se llama y termina un instante
// después; el reloj avanza al terminar. Las que salen a la vez (sin esperar a
// otra) empiezan en el mismo instante y cuentan un solo viaje; las que
// esperan a otra empiezan cuando esa terminó. El número de viajes es el
// instante en que terminó la última: la latencia que se notaría con la misma
// ida y vuelta para todas, sin contar los bytes. Cada respuesta se entrega en
// una tarea aparte (setTimeout 0), para que todo lo que sale a la vez salga
// antes de que llegue ninguna respuesta, como en la red.

export interface TrackedRequest {
  name: string
  /** Instante (viaje) en que salió, desde 0. */
  start: number
}

export interface TripCounter {
  readonly requests: TrackedRequest[]
  /** Viajes en serie: cuándo terminó la última petición. */
  trips(): number
  /** Peticiones con ese nombre (o que empiezan por él, con «*» al final). */
  count(name: string): number
  /** Empieza de cero (para medir solo una parte). */
  reset(): void
  /** Envuelve una función que hace una petición. */
  track<A extends unknown[], R>(
    name: string,
    fn: (...args: A) => Promise<R>,
  ): (...args: A) => Promise<R>
  /**
   * Una copia del objeto con sus métodos envueltos (nombre «prefijo.método»).
   * Solo los nombrados; el resto se copia tal cual.
   */
  wrap<T extends object>(target: T, prefix: string, methods: (keyof T)[]): T
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export function createTripCounter(): TripCounter {
  let now = 0
  let requests: TrackedRequest[] = []

  const counter: TripCounter = {
    get requests() {
      return requests
    },
    trips: () => now,
    count: (name) =>
      requests.filter((request) =>
        name.endsWith('*')
          ? request.name.startsWith(name.slice(0, -1))
          : request.name === name,
      ).length,
    reset() {
      now = 0
      requests = []
    },
    track(name, fn) {
      return async (...args) => {
        const start = now
        requests.push({ name, start })
        try {
          return await fn(...args)
        } finally {
          await nextTask()
          now = Math.max(now, start + 1)
        }
      }
    },
    wrap<T extends object>(target: T, prefix: string, methods: (keyof T)[]) {
      const copy = Object.create(target) as Record<string | symbol, unknown>
      for (const method of methods) {
        const original = (target as Record<string | symbol, unknown>)[
          method as string
        ]
        if (typeof original !== 'function') continue
        copy[method as string] = counter.track(
          `${prefix}.${String(method)}`,
          (...args: unknown[]) =>
            (original as (...a: unknown[]) => Promise<unknown>).apply(
              target,
              args,
            ),
        )
      }
      return copy as T
    },
  }
  return counter
}
