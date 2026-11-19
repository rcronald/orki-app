import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.ts'

const VALID = {
  VITE_SUPABASE_URL: 'https://ejemplo.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_clave_de_prueba',
  VITE_APP_ENV: 'dev',
}

describe('parseEnv', () => {
  it('devuelve la configuración tipada con variables válidas', () => {
    expect(parseEnv(VALID)).toEqual({
      ok: true,
      config: {
        supabaseUrl: 'https://ejemplo.supabase.co',
        supabasePublishableKey: 'sb_publishable_clave_de_prueba',
        appEnv: 'dev',
      },
    })
  })

  it('acepta prod como ambiente y recorta espacios', () => {
    const result = parseEnv({ ...VALID, VITE_APP_ENV: ' prod ' })

    expect(result.ok && result.config.appEnv).toBe('prod')
  })

  it('informa de todas las variables que faltan', () => {
    expect(parseEnv({})).toEqual({
      ok: false,
      issues: [
        { variable: 'VITE_SUPABASE_URL', problem: 'Falta o está vacía.' },
        {
          variable: 'VITE_SUPABASE_PUBLISHABLE_KEY',
          problem: 'Falta o está vacía.',
        },
        { variable: 'VITE_APP_ENV', problem: 'Falta o está vacía.' },
      ],
    })
  })

  it('trata una variable vacía como faltante', () => {
    const result = parseEnv({ ...VALID, VITE_SUPABASE_PUBLISHABLE_KEY: '  ' })

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          variable: 'VITE_SUPABASE_PUBLISHABLE_KEY',
          problem: 'Falta o está vacía.',
        },
      ],
    })
  })

  it.each(['http://ejemplo.supabase.co', 'ejemplo.supabase.co', 'no es url'])(
    'rechaza la URL %s',
    (url) => {
      const result = parseEnv({ ...VALID, VITE_SUPABASE_URL: url })

      expect(result).toEqual({
        ok: false,
        issues: [
          {
            variable: 'VITE_SUPABASE_URL',
            problem: 'No es una URL https válida.',
          },
        ],
      })
    },
  )

  it('rechaza un ambiente desconocido', () => {
    const result = parseEnv({ ...VALID, VITE_APP_ENV: 'staging' })

    expect(result).toEqual({
      ok: false,
      issues: [
        { variable: 'VITE_APP_ENV', problem: 'Tiene que ser "dev" o "prod".' },
      ],
    })
  })

  it('rechaza una clave secreta', () => {
    const result = parseEnv({
      ...VALID,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_valor_de_prueba',
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues[0]?.variable).toBe(
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    )
  })

  it('nunca incluye los valores en los problemas', () => {
    const invalid = {
      VITE_SUPABASE_URL: 'http://valor-visible.example',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_valor_visible',
      VITE_APP_ENV: 'valor-visible',
    }

    expect(JSON.stringify(parseEnv(invalid))).not.toContain('valor-visible')
    expect(JSON.stringify(parseEnv(invalid))).not.toContain('valor_visible')
  })
})
