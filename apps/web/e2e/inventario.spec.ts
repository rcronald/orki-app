import { expect, firefoxSeCae, test } from './soporte/fixtures.ts'

// Inventario (#93, #94, #95, #15) y "¿Ya la tengo?" (#19): la colección leída
// de Supabase (simulado) por la fuente real de la app, en lista y en
// cuadrícula, con búsqueda y filtros, y la respuesta a si una orquídea ya está
// en la colección, también por un nombre común del catálogo.

const tarjetas = (page: import('@playwright/test').Page) =>
  page.getByRole('main').getByRole('article')

test('lista y cuadrícula', async ({ page, revisarAccesibilidad }) => {
  await page.goto('/coleccion')
  const resumen = page.getByRole('list', { name: 'Resumen de tu colección' })
  await expect(resumen).toContainText('5 orquídeas')
  await expect(resumen).toContainText('5 géneros')
  await expect(tarjetas(page)).toHaveCount(5)
  // La perdida no cuenta en la colección activa.
  await expect(
    page.getByRole('article', { name: 'Cattleya trianae' }),
  ).toHaveCount(0)

  const vista = page.getByRole('group', { name: 'Vista' })
  await expect(vista.getByRole('button', { name: 'Lista' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await revisarAccesibilidad('inventario en lista')

  await vista.getByRole('button', { name: 'Cuadrícula' }).click()
  await expect(
    vista.getByRole('button', { name: 'Cuadrícula' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(tarjetas(page)).toHaveCount(5)
  await revisarAccesibilidad('inventario en cuadrícula')

  // La vista elegida se recuerda en el dispositivo.
  await page.reload()
  await expect(
    page.getByRole('group', { name: 'Vista' }).getByRole('button', {
      name: 'Cuadrícula',
    }),
  ).toHaveAttribute('aria-pressed', 'true')

  // Del inventario al detalle de una planta.
  await page
    .getByRole('link', { name: 'Cattleya maxima', exact: true })
    .last()
    .click()
  await expect(
    page.getByRole('heading', { name: 'Cattleya maxima', level: 1 }),
  ).toBeVisible()
})

test('búsqueda en la colección', async ({ page }) => {
  await page.goto('/coleccion')
  await expect(tarjetas(page)).toHaveCount(5)

  const buscador = page.getByRole('searchbox', {
    name: 'Buscar en tu colección',
  })
  await buscador.fill('vivero los andes')
  await expect(page.getByRole('search').getByRole('status')).toHaveText(
    '2 de 5 orquídeas coinciden.',
  )
  await expect(tarjetas(page)).toHaveCount(2)
  await expect(
    page.getByRole('article', { name: 'Phalaenopsis amabilis' }),
  ).toBeVisible()
  await expect(
    page.getByRole('article', { name: 'Dendrobium nobile' }),
  ).toBeVisible()

  await buscador.fill('sharry')
  await expect(tarjetas(page)).toHaveCount(1)
  await expect(
    page.getByRole('article', { name: 'Oncidium Sharry Baby' }),
  ).toContainText('Nombre por validar')

  await page
    .getByRole('search')
    .getByRole('button', { name: 'Limpiar la búsqueda' })
    .click()
  await expect(buscador).toHaveValue('')
  await expect(tarjetas(page)).toHaveCount(5)
})

test('filtros', async ({ page, browserName, revisarAccesibilidad }) => {
  // Se cae al revisar con axe la pantalla con los filtros abiertos.
  firefoxSeCae(browserName)
  await page.goto('/coleccion')
  await expect(tarjetas(page)).toHaveCount(5)

  await page.getByRole('button', { name: 'Filtros' }).click()
  const panel = page.getByRole('region', { name: 'Filtros de la colección' })
  await expect(panel).toBeVisible()
  await revisarAccesibilidad('filtros abiertos')

  await panel
    .getByRole('group', { name: 'Origen' })
    .getByRole('button', { name: 'Vivero Los Andes' })
    .click()
  await panel
    .getByRole('group', { name: 'Color de la flor' })
    .getByRole('button', { name: 'Rosado' })
    .click()
  await expect(tarjetas(page)).toHaveCount(1)
  await expect(
    page.getByRole('article', { name: 'Dendrobium nobile' }),
  ).toBeVisible()
  await panel.getByRole('button', { name: 'Listo' }).click()

  // Los filtros activos quedan a la vista y se quitan uno a uno.
  const activos = page.getByRole('group', { name: 'Filtros activos' })
  await activos
    .getByRole('button', { name: 'Quitar el filtro Color de la flor: Rosado' })
    .click()
  await expect(tarjetas(page)).toHaveCount(2)
  await revisarAccesibilidad('filtros activos')

  // El estado: las perdidas.
  await page.getByRole('button', { name: /^Filtros/ }).click()
  await panel.getByRole('button', { name: 'Quitar filtros' }).click()
  await panel
    .getByRole('group', { name: 'Estado' })
    .getByRole('button', { name: 'Perdidas' })
    .click()
  await expect(tarjetas(page)).toHaveCount(1)
  await expect(
    page.getByRole('article', { name: 'Cattleya trianae' }),
  ).toBeVisible()
})

test.describe('¿Ya la tengo?', () => {
  const respuesta = (page: import('@playwright/test').Page, texto: string) =>
    page.getByRole('status').filter({ hasText: texto })

  test('sí, por un nombre común del catálogo', async ({
    page,
    revisarAccesibilidad,
  }) => {
    await page.goto('/coleccion')
    await page
      .getByRole('searchbox', { name: 'Buscar en tu colección' })
      .fill('orquidea luna')
    await expect(respuesta(page, 'Sí, la tienes')).toContainText(
      'Tienes 1 ejemplar de Phalaenopsis amabilis.',
    )
    await expect(
      page
        .getByRole('list', { name: 'Ejemplares que coinciden' })
        .getByRole('link'),
    ).toHaveAccessibleName(/Nombre común: Orquídea luna/)
    await revisarAccesibilidad('¿Ya la tengo? sí')
  })

  test('no, pero la tuvo', async ({ page }) => {
    await page.goto('/coleccion')
    await page
      .getByRole('searchbox', { name: 'Buscar en tu colección' })
      .fill('Cattleya trianae')
    await expect(respuesta(page, 'Aún no la tienes')).toContainText(
      'La tuviste: 1 ejemplar perdido.',
    )
    await expect(
      page
        .getByRole('list', { name: 'Ejemplares que tuviste' })
        .getByRole('link', { name: /Cattleya trianae/ }),
    ).toBeVisible()
  })

  test('no, y se puede registrar con ese nombre', async ({
    page,
    revisarAccesibilidad,
  }) => {
    await page.goto('/coleccion')
    await page
      .getByRole('searchbox', { name: 'Buscar en tu colección' })
      .fill('Vanda coerulea')
    await expect(respuesta(page, 'Aún no la tienes')).toContainText(
      'Vanda coerulea no está en tu colección.',
    )
    await revisarAccesibilidad('¿Ya la tengo? no')

    await page
      .getByRole('link', { name: 'Registrarla con este nombre' })
      .click()
    await expect(page).toHaveURL(/\/coleccion\/nueva\?nombre=Vanda\+coerulea$/)
    await expect(page.getByRole('combobox', { name: 'Nombre' })).toHaveValue(
      'Vanda coerulea',
    )
  })
})
