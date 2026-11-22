import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESPECIES, GENEROS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Registro de una planta (#11, #12, #85, #87): con una especie del catálogo y
// sin foto, y con un nombre que no está en el catálogo ("por validar") y con
// foto. La foto la procesa el navegador de verdad (decodificar, reducir y
// codificar) y se sube al Storage simulado.

const FOTO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/photos/fixtures/sin-metadatos.jpg',
)

test('registrar una especie del catálogo sin foto', async ({
  page,
  supabase,
  revisarAccesibilidad,
}) => {
  await page.goto('/coleccion')
  await page.getByRole('link', { name: 'Registrar orquídea' }).click()
  await expect(
    page.getByRole('heading', { name: 'Registrar una orquídea', level: 1 }),
  ).toBeVisible()
  await revisarAccesibilidad('registro vacío')

  const nombre = page.getByRole('combobox', { name: 'Nombre' })
  await nombre.fill('Phal. amab')
  await page.getByRole('option', { name: 'Phalaenopsis amabilis' }).click()

  // La especie fija el género y el tipo, y la app avisa del duplicado.
  const genero = page.getByRole('group', { name: 'Género' })
  await expect(
    genero.getByRole('button', { name: 'Phalaenopsis' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    genero.getByRole('button', { name: 'Phalaenopsis' }),
  ).toBeDisabled()
  await expect(page.getByText(/Ya tienes 1 ejemplar de/)).toBeVisible()
  await revisarAccesibilidad('registro con especie elegida')

  await page
    .getByRole('combobox', { name: 'Origen' })
    .fill('Orquideario Moyobamba')
  await page.getByRole('button', { name: 'Registrar orquídea' }).click()

  await expect(page).toHaveURL(/\/coleccion$/)
  await expect(
    page.getByRole('status').filter({ hasText: 'Registraste' }),
  ).toContainText('Registraste Phalaenopsis amabilis en tu colección.')
  await expect(page.locator('.orki-pagehead__meta')).toContainText(
    '6 ejemplares',
  )

  const guardadas = supabase
    .plantasDe(USUARIO)
    .filter((p) => p.species_id === ESPECIES.phalaenopsisAmabilis)
  expect(guardadas).toHaveLength(2)
  const nueva = guardadas.find((p) => p.origin === 'Orquideario Moyobamba')
  expect(nueva).toMatchObject({
    validation: 'validated',
    genus_id: GENEROS.phalaenopsis,
    photo_path: null,
  })
})

test('registrar un nombre por validar con foto', async ({
  page,
  supabase,
  revisarAccesibilidad,
}) => {
  await page.goto('/coleccion/nueva')

  await page
    .getByRole('combobox', { name: 'Nombre' })
    .fill('Vanda Pachara Delight')
  await page
    .getByRole('option', {
      name: 'No la encuentro: guardarla como «Vanda Pachara Delight»',
    })
    .click()
  await expect(
    page.getByText(/quedará en tu inventario como «Nombre por validar»/),
  ).toBeVisible()
  // Junto a la foto, un solo mensaje: la recomendación, quién podrá verla y
  // el enlace a Privacidad (#210), como descripción del grupo.
  const grupoFoto = page.getByRole('group', { name: 'Foto' })
  await expect(grupoFoto).toHaveAccessibleDescription(
    'Te recomendamos añadir una foto: el equipo del catálogo podrá verla para validar el nombre. Más en Privacidad.',
  )

  // El enlace no pierde lo escrito: al volver, el borrador se recupera.
  await grupoFoto.getByRole('link', { name: 'Privacidad' }).click()
  await expect(page).toHaveURL(/\/privacidad$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Privacidad' }),
  ).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/coleccion\/nueva$/)
  await expect(
    page.getByText('Recuperamos lo que estabas escribiendo.'),
  ).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Nombre' })).toHaveValue(
    'Vanda Pachara Delight',
  )

  await page
    .getByRole('group', { name: 'Género' })
    .getByRole('button', { name: 'Vanda' })
    .click()
  await page
    .getByRole('group', { name: 'Tipo' })
    .getByRole('button', { name: 'Híbrido' })
    .click()

  // En el celular hay dos botones (cámara y galería); en el escritorio, uno.
  const selector = page.waitForEvent('filechooser')
  await page
    .getByRole('button', { name: /^Elegir (foto|de la galería)$/ })
    .click()
  await (await selector).setFiles(FOTO)
  await expect(
    page.getByRole('img', { name: 'Vista previa de la foto elegida' }),
  ).toBeVisible()
  // Con la foto elegida, el aviso dice que el equipo del catálogo podrá verla.
  await expect(grupoFoto).toHaveAccessibleDescription(
    'Como el nombre queda por validar, el equipo del catálogo podrá ver esta foto para identificarla. Más en Privacidad.',
  )
  await revisarAccesibilidad('registro por validar con foto')

  await page.getByRole('button', { name: 'Registrar orquídea' }).click()

  await expect(page).toHaveURL(/\/coleccion$/)
  const aviso = page.getByRole('status').filter({ hasText: 'Registraste' })
  await expect(aviso).toContainText(
    'Registraste Vanda Pachara Delight en tu colección.',
  )
  await expect(aviso).toContainText('Nombre por validar')

  const nueva = supabase
    .plantasDe(USUARIO)
    .find((p) => p.entered_name === 'Vanda Pachara Delight')
  expect(nueva).toMatchObject({
    species_id: null,
    validation: 'pending',
    genus_id: GENEROS.vanda,
    type: 'hybrid',
  })
  // La foto y su miniatura, en la carpeta de la planta.
  await expect.poll(() => nueva?.photo_path ?? null).not.toBeNull()
  expect(nueva?.photo_path).toMatch(new RegExp(`^${USUARIO}/${nueva?.id}/`))
  expect(supabase.archivos.has(nueva?.photo_path ?? '')).toBe(true)
  expect(supabase.archivos.has(nueva?.thumbnail_path ?? '')).toBe(true)

  // La tarjeta de la planta muestra la miniatura descargada del bucket.
  const tarjeta = page.getByRole('article', { name: 'Vanda Pachara Delight' })
  await expect(tarjeta.getByText('Nombre por validar')).toBeVisible()
  await expect(tarjeta.getByRole('img')).not.toHaveAccessibleName('Sin foto')
  await revisarAccesibilidad('inventario tras registrar')
})
