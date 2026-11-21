import type { CollectionPlant } from '../collection/model.ts'

// Aviso de duplicado (#88): cuántos ejemplares activos de una especie tiene ya
// el usuario. Se cuenta sobre la colección en memoria, que la pantalla de
// registro ya carga para sumar la planta nueva al guardar; no hay consulta
// propia. Las dadas de baja (perdidas o regaladas) no cuentan, y solo cuentan
// las plantas enlazadas a esa especie: un nombre por validar igual al de la
// especie no se da por el mismo ejemplar.

/** Ejemplares activos de `speciesId` entre las plantas del usuario. */
export function countActiveSpecimens(
  plants: readonly CollectionPlant[],
  speciesId: string,
): number {
  let count = 0
  for (const plant of plants) {
    if (plant.status === 'active' && plant.species?.id === speciesId) {
      count += 1
    }
  }
  return count
}
