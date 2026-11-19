import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseEnv } from '../config/env.ts'
import { ConfigError } from './ConfigError.tsx'

describe('ConfigError', () => {
  it('nombra cada variable que falla, sin mostrar valores', () => {
    const result = parseEnv({
      VITE_SUPABASE_URL: 'http://valor-visible.example',
      VITE_APP_ENV: 'dev',
    })
    if (result.ok) throw new Error('Se esperaba una configuración inválida')

    const { container } = render(<ConfigError issues={result.issues} />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'La app no está bien configurada',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('VITE_SUPABASE_URL')).toBeInTheDocument()
    expect(
      screen.getByText('VITE_SUPABASE_PUBLISHABLE_KEY'),
    ).toBeInTheDocument()
    expect(screen.queryByText('VITE_APP_ENV')).not.toBeInTheDocument()
    expect(container).not.toHaveTextContent('valor-visible')
  })
})
