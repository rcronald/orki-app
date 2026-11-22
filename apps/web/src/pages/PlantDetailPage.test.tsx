import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionLoadError } from '../collection/source.ts'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { CATTLEYA, plant } from '../test/collection.ts'
import { fakeCollectionSource } from '../test/collection-source.ts'
import { fakeImageSource, renderPlantRoutes } from '../test/plant-routes.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

const AMABILIS = plant({
  id: '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b',
  enteredName: 'phalaenopsis amabilis',
  nickname: 'La blanca',
  origin: 'Vivero Los Andes',
  location: 'Ventana de la sala',
  flowerColor: 'white',
  photoInBloom: true,
  acquiredOn: '2026-11-01',
  photoPath: 'user_prueba/6f1c2a4e/photo-v1.webp',
  thumbnailPath: 'user_prueba/6f1c2a4e/thumb-v1.webp',
  createdAt: '2026-11-02T10:00:00+00:00',
})

const PENDING = plant({
  id: '7a2b3c4d-0000-4000-8000-000000000002',
  displayName: 'La naranja del mercado',
  displayNameIsScientific: false,
  enteredName: 'La naranja del mercado',
  species: null,
  genus: CATTLEYA,
  type: 'unknown',
  validation: 'pending',
  createdAt: '2026-11-01T10:00:00+00:00',
})

const location = () => screen.getByTestId('location').textContent
const heading = () => screen.getByRole('heading', { level: 1 })

/** El valor de un dato del detalle por su etiqueta. */
function datum(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' })
  const value = term.nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`Sin valor: ${label}`)
  return value
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  resetFakeClerk()
  setFakeClerk({ signedIn: true, userId: 'user_prueba' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PlantDetailPage', () => {
  it('desde el inventario abre el detalle con todos los datos y la foto completa', async () => {
    const images = fakeImageSource()
    const user = userEvent.setup()
    await renderPlantRoutes({
      entries: ['/coleccion'],
      plants: [AMABILIS, PENDING],
      images: images.source,
    })

    // La lista solo pide miniaturas.
    await waitFor(() => expect(images.acquire).toHaveBeenCalled())
    expect(
      images.acquire.mock.calls.every(([, kind]) => kind === 'thumbnail'),
    ).toBe(true)

    await user.click(
      screen.getByRole('link', { name: 'Phalaenopsis amabilis' }),
    )
    expect(location()).toBe(`/coleccion/${AMABILIS.id}`)
    expect(heading()).toHaveTextContent('Phalaenopsis amabilis')
    expect(heading()).toHaveFocus()
    expect(document.title).toBe('Phalaenopsis amabilis · Orki')

    // La foto grande, solo aquí.
    const photo = await screen.findByRole('img', {
      name: 'Foto de Phalaenopsis amabilis',
    })
    expect(photo).toHaveAttribute('src', `blob:${AMABILIS.photoPath}`)
    expect(images.acquire).toHaveBeenCalledWith(
      AMABILIS.photoPath,
      'photo',
      expect.anything(),
    )

    expect(datum(DETAIL_TEXT.validation)).toHaveTextContent('Validada')
    expect(datum(DETAIL_TEXT.genus)).toHaveTextContent('Phalaenopsis')
    expect(datum(DETAIL_TEXT.type)).toHaveTextContent('Especie')
    expect(datum(DETAIL_TEXT.status)).toHaveTextContent('Activa')
    expect(datum(DETAIL_TEXT.acquiredOn)).toHaveTextContent(
      '1 de noviembre de 2026',
    )
    expect(datum(DETAIL_TEXT.origin)).toHaveTextContent('Vivero Los Andes')
    expect(datum(DETAIL_TEXT.location)).toHaveTextContent('Ventana de la sala')
    expect(datum(DETAIL_TEXT.nickname)).toHaveTextContent('La blanca')
    expect(datum(DETAIL_TEXT.flowerColor)).toHaveTextContent('Blanco')
    expect(datum(DETAIL_TEXT.photoInBloom)).toHaveTextContent('Sí')
    // El nombre ingresado solo difiere en mayúsculas: no se repite.
    expect(screen.queryByText(DETAIL_TEXT.enteredName)).toBeNull()
    // Las acciones están a la vista.
    const actions = screen.getByRole('region', {
      name: DETAIL_TEXT.actionsLabel,
    })
    expect(within(actions).getAllByRole('button').length).toBeGreaterThan(0)
    await expectNoAxeViolations()
  })

  it('al volver, el inventario conserva la búsqueda, los filtros y la posición', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const user = userEvent.setup()
    await renderPlantRoutes({
      entries: ['/coleccion?q=amab&color=white'],
      plants: [AMABILIS, PENDING],
    })
    // Desplazado hasta la tarjeta.
    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })

    await user.click(
      screen.getByRole('link', { name: 'Phalaenopsis amabilis' }),
    )
    await user.click(screen.getByRole('link', { name: DETAIL_TEXT.back }))

    expect(location()).toBe('/coleccion?q=amab&color=white')
    expect(screen.getByRole('searchbox')).toHaveValue('amab')
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640))
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  })

  it('se recorre con el teclado: Enter en la tarjeta abre el detalle', async () => {
    const user = userEvent.setup()
    await renderPlantRoutes({ entries: ['/coleccion'], plants: [PENDING] })

    const link = screen.getByRole('link', { name: 'La naranja del mercado' })
    link.focus()
    await user.keyboard('{Enter}')
    expect(location()).toBe(`/coleccion/${PENDING.id}`)
    expect(heading()).toHaveFocus()
    // Volver queda justo antes del título; después vienen las acciones.
    await user.tab({ shift: true })
    expect(screen.getByRole('link', { name: DETAIL_TEXT.back })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: DETAIL_TEXT.edit })).toHaveFocus()
  })

  it('al abrir la dirección directamente espera a la colección', async () => {
    const source = fakeCollectionSource()
    await renderPlantRoutes({
      entries: [`/coleccion/${AMABILIS.id}`],
      plants: null,
      source,
    })

    expect(screen.getByRole('status')).toHaveTextContent(DETAIL_TEXT.loading)
    expect(heading()).toHaveTextContent(DETAIL_TEXT.loadingTitle)
    const loadingHeading = heading()
    await expectNoAxeViolations()

    await act(async () => {
      source.last().resolve([AMABILIS])
      await Promise.resolve()
    })
    expect(heading()).toHaveTextContent('Phalaenopsis amabilis')
    // El mismo h1: si tenía el foco, lo conserva.
    expect(heading()).toBe(loadingHeading)
    // Sin historial del inventario, volver es un enlace normal.
    expect(
      screen.getByRole('link', { name: DETAIL_TEXT.back }),
    ).toHaveAttribute('href', '/coleccion')
  })

  it('una dirección inexistente o de otra cuenta muestra "no encontrada", igual', async () => {
    const user = userEvent.setup()
    // Una planta de otra cuenta no llega en la colección (RLS): para la app
    // es lo mismo que una que no existe.
    const view = await renderPlantRoutes({
      entries: ['/coleccion/00000000-0000-4000-8000-0000000000ff'],
      plants: [AMABILIS],
    })
    expect(heading()).toHaveTextContent(DETAIL_TEXT.notFoundTitle)
    expect(screen.getByText(DETAIL_TEXT.notFound)).toBeInTheDocument()
    const first = view.container.innerHTML
    await expectNoAxeViolations()
    view.unmount()

    const other = await renderPlantRoutes({
      entries: ['/coleccion/no-es-un-id'],
      plants: [AMABILIS],
    })
    expect(other.container.innerHTML).toBe(
      first.replace(
        '/coleccion/00000000-0000-4000-8000-0000000000ff',
        '/coleccion/no-es-un-id',
      ),
    )

    await user.click(screen.getByRole('link', { name: DETAIL_TEXT.back }))
    expect(location()).toBe('/coleccion')
  })

  it('si no se pudo cargar la colección, lo dice y permite reintentar', async () => {
    const source = fakeCollectionSource()
    const user = userEvent.setup()
    await renderPlantRoutes({
      entries: [`/coleccion/${AMABILIS.id}`],
      plants: null,
      source,
    })
    await act(async () => {
      source.last().reject(new CollectionLoadError('offline'))
      await Promise.resolve()
    })
    expect(heading()).toHaveTextContent(DETAIL_TEXT.errorTitle)
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión')
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    await act(async () => {
      source.last().resolve([AMABILIS])
      await Promise.resolve()
    })
    expect(heading()).toHaveTextContent('Phalaenopsis amabilis')
  })

  it('un nombre por validar va sin cursiva, y sin foto muestra el marcador', async () => {
    await renderPlantRoutes({
      entries: [`/coleccion/${PENDING.id}`],
      plants: [PENDING],
    })
    expect(heading()).toHaveTextContent('La naranja del mercado')
    expect(heading().querySelector('.italic')).toBeNull()
    expect(datum(DETAIL_TEXT.validation)).toHaveTextContent(
      'Nombre por validar',
    )
    expect(datum(DETAIL_TEXT.type)).toHaveTextContent('Sin determinar')
    expect(datum(DETAIL_TEXT.origin)).toHaveTextContent(DETAIL_TEXT.missing)
    expect(screen.getByRole('img', { name: DETAIL_TEXT.noPhoto })).toBeVisible()
    // Sin foto no se dice si es en floración.
    expect(screen.queryByText(DETAIL_TEXT.photoInBloom)).toBeNull()
    await expectNoAxeViolations()
  })

  it('una planta no identificable lleva su etiqueta y explica que sigue en la colección', async () => {
    const unidentifiable = plant({
      displayName: 'Orquídea del abuelo',
      displayNameIsScientific: false,
      enteredName: 'Orquídea del abuelo',
      species: null,
      validation: 'unidentifiable',
    })
    await renderPlantRoutes({
      entries: [`/coleccion/${unidentifiable.id}`],
      plants: [unidentifiable],
    })
    const value = datum(DETAIL_TEXT.validation)
    expect(value).toHaveTextContent('No identificable')
    expect(value).not.toHaveTextContent('Nombre por validar')
    expect(value).toHaveTextContent(DETAIL_TEXT.unidentifiable)
    expect(DETAIL_TEXT.unidentifiable).toContain('sigue en tu colección')
  })

  it('muestra el nombre ingresado si difiere del de la especie', async () => {
    const linked = plant({ enteredName: 'Mariposa blanca' })
    await renderPlantRoutes({
      entries: [`/coleccion/${linked.id}`],
      plants: [linked],
    })
    expect(datum(DETAIL_TEXT.enteredName)).toHaveTextContent('Mariposa blanca')
    expect(heading().querySelector('.italic')).not.toBeNull()
  })
})

describe('PlantDetailPage sin conexión (#18)', () => {
  it('si la foto grande no se puede cargar, muestra la miniatura guardada', async () => {
    const images = fakeImageSource()
    images.acquire.mockImplementation((path, kind) =>
      kind === 'photo'
        ? Promise.reject(new Error('sin red'))
        : Promise.resolve(`blob:${path}`),
    )
    await renderPlantRoutes({
      entries: [`/coleccion/${AMABILIS.id}`],
      plants: [AMABILIS],
      images: images.source,
    })
    const photo = await screen.findByRole('img', {
      name: 'Foto de Phalaenopsis amabilis',
    })
    expect(photo).toHaveAttribute('src', `blob:${AMABILIS.thumbnailPath}`)
  })
})
