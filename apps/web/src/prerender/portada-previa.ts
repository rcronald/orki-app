// Portada prerrenderada (#204). El build mete en index.html el HTML de la
// portada (PublicHome, renderizado con react-dom/server por
// prerender/portada-previa-plugin.ts) dentro de un <template>, y dos scripts
// en línea:
//
// 1. En el <head>, antes de los estilos: decide si se muestra. Solo en `/`,
//    sin usuario recordado en este dispositivo y sin el aviso de cuenta
//    eliminada en el historial: los mismos casos en que HomeRoute pinta la
//    portada mientras Clerk carga. Si se muestra, marca <html> y añade la
//    precarga de la foto (la misma variante que elegirá el <img>), así se
//    pide a la vez que el CSS y el JavaScript.
// 2. Tras #root: si <html> está marcado, copia la plantilla a un contenedor
//    antes de #root. El navegador no ejecuta este script hasta tener la hoja
//    de estilos, así que la portada nunca se ve sin estilos.
//
// La portada se ve así sin esperar al JavaScript de la app ni a Clerk. Cuando
// la app monta sus rutas, quitarPortadaPrevia() la retira en la misma
// confirmación en que React pinta la suya (AppRouter), antes del siguiente
// pintado: el cambio no se ve ni mueve nada. En cualquier otra ruta, con
// usuario recordado o tras eliminar la cuenta, la plantilla no se usa y la
// foto no se descarga.

/** Contenedor de la portada prerrenderada, hermano anterior de #root. */
export const PORTADA_PREVIA_ID = 'portada-previa'
/** Plantilla con el HTML de la portada, tras #root. */
export const PLANTILLA_PORTADA_PREVIA_ID = 'portada-previa-plantilla'
/** Atributo de <html> que dice que la portada prerrenderada se muestra. */
export const ATRIBUTO_PORTADA_PREVIA = 'data-portada-previa'

/**
 * Retira la portada prerrenderada, si está. La llaman la app al montar sus
 * rutas (en un efecto de diseño: antes del siguiente pintado), la pantalla de
 * fallo y la de configuración inválida.
 */
export function quitarPortadaPrevia(doc: Document = document): void {
  doc.getElementById(PORTADA_PREVIA_ID)?.remove()
  doc.documentElement.removeAttribute(ATRIBUTO_PORTADA_PREVIA)
}
