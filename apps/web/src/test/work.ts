import { vi } from 'vitest'

/**
 * El trabajo de una operación sobre una lista, sin reloj (#311): cuenta cada
 * lectura de un elemento de la lista o de una propiedad de un elemento, y cada
 * consulta a las cachés por elemento (WeakMap.get). Con la máquina cargada el
 * tiempo cambia y esto no; una regresión de complejidad (un bucle dentro de
 * otro, normalizar en cada comparación) lo hace crecer más que la lista.
 *
 * `warm` se ejecuta antes sin contar, para medir la operación con las cachés
 * ya llenas. Devuelve las lecturas (`fields`) y el total con las consultas a
 * las cachés.
 */
export function countWork<T extends object>(
  items: readonly T[],
  run: (items: readonly T[]) => unknown,
  { warm }: { warm?: (items: readonly T[]) => unknown } = {},
): { fields: number; total: number } {
  let fields = 0
  const counting = <U extends object>(target: U): U =>
    new Proxy(target, {
      get(object, key, receiver) {
        fields += 1
        return Reflect.get(object, key, receiver) as unknown
      },
    })
  const list = counting(items.map(counting))
  warm?.(list)
  fields = 0
  const lookups = vi.spyOn(WeakMap.prototype, 'get')
  try {
    run(list)
    return { fields, total: fields + lookups.mock.calls.length }
  } finally {
    lookups.mockRestore()
  }
}
