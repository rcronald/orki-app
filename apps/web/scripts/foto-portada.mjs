// Foto del bloque principal de la portada (#193): preparación repetible.
//
//   npm run portada --workspace=apps/web -- preparar <foto-original> ["texto alternativo"]
//   npm run portada --workspace=apps/web -- preparar
//
// - Con una foto: la guarda como versión de trabajo en
//   src/assets/portada/original.jpg (JPEG de calidad 90, sin recortar ni
//   reducir más allá de 2400 px de ancho) y genera desde ella las variantes.
//   El texto alternativo, si se da, sustituye al de medidas.json; si no, se
//   conserva el que hubiera.
// - Sin foto: vuelve a generar las variantes desde original.jpg (por ejemplo,
//   tras cambiar los anchos o la calidad aquí).
//
// Variantes: recorte central a 3:2 (el del Hero del design system) y, para
// cada ancho de ANCHOS que no supere al del recorte, un AVIF
// (portada-<ancho>.avif) con la calidad más alta de CALIDADES que quede por
// debajo de MAX_BYTES; además, un JPEG de respaldo (portada-<ancho>.jpg) para
// los navegadores sin AVIF. Borra las variantes anteriores y escribe:
// - foto.json, lo único que lee la app (src/pages/HeroPhoto.tsx): el texto
//   alternativo y el nombre, el ancho y el alto de cada variante. Va en el
//   JavaScript, así que no lleva nada más.
// - medidas.json, el informe: peso, calidad y huella de cada archivo.
//
// Codificar lo hace sips, la herramienta de imágenes de macOS, como en
// scripts/fondos-genero.mjs, para no añadir dependencias. En otro sistema se
// pueden preparar los mismos archivos con otra herramienta (Squoosh, avifenc)
// con los mismos nombres y medidas, y escribir medidas.json a mano.
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
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Anchos múltiplos de 6 cuyo alto 3:2 es PAR. Con un alto impar (640×427,
// 1280×853), sips escribe un AVIF que Firefox y el WebKit de Linux no
// decodifican (la foto queda rota, sin pasar al JPEG de respaldo): lo
// detectaron las pruebas de extremo a extremo en el CI (#196).
const ANCHOS = [648, 960, 1296, 1536]
const CALIDADES = [60, 55, 50, 45, 40, 35, 30]
/** Límite de cada AVIF; el criterio del #193 es menos de 150 KB en celular. */
const MAX_BYTES = 150 * 1024
const RESPALDO = { ancho: 960, calidad: 70 }
const ORIGINAL_MAX = 2400

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'assets',
  'portada',
)
const originalPath = join(dir, 'original.jpg')
const measuresPath = join(dir, 'medidas.json')
const photoPath = join(dir, 'foto.json')

function sips(...args) {
  execFileSync('sips', args, { stdio: ['ignore', 'ignore', 'inherit'] })
}

function size(path) {
  const info = execFileSync(
    'sips',
    ['-g', 'pixelWidth', '-g', 'pixelHeight', path],
    { encoding: 'utf8' },
  )
  return {
    width: Number(/pixelWidth: (\d+)/.exec(info)?.[1]),
    height: Number(/pixelHeight: (\d+)/.exec(info)?.[1]),
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function readPhoto() {
  try {
    return JSON.parse(readFileSync(photoPath, 'utf8'))
  } catch {
    return {}
  }
}

/** Guarda la foto entregada como versión de trabajo (original.jpg). */
function saveOriginal(source) {
  const { width } = size(source)
  const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90']
  if (width > ORIGINAL_MAX) args.push('--resampleWidth', String(ORIGINAL_MAX))
  sips(...args, source, '--out', originalPath)
}

/** Recorte central a 3:2 de original.jpg, en PNG, dentro de `work`. */
function crop(work) {
  const { width, height } = size(originalPath)
  const cropW = Math.min(width, Math.round((height * 3) / 2))
  const cropH = Math.min(height, Math.round((cropW * 2) / 3))
  const png = join(work, 'recorte.png')
  sips(
    '-s',
    'format',
    'png',
    '-c',
    String(cropH),
    String(cropW),
    originalPath,
    '--out',
    png,
  )
  return { png, width: cropW, height: cropH }
}

function resized(work, png, width, height) {
  const out = join(work, `${width}.png`)
  sips('-z', String(height), String(width), png, '--out', out)
  return out
}

function encodeAvif(source, target) {
  for (const quality of CALIDADES) {
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
  throw new Error(`${target} no baja de 150 KB ni con calidad 30.`)
}

function prepare(source, altText) {
  if (source) saveOriginal(resolve(source))
  const work = mkdtempSync(join(tmpdir(), 'orki-portada-'))
  try {
    for (const file of readdirSync(dir)) {
      if (/^portada-\d+\.(avif|jpg)$/.test(file)) rmSync(join(dir, file))
    }
    const cropped = crop(work)
    const ratio = cropped.height / cropped.width
    const widths = ANCHOS.filter((width) => width <= cropped.width)
    if (widths.length === 0) widths.push(cropped.width)

    const anchos = widths.map((width) => {
      const height = Math.round(width * ratio)
      const file = `portada-${width}.avif`
      const target = join(dir, file)
      const calidad = encodeAvif(
        resized(work, cropped.png, width, height),
        target,
      )
      return {
        archivo: file,
        ancho: width,
        alto: height,
        calidad,
        bytes: statSync(target).size,
        sha256: sha256(target),
      }
    })

    const fallbackWidth = Math.min(RESPALDO.ancho, cropped.width)
    const fallbackHeight = Math.round(fallbackWidth * ratio)
    const fallbackFile = `portada-${fallbackWidth}.jpg`
    const fallbackTarget = join(dir, fallbackFile)
    sips(
      '-s',
      'format',
      'jpeg',
      '-s',
      'formatOptions',
      String(RESPALDO.calidad),
      resized(work, cropped.png, fallbackWidth, fallbackHeight),
      '--out',
      fallbackTarget,
    )

    const textoAlternativo = altText ?? readPhoto().textoAlternativo
    if (!textoAlternativo) {
      throw new Error(
        'Falta el texto alternativo: preparar <foto> "texto alternativo".',
      )
    }
    const photo = {
      textoAlternativo,
      anchos: anchos.map(({ archivo, ancho, alto }) => ({
        archivo,
        ancho,
        alto,
      })),
      respaldo: { archivo: fallbackFile },
    }
    writeFileSync(photoPath, `${JSON.stringify(photo, null, 2)}\n`)
    const measures = {
      original: { archivo: 'original.jpg', sha256: sha256(originalPath) },
      anchos,
      respaldo: {
        archivo: fallbackFile,
        ancho: fallbackWidth,
        alto: fallbackHeight,
        calidad: RESPALDO.calidad,
        bytes: statSync(fallbackTarget).size,
        sha256: sha256(fallbackTarget),
      },
    }
    writeFileSync(measuresPath, `${JSON.stringify(measures, null, 2)}\n`)
    for (const entry of [...anchos, measures.respaldo]) {
      console.log(
        `${entry.archivo}: ${entry.ancho} x ${entry.alto}, ${(entry.bytes / 1024).toFixed(1)} KB (calidad ${entry.calidad})`,
      )
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const [command, ...args] = process.argv.slice(2)
if (command === 'preparar') {
  prepare(args[0], args[1])
} else {
  console.error('Orden: preparar [<foto-original> ["texto alternativo"]]')
  process.exit(1)
}
