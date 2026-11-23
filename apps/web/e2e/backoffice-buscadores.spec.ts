import type { Page } from '@playwright/test'
import { ADMIN, ESPECIES } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Buscadores del backoffice del catálogo (#256): escribir deprisa no pierde
// letras (el campo tiene estado propio; la dirección se actualiza a partir de
// él), y la dirección sigue mandando al abrir un enlace con ?q= o ?gq= y al
// volver con «atrás».

test.use({ sesion: { usuario: ADMIN, rol: 'catalog_admin' } })

const buscadorDeEspecies = (page: Page) =>
  page.getByRole('searchbox', { name: 'Buscar especies' })
const buscadorDeGeneros = (page: Page) =>
  page.getByRole('searchbox', { name: 'Buscar géneros' })
const listado = (page: Page) =>
  page.getByRole('table', {
    name: 'Especies del catálogo, en orden alfabético',
  })
const resultados = (page: Page, texto: string) =>
  page.getByRole('table', {
    name: `Especies que coinciden con «${texto}», por relevancia`,
  })

async function abrir(page: Page, busqueda = '') {
  await page.goto(`/administracion/catalogo${busqueda}`)
  await expect(
    page.getByRole('heading', {
      name: 'Administración del catálogo',
      level: 1,
    }),
  ).toBeVisible()
}

test('especies: al escribir deprisa tecla a tecla no se pierden letras', async ({
  page,
}) => {
  await abrir(page)
  await expect(listado(page).getByRole('rowheader')).toHaveCount(6)
  await buscadorDeEspecies(page).pressSequentially('phalaenopsis amabilis')
  await expect(buscadorDeEspecies(page)).toHaveValue('phalaenopsis amabilis')
  await expect(page).toHaveURL(/\?q=phalaenopsis\+amabilis$/)
  await expect(
    resultados(page, 'phalaenopsis amabilis').getByRole('rowheader'),
  ).toHaveCount(1)
})

test('especies: tampoco con el procesador lento (Chromium)', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Limitar la CPU solo se puede con el protocolo de Chromium.',
  )
  await abrir(page)
  await expect(listado(page).getByRole('rowheader')).toHaveCount(6)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await buscadorDeEspecies(page).pressSequentially('phal amab')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await expect(buscadorDeEspecies(page)).toHaveValue('phal amab')
  await expect(page).toHaveURL(/\?q=phal\+amab$/)
})

test('géneros: al escribir deprisa tecla a tecla no se pierden letras', async ({
  page,
}) => {
  await abrir(page, '?pestana=generos')
  const generos = page.getByRole('table', {
    name: 'Géneros del catálogo, en orden alfabético',
  })
  await expect(generos.getByRole('rowheader')).toHaveCount(6)
  await buscadorDeGeneros(page).pressSequentially('phalaenopsis')
  await expect(buscadorDeGeneros(page)).toHaveValue('phalaenopsis')
  await expect(page).toHaveURL(/gq=phalaenopsis$/)
  await expect(generos.getByRole('rowheader')).toHaveText(['Phalaenopsis'])
})

test(
  'la dirección manda al abrir, al volver con «atrás» y al limpiar',
  { tag: '@logica' },
  async ({ page }) => {
    // Abrir con ?q= rellena el campo y busca.
    await abrir(page, '?q=cattleya')
    await expect(buscadorDeEspecies(page)).toHaveValue('cattleya')
    await expect(
      resultados(page, 'cattleya').getByRole('rowheader'),
    ).toHaveCount(2)

    // Abrir un detalle añade una entrada; en ella se cambia la búsqueda.
    await resultados(page, 'cattleya')
      .getByRole('link', { name: 'Cattleya trianae' })
      .click()
    await expect(page).toHaveURL(
      new RegExp(`especie=${ESPECIES.cattleyaTrianae}`),
    )
    await buscadorDeEspecies(page).fill('vanda')
    await expect(page).toHaveURL(/q=vanda/)
    await expect(resultados(page, 'vanda').getByRole('rowheader')).toHaveCount(
      1,
    )

    // «Atrás» vuelve a la entrada anterior, con su búsqueda.
    await page.goBack()
    await expect(page).not.toHaveURL(/especie=/)
    await expect(buscadorDeEspecies(page)).toHaveValue('cattleya')
    await expect(
      resultados(page, 'cattleya').getByRole('rowheader'),
    ).toHaveCount(2)

    // «Limpiar» vacía el campo y la dirección.
    await page
      .getByRole('button', { name: 'Limpiar búsqueda y filtros' })
      .first()
      .click()
    await expect(buscadorDeEspecies(page)).toHaveValue('')
    await expect(page).toHaveURL(/\/administracion\/catalogo$/)
    await expect(listado(page).getByRole('rowheader')).toHaveCount(6)
  },
)
