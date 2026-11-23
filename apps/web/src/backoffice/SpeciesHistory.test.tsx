import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CatalogAdminError,
  type CatalogSpeciesDetail,
  type SpeciesHistoryEntry,
  type SpeciesHistoryPage,
} from '../lib/catalogAdmin.ts'
import { createSampleCatalogSource } from '../showcase/catalog-admin-data.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { CatalogAdminView } from './CatalogAdminView.tsx'
import type { CatalogAdminSource } from './source.ts'
import { SpeciesHistory } from './SpeciesHistory.tsx'
import {
  INITIAL_CATALOG_ADMIN_STATE,
  type CatalogAdminState,
} from './url-state.ts'

// Historial de una especie en el backoffice (#133): estados de carga, vacío y
// error con reintento, cada entrada en palabras con sus valores (antes →
// después), "Ver más" por clave, actualización tras guardar sin recargar,
// teclado y axe. La fuente de datos es la de la muestra o una simulada: sin red.

const SPECIES_ID = '22222222-2222-4222-8222-000000000001'
const PHAL = '33333333-3333-4333-8333-333333333333'
const VANDA = '33333333-3333-4333-8333-444444444444'

const SPECIES: CatalogSpeciesDetail = {
  id: SPECIES_ID,
  scientificName: 'Phalaenopsis amabilis',
  genusId: PHAL,
  genusName: 'Phalaenopsis',
  type: 'species',
  status: 'validated',
  source: 'col',
  sourceRef: '4FR2J',
  createdAt: '2026-11-20T14:37:00Z',
  updatedAt: '2026-11-21T08:15:00Z',
  names: [
    { id: 'n1', name: 'orquídea mariposa', type: 'common', language: 'es' },
  ],
  referencePhoto: null,
}

function entry(
  id: number,
  extra: Partial<SpeciesHistoryEntry> = {},
): SpeciesHistoryEntry {
  return {
    id,
    actionId: `accion-${id}`,
    actor: 'user_2NxbVd1QeR5ZkT9mFh3LpA7sW8c',
    action: null,
    details: null,
    createdAt: '2026-11-21T08:15:00Z',
    changes: [
      {
        table: 'species',
        rowId: SPECIES_ID,
        action: 'update',
        oldValues: { status: 'imported' },
        newValues: { status: 'validated' },
      },
    ],
    otherChangeCount: 0,
    genusNames: {},
    ...extra,
  }
}

function sourceWith(
  speciesHistory: CatalogAdminSource['speciesHistory'],
): CatalogAdminSource {
  return { ...createSampleCatalogSource('ejemplo', 0), speciesHistory }
}

function Harness({ source }: { source: CatalogAdminSource }) {
  const [revision, setRevision] = useState(0)
  return (
    <>
      <SpeciesHistory species={SPECIES} source={source} revision={revision} />
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        Guardado
      </button>
    </>
  )
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Historial de una especie · orqui.app'
})

function historySection() {
  return screen.getByRole('region', { name: 'Historial' })
}

describe('Historial de una especie', () => {
  it('cargando, y después las entradas en palabras con sus valores', async () => {
    let resolve: (page: SpeciesHistoryPage) => void = () => {}
    const load = vi.fn<CatalogAdminSource['speciesHistory']>(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    render(<Harness source={sourceWith(load)} />)
    expect(
      within(historySection()).getByText('Cargando el historial…'),
    ).toHaveAttribute('role', 'status')
    expect(load.mock.calls[0]?.[0]).toBe(SPECIES_ID)
    expect(load.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)

    resolve({
      hasMore: false,
      entries: [
        entry(5, {
          action: 'merge_species',
          actor: 'user_2NxbVd1QeR5ZkT9mFh3LpA7sW8c',
          otherChangeCount: 2,
          changes: [
            {
              table: 'species_names',
              rowId: 'n9',
              action: 'insert',
              oldValues: null,
              newValues: {
                species_id: SPECIES_ID,
                name: 'Phalaenopsis grandiflora',
                type: 'synonym',
                language: null,
              },
            },
          ],
        }),
        entry(4, {
          actor: 'carga-col26.10',
          genusNames: { [PHAL]: 'Phalaenopsis' },
          changes: [
            {
              table: 'species',
              rowId: SPECIES_ID,
              action: 'update',
              oldValues: { genus_id: VANDA, type: 'hybrid' },
              newValues: { genus_id: PHAL, type: 'species' },
            },
          ],
        }),
        entry(3, {
          changes: [
            {
              table: 'species_names',
              rowId: 'n1',
              action: 'update',
              oldValues: { language: null },
              newValues: { language: 'es' },
            },
          ],
        }),
        entry(2, {
          changes: [
            {
              table: 'species',
              rowId: SPECIES_ID,
              action: 'delete',
              oldValues: {
                id: SPECIES_ID,
                scientific_name: 'Phalaenopsis amabilis',
                genus_id: PHAL,
                type: 'species',
                status: 'imported',
                source: 'col',
                source_ref: '4FR2J',
                created_at: '2026-11-20T14:37:00Z',
              },
              newValues: null,
            },
            {
              table: 'species_names',
              rowId: 'n7',
              action: 'delete',
              oldValues: {
                species_id: SPECIES_ID,
                name: 'moth orchid',
                type: 'common',
                language: 'en',
              },
              newValues: null,
            },
          ],
          genusNames: { [PHAL]: 'Phalaenopsis' },
        }),
      ],
    })

    const list = await within(historySection()).findByRole('list', {
      name: 'Historial',
    })
    const items = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.parentElement === list)
    expect(items).toHaveLength(4)
    const [merge, genus, name, removal] = items as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ]

    // Una acción con sentido propio es una sola entrada, con sus cambios.
    expect(merge).toHaveTextContent('Fusión de especies')
    expect(merge).toHaveTextContent('por user_2Nxb…sW8c')
    expect(within(merge).getByText('user_2Nxb…sW8c')).toHaveAttribute(
      'title',
      'user_2NxbVd1QeR5ZkT9mFh3LpA7sW8c',
    )
    expect(merge).toHaveTextContent(
      'Nombre añadido: «Phalaenopsis grandiflora»',
    )
    expect(merge).toHaveTextContent('Tipo de nombreSinónimo')
    expect(merge).toHaveTextContent('Y 2 cambios en otras filas del catálogo.')
    expect(within(merge).getByText(/de noviembre de 2026/)).toHaveAttribute(
      'dateTime',
      '2026-11-21T08:15:00Z',
    )

    // Edición: etiquetas legibles y antes → después, con el nombre del género.
    expect(genus).toHaveTextContent('Edición')
    expect(genus).toHaveTextContent('por carga «carga-col26.10»')
    const genusValue = within(genus).getByText('Género').nextElementSibling
    expect(genusValue).toHaveTextContent(
      'antes: un género que ya no existe →, después: Phalaenopsis',
    )
    expect(genus).toHaveTextContent('Tipoantes: Híbrido →, después: Especie')

    // Un nombre editado sin el texto en los valores: se toma del detalle.
    expect(name).toHaveTextContent('Nombre editado: «orquídea mariposa»')
    expect(name).toHaveTextContent('Idioma')
    expect(name).toHaveTextContent('sin valor')

    // Una baja con sus nombres: el título es el de la especie, sin columnas internas.
    expect(removal).toHaveTextContent('Baja')
    expect(removal).toHaveTextContent('EstadoImportada')
    expect(removal).toHaveTextContent('FuenteCatalogue of Life')
    expect(removal).not.toHaveTextContent(SPECIES_ID)
    expect(removal).toHaveTextContent('Nombre quitado: «moth orchid»')

    await expectNoAxeViolations()
  })

  it('una foto de referencia retirada, con el motivo y la foto (#234)', async () => {
    render(
      <Harness
        source={sourceWith(() =>
          Promise.resolve({
            hasMore: false,
            entries: [
              entry(7, {
                action: 'retire_species_photo',
                changes: [],
                details: {
                  reason: 'author_request',
                  source_photo_id: '12345',
                  author_name: 'Ana Pérez',
                  license: 'cc-by-sa',
                },
              }),
            ],
          }),
        )}
      />,
    )
    expect(
      await within(historySection()).findByText('Foto de referencia retirada'),
    ).toBeInTheDocument()
    expect(
      within(historySection()).getByText(
        'Motivo: a petición del autor. Foto 12345 de iNaturalist, de Ana Pérez (CC BY-SA 4.0).',
      ),
    ).toBeInTheDocument()
  })

  it('vacío: sin cambios registrados', async () => {
    render(
      <Harness
        source={sourceWith(() =>
          Promise.resolve({ entries: [], hasMore: false }),
        )}
      />,
    )
    expect(
      await within(historySection()).findByText('Sin cambios registrados.'),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('error con reintento', async () => {
    const load = vi
      .fn<CatalogAdminSource['speciesHistory']>()
      .mockRejectedValueOnce(new CatalogAdminError('offline'))
      .mockResolvedValue({ entries: [entry(1)], hasMore: false })
    const user = userEvent.setup()
    render(<Harness source={sourceWith(load)} />)
    const alert = await within(historySection()).findByRole('alert')
    expect(alert).toHaveTextContent('Sin conexión')
    await expectNoAxeViolations()

    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(
      await within(historySection()).findByText('Edición'),
    ).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('ver más: pide la página siguiente por clave, la añade y lleva el foco a la primera nueva', async () => {
    const load = vi.fn<CatalogAdminSource['speciesHistory']>(
      (_id, options = {}) =>
        Promise.resolve(
          options.before === undefined
            ? { entries: [entry(30), entry(29)], hasMore: true }
            : options.before === 29
              ? {
                  entries: [
                    entry(12, {
                      changes: [
                        {
                          table: 'species',
                          rowId: SPECIES_ID,
                          action: 'insert',
                          oldValues: null,
                          newValues: {
                            scientific_name: 'Phalaenopsis amabilis',
                            status: 'validated',
                          },
                        },
                      ],
                    }),
                  ],
                  hasMore: false,
                }
              : Promise.reject(new Error('clave inesperada')),
        ),
    )
    const user = userEvent.setup()
    render(<Harness source={sourceWith(load)} />)
    const more = await within(historySection()).findByRole('button', {
      name: 'Ver más cambios del historial',
    })
    await user.click(more)

    const added = await within(historySection()).findByText('Alta')
    expect(load).toHaveBeenLastCalledWith(
      SPECIES_ID,
      expect.objectContaining({ before: 29 }),
    )
    await waitFor(() => expect(added.closest('li')).toHaveFocus())
    expect(
      within(historySection()).queryByRole('button', { name: /Ver más/ }),
    ).not.toBeInTheDocument()
    expect(
      within(historySection()).getByText(
        'Se cargaron 1 cambio más del historial.',
      ),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('ver más que falla: avisa y deja reintentar', async () => {
    const load = vi
      .fn<CatalogAdminSource['speciesHistory']>()
      .mockResolvedValueOnce({ entries: [entry(30)], hasMore: true })
      .mockRejectedValueOnce(new CatalogAdminError('failed'))
      .mockResolvedValueOnce({ entries: [entry(10)], hasMore: false })
    const user = userEvent.setup()
    render(<Harness source={sourceWith(load)} />)
    await user.click(
      await within(historySection()).findByRole('button', {
        name: 'Ver más cambios del historial',
      }),
    )
    expect(
      await within(historySection()).findByRole('alert'),
    ).toHaveTextContent('No se pudieron cargar más cambios.')
    await user.click(
      within(historySection()).getByRole('button', {
        name: 'Reintentar cambios del historial',
      }),
    )
    await waitFor(() =>
      expect(within(historySection()).getAllByText('Edición')).toHaveLength(2),
    )
    expect(load).toHaveBeenLastCalledWith(
      SPECIES_ID,
      expect.objectContaining({ before: 30 }),
    )
  })

  it('al guardar un cambio se vuelve a leer y empieza de nuevo, sin pasar por cargando', async () => {
    const load = vi
      .fn<CatalogAdminSource['speciesHistory']>()
      .mockResolvedValueOnce({ entries: [entry(1)], hasMore: false })
      .mockResolvedValueOnce({
        entries: [
          entry(2, { action: 'validate_plant', changes: [] }),
          entry(1),
        ],
        hasMore: false,
      })
    const user = userEvent.setup()
    render(<Harness source={sourceWith(load)} />)
    await within(historySection()).findByText('Edición')
    await user.click(screen.getByRole('button', { name: 'Guardado' }))
    expect(within(historySection()).getByText('Edición')).toBeInTheDocument()
    expect(
      await within(historySection()).findByText('Validación de una propuesta'),
    ).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('Historial en el detalle de la especie', () => {
  function View() {
    const [state, setState] = useState<CatalogAdminState>(
      INITIAL_CATALOG_ADMIN_STATE,
    )
    const [source] = useState(() => createSampleCatalogSource('ejemplo', 0))
    return (
      <CatalogAdminView
        state={state}
        onStateChange={setState}
        source={source}
      />
    )
  }

  it('tras editar la especie y sus nombres, el historial muestra el cambio sin recargar', async () => {
    const user = userEvent.setup()
    render(<View />)
    const [search] = await screen.findAllByRole('searchbox')
    await user.type(search, 'Phalaenopsis amabilis')
    await user.click(
      await screen.findByRole(
        'button',
        { name: 'Phalaenopsis amabilis' },
        { timeout: 3000 },
      ),
    )
    const panel = await screen.findByRole('region', {
      name: 'Detalle de Phalaenopsis amabilis',
    })
    const history = await within(panel).findByRole('list', {
      name: 'Historial',
    })
    // Las entradas de ejemplo de la muestra.
    expect(history).toHaveTextContent('Fusión de especies')
    expect(history).toHaveTextContent('Carga del catálogo')
    expect(history).toHaveTextContent('por carga «carga-col26.10»')
    await expectNoAxeViolations()

    await user.click(
      within(panel).getByRole('button', { name: 'Editar la especie' }),
    )
    await user.selectOptions(
      within(panel).getByRole('combobox', { name: 'Estado' }),
      'Observada',
    )
    await user.click(
      within(panel).getByRole('button', { name: 'Guardar cambios' }),
    )

    await waitFor(() => {
      const first = within(
        within(panel).getByRole('list', { name: 'Historial' }),
      ).getAllByRole('listitem')[0]
      expect(first).toHaveTextContent('Edición')
      expect(first).toHaveTextContent(
        'Estadoantes: Importada →, después: Observada',
      )
    })

    await user.click(
      within(panel).getByRole('button', {
        name: 'Quitar el nombre común moth orchid',
      }),
    )
    await user.click(await screen.findByRole('button', { name: 'Quitar' }))
    await waitFor(() =>
      expect(
        within(
          within(panel).getByRole('list', { name: 'Historial' }),
        ).getAllByRole('listitem')[0],
      ).toHaveTextContent('Nombre quitado: «moth orchid»'),
    )
    await expectNoAxeViolations()
  })
})
