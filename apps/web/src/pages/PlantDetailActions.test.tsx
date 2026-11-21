import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { DELETE_ERROR_TEXT, DETAIL_TEXT } from '../detail/texts.ts'
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

// Baja, reactivación y eliminación definitiva desde el detalle (#16), con la
// app real hasta supabase-js y PostgREST y Storage en memoria.

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

/** Inventario → detalle de la primera planta, como al navegar. */
async function openDetail(plants: readonly CollectionPlant[]) {
  supabase = fakeSupabase(plants)
  vi.stubGlobal('fetch', supabase.fetch)
  const user = userEvent.setup()
  const view = await renderPlantRoutes({ entries: ['/coleccion'], plants })
  const first = plants[0]
  if (!first) throw new Error('Sin plantas.')
  await user.click(screen.getByRole('link', { name: first.displayName }))
  return { ...view, user }
}

const location = () => screen.getByTestId('location').textContent
const dialog = () => screen.getByRole('dialog')
const summary = () =>
  screen.getByRole('list', { name: 'Resumen de tu colección' })

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
    expect(summary()).toHaveTextContent('1 orquídea')
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
    expect(summary()).toHaveTextContent('1 orquídea')
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
