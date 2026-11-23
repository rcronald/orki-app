/**
 * Nombre accesible de la foto `index` (desde 0) de `total` en la galería
 * (#220): «Foto principal» la primera, «Foto 2 de 3» las demás.
 */
export function galleryPhotoLabel(index: number, total: number): string {
  return index === 0
    ? 'Foto principal'
    : `Foto ${String(index + 1)} de ${String(total)}`
}
