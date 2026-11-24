import { act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

// Escribir en un buscador con espera entre pulsaciones sin depender del
// equipo (#311). Con el reloj real, una pulsación que tarda más que la espera
// (250 ms) en un equipo cargado deja salir una búsqueda a medias, y la prueba
// que cuenta las peticiones falla aunque la app esté bien. Con el reloj parado,
// entre pulsaciones no pasa el tiempo: lo que se prueba es que la búsqueda
// sale cuando se deja de escribir, y la prueba decide cuándo es eso.
//
// Uso: typeWithClockStopped(...), comprobar si hace falta que aún no se
// buscó con advanceClock(espera - 1), y finishWait(lo que falte) para que
// salga la búsqueda y volver al reloj real antes de esperar respuestas con
// findBy… o waitFor. Cada archivo vuelve también al reloj real en su
// afterEach. Al volver se pierden los temporizadores falsos pendientes: la
// prueba debe dejar pasar antes lo que espera que ocurra.

type User = ReturnType<typeof userEvent.setup>

/**
 * Pone los temporizadores falsos y hace `action` con un user-event que no
 * avanza el reloj entre pulsaciones. Al volver, siguen falsos.
 */
export async function withClockStopped(
  action: (user: User) => Promise<void>,
): Promise<void> {
  if (!vi.isFakeTimers()) vi.useFakeTimers()
  const user = userEvent.setup({
    advanceTimers: (ms) => vi.advanceTimersByTime(ms),
  })
  // Testing Library, al terminar cada acción de user-event, espera un
  // setTimeout de 0 ms y solo lo adelanta si ve temporizadores falsos de
  // Jest: con los de Vitest se quedaría esperando para siempre. Adelantar
  // 0 ms no dispara la espera del buscador.
  const global = globalThis as { jest?: unknown }
  global.jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  }
  try {
    await action(user)
  } finally {
    delete global.jest
  }
  // Con el reloj parado no corre ninguna tarea entre pulsaciones, así que
  // los efectos de React de la última siguen pendientes; act() los aplica
  // ahora, para que la espera del buscador empiece al terminar de escribir.
  await act(() => Promise.resolve())
}

/** Escribe `text` en `element` con el reloj parado (ver withClockStopped). */
export function typeWithClockStopped(
  element: Element,
  text: string,
): Promise<void> {
  return withClockStopped((user) => user.type(element, text))
}

/** Avanza el reloj falso `ms` milisegundos, con lo que eso pinte. */
export async function advanceClock(ms: number): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

/**
 * Avanza el reloj falso `ms` milisegundos y vuelve al reloj real. Antes deja
 * correr los temporizadores inmediatos que haya puesto lo que la espera
 * desencadenó (una fuente simulada que responde con setTimeout(0), por
 * ejemplo): al volver al reloj real se perderían. El reloj falso cuenta un
 * setTimeout(0) puesto desde otro temporizador como de 1 ms, así que se avanza
 * de milisegundo en milisegundo.
 */
export async function finishWait(ms: number): Promise<void> {
  await advanceClock(ms)
  for (let round = 0; round < 3; round += 1) await advanceClock(1)
  vi.useRealTimers()
}
