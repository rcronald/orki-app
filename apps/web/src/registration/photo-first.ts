import { PATHS } from '../routes/paths.ts'

// Entrada al registro "desde la cámara" (#87): la misma pantalla y el mismo
// formulario, con el campo de foto arriba del todo, en
// /coleccion/nueva?foto=1. No se abre la cámara sola al llegar: los
// navegadores solo abren el selector de archivos o la cámara como respuesta
// directa a un toque, así que el primer toque en la pantalla es el de "Tomar
// foto". Va aparte de paths.ts para no sumar nada al chunk inicial.

export const PHOTO_FIRST_PARAM = 'foto'

/** Dirección del registro que empieza por la foto. */
export const PHOTO_FIRST_PATH = `${PATHS.newPlant}?${PHOTO_FIRST_PARAM}=1`

/** ¿Pide la dirección empezar por la foto? */
export function isPhotoFirst(search: URLSearchParams): boolean {
  return search.get(PHOTO_FIRST_PARAM) === '1'
}
