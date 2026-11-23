import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Logo } from './Logo.tsx'

describe('Logo', () => {
  it('por defecto es el logotipo completo, con el nombre de la app como texto alternativo', () => {
    render(<Logo className="h-[40px] w-auto" />)
    const logo = screen.getByRole('img', { name: 'orqui.app' })
    expect(logo).toHaveAttribute('width', '384')
    expect(logo).toHaveAttribute('height', '116')
    expect(logo).toHaveClass('h-[40px]', 'w-auto')
    // En línea en el JavaScript: se ve sin conexión, sin otra petición.
    expect(logo.getAttribute('src')).toMatch(
      /orqui-apps-light\.svg|^data:image\/svg\+xml/,
    )
  })

  it('la variante symbol es solo la flor, cuadrada y con el mismo nombre', () => {
    render(<Logo variant="symbol" />)
    const logo = screen.getByRole('img', { name: 'orqui.app' })
    expect(logo).toHaveAttribute('width', '512')
    expect(logo).toHaveAttribute('height', '512')
    expect(logo.getAttribute('src')).toMatch(
      /orqui-apps-light-icon\.svg|^data:image\/svg\+xml/,
    )
  })

  it('la variante compact es el logotipo y, hasta 720 px, la flor (una sola imagen)', () => {
    const { container } = render(<Logo variant="compact" className="logo" />)
    const logo = screen.getByRole('img', { name: 'orqui.app' })
    expect(logo).toHaveAttribute('width', '384')
    expect(logo).toHaveClass('logo')
    const source = container.querySelector('picture > source')
    expect(source).toHaveAttribute('media', '(max-width: 720px)')
    expect(source).toHaveAttribute('width', '512')
    expect(source?.getAttribute('srcset')).toMatch(
      /orqui-apps-light-icon\.svg|^data:image\/svg\+xml/,
    )
  })
})
