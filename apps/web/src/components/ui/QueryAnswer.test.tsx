import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { Icon } from './Icon.tsx'
import { QueryAnswer, type QueryAnswerTone } from './QueryAnswer.tsx'

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
})

describe('QueryAnswer', () => {
  it('sí: fondo verde suave, icono check, dato y acción', async () => {
    render(
      <main>
        <QueryAnswer
          tone="yes"
          title="Sí, la tienes"
          detail="2 ejemplares"
          action={
            <a className="orki-link orki-answer__action" href="/coleccion">
              Ver en mi colección
              <Icon name="arrow-right" />
            </a>
          }
        />
      </main>,
    )

    const answer = screen.getByRole('status')
    expect(answer).toHaveClass('orki-answer', 'orki-answer--yes')
    expect(screen.getByText('Sí, la tienes')).toHaveClass('orki-answer__title')
    expect(screen.getByText('2 ejemplares')).toHaveClass('orki-answer__detail')
    expect(answer.querySelector('.orki-answer__icon svg')).toHaveClass(
      'lucide-check',
    )
    expect(
      screen.getByRole('link', { name: 'Ver en mi colección' }),
    ).toHaveClass('orki-answer__action')
    await expectNoAxeViolations()
  })

  it.each([
    ['similar', 'orki-answer--similar', 'lucide-layers'],
    ['no', null, 'lucide-search'],
    ['notice', 'orki-answer--notice', 'lucide-cloud-off'],
  ] as [QueryAnswerTone, string | null, string][])(
    'tono %s: su clase y su icono',
    (tone, className, icon) => {
      render(<QueryAnswer tone={tone} title="Título" />)

      const answer = screen.getByRole('status')
      expect(answer.className.split(' ').filter(Boolean)).toEqual(
        className ? ['orki-answer', className] : ['orki-answer'],
      )
      expect(answer.querySelector('.orki-answer__icon svg')).toHaveClass(icon)
      expect(answer.querySelector('.orki-answer__detail')).toBeNull()
    },
  )

  it('icono propio y sin región de estado con announce={false}', () => {
    render(
      <div role="status">
        <QueryAnswer
          tone="notice"
          icon="triangle-alert"
          title="Sin copia disponible"
          announce={false}
        />
      </div>,
    )

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(document.querySelector('.orki-answer__icon svg')).toHaveClass(
      'lucide-triangle-alert',
    )
  })
})
