import path from 'node:path'
import { runnerImport, type Plugin } from 'vite'

// Portada prerrenderada en index.html (#204; el porqué y cómo se muestra, en
// src/prerender/portada-previa.ts y docs/medicion-de-carga.md).
//
// Solo en el build. Al transformar index.html, cuando el bundle ya tiene los
// archivos con su hash, ejecuta src/prerender/render.tsx con el ejecutor de
// módulos de Vite (react-dom/server, sin navegador) y mete:
// - en el <head>, tras la etiqueta meta viewport, el script que decide si se
//   muestra y precarga la foto;
// - tras #root, la plantilla con el HTML de la portada y el script que la
//   copia.
//
// El ejecutor da a los archivos importados su dirección del código fuente
// (/src/assets/portada/portada-960.avif); aquí se cambia por la del build
// (/assets/portada-960-<hash>.avif). Si queda alguna sin cambiar, el build
// falla: la portada prerrenderada pediría un archivo que no existe.
//
// Va antes que el plugin de PWA, que calcula la revisión de index.html para
// el precaché con el HTML ya completo.

interface PortadaRenderizada {
  cabecera: string
  cuerpo: string
}

const ENTRADA = 'src/prerender/render.tsx'
const RAIZ_DE_LA_APP = '<div id="root"></div>'
// El script del <head> va justo después de la etiqueta meta viewport: antes,
// el navegador calcula `sizes` con el ancho por defecto (980 px) y precargaría
// una variante mayor que la que elige el <img>. Y antes de los estilos, que
// bloquearían su ejecución.
const VIEWPORT = /<meta\s+name="viewport"[^>]*>/

export function portadaPrevia(): Plugin {
  let raiz = ''
  let base = '/'
  return {
    name: 'orki-portada-previa',
    apply: 'build',
    configResolved(config) {
      raiz = config.root
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html, contexto) {
        const bundle = contexto.bundle
        if (bundle === undefined) return html
        if (!html.includes(RAIZ_DE_LA_APP) || !VIEWPORT.test(html)) {
          throw new Error(
            `index.html tiene que tener ${RAIZ_DE_LA_APP} y la etiqueta meta viewport`,
          )
        }

        const { module } = await runnerImport<{
          renderizarPortada: () => PortadaRenderizada
        }>(path.join(raiz, ENTRADA), {
          configFile: false,
          root: raiz,
          logLevel: 'error',
        })
        const portada = module.renderizarPortada()

        // Dirección en el código fuente → dirección en el build.
        const direcciones = new Map<string, string>()
        for (const salida of Object.values(bundle)) {
          if (salida.type !== 'asset') continue
          for (const original of salida.originalFileNames) {
            const relativa = path.isAbsolute(original)
              ? path.relative(raiz, original)
              : original
            direcciones.set(`/${relativa}`, `${base}${salida.fileName}`)
          }
        }
        const cambiar = (texto: string) =>
          texto.replace(/\/src\/[^"'\s?,)]+(\?[^"'\s,)]*)?/g, (fuente) => {
            const sinConsulta = fuente.split('?')[0] ?? fuente
            const destino = direcciones.get(sinConsulta)
            if (destino === undefined) {
              throw new Error(
                `Portada prerrenderada: ${sinConsulta} no está en el build`,
              )
            }
            return destino
          })

        return html
          .replace(
            VIEWPORT,
            (meta) =>
              `${meta}\n    <script>${cambiar(portada.cabecera)}</script>`,
          )
          .replace(
            RAIZ_DE_LA_APP,
            `${RAIZ_DE_LA_APP}${cambiar(portada.cuerpo)}`,
          )
      },
    },
  }
}
