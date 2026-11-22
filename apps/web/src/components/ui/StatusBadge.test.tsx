import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge } from './StatusBadge.tsx'

describe('StatusBadge', () => {
  it('validada: palabra e icono circle-check', () => {
    render(<StatusBadge status="validated" />)

    const badge = screen.getByText('Validada')
    expect(badge).toHaveClass('orki-badge', 'orki-badge--validated')
    const icon = badge.querySelector('svg')
    expect(icon).toHaveClass('lucide-circle-check')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('pendiente: palabra e icono triangle-alert', () => {
    render(<StatusBadge status="pending" />)

    const badge = screen.getByText('Nombre por validar')
    expect(badge).toHaveClass('orki-badge', 'orki-badge--pending')
    const icon = badge.querySelector('svg')
    expect(icon).toHaveClass('lucide-triangle-alert')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('no identificable: palabra, icono tag y estilo propio, distinto de pendiente', () => {
    render(<StatusBadge status="unidentifiable" />)

    const badge = screen.getByText('No identificable')
    expect(badge).toHaveClass('orki-badge', 'orki-badge--unidentifiable')
    expect(badge).not.toHaveClass('orki-badge--pending')
    const icon = badge.querySelector('svg')
    expect(icon).toHaveClass('lucide-tag')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('acepta className y atributos nativos', () => {
    render(<StatusBadge status="validated" className="extra" title="Estado" />)

    const badge = screen.getByText('Validada')
    expect(badge).toHaveClass('orki-badge', 'extra')
    expect(badge).toHaveAttribute('title', 'Estado')
  })
})
