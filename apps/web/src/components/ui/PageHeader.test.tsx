import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { Page } from '../Page.tsx'
import { Button } from './Button.tsx'
import { PageHeader } from './PageHeader.tsx'

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
})

describe('PageHeader', () => {
  it('título h1, contador, dos acciones e ilustración decorativa', async () => {
    render(
      <main>
        <PageHeader
          title="Mi colección"
          meta="18 ejemplares · 5 géneros"
          actions={
            <>
              <Button variant="primary" icon="plus">
                Registrar orquídea
              </Button>
              <Button icon="circle-check">¿Ya la tengo?</Button>
            </>
          }
        />
      </main>,
    )

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Mi colección',
    })
    expect(heading).toHaveClass('orki-pagehead__title')
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(heading.closest('.orki-pagehead')).not.toHaveClass(
      'orki-pagehead--center',
    )
    expect(screen.getByText('18 ejemplares · 5 géneros')).toHaveClass(
      'orki-pagehead__meta',
    )
    const actions = document.querySelector('.orki-pagehead__actions')
    expect(actions?.children).toHaveLength(2)
    // Decorativa: sin nombre y fuera del árbol de accesibilidad.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const art = document.querySelector('img.orki-pagehead__art')
    expect(art).toHaveAttribute('alt', '')
    expect(art?.getAttribute('srcset')).toMatch(/ 240w, .* 480w$/)
    await expectNoAxeViolations()
  })

  it('centrada, con enlace de volver y sin acciones ni ilustración', async () => {
    render(
      <main>
        <PageHeader
          variant="center"
          art={false}
          title="¿Ya la tengo?"
          meta="Comprueba si una orquídea ya está en tu colección"
          back={
            <a className="orki-link orki-pagehead__back" href="/coleccion">
              Volver a Mi colección
            </a>
          }
          actions={<Button>No se pinta</Button>}
        />
      </main>,
    )

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.closest('.orki-pagehead')).toHaveClass(
      'orki-pagehead--center',
    )
    expect(
      screen.getByRole('link', { name: 'Volver a Mi colección' }),
    ).toHaveClass('orki-pagehead__back')
    expect(document.querySelector('.orki-pagehead__art')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'No se pinta' }),
    ).not.toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('Page con header: pone el título de la pestaña y usa la cabecera', () => {
    render(
      <MemoryRouter>
        <Page
          title="Mi colección"
          width="wide"
          header={{ meta: '1 ejemplar · 1 género' }}
        >
          <p>Contenido</p>
        </Page>
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Mi colección' }),
    ).toHaveClass('orki-pagehead__title')
    expect(document.title).toBe('Mi colección · orqui.apps')
  })
})
