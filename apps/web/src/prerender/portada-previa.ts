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

// Una pulsación que empieza en la portada prerrenderada y termina en la de la
// app. Al retirarla, el enlace pulsado sale del documento: el navegador ya no
// dispara el clic, porque el botón se soltó sobre otro elemento (el mismo
// enlace, pero el de React), y el clic se perdía. Pasaba de verdad: la app
// sustituye la portada en cuanto llega su chunk, sin mirar si hay un dedo o el
// ratón encima.
//
// seguirPulsacionesEnPortadaPrevia() anota la pulsación sobre un enlace de la
// prerrenderada; quitarPortadaPrevia() busca su equivalente en la de la app
// (mismo destino, mismo texto y mismo orden: las dos salen de PublicHome) y,
// si se suelta sobre él y el navegador no lo pulsa, lo pulsa la app. Si se
// suelta en otro sitio, nada: igual que en un enlace que no cambia.
interface Pulsacion {
  pointerId: number
  enlace: HTMLAnchorElement
  /** El enlace de la app que sustituye al pulsado, ya retirada la portada. */
  sustituto: HTMLAnchorElement | null
}

interface Seguimiento {
  pulsacion: Pulsacion | null
  retirada: boolean
  terminar: () => void
}

const seguimientos = new WeakMap<Document, Seguimiento>()

function enlaceDe(objetivo: EventTarget | null): HTMLAnchorElement | null {
  return objetivo instanceof Element
    ? objetivo.closest<HTMLAnchorElement>('a[href]')
    : null
}

/**
 * En la portada de la app, el enlace que hace de `enlace` (de la
 * prerrenderada `contenedor`): mismo destino y texto, en el mismo orden.
 */
function enlaceEquivalente(
  doc: Document,
  contenedor: Element,
  enlace: Element,
): HTMLAnchorElement | null {
  const igual = (a: Element) =>
    a.getAttribute('href') === enlace.getAttribute('href') &&
    a.textContent === enlace.textContent
  const previos = [...contenedor.querySelectorAll('a[href]')].filter(igual)
  const raiz = doc.getElementById('root')
  if (raiz === null) return null
  const nuevos = [
    ...raiz.querySelectorAll<HTMLAnchorElement>('a[href]'),
  ].filter(igual)
  return nuevos[previos.indexOf(enlace)] ?? null
}

/** Cuánto se espera un clic del navegador que llega tarde, para no repetirlo. */
export const ESPERA_CLIC_TARDIO_MS = 1000

/**
 * Tras soltar sobre `enlace`: con el ratón, el navegador no da el clic (se
 * pulsó otro elemento); con el dedo, unos lo dan (el clic de un toque va a lo
 * que haya debajo al levantarlo) y otros no. Si al terminar la tarea del
 * pointerup no ha llegado, lo da la app; y un clic del navegador que llegue
 * después se descarta, para no navegar dos veces.
 */
function pulsarSiElNavegadorNoLoHace(doc: Document, enlace: HTMLAnchorElement) {
  let pulsado = false
  let propio = false
  const alHacerClic = (clic: Event) => {
    if (propio || !(clic.target instanceof Node)) return
    if (!enlace.contains(clic.target)) return
    if (pulsado) {
      clic.preventDefault()
      clic.stopPropagation()
    }
    pulsado = true
  }
  doc.addEventListener('click', alHacerClic, true)
  setTimeout(() => {
    if (!pulsado && enlace.isConnected) {
      pulsado = true
      propio = true
      enlace.click()
      propio = false
    }
    setTimeout(
      () => doc.removeEventListener('click', alHacerClic, true),
      ESPERA_CLIC_TARDIO_MS,
    )
  }, 0)
}

/**
 * Empieza a anotar las pulsaciones sobre los enlaces de la portada
 * prerrenderada, para que quitarPortadaPrevia() no las pierda. La llama
 * main.tsx al arrancar; sin portada prerrenderada no hace nada.
 */
export function seguirPulsacionesEnPortadaPrevia(
  doc: Document = document,
): void {
  if (seguimientos.has(doc) || doc.getElementById(PORTADA_PREVIA_ID) === null)
    return
  const seguimiento: Seguimiento = {
    pulsacion: null,
    retirada: false,
    terminar,
  }
  seguimientos.set(doc, seguimiento)

  function alPulsar(evento: PointerEvent) {
    const enlace = enlaceDe(evento.target)
    const enLaPrevia =
      evento.isPrimary &&
      evento.button === 0 &&
      enlace !== null &&
      enlace.closest(`#${PORTADA_PREVIA_ID}`) !== null
    seguimiento.pulsacion = enLaPrevia
      ? { pointerId: evento.pointerId, enlace, sustituto: null }
      : null
  }

  function alSoltar(evento: PointerEvent) {
    const pulsacion = seguimiento.pulsacion
    if (pulsacion === null || evento.pointerId !== pulsacion.pointerId) return
    seguimiento.pulsacion = null
    const sustituto = pulsacion.sustituto
    if (
      evento.type === 'pointerup' &&
      sustituto !== null &&
      enlaceDe(evento.target) === sustituto
    ) {
      pulsarSiElNavegadorNoLoHace(doc, sustituto)
    }
    if (seguimiento.retirada) terminar()
  }

  function terminar() {
    seguimientos.delete(doc)
    doc.removeEventListener('pointerdown', alPulsar, true)
    doc.removeEventListener('pointerup', alSoltar, true)
    doc.removeEventListener('pointercancel', alSoltar, true)
  }

  doc.addEventListener('pointerdown', alPulsar, true)
  doc.addEventListener('pointerup', alSoltar, true)
  doc.addEventListener('pointercancel', alSoltar, true)
}

/**
 * Retira la portada prerrenderada, si está. La llaman la app al montar sus
 * rutas (en un efecto de diseño: antes del siguiente pintado, con la portada
 * de la app ya en el documento), la pantalla de fallo y la de configuración
 * inválida.
 *
 * Lo que el usuario tenía entre manos pasa a la portada de la app: el foco,
 * al enlace equivalente, y una pulsación en curso, como se explica arriba.
 */
export function quitarPortadaPrevia(doc: Document = document): void {
  const contenedor = doc.getElementById(PORTADA_PREVIA_ID)
  if (contenedor !== null) {
    const seguimiento = seguimientos.get(doc)
    const pulsacion = seguimiento?.pulsacion ?? null
    if (pulsacion !== null && contenedor.contains(pulsacion.enlace)) {
      pulsacion.sustituto = enlaceEquivalente(doc, contenedor, pulsacion.enlace)
    }
    const enfocado = doc.activeElement
    const conFoco =
      enfocado !== null && contenedor.contains(enfocado)
        ? enlaceEquivalente(doc, contenedor, enfocado)
        : null
    contenedor.remove()
    conFoco?.focus({ preventScroll: true })
    if (seguimiento !== undefined) {
      seguimiento.retirada = true
      if (seguimiento.pulsacion === null) seguimiento.terminar()
    }
  }
  doc.documentElement.removeAttribute(ATRIBUTO_PORTADA_PREVIA)
}
