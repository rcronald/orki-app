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
import { CatalogWriteError } from '../lib/catalogWrites.ts'
import { createSampleCatalogSource } from '../showcase/catalog-admin-data.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { CatalogAdminView } from './CatalogAdminView.tsx'
import type { CatalogAdminSource } from './source.ts'
import {
  INITIAL_CATALOG_ADMIN_STATE,
  type CatalogAdminState,
} from './url-state.ts'

// Fusión de especies desde el detalle (#136): elegir la otra especie con el
// buscador del catálogo, elegir cuál se conserva e intercambiarlas, vista
// previa (plantas, nombres que pasan y que ya existían, género, validada),
// "Fusionar" solo con la vista previa vigente, la conservada abierta y la lista,
// el resumen y el historial al día; especies que ya no existen, errores de
// conexión y de sesión, teclado, foco y axe. Con la fuente en memoria de la
// muestra: sin red.

type User = ReturnType<typeof userEvent.setup>

function View({ source }: { source: CatalogAdminSource }) {
  const [state, setState] = useState<CatalogAdminState>(
    INITIAL_CATALOG_ADMIN_STATE,
  )
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

// Cada prueba encadena muchas lecturas: con toda la suite en marcha, el
// segundo de espera por defecto se queda corto (como en CatalogAdminEditing).
const defaultTimeout = getConfig().asyncUtilTimeout
beforeAll(() => configure({ asyncUtilTimeout: 4000 }))
afterAll(() => configure({ asyncUtilTimeout: defaultTimeout }))

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Fusión de especies · orqui.apps'
})

async function idOf(source: CatalogAdminSource, name: string) {
  const { rows } = await source.searchSpecies(name)
  const row = rows.find((item) => item.scientificName === name)
  if (!row) throw new Error(`no está ${name}`)
  return row.id
}

/** Busca la especie en la tabla y abre su detalle. */
async function openDetail(user: User, name: string) {
  const [search] = await screen.findAllByRole('searchbox')
  if (!search) throw new Error('sin buscador')
  await user.type(search, name)
  await user.click(
    await screen.findByRole('button', { name }, { timeout: 3000 }),
  )
  return screen.findByRole('region', { name: `Detalle de ${name}` })
}

async function openMerge(user: User, panel: HTMLElement, name: string) {
  await user.click(
    within(panel).getByRole('button', { name: 'Fusionar con otra especie' }),
  )
  return screen.findByRole('dialog', {
    name: `Fusionar ${name} con otra especie`,
  })
}

/** Elige la otra especie con el teclado: escribir, flecha abajo y Enter. */
async function pickOther(user: User, dialog: HTMLElement, text: string) {
  const field = within(dialog).getByRole('combobox', { name: 'Otra especie' })
  await user.type(field, text)
  await within(dialog).findByRole('option', {}, { timeout: 3000 })
  await user.keyboard('{ArrowDown}{Enter}')
}

function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: /^Fusionar/ })
}

function preview(dialog: HTMLElement) {
  return within(dialog).getByRole('region', { name: 'Vista previa' })
}

describe('Fusión de especies', () => {
  it('flujo completo con teclado: elegir, intercambiar, vista previa, fusionar y abrir la conservada', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const equestris = await idOf(source, 'Phalaenopsis equestris')
    const amabilis = await idOf(source, 'Phalaenopsis amabilis')
    // Dos nombres que la conservada ya tiene (sin distinguir mayúsculas).
    await source.addName(equestris, {
      name: 'Orquídea Mariposa',
      type: 'common',
      language: 'es',
    })
    await source.addName(equestris, {
      name: 'Phalaenopsis Grandiflora',
      type: 'synonym',
    })
    const previewMerge = vi.spyOn(source, 'previewMerge')
    const mergeSpecies = vi.spyOn(source, 'mergeSpecies')
    const user = userEvent.setup()
    render(<View source={source} />)

    const panel = await openDetail(user, 'Phalaenopsis equestris')
    const opener = within(panel).getByRole('button', {
      name: 'Fusionar con otra especie',
    })
    const dialog = await openMerge(user, panel, 'Phalaenopsis equestris')
    const field = within(dialog).getByRole('combobox', { name: 'Otra especie' })
    expect(field).toHaveFocus()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(/no se puede deshacer|duplicado/)

    // Sin vista previa no se puede confirmar.
    expect(confirmButton(dialog)).toHaveAttribute('aria-disabled', 'true')
    expect(confirmButton(dialog)).toHaveAccessibleDescription(
      /espera a la vista previa/,
    )
    await user.click(confirmButton(dialog))
    expect(mergeSpecies).not.toHaveBeenCalled()
    await expectNoAxeViolations()

    // El buscador no ofrece la especie del detalle.
    await user.type(field, 'phal eq')
    expect(
      await within(dialog).findByText('Ninguna otra especie coincide'),
    ).toBeInTheDocument()
    await user.clear(field)
    await pickOther(user, dialog, 'phal amab')

    // Ninguna se conserva hasta elegirlo; el foco va a la primera opción.
    const keepThis = within(dialog).getByRole('radio', {
      name: 'Conservar «Phalaenopsis equestris» (la de este detalle)',
    })
    const keepOther = within(dialog).getByRole('radio', {
      name: 'Conservar «Phalaenopsis amabilis» (la que elegiste)',
    })
    await waitFor(() => expect(keepThis).toHaveFocus())
    expect(keepThis).not.toBeChecked()
    expect(keepOther).not.toBeChecked()
    expect(previewMerge).not.toHaveBeenCalled()
    expect(
      within(dialog).queryByRole('region', { name: 'Vista previa' }),
    ).not.toBeInTheDocument()

    await user.keyboard(' ')
    expect(keepThis).toBeChecked()
    await waitFor(() =>
      expect(preview(dialog)).toHaveTextContent(
        'Ninguna planta de usuarios tiene enlazada «Phalaenopsis amabilis»',
      ),
    )
    expect(previewMerge).toHaveBeenLastCalledWith(
      amabilis,
      equestris,
      expect.anything(),
    )
    expect(confirmButton(dialog)).toHaveAccessibleName(
      'Fusionar Phalaenopsis amabilis en Phalaenopsis equestris',
    )

    // Intercambiar vuelve a pedir la vista previa, sin mostrar la anterior.
    const swap = within(dialog).getByRole('button', {
      name: 'Intercambiar cuál se conserva',
    })
    swap.focus()
    await user.keyboard('{Enter}')
    expect(keepOther).toBeChecked()
    expect(preview(dialog)).not.toHaveTextContent('Ninguna planta')
    await waitFor(() =>
      expect(preview(dialog)).toHaveTextContent(
        'Se moverán 2 plantas de usuarios de «Phalaenopsis equestris» a «Phalaenopsis amabilis»',
      ),
    )
    expect(previewMerge).toHaveBeenLastCalledWith(
      equestris,
      amabilis,
      expect.anything(),
    )
    const box = preview(dialog)
    expect(
      within(box).getByRole('list', {
        name: 'Nombres que pasan a «Phalaenopsis amabilis» (1)',
      }),
    ).toHaveTextContent(
      'Phalaenopsis equestris · su nombre científico, que pasa como sinónimo',
    )
    const existing = within(box).getByRole('list', {
      name: 'Nombres que ya existían y no pasan (2)',
    })
    expect(existing).toHaveTextContent(
      'Phalaenopsis Grandiflora · «Phalaenopsis amabilis» ya lo tiene como sinónimo: «Phalaenopsis grandiflora»',
    )
    expect(existing).toHaveTextContent(
      'Orquídea Mariposa · «Phalaenopsis amabilis» ya lo tiene como nombre común: «orquídea mariposa»',
    )
    expect(box).toHaveTextContent(
      '«Phalaenopsis amabilis» pasará de «Importada» a «Validada»',
    )
    expect(box).toHaveTextContent('La importación no volverá a crear')
    expect(box).not.toHaveTextContent('Cambia el género')
    expect(confirmButton(dialog)).toHaveAttribute('aria-disabled', 'false')
    expect(confirmButton(dialog)).toHaveAccessibleDescription(
      'La fusión no se puede deshacer: «Phalaenopsis equestris» desaparecerá del catálogo.',
    )
    await expectNoAxeViolations()

    // Fusionar: se cierra el diálogo y se abre la conservada.
    confirmButton(dialog).focus()
    await user.keyboard('{Enter}')
    expect(mergeSpecies).toHaveBeenCalledWith(equestris, amabilis)
    const kept = await screen.findByRole('region', {
      name: 'Detalle de Phalaenopsis amabilis',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(
        within(kept).getByRole('heading', {
          name: 'Detalle de Phalaenopsis amabilis',
        }),
      ).toHaveFocus(),
    )
    expect(opener).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Se fusionó «Phalaenopsis equestris» en «Phalaenopsis amabilis»: se movieron 2 plantas y pasó 1 nombre (2 ya existían). «Phalaenopsis amabilis» pasó a «Validada».',
      ),
    ).toHaveAttribute('role', 'status')
    await waitFor(() =>
      expect(kept).toHaveTextContent(
        '2 plantas de usuarios la tienen enlazada',
      ),
    )
    expect(kept).toHaveTextContent('Phalaenopsis equestris')
    const history = await within(kept).findByRole('list', { name: 'Historial' })
    await waitFor(() =>
      expect(within(history).getAllByRole('listitem')[0]).toHaveTextContent(
        'Fusión de especies',
      ),
    )
    expect(within(history).getAllByRole('listitem')[0]).toHaveTextContent(
      'Se absorbió «Phalaenopsis equestris» en «Phalaenopsis amabilis» (plantas movidas: 2; nombres que pasaron: 1).',
    )

    // La tabla (con la búsqueda de antes) ya no tiene la absorbida: la
    // conservada sale por su nombre nuevo.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Phalaenopsis equestris' }),
      ).not.toBeInTheDocument(),
    )
    expect(
      await screen.findByText('Sinónimo: Phalaenopsis equestris'),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('avisa si cambia el género y cuando las especies ya no existen ofrece salir', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const equestris = await idOf(source, 'Phalaenopsis equestris')
    const coerulea = await idOf(source, 'Vanda coerulea')
    const aphrodite = await idOf(source, 'Phalaenopsis aphrodite')
    const user = userEvent.setup()
    render(<View source={source} />)

    const panel = await openDetail(user, 'Phalaenopsis equestris')
    const dialog = await openMerge(user, panel, 'Phalaenopsis equestris')
    await pickOther(user, dialog, 'vanda coer')
    await user.click(
      within(dialog).getByRole('radio', {
        name: 'Conservar «Vanda coerulea» (la que elegiste)',
      }),
    )
    await waitFor(() =>
      expect(preview(dialog)).toHaveTextContent(
        'Atención: Cambia el género: las plantas de «Phalaenopsis equestris» pasarán de Phalaenopsis a Vanda.',
      ),
    )
    await expectNoAxeViolations()

    // Otra persona borra la que se conserva antes de confirmar.
    await source.deleteSpecies(coerulea)
    await user.click(confirmButton(dialog))
    const gone = await within(dialog).findByRole('alert')
    expect(gone).toHaveTextContent(
      '«Vanda coerulea» ya no está en el catálogo: puede que otra persona la haya fusionado o borrado. No se cambió nada.',
    )
    expect(confirmButton(dialog)).toHaveAttribute('aria-disabled', 'true')
    await expectNoAxeViolations()
    await user.click(
      within(gone).getByRole('button', { name: 'Elegir otra especie' }),
    )
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: 'Otra especie' }),
      ).toHaveFocus(),
    )

    // Y otra fusiona la del detalle en otra especie.
    await pickOther(user, dialog, 'phal bell')
    await user.click(
      within(dialog).getByRole('radio', {
        name: 'Conservar «Phalaenopsis bellina» (la que elegiste)',
      }),
    )
    await waitFor(() =>
      expect(confirmButton(dialog)).toHaveAttribute('aria-disabled', 'false'),
    )
    await source.mergeSpecies(equestris, aphrodite)
    await user.click(confirmButton(dialog))
    const exit = await within(dialog).findByRole('button', {
      name: 'Cerrar y volver a leer el catálogo',
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      '«Phalaenopsis equestris» ya no está en el catálogo',
    )
    await user.click(exit)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      await within(panel).findByText('Esta especie ya no está en el catálogo.'),
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('heading', { name: 'Detalle de la especie' }),
    ).toHaveFocus()
  })

  it('sin conexión en la vista previa se reintenta; con la sesión terminada no se fusiona', async () => {
    const sample = createSampleCatalogSource('ejemplo', 0)
    const previewMerge = vi
      .fn<CatalogAdminSource['previewMerge']>()
      .mockRejectedValueOnce(new CatalogAdminError('offline'))
      .mockImplementation(sample.previewMerge)
    const mergeSpecies = vi
      .fn<CatalogAdminSource['mergeSpecies']>()
      .mockRejectedValue(new CatalogWriteError('session-ended'))
    const source: CatalogAdminSource = { ...sample, previewMerge, mergeSpecies }
    const user = userEvent.setup()
    render(<View source={source} />)

    const panel = await openDetail(user, 'Phalaenopsis equestris')
    const dialog = await openMerge(user, panel, 'Phalaenopsis equestris')
    await pickOther(user, dialog, 'phal amab')
    await user.keyboard(' ')

    const offline = await within(preview(dialog)).findByRole('alert')
    expect(offline).toHaveTextContent('Sin conexión')
    expect(confirmButton(dialog)).toHaveAttribute('aria-disabled', 'true')
    await expectNoAxeViolations()
    await user.click(
      within(offline).getByRole('button', { name: 'Reintentar' }),
    )
    await waitFor(() =>
      expect(confirmButton(dialog)).toHaveAttribute('aria-disabled', 'false'),
    )

    await user.click(confirmButton(dialog))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(
      'Tu sesión terminó y no se guardó nada. Vuelve a iniciar sesión.',
    )
    expect(
      within(alert).getByRole('link', { name: 'Iniciar sesión' }),
    ).toBeInTheDocument()
    // Sigue abierto, con la vista previa, para volver a intentarlo.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(confirmButton(dialog)).toHaveAttribute('aria-disabled', 'false')
    await expectNoAxeViolations()
  })

  it('al intercambiar, mientras llega la vista previa nueva no se ve la anterior ni se puede fusionar', async () => {
    const sample = createSampleCatalogSource('ejemplo', 0)
    let release: () => void = () => {}
    const previewMerge = vi
      .fn<CatalogAdminSource['previewMerge']>()
      .mockImplementationOnce(sample.previewMerge)
      .mockImplementationOnce(
        (mergedId, keptId, options) =>
          new Promise((resolve, reject) => {
            release = () => {
              sample
                .previewMerge(mergedId, keptId, options)
                .then(resolve, reject)
            }
          }),
      )
    const mergeSpecies = vi.fn<CatalogAdminSource['mergeSpecies']>()
    const source: CatalogAdminSource = { ...sample, previewMerge, mergeSpecies }
    const user = userEvent.setup()
    render(<View source={source} />)

    const panel = await openDetail(user, 'Phalaenopsis equestris')
    const dialog = await openMerge(user, panel, 'Phalaenopsis equestris')
    await pickOther(user, dialog, 'phal amab')
    await user.keyboard(' ')
    await waitFor(() =>
      expect(confirmButton(dialog)).toHaveAttribute('aria-disabled', 'false'),
    )

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Intercambiar cuál se conserva',
      }),
    )
    expect(preview(dialog)).toHaveAttribute('aria-busy', 'true')
    expect(preview(dialog)).not.toHaveTextContent('Ninguna planta')
    expect(confirmButton(dialog)).toHaveAttribute('aria-disabled', 'true')
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Cargando la vista previa…',
    )
    await user.click(confirmButton(dialog))
    expect(mergeSpecies).not.toHaveBeenCalled()

    release()
    await waitFor(() =>
      expect(confirmButton(dialog)).toHaveAttribute('aria-disabled', 'false'),
    )
    expect(preview(dialog)).toHaveTextContent('Se moverán 2 plantas')
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Vista previa lista. Se moverán 2 plantas. Pasará 1 nombre.',
    )
  })

  it('el diálogo retiene el foco; Escape limpia el buscador, después cierra y devuelve el foco', async () => {
    const source = createSampleCatalogSource('ejemplo', 0)
    const user = userEvent.setup()
    render(<View source={source} />)

    const panel = await openDetail(user, 'Phalaenopsis equestris')
    const opener = within(panel).getByRole('button', {
      name: 'Fusionar con otra especie',
    })
    const dialog = await openMerge(user, panel, 'Phalaenopsis equestris')
    const field = within(dialog).getByRole('combobox', { name: 'Otra especie' })

    // Mayús+Tab desde el primero va al último, y Tab desde el último vuelve.
    await user.tab({ shift: true })
    expect(confirmButton(dialog)).toHaveFocus()
    await user.tab()
    expect(field).toHaveFocus()

    await user.type(field, 'phal')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(field).toHaveValue('')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
