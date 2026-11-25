import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { ESPECIES, GENEROS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Registro de una planta con galería (#11, #12, #85, #221): con una especie
// del catálogo y con un nombre que no está en el catálogo ("por validar"),
// con 0, 1 y 6 fotos; la recarga con el borrador (también de las fotos); un
// fallo de subida y su reintento. Las fotos las prepara el navegador de verdad
// (decodificar, reducir y codificar) y se suben al Storage simulado, que
// también atiende plant_photos (supabase.fotosDe).

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/photos/fixtures',
)
const FOTOS = [
  'sin-metadatos.jpg',
  'sin-metadatos.png',
  'sin-metadatos.webp',
  'exif-gps-orientacion-6.jpg',
  'exif-xmp.webp',
  'sin-metadatos.jpg',
].map((nombre) => path.join(FIXTURES, nombre))

const galeria = (page: Page) =>
  page.getByRole('region', { name: 'Fotos (opcional)' })

/** Elige fotos con «Añadir fotos» y espera a que estén preparadas. */
async function elegirFotos(page: Page, archivos: string[]) {
  const selector = page.waitForEvent('filechooser')
  await galeria(page).getByRole('button', { name: 'Añadir fotos' }).click()
  const eleccion = await selector
  expect(eleccion.isMultiple()).toBe(true)
  await eleccion.setFiles(archivos)
  await expect(page.locator('.orki-gallery__item--preparing')).toHaveCount(0)
}

async function elegirTipo(page: Page, tipo: string) {
  await page
    .getByRole('group', { name: 'Tipo' })
    .getByRole('button', { name: tipo })
    .click()
}

/** La miniatura de la tarjeta ya cargó del bucket (no es el marcador). */
async function tarjetaConFoto(tarjeta: Locator) {
  await expect(tarjeta.getByRole('img')).not.toHaveAccessibleName('Sin foto')
  await expect(tarjeta.getByRole('img')).toHaveAttribute('src', /^blob:/)
}

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
  await expect(
    page.getByRole('link', { name: 'Volver a Mi colección' }),
  ).toBeVisible()
  await expect(galeria(page).locator('.orki-gallery__count')).toContainText(
    '0 de 6',
  )
  await revisarAccesibilidad('registro vacío')

  const nombre = page.getByRole('combobox', { name: 'Nombre' })
  await nombre.fill('Phal. amab')
  await page.getByRole('option', { name: 'Phalaenopsis amabilis' }).click()

  // La especie fija el género y el tipo, dice que coincide con el catálogo y
  // avisa del duplicado.
  await expect(page.getByText('Coincidencia en el catálogo')).toBeVisible()
  const genero = page.getByRole('group', { name: 'Género' })
  await expect(
    genero.getByRole('button', { name: 'Phalaenopsis' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    genero.getByRole('button', { name: 'Phalaenopsis' }),
  ).toBeDisabled()
  await expect(page.getByText(/Ya tienes 1 ejemplar de/)).toBeVisible()
  // axe con la especie elegida: fotos-de-referencia.spec.ts, en la misma
  // pantalla.

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
  expect(supabase.fotosDe(nueva?.id ?? '')).toEqual([])
})

test('registrar una especie del catálogo con una foto: la tarjeta la usa', async ({
  page,
  supabase,
}) => {
  await page.goto('/coleccion/nueva')
  await page.getByRole('combobox', { name: 'Nombre' }).fill('Cattleya max')
  await page.getByRole('option', { name: /^Cattleya maxima/ }).click()
  await expect(page.getByText('Coincidencia en el catálogo')).toBeVisible()
  await elegirFotos(page, FOTOS.slice(0, 1))
  await expect(
    galeria(page).getByRole('img', { name: 'Foto principal' }),
  ).toBeVisible()
  await expect(galeria(page).locator('.orki-gallery__count')).toContainText(
    '1 de 6',
  )
  await page.getByRole('button', { name: 'Registrar orquídea' }).click()

  await expect(page).toHaveURL(/\/coleccion$/)
  const nueva = supabase
    .plantasDe(USUARIO)
    .find(
      (p) => p.species_id === ESPECIES.cattleyaMaxima && p.photo_path !== null,
    )
  expect(nueva).toBeDefined()
  const fotos = supabase.fotosDe(nueva?.id ?? '')
  expect(fotos).toHaveLength(1)
  expect(nueva?.photo_path).toBe(fotos[0]?.photo_path)
  expect(supabase.archivos.has(fotos[0]?.photo_path ?? '')).toBe(true)
  expect(supabase.archivos.has(fotos[0]?.thumbnail_path ?? '')).toBe(true)
})

test('registrar un nombre por validar con seis fotos, recargando a mitad', async ({
  page,
  supabase,
  revisarAccesibilidad,
  browserName,
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
    page.getByText(/quedará en tu colección como «Nombre por validar»/),
  ).toBeVisible()
  // Junto a la galería, un solo mensaje: la recomendación, quién podrá ver
  // las fotos y el enlace a Privacidad (#210), como descripción.
  await expect(galeria(page)).toHaveAccessibleDescription(
    'Te recomendamos añadir fotos: el equipo del catálogo podrá verlas para validar el nombre. Más en Privacidad.',
  )

  await page
    .getByRole('group', { name: 'Género' })
    .getByRole('button', { name: 'Vanda' })
    .click()
  await elegirTipo(page, 'Híbrido')
  await elegirFotos(page, FOTOS.slice(0, 2))
  await expect(galeria(page)).toHaveAccessibleDescription(
    'Como el nombre queda por validar, el equipo del catálogo podrá ver estas fotos para identificarla. Más en Privacidad.',
  )

  // La recarga: lo escrito y las fotos, en su orden, vuelven del borrador.
  await page.reload()
  await expect(
    page.getByText('Recuperamos lo que estabas escribiendo.'),
  ).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Nombre' })).toHaveValue(
    'Vanda Pachara Delight',
  )
  if (browserName === 'webkit') {
    // El WebKit de Playwright usa un perfil efímero, como la navegación
    // privada de Safari, que no guarda Blob en IndexedDB: lo escrito vuelve,
    // las fotos no (el formulario sigue igual). En un iPhone real con la app
    // instalada sí se guardan; no se puede comprobar aquí.
    await expect(galeria(page).locator('.orki-gallery__count')).toContainText(
      '0 de 6',
    )
    await elegirFotos(page, FOTOS.slice(0, 2))
  } else {
    await expect(galeria(page).getByRole('img')).toHaveCount(2)
    await expect(galeria(page).locator('.orki-gallery__count')).toContainText(
      '2 de 6',
    )
  }

  // Cuatro más (seis): las acciones se deshabilitan con su motivo.
  await elegirFotos(page, FOTOS.slice(2, 6))
  await expect(galeria(page).locator('.orki-gallery__count')).toContainText(
    '6 de 6',
  )
  const elegir = galeria(page).getByRole('button', { name: 'Añadir fotos' })
  await expect(elegir).toHaveAttribute('aria-disabled', 'true')
  await expect(elegir).toHaveAccessibleDescription(
    'Ya tienes 6 fotos. Quita una para añadir otra.',
  )
  await revisarAccesibilidad('registro por validar con seis fotos')

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
  const fotos = supabase.fotosDe(nueva?.id ?? '')
  expect(fotos.map((foto) => foto.position)).toEqual([0, 1, 2, 3, 4, 5])
  for (const foto of fotos) {
    expect(foto.photo_path).toMatch(new RegExp(`^${USUARIO}/${nueva?.id}/`))
    expect(supabase.archivos.has(foto.photo_path)).toBe(true)
  }
  // La principal (la primera elegida) está en la planta y en su tarjeta.
  expect(nueva?.photo_path).toBe(fotos[0]?.photo_path)
  const tarjeta = page.getByRole('article', { name: 'Vanda Pachara Delight' })
  await expect(tarjeta.getByText('Nombre por validar')).toBeVisible()
  await tarjetaConFoto(tarjeta)
  await revisarAccesibilidad('inventario tras registrar')
})

test('en celular, el aviso de registro no se aplasta con un nombre largo', async ({
  page,
  supabase,
}) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/coleccion/nueva')
  const largo = 'Eplc Golden Sunburst Exotic Orchids AM/AOS'
  await page.getByRole('combobox', { name: 'Nombre' }).fill(largo)
  await page
    .getByRole('option', {
      name: `No la encuentro: guardarla como «${largo}»`,
    })
    .click()
  await page
    .getByRole('group', { name: 'Género' })
    .getByRole('button', { name: 'Vanda' })
    .click()
  await elegirTipo(page, 'Híbrido')
  await page.getByRole('button', { name: 'Registrar orquídea' }).click()

  await expect(page).toHaveURL(/\/coleccion$/)
  const aviso = page.getByRole('status').filter({ hasText: 'Registraste' })
  await expect(aviso).toContainText(`Registraste ${largo} en tu colección.`)
  // El texto ocupa el ancho del aviso y las acciones («Ver la planta», #296, y
  // «Registrar otra») van debajo, no al lado; cada una de 44 px de alto y sin
  // salirse del aviso.
  const texto = await aviso.locator('p').boundingBox()
  const caja = await aviso.locator('> div').boundingBox()
  expect(texto?.width).toBeGreaterThanOrEqual(240)
  for (const nombre of ['Ver la planta', 'Registrar otra']) {
    const accion = await aviso.getByRole('link', { name: nombre }).boundingBox()
    expect(accion?.y).toBeGreaterThanOrEqual(
      (texto?.y ?? 0) + (texto?.height ?? 0),
    )
    expect(Math.round(accion?.height ?? 0)).toBeGreaterThanOrEqual(44)
    expect(Math.round(accion?.width ?? 0)).toBeGreaterThanOrEqual(44)
    expect(
      Math.round((accion?.x ?? 0) + (accion?.width ?? 0)),
    ).toBeLessThanOrEqual(Math.round((caja?.x ?? 0) + (caja?.width ?? 0)))
  }
  // La insignia de estado, en una sola línea.
  const insignia = await aviso.getByText('Nombre por validar').boundingBox()
  expect(insignia?.height).toBeLessThan(40)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  // «Ver la planta» abre el ejemplar recién creado.
  const nueva = supabase
    .plantasDe(USUARIO)
    .find((planta) => planta.entered_name === largo)
  await aviso.getByRole('link', { name: 'Ver la planta' }).click()
  await expect(page).toHaveURL(
    new RegExp(`/coleccion/${nueva?.id ?? 'falta'}$`),
  )
})

test(
  'registrar un nombre por validar sin fotos y con «Otro»',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    await page.goto('/coleccion/nueva')
    await page
      .getByRole('combobox', { name: 'Nombre' })
      .fill('Masdevallia del jardín')
    await page
      .getByRole('group', { name: 'Género' })
      .getByRole('button', { name: 'Otro' })
      .click()
    await page
      .getByRole('combobox', { name: 'Buscar otro género' })
      .fill('Masde')
    await page.getByRole('option', { name: /^Masdevallia/ }).click()
    await elegirTipo(page, 'No sé')
    await page.getByRole('button', { name: 'Registrar orquídea' }).click()

    await expect(page).toHaveURL(/\/coleccion$/)
    const nueva = supabase
      .plantasDe(USUARIO)
      .find((p) => p.entered_name === 'Masdevallia del jardín')
    expect(nueva).toMatchObject({
      species_id: null,
      validation: 'pending',
      genus_id: GENEROS.masdevallia,
      type: 'unknown',
      photo_path: null,
    })
  },
)

test('si una foto falla al subir, la planta queda registrada y se reintenta solo esa', async ({
  page,
  supabase,
  revisarAccesibilidad,
}) => {
  await page.goto('/coleccion/nueva')
  await page.getByRole('combobox', { name: 'Nombre' }).fill('Phal. amab')
  await page.getByRole('option', { name: 'Phalaenopsis amabilis' }).click()
  await elegirFotos(page, FOTOS.slice(0, 3))

  // Los dos archivos de la segunda foto fallan hasta que se diga.
  const versiones: string[] = []
  let fallar = true
  await page.route(/\/storage\/v1\/object\/plant-photos\/.+/, async (ruta) => {
    const peticion = ruta.request()
    const version = /(?:photo|thumb)-([^./]+)\./.exec(peticion.url())?.[1]
    if (peticion.method() === 'POST' && version) {
      if (!versiones.includes(version)) versiones.push(version)
      if (fallar && versiones.indexOf(version) === 1) {
        await ruta.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: '503', message: 'Fallo' }),
        })
        return
      }
    }
    await ruta.fallback()
  })

  await page.getByRole('button', { name: 'Registrar orquídea' }).click()
  const alerta = page.getByRole('alert')
  await expect(alerta).toContainText(
    'Tu orquídea quedó registrada, pero no se pudo subir la foto 2 de 3.',
  )
  await expect(galeria(page).getByText('No se subió')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Reintentar fotos' }),
  ).toBeFocused()
  await revisarAccesibilidad('registro con una foto sin subir')

  const planta = supabase
    .plantasDe(USUARIO)
    .filter((p) => p.species_id === ESPECIES.phalaenopsisAmabilis)
  expect(planta).toHaveLength(2)
  const nueva = planta.find((p) => p.photo_path !== null)
  expect(supabase.fotosDe(nueva?.id ?? '')).toHaveLength(2)

  fallar = false
  await page.getByRole('button', { name: 'Reintentar fotos' }).click()
  await expect(page).toHaveURL(/\/coleccion$/)
  // Sin duplicar la planta: la misma, ya con las tres fotos en su orden.
  expect(
    supabase
      .plantasDe(USUARIO)
      .filter((p) => p.species_id === ESPECIES.phalaenopsisAmabilis),
  ).toHaveLength(2)
  expect(
    supabase.fotosDe(nueva?.id ?? '').map((foto) => foto.position),
  ).toEqual([0, 1, 2])
})

for (const ancho of [360, 1440]) {
  test(
    `a ${String(ancho)} px, sin desplazamiento horizontal y con axe`,
    { tag: ancho > 720 ? '@escritorio' : [] },
    async ({ page, revisarAccesibilidad }) => {
      await page.setViewportSize({ width: ancho, height: 900 })
      await page.goto('/coleccion/nueva')
      await page.getByRole('combobox', { name: 'Nombre' }).fill('Cattleya max')
      await page.getByRole('option', { name: /^Cattleya maxima/ }).click()
      await elegirFotos(page, FOTOS.slice(0, 3))
      await page
        .getByRole('button', { name: 'Más detalles (opcional)' })
        .click()
      const sobra = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(sobra).toBeLessThanOrEqual(0)
      // En escritorio, la galería a la derecha de los datos; en el celular,
      // debajo del origen.
      const nombre = await page
        .getByRole('combobox', { name: 'Nombre' })
        .boundingBox()
      const caja = await galeria(page).boundingBox()
      const origen = await page
        .getByRole('combobox', { name: 'Origen' })
        .boundingBox()
      expect(nombre && caja && origen).toBeTruthy()
      if (nombre && caja && origen) {
        if (ancho > 720) {
          expect(Math.round(caja.x)).toBeGreaterThan(
            Math.round(nombre.x + nombre.width),
          )
        } else {
          expect(Math.round(caja.y)).toBeGreaterThan(
            Math.round(origen.y + origen.height),
          )
        }
      }
      await revisarAccesibilidad(`registro a ${String(ancho)} px`)
    },
  )
}
