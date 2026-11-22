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

/** Lo más que la app espera a la foto de la portada prerrenderada. */
export const ESPERA_MAXIMA_FOTO_MS = 2000

/**
 * Se resuelve cuando la foto de la portada prerrenderada ya se pintó (cargada,
 * o fallida: sin conexión no está en el precaché), o a los
 * ESPERA_MAXIMA_FOTO_MS. Sin portada prerrenderada, enseguida.
 *
 * La app espera a esto antes de pedir su chunk (AppRouter): así la foto, el
 * elemento más grande de la primera pantalla, no comparte la red con el
 * JavaScript de la app ni con el script de Clerk, que no hacen falta para
 * verla. Los botones de la portada prerrenderada son enlaces normales:
 * funcionan también antes de que llegue la app, con una carga de página.
 */
export function esperarFotoDePortadaPrevia(
  doc: Document = document,
  esperaMaxima = ESPERA_MAXIMA_FOTO_MS,
): Promise<void> {
  const foto = doc.querySelector<HTMLImageElement>(
    `#${PORTADA_PREVIA_ID} img.orki-hero__photo`,
  )
  if (foto === null) return Promise.resolve()
  return new Promise((resolve) => {
    let observador: PerformanceObserver | null = null
    const limite = setTimeout(terminar, esperaMaxima)
    function terminar() {
      clearTimeout(limite)
      observador?.disconnect()
      resolve()
    }
    // Tras el fotograma que ya la muestra; descargada no basta: el AVIF se
    // decodifica aparte y se pinta después.
    //
    // Donde el navegador informa del LCP (Chromium), se espera a la entrada
    // de la foto: llega cuando el fotograma ya se presentó. Si la foto falla
    // o el navegador no lo informa (Safari, Firefox), se espera a que esté
    // decodificada y a un fotograma (requestAnimationFrame corre antes de
    // pintarlo; el setTimeout, después).
    const pintada = () => {
      requestAnimationFrame(() => setTimeout(terminar, 0))
    }
    foto.addEventListener('error', pintada, { once: true })
    const observaLcp =
      typeof PerformanceObserver !== 'undefined' &&
      (PerformanceObserver.supportedEntryTypes ?? []).includes(
        'largest-contentful-paint',
      )
    if (observaLcp) {
      observador = new PerformanceObserver((lista) => {
        const entradas = lista.getEntries() as (PerformanceEntry & {
          element?: Element | null
        })[]
        if (entradas.some((entrada) => entrada.element === foto)) terminar()
      })
      observador.observe({ type: 'largest-contentful-paint', buffered: true })
    }
    const descargada = () => {
      // Con el LCP informado, la entrada manda; si la foto no llega a ser el
      // LCP (otro elemento mayor en una pantalla rara), como mucho medio
      // segundo tras decodificarla.
      const despues = observaLcp ? () => setTimeout(terminar, 500) : pintada
      if (typeof foto.decode === 'function')
        foto.decode().then(despues, despues)
      else despues()
    }
    if (foto.complete) descargada()
    else foto.addEventListener('load', descargada, { once: true })
  })
}

/**
 * Retira la portada prerrenderada, si está. La llaman la app al montar sus
 * rutas (en un efecto de diseño: antes del siguiente pintado), la pantalla de
 * fallo y la de configuración inválida.
 */
export function quitarPortadaPrevia(doc: Document = document): void {
  doc.getElementById(PORTADA_PREVIA_ID)?.remove()
  doc.documentElement.removeAttribute(ATRIBUTO_PORTADA_PREVIA)
}
