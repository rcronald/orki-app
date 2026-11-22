// Servidor estático mínimo para medir la carga (#149), sin dependencias.
//
// Se usa en lugar de `vite preview` porque este no comprime: Lighthouse
// calcula la descarga con los bytes que de verdad viajan, y sin compresión la
// medida saldría peor que en producción (Vercel sirve con Brotli). Sirve la
// carpeta del build como Vercel (vercel.json): los archivos que existen tal
// cual y cualquier otra ruta con index.html, para que el enrutador decida la
// pantalla.

import { createServer } from 'node:http'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'

const TIPOS = {
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
  '.jpg': 'image/jpeg',
}

const COMPRIMIBLES = new Set([
  '.html',
  '.js',
  '.css',
  '.json',
  '.webmanifest',
  '.svg',
])

/**
 * Ruta del archivo que corresponde a una URL dentro de `carpeta`, o null si la
 * URL intenta salir de ella. No comprueba que exista.
 */
export function archivoDeUrl(carpeta, url) {
  let ruta
  try {
    ruta = decodeURIComponent(new URL(url, 'http://localhost').pathname)
  } catch {
    return null
  }
  const completa = path.join(carpeta, path.normalize(ruta))
  const relativa = path.relative(carpeta, completa)
  if (relativa.startsWith('..') || path.isAbsolute(relativa)) return null
  return relativa === '' ? path.join(carpeta, 'index.html') : completa
}

async function esArchivo(ruta) {
  try {
    return (await stat(ruta)).isFile()
  } catch {
    return false
  }
}

function comprimir(contenido) {
  return brotliCompressSync(contenido, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  })
}

/**
 * Arranca el servidor sobre `carpeta`. Devuelve su URL y cómo cerrarlo.
 *
 * Comprime todo antes de escuchar: Brotli al máximo tarda en los chunks
 * grandes, y hacerlo en la primera petición retrasaría solo la primera
 * ejecución de Lighthouse (en producción, Vercel ya lo tiene comprimido).
 */
export async function servirCarpeta(carpeta, { puerto = 0 } = {}) {
  const raiz = path.resolve(carpeta)
  const cache = new Map()
  for (const entrada of await readdir(raiz, {
    recursive: true,
    withFileTypes: true,
  })) {
    const archivo = path.join(entrada.parentPath, entrada.name)
    if (entrada.isFile() && COMPRIMIBLES.has(path.extname(archivo))) {
      cache.set(archivo, comprimir(await readFile(archivo)))
    }
  }

  const servidor = createServer(async (peticion, respuesta) => {
    let archivo = archivoDeUrl(raiz, peticion.url ?? '/')
    if (archivo === null) {
      respuesta.writeHead(400).end()
      return
    }
    if (!(await esArchivo(archivo))) archivo = path.join(raiz, 'index.html')

    const extension = path.extname(archivo)
    let cuerpo = await readFile(archivo)
    const cabeceras = {
      'Content-Type': TIPOS[extension] ?? 'application/octet-stream',
      // Como en Vercel para el HTML; da igual para la primera visita, que es
      // la que mide Lighthouse (empieza siempre con la caché vacía).
      'Cache-Control': 'no-cache',
      Vary: 'Accept-Encoding',
    }
    const aceptaBrotli = /\bbr\b/.test(
      peticion.headers['accept-encoding'] ?? '',
    )
    if (aceptaBrotli && COMPRIMIBLES.has(extension)) {
      if (!cache.has(archivo)) cache.set(archivo, comprimir(cuerpo))
      cuerpo = cache.get(archivo)
      cabeceras['Content-Encoding'] = 'br'
    }
    cabeceras['Content-Length'] = cuerpo.length
    respuesta.writeHead(200, cabeceras)
    respuesta.end(peticion.method === 'HEAD' ? undefined : cuerpo)
  })

  await new Promise((resolver) =>
    servidor.listen(puerto, '127.0.0.1', resolver),
  )
  const direccion = servidor.address()
  return {
    url: `http://127.0.0.1:${direccion.port}`,
    cerrar: () => new Promise((resolver) => servidor.close(resolver)),
  }
}
