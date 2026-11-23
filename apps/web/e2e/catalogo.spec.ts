import type { Page } from '@playwright/test'
import { ESPECIES, GENEROS, PLANTAS } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'
import { ORIGEN_SUPABASE } from './soporte/supabase-simulado.ts'

// Catálogo público (#232): un visitante sin sesión busca, recorre los géneros
// y abre una ficha; con sesión, la ficha dice si la tiene y registra la
// especie; sin conexión, lo dice y lo ya visto se sigue viendo. Las cuatro
// funciones públicas llegan al Supabase simulado siempre sin token.

async function sinDesplazamientoHorizontal(page: Page) {
  const anchos = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: document.documentElement.clientWidth,
  }))
  expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana)
}

const campo = (page: Page) =>
  page.getByRole('searchbox', { name: 'Buscar en el catálogo' })

test.describe('sin sesión', () => {
  test.use({ sesion: { usuario: null } })

  for (const [nombre, ancho, alto] of [
    ['a 360 px', 360, 780],
    ['en escritorio', 1440, 900],
  ] as const) {
    test(
      `géneros, especies de un género y ficha ${nombre}`,
      { tag: ancho > 720 ? '@escritorio' : [] },
      async ({ page, supabase, revisarAccesibilidad }) => {
        await page.setViewportSize({ width: ancho, height: alto })
        await page.goto('/catalogo')
        await expect(
          page.getByRole('heading', { name: 'Catálogo', level: 1 }),
        ).toBeVisible()
        const letras = page.getByRole('navigation', {
          name: 'Géneros por letra',
        })
        // Oncidium no tiene especies en el catálogo: no sale.
        await expect(letras.getByRole('link')).toHaveText([
          'C',
          'D',
          'M',
          'P',
          'V',
        ])
        await expect(page.getByText('5 géneros · 6 especies')).toBeVisible()
        await sinDesplazamientoHorizontal(page)
        await revisarAccesibilidad(`catálogo ${nombre}`)

        await letras.getByRole('link', { name: 'P' }).click()
        await expect(page).toHaveURL(/\/catalogo\?letra=p$/)
        await page.getByRole('link', { name: /Phalaenopsis/ }).click()
        await expect(page).toHaveURL(
          new RegExp(`/catalogo/genero/${GENEROS.phalaenopsis}$`),
        )
        await expect(
          page.getByRole('heading', { name: 'Phalaenopsis', level: 1 }),
        ).toBeFocused()
        await expect(page.getByText('1 especie · Página 1 de 1')).toBeVisible()
        await revisarAccesibilidad(`género ${nombre}`)

        await page.getByRole('link', { name: /Phalaenopsis amabilis/ }).click()
        await expect(
          page.getByRole('heading', {
            name: 'Phalaenopsis amabilis',
            level: 1,
          }),
        ).toBeVisible()
        await expect(page.getByText('Phalaenopsis grandiflora')).toBeVisible()
        await expect(page.getByText('Orquídea luna')).toBeVisible()
        await expect(page.getByText('(español)')).toBeVisible()
        await expect(page.getByText('La tienes')).toHaveCount(0)
        await expect(
          page.getByRole('link', { name: 'Registrar esta especie' }),
        ).toHaveCount(0)
        await sinDesplazamientoHorizontal(page)
        await revisarAccesibilidad(`ficha ${nombre}`)

        // «Volver al catálogo» vuelve a la letra del género.
        await page.getByRole('link', { name: 'Volver al catálogo' }).click()
        await expect(page).toHaveURL(/\/catalogo\?letra=p$/)

        expect(supabase.llamadasPublicas.length).toBeGreaterThan(0)
        expect(supabase.llamadasPublicas.every((l) => !l.conToken)).toBe(true)
      },
    )
  }

  test(
    'buscar por un nombre común lleva a la especie aceptada, y «atrás» conserva la búsqueda',
    { tag: '@logica' },
    async ({ page, supabase, revisarAccesibilidad }) => {
      await page.goto('/catalogo')
      await campo(page).fill('flor de mayo')
      const resultado = page.getByRole('link', { name: /Cattleya trianae/ })
      await expect(resultado).toContainText('Nombre común: Flor de mayo')
      await expect(page.getByText('1 especie encontrada.')).toBeVisible()
      await expect(page).toHaveURL(/\/catalogo\?q=flor\+de\+mayo$/)
      await revisarAccesibilidad('búsqueda con resultados')

      await resultado.click()
      await expect(
        page.getByRole('heading', { name: 'Cattleya trianae', level: 1 }),
      ).toBeVisible()
      await page.goBack()
      await expect(campo(page)).toHaveValue('flor de mayo')
      await expect(resultado).toBeVisible()

      await campo(page).fill('stanhopea')
      await expect(
        page
          .getByText('No hay especies que coincidan con «stanhopea».')
          .first(),
      ).toBeVisible()
      expect(
        supabase.llamadasPublicas.filter(
          (l) => l.funcion === 'search_public_species',
        ).length,
      ).toBeGreaterThan(0)
      expect(supabase.llamadasPublicas.every((l) => !l.conToken)).toBe(true)
    },
  )

  test(
    'una ficha que no existe: «Especie no encontrada» con la vuelta',
    { tag: '@logica' },
    async ({ page }) => {
      await page.goto('/catalogo/especie/00000000-0000-4000-8000-000000009999')
      await expect(
        page.getByRole('heading', { name: 'Especie no encontrada', level: 1 }),
      ).toBeVisible()
      await page
        .getByRole('main')
        .getByRole('link', { name: 'Volver al catálogo' })
        .last()
        .click()
      await expect(page).toHaveURL(/\/catalogo$/)
    },
  )

  test('sin conexión: lo dice y lo ya cargado se sigue viendo', async ({
    page,
    context,
    revisarAccesibilidad,
  }) => {
    await page.goto('/catalogo')
    await expect(page.getByRole('link', { name: /Cattleya/ })).toBeVisible()
    // Las rutas de Playwright responden aunque el contexto esté sin conexión:
    // además de cortar la red, las peticiones a Supabase fallan como sin red.
    await page.route(`${ORIGEN_SUPABASE}/**`, (route) =>
      route.abort('internetdisconnected'),
    )
    await context.setOffline(true)

    await campo(page).fill('cattleya')
    await expect(page.getByText('Sin conexión', { exact: true })).toBeVisible()
    await expect(
      page.getByText(/El catálogo no está guardado en este dispositivo/),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await sinDesplazamientoHorizontal(page)
    await revisarAccesibilidad('catálogo sin conexión')

    // Los géneros ya cargados siguen ahí.
    await campo(page).fill('')
    await expect(page.getByRole('link', { name: /Cattleya/ })).toBeVisible()

    // Con la conexión de vuelta, la búsqueda sale sola.
    await campo(page).fill('cattleya')
    await page.unroute(`${ORIGEN_SUPABASE}/**`)
    await context.setOffline(false)
    await expect(
      page.getByRole('link', { name: /Cattleya maxima/ }),
    ).toBeVisible()
  })
})

test.describe('con sesión', () => {
  test(
    'la ficha dice si la tiene y registra la especie elegida',
    { tag: '@logica' },
    async ({ page, supabase, revisarAccesibilidad }) => {
      await page.goto(`/catalogo/especie/${ESPECIES.phalaenopsisAmabilis}`)
      await expect(
        page.getByRole('navigation', { name: 'Principal' }),
      ).toBeVisible()
      await expect(page.getByText('La tienes')).toBeVisible()
      await expect(page.getByText('1 ejemplar en tu colección')).toBeVisible()
      await revisarAccesibilidad('ficha con sesión')
      await page.getByRole('link', { name: /Ver en mi colección/ }).click()
      await expect(page).toHaveURL(/\/coleccion\?q=Phalaenopsis\+amabilis$/)

      await page.goto(`/catalogo/especie/${ESPECIES.vandaCoerulea}`)
      await expect(page.getByText('Aún no la tienes')).toBeVisible()
      await page.getByRole('link', { name: 'Registrar esta especie' }).click()
      await expect(page).toHaveURL(
        /\/coleccion\/nueva\?nombre=Vanda\+coerulea$/,
      )
      await expect(page.getByRole('combobox', { name: 'Nombre' })).toHaveValue(
        'Vanda coerulea',
      )
      await expect(page.getByText('Coincidencia en el catálogo')).toBeVisible()
      await page.getByRole('button', { name: 'Registrar orquídea' }).click()
      await expect(page).toHaveURL(/\/coleccion$/)
      const nueva = supabase
        .plantasDe('user_e2e')
        .find((planta) => planta.entered_name === 'Vanda coerulea')
      expect(nueva?.species_id).toBe(ESPECIES.vandaCoerulea)

      // Con sesión, el catálogo sigue yendo sin token.
      expect(supabase.llamadasPublicas.every((l) => !l.conToken)).toBe(true)
    },
  )

  // El caso que reprodujo el responsable (#296): la planta «Phalaenopsis
  // amabilis» está en el inventario con el nombre por validar (sin enlazar a
  // la especie) y la ficha de esa especie decía «Aún no la tienes».
  test('con un ejemplar del mismo nombre por validar dice «Podrías tenerla» y lleva a su ficha', async ({
    page,
    supabase,
    revisarAccesibilidad,
  }) => {
    const planta = supabase.datos.plantas.find((p) => p.id === PLANTAS.amabilis)
    if (!planta) throw new Error('Falta la planta de partida')
    planta.species_id = null
    planta.validation = 'pending'

    await page.goto(`/catalogo/especie/${ESPECIES.phalaenopsisAmabilis}`)
    await expect(page.getByText('Podrías tenerla')).toBeVisible()
    await expect(page.getByText('Aún no la tienes')).toHaveCount(0)
    await expect(
      page.getByText('Tienes 1 ejemplar con ese nombre, pendiente de validar.'),
    ).toBeVisible()
    await revisarAccesibilidad('ficha con un ejemplar por validar')
    await sinDesplazamientoHorizontal(page)

    // La acción destacada es ver el ejemplar, no registrar otro.
    await expect(
      page.getByRole('link', { name: 'Registrar esta especie' }),
    ).toHaveClass(/orki-btn--secondary/)
    await page.getByRole('link', { name: /Ver el ejemplar/ }).click()
    await expect(page).toHaveURL(new RegExp(`/coleccion/${PLANTAS.amabilis}$`))
  })
})
