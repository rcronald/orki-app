import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EnvironmentBadge } from './EnvironmentBadge.tsx'

describe('EnvironmentBadge', () => {
  it('se ve en desarrollo, con el ambiente en texto', () => {
    render(<EnvironmentBadge env="dev" />)

    expect(screen.getByText('Desarrollo')).toBeVisible()
    expect(screen.getByText('Ambiente:', { exact: false })).toBeInTheDocument()
  })

  it('no se ve en producción', () => {
    const { container } = render(<EnvironmentBadge env="prod" />)

    expect(container).toBeEmptyDOMElement()
  })
})
