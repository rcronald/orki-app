import { matchPath } from 'react-router'
import { PATHS } from '../routes/paths.ts'

// Pantallas donde la persona escribe algo que todavía no está guardado (#278):
// el registro (con borrador, pero sin las fotos), la edición (con el aviso de
// cambios sin guardar), la ficha (las notas se editan en la misma pantalla),
// el backoffice del catálogo y las pantallas de acceso de Clerk. En ellas no
// se recarga la página por una versión nueva: ni aparece el aviso
// «Hay una versión nueva», ni se recarga sola cuando otra pestaña la acepta,
// ni la red de seguridad recarga por un chunk que no llega fuera del pintado.
// Se decide por la ruta y no por el estado de cada formulario para no
// depender de los módulos de cada pantalla.

const CON_SUBRUTAS = [PATHS.catalogAdmin, PATHS.signIn, PATHS.signUp]

const EXACTAS = [PATHS.newPlant, PATHS.plantDetail, PATHS.editPlant]

export function esPantallaDeTrabajo(pathname: string): boolean {
  return (
    EXACTAS.some((path) => matchPath(path, pathname) !== null) ||
    CON_SUBRUTAS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  )
}
