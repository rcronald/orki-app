// Genera los iconos provisionales de la PWA en apps/web/public.
// Diseño propio: la inicial "O" en blanco sobre el color de marca.
// Sin dependencias: rasteriza con supermuestreo y codifica PNG con node:zlib.
// Uso: npm run icons --workspace=apps/web
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const BRAND = [0xd8, 0x3b, 0x6f]
const WHITE = [0xff, 0xff, 0xff]
const SAMPLES = 4 // supermuestreo SAMPLES x SAMPLES por píxel

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// Geometría en coordenadas normalizadas (0..1). La "O" es un anillo elíptico.
const LETTER = { rx: 0.25, ry: 0.3, stroke: 0.1 }

function insideRoundedSquare(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 1 - radius)
  const cy = Math.min(Math.max(y, radius), 1 - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function insideEllipse(x, y, rx, ry) {
  return ((x - 0.5) / rx) ** 2 + ((y - 0.5) / ry) ** 2 <= 1
}

function insideLetter(x, y, scale) {
  const rx = LETTER.rx * scale
  const ry = LETTER.ry * scale
  const s = LETTER.stroke * scale
  return insideEllipse(x, y, rx, ry) && !insideEllipse(x, y, rx - s, ry - s)
}

/**
 * @param {number} size lado en píxeles
 * @param {{ cornerRadius: number, letterScale: number }} shape
 */
function render(size, { cornerRadius, letterScale }) {
  const rgba = Buffer.alloc(size * size * 4)
  const total = SAMPLES * SAMPLES
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0
      let fg = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size
          const y = (py + (sy + 0.5) / SAMPLES) / size
          if (!insideRoundedSquare(x, y, cornerRadius)) continue
          if (insideLetter(x, y, letterScale)) fg++
          else bg++
        }
      }
      const covered = bg + fg
      const i = (py * size + px) * 4
      if (covered === 0) continue
      for (let c = 0; c < 3; c++) {
        rgba[i + c] = Math.round((BRAND[c] * bg + WHITE[c] * fg) / covered)
      }
      rgba[i + 3] = Math.round((255 * covered) / total)
    }
  }
  return encodePng(size, rgba)
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

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits por canal
  header[9] = 6 // RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filtro "None"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ICO con una única imagen PNG embebida (formato admitido desde Windows Vista).
function encodeIco(size, png) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // tipo: icono
  header.writeUInt16LE(1, 4) // número de imágenes
  header[6] = size
  header[7] = size
  header.writeUInt16LE(1, 10) // planos
  header.writeUInt16LE(32, 12) // bits por píxel
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18) // desplazamiento de la imagen
  return Buffer.concat([header, png])
}

// Iconos "any": cuadrado redondeado con transparencia alrededor.
const ANY = { cornerRadius: 0.22, letterScale: 1 }
// Enmascarable y Apple: fondo a sangre; la letra cabe holgada en la zona segura
// (círculo de radio 0.4 del lado), ya que su semieje mayor es 0.3 * 0.9 + margen.
const FULL_BLEED = { cornerRadius: 0, letterScale: 0.9 }

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#D83B6F"/>
  <ellipse cx="50" cy="50" rx="${(LETTER.rx - LETTER.stroke / 2) * 100}" ry="${(LETTER.ry - LETTER.stroke / 2) * 100}" fill="none" stroke="#FFFFFF" stroke-width="${LETTER.stroke * 100}"/>
</svg>
`

const files = {
  'pwa-192x192.png': render(192, ANY),
  'pwa-512x512.png': render(512, ANY),
  'maskable-icon-512x512.png': render(512, FULL_BLEED),
  'apple-touch-icon-180x180.png': render(180, FULL_BLEED),
  'favicon.ico': encodeIco(48, render(48, ANY)),
  'favicon.svg': svg,
}

mkdirSync(outDir, { recursive: true })
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(outDir, name), content)
  console.log(`public/${name}`)
}
