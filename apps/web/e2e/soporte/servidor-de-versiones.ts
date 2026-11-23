import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Servidor de las pruebas de la actualización (#278): sirve el build A o el
// B (npm run build:e2e) en el mismo origen y cambia de uno a otro cuando la
// prueba lo pide, como un despliegue. Responde como Vercel (vercel.json): los
// archivos que existen tal cual, lo que falta en assets/ o workbox- con un
// 404 (lo que ve el código viejo cuando pide un chunk que ya no está) y
// cualquier otra ruta con index.html. Sin compresión: no se mide nada.

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../dist-medicion',
)

export const VERSIONES = {
  a: path.join(DIST, 'e2e'),
  b: path.join(DIST, 'e2e-b'),
} as const

export type Version = keyof typeof VERSIONES

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
}

/** Sin reescritura a index.html (vercel.json): assets/ y workbox-. */
const SIN_REESCRITURA = /^\/(assets\/|workbox-)/

async function esArchivo(ruta: string): Promise<boolean> {
  try {
    return (await stat(ruta)).isFile()
  } catch {
    return false
  }
}

export interface ServidorDeVersiones {
  url: string
  /** Pasa a servir la otra versión, como un despliegue. */
  desplegar: (version: Version) => void
  /** Rutas de assets/ y workbox- pedidas que no existían (404). */
  noEncontrados: string[]
  cerrar: () => Promise<void>
}

export async function servirVersiones(
  inicial: Version,
): Promise<ServidorDeVersiones> {
  let carpeta: string = VERSIONES[inicial]
  const noEncontrados: string[] = []

  const servidor = createServer((peticion, respuesta) => {
    void (async () => {
      const ruta = decodeURIComponent(
        new URL(peticion.url ?? '/', 'http://localhost').pathname,
      )
      let archivo = path.join(carpeta, path.normalize(ruta))
      if (!archivo.startsWith(carpeta)) {
        respuesta.writeHead(400).end()
        return
      }
      if (ruta === '/' || !(await esArchivo(archivo))) {
        if (SIN_REESCRITURA.test(ruta)) {
          noEncontrados.push(ruta)
          respuesta.writeHead(404, { 'Cache-Control': 'no-cache' }).end()
          return
        }
        archivo = path.join(carpeta, 'index.html')
      }
      const cuerpo = await readFile(archivo)
      respuesta.writeHead(200, {
        'Content-Type':
          TIPOS[path.extname(archivo)] ?? 'application/octet-stream',
        'Content-Length': cuerpo.length,
        // Como en Vercel para el HTML y el service worker; a los assets les
        // da igual (su nombre cambia con el contenido).
        'Cache-Control': 'no-cache',
      })
      respuesta.end(peticion.method === 'HEAD' ? undefined : cuerpo)
    })()
  })

  await new Promise<void>((resolver) =>
    servidor.listen(0, '127.0.0.1', resolver),
  )
  const { port } = servidor.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    desplegar: (version) => {
      carpeta = VERSIONES[version]
    },
    noEncontrados,
    cerrar: () =>
      new Promise((resolver) => {
        servidor.closeAllConnections()
        servidor.close(() => resolver())
      }),
  }
}
