import type { Locator, Page } from '@playwright/test'
import { ADMIN, ESPECIES, PLANTAS } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'
import { ORIGEN_SUPABASE } from './soporte/supabase-simulado.ts'

// Fotos de referencia de las especies (#234): en la ficha y las listas del
// catálogo público, al elegir la especie en el registro, en el detalle de
// una planta sin foto propia y, para el administrador, retirarlas. Las
// imágenes salen del bucket público species-photos del Supabase simulado
// (dos ilustraciones WebP locales), sin token.

const BUCKET = `${ORIGEN_SUPABASE}/storage/v1/object/public/species-photos/`

async function sinDesplazamientoHorizontal(page: Page) {
  const anchos = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: document.documentElement.clientWidth,
  }))
  expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana)
}

/** Que la imagen llegó de verdad (no es un hueco roto). */
async function cargada(imagen: Locator) {
  await expect(imagen).toBeVisible()
  // Es perezosa (loading="lazy"): WebKit no la pide hasta que se acerca a la vista.
  await imagen.scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      imagen.evaluate((img) =>
        (img as HTMLImageElement).complete
          ? (img as HTMLImageElement).naturalWidth
          : 0,
      ),
    )
    .toBeGreaterThan(0)
}

/** Las peticiones de imágenes del bucket, con si llevaban token. */
function vigilarImagenes(page: Page) {
  const pedidas: { url: string; conToken: boolean }[] = []
  page.on('request', (request) => {
    if (request.url().startsWith(BUCKET)) {
      pedidas.push({
        url: request.url(),
        conToken: 'authorization' in request.headers(),
      })
    }
  })
  return pedidas
}

test.describe('catálogo público, sin sesión', () => {
  test.use({ sesion: { usuario: null } })

  for (const [nombre, ancho, alto] of [
    ['a 360 px', 360, 780],
    ['en escritorio', 1440, 900],
  ] as const) {
    test(`ficha con foto, ficha sin foto y búsqueda con miniaturas ${nombre}`, async ({
      page,
      revisarAccesibilidad,
    }) => {
      await page.setViewportSize({ width: ancho, height: alto })
      const pedidas = vigilarImagenes(page)

      await page.goto(`/catalogo/especie/${ESPECIES.cattleyaMaxima}`)
      const foto = page.getByRole('img', {
        name: 'Foto de referencia de Cattleya maxima',
      })
      await cargada(foto)
      await expect(foto).toHaveAttribute('width', '480')
      await expect(foto).toHaveAttribute('height', '360')
      const figura = page.getByRole('figure')
      await expect(figura).toContainText('Foto de referencia')
      await expect(figura).toContainText('Foto: Luis Quispe')
      await expect(figura).toContainText('reducida')
      await expect(
        figura.getByRole('link', { name: /CC BY-SA 4.0/ }),
      ).toHaveAttribute(
        'href',
        'https://creativecommons.org/licenses/by-sa/4.0/legalcode.es',
      )
      await expect(
        figura.getByRole('link', { name: /Ver el original en iNaturalist/ }),
      ).toHaveAttribute('href', 'https://www.inaturalist.org/photos/1002')
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`ficha con foto ${nombre}`)

      // Sin foto: la ficha empieza por lo demás, sin hueco.
      await page.goto(`/catalogo/especie/${ESPECIES.dendrobiumNobile}`)
      await expect(
        page.getByRole('heading', { name: 'Dendrobium nobile', level: 1 }),
      ).toBeVisible()
      await expect(page.getByRole('region', { name: 'Fuente' })).toBeVisible()
      await expect(page.getByRole('figure')).toHaveCount(0)

      // Búsqueda: la miniatura en las filas que la tienen; las demás, con
      // el hueco del mismo tamaño.
      await page.goto('/catalogo?q=cattleya')
      const maxima = page.getByRole('link', { name: /Cattleya maxima/ })
      await cargada(maxima.locator('img'))
      await expect(maxima).toContainText(
        'Foto de referencia: Luis Quispe, CC BY-SA 4.0',
      )
      const trianae = page.getByRole('link', { name: /Cattleya trianae/ })
      await expect(trianae.locator('img')).toHaveCount(0)
      const izquierda = async (fila: Locator) =>
        Math.round(
          (await fila.locator('.orki-action__title').boundingBox())?.x ?? -1,
        )
      expect(await izquierda(maxima)).toBe(await izquierda(trianae))
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`búsqueda con miniaturas ${nombre}`)

      // Las imágenes salen del bucket público, sin token.
      expect(pedidas.length).toBeGreaterThan(0)
      expect(pedidas.filter((pedida) => pedida.conToken)).toEqual([])
    })
  }

  test('si la imagen no carga, la foto se retira sin dejar hueco', async ({
    page,
  }) => {
    await page.route(`${BUCKET}**`, (route) =>
      route.fulfill({ status: 404, body: 'no' }),
    )
    await page.goto(`/catalogo/especie/${ESPECIES.phalaenopsisAmabilis}`)
    await expect(page.getByRole('region', { name: 'Sinónimos' })).toBeVisible()
    await expect(page.getByRole('figure')).toHaveCount(0)
    await expect(page.getByText('Foto: Ana Pérez')).toHaveCount(0)
  })
})

test('registro: «Así es esta especie» al elegirla, con una sola consulta', async ({
  page,
  revisarAccesibilidad,
}) => {
  const consultas: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith(`${ORIGEN_SUPABASE}/rest/v1/species_photos`)) {
      consultas.push(request.url())
    }
  })
  await page.goto('/coleccion/nueva')
  await page.getByRole('combobox', { name: 'Nombre' }).fill('Phal. amab')
  await page.getByRole('option', { name: 'Phalaenopsis amabilis' }).click()

  const vista = page.getByRole('figure').filter({
    hasText: 'Así es esta especie',
  })
  await cargada(
    vista.getByRole('img', {
      name: 'Foto de referencia de Phalaenopsis amabilis',
    }),
  )
  await expect(vista).toContainText('Foto: Ana Pérez')
  await expect(vista.getByRole('link', { name: /CC BY 4.0/ })).toBeVisible()
  expect(consultas).toHaveLength(1)
  expect(new URL(consultas[0] ?? '').searchParams.get('species_id')).toBe(
    `eq.${ESPECIES.phalaenopsisAmabilis}`,
  )
  await revisarAccesibilidad('registro con la vista de la especie')

  // Una especie sin foto no enseña nada.
  await page.getByRole('combobox', { name: 'Nombre' }).fill('Dendrobium nob')
  await page.getByRole('option', { name: 'Dendrobium nobile' }).click()
  await expect.poll(() => consultas.length).toBe(2)
  await expect(page.getByText('Así es esta especie')).toHaveCount(0)
})

test('detalle de una planta sin foto propia: la de su especie, sin contar como suya', async ({
  page,
  revisarAccesibilidad,
}) => {
  await page.goto(`/coleccion/${PLANTAS.amabilis}`)
  const galeria = page.getByRole('region', { name: 'Fotos' })
  await cargada(
    galeria.getByRole('img', {
      name: 'Foto de referencia de Phalaenopsis amabilis',
    }),
  )
  await expect(galeria).toContainText('Foto de referencia')
  await expect(galeria).toContainText(
    'Aún no tienes fotos de esta planta. Esta es una foto de referencia de su especie, no de tu ejemplar.',
  )
  await expect(galeria).not.toContainText('de 6')
  await expect(galeria.getByText('Principal')).toHaveCount(0)
  await expect(
    galeria.getByRole('link', { name: 'Añadir fotos' }),
  ).toBeVisible()
  await sinDesplazamientoHorizontal(page)
  await revisarAccesibilidad('detalle sin foto propia')

  // La tarjeta del inventario no cambia: sin foto, el marcador de siempre.
  await page.goto('/coleccion')
  await expect(
    page.getByRole('img', { name: /Foto de referencia/ }),
  ).toHaveCount(0)
})

test.describe('backoffice', () => {
  test.use({ sesion: { usuario: ADMIN, rol: 'catalog_admin' } })

  test('ver la foto de referencia y retirarla con motivo', async ({
    page,
    supabase,
    revisarAccesibilidad,
  }) => {
    await page.goto(
      `/administracion/catalogo?especie=${ESPECIES.phalaenopsisAmabilis}`,
    )
    const panel = page.getByRole('region', {
      name: 'Detalle de Phalaenopsis amabilis',
    })
    await cargada(
      panel.getByRole('img', {
        name: 'Foto de referencia de Phalaenopsis amabilis',
      }),
    )
    await expect(panel).toContainText('Foto: Ana Pérez')
    await panel.getByRole('button', { name: 'Retirar foto' }).click()
    const dialogo = page.getByRole('alertdialog', {
      name: 'Retirar la foto de «Phalaenopsis amabilis»',
    })
    await dialogo.getByRole('button', { name: 'Retirar foto' }).click()
    await expect(dialogo.getByRole('alert')).toContainText(
      'Elige por qué se retira la foto',
    )
    await revisarAccesibilidad('backoffice: retirar la foto')
    await dialogo.getByRole('radio', { name: 'Mal identificada' }).check()
    await dialogo.getByRole('button', { name: 'Retirar foto' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: 'Se retiró la foto' }),
    ).toContainText(
      'Se retiró la foto de referencia de «Phalaenopsis amabilis» (mal identificada).',
    )
    await expect(panel.getByText('No tiene foto de referencia.')).toBeVisible()
    expect(supabase.fotosRetiradas).toEqual([
      {
        species_id: ESPECIES.phalaenopsisAmabilis,
        source_photo_id: '1001',
        reason: 'misidentified',
      },
    ])
  })

  test('si la foto cambió entretanto, avisa y relee', async ({
    page,
    supabase,
  }) => {
    await page.goto(
      `/administracion/catalogo?especie=${ESPECIES.cattleyaMaxima}`,
    )
    const panel = page.getByRole('region', {
      name: 'Detalle de Cattleya maxima',
    })
    await expect(
      panel.getByRole('button', { name: 'Retirar foto' }),
    ).toBeVisible()
    // Otra persona la retira antes.
    supabase.datos.fotosDeReferencia = supabase.datos.fotosDeReferencia.filter(
      (foto) => foto.species_id !== ESPECIES.cattleyaMaxima,
    )
    await panel.getByRole('button', { name: 'Retirar foto' }).click()
    const dialogo = page.getByRole('alertdialog')
    await dialogo.getByRole('radio', { name: 'Otro motivo' }).check()
    await dialogo.getByRole('button', { name: 'Retirar foto' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(
      page.getByText(/La foto de referencia de esta especie cambió/),
    ).toBeVisible()
    await expect(panel.getByText('No tiene foto de referencia.')).toBeVisible()
    expect(supabase.fotosRetiradas).toEqual([])
  })
})
