// Textos con número de la pantalla de inventario, en singular o plural.

export function plantCountText(count: number): string {
  return count === 1 ? '1 orquídea' : `${count} orquídeas`
}

export function genusCountText(count: number): string {
  return count === 1 ? '1 género' : `${count} géneros`
}
