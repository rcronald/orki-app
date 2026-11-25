import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'
import {
  ORIGEN_SUPABASE,
  type SupabaseSimulado,
} from './soporte/supabase-simulado.ts'

// Editar planta (#266): formulario rediseñado, «Gestionar fotos», nada se
// guarda hasta «Guardar cambios» (Cancelar no cambia nada, ni datos ni
// fotos), guardado reintentable sin duplicados y aviso de cambios sin guardar
// por las cuatro vías (enlace, «atrás», «Cancelar» y la pestaña).

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/photos/fixtures',
)
const FOTO_WEBP = readFileSync(path.join(FIXTURES, 'sin-metadatos.webp'))
const FOTO_JPG = path.join(FIXTURES, 'sin-metadatos.jpg')

const detalle = (id: string) => `/coleccion/${id}`
const edicion = (id: string) => `/coleccion/${id}/editar`
const CARPETA = `${USUARIO}/${PLANTAS.maxima}`

/** Cattleya maxima con `cuantas` fotos guardadas, con sus archivos. */
function conFotos(supabase: SupabaseSimulado, cuantas: number) {
  for (let i = 0; i < cuantas; i += 1) {
    for (const archivo of [
      `${CARPETA}/photo-v${String(i)}.webp`,
      `${CARPETA}/thumb-v${String(i)}.webp`,
    ]) {
      supabase.archivos.set(archivo, { tipo: 'image/webp', bytes: FOTO_WEBP })
    }
    supabase.fotos.push({
      id: `9999999${String(i)}-9999-4999-8999-999999999999`,
      plant_id: PLANTAS.maxima,
      user_id: USUARIO,
      photo_path: `${CARPETA}/photo-v${String(i)}.webp`,
      thumbnail_path: `${CARPETA}/thumb-v${String(i)}.webp`,
      in_bloom: false,
      taken_at: null,
      note: null,
      position: i,
      created_at: '2026-11-01T12:00:00.000Z',
    })
  }
  const planta = supabase.datos.plantas.find((p) => p.id === PLANTAS.maxima)
  if (planta && cuantas > 0) {
    planta.photo_path = `${CARPETA}/photo-v0.webp`
    planta.thumbnail_path = `${CARPETA}/thumb-v0.webp`
  }
}

/** Filas y archivos de la planta, para comparar antes y después. */
function estado(supabase: SupabaseSimulado) {
  return {
    filas: supabase.fotosDe(PLANTAS.maxima).map((foto) => ({ ...foto })),
    archivos: [...supabase.archivos.keys()]
      .filter((archivo) => archivo.startsWith(`${CARPETA}/`))
      .sort(),
    planta: {
      ...supabase.datos.plantas.find((p) => p.id === PLANTAS.maxima),
    },
  }
}

/** Los archivos del bucket son exactamente los que citan las filas. */
function sinRestos(supabase: SupabaseSimulado) {
  const citados = supabase
    .fotosDe(PLANTAS.maxima)
    .flatMap((foto) => [foto.photo_path, foto.thumbnail_path])
    .sort()
  expect(estado(supabase).archivos).toEqual(citados)
}

const galeria = (page: Page) => page.getByRole('region', { name: /^Fotos/ })
const gestion = (page: Page) =>
  page.getByRole('region', { name: 'Gestionar fotos' })
const aviso = (page: Page) =>
  page.getByRole('dialog', { name: '¿Salir sin guardar?' })

async function elegirFotos(page: Page, cuantas: number) {
  const selector = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Añadir fotos' }).click()
  await (
    await selector
  ).setFiles(Array.from({ length: cuantas }, () => FOTO_JPG))
  await expect(page.locator('.orki-gallery__item--preparing')).toHaveCount(0)
}

async function abrirEdicion(page: Page, id: string) {
  await page.goto(detalle(id))
  await page.getByRole('link', { name: 'Editar planta' }).click()
  await expect(
    page.getByRole('heading', { name: 'Editar planta', level: 1 }),
  ).toBeVisible()
}

test(
  'Mi colección → ficha → editar → guardar vuelve a la ficha con los cambios',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    await page.goto('/coleccion')
    await page
      .getByRole('link', { name: 'Phalaenopsis amabilis', exact: true })
      .click()
    await page.getByRole('link', { name: 'Editar planta' }).click()
    await expect(
      page.getByRole('heading', { name: 'Editar planta', level: 1 }),
    ).toBeVisible()
    // El identificador, de solo lectura.
    await expect(page.locator('.orki-pagehead__meta')).toHaveText(
      'Identificador: PHA-001',
    )
    await revisarAccesibilidad('edición')

    await page.getByRole('combobox', { name: 'Ubicación' }).fill('Invernadero')
    // «Más detalles» está abierta: la planta tiene origen, apodo y color.
    await page.getByRole('textbox', { name: 'Apodo' }).fill('La reina')
    await page
      .getByLabel('Notas', { exact: true })
      .fill('Riego cada cinco días.')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()

    await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.amabilis)}$`))
    await expect(page.getByText('Guardaste los cambios.')).toBeVisible()
    expect(
      supabase.plantasDe(USUARIO).find((p) => p.id === PLANTAS.amabilis),
    ).toMatchObject({
      nickname: 'La reina',
      location: 'Invernadero',
      notes: 'Riego cada cinco días.',
    })
    // La ficha muestra las notas editadas en la edición...
    const notasDeLaFicha = page.getByRole('region', { name: 'Notas' })
    await expect(notasDeLaFicha).toContainText('Riego cada cinco días.')

    // ...y la edición, las que se cambian en la ficha.
    await notasDeLaFicha.getByRole('button', { name: 'Editar notas' }).click()
    await notasDeLaFicha
      .getByRole('textbox', { name: 'Notas' })
      .fill('Abono cada quince días.')
    await notasDeLaFicha.getByRole('button', { name: 'Guardar' }).click()
    await expect(notasDeLaFicha.getByRole('status')).toHaveText(
      'Guardaste las notas.',
    )
    await page.getByRole('link', { name: 'Editar planta' }).click()
    await expect(
      page.getByRole('heading', { name: 'Editar planta', level: 1 }),
    ).toBeVisible()
    await expect(page.getByLabel('Notas', { exact: true })).toHaveValue(
      'Abono cada quince días.',
    )
    // Sin tocarlas, guardar otro cambio no las pisa.
    await page.getByRole('textbox', { name: 'Apodo' }).fill('La reina blanca')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.amabilis)}$`))
    await expect(notasDeLaFicha).toContainText('Abono cada quince días.')
    expect(
      supabase.plantasDe(USUARIO).find((p) => p.id === PLANTAS.amabilis),
    ).toMatchObject({
      nickname: 'La reina blanca',
      notes: 'Abono cada quince días.',
    })
  },
)

test(
  'el identificador no cambia aunque cambie el género',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    await abrirEdicion(page, PLANTAS.porValidar)
    await expect(page.locator('.orki-pagehead__meta')).toContainText('ONC-001')
    await page
      .getByRole('group', { name: 'Género' })
      .getByRole('button', { name: 'Vanda' })
      .click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.porValidar)}$`))
    await page.goto(edicion(PLANTAS.porValidar))
    await expect(page.locator('.orki-pagehead__meta')).toContainText('ONC-001')
    expect(
      supabase.plantasDe(USUARIO).find((p) => p.id === PLANTAS.porValidar)
        ?.genus_id,
    ).not.toBe(
      supabase.datos.plantas.find((p) => p.id === PLANTAS.amabilis)?.genus_id,
    )
  },
)

test('Cancelar no cambia nada, tampoco tras quitar y añadir fotos', async ({
  page,
  supabase,
}) => {
  conFotos(supabase, 2)
  await abrirEdicion(page, PLANTAS.maxima)
  // Tras la primera lectura: el simulado da el identificador al leer.
  const antes = estado(supabase)
  await expect(galeria(page).locator('.orki-gallery__count')).toContainText(
    '2 de 6',
  )

  await page.getByRole('button', { name: 'Gestionar fotos' }).click()
  await gestion(page)
    .getByRole('group', { name: 'Foto principal' })
    .getByRole('button', { name: 'Quitar' })
    .click()
  await expect(
    page.getByText('Una foto guardada se quitará al guardar los cambios.'),
  ).toBeVisible()
  await elegirFotos(page, 2)
  await expect(gestion(page).locator('.orki-gallery__count')).toContainText(
    '3 de 6',
  )
  await gestion(page)
    .getByRole('group', { name: 'Foto 3 de 3' })
    .getByRole('button', { name: 'Hacer principal' })
    .click()
  await page.getByRole('button', { name: 'Listo' }).click()
  await page.getByRole('textbox', { name: 'Apodo' }).fill('Otro apodo')

  // Nada salió hacia la base mientras tanto.
  expect(estado(supabase)).toEqual(antes)

  await page.getByRole('button', { name: 'Cancelar' }).click()
  await aviso(page).getByRole('button', { name: 'Salir sin guardar' }).click()
  await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
  // Ni datos ni fotos: las quitadas siguen y las añadidas no quedan.
  expect(estado(supabase)).toEqual(antes)
})

test('cambiar la principal, la fecha y la nota de una foto', async ({
  page,
  supabase,
}) => {
  conFotos(supabase, 3)
  await abrirEdicion(page, PLANTAS.maxima)
  await page.getByRole('button', { name: 'Gestionar fotos' }).click()
  const tercera = gestion(page).getByRole('group', { name: 'Foto 3 de 3' })
  await tercera.getByLabel('Fecha de la foto').fill('2026-10-05')
  await tercera.getByLabel('Nota', { exact: true }).fill('Primera vara')
  await tercera.getByRole('button', { name: 'Hacer principal' }).click()
  // Sigue siendo la misma foto, ahora la principal; el foco no se pierde.
  const principal = gestion(page).getByRole('group', { name: 'Foto principal' })
  await expect(principal.getByLabel('Nota', { exact: true })).toHaveValue(
    'Primera vara',
  )
  await expect(
    principal.getByRole('button', { name: 'Hacer principal' }),
  ).toBeFocused()
  await expect(
    principal.getByRole('button', { name: 'Hacer principal' }),
  ).toHaveAttribute('aria-disabled', 'true')

  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
  const fotos = supabase.fotosDe(PLANTAS.maxima)
  expect(fotos.map((foto) => foto.photo_path)).toEqual([
    `${CARPETA}/photo-v2.webp`,
    `${CARPETA}/photo-v0.webp`,
    `${CARPETA}/photo-v1.webp`,
  ])
  expect(fotos[0]).toMatchObject({
    taken_at: '2026-10-05',
    note: 'Primera vara',
  })
  // La tarjeta de «Mi colección» lee la principal de la planta.
  expect(
    supabase.datos.plantas.find((p) => p.id === PLANTAS.maxima)?.photo_path,
  ).toBe(`${CARPETA}/photo-v2.webp`)
  sinRestos(supabase)
})

test('una foto: quitarla y guardar deja la planta sin fotos y sin archivos', async ({
  page,
  supabase,
}) => {
  conFotos(supabase, 1)
  await abrirEdicion(page, PLANTAS.maxima)
  await page.getByRole('button', { name: 'Gestionar fotos' }).click()
  await gestion(page).getByRole('button', { name: 'Quitar' }).click()
  // Sin fotos, el foco va a «Añadir fotos».
  await expect(page.getByRole('button', { name: 'Añadir fotos' })).toBeFocused()
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
  expect(supabase.fotosDe(PLANTAS.maxima)).toEqual([])
  expect(
    supabase.datos.plantas.find((p) => p.id === PLANTAS.maxima)?.photo_path,
  ).toBeNull()
  await expect.poll(() => estado(supabase).archivos).toEqual([])
})

test('sin fotos, añadir hasta el límite de seis', async ({
  page,
  supabase,
}) => {
  await abrirEdicion(page, PLANTAS.maxima)
  await expect(galeria(page).getByText('Aún no hay fotos.')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Gestionar fotos' }),
  ).toHaveCount(0)

  await elegirFotos(page, 7)
  await expect(galeria(page).locator('.orki-gallery__count')).toContainText(
    '6 de 6',
  )
  await expect(
    galeria(page).getByText(
      'Se añadieron 6 fotos; 1 quedó fuera: el máximo es 6.',
    ),
  ).toBeVisible()
  const anadir = page.getByRole('button', { name: 'Añadir fotos' })
  await expect(anadir).toHaveAttribute('aria-disabled', 'true')
  await expect(anadir).toHaveAccessibleDescription(
    'Ya tienes 6 fotos. Quita una para añadir otra.',
  )

  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
  expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(6)
  sinRestos(supabase)
})

test('si falla una subida, no se guarda nada y «Reintentar» no duplica archivos', async ({
  page,
  supabase,
}) => {
  conFotos(supabase, 1)
  let fallos = 1
  await page.route(
    `${ORIGEN_SUPABASE}/storage/v1/object/plant-photos/**`,
    async (route) => {
      if (route.request().method() === 'POST' && fallos > 0) {
        fallos -= 1
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ statusCode: '500', error: 'Fallo simulado' }),
        })
        return
      }
      await route.fallback()
    },
  )
  await abrirEdicion(page, PLANTAS.maxima)
  const antes = estado(supabase)
  await elegirFotos(page, 2)
  await page.getByRole('textbox', { name: 'Apodo' }).fill('La morada')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  const alerta = page.getByRole('alert').filter({ hasText: 'No se pudo subir' })
  await expect(alerta).toContainText('la foto 2 de 3')
  await expect(alerta).toContainText('Aún no se guardó ningún cambio')
  await expect(alerta.getByRole('button', { name: 'Reintentar' })).toBeFocused()
  await expect(galeria(page).getByText('No se subió')).toBeVisible()
  // La base, como estaba (solo pueden quedar archivos sin fila).
  expect(estado(supabase).filas).toEqual(antes.filas)
  expect(estado(supabase).planta).toEqual(antes.planta)

  await alerta.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
  expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(3)
  expect(
    supabase.datos.plantas.find((p) => p.id === PLANTAS.maxima)?.nickname,
  ).toBe('La morada')
  sinRestos(supabase)
})

test('si falla el guardado, «Reintentar» lo completa sin duplicar fotos', async ({
  page,
  supabase,
}) => {
  conFotos(supabase, 2)
  let fallos = 1
  await page.route(`${ORIGEN_SUPABASE}/rest/v1/plants**`, async (route) => {
    if (route.request().method() === 'PATCH' && fallos > 0) {
      fallos -= 1
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ code: 'XX000', message: 'Fallo simulado' }),
      })
      return
    }
    await route.fallback()
  })
  await abrirEdicion(page, PLANTAS.maxima)
  await page.getByRole('button', { name: 'Gestionar fotos' }).click()
  await gestion(page)
    .getByRole('group', { name: 'Foto principal' })
    .getByRole('button', { name: 'Quitar' })
    .click()
  await elegirFotos(page, 1)
  await page.getByRole('textbox', { name: 'Apodo' }).fill('La morada')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  const alerta = page.getByRole('alert').filter({ hasText: 'cambios' })
  await expect(alerta).toContainText('No se pudieron guardar los cambios')
  // Lo editado sigue en pantalla y la foto quitada sigue en la base.
  await expect(page.getByRole('textbox', { name: 'Apodo' })).toHaveValue(
    'La morada',
  )
  expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(2)

  await alerta.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
  const fotos = supabase.fotosDe(PLANTAS.maxima)
  expect(fotos).toHaveLength(2)
  expect(fotos[0]?.photo_path).toBe(`${CARPETA}/photo-v1.webp`)
  await expect
    .poll(() => supabase.archivos.has(`${CARPETA}/photo-v0.webp`))
    .toBe(false)
  sinRestos(supabase)
})

/**
 * El invariante del guardado (#279): los archivos son los que citan las filas
 * y la principal de la planta apunta a un archivo que existe.
 */
async function coherente(supabase: SupabaseSimulado) {
  const citados = () =>
    supabase
      .fotosDe(PLANTAS.maxima)
      .flatMap((foto) => [foto.photo_path, foto.thumbnail_path])
      .sort()
  await expect.poll(() => estado(supabase).archivos).toEqual(citados())
  const planta = estado(supabase).planta
  for (const archivo of [planta.photo_path, planta.thumbnail_path]) {
    if (archivo) expect(supabase.archivos.has(archivo)).toBe(true)
  }
}

/** Retiene la creación de filas de fotos hasta que la prueba la suelte. */
async function retenerFilas(page: Page) {
  let soltar: () => void = () => undefined
  const suelta = new Promise<void>((resolve) => {
    soltar = resolve
  })
  let pedida: () => void = () => undefined
  const llegada = new Promise<void>((resolve) => {
    pedida = resolve
  })
  await page.route(
    `${ORIGEN_SUPABASE}/rest/v1/plant_photos**`,
    async (route) => {
      if (route.request().method() === 'POST') {
        pedida()
        await suelta
      }
      await route.fallback()
    },
  )
  return { llegada, soltar }
}

/** La primera petición `metodo` a `patron` falla con un 500. */
async function fallarUnaVez(page: Page, patron: string, metodo: string) {
  let fallos = 1
  await page.route(patron, async (route) => {
    if (route.request().method() === metodo && fallos > 0) {
      fallos -= 1
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ code: 'XX000', message: 'Fallo simulado' }),
      })
      return
    }
    await route.fallback()
  })
}

test.describe('guardado a prueba de salidas, reintentos y huérfanos (#279)', () => {
  const vias: { nombre: string; salir: (page: Page) => Promise<void> }[] = [
    {
      nombre: 'un enlace de la app',
      salir: (page) => page.getByRole('link', { name: 'Mi colección' }).click(),
    },
    { nombre: '«atrás»', salir: async (page) => void (await page.goBack()) },
    {
      nombre: '«Volver a la planta»',
      salir: (page) =>
        page.getByRole('link', { name: 'Volver a la planta' }).click(),
    },
  ]
  for (const via of vias) {
    test(`durante el guardado, salir por ${via.nombre} espera a que termine`, async ({
      page,
      supabase,
    }) => {
      conFotos(supabase, 1)
      await abrirEdicion(page, PLANTAS.maxima)
      await elegirFotos(page, 1)
      await page.getByRole('button', { name: 'Gestionar fotos' }).click()
      await gestion(page)
        .getByRole('group', { name: 'Foto 2 de 2' })
        .getByRole('button', { name: 'Hacer principal' })
        .click()
      await page.getByRole('button', { name: 'Listo' }).click()
      const { llegada, soltar } = await retenerFilas(page)
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      await llegada

      await via.salir(page)
      const guardando = page.getByRole('dialog', {
        name: 'Se están guardando los cambios',
      })
      await expect(guardando).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Salir sin guardar' }),
      ).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`${edicion(PLANTAS.maxima)}$`))

      soltar()
      await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
      expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(2)
      // La nueva es la principal y su archivo existe.
      expect(estado(supabase).planta.photo_path).not.toBe(
        `${CARPETA}/photo-v0.webp`,
      )
      await coherente(supabase)
    })
  }

  test('b) quitar una foto nueva que ya tiene fila tras un fallo del orden: «Reintentar» termina', async ({
    page,
    supabase,
  }) => {
    conFotos(supabase, 1)
    await fallarUnaVez(
      page,
      `${ORIGEN_SUPABASE}/rest/v1/rpc/reorder_plant_photos**`,
      'POST',
    )
    await abrirEdicion(page, PLANTAS.maxima)
    await elegirFotos(page, 1)
    await page.getByRole('button', { name: 'Gestionar fotos' }).click()
    await gestion(page)
      .getByRole('group', { name: 'Foto 2 de 2' })
      .getByRole('button', { name: 'Hacer principal' })
      .click()
    await page.getByRole('button', { name: 'Listo' }).click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    const alerta = page.getByRole('alert').filter({ hasText: 'Reintentar' })
    await expect(alerta).toContainText('Parte de los cambios ya quedó guardada')
    expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(2)

    await page.getByRole('button', { name: 'Gestionar fotos' }).click()
    await gestion(page)
      .getByRole('group', { name: 'Foto principal' })
      .getByRole('button', { name: 'Quitar' })
      .click()
    await page.getByRole('button', { name: 'Listo' }).click()
    await alerta.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
    expect(
      supabase.fotosDe(PLANTAS.maxima).map((foto) => foto.photo_path),
    ).toEqual([`${CARPETA}/photo-v0.webp`])
    await coherente(supabase)
  })

  test('b) tras borrar la fila de una foto quitada, no se ofrece «Deshacer» y «Reintentar» termina', async ({
    page,
    supabase,
  }) => {
    conFotos(supabase, 2)
    await fallarUnaVez(
      page,
      `${ORIGEN_SUPABASE}/rest/v1/plant_photos**`,
      'PATCH',
    )
    await abrirEdicion(page, PLANTAS.maxima)
    await page.getByRole('button', { name: 'Gestionar fotos' }).click()
    await gestion(page)
      .getByRole('group', { name: 'Foto principal' })
      .getByRole('button', { name: 'Quitar' })
      .click()
    await gestion(page)
      .getByRole('group', { name: 'Foto principal' })
      .getByLabel('Nota', { exact: true })
      .fill('Nueva vara')
    await page.getByRole('button', { name: 'Listo' }).click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    const alerta = page.getByRole('alert').filter({ hasText: 'Reintentar' })
    await expect(alerta).toContainText('Parte de los cambios ya quedó guardada')
    expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Deshacer' })).toHaveCount(0)

    await alerta.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
    expect(supabase.fotosDe(PLANTAS.maxima)[0]).toMatchObject({
      photo_path: `${CARPETA}/photo-v1.webp`,
      note: 'Nueva vara',
    })
    await coherente(supabase)
  })

  test('c) una foto subida que se quita antes de reintentar no queda huérfana', async ({
    page,
    supabase,
  }) => {
    conFotos(supabase, 1)
    await fallarUnaVez(page, `${ORIGEN_SUPABASE}/rest/v1/plants**`, 'PATCH')
    await abrirEdicion(page, PLANTAS.maxima)
    await elegirFotos(page, 1)
    await page.getByRole('textbox', { name: 'Apodo' }).fill('La morada')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    const alerta = page.getByRole('alert').filter({ hasText: 'Reintentar' })
    await expect(alerta).toContainText('No se pudieron guardar los cambios')

    await page.getByRole('button', { name: 'Gestionar fotos' }).click()
    await gestion(page)
      .getByRole('group', { name: 'Foto 2 de 2' })
      .getByRole('button', { name: 'Quitar' })
      .click()
    await page.getByRole('button', { name: 'Listo' }).click()
    await alerta.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
    expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(1)
    await coherente(supabase)
  })

  test('salir tras un guardado a medias borra lo que ninguna fila cita', async ({
    page,
    supabase,
  }) => {
    conFotos(supabase, 2)
    await fallarUnaVez(
      page,
      `${ORIGEN_SUPABASE}/rest/v1/plant_photos**`,
      'PATCH',
    )
    await abrirEdicion(page, PLANTAS.maxima)
    await elegirFotos(page, 1)
    await page.getByRole('button', { name: 'Gestionar fotos' }).click()
    await gestion(page)
      .getByRole('group', { name: 'Foto principal' })
      .getByRole('button', { name: 'Quitar' })
      .click()
    await gestion(page)
      .getByRole('group', { name: 'Foto principal' })
      .getByLabel('Nota', { exact: true })
      .fill('Nueva vara')
    await page.getByRole('button', { name: 'Listo' }).click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    const alerta = page.getByRole('alert').filter({ hasText: 'Reintentar' })
    await expect(alerta).toContainText('Parte de los cambios ya quedó guardada')

    await page.getByRole('button', { name: 'Cancelar' }).click()
    await aviso(page).getByRole('button', { name: 'Salir sin guardar' }).click()
    await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
    // La quitada ya no tiene fila ni archivos; la nueva sí quedó guardada.
    expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(2)
    await coherente(supabase)
  })
})

test.describe('aviso de cambios sin guardar', () => {
  test('sin cambios no pregunta', async ({ page }) => {
    await abrirEdicion(page, PLANTAS.amabilis)
    await page.getByRole('link', { name: 'Mi colección' }).click()
    await expect(page).toHaveURL(/\/coleccion$/)
  })

  test('por un enlace de la app, con «Cancelar», con «atrás» y al cerrar la pestaña', async ({
    page,
    supabase,
    revisarAccesibilidad,
    browserName,
  }) => {
    await abrirEdicion(page, PLANTAS.amabilis)
    const apodo = page.getByRole('textbox', { name: 'Apodo' })
    await apodo.fill('Sin guardar')

    // 1. Un enlace de la app: el diálogo; Escape lo cierra y no se sale.
    const pestana = page.getByRole('link', { name: 'Mi colección' })
    await pestana.click()
    await expect(aviso(page)).toBeVisible()
    await expect(
      aviso(page).getByRole('button', { name: 'Seguir editando' }),
    ).toBeFocused()
    await revisarAccesibilidad('aviso de cambios sin guardar')
    await page.keyboard.press('Escape')
    await expect(aviso(page)).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`${edicion(PLANTAS.amabilis)}$`))
    // El foco vuelve a la pestaña pulsada. WebKit no da el foco a un enlace
    // al pulsarlo con el ratón, así que allí no hay a dónde volver.
    if (browserName !== 'webkit') await expect(pestana).toBeFocused()

    // 2. «Cancelar»: «Seguir editando» se queda.
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await aviso(page).getByRole('button', { name: 'Seguir editando' }).click()
    await expect(apodo).toHaveValue('Sin guardar')

    // 3. «Atrás»: se queda en la edición hasta confirmar.
    await page.goBack()
    await expect(aviso(page)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${edicion(PLANTAS.amabilis)}$`))
    await aviso(page).getByRole('button', { name: 'Seguir editando' }).click()
    await expect(apodo).toHaveValue('Sin guardar')

    // 4. La pestaña: el aviso nativo del navegador.
    const tipos: string[] = []
    page.on('dialog', (dialogo) => {
      tipos.push(dialogo.type())
      void dialogo.dismiss()
    })
    await page.close({ runBeforeUnload: true })
    await expect.poll(() => tipos).toEqual(['beforeunload'])

    expect(
      supabase.plantasDe(USUARIO).find((p) => p.id === PLANTAS.amabilis)
        ?.nickname,
    ).toBe('La blanca')
  })

  test('confirmar al ir atrás vuelve a la ficha sin guardar', async ({
    page,
    supabase,
  }) => {
    await abrirEdicion(page, PLANTAS.amabilis)
    await page.getByRole('textbox', { name: 'Apodo' }).fill('Sin guardar')
    await page.goBack()
    await aviso(page).getByRole('button', { name: 'Salir sin guardar' }).click()
    await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.amabilis)}$`))
    // Una vez fuera, «adelante» no deja otra entrada repetida de la edición.
    expect(
      supabase.plantasDe(USUARIO).find((p) => p.id === PLANTAS.amabilis)
        ?.nickname,
    ).toBe('La blanca')
  })
})

test('móvil con el teclado abierto: «Guardar cambios» se alcanza y nada queda fijo', async ({
  page,
}) => {
  // Lo que queda de pantalla con el teclado del celular abierto.
  await page.setViewportSize({ width: 390, height: 420 })
  await page.goto(edicion(PLANTAS.amabilis))
  // Tocar el campo lo trae a la vista (fill no desplaza en el WebKit del
  // perfil celular) y se escribe con el teclado.
  const notas = page.getByLabel('Notas', { exact: true })
  await notas.click()
  await page.keyboard.type('Escrito con el teclado abierto.')
  await expect(notas).toBeInViewport()
  await expect(notas).toHaveValue('Escrito con el teclado abierto.')
  const fijos = await page.evaluate(
    () =>
      [...document.querySelectorAll('body *')].filter((el) =>
        ['fixed', 'sticky'].includes(getComputedStyle(el).position),
      ).length,
  )
  expect(fijos).toBe(0)
  const guardar = page.getByRole('button', { name: 'Guardar cambios' })
  await guardar.scrollIntoViewIfNeeded()
  await expect(guardar).toBeInViewport()
  await guardar.click()
  await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.amabilis)}$`))
})

for (const ancho of [1440, 360]) {
  test(
    `a ${String(ancho)} px, sin desbordes, con la gestión de fotos y «Más detalles» abiertas`,
    { tag: ancho === 1440 ? '@escritorio' : [] },
    async ({ page, supabase, revisarAccesibilidad }) => {
      conFotos(supabase, 6)
      await page.setViewportSize({ width: ancho, height: 900 })
      await page.goto(edicion(PLANTAS.maxima))
      await expect(galeria(page).locator('.orki-gallery__count')).toContainText(
        '6 de 6',
      )
      await page.getByRole('button', { name: 'Gestionar fotos' }).click()
      await expect(gestion(page)).toBeVisible()
      await expect(
        page.getByRole('button', { name: /Más detalles/ }),
      ).toHaveAttribute('aria-expanded', 'true')
      const desborde = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(desborde).toBeLessThanOrEqual(0)
      await revisarAccesibilidad(`gestión de fotos a ${String(ancho)} px`)
    },
  )
}
