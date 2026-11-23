import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadOnlyReason } from '../collection/useReadOnly.ts'
import { PlantLogError } from '../log/entries.ts'
import {
  createMemoryPlantLogEntries,
  type MemoryPlantLogEntries,
} from '../log/memory-entries.ts'
import type { LogEntry } from '../log/model.ts'
import { PlantLogServicesContext } from '../log/services.ts'
import {
  LOG_FORM_TEXT,
  LOG_LOAD_ERROR_TEXT,
  LOG_SAVE_ERROR_TEXT,
  LOG_TEXT,
} from '../log/texts.ts'
import {
  createMemoryPhotoStorage,
  type MemoryPhotoStorage,
} from '../photos/memory-storage.ts'
import { PlantImagesContext } from '../photos/usePlantImage.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { plant } from '../test/collection.ts'
import { processedPhoto } from '../test/photos.ts'
import { fakeImageSource } from '../test/plant-routes.tsx'
import { PlantLogSection } from './PlantLogSection.tsx'

// La preparación de fotos necesita canvas: un doble que la da por hecha.
vi.mock('../photos/load.ts', () => ({
  loadPhotoProcessing: () =>
    Promise.resolve({
      processPhoto: () => Promise.resolve(processedPhoto()),
      PhotoProcessingError: class extends Error {},
    }),
}))

// Bitácora del ejemplar en la ficha (#267): lista, filtro, «Cargar más»,
// estados, «Añadir registro» (diálogo) y eliminar, con la bitácora y el
// bucket en memoria.

const USER = 'user_prueba'
const ID = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
const CATTLEYA = plant({
  id: ID,
  displayName: 'Cattleya adelinae',
  enteredName: 'Cattleya adelinae',
  code: 'CAT-012',
})

interface Setup {
  entries: MemoryPlantLogEntries
  storage: MemoryPhotoStorage
}

let services: Setup

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Ficha'
  const entries = createMemoryPlantLogEntries({ userId: USER })
  entries.plants.set(ID, USER)
  services = { entries, storage: createMemoryPhotoStorage() }
})

async function seed(
  items: readonly Partial<Omit<LogEntry, 'id' | 'createdAt'>>[],
): Promise<void> {
  for (const [index, item] of items.entries()) {
    await services.entries.add({
      plantId: ID,
      type: item.type ?? 'watering',
      title: item.title ?? `Registro ${String(index + 1)}`,
      description: item.description ?? null,
      photoPath: item.photoPath ?? null,
      thumbnailPath: item.thumbnailPath ?? null,
      inBloom: item.inBloom ?? null,
      idempotencyKey: `semilla-${String(index)}`,
    })
  }
}

function renderSection(readOnly: ReadOnlyReason | null = null) {
  return render(
    <PlantLogServicesContext value={services}>
      <PlantImagesContext value={fakeImageSource().source}>
        <main>
          <h1>Cattleya adelinae</h1>
          <PlantLogSection plant={CATTLEYA} readOnly={readOnly} userId={USER} />
        </main>
      </PlantImagesContext>
    </PlantLogServicesContext>,
  )
}

const list = () => screen.getByRole('list', { name: LOG_TEXT.listLabel })
const titles = () =>
  within(list())
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent)
const addButton = () => screen.getByRole('button', { name: LOG_TEXT.add })
const filter = () =>
  screen.getByRole('combobox', { name: LOG_TEXT.filterLabel })
const status = () =>
  screen
    .getAllByRole('status')
    .map((region) => region.textContent)
    .join(' ')

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(addButton())
  return screen.findByRole('dialog', {
    name: /^Nuevo registro de bitácora:\s*Cattleya adelinae\s*,\s*CAT-012$/,
  })
}

describe('PlantLogSection: la lista', () => {
  it('muestra los registros del más reciente al más antiguo, con lo que tienen', async () => {
    await seed([
      { title: 'Riego por inmersión', description: 'Diez minutos.' },
      { type: 'nutrition', title: 'Abono', inBloom: true },
      {
        type: 'preventive_health',
        title: 'Revisión',
        inBloom: false,
        photoPath: `${USER}/${ID}/log/photo-v.webp`,
        thumbnailPath: `${USER}/${ID}/log/thumb-v.webp`,
      },
    ])
    renderSection()
    await screen.findByRole('list', { name: LOG_TEXT.listLabel })
    expect(titles()).toEqual(['Revisión', 'Abono', 'Riego por inmersión'])

    const [revision, abono, riego] = within(list()).getAllByRole('article')
    if (!revision || !abono || !riego) throw new Error('Faltan registros')
    expect(within(revision).getByText('Sanidad preventiva')).toBeVisible()
    expect(within(revision).getByText('Floración observada: no')).toBeVisible()
    expect(
      within(revision).getByRole('button', {
        name: LOG_TEXT.openPhoto('Revisión'),
      }),
    ).toBeVisible()
    expect(within(abono).getByText('Floración observada: sí')).toBeVisible()
    // Sin descripción, sin floración ni foto: no se pintan.
    expect(within(riego).getByText('Diez minutos.')).toBeVisible()
    expect(within(riego).queryByText(/Floración observada/)).toBeNull()
    expect(
      within(riego).queryByRole('button', { name: /Ver en grande/ }),
    ).toBeNull()
    // Fecha y hora en el horario local, con su valor de máquina.
    const time = riego.querySelector('time')
    expect(time?.getAttribute('dateTime')).toMatch(/^2026-11-23T/)
    expect(time?.textContent).toMatch(/^\d{1,2} nov 2026, \d{1,2}:\d{2}$/)
    await expectNoAxeViolations()
  })

  it('sin registros, lo dice e invita a añadir', async () => {
    renderSection()
    expect(await screen.findByText(LOG_TEXT.emptyTitle)).toBeVisible()
    expect(screen.getByText(LOG_TEXT.empty)).toBeVisible()
    await expectNoAxeViolations()
  })

  it('filtra por actividad y, sin resultados, ofrece «Ver todas»', async () => {
    const user = userEvent.setup()
    await seed([
      { title: 'Riego 1' },
      { type: 'nutrition', title: 'Abono' },
      { title: 'Riego 2' },
    ])
    renderSection()
    await screen.findByRole('list', { name: LOG_TEXT.listLabel })

    await user.selectOptions(filter(), 'Riego')
    await waitFor(() => expect(titles()).toEqual(['Riego 2', 'Riego 1']))
    expect(status()).toContain(LOG_TEXT.showing('Riego'))

    await user.selectOptions(filter(), 'Sanidad preventiva')
    expect(
      await screen.findByText(LOG_TEXT.filterEmpty('Sanidad preventiva')),
    ).toBeVisible()
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: LOG_TEXT.showAll }))
    await waitFor(() =>
      expect(titles()).toEqual(['Riego 2', 'Abono', 'Riego 1']),
    )
    expect(filter()).toHaveValue('')
    expect(filter()).toHaveFocus()
  })

  it('«Cargar más» trae la página siguiente y, al terminar, el foco va al primero nuevo', async () => {
    const user = userEvent.setup()
    await seed(
      Array.from({ length: 23 }, (_, index) => ({
        title: `Registro ${String(index + 1)}`,
      })),
    )
    renderSection()
    await screen.findByRole('list', { name: LOG_TEXT.listLabel })
    expect(titles()).toHaveLength(20)
    expect(titles()[0]).toBe('Registro 23')

    await user.click(screen.getByRole('button', { name: LOG_TEXT.loadMore }))
    await waitFor(() => expect(titles()).toHaveLength(23))
    expect(titles().at(-1)).toBe('Registro 1')
    expect(screen.queryByRole('button', { name: LOG_TEXT.loadMore })).toBeNull()
    expect(screen.getByRole('article', { name: 'Registro 3' })).toHaveFocus()
    expect(status()).toContain(LOG_TEXT.loadedMore(3))
  })

  it('si no carga, lo dice y «Reintentar» vuelve a pedirla', async () => {
    const user = userEvent.setup()
    await seed([{ title: 'Riego' }])
    let fails = true
    services.entries.fail = (operation) =>
      operation === 'list' && fails
        ? { when: 'before', error: new PlantLogError('failed') }
        : null
    renderSection()
    expect(await screen.findByText(LOG_LOAD_ERROR_TEXT.failed)).toBeVisible()
    fails = false
    await user.click(screen.getByRole('button', { name: LOG_TEXT.retry }))
    await waitFor(() => expect(titles()).toEqual(['Riego']))
  })

  it('sin conexión no lee nada, lo dice y «Añadir registro» queda desactivado con el motivo', async () => {
    const list = vi.spyOn(services.entries, 'list')
    renderSection('offline')
    expect(screen.getByText(LOG_TEXT.offline)).toBeVisible()
    expect(addButton()).toHaveAttribute('aria-disabled', 'true')
    expect(addButton()).toHaveAccessibleDescription(LOG_TEXT.offline)
    await userEvent.setup().click(addButton())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(list).not.toHaveBeenCalled()
    await expectNoAxeViolations()
  })
})

describe('PlantLogSection: añadir un registro', () => {
  it('el diálogo pone el foco en el primer tipo, valida al enviar y lleva el foco al primer error', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByText(LOG_TEXT.emptyTitle)
    const dialog = await openDialog(user)
    expect(within(dialog).getByRole('radio', { name: 'Riego' })).toHaveFocus()
    expect(within(dialog).getByText('CAT-012')).toBeVisible()
    await expectNoAxeViolations()

    await user.click(
      within(dialog).getByRole('button', { name: LOG_FORM_TEXT.save }),
    )
    expect(within(dialog).getByText(LOG_FORM_TEXT.typeRequired)).toBeVisible()
    expect(within(dialog).getByText(LOG_FORM_TEXT.titleRequired)).toBeVisible()
    expect(within(dialog).getByRole('radio', { name: 'Riego' })).toHaveFocus()
    expect(
      within(dialog).getByRole('group', { name: LOG_FORM_TEXT.type }),
    ).toHaveAccessibleDescription(LOG_FORM_TEXT.typeRequired)

    await user.click(within(dialog).getByRole('radio', { name: 'Nutrición' }))
    await user.click(
      within(dialog).getByRole('button', { name: LOG_FORM_TEXT.save }),
    )
    const title = within(dialog).getByRole('textbox', {
      name: LOG_FORM_TEXT.entryTitle,
    })
    expect(title).toHaveFocus()
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(services.entries.rows.size).toBe(0)
    await expectNoAxeViolations()
  })

  it('sin foto: guarda, cierra, el registro queda arriba, el foco vuelve a «Añadir registro» y se anuncia', async () => {
    const user = userEvent.setup()
    await seed([{ title: 'Anterior' }])
    renderSection()
    await screen.findByRole('list', { name: LOG_TEXT.listLabel })
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('radio', { name: 'Riego' }))
    await user.type(
      within(dialog).getByRole('textbox', { name: LOG_FORM_TEXT.entryTitle }),
      'Riego por inmersión',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: LOG_FORM_TEXT.description }),
      'Diez minutos en agua de lluvia.',
    )
    await user.click(within(dialog).getByRole('radio', { name: 'Sí' }))
    await user.click(
      within(dialog).getByRole('button', { name: LOG_FORM_TEXT.save }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(titles()).toEqual(['Riego por inmersión', 'Anterior'])
    expect(addButton()).toHaveFocus()
    expect(status()).toContain(LOG_TEXT.saved('Riego por inmersión'))
    const [saved] = services.entries.entriesOf(ID)
    expect(saved).toMatchObject({
      type: 'watering',
      title: 'Riego por inmersión',
      description: 'Diez minutos en agua de lluvia.',
      inBloom: true,
      photoPath: null,
    })
  })

  it('con foto: la sube a log/ y el registro la muestra', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByText(LOG_TEXT.emptyTitle)
    const dialog = await openDialog(user)
    await user.click(
      within(dialog).getByRole('radio', { name: 'Sanidad preventiva' }),
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: LOG_FORM_TEXT.entryTitle }),
      'Revisión de hojas',
    )
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('Sin campo de archivo')
    await user.upload(
      input,
      new File(['x'], 'foto.jpg', { type: 'image/jpeg' }),
    )
    expect(
      await within(dialog).findByRole('button', {
        name: LOG_FORM_TEXT.removePhoto,
      }),
    ).toBeVisible()
    expect(
      within(dialog).getByRole('button', { name: LOG_FORM_TEXT.changePhoto }),
    ).toBeVisible()
    await user.click(
      within(dialog).getByRole('button', { name: LOG_FORM_TEXT.save }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const files = [...services.storage.objects.keys()]
    expect(files).toHaveLength(2)
    for (const file of files)
      expect(file.startsWith(`${USER}/${ID}/log/`)).toBe(true)
    expect(
      screen.getByRole('button', {
        name: LOG_TEXT.openPhoto('Revisión de hojas'),
      }),
    ).toBeVisible()
  })

  it('con un filtro que lo escondería, lo quita y lo dice', async () => {
    const user = userEvent.setup()
    await seed([{ type: 'nutrition', title: 'Abono' }])
    renderSection()
    await screen.findByRole('list', { name: LOG_TEXT.listLabel })
    await user.selectOptions(filter(), 'Nutrición')
    await waitFor(() => expect(titles()).toEqual(['Abono']))

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('radio', { name: 'Riego' }))
    await user.type(
      within(dialog).getByRole('textbox', { name: LOG_FORM_TEXT.entryTitle }),
      'Riego',
    )
    await user.click(
      within(dialog).getByRole('button', { name: LOG_FORM_TEXT.save }),
    )
    await waitFor(() => expect(titles()).toEqual(['Riego', 'Abono']))
    expect(filter()).toHaveValue('')
    expect(status()).toContain(
      `${LOG_TEXT.saved('Riego')} ${LOG_TEXT.filterCleared('Nutrición')}`,
    )
  })

  it('si falla, conserva lo escrito; el reintento no duplica', async () => {
    const user = userEvent.setup()
    // El primer intento se guarda, pero la respuesta no llega.
    let fails = true
    services.entries.fail = (operation) =>
      operation === 'add' && fails
        ? {
            when: 'after',
            error: new PlantLogError('offline', { uncertain: true }),
          }
        : null
    renderSection()
    await screen.findByText(LOG_TEXT.emptyTitle)
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('radio', { name: 'Riego' }))
    const title = within(dialog).getByRole('textbox', {
      name: LOG_FORM_TEXT.entryTitle,
    })
    await user.type(title, 'Riego por inmersión')
    const save = within(dialog).getByRole('button', {
      name: LOG_FORM_TEXT.save,
    })
    await user.click(save)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      LOG_SAVE_ERROR_TEXT.offline,
    )
    expect(title).toHaveValue('Riego por inmersión')
    expect(within(dialog).getByRole('radio', { name: 'Riego' })).toBeChecked()

    fails = false
    await user.click(save)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(services.entries.rows.size).toBe(1)
    expect(titles()).toEqual(['Riego por inmersión'])
  })

  it('mientras guarda, el botón queda ocupado y no envía dos veces', async () => {
    const user = userEvent.setup()
    services.entries.delayMs = 50
    const add = vi.spyOn(services.entries, 'add')
    renderSection()
    await screen.findByText(LOG_TEXT.emptyTitle)
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('radio', { name: 'Riego' }))
    await user.type(
      within(dialog).getByRole('textbox', { name: LOG_FORM_TEXT.entryTitle }),
      'Riego',
    )
    const save = within(dialog).getByRole('button', {
      name: LOG_FORM_TEXT.save,
    })
    await user.click(save)
    expect(save).toHaveTextContent(LOG_FORM_TEXT.saving)
    expect(save).toHaveAttribute('aria-disabled', 'true')
    await user.click(save)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('Escape cierra sin preguntar si no hay nada escrito; el foco vuelve a «Añadir registro»', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByText(LOG_TEXT.emptyTitle)
    await openDialog(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(addButton()).toHaveFocus()
  })

  it('con algo escrito, pregunta antes de descartar', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByText(LOG_TEXT.emptyTitle)
    const dialog = await openDialog(user)
    await user.type(
      within(dialog).getByRole('textbox', { name: LOG_FORM_TEXT.entryTitle }),
      'Riego',
    )
    await user.keyboard('{Escape}')
    const confirm = screen.getByRole('dialog', {
      name: LOG_FORM_TEXT.discardTitle,
    })
    expect(
      within(confirm).getByRole('button', { name: LOG_FORM_TEXT.discardStay }),
    ).toHaveFocus()
    await user.click(
      within(confirm).getByRole('button', { name: LOG_FORM_TEXT.discardStay }),
    )
    expect(
      screen.getByRole('textbox', { name: LOG_FORM_TEXT.entryTitle }),
    ).toHaveValue('Riego')

    await user.click(screen.getByRole('button', { name: LOG_FORM_TEXT.cancel }))
    await user.click(
      screen.getByRole('button', { name: LOG_FORM_TEXT.discardConfirm }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(addButton()).toHaveFocus()
    expect(services.entries.rows.size).toBe(0)
  })

  it('cancelar con una foto elegida no deja archivos', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByText(LOG_TEXT.emptyTitle)
    const dialog = await openDialog(user)
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('Sin campo de archivo')
    await user.upload(
      input,
      new File(['x'], 'foto.jpg', { type: 'image/jpeg' }),
    )
    await within(dialog).findByRole('button', {
      name: LOG_FORM_TEXT.removePhoto,
    })
    await user.click(
      within(dialog).getByRole('button', { name: LOG_FORM_TEXT.cancel }),
    )
    await user.click(
      screen.getByRole('button', { name: LOG_FORM_TEXT.discardConfirm }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(services.storage.objects.size).toBe(0)
  })
})

describe('PlantLogSection: eliminar un registro', () => {
  const PHOTO = `${USER}/${ID}/log/photo-v.webp`
  const THUMB = `${USER}/${ID}/log/thumb-v.webp`

  beforeEach(async () => {
    await seed([
      { title: 'Primero' },
      { title: 'Con foto', photoPath: PHOTO, thumbnailPath: THUMB },
      { title: 'Último' },
    ])
    for (const path of [PHOTO, THUMB]) {
      services.storage.objects.set(path, {
        blob: new Blob(),
        contentType: 'image/webp',
      })
    }
  })

  it('confirma, borra el registro y su foto, y el foco pasa al siguiente', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByRole('list', { name: LOG_TEXT.listLabel })
    await user.click(
      screen.getByRole('button', { name: LOG_TEXT.delete('Con foto') }),
    )
    const confirm = screen.getByRole('dialog', { name: LOG_TEXT.deleteTitle })
    expect(confirm).toHaveAccessibleDescription(
      LOG_TEXT.deleteDescription('Con foto', true),
    )
    expect(
      within(confirm).getByRole('button', { name: 'Cancelar' }),
    ).toHaveFocus()
    await user.click(
      within(confirm).getByRole('button', { name: LOG_TEXT.deleteConfirm }),
    )
    await waitFor(() => expect(titles()).toEqual(['Último', 'Primero']))
    expect(screen.getByRole('article', { name: 'Primero' })).toHaveFocus()
    expect(status()).toContain(LOG_TEXT.deleted('Con foto'))
    expect(services.entries.rows.size).toBe(2)
    expect(services.storage.objects.size).toBe(0)
  })

  it('cancelar no borra nada y devuelve el foco a la papelera', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByRole('list', { name: LOG_TEXT.listLabel })
    const trash = screen.getByRole('button', {
      name: LOG_TEXT.delete('Último'),
    })
    await user.click(trash)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trash).toHaveFocus()
    expect(services.entries.rows.size).toBe(3)
  })

  it('si falla, lo dice en la confirmación y se puede reintentar', async () => {
    const user = userEvent.setup()
    let fails = true
    services.entries.fail = (operation) =>
      operation === 'remove' && fails
        ? { when: 'before', error: new PlantLogError('failed') }
        : null
    renderSection()
    await screen.findByRole('list', { name: LOG_TEXT.listLabel })
    await user.click(
      screen.getByRole('button', { name: LOG_TEXT.delete('Último') }),
    )
    const confirm = screen.getByRole('dialog', { name: LOG_TEXT.deleteTitle })
    await user.click(
      within(confirm).getByRole('button', { name: LOG_TEXT.deleteConfirm }),
    )
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'No se eliminó el registro',
    )
    expect(services.entries.rows.size).toBe(3)
    fails = false
    await user.click(
      within(confirm).getByRole('button', { name: LOG_TEXT.deleteConfirm }),
    )
    await waitFor(() => expect(titles()).toEqual(['Con foto', 'Primero']))
    // Era el primero: el foco pasa al que ahora ocupa su lugar.
    expect(screen.getByRole('article', { name: 'Con foto' })).toHaveFocus()
  })

  it('al borrar el último que queda, el foco va a «Añadir registro»', async () => {
    const user = userEvent.setup()
    services.entries.rows.clear()
    await seed([{ title: 'Único' }])
    renderSection()
    await screen.findByRole('list', { name: LOG_TEXT.listLabel })
    await user.click(
      screen.getByRole('button', { name: LOG_TEXT.delete('Único') }),
    )
    await user.click(
      screen.getByRole('button', { name: LOG_TEXT.deleteConfirm }),
    )
    expect(await screen.findByText(LOG_TEXT.emptyTitle)).toBeVisible()
    expect(addButton()).toHaveFocus()
  })

  it('sin conexión, eliminar queda desactivado con el motivo', async () => {
    const view = renderSection()
    await screen.findByRole('list', { name: LOG_TEXT.listLabel })
    view.rerender(
      <PlantLogServicesContext value={services}>
        <PlantImagesContext value={fakeImageSource().source}>
          <main>
            <h1>Cattleya adelinae</h1>
            <PlantLogSection
              plant={CATTLEYA}
              readOnly="offline"
              userId={USER}
            />
          </main>
        </PlantImagesContext>
      </PlantLogServicesContext>,
    )
    // Lo ya leído se sigue viendo.
    expect(titles()).toHaveLength(3)
    const trash = screen.getByRole('button', {
      name: LOG_TEXT.delete('Último'),
    })
    expect(trash).toHaveAttribute('aria-disabled', 'true')
    expect(trash).toHaveAccessibleDescription(LOG_TEXT.offline)
    await act(async () => {
      trash.click()
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
