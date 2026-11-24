import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import type { CollectionPlant } from '../collection/model.ts'
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import { NavigationFocusProvider } from '../routes/NavigationFocusProvider.tsx'
import { SEARCH_DEBOUNCE_MS } from '../lib/useCatalogSearch.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import {
  advanceClock,
  finishWait,
  typeWithClockStopped,
} from '../test/stopped-clock.ts'
import { CATTLEYA, plant } from '../test/collection.ts'
import {
  fakeCollectionSource,
  type FakeCollectionSource,
} from '../test/collection-source.ts'
import {
  CONFIG,
  fakePublicCatalog,
  fakeReferencePhoto,
  GENUS,
  SPECIES,
  type FakePublicCatalog,
} from '../test/public-catalog.ts'
import CatalogRoutes from './CatalogRoutes.tsx'
import { genusLetter, lettersOf } from './letters.ts'
import { forgetCatalogData } from './useCatalogData.ts'

// Catálogo público (#232): buscador, géneros por letra, especies de un género
// paginadas, ficha, estados (cargando, sin resultados, error, sin conexión,
// no encontrada) y, con sesión, «La tienes» y «Registrar esta especie». Las
// peticiones van al doble de test/public-catalog.ts y nunca llevan el token.

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

let catalog: FakePublicCatalog
let source: FakeCollectionSource
let online = true

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'orqui.app'
  window.localStorage.clear()
  resetFakeClerk()
  forgetCatalogData()
  catalog = fakePublicCatalog()
  vi.stubGlobal('fetch', catalog.fetch)
  initSupabase(CONFIG)
  setSessionTokenSource(null)
  source = fakeCollectionSource()
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
})

afterEach(() => {
  vi.useRealTimers()
  expect(catalog.unexpected).toEqual([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setSessionTokenSource(null)
})

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <div data-testid="state">{JSON.stringify(location.state ?? null)}</div>
    </>
  )
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NavigationFocusProvider>
        <CollectionProvider source={source} thumbnailSync={null}>
          <main>
            <Routes>
              <Route path="/catalogo/*" element={<CatalogRoutes />} />
              <Route path="/coleccion/nueva" element={<p>Registro</p>} />
              <Route path="/coleccion" element={<p>Inventario</p>} />
              <Route path="/creditos" element={<p>Créditos</p>} />
            </Routes>
          </main>
          <LocationProbe />
        </CollectionProvider>
      </NavigationFocusProvider>
    </MemoryRouter>,
  )
}

const location = () => screen.getByTestId('location').textContent
const field = () =>
  screen.getByRole('searchbox', { name: 'Buscar en el catálogo' })

describe('letras del índice de géneros', () => {
  it('sin el signo de híbrido ni tildes; lo demás, en «otros»', () => {
    expect(genusLetter('Cattleya')).toBe('c')
    expect(genusLetter('× Rhyncholaeliocattleya')).toBe('r')
    expect(genusLetter('×Brassolaeliocattleya')).toBe('b')
    expect(genusLetter('x Vascostylis')).toBe('v')
    expect(genusLetter('Xylobium')).toBe('x')
    expect(genusLetter('Ángulo')).toBe('a')
    expect(genusLetter('1 raro')).toBe('otros')
    expect(lettersOf(['Vanda', '1 raro', 'Aerides', '× Rhy'])).toEqual([
      'a',
      'r',
      'v',
      'otros',
    ])
  })
})

describe('portada del catálogo', () => {
  it('lista los géneros de la primera letra con su número de especies', async () => {
    renderAt('/catalogo')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Catálogo' }),
    ).toBeInTheDocument()
    const letters = await screen.findByRole('navigation', {
      name: 'Géneros por letra',
    })
    expect(
      within(letters)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['C', 'D', 'P', 'R'])
    expect(within(letters).getByRole('link', { name: 'C' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByText('4 géneros · 124 especies')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cattleya/ })).toHaveAttribute(
      'href',
      `/catalogo/genero/${GENUS.cattleya}`,
    )
    expect(screen.getByText('2 especies')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Catálogo · orqui.app'))
    // Sin sesión y sin token: solo la clave publicable.
    expect(catalog.calls.map((call) => call.fn)).toEqual(['list_public_genera'])
    expect(catalog.calls[0]?.authorization).toBe(
      `Bearer ${CONFIG.supabasePublishableKey}`,
    )
    await expectNoAxeViolations()
  })

  it('cambia de letra sin volver a pedir los géneros; el nothogénero va con su letra', async () => {
    const user = userEvent.setup()
    renderAt('/catalogo')
    const letters = await screen.findByRole('navigation', {
      name: 'Géneros por letra',
    })
    await user.click(within(letters).getByRole('link', { name: 'R' }))

    expect(location()).toBe('/catalogo?letra=r')
    expect(
      screen.getByRole('link', { name: /Rhyncholaeliocattleya/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Cattleya 2/ })).toBeNull()
    expect(screen.getByText('1 género con R.')).toBeInTheDocument()
    expect(catalog.calls).toHaveLength(1)
  })

  it('una letra que no existe muestra la primera', async () => {
    renderAt('/catalogo?letra=zz')
    expect(
      await screen.findByRole('link', { name: /Cattleya/ }),
    ).toBeInTheDocument()
  })

  it('con un fallo, «Reintentar» lo vuelve a pedir', async () => {
    catalog.failure = 500
    const user = userEvent.setup()
    renderAt('/catalogo')

    expect(
      await screen.findByText('No se pudo cargar el catálogo'),
    ).toBeInTheDocument()
    catalog.failure = null
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(
      await screen.findByRole('link', { name: /Cattleya/ }),
    ).toBeInTheDocument()
  })

  it('sin conexión, dice que el catálogo no está en el dispositivo', async () => {
    online = false
    catalog.failure = 'offline'
    renderAt('/catalogo')

    expect(await screen.findByText('Sin conexión')).toBeInTheDocument()
    expect(
      screen.getByText(/El catálogo no está guardado en este dispositivo/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expectNoAxeViolations()
  })

  it('lleva la atribución del Catalogue of Life y el enlace a los créditos', async () => {
    renderAt('/catalogo')
    await screen.findByRole('link', { name: /Cattleya/ })
    expect(screen.getByText(/filtradas a las orquídeas/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /CC BY 4.0/ })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    )
    expect(
      screen.getByRole('link', { name: 'Créditos y fuentes' }),
    ).toHaveAttribute('href', '/creditos')
  })
})

describe('buscador', () => {
  it('busca desde 2 letras, sin token, y dice por qué nombre coincidió', async () => {
    renderAt('/catalogo')
    // Con el reloj parado entre pulsaciones (#311): con el real, una pulsación
    // lenta en un equipo cargado dejaba salir una búsqueda a medias («lae»).
    await typeWithClockStopped(field(), 'laelia')
    const searchCalls = () =>
      catalog.calls.filter((call) => call.fn === 'search_public_species')
    await advanceClock(SEARCH_DEBOUNCE_MS - 1)
    expect(searchCalls()).toHaveLength(0)
    await finishWait(1)

    const result = await screen.findByRole('link', {
      name: /Cattleya purpurata/,
    })
    expect(result).toHaveAttribute(
      'href',
      `/catalogo/especie/${SPECIES.purpurata}`,
    )
    expect(result).toHaveTextContent('Cattleya · Sinónimo: Laelia purpurata')
    expect(screen.getByText('1 especie encontrada.')).toBeInTheDocument()
    expect(location()).toBe('/catalogo?q=laelia')
    // Sin los géneros mientras hay búsqueda.
    expect(
      screen.queryByRole('navigation', { name: 'Géneros por letra' }),
    ).toBeNull()
    const searches = searchCalls()
    // Una sola petición por lo escrito (la espera entre pulsaciones).
    expect(searches).toHaveLength(1)
    expect(searches[0]?.args).toEqual({ query: 'laelia', max_results: 15 })
    expect(searches[0]?.authorization).not.toContain('token')
    await expectNoAxeViolations()
  })

  it('no pierde letras al escribir deprisa', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt('/catalogo')
    await user.type(field(), 'orquídea luna')
    expect(field()).toHaveValue('orquídea luna')
    expect(
      await screen.findByRole('link', { name: /Phalaenopsis amabilis/ }),
    ).toHaveTextContent('Nombre común: Orquídea luna')
  })

  it('con 1 letra no busca y lo dice', async () => {
    const user = userEvent.setup()
    renderAt('/catalogo')
    await user.type(field(), 'c')
    expect(screen.getByText('Escribe al menos 2 letras.')).toBeInTheDocument()
    expect(
      catalog.calls.some((call) => call.fn === 'search_public_species'),
    ).toBe(false)
  })

  it('sin resultados, lo dice con la búsqueda', async () => {
    renderAt('/catalogo?q=stanhopea')
    expect(field()).toHaveValue('stanhopea')
    expect(
      await screen.findAllByText(
        'No hay especies que coincidan con «stanhopea».',
      ),
    ).toHaveLength(2)
  })

  it('sin conexión, el error con «Reintentar»', async () => {
    online = false
    catalog.failure = 'offline'
    renderAt('/catalogo?q=cattleya')
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument()
  })

  it('lo ya buscado en la visita se sigue viendo sin conexión', async () => {
    const first = renderAt('/catalogo?q=cattleya')
    await screen.findByRole('link', { name: /Cattleya maxima/ })
    first.unmount()

    online = false
    catalog.failure = 'offline'
    renderAt('/catalogo?q=cattleya')
    expect(
      screen.getByRole('link', { name: /Cattleya maxima/ }),
    ).toBeInTheDocument()
  })
})

describe('especies de un género', () => {
  it('pagina de 50 en 50 con el total y enlaces a cada página', async () => {
    const user = userEvent.setup()
    renderAt(`/catalogo/genero/${GENUS.dendrobium}`)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Dendrobium' }),
    ).toBeInTheDocument()
    expect(screen.getByText('120 especies · Página 1 de 3')).toBeInTheDocument()
    const list = screen.getByRole('region', { name: /^Especies/ })
    expect(within(list).getAllByRole('listitem')).toHaveLength(50)
    const pages = screen.getByRole('navigation', {
      name: 'Páginas de Dendrobium',
    })
    expect(within(pages).queryByRole('link', { name: /Anterior/ })).toBeNull()
    await user.click(within(pages).getByRole('link', { name: /Siguiente/ }))

    expect(location()).toBe(`/catalogo/genero/${GENUS.dendrobium}?pagina=2`)
    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus()
    expect(screen.getByText('120 especies · Página 2 de 3')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Volver al catálogo' }),
    ).toHaveAttribute('href', '/catalogo?letra=d')
    await expectNoAxeViolations()
  })

  it('una página mayor que la última muestra la última y corrige la dirección', async () => {
    renderAt(`/catalogo/genero/${GENUS.dendrobium}?pagina=9`)
    expect(await screen.findByText('Página 3 de 3')).toBeInTheDocument()
    await waitFor(() =>
      expect(location()).toBe(`/catalogo/genero/${GENUS.dendrobium}?pagina=3`),
    )
    // La página corregida no se vuelve a pedir.
    expect(
      catalog.calls.filter((call) => call.fn === 'list_public_genus_species'),
    ).toHaveLength(1)
  })

  it('un género que no existe: «Género no encontrado» con la vuelta', async () => {
    renderAt('/catalogo/genero/00000000-0000-4000-8000-000000009999')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Género no encontrado',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: 'Volver al catálogo' }),
    ).toHaveLength(2)
  })
})

describe('fotos de referencia (#234)', () => {
  const PUBLIC =
    'https://ejemplo.supabase.co/storage/v1/object/public/species-photos'

  function withPhoto(id: string, overrides = {}) {
    const species = catalog.data.species.find((item) => item.id === id)
    if (species) species.reference_photo = fakeReferencePhoto(id, overrides)
  }

  it('la ficha muestra la foto con su rótulo, su tamaño y su crédito', async () => {
    withPhoto(SPECIES.amabilis)
    renderAt(`/catalogo/especie/${SPECIES.amabilis}`)
    const image = await screen.findByRole('img', {
      name: 'Foto de referencia de Phalaenopsis amabilis',
    })
    expect(image).toHaveAttribute(
      'src',
      `${PUBLIC}/${SPECIES.amabilis}/medium-12345.webp`,
    )
    expect(image).toHaveAttribute('width', '480')
    expect(image).toHaveAttribute('height', '360')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
    const figure = image.closest('figure')
    expect(figure).not.toBeNull()
    const credit = within(figure as HTMLElement)
    expect(credit.getAllByText(/Foto de referencia/).length).toBeGreaterThan(0)
    expect(figure).toHaveTextContent(
      'Foto: Ana Pérez, CC BY 4.0 (se abre en otra pestaña), reducida.',
    )
    expect(credit.getByRole('link', { name: /CC BY 4.0/ })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/legalcode.es',
    )
    expect(
      credit.getByRole('link', { name: /Ver el original en iNaturalist/ }),
    ).toHaveAttribute('href', 'https://www.inaturalist.org/photos/12345')
    await expectNoAxeViolations()
  })

  it('una foto CC0 sin adaptar no dice «reducida»', async () => {
    withPhoto(SPECIES.amabilis, { license: 'cc0', is_modified: false })
    renderAt(`/catalogo/especie/${SPECIES.amabilis}`)
    const link = await screen.findByRole('link', { name: /CC0 1.0/ })
    expect(link).toHaveAttribute(
      'href',
      'https://creativecommons.org/publicdomain/zero/1.0/legalcode.es',
    )
    expect(link.closest('p')).not.toHaveTextContent('reducida')
  })

  it('sin foto, o si la imagen no carga, la ficha no deja hueco', async () => {
    withPhoto(SPECIES.amabilis)
    renderAt(`/catalogo/especie/${SPECIES.amabilis}`)
    const image = await screen.findByRole('img', {
      name: /Foto de referencia/,
    })
    act(() => {
      image.dispatchEvent(new Event('error'))
    })
    expect(screen.queryByRole('figure')).toBeNull()
    expect(screen.queryByText(/Foto: Ana Pérez/)).toBeNull()
  })

  it('una licencia que no es de las aceptadas no se muestra', async () => {
    withPhoto(SPECIES.amabilis, { license: 'cc-by-nc' as 'cc-by' })
    renderAt(`/catalogo/especie/${SPECIES.amabilis}`)
    await screen.findByRole('region', { name: 'Sinónimos' })
    expect(screen.queryByRole('img', { name: /Foto de referencia/ })).toBeNull()
  })

  it('la búsqueda pone la miniatura y el crédito; las filas sin foto guardan el hueco', async () => {
    withPhoto(SPECIES.maxima)
    const user = userEvent.setup()
    const { container } = renderAt('/catalogo')
    await user.type(field(), 'cattleya')
    const withThumb = await screen.findByRole('link', {
      name: /Cattleya maxima/,
    })
    expect(withThumb).toHaveTextContent(
      'Foto de referencia: Ana Pérez, CC BY 4.0',
    )
    const thumb = withThumb.querySelector('img')
    expect(thumb).toHaveAttribute(
      'src',
      `${PUBLIC}/${SPECIES.maxima}/thumb-12345.webp`,
    )
    expect(thumb).toHaveAttribute('alt', '')
    const without = screen.getByRole('link', { name: /Cattleya purpurata/ })
    expect(without.querySelector('img')).toBeNull()
    expect(without.querySelector('span[aria-hidden="true"]')).not.toBeNull()
    // Todas las filas empiezan igual: miniatura o hueco del mismo tamaño.
    for (const row of container.querySelectorAll('.orki-action')) {
      expect(row.firstElementChild).toHaveClass('size-[44px]')
    }
    await expectNoAxeViolations()
  })

  it('sin ninguna foto, las filas quedan como antes', async () => {
    const user = userEvent.setup()
    renderAt('/catalogo')
    await user.type(field(), 'cattleya')
    const row = await screen.findByRole('link', { name: /Cattleya maxima/ })
    expect(row.querySelector('img, span[aria-hidden="true"]')).toBeNull()
  })

  it('las especies de un género llevan la miniatura de las que tienen foto', async () => {
    const first = catalog.data.species.find(
      (item) => item.scientific_name === 'Dendrobium especie002',
    )?.id as string
    withPhoto(first)
    renderAt(`/catalogo/genero/${GENUS.dendrobium}`)
    await screen.findByRole('heading', { level: 1, name: 'Dendrobium' })
    const list = screen.getByRole('region', { name: /^Especies/ })
    const row = list.querySelector(
      `a[href="/catalogo/especie/${first}"]`,
    ) as HTMLElement
    expect(row.querySelector('img')).toHaveAttribute(
      'src',
      `${PUBLIC}/${first}/thumb-12345.webp`,
    )
    expect(row).toHaveTextContent('Foto de referencia: Ana Pérez, CC BY 4.0')
  })
})

describe('ficha de la especie', () => {
  it('sin sesión: nombre en cursiva, género, tipo, nombres y fuente', async () => {
    renderAt(`/catalogo/especie/${SPECIES.amabilis}`)

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Phalaenopsis amabilis',
    })
    expect(heading.querySelector('.italic')).not.toBeNull()
    expect(
      screen.getByText('Especie del género Phalaenopsis'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Phalaenopsis' })).toHaveAttribute(
      'href',
      `/catalogo/genero/${GENUS.phalaenopsis}`,
    )
    const synonyms = screen.getByRole('region', { name: 'Sinónimos' })
    expect(within(synonyms).getAllByRole('listitem')).toHaveLength(2)
    expect(
      within(synonyms).getByText('Se muestran 2 de sus 140 sinónimos.'),
    ).toBeInTheDocument()
    const common = screen.getByRole('region', { name: 'Nombres comunes' })
    expect(within(common).getByText('Orquídea luna')).toHaveAttribute(
      'lang',
      'es',
    )
    expect(within(common).getByText('(español)')).toBeInTheDocument()
    const sourcePanel = screen.getByRole('region', { name: 'Fuente' })
    expect(
      within(sourcePanel).getByRole('link', {
        name: /Ver el taxón en el Catalogue of Life/,
      }),
    ).toHaveAttribute(
      'href',
      'https://www.catalogueoflife.org/data/taxon/5T6MX',
    )
    expect(screen.queryByText('La tienes')).toBeNull()
    expect(screen.queryByText('Registrar esta especie')).toBeNull()
    await waitFor(() =>
      expect(document.title).toBe('Phalaenopsis amabilis · orqui.app'),
    )
    await expectNoAxeViolations()
  })

  it('un híbrido de la lista curada lo dice, sin enlace a COL', async () => {
    renderAt(`/catalogo/especie/${SPECIES.rlcHybrid}`)
    expect(await screen.findByText(/Híbrido del género/)).toBeInTheDocument()
    expect(screen.getByText('Lista curada de orqui.app')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ver el taxón/ })).toBeNull()
    expect(
      screen.getByText('No tiene sinónimos en el catálogo.'),
    ).toBeInTheDocument()
  })

  it('un id que no existe o no es un uuid: «Especie no encontrada»', async () => {
    renderAt('/catalogo/especie/no-es-un-id')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Especie no encontrada',
      }),
    ).toBeInTheDocument()
    expect(catalog.calls).toEqual([])
    await expectNoAxeViolations()
  })

  describe('con sesión', () => {
    beforeEach(() => {
      setFakeClerk({ signedIn: true, userId: 'user_a' })
      setSessionTokenSource(() => Promise.resolve('token_de_sesion'))
    })

    async function resolveCollection(plants: readonly CollectionPlant[]) {
      // La colección se pide después de leer la copia local, que es
      // asíncrona: la ficha puede pintarse antes. respond() espera a la
      // petición (antes fallaba de vez en cuando con «No se ha pedido la
      // colección»).
      await source.respond(plants)
    }

    it('«La tienes» con el número de ejemplares y el enlace a la colección', async () => {
      renderAt(`/catalogo/especie/${SPECIES.amabilis}`)
      await screen.findByRole('heading', { level: 1, name: /amabilis/ })
      expect(screen.getByText('Comprobando tu colección…')).toBeInTheDocument()
      const linked = plant({
        species: {
          id: SPECIES.amabilis,
          scientificName: 'Phalaenopsis amabilis',
          type: 'species',
          status: 'imported',
        },
      })
      await resolveCollection([
        linked,
        { ...linked, id: 'otra' },
        { ...linked, id: 'perdida', status: 'lost' },
      ])

      expect(screen.getByText('La tienes')).toBeInTheDocument()
      expect(
        screen.getByText('2 ejemplares en tu colección'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: /Ver en mi colección/ }),
      ).toHaveAttribute('href', '/coleccion?q=Phalaenopsis+amabilis')
      // La ficha sigue sin token: solo las lecturas de la colección lo llevan.
      expect(
        catalog.calls.every(
          (call) =>
            call.authorization === `Bearer ${CONFIG.supabasePublishableKey}`,
        ),
      ).toBe(true)
      await expectNoAxeViolations()
    })

    it('«Aún no la tienes» y «Registrar esta especie» con la especie elegida', async () => {
      const user = userEvent.setup()
      renderAt(`/catalogo/especie/${SPECIES.purpurata}`)
      await screen.findByRole('heading', { level: 1, name: /purpurata/ })
      await resolveCollection([plant()])

      expect(screen.getByText('Aún no la tienes')).toBeInTheDocument()
      await user.click(
        screen.getByRole('link', { name: 'Registrar esta especie' }),
      )
      expect(location()).toBe('/coleccion/nueva?nombre=Cattleya+purpurata')
      expect(JSON.parse(screen.getByTestId('state').textContent)).toEqual({
        catalogSpecies: {
          id: SPECIES.purpurata,
          scientificName: 'Cattleya purpurata',
          genus: { id: GENUS.cattleya, name: 'Cattleya' },
          type: 'species',
        },
      })
    })

    describe('ejemplares pendientes de validar (#296)', () => {
      /** Una planta registrada con un nombre y sin enlazar a una especie. */
      function pending(
        enteredName: string,
        overrides: Partial<CollectionPlant> = {},
      ) {
        return plant({
          displayName: enteredName,
          displayNameIsScientific: false,
          enteredName,
          species: null,
          validation: 'pending',
          ...overrides,
        })
      }

      const linkedAmabilis = () =>
        plant({
          species: {
            id: SPECIES.amabilis,
            scientificName: 'Phalaenopsis amabilis',
            type: 'species',
            status: 'imported',
          },
        })

      it('«Podrías tenerla» con un ejemplar del mismo nombre sin enlazar, y acceso a su ficha', async () => {
        renderAt(`/catalogo/especie/${SPECIES.amabilis}`)
        await screen.findByRole('heading', { level: 1, name: /amabilis/ })
        const unlinked = pending('Phalaenopsis amabilis')
        await resolveCollection([unlinked])

        expect(screen.queryByText('Aún no la tienes')).toBeNull()
        expect(screen.getByText('Podrías tenerla')).toBeInTheDocument()
        expect(
          screen.getByText(
            'Tienes 1 ejemplar con ese nombre, pendiente de validar.',
          ),
        ).toBeInTheDocument()
        expect(
          screen.getByRole('link', { name: /Ver el ejemplar/ }),
        ).toHaveAttribute('href', `/coleccion/${unlinked.id}`)
        // Registrar sigue ahí, pero no es la acción destacada.
        const register = screen.getByRole('link', {
          name: 'Registrar esta especie',
        })
        expect(register).toHaveClass('orki-btn--secondary')
        expect(register).not.toHaveClass('orki-btn--primary')
        await expectNoAxeViolations()
      })

      it('coincide por abreviatura, sinónimo y epíteto con el género; no por otra especie', async () => {
        renderAt(`/catalogo/especie/${SPECIES.amabilis}`)
        await screen.findByRole('heading', { level: 1, name: /amabilis/ })
        await resolveCollection([
          pending('Phal. amabilis'),
          pending('Phalaenopsis grandiflora'),
          pending('amabilis'),
          pending('Phalaenopsis schilleriana'),
          pending('amabilis', { genus: CATTLEYA }),
        ])

        expect(screen.getByText('Podrías tenerla')).toBeInTheDocument()
        expect(
          screen.getByText(
            'Tienes 3 ejemplares con ese nombre, pendientes de validar.',
          ),
        ).toBeInTheDocument()
        const link = screen.getByRole('link', { name: /Ver los ejemplares/ })
        expect(link.getAttribute('href')).toMatch(/^\/coleccion\?/)
        expect(link.getAttribute('href')).toContain('validacion=pending')
      })

      it('«La tienes» con los enlazados y una mención a los pendientes', async () => {
        renderAt(`/catalogo/especie/${SPECIES.amabilis}`)
        await screen.findByRole('heading', { level: 1, name: /amabilis/ })
        await resolveCollection([
          linkedAmabilis(),
          pending('Phalaenopsis amabilis'),
        ])

        expect(screen.getByText('La tienes')).toBeInTheDocument()
        expect(
          screen.getByText('1 ejemplar en tu colección'),
        ).toBeInTheDocument()
        expect(
          screen.getByText(
            'Además, tienes 1 ejemplar con ese nombre, pendiente de validar.',
          ),
        ).toBeInTheDocument()
      })

      it('los dados de baja no cuentan: «la tuviste», como en «¿Ya la tengo?»', async () => {
        renderAt(`/catalogo/especie/${SPECIES.amabilis}`)
        await screen.findByRole('heading', { level: 1, name: /amabilis/ })
        await resolveCollection([
          pending('Phalaenopsis amabilis', { status: 'lost' }),
          { ...linkedAmabilis(), status: 'gifted' },
        ])

        expect(screen.queryByText('Podrías tenerla')).toBeNull()
        expect(screen.queryByText('La tienes')).toBeNull()
        expect(screen.getByText('No, pero la tuviste')).toBeInTheDocument()
        expect(
          screen.getByText(
            'La tuviste: 1 ejemplar perdido y 1 ejemplar regalado.',
          ),
        ).toBeInTheDocument()
      })
    })

    it('sin conexión, registrar queda desactivado con el motivo', async () => {
      renderAt(`/catalogo/especie/${SPECIES.maxima}`)
      await screen.findByRole('heading', { level: 1, name: /maxima/ })
      await resolveCollection([])
      await act(async () => {
        online = false
        window.dispatchEvent(new Event('offline'))
        await Promise.resolve()
      })

      const register = screen.getByRole('button', {
        name: 'Registrar esta especie',
      })
      expect(register).toHaveAttribute('aria-disabled', 'true')
      expect(register).toHaveAccessibleDescription(
        'Para registrarla necesitas conexión y la sesión confirmada.',
      )
      // La ficha ya cargada se sigue viendo.
      expect(
        screen.getByRole('heading', { level: 1, name: 'Cattleya maxima' }),
      ).toBeInTheDocument()
    })
  })
})
