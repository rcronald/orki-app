// @vitest-environment node
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BACKDROP_FOREGROUNDS,
  compositeOver,
  contrastRatio,
} from '../styles/contrast.ts'
import { parseTokens, readColorTokens } from '../styles/tokens.ts'
import { GENERA_WITH_BACKGROUND } from './genus-backgrounds.ts'

// Fotos de fondo por género (#13): peso, correspondencia con su medición y
// contraste del texto del formulario sobre el velo overlay-genus, en la zona
// más clara y en la más oscura de cada foto.
//
// Las zonas las mide `npm run fondos -- medir` (scripts/fondos-genero.mjs) sobre
// la foto ya codificada y quedan en medidas.json con la huella SHA-256 del
// archivo: si se cambia una foto sin volver a medirla, la huella no coincide y
// la prueba falla. El velo se compone sobre cada zona como lo hace el
// navegador; el resultado debe cumplir AA con cada color que el formulario
// pinta directamente sobre el fondo (BACKDROP_FOREGROUNDS).

interface Measure {
  provisional: boolean
  bytes: number
  sha256: string
  zonaClara: string
  zonaOscura: string
}

const folder = new URL('../assets/fondos-genero/', import.meta.url)
const measures = JSON.parse(
  readFileSync(new URL('medidas.json', folder), 'utf8'),
) as Record<string, Measure>
const photos = readdirSync(folder)
  .filter((name) => name.endsWith('.avif'))
  .map((name) => name.replace(/\.avif$/, ''))
  .sort()

const tokensCss = readFileSync(
  new URL('../styles/tokens.css', import.meta.url),
  'utf8',
)
const colors = readColorTokens(tokensCss)
const overlay = parseTokens(tokensCss).colors.find(
  (token) => token.name === 'overlay-genus',
)?.value

function color(name: string): string {
  const value = colors.get(name)
  if (!value) throw new Error(`Falta el token ${name} en tokens.css`)
  return value
}

describe('fotos de fondo por género', () => {
  it('hay una foto por cada género con fondo, y cada una está medida', () => {
    expect(photos).toEqual([...GENERA_WITH_BACKGROUND].sort())
    expect(Object.keys(measures).sort()).toEqual(photos)
  })

  it.each(photos)(
    '%s pesa menos de 100 KB y su medición es la de la foto',
    (genus) => {
      const data = readFileSync(new URL(`${genus}.avif`, folder))
      expect(data.length).toBeLessThan(100 * 1024)
      const measure = measures[genus]
      expect(measure?.bytes).toBe(data.length)
      expect(measure?.sha256).toBe(
        createHash('sha256').update(data).digest('hex'),
      )
    },
  )

  it('compone el velo sobre la foto como el navegador', () => {
    expect(overlay).toBe('rgba(255, 252, 247, 0.85)')
    // 85 % de (255, 252, 247) sobre negro y sobre blanco.
    expect(compositeOver('rgba(255, 252, 247, 0.85)', '#000000')).toBe(
      '#d9d6d2',
    )
    expect(compositeOver('rgba(255, 252, 247, 0.85)', '#ffffff')).toBe(
      '#fffcf8',
    )
  })

  const cases = photos.flatMap((genus) =>
    (['zonaClara', 'zonaOscura'] as const).flatMap((zone) =>
      BACKDROP_FOREGROUNDS.map((pair) => ({ genus, zone, ...pair })),
    ),
  )

  it.each(cases)(
    '$foreground sobre $genus ($zone) con el velo: $kind, mínimo $min:1',
    ({ genus, zone, foreground, min }) => {
      const photoZone = measures[genus]?.[zone]
      if (!photoZone || !overlay) throw new Error('Falta la medición o el velo')
      const background = compositeOver(overlay, photoZone)
      expect(
        contrastRatio(color(foreground), background),
      ).toBeGreaterThanOrEqual(min)
    },
  )
})
