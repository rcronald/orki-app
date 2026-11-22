// Prepara la ilustración en color de la cabecera de pantalla (#206) a partir
// del PNG entregado (con transparencia): quita los restos casi transparentes
// del fondo, limpia el halo claro del contorno, recorta al contenido y la
// exporta en WebP con transparencia a dos anchos, con medidas pares.
//
// Usa el Chromium de Playwright (como generate-icons.mjs): canvas para leer y
// escribir los píxeles y su codificador de WebP.
//
// Uso: npm run ilustracion --workspace=apps/web -- <ruta del PNG>
// Necesita el navegador de Playwright: npx playwright install chromium

/* global Image, OffscreenCanvas */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(webDir, 'src/assets/ilustraciones')

/** Anchos exportados: el de celular y el de escritorio (o pantallas densas). */
const WIDTHS = [240, 480]
const QUALITY = 0.8

const input = process.argv[2]
if (!input) {
  console.error('Uso: npm run ilustracion --workspace=apps/web -- <PNG>')
  process.exit(1)
}

const browser = await chromium.launch()
const page = await browser.newPage()

const results = await page.evaluate(
  async ({ png, widths, quality }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const w = image.width
    const h = image.height
    const canvas = new OffscreenCanvas(w, h)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, w, h)
    const d = pixels.data
    const size = w * h

    // 1. Restos del fondo: alfa muy bajo fuera, y manchas sueltas (componentes
    //    de menos de 400 px) también.
    for (let p = 0; p < size; p++) if (d[p * 4 + 3] < 16) d[p * 4 + 3] = 0
    const label = new Int32Array(size).fill(-1)
    const stack = []
    for (let start = 0; start < size; start++) {
      if (label[start] !== -1 || d[start * 4 + 3] === 0) continue
      const members = []
      label[start] = start
      stack.push(start)
      while (stack.length > 0) {
        const p = stack.pop()
        members.push(p)
        const x = p % w
        const y = (p - x) / w
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const q = ny * w + nx
            if (label[q] !== -1 || d[q * 4 + 3] === 0) continue
            label[q] = start
            stack.push(q)
          }
        }
      }
      if (members.length < 400) for (const p of members) d[p * 4 + 3] = 0
    }

    // 2. Halo: los dos anillos de píxeles junto a la transparencia toman el
    //    color de los vecinos de más adentro (conservan su alfa).
    const dist = new Uint8Array(size).fill(255)
    for (let p = 0; p < size; p++) if (d[p * 4 + 3] === 0) dist[p] = 0
    const RINGS = 3
    for (let ring = 1; ring <= RINGS; ring++) {
      for (let p = 0; p < size; p++) {
        if (dist[p] !== 255) continue
        const x = p % w
        const near =
          (x > 0 && dist[p - 1] === ring - 1) ||
          (x < w - 1 && dist[p + 1] === ring - 1) ||
          (p >= w && dist[p - w] === ring - 1) ||
          (p < size - w && dist[p + w] === ring - 1)
        if (near) dist[p] = ring
      }
    }
    for (let ring = RINGS - 1; ring >= 1; ring--) {
      for (let p = 0; p < size; p++) {
        if (dist[p] !== ring) continue
        const x = p % w
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const q = p + dy * w + dx
            if (nx < 0 || nx >= w || q < 0 || q >= size) continue
            if (dist[q] <= ring) continue
            r += d[q * 4]
            g += d[q * 4 + 1]
            b += d[q * 4 + 2]
            n++
          }
        }
        if (n === 0) continue
        // Solo oscurece: el halo es claro.
        const k = p * 4
        if ((r + g + b) / n < d[k] + d[k + 1] + d[k + 2]) {
          d[k] = r / n
          d[k + 1] = g / n
          d[k + 2] = b / n
        }
      }
    }
    context.putImageData(pixels, 0, 0)

    // 3. Recorte al contenido.
    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1
    for (let p = 0; p < size; p++) {
      if (d[p * 4 + 3] === 0) continue
      const x = p % w
      const y = (p - x) / w
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const cropW = maxX - minX + 1
    const cropH = maxY - minY + 1

    // 4. Exportación con medidas pares.
    const even = (n) => Math.max(2, Math.round(n / 2) * 2)
    const out = []
    for (const width of widths) {
      const height = even((cropH * width) / cropW)
      const target = new OffscreenCanvas(width, height)
      const targetContext = target.getContext('2d')
      targetContext.imageSmoothingQuality = 'high'
      targetContext.drawImage(
        canvas,
        minX,
        minY,
        cropW,
        cropH,
        0,
        0,
        width,
        height,
      )
      const blob = await target.convertToBlob({ type: 'image/webp', quality })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      out.push({ width, height, webp: btoa(binary) })
    }
    return { crop: [minX, minY, cropW, cropH], out }
  },
  {
    png: readFileSync(input).toString('base64'),
    widths: WIDTHS,
    quality: QUALITY,
  },
)
await browser.close()

const variants = results.out.map(({ width, height, webp }) => {
  const file = `cabecera-${width}.webp`
  const bytes = Buffer.from(webp, 'base64')
  writeFileSync(join(outDir, file), bytes)
  return {
    archivo: file,
    ancho: width,
    alto: height,
    calidad: QUALITY,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
})
const [x, y, cropW, cropH] = results.crop
writeFileSync(
  join(outDir, 'medidas.json'),
  `${JSON.stringify({ recorte: { x, y, ancho: cropW, alto: cropH }, variantes: variants }, null, 2)}\n`,
)
for (const v of variants) {
  console.log(`${v.archivo}: ${v.ancho} × ${v.alto}, ${v.bytes} bytes`)
}
