// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readDeclarations } from '../styles/tokens.ts'
import { clerkAppearance } from './appearance.ts'

const tokensCss = readFileSync(
  new URL('../styles/tokens.css', import.meta.url),
  'utf8',
)
const tokenNames = new Set(readDeclarations(tokensCss).map((t) => t.name))

function leafValues(value: unknown): unknown[] {
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(leafValues)
  }
  return [value]
}

describe('clerkAppearance', () => {
  const values = leafValues(clerkAppearance)

  it('solo usa variables de tokens.css, nunca valores sueltos', () => {
    expect(values.length).toBeGreaterThan(0)
    for (const value of values) {
      expect(value).toMatch(/^var\(--[a-z0-9-]+\)$/)
    }
  })

  it('cada variable existe en tokens.css', () => {
    const missing = values
      .map((value) => String(value).slice('var(--'.length, -1))
      .filter((name) => !tokenNames.has(name))
    expect(missing).toEqual([])
  })

  it('usa los colores, las familias y el radio del sistema', () => {
    expect(clerkAppearance.variables).toMatchObject({
      colorPrimary: 'var(--color-primary)',
      colorRing: 'var(--color-secondary)',
      fontFamily: 'var(--font-body)',
      borderRadius: 'var(--radius-md)',
    })
    expect(clerkAppearance.elements.headerTitle.fontFamily).toBe(
      'var(--font-display)',
    )
  })
})
