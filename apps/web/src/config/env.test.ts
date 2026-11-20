import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.ts'

const VALID = {
  VITE_SUPABASE_URL: 'https://ejemplo.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_clave_de_prueba',
  VITE_APP_ENV: 'dev',
  VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_clave_de_prueba',
}

describe('parseEnv', () => {
  it('devuelve la configuración tipada con variables válidas', () => {
    expect(parseEnv(VALID)).toEqual({
      ok: true,
      config: {
        supabaseUrl: 'https://ejemplo.supabase.co',
        supabasePublishableKey: 'sb_publishable_clave_de_prueba',
        appEnv: 'dev',
        clerkPublishableKey: 'pk_test_clave_de_prueba',
      },
    })
  })

  it('acepta prod como ambiente y recorta espacios', () => {
    const result = parseEnv({
      ...VALID,
      VITE_APP_ENV: ' prod ',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_clave_de_prueba',
    })

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
        {
          variable: 'VITE_CLERK_PUBLISHABLE_KEY',
          problem: 'Falta o está vacía.',
        },
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

  describe('clave publicable de Clerk', () => {
    const clerkIssue = (problem: string) => ({
      ok: false,
      issues: [{ variable: 'VITE_CLERK_PUBLISHABLE_KEY', problem }],
    })

    it('falta: la app no arranca', () => {
      const result = parseEnv({ ...VALID, VITE_CLERK_PUBLISHABLE_KEY: '' })

      expect(result).toEqual(clerkIssue('Falta o está vacía.'))
    })

    it.each([
      'clave_sin_prefijo',
      'pk_otra_clave',
      'pk_test_',
      'sb_publishable_x',
    ])('rechaza %s por el formato', (key) => {
      const result = parseEnv({ ...VALID, VITE_CLERK_PUBLISHABLE_KEY: key })

      expect(result).toEqual(
        clerkIssue('Tiene que empezar por pk_test_ o pk_live_.'),
      )
    })

    it('rechaza una clave secreta con un mensaje propio', () => {
      const result = parseEnv({
        ...VALID,
        VITE_CLERK_PUBLISHABLE_KEY: 'sk_test_valor_de_prueba',
      })

      expect(result).toEqual(
        clerkIssue(
          'Es una clave secreta de Clerk; usa la clave publicable (pk_test_ o pk_live_).',
        ),
      )
    })

    it('rechaza la clave de producción con VITE_APP_ENV=dev', () => {
      const result = parseEnv({
        ...VALID,
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_clave_de_prueba',
      })

      expect(result).toEqual(
        clerkIssue(
          'Es una clave de producción (pk_live_); con VITE_APP_ENV=dev usa la de desarrollo (pk_test_).',
        ),
      )
    })

    it('rechaza la clave de desarrollo con VITE_APP_ENV=prod', () => {
      const result = parseEnv({ ...VALID, VITE_APP_ENV: 'prod' })

      expect(result).toEqual(
        clerkIssue(
          'Es una clave de desarrollo (pk_test_); con VITE_APP_ENV=prod usa la de producción (pk_live_).',
        ),
      )
    })

    it('con un ambiente inválido solo comprueba el formato', () => {
      const result = parseEnv({
        ...VALID,
        VITE_APP_ENV: 'staging',
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_clave_de_prueba',
      })

      expect(
        !result.ok && result.issues.map((issue) => issue.variable),
      ).toEqual(['VITE_APP_ENV'])
    })
  })

  it('nunca incluye los valores en los problemas', () => {
    const invalid = {
      VITE_SUPABASE_URL: 'http://valor-visible.example',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_valor_visible',
      VITE_APP_ENV: 'valor-visible',
      VITE_CLERK_PUBLISHABLE_KEY: 'sk_live_valor_visible',
    }
    const otherInvalidKeys = [
      { ...VALID, VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_valor_visible' },
      { ...VALID, VITE_CLERK_PUBLISHABLE_KEY: 'valor_visible' },
    ]

    for (const source of [invalid, ...otherInvalidKeys]) {
      expect(JSON.stringify(parseEnv(source))).not.toContain('valor-visible')
      expect(JSON.stringify(parseEnv(source))).not.toContain('valor_visible')
    }
  })
})
