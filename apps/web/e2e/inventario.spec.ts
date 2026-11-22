import type { Locator, Page } from '@playwright/test'
import { expect, test } from './soporte/fixtures.ts'

// «Mi colección» (#93, #94, #95, #15, #208): la colección leída de Supabase
// (simulado) por la fuente real de la app, con la cabecera (contador y
// acciones), un único buscador, «Filtros», los accesos por género, la
// cuadrícula o la lista y la exportación. La consulta «¿Ya la tengo?» tiene su
// propia pantalla (#209).

const tarjetas = (page: Page) => page.getByRole('main').getByRole('article')
const buscador = (page: Page) =>
  page.getByRole('searchbox', { name: 'Buscar en mi colección' })
const generos = (page: Page) => page.getByRole('group', { name: 'Género' })

async function sinDesplazamientoHorizontal(page: Page) {
  const anchos = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: document.documentElement.clientWidth,
  }))
  expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana)
}

/** Cada control mide al menos 44 × 44 px (zona táctil, #176). */
async function objetivosDe44(controles: Locator) {
  for (const control of await controles.all()) {
    const caja = await control.boundingBox()
    expect(caja, await control.innerText()).not.toBeNull()
    if (!caja) continue
    // Redondeado: Firefox mide 43,99994 px en un control de 44 px.
    expect(
      Math.round(caja.height),
      await control.innerText(),
    ).toBeGreaterThanOrEqual(44)
    expect(
      Math.round(caja.width),
      await control.innerText(),
    ).toBeGreaterThanOrEqual(44)
  }
}

test('cabecera, cuadrícula y lista', async ({ page, revisarAccesibilidad }) => {
  await page.goto('/coleccion')
  await expect(
    page.getByRole('heading', { name: 'Mi colección', level: 1 }),
  ).toBeVisible()
  // La perdida no cuenta.
  await expect(page.locator('.orki-pagehead__meta')).toHaveText(
    '5 ejemplares · 5 géneros',
  )
  await expect(
    page.getByRole('link', { name: 'Registrar orquídea' }),
  ).toHaveAttribute('href', '/coleccion/nueva')
  await expect(
    page.getByRole('link', { name: '¿Ya la tengo?' }),
  ).toHaveAttribute('href', '/ya-la-tengo')
  await expect(tarjetas(page)).toHaveCount(5)
  await expect(
    page.getByRole('article', { name: 'Cattleya trianae' }),
  ).toHaveCount(0)

  // Tarjetas: apodo y ubicación si los hay; insignia solo si pide atención.
  const amabilis = page.getByRole('article', { name: 'Phalaenopsis amabilis' })
  await expect(amabilis).toContainText('La blanca')
  await expect(amabilis).toContainText('Ventana de la sala')
  await expect(amabilis).not.toContainText('Validada')
  await expect(
    page.getByRole('article', { name: 'Oncidium Sharry Baby' }),
  ).toContainText('Nombre por validar')

  // Sin preferencia guardada: cuadrícula.
  const vista = page.getByRole('group', { name: 'Vista' })
  await expect(
    vista.getByRole('button', { name: 'Cuadrícula' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await revisarAccesibilidad('inventario en cuadrícula')

  await vista.getByRole('button', { name: 'Lista' }).click()
  await expect(vista.getByRole('button', { name: 'Lista' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(tarjetas(page).first()).toHaveClass(/orki-card--row/)
  await revisarAccesibilidad('inventario en lista')

  // La vista elegida se recuerda en el dispositivo.
  await page.reload()
  await expect(
    page.getByRole('group', { name: 'Vista' }).getByRole('button', {
      name: 'Lista',
    }),
  ).toHaveAttribute('aria-pressed', 'true')

  // «Exportar a CSV», bajo la lista.
  await expect(
    page.getByRole('button', { name: 'Exportar a CSV' }),
  ).toBeVisible()

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
  // Un único campo de búsqueda en la pantalla (sin lupa en la barra).
  await expect(page.getByRole('searchbox')).toHaveCount(1)

  await buscador(page).fill('vivero los andes')
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

  await buscador(page).fill('sharry')
  await expect(tarjetas(page)).toHaveCount(1)

  // Por un nombre común del catálogo (de la copia local).
  await buscador(page).fill('orquidea luna')
  await expect(tarjetas(page)).toHaveCount(1)
  await expect(
    page.getByRole('article', { name: 'Phalaenopsis amabilis' }),
  ).toBeVisible()

  await page
    .getByRole('search')
    .getByRole('button', { name: 'Limpiar la búsqueda' })
    .click()
  await expect(buscador(page)).toHaveValue('')
  await expect(tarjetas(page)).toHaveCount(5)
})

test('al escribir deprisa tecla a tecla no se pierden letras', async ({
  page,
}) => {
  await page.goto('/coleccion')
  await expect(tarjetas(page)).toHaveCount(5)
  await buscador(page).pressSequentially('masdevallia veitchiana')
  await expect(buscador(page)).toHaveValue('masdevallia veitchiana')
  await expect(tarjetas(page)).toHaveCount(1)
  await expect(page).toHaveURL(/\?q=masdevallia\+veitchiana$/)
})

test('/coleccion?q= abre el inventario con ese texto en el buscador', async ({
  page,
}) => {
  await page.goto('/coleccion?q=nobile')
  await expect(buscador(page)).toHaveValue('nobile')
  await expect(tarjetas(page)).toHaveCount(1)
  await expect(
    page.getByRole('article', { name: 'Dendrobium nobile' }),
  ).toBeVisible()
})

test('accesos por género', async ({ page, revisarAccesibilidad }) => {
  await page.goto('/coleccion')
  await expect(tarjetas(page)).toHaveCount(5)

  // De más a menos plantas (Cattleya tiene también la perdida); a igualdad,
  // alfabético.
  await expect(generos(page).getByRole('button')).toHaveText([
    'Todos',
    'Cattleya',
    'Dendrobium',
    'Masdevallia',
    'Oncidium',
    'Phalaenopsis',
  ])
  await expect(
    generos(page).getByRole('button', { name: 'Todos' }),
  ).toHaveAttribute('aria-pressed', 'true')

  await generos(page).getByRole('button', { name: 'Cattleya' }).click()
  await expect(tarjetas(page)).toHaveCount(1)
  await generos(page).getByRole('button', { name: 'Dendrobium' }).click()
  await expect(tarjetas(page)).toHaveCount(2)
  await expect(page).toHaveURL(/genero=.*genero=/)
  await revisarAccesibilidad('accesos por género')

  await generos(page).getByRole('button', { name: 'Todos' }).click()
  await expect(tarjetas(page)).toHaveCount(5)
})

test('filtros', async ({ page, revisarAccesibilidad }) => {
  await page.goto('/coleccion')
  await expect(tarjetas(page)).toHaveCount(5)

  await page.getByRole('button', { name: 'Filtros' }).click()
  const panel = page.getByRole('region', { name: 'Filtros de la colección' })
  await expect(panel).toBeVisible()
  // El género no está en el panel: tiene su fila.
  await expect(panel.getByRole('group', { name: 'Género' })).toHaveCount(0)
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
  // Chromium lee un espacio antes de la coma (el número es un bloque en
  // línea): «Filtros , 2 activos».
  await expect(
    page.getByRole('button', { name: /^Filtros ?, 2 activos$/ }),
  ).toBeVisible()

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

  // Agrupar por género, en el panel.
  await panel
    .getByRole('group', { name: 'Estado' })
    .getByRole('button', { name: 'Activas' })
    .click()
  await panel.getByRole('button', { name: 'Agrupar por género' }).click()
  await expect(
    page.getByRole('heading', { name: /^Cattleya ?, 1 orquídea$/, level: 2 }),
  ).toBeVisible()
})

test('la vista sobrevive a ir a «¿Ya la tengo?» y volver con atrás', async ({
  page,
}) => {
  await page.goto('/coleccion')
  await expect(tarjetas(page)).toHaveCount(5)

  await buscador(page).fill('a')
  await generos(page).getByRole('button', { name: 'Phalaenopsis' }).click()
  await page
    .getByRole('group', { name: 'Vista' })
    .getByRole('button', { name: 'Lista' })
    .click()
  await page.getByRole('button', { name: 'Filtros' }).click()
  await page
    .getByRole('group', { name: 'Color de la flor' })
    .getByRole('button', { name: 'Blanco' })
    .click()
  await expect(tarjetas(page)).toHaveCount(1)
  const antes = page.url()

  await page.getByRole('link', { name: '¿Ya la tengo?' }).click()
  await expect(page).toHaveURL(/\/ya-la-tengo$/)

  await page.goBack()
  expect(page.url()).toBe(antes)
  await expect(buscador(page)).toHaveValue('a')
  await expect(
    generos(page).getByRole('button', { name: 'Phalaenopsis' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('group', { name: 'Vista' }).getByRole('button', {
      name: 'Lista',
    }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: /^Filtros ?, 1 activo$/ }),
  ).toBeVisible()
  await expect(tarjetas(page)).toHaveCount(1)
})

for (const ancho of [360, 1440]) {
  test(`a ${ancho} px: sin desplazamiento horizontal, objetivos de 44 px y axe`, async ({
    page,
    revisarAccesibilidad,
  }) => {
    await page.setViewportSize({ width: ancho, height: 900 })
    await page.goto('/coleccion')
    await expect(tarjetas(page)).toHaveCount(5)
    await sinDesplazamientoHorizontal(page)

    const main = page.getByRole('main')
    await objetivosDe44(main.locator('.orki-pagehead__actions > *'))
    await objetivosDe44(page.getByRole('search').getByRole('button'))
    await objetivosDe44(generos(page).getByRole('button'))
    await objetivosDe44(page.getByRole('button', { name: 'Exportar a CSV' }))

    // Acciones de la cabecera: a la derecha del título en escritorio; en el
    // celular, apiladas a todo el ancho, «¿Ya la tengo?» debajo.
    const registrar = await page
      .getByRole('link', { name: 'Registrar orquídea' })
      .boundingBox()
    const consulta = await page
      .getByRole('link', { name: '¿Ya la tengo?' })
      .boundingBox()
    const titulo = await page
      .getByRole('heading', { name: 'Mi colección', level: 1 })
      .boundingBox()
    expect(registrar && consulta && titulo).toBeTruthy()
    if (registrar && consulta && titulo) {
      if (ancho === 360) {
        expect(consulta.y).toBeGreaterThan(registrar.y)
        expect(Math.round(consulta.width)).toBe(Math.round(registrar.width))
        expect(registrar.y).toBeGreaterThan(titulo.y)
      } else {
        expect(registrar.x).toBeGreaterThan(titulo.x + titulo.width)
        expect(Math.round(consulta.y)).toBe(Math.round(registrar.y))
      }
    }

    // Tarjetas por fila: dos en el celular, tres en escritorio.
    const filas = await tarjetas(page).evaluateAll((cards) =>
      cards.map((card) => Math.round(card.getBoundingClientRect().top)),
    )
    const primeraFila = filas.filter((top) => top === filas[0]).length
    expect(primeraFila).toBe(ancho === 360 ? 2 : 3)

    await revisarAccesibilidad(`colección a ${ancho} px`)
    await page
      .getByRole('group', { name: 'Vista' })
      .getByRole('button', { name: 'Lista' })
      .click()
    await sinDesplazamientoHorizontal(page)
    await revisarAccesibilidad(`colección en lista a ${ancho} px`)
  })
}

// La consulta «¿Ya la tengo?» sale de esta pantalla (#208) y tendrá la suya
// (#209). Estas pruebas se rehacen allí contra la pantalla nueva.
test.describe('¿Ya la tengo?', () => {
  const respuesta = (page: Page, texto: string) =>
    page.getByRole('status').filter({ hasText: texto })

  // pasa a #209
  test.fixme('sí, por un nombre común del catálogo', async ({
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

  // pasa a #209
  test.fixme('no, pero la tuvo', async ({ page }) => {
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

  // pasa a #209
  test.fixme('no, y se puede registrar con ese nombre', async ({
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
