// Fotos de fondo por género del registro (#13): preparación y medición.
//
//   npm run fondos --workspace=apps/web -- preparar <género> <foto-original>
//   npm run fondos --workspace=apps/web -- medir
//   npm run fondos --workspace=apps/web -- provisionales
//
// - preparar: recorta la foto al centro en vertical 9:16, la reduce a 720 x 1280,
//   la codifica en AVIF bajando la calidad hasta que pese menos de 100 KB, la
//   deja en src/assets/fondos-genero/<género>.avif y la mide.
// - medir: vuelve a medir todas las fotos de la carpeta.
// - provisionales: genera las cinco fotos provisionales (degradados y texturas
//   propios, con la palabra PROVISIONAL) y las mide.
//
// La medición guarda en medidas.json, por foto, el peso, la huella SHA-256 y el
// color de su zona más clara y de su zona más oscura (sobre la foto reducida a
// 180 x 320, es decir, zonas de 4 x 4 píxeles de la foto). La prueba
// src/registration/genus-backdrop-contrast.test.ts comprueba con esas zonas el
// contraste del texto del formulario sobre el velo overlay-genus, y con la
// huella que la medición corresponde a la foto versionada.
//
// Codificar y decodificar AVIF lo hace sips, la herramienta de imágenes de
// macOS, para no añadir dependencias. En otro sistema, la foto se puede preparar
// con otra herramienta (Squoosh, avifenc) y medirse después en un Mac.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const WIDTH = 720
const HEIGHT = 1280
const MAX_BYTES = 100 * 1024
const MEASURE = { width: 180, height: 320 }
const QUALITIES = [60, 55, 50, 45, 40, 35, 30]

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'assets',
  'fondos-genero',
)
const measuresPath = join(dir, 'medidas.json')

/** Géneros de acceso rápido y el tono de su foto provisional (RGB). */
const PROVISIONAL = {
  phalaenopsis: { light: [252, 228, 240], mid: [214, 70, 140], seed: 11 },
  cattleya: { light: [240, 226, 250], mid: [128, 58, 168], seed: 23 },
  dendrobium: { light: [250, 246, 252], mid: [170, 120, 190], seed: 37 },
  oncidium: { light: [255, 246, 200], mid: [214, 160, 20], seed: 41 },
  vanda: { light: [226, 232, 255], mid: [70, 70, 180], seed: 53 },
}

function sips(...args) {
  execFileSync('sips', args, { stdio: ['ignore', 'ignore', 'inherit'] })
}

function readMeasures() {
  try {
    return JSON.parse(readFileSync(measuresPath, 'utf8'))
  } catch {
    return {}
  }
}

function writeMeasures(measures) {
  const sorted = Object.fromEntries(
    Object.keys(measures)
      .sort()
      .map((key) => [key, measures[key]]),
  )
  writeFileSync(measuresPath, `${JSON.stringify(sorted, null, 2)}\n`)
}

// --- PNG (para las provisionales, sin dependencias) -------------------------

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

function encodePng(width, height, rgb) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bits por canal
  header[9] = 2 // RGB, sin transparencia
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filtro "None"
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- Fotos provisionales -----------------------------------------------------

function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Letras de 5 x 7 para escribir PROVISIONAL en la imagen.
const GLYPHS = {
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
}

function insideWord(x, y, word, { left, top, cell }) {
  const col = Math.floor((x - left) / cell)
  const row = Math.floor((y - top) / cell)
  if (row < 0 || row >= 7 || col < 0) return false
  const letter = Math.floor(col / 6)
  const inLetter = col % 6
  if (letter >= word.length || inLetter === 5) return false
  return GLYPHS[word[letter]][row][inLetter] === '1'
}

const mix = (a, b, t) => a + (b - a) * t
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))

/**
 * Foto provisional: degradado vertical del tono claro (arriba) al medio y a casi
 * negro (abajo), con "flores" difusas claras y oscuras y grano, para que tenga
 * zonas muy claras y muy oscuras como una foto real. Lleva PROVISIONAL escrito.
 */
function provisionalImage({ light, mid, seed }) {
  const rand = random(seed)
  const blobs = Array.from({ length: 7 }, (_, i) => ({
    x: rand() * WIDTH,
    y: rand() * HEIGHT,
    r: 90 + rand() * 180,
    // Alternan flores casi blancas y sombras casi negras.
    color: i % 2 === 0 ? [255, 255, 255] : [8, 6, 10],
  }))
  const word = { left: 33, top: 605, cell: 10 }
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3)
  for (let y = 0; y < HEIGHT; y++) {
    const t = y / (HEIGHT - 1)
    const base =
      t < 0.5
        ? light.map((c, i) => mix(c, mid[i], t * 2))
        : mid.map((c) => mix(c, 12, (t - 0.5) * 2))
    for (let x = 0; x < WIDTH; x++) {
      let color = base
      for (const blob of blobs) {
        const d = Math.hypot(x - blob.x, y - blob.y) / blob.r
        if (d < 1) {
          const w = (1 - d * d) ** 2
          color = color.map((c, i) => mix(c, blob.color[i], w))
        }
      }
      if (insideWord(x, y, 'PROVISIONAL', word)) {
        color = color.map((c) => mix(c, 128, 0.6))
      }
      const grain = (rand() - 0.5) * 10
      const i = (y * WIDTH + x) * 3
      rgb[i] = clamp(color[0] + grain)
      rgb[i + 1] = clamp(color[1] + grain)
      rgb[i + 2] = clamp(color[2] + grain)
    }
  }
  return encodePng(WIDTH, HEIGHT, rgb)
}

// --- Codificación y medición -------------------------------------------------

/** Codifica `source` (ya en 720 x 1280) en AVIF por debajo de MAX_BYTES. */
function encodeAvif(source, target) {
  for (const quality of QUALITIES) {
    sips(
      '-s',
      'format',
      'avif',
      '-s',
      'formatOptions',
      String(quality),
      source,
      '--out',
      target,
    )
    if (statSync(target).size < MAX_BYTES) return quality
  }
  throw new Error(
    `${target} no baja de 100 KB ni con calidad ${QUALITIES.at(-1)}.`,
  )
}

/** Lee un BMP de 24 o 32 bits como el que escribe sips. */
function readBmp(buf) {
  const offset = buf.readUInt32LE(10)
  const width = buf.readInt32LE(18)
  const rawHeight = buf.readInt32LE(22)
  const bpp = buf.readUInt16LE(28)
  const compression = buf.readUInt32LE(30)
  const height = Math.abs(rawHeight)
  const bottomUp = rawHeight > 0
  const bytes = bpp / 8
  const stride = Math.ceil((width * bytes) / 4) * 4
  let masks = { r: 0x00ff0000, g: 0x0000ff00, b: 0x000000ff }
  if (compression === 3) {
    masks = {
      r: buf.readUInt32LE(54),
      g: buf.readUInt32LE(58),
      b: buf.readUInt32LE(62),
    }
  }
  const channel = (value, mask) => {
    const shift = Math.log2(mask & -mask)
    return ((value & mask) >>> shift) & 0xff
  }
  const pixels = []
  for (let row = 0; row < height; row++) {
    const y = bottomUp ? height - 1 - row : row
    for (let x = 0; x < width; x++) {
      const at = offset + y * stride + x * bytes
      const value = bytes === 4 ? buf.readUInt32LE(at) : buf.readUIntLE(at, 3)
      pixels.push([
        channel(value, masks.r),
        channel(value, masks.g),
        channel(value, masks.b),
      ])
    }
  }
  return pixels
}

function luminance([r, g, b]) {
  const lin = (v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const hex = (rgb) =>
  `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`

function measure(file, work) {
  const path = join(dir, file)
  const bmp = join(work, `${file}.bmp`)
  sips(
    '-s',
    'format',
    'bmp',
    '-z',
    String(MEASURE.height),
    String(MEASURE.width),
    path,
    '--out',
    bmp,
  )
  const pixels = readBmp(readFileSync(bmp))
  let lightest = pixels[0]
  let darkest = pixels[0]
  for (const pixel of pixels) {
    if (luminance(pixel) > luminance(lightest)) lightest = pixel
    if (luminance(pixel) < luminance(darkest)) darkest = pixel
  }
  const data = readFileSync(path)
  return {
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    zonaClara: hex(lightest),
    zonaOscura: hex(darkest),
  }
}

// --- Órdenes -----------------------------------------------------------------

function withWorkDir(run) {
  const work = mkdtempSync(join(tmpdir(), 'orki-fondos-'))
  try {
    return run(work)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function report(genus, entry) {
  console.log(
    `${genus}: ${(entry.bytes / 1024).toFixed(1)} KB, zona clara ${entry.zonaClara}, zona oscura ${entry.zonaOscura}${entry.provisional ? ' (provisional)' : ''}`,
  )
}

function provisionals() {
  withWorkDir((work) => {
    const measures = readMeasures()
    for (const [genus, palette] of Object.entries(PROVISIONAL)) {
      const png = join(work, `${genus}.png`)
      writeFileSync(png, provisionalImage(palette))
      const quality = encodeAvif(png, join(dir, `${genus}.avif`))
      measures[genus] = {
        provisional: true,
        calidad: quality,
        ...measure(`${genus}.avif`, work),
      }
      report(genus, measures[genus])
    }
    writeMeasures(measures)
  })
}

function prepare(genus, source) {
  if (!genus || !source || !/^[a-z]+$/.test(genus)) {
    throw new Error('Uso: preparar <género en minúsculas> <foto-original>')
  }
  withWorkDir((work) => {
    const info = execFileSync(
      'sips',
      ['-g', 'pixelWidth', '-g', 'pixelHeight', source],
      {
        encoding: 'utf8',
      },
    )
    const width = Number(/pixelWidth: (\d+)/.exec(info)?.[1])
    const height = Number(/pixelHeight: (\d+)/.exec(info)?.[1])
    // Recorte central a 9:16 y después a 720 x 1280.
    const cropW = Math.min(width, Math.round((height * WIDTH) / HEIGHT))
    const cropH = Math.min(height, Math.round((cropW * HEIGHT) / WIDTH))
    const png = join(work, 'recorte.png')
    sips(
      '-s',
      'format',
      'png',
      '-c',
      String(cropH),
      String(cropW),
      source,
      '--out',
      png,
    )
    sips('-z', String(HEIGHT), String(WIDTH), png)
    const quality = encodeAvif(png, join(dir, `${genus}.avif`))
    const measures = readMeasures()
    measures[genus] = {
      provisional: false,
      calidad: quality,
      ...measure(`${genus}.avif`, work),
    }
    writeMeasures(measures)
    report(genus, measures[genus])
  })
}

function measureAll() {
  withWorkDir((work) => {
    const measures = readMeasures()
    for (const file of readdirSync(dir).filter((name) =>
      name.endsWith('.avif'),
    )) {
      const genus = file.replace(/\.avif$/, '')
      measures[genus] = { ...measures[genus], ...measure(file, work) }
      report(genus, measures[genus])
    }
    writeMeasures(measures)
  })
}

const [command, ...args] = process.argv.slice(2)
switch (command) {
  case 'provisionales':
    provisionals()
    break
  case 'preparar':
    prepare(args[0], args[1])
    break
  case 'medir':
    measureAll()
    break
  default:
    console.error('Órdenes: provisionales | preparar <género> <foto> | medir')
    process.exit(1)
}
