import {
  configure,
  getConfig,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { CatalogAdminError } from '../lib/catalogAdmin.ts'
import { createSampleCatalogSource } from '../showcase/catalog-admin-data.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { CatalogAdminView } from './CatalogAdminView.tsx'
import type { CatalogAdminSource } from './source.ts'
import {
  INITIAL_CATALOG_ADMIN_STATE,
  type CatalogAdminState,
} from './url-state.ts'

// Cola de propuestas (#140): la pestaña "Por validar" con su número, los
// grupos con nombre, género, tipo, plantas y fotos ampliables, las tres
// acciones con teclado (enlazar con el buscador precargado, crear la especie
// con el formulario relleno, no identificable con confirmación), el grupo que
// sale de la lista y se anuncia, el grupo que otro administrador ya resolvió,
// los estados (vacía, cargando, error con reintento, sin conexión), que la
// ruta de las fotos no llega al DOM y axe. Con la fuente en memoria de la
// muestra: sin red.

type User = ReturnType<typeof userEvent.setup>

function View({
  source,
  initial = { ...INITIAL_CATALOG_ADMIN_STATE, tab: 'propuestas' },
}: {
  source: CatalogAdminSource
  initial?: CatalogAdminState
}) {
  const [state, setState] = useState<CatalogAdminState>(initial)
  return (
    <MemoryRouter>
      <CatalogAdminView
        state={state}
        onStateChange={setState}
        source={source}
      />
    </MemoryRouter>
  )
}

const defaultTimeout = getConfig().asyncUtilTimeout
beforeAll(() => configure({ asyncUtilTimeout: 4000 }))
afterAll(() => configure({ asyncUtilTimeout: defaultTimeout }))

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Cola de propuestas · orqui.app'
})

/** La tarjeta de un grupo, por su nombre propuesto. */
async function card(name: string) {
  const heading = await screen.findByRole('heading', { name: `«${name}»` })
  const item = heading.closest('li')
  if (!item) throw new Error(`sin tarjeta para ${name}`)
  return item
}

/** Pulsa un botón con el teclado: Tab hasta él no es práctico, así que foco y Enter. */
async function press(user: User, button: HTMLElement) {
  button.focus()
  await user.keyboard('{Enter}')
}

function status() {
  return screen
    .getAllByRole('status')
    .map((element) => element.textContent ?? '')
    .join(' | ')
}

describe('Cola de propuestas', () => {
  it('muestra la pestaña con su número y cada grupo con nombre, género, tipo, plantas y fotos, sin rutas en el DOM', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const { container } = render(<View source={source} />)

    const tab = await screen.findByRole('tab', {
      name: 'Por validar, 3 grupos',
    })
    expect(tab).toHaveAttribute('aria-selected', 'true')

    const rosa = await card('Phalaenopsis Rosa del Monte')
    expect(rosa).toHaveTextContent('Phalaenopsis · Híbrido · 4 plantas')
    const photos = within(rosa).getAllByRole('button', { name: /^Ampliar/ })
    // Hasta seis por grupo (#184), de varias plantas.
    expect(photos).toHaveLength(6)
    const abuela = await card('Cattleya de la abuela')
    expect(abuela).toHaveTextContent('Cattleya · Tipo sin indicar · 2 plantas')
    const vanda = await card('Vanda azul ficticia')
    expect(vanda).toHaveTextContent('Sin fotos.')

    // Orden: del grupo con más plantas al que tiene menos.
    const names = within(screen.getByRole('tabpanel'))
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(names).toEqual([
      '«Phalaenopsis Rosa del Monte»',
      '«Cattleya de la abuela»',
      '«Vanda azul ficticia»',
    ])

    // Las miniaturas, con su URL de objeto (alt vacío: el botón la nombra).
    await waitFor(() => expect(rosa.querySelectorAll('img')).toHaveLength(6))
    expect(container.innerHTML).not.toContain('muestra/')
    expect(document.body.innerHTML).not.toMatch(/photo-|thumb-/)
    await expectNoAxeViolations()
  })

  it('amplía una foto y recorre las del grupo con el teclado', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const user = userEvent.setup()
    render(<View source={source} />)
    const rosa = await card('Phalaenopsis Rosa del Monte')
    const opener = within(rosa).getByRole('button', {
      name: 'Ampliar la foto 1 de 6 de «Phalaenopsis Rosa del Monte»',
    })
    await press(user, opener)
    const dialog = await screen.findByRole('dialog', {
      name: 'Fotos de «Phalaenopsis Rosa del Monte»',
    })
    expect(
      await within(dialog).findByRole('img', {
        name: 'Foto 1 de 6 de «Phalaenopsis Rosa del Monte»',
      }),
    ).toBeInTheDocument()
    await press(user, within(dialog).getByRole('button', { name: 'Siguiente' }))
    expect(
      await within(dialog).findByRole('img', {
        name: 'Foto 2 de 6 de «Phalaenopsis Rosa del Monte»',
      }),
    ).toBeInTheDocument()
    // Hasta la última de las seis; ahí "Siguiente" ya no avanza.
    const next = within(dialog).getByRole('button', { name: 'Siguiente' })
    for (let step = 0; step < 5; step++) await press(user, next)
    expect(
      await within(dialog).findByRole('img', {
        name: 'Foto 6 de 6 de «Phalaenopsis Rosa del Monte»',
      }),
    ).toBeInTheDocument()
    expect(next).toHaveAttribute('aria-disabled', 'true')
    expect(document.body.innerHTML).not.toMatch(/photo-|thumb-/)
    await expectNoAxeViolations()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('enlaza un grupo con el buscador precargado y el teclado; el grupo sale de la lista y se anuncia', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const linkProposal = vi.spyOn(source, 'linkProposal')
    const user = userEvent.setup()
    render(<View source={source} />)

    const abuela = await card('Cattleya de la abuela')
    await press(
      user,
      within(abuela).getByRole('button', { name: /^Enlazar a una especie/ }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Enlazar a una especie del catálogo',
    })
    const field = within(dialog).getByRole('combobox', { name: 'Especie' })
    expect(field).toHaveFocus()
    expect(field).toHaveValue('Cattleya de la abuela')
    expect(dialog).toHaveAccessibleDescription(/Cattleya de la abuela/)
    // "Enlazar" no responde sin especie elegida.
    const confirm = within(dialog).getByRole('button', {
      name: 'Enlazar 2 plantas',
    })
    expect(confirm).toHaveAttribute('aria-disabled', 'true')

    await user.clear(field)
    await user.type(field, 'Cattleya labiata')
    await within(dialog).findByRole('option', {}, { timeout: 3000 })
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(confirm).toHaveFocus())
    expect(dialog).toHaveTextContent('Cattleya labiata')
    await expectNoAxeViolations()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(linkProposal).toHaveBeenCalledWith(
      expect.objectContaining({ nameKey: 'cattleya de la abuela' }),
      expect.any(String),
    )
    await waitFor(() =>
      expect(status()).toContain(
        'Se enlazaron 2 plantas de «Cattleya de la abuela» a Cattleya labiata.',
      ),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: '«Cattleya de la abuela»' }),
      ).not.toBeInTheDocument(),
    )
    expect(
      await screen.findByRole('tab', { name: 'Por validar, 2 grupos' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Propuestas por validar' }),
    ).toHaveFocus()
  })

  it('crea la especie con el formulario ya relleno y la enlaza', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const create = vi.spyOn(source, 'createSpeciesFromProposal')
    const user = userEvent.setup()
    render(<View source={source} />)

    const rosa = await card('Phalaenopsis Rosa del Monte')
    await press(
      user,
      within(rosa).getByRole('button', { name: /^Crear la especie/ }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Crear la especie desde la propuesta',
    })
    const name = within(dialog).getByRole('textbox', {
      name: 'Nombre científico',
    })
    expect(name).toHaveFocus()
    expect(name).toHaveValue('Phalaenopsis Rosa del Monte')
    expect(within(dialog).getByRole('combobox', { name: 'Tipo' })).toHaveValue(
      'hybrid',
    )
    expect(
      within(dialog).queryByRole('combobox', { name: 'Estado' }),
    ).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent('«Propuesta de usuario»')
    expect(dialog).toHaveTextContent('las 4 plantas del grupo')
    await expectNoAxeViolations()

    await user.clear(name)
    await user.type(name, 'Phalaenopsis Rosa Ficticia')
    await press(
      user,
      within(dialog).getByRole('button', { name: 'Dar de alta y enlazar' }),
    )
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ nameKey: 'phalaenopsis rosa del monte' }),
      expect.objectContaining({
        scientificName: 'Phalaenopsis Rosa Ficticia',
        type: 'hybrid',
      }),
    )
    await waitFor(() =>
      expect(status()).toContain(
        'Se dio de alta Phalaenopsis Rosa Ficticia y se le enlazaron 4 plantas de «Phalaenopsis Rosa del Monte».',
      ),
    )
    const created = await source.searchSpecies('Phalaenopsis Rosa Ficticia')
    expect(created.rows[0]).toMatchObject({
      status: 'validated',
      source: 'user_proposal',
    })
  })

  it('al crear, un nombre que ya existe se explica junto al campo y no resuelve nada', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const user = userEvent.setup()
    render(<View source={source} />)
    const rosa = await card('Phalaenopsis Rosa del Monte')
    await press(
      user,
      within(rosa).getByRole('button', { name: /^Crear la especie/ }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Crear la especie desde la propuesta',
    })
    const name = within(dialog).getByRole('textbox', {
      name: 'Nombre científico',
    })
    await user.clear(name)
    await user.type(name, 'phalaenopsis amabilis')
    await press(
      user,
      within(dialog).getByRole('button', { name: 'Dar de alta y enlazar' }),
    )
    await waitFor(() =>
      expect(name).toHaveAccessibleDescription(/Ya hay una especie/),
    )
    expect(name).toHaveFocus()
    expect(await source.countProposals()).toBe(3)
  })

  it('marca un grupo como no identificable con confirmación', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const mark = vi.spyOn(source, 'markProposalUnidentifiable')
    const user = userEvent.setup()
    render(<View source={source} />)

    const vanda = await card('Vanda azul ficticia')
    await press(
      user,
      within(vanda).getByRole('button', { name: /^No identificable/ }),
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Marcar como no identificable',
    })
    // Lo destructivo: el foco empieza en "Cancelar".
    expect(
      within(dialog).getByRole('button', { name: 'Cancelar' }),
    ).toHaveFocus()
    expect(dialog).toHaveAccessibleDescription(/sigue en la colección/)
    await expectNoAxeViolations()
    await press(
      user,
      within(dialog).getByRole('button', { name: 'Marcar 1 planta' }),
    )
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(mark).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(status()).toContain(
        '«Vanda azul ficticia» quedó como no identificable: 1 planta salen de la cola',
      ),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: '«Vanda azul ficticia»' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('si otro administrador ya resolvió el grupo, lo dice y refresca la lista', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const user = userEvent.setup()
    render(<View source={source} />)
    const abuela = await card('Cattleya de la abuela')
    await press(
      user,
      within(abuela).getByRole('button', { name: /^No identificable/ }),
    )
    const dialog = await screen.findByRole('alertdialog')
    // Mientras tanto, otro administrador lo resuelve.
    const [group] = (await source.listProposals()).rows.filter(
      (row) => row.proposedName === 'Cattleya de la abuela',
    )
    if (!group) throw new Error('sin grupo')
    await source.markProposalUnidentifiable(group)

    await press(
      user,
      within(dialog).getByRole('button', { name: 'Marcar 2 plantas' }),
    )
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await waitFor(() =>
      expect(status()).toContain(
        'Otro administrador ya resolvió «Cattleya de la abuela» (Cattleya) mientras tanto: no se cambió nada y la lista se actualizó.',
      ),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: '«Cattleya de la abuela»' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('cola vacía', async () => {
    render(<View source={createSampleCatalogSource('vacio', 0)} />)
    expect(
      await screen.findByText('No hay propuestas por validar.'),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('tab', { name: 'Por validar, 0 grupos' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('mientras carga se anuncia y no hay tarjetas', async () => {
    render(<View source={createSampleCatalogSource('cargando', 0)} />)
    expect(
      await screen.findByText('Cargando las propuestas…'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('tabpanel')).queryAllByRole('heading', {
        level: 3,
      }),
    ).toHaveLength(0)
  })

  it('sin conexión explica el motivo y reintenta', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const list = source.listProposals
    let fail = true
    source.listProposals = (options) =>
      fail ? Promise.reject(new CatalogAdminError('offline')) : list(options)
    const user = userEvent.setup()
    render(<View source={source} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Sin conexión')
    await expectNoAxeViolations()
    fail = false
    await press(user, within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(await card('Vanda azul ficticia')).toBeInTheDocument()
  })

  it('un fallo al leer ofrece reintentar', async () => {
    render(<View source={createSampleCatalogSource('fallo', 0)} />)
    const panel = screen.getByRole('tabpanel')
    const alert = await within(panel).findByRole('alert')
    expect(alert).toHaveTextContent('No se pudo consultar el catálogo')
    expect(
      within(alert).getByRole('button', { name: 'Reintentar' }),
    ).toBeInTheDocument()
  })
})
