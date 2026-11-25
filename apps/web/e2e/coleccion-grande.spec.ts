import type { Page } from '@playwright/test'
import { PLANTAS } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// «Mi colección» con muchas plantas (#292): buscar por identificador y por
// ubicación.
//
// Identificadores de la colección de partida (los pone el Supabase simulado
// como el disparador, por orden de alta): PHA-001 (amabilis), CAT-001 (la
// trianae perdida), CAT-002 (maxima), DEN-001, MAS-001 y ONC-001.

const tarjetas = (page: Page) => page.getByRole('main').getByRole('article')
const buscador = (page: Page) =>
  page.getByRole('searchbox', { name: 'Buscar en mi colección' })

const nombres = (page: Page) => tarjetas(page).getByRole('heading')

async function sinDesplazamientoHorizontal(page: Page) {
  const anchos = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: document.documentElement.clientWidth,
  }))
  expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana)
}

/**
 * «Ordenar»: en escritorio, en la barra del buscador; hasta 720 px, dentro
 * del panel de filtros. En cada ancho solo uno es accesible.
 */
async function ordenar(page: Page, opcion: string) {
  const control = page.getByRole('combobox', { name: 'Ordenar' })
  if ((page.viewportSize()?.width ?? 0) <= 720) {
    await expect(
      page.getByRole('search').getByRole('combobox', { name: 'Ordenar' }),
    ).toHaveCount(0)
    const filtros = page.getByRole('button', { name: /^Filtros/ })
    if ((await filtros.getAttribute('aria-expanded')) !== 'true') {
      await filtros.click()
    }
    await expect(
      page
        .getByRole('region', { name: 'Filtros de la colección' })
        .getByRole('combobox', { name: 'Ordenar' }),
    ).toBeVisible()
  }
  await expect(control).toHaveCount(1)
  await control.selectOption({ label: opcion })
  await expect(control.locator('option:checked')).toHaveText(opcion)
}

const POR_ALTA = [
  'Phalaenopsis amabilis',
  'Oncidium Sharry Baby',
  'Masdevallia veitchiana',
  'Dendrobium nobile',
  'Cattleya maxima',
]
const POR_NOMBRE = [
  'Cattleya maxima',
  'Dendrobium nobile',
  'Masdevallia veitchiana',
  'Oncidium Sharry Baby',
  'Phalaenopsis amabilis',
]
const POR_ADQUISICION = [
  'Oncidium Sharry Baby',
  'Masdevallia veitchiana',
  'Dendrobium nobile',
  'Cattleya maxima',
  'Phalaenopsis amabilis',
]

for (const ancho of [360, 1440]) {
  test(
    `ordenar a ${String(ancho)} px y recordarlo al volver`,
    { tag: ancho > 720 ? '@escritorio' : [] },
    async ({ page, supabase, revisarAccesibilidad }) => {
      // La amabilis se compró en marzo pero se registró la última: el orden
      // por alta y el de adquisición no coinciden.
      const amabilis = supabase.datos.plantas.find(
        (p) => p.id === PLANTAS.amabilis,
      )
      if (amabilis) amabilis.created_at = '2026-10-20T12:00:00.000Z'
      await page.setViewportSize({ width: ancho, height: 900 })
      await page.goto('/coleccion')

      await expect(nombres(page)).toHaveText(POR_ALTA)
      await ordenar(page, 'Nombre (A–Z)')
      await expect(nombres(page)).toHaveText(POR_NOMBRE)
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`inventario ordenado a ${String(ancho)} px`)

      await ordenar(page, 'Fecha de adquisición')
      await expect(nombres(page)).toHaveText(POR_ADQUISICION)

      // En lista, el mismo orden y el identificador en cada tarjeta.
      await page
        .getByRole('group', { name: 'Vista' })
        .getByRole('button', { name: 'Lista' })
        .click()
      await expect(nombres(page)).toHaveText(POR_ADQUISICION)
      await expect(
        page.getByRole('article', { name: 'Oncidium Sharry Baby' }),
      ).toContainText('ONC-001')
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`inventario en lista a ${String(ancho)} px`)

      // Se recuerda con la vista (preferencias del dispositivo), no en la
      // dirección.
      expect(new URL(page.url()).search).toBe('')
      await page.reload()
      await expect(nombres(page)).toHaveText(POR_ADQUISICION)
      await expect(
        page
          .getByRole('group', { name: 'Vista' })
          .getByRole('button', { name: 'Lista' }),
      ).toHaveAttribute('aria-pressed', 'true')
    },
  )
}

test('el identificador en la tarjeta, en cuadrícula y en lista', async ({
  page,
}) => {
  await page.goto('/coleccion')
  const vista = page.getByRole('group', { name: 'Vista' })
  for (const nombre of ['Cuadrícula', 'Lista']) {
    await vista.getByRole('button', { name: nombre }).click()
    // El nombre de la tarjeta sigue siendo el del encabezado; el
    // identificador va en su descripción.
    const amabilis = page.getByRole('article', {
      name: 'Phalaenopsis amabilis',
      exact: true,
    })
    await expect(amabilis).toContainText('PHA-001')
    await expect(amabilis).toHaveAccessibleDescription('Identificador PHA-001.')
    await expect(
      page.getByRole('article', { name: 'Cattleya maxima', exact: true }),
    ).toContainText('CAT-002')
  }
})

test('buscar por identificador y por ubicación', async ({
  page,
  revisarAccesibilidad,
}) => {
  await page.goto('/coleccion')
  await expect(tarjetas(page)).toHaveCount(5)
  await expect(buscador(page)).toHaveAttribute(
    'placeholder',
    'Nombre, código o ubicación',
  )

  for (const busqueda of ['PHA-001', 'pha 1', 'pha001']) {
    await buscador(page).fill(busqueda)
    await expect(tarjetas(page)).toHaveCount(1)
    await expect(
      page.getByRole('article', { name: 'Phalaenopsis amabilis' }),
    ).toBeVisible()
  }
  await expect(page.getByText('1 de 5 ejemplares coincide.')).toBeVisible()
  await revisarAccesibilidad('inventario, búsqueda por identificador')

  // Un número suelto no busca en los identificadores.
  await buscador(page).fill('001')
  await expect(
    page.getByText('Ninguno de tus 5 ejemplares coincide.'),
  ).toBeVisible()

  // Por ubicación.
  await buscador(page).fill('ventana sala')
  await expect(tarjetas(page)).toHaveCount(1)
  await expect(
    page.getByRole('article', { name: 'Phalaenopsis amabilis' }),
  ).toBeVisible()
})

test('el texto de ejemplo del buscador cabe entero a 360 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/coleccion')
  await expect(tarjetas(page)).toHaveCount(5)
  // Ancho del texto con la fuente del campo frente al hueco que deja el
  // campo entre la lupa y el botón de borrar. El texto de antes («Nombre,
  // género, apodo u origen») medía unos 247 px en un hueco de 238.
  const medidas = await buscador(page).evaluate(
    async (campo: HTMLInputElement) => {
      await document.fonts.ready
      const estilo = getComputedStyle(campo)
      const contexto = document.createElement('canvas').getContext('2d')
      if (!contexto) return null
      contexto.font = `${estilo.fontWeight} ${estilo.fontSize} ${estilo.fontFamily}`
      const hueco =
        campo.getBoundingClientRect().width -
        parseFloat(estilo.paddingLeft) -
        parseFloat(estilo.paddingRight) -
        parseFloat(estilo.borderLeftWidth) -
        parseFloat(estilo.borderRightWidth)
      return {
        texto: Math.ceil(contexto.measureText(campo.placeholder).width),
        hueco: Math.floor(hueco),
      }
    },
  )
  expect(medidas).not.toBeNull()
  expect(medidas?.texto).toBeLessThanOrEqual(medidas?.hueco ?? 0)
})

test(
  '«¿Ya la tengo?» no responde por identificador ni por ubicación',
  {
    tag: '@logica',
  },
  async ({ page, supabase }) => {
    const maxima = supabase.datos.plantas.find((p) => p.id === PLANTAS.maxima)
    if (maxima) maxima.location = 'Invernadero'
    await page.goto('/ya-la-tengo')
    const campo = page.getByRole('searchbox', { name: 'Nombre de la orquídea' })
    for (const busqueda of ['CAT-002', 'Invernadero']) {
      await campo.fill(busqueda)
      await expect(page.getByText('Aún no la tienes')).toBeVisible()
      await expect(page.getByText('Sí, la tienes')).toHaveCount(0)
    }
  },
)

test(
  'cuadrícula: cuatro columnas desde 1200 px, tres por debajo',
  { tag: '@escritorio' },
  async ({ page }) => {
    for (const [ancho, columnas] of [
      [1440, 4],
      [1200, 4],
      [1198, 3],
    ] as const) {
      await page.setViewportSize({ width: ancho, height: 900 })
      await page.goto('/coleccion')
      await expect(tarjetas(page)).toHaveCount(5)
      const filas = await tarjetas(page).evaluateAll((todas) =>
        todas.map((tarjeta) => Math.round(tarjeta.getBoundingClientRect().y)),
      )
      // Las de la primera fila empiezan a la misma altura.
      expect(
        filas.filter((y) => y === filas[0]).length,
        `${String(ancho)} px`,
      ).toBe(columnas)
      await sinDesplazamientoHorizontal(page)
    }
  },
)
