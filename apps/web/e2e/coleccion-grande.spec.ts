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
  await expect(page.getByText('1 de 5 orquídeas coincide.')).toBeVisible()
  await revisarAccesibilidad('inventario, búsqueda por identificador')

  // Un número suelto no busca en los identificadores.
  await buscador(page).fill('001')
  await expect(
    page.getByText('Ninguna de tus 5 orquídeas coincide.'),
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
