import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { DELETE_ERROR_TEXT, DETAIL_TEXT, NOTES_TEXT } from '../detail/texts.ts'
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { plant } from '../test/collection.ts'
import { renderPlantRoutes } from '../test/plant-routes.tsx'
import {
  CONFIG,
  fakeSupabase,
  GENERA,
  json,
  type FakeSupabase,
} from '../test/supabase-plants.ts'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

// Baja, reactivación y eliminación definitiva desde el detalle (#16), dentro
// de «Gestionar planta» desde el #265, y las notas de la ficha (#265), con la
// app real hasta el cliente de Supabase y PostgREST y Storage en memoria.

const USER = 'user_prueba'
const AMABILIS_ID = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
const CATTLEYA_ID = '7a2b3c4d-0000-4000-8000-000000000002'

function amabilis(overrides: Partial<CollectionPlant> = {}): CollectionPlant {
  return plant({
    id: AMABILIS_ID,
    photoPath: `${USER}/${AMABILIS_ID}/photo-v1.webp`,
    thumbnailPath: `${USER}/${AMABILIS_ID}/thumb-v1.webp`,
    createdAt: '2026-11-02T10:00:00+00:00',
    ...overrides,
  })
}

const CATTLEYA = plant({
  id: CATTLEYA_ID,
  displayName: 'Cattleya maxima',
  species: {
    id: 'species-maxima',
    scientificName: 'Cattleya maxima',
    type: 'species',
    status: 'validated',
  },
  genus: GENERA.cattleya,
  createdAt: '2026-11-01T10:00:00+00:00',
})

let supabase: FakeSupabase

beforeEach(() => {
  document.documentElement.lang = 'es'
  resetFakeClerk()
  setFakeClerk({ signedIn: true, userId: USER })
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  initSupabase(CONFIG)
  setSessionTokenSource(() => Promise.resolve('token_de_prueba'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setSessionTokenSource(null)
})

/** Abre «Gestionar planta» (#265), plegado al entrar. */
async function openManage(user: ReturnType<typeof userEvent.setup>) {
  const toggle = screen.getByRole('button', { name: DETAIL_TEXT.actionsLabel })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

/**
 * Inventario → detalle de la primera planta, como al navegar, con
 * «Gestionar planta» abierto (salvo `manage: false`).
 */
async function openDetail(
  plants: readonly CollectionPlant[],
  { manage = true }: { manage?: boolean } = {},
) {
  supabase = fakeSupabase(plants)
  vi.stubGlobal('fetch', supabase.fetch)
  const user = userEvent.setup()
  const view = await renderPlantRoutes({ entries: ['/coleccion'], plants })
  const first = plants[0]
  if (!first) throw new Error('Sin plantas.')
  await user.click(screen.getByRole('link', { name: first.displayName }))
  if (manage) await openManage(user)
  return { ...view, user }
}

const location = () => screen.getByTestId('location').textContent
const dialog = () => screen.getByRole('dialog')
// Contador de la cabecera de «Mi colección» (#208).
const summary = () => {
  const meta = document.querySelector('.orki-pagehead__meta')
  if (!(meta instanceof HTMLElement)) throw new Error('Sin contador.')
  return meta
}

function datum(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' })
  const value = term.nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`Sin valor: ${label}`)
  return value
}

describe('dar de baja y reactivar', () => {
  it('pide el motivo en un diálogo accesible; Escape cancela y devuelve el foco', async () => {
    const { user } = await openDetail([amabilis(), CATTLEYA])
    const retire = screen.getByRole('button', { name: DETAIL_TEXT.retire })

    await user.click(retire)
    expect(dialog()).toHaveAccessibleName(DETAIL_TEXT.retireTitle)
    expect(dialog()).toHaveAccessibleDescription(DETAIL_TEXT.retireDescription)
    // El foco entra en el primer control: el motivo.
    expect(
      screen.getByRole('radio', { name: DETAIL_TEXT.retireLost }),
    ).toHaveFocus()
    expect(
      screen.getByRole('radio', { name: DETAIL_TEXT.retireLost }),
    ).toBeChecked()
    await expectNoAxeViolations()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(retire).toHaveFocus()
    expect(supabase.patches()).toEqual([])
  })

  it('la baja conserva la planta, la quita de la vista por defecto y de los contadores, y se ve con el filtro', async () => {
    const { user } = await openDetail([amabilis(), CATTLEYA])

    await user.click(screen.getByRole('button', { name: DETAIL_TEXT.retire }))
    await user.click(
      screen.getByRole('radio', { name: DETAIL_TEXT.retireGifted }),
    )
    await user.click(
      within(dialog()).getByRole('button', { name: DETAIL_TEXT.retireConfirm }),
    )

    // Solo el estado: ni validation ni user_id.
    await waitFor(() =>
      expect(supabase.patches()).toEqual([{ status: 'gifted' }]),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      await screen.findByText(DETAIL_TEXT.retired('Regalada')),
    ).toBeVisible()
    expect(datum(DETAIL_TEXT.status)).toHaveTextContent('Regalada')
    expect(screen.getByText(DETAIL_TEXT.inactive('Regalada'))).toBeVisible()
    expect(
      screen.getByRole('button', { name: DETAIL_TEXT.reactivate }),
    ).toBeInTheDocument()
    expect(location()).toBe(`/coleccion/${AMABILIS_ID}`)
    await expectNoAxeViolations()

    await user.click(screen.getByRole('link', { name: DETAIL_TEXT.back }))
    expect(summary()).toHaveTextContent('1 ejemplar · 1 género')
    expect(
      screen.queryByRole('article', { name: 'Phalaenopsis amabilis' }),
    ).toBeNull()
    expect(
      screen.getByRole('article', { name: 'Cattleya maxima' }),
    ).toBeInTheDocument()
    // La baja no se borró: el filtro de estado la muestra.
    expect(supabase.rows.get(AMABILIS_ID)?.status).toBe('gifted')
  })

  it('una baja se revierte a activa desde el detalle', async () => {
    // Dada de baja no sale en la lista por defecto: se abre su dirección.
    const lost = amabilis({ status: 'lost' })
    supabase = fakeSupabase([lost])
    vi.stubGlobal('fetch', supabase.fetch)
    const user = userEvent.setup()
    await renderPlantRoutes({
      entries: [`/coleccion/${AMABILIS_ID}`],
      plants: [lost],
    })
    expect(datum(DETAIL_TEXT.status)).toHaveTextContent('Perdida')
    expect(
      screen.getByText(/Puedes reactivarla en «Gestionar planta»/),
    ).toBeVisible()
    await openManage(user)
    await user.click(
      screen.getByRole('button', { name: DETAIL_TEXT.reactivate }),
    )
    await waitFor(() =>
      expect(supabase.patches()).toEqual([{ status: 'active' }]),
    )
    expect(await screen.findByText(DETAIL_TEXT.reactivated)).toBeVisible()
    expect(datum(DETAIL_TEXT.status)).toHaveTextContent('Activa')
    expect(
      screen.getByRole('button', { name: DETAIL_TEXT.retire }),
    ).toBeVisible()
  })

  it('si falla la baja, lo dice en el diálogo y se puede reintentar', async () => {
    const { user } = await openDetail([amabilis()])
    supabase.patchResponder = () => json({ message: 'Error' }, 500)
    await user.click(screen.getByRole('button', { name: DETAIL_TEXT.retire }))
    await user.click(
      within(dialog()).getByRole('button', { name: DETAIL_TEXT.retireConfirm }),
    )
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'No se pudieron guardar los cambios',
    )
    expect(datum(DETAIL_TEXT.status)).toHaveTextContent('Activa')

    supabase.patchResponder = null
    await user.click(
      within(dialog()).getByRole('button', { name: DETAIL_TEXT.retireConfirm }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(datum(DETAIL_TEXT.status)).toHaveTextContent('Perdida')
  })
})

describe('eliminación definitiva', () => {
  it('confirma que no se puede deshacer, atrapa el foco y empieza en "Cancelar"', async () => {
    const { user } = await openDetail([amabilis()])
    const remove = screen.getByRole('button', { name: DETAIL_TEXT.delete })
    await user.click(remove)

    expect(dialog()).toHaveAccessibleName(DETAIL_TEXT.deleteTitle)
    expect(dialog()).toHaveAccessibleDescription(/No se puede deshacer/)
    // Dice qué pasa con las fotos y con la bitácora (#265).
    expect(dialog()).toHaveAccessibleDescription(
      /todas sus fotos y todos los registros de su bitácora/,
    )
    const cancel = within(dialog()).getByRole('button', { name: 'Cancelar' })
    const confirm = within(dialog()).getByRole('button', {
      name: DETAIL_TEXT.deleteConfirm,
    })
    expect(cancel).toHaveFocus()
    expect(confirm).toHaveClass('orki-btn--danger')
    // Lo de detrás queda inerte.
    expect(screen.getByTestId('location').closest('[inert]')).not.toBeNull()
    await expectNoAxeViolations()

    // Tab da la vuelta dentro del diálogo.
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()

    await user.click(cancel)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(remove).toHaveFocus()
    expect(document.querySelector('[inert]')).toBeNull()
    expect(supabase.deletes()).toEqual([])
  })

  it('con el teclado: borra la planta y su carpeta de fotos y vuelve al inventario con el aviso', async () => {
    const { user } = await openDetail([amabilis(), CATTLEYA])
    screen.getByRole('button', { name: DETAIL_TEXT.delete }).focus()
    await user.keyboard('{Enter}')
    await user.tab()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(supabase.deletes()).toEqual([AMABILIS_ID])
    expect(supabase.removed().sort()).toEqual([
      `${USER}/${AMABILIS_ID}/photo-v1.webp`,
      `${USER}/${AMABILIS_ID}/thumb-v1.webp`,
    ])
    // Primero la fila y después los archivos.
    const log = supabase.requests().map((r) => `${r.method} ${r.url.pathname}`)
    expect(log.indexOf('DELETE /rest/v1/plants')).toBeLessThan(
      log.indexOf('DELETE /storage/v1/object/plant-photos'),
    )
    expect(
      await screen.findByText(/^Eliminaste de tu colección/),
    ).toHaveTextContent('Eliminaste de tu colección Phalaenopsis amabilis.')
    expect(
      screen.queryByRole('article', { name: 'Phalaenopsis amabilis' }),
    ).toBeNull()
    expect(summary()).toHaveTextContent('1 ejemplar · 1 género')
    await expectNoAxeViolations()
  })

  it('si no se pueden borrar las fotos, la planta ya no existe y el aviso lo dice', async () => {
    const { user } = await openDetail([amabilis()])
    supabase.storageResponder = () => json({ message: 'Error' }, 500)
    await user.click(screen.getByRole('button', { name: DETAIL_TEXT.delete }))
    await user.click(
      within(dialog()).getByRole('button', { name: DETAIL_TEXT.deleteConfirm }),
    )
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(supabase.rows.has(AMABILIS_ID)).toBe(false)
    expect(
      await screen.findByText(/^Eliminaste de tu colección/),
    ).toHaveTextContent(DETAIL_TEXT.deletedPhotosLeft)
  })

  it('si no se puede borrar la planta, no toca nada y permite reintentar', async () => {
    const { user } = await openDetail([amabilis()])
    supabase.deleteResponder = () => json({ message: 'Error' }, 500)
    await user.click(screen.getByRole('button', { name: DETAIL_TEXT.delete }))
    await user.click(
      within(dialog()).getByRole('button', { name: DETAIL_TEXT.deleteConfirm }),
    )
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      DELETE_ERROR_TEXT.failed,
    )
    expect(supabase.removed()).toEqual([])
    expect(location()).toBe(`/coleccion/${AMABILIS_ID}`)
    await expectNoAxeViolations()

    supabase.deleteResponder = null
    await user.click(
      within(dialog()).getByRole('button', { name: DETAIL_TEXT.deleteConfirm }),
    )
    await waitFor(() => expect(location()).toBe('/coleccion'))
  })

  it('al abrir el detalle directamente, eliminar lleva al inventario', async () => {
    supabase = fakeSupabase([amabilis()])
    vi.stubGlobal('fetch', supabase.fetch)
    const user = userEvent.setup()
    await renderPlantRoutes({
      entries: [`/coleccion/${AMABILIS_ID}`],
      plants: [amabilis()],
    })
    await openManage(user)
    await user.click(screen.getByRole('button', { name: DETAIL_TEXT.delete }))
    await user.click(
      within(dialog()).getByRole('button', { name: DETAIL_TEXT.deleteConfirm }),
    )
    await waitFor(() => expect(location()).toBe('/coleccion'))
  })
})

describe('sin conexión', () => {
  it('las acciones se desactivan con el motivo', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { user } = await openDetail([amabilis()])
    for (const name of [
      DETAIL_TEXT.edit,
      NOTES_TEXT.add,
      DETAIL_TEXT.retire,
      DETAIL_TEXT.delete,
    ]) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAccessibleDescription(DETAIL_TEXT.offline)
    }
    await user.click(screen.getByRole('button', { name: DETAIL_TEXT.delete }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await expectNoAxeViolations()
  })
})

describe('notas de la planta (#265)', () => {
  const notesPanel = () =>
    screen.getByRole('region', { name: NOTES_TEXT.title })
  const field = () => within(notesPanel()).getByRole('textbox')
  const save = () =>
    within(notesPanel()).getByRole('button', { name: NOTES_TEXT.save })

  it('añadir: el área de texto con su contador; guarda sin los espacios de los extremos', async () => {
    const { user } = await openDetail([amabilis()], { manage: false })
    expect(within(notesPanel()).getByText(NOTES_TEXT.empty)).toBeVisible()
    const add = within(notesPanel()).getByRole('button', {
      name: NOTES_TEXT.add,
    })
    await user.click(add)

    expect(field()).toHaveFocus()
    expect(field()).toHaveAccessibleName(NOTES_TEXT.title)
    expect(field()).toHaveAccessibleDescription('0 de 2000 caracteres')
    await expectNoAxeViolations()
    await user.type(field(), '  Llegó sin flor.{Enter}Riego cada 5 días.  ')
    expect(field()).toHaveAccessibleDescription('34 de 2000 caracteres')
    await user.click(save())

    await waitFor(() =>
      expect(supabase.patches()).toEqual([
        { notes: 'Llegó sin flor.\nRiego cada 5 días.' },
      ]),
    )
    expect(await within(notesPanel()).findByRole('status')).toHaveTextContent(
      NOTES_TEXT.saved,
    )
    expect(within(notesPanel()).queryByRole('textbox')).toBeNull()
    expect(
      within(notesPanel()).getByText(/Llegó sin flor\./),
    ).toHaveTextContent('Llegó sin flor. Riego cada 5 días.')
    // El foco vuelve a «Editar» (ya hay notas).
    expect(
      within(notesPanel()).getByRole('button', { name: 'Editar notas' }),
    ).toHaveFocus()
  })

  it('editar y vaciar: vacío es «sin notas» (null); sin cambios no envía nada', async () => {
    const { user } = await openDetail([amabilis({ notes: 'Riego.' })], {
      manage: false,
    })
    const edit = () =>
      within(notesPanel()).getByRole('button', { name: 'Editar notas' })

    // Sin cambios: se cierra sin escribir.
    await user.click(edit())
    expect(field()).toHaveValue('Riego.')
    await user.click(save())
    expect(supabase.patches()).toEqual([])
    expect(edit()).toHaveFocus()

    // Escape cancela y no guarda.
    await user.click(edit())
    await user.clear(field())
    await user.type(field(), 'Otra cosa')
    await user.keyboard('{Escape}')
    expect(within(notesPanel()).getByText('Riego.')).toBeVisible()
    expect(edit()).toHaveFocus()

    // Vaciar: solo espacios es lo mismo que nada.
    await user.click(edit())
    await user.clear(field())
    await user.type(field(), '   ')
    await user.click(save())
    await waitFor(() => expect(supabase.patches()).toEqual([{ notes: null }]))
    expect(await within(notesPanel()).findByRole('status')).toHaveTextContent(
      NOTES_TEXT.removed,
    )
    expect(within(notesPanel()).getByText(NOTES_TEXT.empty)).toBeVisible()
    expect(
      within(notesPanel()).getByRole('button', { name: NOTES_TEXT.add }),
    ).toHaveFocus()
  })

  it('si falla, lo dice, conserva lo escrito y se puede reintentar', async () => {
    const { user } = await openDetail([amabilis()], { manage: false })
    supabase.patchResponder = () => json({ message: 'Error' }, 500)
    await user.click(
      within(notesPanel()).getByRole('button', { name: NOTES_TEXT.add }),
    )
    await user.type(field(), 'Abono cada 15 días')
    await user.click(save())
    expect(await within(notesPanel()).findByRole('alert')).toHaveTextContent(
      'No se pudieron guardar los cambios',
    )
    expect(field()).toHaveValue('Abono cada 15 días')
    await expectNoAxeViolations()

    supabase.patchResponder = null
    await user.click(save())
    await waitFor(() =>
      expect(within(notesPanel()).queryByRole('textbox')).toBeNull(),
    )
    expect(within(notesPanel()).getByText('Abono cada 15 días')).toBeVisible()
    expect(supabase.patches()).toEqual([
      { notes: 'Abono cada 15 días' },
      { notes: 'Abono cada 15 días' },
    ])
  })

  it('más de 2000 caracteres: lo dice y no envía nada', async () => {
    const { user } = await openDetail([amabilis()], { manage: false })
    await user.click(
      within(notesPanel()).getByRole('button', { name: NOTES_TEXT.add }),
    )
    // Pegado, no tecleado: 2001 caracteres (con una tilde, un carácter).
    field().focus()
    await user.paste(`á${'a'.repeat(2000)}`)
    await user.click(save())
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(field()).toHaveAccessibleDescription(
      `${NOTES_TEXT.tooLong(2000)} 2001 de 2000 caracteres`,
    )
    expect(field()).toHaveFocus()
    expect(supabase.patches()).toEqual([])
  })
})
