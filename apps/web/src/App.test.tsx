import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'

describe('App', () => {
  it('muestra la pantalla de marcador de Orki', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Orki' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Tu colección de orquídeas, siempre a mano.'),
    ).toBeInTheDocument()
  })
})
