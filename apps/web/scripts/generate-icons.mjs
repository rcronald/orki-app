// Genera los iconos de la PWA en apps/web/public a partir del símbolo del
// logotipo para fondo claro (src/assets/marca/orqui-apps-light-icon.svg, #173):
// la flor sobre su fondo rosa pálido, opaco hasta el borde.
//
// Rasteriza el SVG con el Chromium de Playwright (dependencia de desarrollo que
// ya usan las pruebas de extremo a extremo) y codifica los PNG con node:zlib,
// en color indexado (paleta de hasta 256 colores) para que pesen poco: el
// precaché del service worker tiene un presupuesto de tamaño.
//
// Uso: npm run icons --workspace=apps/web
// Necesita el navegador de Playwright: npx playwright install chromium

// rasterize() pasa una función al navegador, que sí tiene estos globales.
/* global Image, OffscreenCanvas */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(webDir, 'public')
const source = readFileSync(
  join(webDir, 'src/assets/marca/orqui-apps-light-icon.svg'),
  'utf8',
)

// El símbolo ocupa el centro del lienzo de 512 (de 103 a 409 en horizontal y
// de 122 a 387 en vertical). Para el favicon se recorta el lienzo, sin tocar
// el dibujo, para que la flor llene más y se reconozca a 16 px.
const FAVICON_VIEWBOX = '66 66 380 380'

function withViewBox(svg, viewBox) {
  return svg
    .replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`)
    .replace(/ width="\d+" height="\d+"/, '')
}

const faviconSvg = withViewBox(source, FAVICON_VIEWBOX)

/**
 * Rasteriza un SVG en un cuadrado de `size` píxeles y devuelve sus píxeles
 * RGBA.
 */
async function rasterize(page, svg, size) {
  const base64 = await page.evaluate(
    async ({ svg, size }) => {
      const image = new Image()
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await image.decode()
      const canvas = new OffscreenCanvas(size, size)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0, size, size)
      const { data } = context.getImageData(0, 0, size, size)
      let binary = ''
      for (let i = 0; i < data.length; i += 0x8000) {
        binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
      }
      return btoa(binary)
    },
    { svg, size },
  )
  return Buffer.from(base64, 'base64')
}

// Paleta: los colores más frecuentes (los planos del dibujo y los bordes
// suavizados más comunes). Si hay más de 256, los que faltan se aproximan al
// más cercano; solo afecta a algunos píxeles de borde.
function quantize(rgba) {
  const counts = new Map()
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 255) {
      throw new Error('El icono debe ser opaco hasta el borde.')
    }
    const color = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]
    counts.set(color, (counts.get(color) ?? 0) + 1)
  }
  const palette = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 256)
    .map(([color]) => color)
  const indexOf = new Map(palette.map((color, index) => [color, index]))
  const nearest = (color) => {
    let best = 0
    let bestDistance = Infinity
    for (const [index, candidate] of palette.entries()) {
      const dr = ((color >> 16) & 255) - ((candidate >> 16) & 255)
      const dg = ((color >> 8) & 255) - ((candidate >> 8) & 255)
      const db = (color & 255) - (candidate & 255)
      const distance = dr * dr + dg * dg + db * db
      if (distance < bestDistance) {
        best = index
        bestDistance = distance
      }
    }
    return best
  }
  const indices = Buffer.alloc(rgba.length / 4)
  for (let p = 0; p < indices.length; p++) {
    const i = p * 4
    const color = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]
    let index = indexOf.get(color)
    if (index === undefined) {
      index = nearest(color)
      indexOf.set(color, index)
    }
    indices[p] = index
  }
  return { palette, indices }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// PNG de color indexado, 8 bits por píxel, sin transparencia.
function encodePng(size, rgba) {
  const { palette, indices } = quantize(rgba)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits por índice
  header[9] = 3 // color indexado
  const plte = Buffer.alloc(palette.length * 3)
  palette.forEach((color, index) => {
    plte[index * 3] = (color >> 16) & 255
    plte[index * 3 + 1] = (color >> 8) & 255
    plte[index * 3 + 2] = color & 255
  })
  const raw = Buffer.alloc((size + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0 // filtro "None", el que mejor va con una paleta
    indices.copy(raw, y * (size + 1) + 1, y * size, (y + 1) * size)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ICO con imágenes PNG embebidas (formato admitido desde Windows Vista).
function encodeIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // tipo: icono
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index
    header[entry] = size
    header[entry + 1] = size
    header.writeUInt16LE(1, entry + 4) // planos
    header.writeUInt16LE(32, entry + 6) // bits por píxel
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map(({ png }) => png)])
}

// Distancia máxima al centro de lo que no es fondo, como fracción del lado.
// El icono enmascarable debe dejar el dibujo dentro del círculo central de
// radio 0,4 (la zona segura de la especificación de manifiestos).
function drawingRadius(size, rgba) {
  const background = rgba.readUInt32BE(0)
  let max = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rgba.readUInt32BE((y * size + x) * 4) === background) continue
      const dx = x + 0.5 - size / 2
      const dy = y + 0.5 - size / 2
      max = Math.max(max, Math.hypot(dx, dy))
    }
  }
  return max / size
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const png = async (svg, size) => {
    const rgba = await rasterize(page, svg, size)
    return { size, rgba, png: encodePng(size, rgba) }
  }

  // El de 512 sirve a la vez de icono "any" y de enmascarable (#287): el
  // símbolo ya deja el margen de la zona segura, así que un archivo aparte
  // sería el mismo, byte a byte, y se precachearía dos veces.
  const large = await png(source, 512)
  const radius = drawingRadius(512, large.rgba)
  if (radius > 0.4) {
    throw new Error(
      `El símbolo sale de la zona segura del icono enmascarable (radio ${radius.toFixed(3)} > 0,4).`,
    )
  }
  console.log(`Zona segura del enmascarable: radio ${radius.toFixed(3)} ≤ 0,4`)

  // Todos llevan el mismo dibujo con fondo opaco a sangre: el enmascarable y
  // el de Apple lo necesitan, y los "any" se ven igual en todas partes.
  const files = {
    'pwa-192x192.png': (await png(source, 192)).png,
    'pwa-512x512.png': large.png,
    'apple-touch-icon-180x180.png': (await png(source, 180)).png,
    'favicon.ico': encodeIco(
      await Promise.all([16, 32, 48].map((size) => png(faviconSvg, size))),
    ),
    'favicon.svg': faviconSvg,
  }

  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(outDir, name), content)
    console.log(`public/${name} (${content.length} B)`)
  }
} finally {
  await browser.close()
}
