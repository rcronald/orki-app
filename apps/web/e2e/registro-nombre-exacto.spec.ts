import type { Page } from '@playwright/test'
import { ESPECIES, GENEROS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// El nombre exacto de una especie del catálogo la enlaza al registrar (#280):
// desde «¿Ya la tengo?» («Registrarla con este nombre», ?nombre=), al
// escribirlo y pulsar Enter sin elegir la sugerencia. Un sinónimo se ofrece
// (no se enlaza sin que se vea), varias especies con el mismo nombre se
// muestran para elegir y un nombre que solo se parece no se enlaza. Además, el
// foco en «Nombre» al abrir el registro y el género deducido de la primera
// palabra de un nombre libre. A 360 px.

const nombre = (page: Page) => page.getByRole('combobox', { name: 'Nombre' })
const genero = (page: Page, nombreDelGenero: string) =>
  page
    .getByRole('group', { name: 'Género' })
    .getByRole('button', { name: nombreDelGenero })
const registrar = (page: Page) =>
  page.getByRole('button', { name: 'Registrar orquídea' })
const coincidencia = (page: Page) =>
  page.getByText('Coincidencia en el catálogo')
const porValidar = (page: Page) => page.getByText(/No está en el catálogo:/)

/** Sin desplazamiento horizontal (WCAG 1.4.10). */
async function sinDesplazamientoHorizontal(page: Page) {
  const sobra = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(sobra).toBeLessThanOrEqual(0)
}

test.use({ viewport: { width: 360, height: 900 } })

test(
  '«¿Ya la tengo?» con «Vanda coerulea» → «Registrarla con este nombre» la guarda validada, con su especie',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    await page.goto('/ya-la-tengo')
    await page
      .getByRole('searchbox', { name: 'Nombre de la orquídea' })
      .pressSequentially('Vanda coerulea')
    await expect(
      page.getByRole('status').filter({ hasText: 'Aún no la tienes' }),
    ).toBeVisible()
    await page
      .getByRole('link', { name: 'Registrarla con este nombre' })
      .click()
    await expect(page).toHaveURL(/\/coleccion\/nueva\?nombre=Vanda\+coerulea$/)

    await expect(coincidencia(page)).toBeVisible()
    await expect(nombre(page)).toHaveValue('Vanda coerulea')
    await expect(porValidar(page)).toHaveCount(0)
    await expect(genero(page, 'Vanda')).toHaveAttribute('aria-pressed', 'true')
    await expect(genero(page, 'Vanda')).toHaveAttribute('aria-disabled', 'true')
    await sinDesplazamientoHorizontal(page)
    await revisarAccesibilidad('registro desde «¿Ya la tengo?», enlazada')

    await registrar(page).click()
    await expect(page).toHaveURL(/\/coleccion$/)
    const nueva = supabase
      .plantasDe(USUARIO)
      .find((p) => p.entered_name === 'Vanda coerulea')
    expect(nueva).toMatchObject({
      species_id: ESPECIES.vandaCoerulea,
      genus_id: GENEROS.vanda,
      type: 'species',
      validation: 'validated',
    })
  },
)

test('escribir el nombre exacto y pulsar Enter, sin elegir la sugerencia, la guarda validada', async ({
  page,
  supabase,
}) => {
  await page.goto('/coleccion/nueva')
  await nombre(page).fill('cattleya maxima')
  await nombre(page).press('Enter')

  await expect(page).toHaveURL(/\/coleccion$/)
  const nuevas = supabase
    .plantasDe(USUARIO)
    .filter((p) => p.species_id === ESPECIES.cattleyaMaxima)
  // La de partida y la nueva.
  expect(nuevas).toHaveLength(2)
  expect(nuevas.every((p) => p.validation === 'validated')).toBe(true)
  expect(nuevas.map((p) => p.entered_name)).toEqual([
    'Cattleya maxima',
    'Cattleya maxima',
  ])
})

test(
  'un sinónimo exacto no se enlaza solo: se ofrece la especie aceptada',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    supabase.datos.nombres.push({
      id: '00000004-0000-4000-8000-000000000099',
      species_id: ESPECIES.cattleyaTrianae,
      name: 'Cattleya trianaei',
      type: 'synonym',
      language: null,
    })
    await page.goto('/coleccion/nueva?nombre=Cattleya+trianaei')

    await expect(page.getByText(/es un sinónimo de/)).toContainText(
      'Cattleya trianaei es un sinónimo de Cattleya trianae en el catálogo.',
    )
    await expect(nombre(page)).toHaveValue('Cattleya trianaei')
    await expect(coincidencia(page)).toHaveCount(0)
    await expect(porValidar(page)).toHaveCount(0)
    await sinDesplazamientoHorizontal(page)
    await revisarAccesibilidad('registro con un sinónimo exacto')

    await page.getByRole('button', { name: 'Elegir Cattleya trianae' }).click()
    await expect(nombre(page)).toHaveValue('Cattleya trianae')
    await expect(coincidencia(page)).toBeVisible()
    await registrar(page).click()
    await expect(page).toHaveURL(/\/coleccion$/)
    expect(
      supabase
        .plantasDe(USUARIO)
        .find((p) => p.species_id === ESPECIES.cattleyaTrianae),
    ).toMatchObject({ validation: 'validated' })
  },
)

test(
  'con dos especies con el mismo nombre no enlaza ninguna: las muestra',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    const original = supabase.datos.especies.find(
      (e) => e.id === ESPECIES.cattleyaMaxima,
    )
    if (!original) throw new Error('Falta Cattleya maxima en los datos.')
    supabase.datos.especies.push({
      ...original,
      id: '00000001-0000-4000-8000-000000000099',
      type: 'hybrid',
    })
    await page.goto('/coleccion/nueva')
    await nombre(page).fill('Cattleya maxima')

    await expect(
      page.getByText(/Hay 2 especies del catálogo con este nombre/),
    ).toBeVisible()
    await expect(coincidencia(page)).toHaveCount(0)
    await expect(porValidar(page)).toHaveCount(0)
    await expect(genero(page, 'Cattleya')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
)

test(
  'un nombre que solo se parece no se enlaza: queda por validar',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    await page.goto('/coleccion/nueva')
    await nombre(page).fill('Vanda coerul')
    await expect(
      page.getByRole('option', { name: 'Vanda coerulea' }),
    ).toBeVisible()
    await expect(porValidar(page)).toBeVisible()
    await expect(coincidencia(page)).toHaveCount(0)

    await page
      .getByRole('group', { name: 'Tipo' })
      .getByRole('button', { name: 'Especie' })
      .click()
    await registrar(page).click()
    await expect(page).toHaveURL(/\/coleccion$/)
    expect(
      supabase
        .plantasDe(USUARIO)
        .find((p) => p.entered_name === 'Vanda coerul'),
    ).toMatchObject({
      species_id: null,
      genus_id: GENEROS.vanda,
      validation: 'pending',
    })
  },
)

test('al abrir el registro desde la app, el foco está en «Nombre»', async ({
  page,
}) => {
  await page.goto('/coleccion')
  await page.getByRole('link', { name: 'Registrar orquídea' }).click()
  await expect(
    page.getByRole('heading', { name: 'Registrar una orquídea', level: 1 }),
  ).toBeVisible()
  await expect(nombre(page)).toBeFocused()
})

test(
  'un nombre libre marca el género de su primera palabra, y se puede cambiar',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    await page.goto('/coleccion/nueva')
    await nombre(page).fill('Phal. Mini Mark')
    await expect(genero(page, 'Phalaenopsis')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(genero(page, 'Phalaenopsis')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await genero(page, 'Dendrobium').click()
    await expect(genero(page, 'Dendrobium')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page
      .getByRole('group', { name: 'Tipo' })
      .getByRole('button', { name: 'Híbrido' })
      .click()
    await registrar(page).click()
    await expect(page).toHaveURL(/\/coleccion$/)
    expect(
      supabase
        .plantasDe(USUARIO)
        .find((p) => p.entered_name === 'Phal. Mini Mark'),
    ).toMatchObject({ genus_id: GENEROS.dendrobium, validation: 'pending' })
  },
)
