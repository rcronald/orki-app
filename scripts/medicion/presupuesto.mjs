// Medición del tamaño del build y comparación con el presupuesto versionado
// (apps/web/presupuesto-tamano.json). Funciones puras sobre el contenido de
// los archivos, más medirBuild(), que lee la carpeta dist. Sin dependencias.
//
// Qué se mide:
// - jsInicialGzip: el JavaScript que index.html pide al abrir la app (scripts
//   y modulepreload) más lo que esos archivos importan de forma estática,
//   comprimido con gzip. Es lo que el navegador descarga antes de pintar nada.
// - cssGzip: las hojas de estilo que enlaza index.html, con gzip.
// - precacheBytes: todo lo que el service worker descarga al instalarse (su
//   manifiesto de precaché), sin comprimir, igual que lo informa el plugin de
//   PWA al terminar el build. Recoge cualquier crecimiento, también el de los
//   chunks diferidos (Clerk, registro, backoffice).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

/** Métricas del presupuesto, en el orden en que se informan. */
export const METRICAS = Object.freeze({
  jsInicialGzip: 'JavaScript inicial (gzip)',
  cssGzip: 'CSS inicial (gzip)',
  precacheBytes: 'Precaché del service worker (sin comprimir)',
})

function atributo(etiqueta, nombre) {
  const encontrado = new RegExp(
    `\\s${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ).exec(etiqueta)
  if (!encontrado) return undefined
  return encontrado[1] ?? encontrado[2] ?? encontrado[3]
}

// Solo archivos del propio sitio: los de otro origen no son del build.
function rutaLocal(url) {
  if (url === undefined || /^(?:[a-z]+:)?\/\//i.test(url)) return undefined
  return url.replace(/^\//, '').split(/[?#]/)[0]
}

/**
 * Archivos que index.html pide al cargar: JavaScript (script con src y
 * link rel=modulepreload) y CSS (link rel=stylesheet), como rutas relativas a
 * la carpeta del build.
 */
export function referenciasIniciales(html) {
  const js = []
  const css = []
  for (const [etiqueta] of html.matchAll(/<script\b[^>]*>/gi)) {
    const ruta = rutaLocal(atributo(etiqueta, 'src'))
    if (ruta !== undefined) js.push(ruta)
  }
  for (const [etiqueta] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (atributo(etiqueta, 'rel') ?? '').toLowerCase().split(/\s+/)
    const ruta = rutaLocal(atributo(etiqueta, 'href'))
    if (ruta === undefined) continue
    if (rel.includes('modulepreload')) js.push(ruta)
    else if (rel.includes('stylesheet')) css.push(ruta)
  }
  return { js: [...new Set(js)], css: [...new Set(css)] }
}

/**
 * Imports estáticos relativos de un módulo ya construido ("from './x.js'" e
 * "import './x.js'"), resueltos respecto a su ruta. Los import() dinámicos no
 * cuentan: se descargan después.
 */
export function importsEstaticos(codigo, rutaDelModulo) {
  const carpeta = path.posix.dirname(rutaDelModulo)
  const rutas = new Set()
  for (const encontrado of codigo.matchAll(
    /(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+\.js)["']/g,
  )) {
    rutas.add(path.posix.normalize(path.posix.join(carpeta, encontrado[1])))
  }
  return [...rutas]
}

/**
 * Rutas del manifiesto de precaché de un sw.js generado por Workbox
 * (precacheAndRoute([{url:"…",revision:…}, …])).
 */
export function entradasDePrecache(sw) {
  const inicio = sw.indexOf('precacheAndRoute(')
  if (inicio === -1) {
    throw new Error('El service worker no tiene precacheAndRoute(...).')
  }
  const fin = sw.indexOf(']', inicio)
  const lista = sw.slice(inicio, fin === -1 ? undefined : fin)
  const urls = [...lista.matchAll(/\burl\s*:\s*["']([^"']+)["']/g)].map(
    (encontrado) => encontrado[1].replace(/^\//, ''),
  )
  if (urls.length === 0) {
    throw new Error('El manifiesto de precaché del service worker está vacío.')
  }
  return [...new Set(urls)]
}

export function tamanoGzip(contenido) {
  return gzipSync(contenido, { level: 9 }).length
}

/**
 * Mide la carpeta de un build. `leer(ruta)` devuelve el contenido (Buffer) de
 * una ruta relativa a la carpeta; por defecto, del disco.
 */
export function medirBuild(carpeta, leer = defaultLeer(carpeta)) {
  const html = leer('index.html').toString('utf8')
  const { js, css } = referenciasIniciales(html)

  // JavaScript inicial: lo que pide el HTML y, por si algún día Vite deja de
  // listarlo todo como modulepreload, lo que eso importa de forma estática.
  const jsInicial = []
  const pendientes = [...js]
  while (pendientes.length > 0) {
    const ruta = pendientes.shift()
    if (jsInicial.includes(ruta)) continue
    jsInicial.push(ruta)
    pendientes.push(...importsEstaticos(leer(ruta).toString('utf8'), ruta))
  }

  const precache = entradasDePrecache(leer('sw.js').toString('utf8'))

  const suma = (rutas, medida) =>
    rutas.reduce((total, ruta) => total + medida(leer(ruta)), 0)

  return {
    archivos: { jsInicial, css, precache },
    metricas: {
      jsInicialGzip: suma(jsInicial, tamanoGzip),
      cssGzip: suma(css, tamanoGzip),
      precacheBytes: suma(precache, (contenido) => contenido.length),
    },
  }
}

function defaultLeer(carpeta) {
  return (ruta) => readFileSync(path.join(carpeta, ruta))
}

/**
 * Compara las métricas medidas con el presupuesto. Devuelve una fila por
 * métrica del presupuesto, con `dentro` false si la medida supera el límite o
 * falta.
 */
export function compararConPresupuesto(metricas, presupuesto) {
  return Object.keys(METRICAS).map((clave) => {
    const regla = presupuesto.metricas?.[clave]
    if (regla === undefined || typeof regla.limite !== 'number') {
      throw new Error(`El presupuesto no tiene límite para ${clave}.`)
    }
    const valor = metricas[clave]
    return {
      clave,
      nombre: METRICAS[clave],
      valor,
      referencia: regla.referencia,
      limite: regla.limite,
      dentro: typeof valor === 'number' && valor <= regla.limite,
    }
  })
}

/**
 * Presupuesto nuevo a partir de las métricas: la referencia es la medida y el
 * límite, la medida más el margen, redondeado hacia arriba al byte.
 */
export function presupuestoDesde(metricas, margen, fecha) {
  return {
    descripcion:
      'Presupuesto de tamaño del build de producción con valores ficticios (npm run build:medicion). Lo comprueba npm run presupuesto en el CI; ver docs/medicion-de-carga.md.',
    fecha,
    margen,
    metricas: Object.fromEntries(
      Object.keys(METRICAS).map((clave) => [
        clave,
        {
          referencia: metricas[clave],
          limite: Math.ceil(metricas[clave] * (1 + margen)),
        },
      ]),
    ),
  }
}

export function formatearKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}
