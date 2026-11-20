import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import {
  CATTLEYA,
  PHALAENOPSIS,
  plant,
  RHYNCHOLAELIOCATTLEYA,
} from '../test/collection.ts'
import { InventoryView } from './InventoryView.tsx'
import { PREFERENCES_KEY } from './preferences.ts'

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Mi colección · Orki'
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderInventory(plants: readonly CollectionPlant[] | null) {
  return render(
    <MemoryRouter>
      <main>
        <InventoryView
          status={plants === null ? 'loading' : 'ready'}
          plants={plants}
          error={null}
          onRetry={() => {}}
        />
      </main>
    </MemoryRouter>,
  )
}

// Colección de ejemplo: dos Phalaenopsis, una Cattleya, un híbrido de género
// híbrido, una planta por validar y una perdida que no cuenta.
const amabilis = plant({
  displayName: 'Phalaenopsis amabilis',
  createdAt: '2026-11-01T10:00:00+00:00',
  nickname: 'La blanca',
})
const schilleriana = plant({
  displayName: 'Phalaenopsis schilleriana',
  createdAt: '2026-11-05T10:00:00+00:00',
})
const maxima = plant({
  displayName: 'Cattleya maxima',
  genus: CATTLEYA,
  createdAt: '2026-10-01T10:00:00+00:00',
})
const memoria = plant({
  displayName: '× Rhyncholaeliocattleya Memoria Anna Balmores',
  genus: RHYNCHOLAELIOCATTLEYA,
  type: 'hybrid',
  createdAt: '2026-11-10T10:00:00+00:00',
})
const pending = plant({
  displayName: 'la naranja del mercado',
  displayNameIsScientific: false,
  enteredName: 'la naranja del mercado',
  species: null,
  genus: CATTLEYA,
  validation: 'pending',
  createdAt: '2026-09-01T10:00:00+00:00',
})
const lost = plant({
  displayName: 'Phalaenopsis aphrodite',
  status: 'lost',
  createdAt: '2026-11-15T10:00:00+00:00',
})
const COLLECTION = [amabilis, schilleriana, maxima, memoria, pending, lost]

const cardNames = () =>
  screen
    .getAllByRole('article')
    .map((card) => card.getAttribute('aria-labelledby'))
    .map((id) => document.getElementById(id ?? '')?.textContent)

describe('InventoryView', () => {
  it('cuenta solo las orquídeas activas y sus géneros, en singular y en plural', () => {
    const { unmount } = renderInventory(COLLECTION)
    const summary = screen.getByRole('list', {
      name: 'Resumen de tu colección',
    })
    expect(
      within(summary)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['5 orquídeas', '3 géneros'])
    expect(screen.getAllByRole('article')).toHaveLength(5)
    unmount()

    renderInventory([amabilis])
    expect(
      within(
        screen.getByRole('list', { name: 'Resumen de tu colección' }),
      ).getAllByRole('listitem')[0],
    ).toHaveTextContent('1 orquídea')
    expect(screen.getByText('1 género')).toBeInTheDocument()
  })

  it('sin agrupar, las más recientes primero', () => {
    renderInventory(COLLECTION)
    expect(cardNames()).toEqual([
      '× Rhyncholaeliocattleya Memoria Anna Balmores',
      'Phalaenopsis schilleriana',
      'Phalaenopsis amabilis',
      'Cattleya maxima',
      'la naranja del mercado',
    ])
  })

  it('agrupa por género con su contador y en orden alfabético', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)

    const toggle = screen.getByRole('button', { name: 'Agrupar por género' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // El signo "×" no cuenta para ordenar: el híbrido va con la R.
    // El contador se lee con el género: "Cattleya, 2 orquídeas".
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings).toEqual([
      screen.getByRole('heading', { name: 'Cattleya, 2 orquídeas' }),
      screen.getByRole('heading', { name: 'Phalaenopsis, 2 orquídeas' }),
      screen.getByRole('heading', {
        name: '× Rhyncholaeliocattleya, 1 orquídea',
      }),
    ])
    const cattleya = screen.getByRole('region', {
      name: 'Cattleya, 2 orquídeas',
    })
    expect(
      within(cattleya)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Cattleya maxima', 'la naranja del mercado'])
    expect(cardNames()).toEqual([
      'Cattleya maxima',
      'la naranja del mercado',
      'Phalaenopsis amabilis',
      'Phalaenopsis schilleriana',
      '× Rhyncholaeliocattleya Memoria Anna Balmores',
    ])
  })

  it('una planta por validar se ve con su nombre ingresado, sin cursiva, y su etiqueta', () => {
    const unidentifiable = plant({
      displayName: 'regalo de la abuela',
      displayNameIsScientific: false,
      enteredName: 'regalo de la abuela',
      species: null,
      validation: 'unidentifiable',
    })
    renderInventory([pending, unidentifiable, maxima])

    for (const name of ['la naranja del mercado', 'regalo de la abuela']) {
      const card = screen.getByRole('article', { name })
      expect(within(card).getByRole('heading', { name })).toHaveClass(
        'not-italic',
        'font-body',
      )
      expect(within(card).getByText('Nombre por validar')).toBeInTheDocument()
    }
    const validated = screen.getByRole('article', { name: 'Cattleya maxima' })
    expect(within(validated).getByText('Validada')).toBeInTheDocument()
    expect(within(validated).getByText('Cattleya maxima')).toHaveClass('italic')
  })

  it('un híbrido conserva el "×" en redonda y muestra género y apodo', () => {
    renderInventory([memoria, amabilis])

    const hybrid = screen.getByRole('article', {
      name: '× Rhyncholaeliocattleya Memoria Anna Balmores',
    })
    expect(within(hybrid).getByText('×')).toHaveClass('not-italic')
    expect(within(hybrid).getByText('Memoria Anna Balmores')).toHaveClass(
      'not-italic',
    )
    expect(
      within(hybrid).getByText('× Rhyncholaeliocattleya', {
        selector: '.orki-card__meta',
      }),
    ).toBeInTheDocument()

    const withNickname = screen.getByRole('article', {
      name: 'Phalaenopsis amabilis',
    })
    expect(within(withNickname).getByText('La blanca')).toBeInTheDocument()
    expect(
      within(withNickname).getByText(PHALAENOPSIS.name, {
        selector: '.orki-card__meta',
      }),
    ).toBeInTheDocument()
    // Sin foto todavía (#10): el marcador neutro, con carga diferida.
    expect(
      within(withNickname).getByRole('img', { name: 'Sin foto' }),
    ).toHaveAttribute('loading', 'lazy')
  })

  it('cambia entre lista y cuadrícula y lo recuerda al volver', async () => {
    const user = userEvent.setup()
    const { unmount } = renderInventory(COLLECTION)

    const view = screen.getByRole('group', { name: 'Vista' })
    const list = within(view).getByRole('button', { name: 'Lista' })
    const grid = within(view).getByRole('button', { name: 'Cuadrícula' })
    expect(list).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('article')[0]).toHaveClass('flex-row')

    await user.click(grid)
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    expect(list).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('article')[0]).not.toHaveClass('flex-row')
    await user.click(screen.getByRole('button', { name: 'Agrupar por género' }))
    expect(
      JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? ''),
    ).toEqual({ view: 'grid', grouped: true })

    // Como al recargar: la pantalla se vuelve a montar y lee la preferencia.
    unmount()
    renderInventory(COLLECTION)
    expect(screen.getByRole('button', { name: 'Cuadrícula' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Agrupar por género' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('article')[0]).not.toHaveClass('flex-row')
  })

  it('una preferencia guardada que no se entiende se ignora', () => {
    window.localStorage.setItem(PREFERENCES_KEY, '{"view":"mosaico"')
    renderInventory(COLLECTION)
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('funciona sin almacenamiento local', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Bloqueado', 'SecurityError')
    })
    const user = userEvent.setup()
    renderInventory(COLLECTION)

    const grid = screen.getByRole('button', { name: 'Cuadrícula' })
    await user.click(grid)
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('article')[0]).not.toHaveClass('flex-row')
  })

  it('funciona si el almacenamiento local falla al leer o escribir', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Lleno', 'QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Lleno', 'QuotaExceededError')
    })
    const user = userEvent.setup()
    renderInventory(COLLECTION)

    const toggle = screen.getByRole('button', { name: 'Agrupar por género' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3)
  })

  it('ofrece registrar una planta', () => {
    renderInventory(COLLECTION)
    expect(
      screen.getByRole('link', { name: 'Registrar orquídea' }),
    ).toHaveAttribute('href', '/coleccion/nueva')
  })

  it('el orden del tabulador va del registro a los controles de vista', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)

    await user.tab()
    expect(
      screen.getByRole('link', { name: 'Registrar orquídea' }),
    ).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Cuadrícula' })).toHaveFocus()
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'Agrupar por género' }),
    ).toHaveFocus()
  })

  it('no tiene fallos A ni AA en lista, en cuadrícula y agrupada', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: 'Cuadrícula' }))
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: 'Agrupar por género' }))
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: 'Lista' }))
    await expectNoAxeViolations()
  })

  it('con 300 plantas se pinta entera y cambia de vista y de agrupación', async () => {
    const genera = [PHALAENOPSIS, CATTLEYA, RHYNCHOLAELIOCATTLEYA]
    const many = Array.from({ length: 300 }, (_, index) =>
      plant({
        displayName: `${genera[index % 3]?.name ?? ''} ejemplar ${index}`,
        genus: genera[index % 3] ?? PHALAENOPSIS,
        createdAt: new Date(
          Date.UTC(2026, 0, 1) + index * 60_000,
        ).toISOString(),
      }),
    )
    const user = userEvent.setup()
    renderInventory(many)

    expect(screen.getAllByRole('article')).toHaveLength(300)
    expect(screen.getByText('300 orquídeas')).toBeInTheDocument()
    expect(cardNames()[0]).toBe('× Rhyncholaeliocattleya ejemplar 299')

    await user.click(screen.getByRole('button', { name: 'Cuadrícula' }))
    expect(screen.getAllByRole('article')).toHaveLength(300)
    expect(screen.getAllByRole('article')[299]).not.toHaveClass('flex-row')

    await user.click(screen.getByRole('button', { name: 'Agrupar por género' }))
    expect(
      screen.getByRole('region', { name: 'Cattleya, 100 orquídeas' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(300)
  })
})
