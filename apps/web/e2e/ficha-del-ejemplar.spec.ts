import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'
import type { SupabaseSimulado } from './soporte/supabase-simulado.ts'

// Ficha del ejemplar (#265, maqueta «Ficha de la planta» del #263): la
// cabecera con el identificador, la galería con 0, 1 y 6 fotos, los datos,
// las notas editables en el sitio, «Gestionar planta» (dar de baja y
// eliminar, con los datos descartables del Supabase simulado de cada prueba),
// sin conexión y el CSV con el identificador y las notas.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FOTO = readFileSync(
  path.join(RAIZ, 'src/photos/fixtures/sin-metadatos.webp'),
)

const PLANTA = PLANTAS.maxima
const NOMBRE = 'Cattleya maxima'
const CARPETA = `${USUARIO}/${PLANTA}`
const ruta = (tipo: 'photo' | 'thumb', n: number) =>
  `${CARPETA}/${tipo}-${String(n)}.webp`

/** Cattleya maxima con `cuantas` fotos en la galería. */
function conFotos(supabase: SupabaseSimulado, cuantas: number) {
  for (let n = 1; n <= cuantas; n += 1) {
    supabase.archivos.set(ruta('photo', n), { tipo: 'image/webp', bytes: FOTO })
    supabase.archivos.set(ruta('thumb', n), { tipo: 'image/webp', bytes: FOTO })
    supabase.fotos.push({
      id: `bbbbbbbb-0000-4000-8000-00000000000${String(n)}`,
      plant_id: PLANTA,
      user_id: USUARIO,
      photo_path: ruta('photo', n),
      thumbnail_path: ruta('thumb', n),
      in_bloom: false,
      taken_at: null,
      note: null,
      position: n - 1,
      created_at: '2026-11-20T12:00:00.000Z',
    })
  }
  if (cuantas > 0) {
    Object.assign(planta(supabase), {
      photo_path: ruta('photo', 1),
      thumbnail_path: ruta('thumb', 1),
    })
  }
}

function planta(supabase: SupabaseSimulado, id = PLANTA) {
  const encontrada = supabase.datos.plantas.find((p) => p.id === id)
  if (!encontrada) throw new Error(`Sin la planta ${id}`)
  return encontrada
}

const galeria = (page: Page) => page.getByRole('region', { name: 'Fotos' })
const notas = (page: Page) => page.getByRole('region', { name: 'Notas' })
const gestionar = (page: Page) =>
  page.getByRole('button', { name: 'Gestionar planta' })

/** Sin desplazamiento horizontal (medidas redondeadas). */
async function sinDesplazamientoHorizontal(page: Page) {
  const { ancho, visible } = await page.evaluate(() => ({
    ancho: Math.round(document.documentElement.scrollWidth),
    visible: Math.round(document.documentElement.clientWidth),
  }))
  expect(ancho).toBeLessThanOrEqual(visible)
}

/** Caja redondeada de un elemento. */
async function caja(elemento: Locator) {
  const medida = await elemento.first().boundingBox()
  if (!medida) throw new Error('Sin caja')
  return {
    x: Math.round(medida.x),
    y: Math.round(medida.y),
    ancho: Math.round(medida.width),
    alto: Math.round(medida.height),
  }
}

for (const { ancho, alto } of [
  { ancho: 1440, alto: 900 },
  { ancho: 360, alto: 760 },
]) {
  const escritorio = ancho > 720
  const etiqueta = escritorio ? '@escritorio' : []

  test(
    `a ${String(ancho)} px con seis fotos: cabecera, galería, datos, notas y gestionar`,
    { tag: etiqueta },
    async ({ page, supabase, revisarAccesibilidad }) => {
      await page.setViewportSize({ width: ancho, height: alto })
      conFotos(supabase, 6)
      planta(supabase).notes = 'Llegó sin flor.\nRiego cada 5 días.'
      await page.goto(`/coleccion/${PLANTA}`)

      // Cabecera: regreso, nombre y, debajo, insignia, identificador (CAT-002:
      // Cattleya trianae, dada de alta antes, es la CAT-001), tipo y
      // estado; «Editar planta».
      await expect(
        page.getByRole('heading', { name: NOMBRE, level: 1 }),
      ).toBeVisible()
      const volver = page.getByRole('link', { name: 'Volver a Mi colección' })
      // Se ve «Mi colección»; «Volver a» es solo para el lector.
      await expect(volver.locator('.sr-only')).toHaveText('Volver a')
      await expect(volver).toHaveText('Volver a Mi colección')
      await expect(page.locator('.orki-pagehead__meta')).toHaveText(
        /Validada.*CAT-002.*Especie.*Activa/,
      )
      const editar = page.getByRole('link', { name: 'Editar planta' })
      await expect(editar).toHaveAttribute(
        'href',
        `/coleccion/${PLANTA}/editar`,
      )

      // Galería: «1 de 6», flechas y seis miniaturas.
      await expect(
        galeria(page).getByRole('img', { name: `Foto principal de ${NOMBRE}` }),
      ).toHaveAttribute('src', /^blob:/)
      await expect(galeria(page).locator('.orki-gallery__count')).toHaveText(
        'Foto 1 de 6',
      )
      await expect(
        galeria(page)
          .getByRole('list', { name: 'Elegir la foto que se ve' })
          .getByRole('button'),
      ).toHaveCount(6)
      await galeria(page)
        .getByRole('button', { name: 'Foto siguiente' })
        .click()
      await expect(galeria(page).locator('.orki-gallery__count')).toHaveText(
        'Foto 2 de 6',
      )

      // Datos, enlace al catálogo y notas con sus saltos de línea.
      await expect(
        page.getByRole('link', { name: 'Ver la especie en el catálogo' }),
      ).toHaveAttribute('href', /\/catalogo\/especie\//)
      await expect(notas(page).getByText('Llegó sin flor.')).toBeVisible()
      await expect(gestionar(page)).toHaveAttribute('aria-expanded', 'false')

      // Diseño: dos columnas en escritorio (galería a la izquierda de los
      // datos); en una a 360 px, «Editar planta» a todo el ancho y la foto
      // de 240 px de alto como mucho.
      const foto = await caja(page.locator('.orki-viewer__main'))
      const datos = await caja(
        page.getByRole('region', { name: 'Datos de la planta' }),
      )
      if (escritorio) {
        expect(datos.x).toBeGreaterThan(foto.x + foto.ancho)
        expect(Math.abs(datos.y - foto.y)).toBeLessThanOrEqual(1)
      } else {
        expect(datos.y).toBeGreaterThan(foto.y + foto.alto)
        expect(foto.alto).toBeLessThanOrEqual(240)
        const boton = await caja(editar)
        expect(boton.ancho).toBeGreaterThanOrEqual(ancho - 2 * 16 - 1)
      }
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`ficha con seis fotos a ${String(ancho)} px`)

      // «Gestionar planta», abierto.
      await gestionar(page).click()
      await expect(
        page
          .getByRole('region', { name: 'Gestionar planta' })
          .getByRole('button'),
      ).toHaveText(['Dar de baja', 'Eliminar planta'])
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(
        `ficha con «Gestionar planta» abierto a ${String(ancho)} px`,
      )
    },
  )

  test(
    `a ${String(ancho)} px con una foto y sin fotos`,
    { tag: etiqueta },
    async ({ page, supabase, revisarAccesibilidad }) => {
      await page.setViewportSize({ width: ancho, height: alto })
      conFotos(supabase, 1)
      await page.goto(`/coleccion/${PLANTA}`)
      await expect(
        galeria(page).getByRole('img', { name: `Foto principal de ${NOMBRE}` }),
      ).toHaveAttribute('src', /^blob:/)
      // Con una sola: sin contador, flechas, miniaturas ni orden.
      await expect(galeria(page).locator('.orki-gallery__count')).toHaveCount(0)
      for (const nombre of [
        'Foto anterior',
        'Foto siguiente',
        'Ordenar fotos',
      ]) {
        await expect(
          galeria(page).getByRole('button', { name: nombre }),
        ).toHaveCount(0)
      }
      await expect(galeria(page).getByRole('list')).toHaveCount(0)
      await expect(
        galeria(page).getByRole('button', { name: 'Editar fecha y nota' }),
      ).toBeVisible()
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`ficha con una foto a ${String(ancho)} px`)

      // Sin fotos ni foto de referencia (Oncidium, por validar): el estado
      // vacío compacto, «Añadir fotos» y «Completar datos».
      await page.goto(`/coleccion/${PLANTAS.porValidar}`)
      await expect(
        galeria(page).getByText('Aún no tienes fotos de esta planta.'),
      ).toBeVisible()
      await expect(
        galeria(page).getByRole('link', { name: 'Añadir fotos' }),
      ).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Completar datos' }),
      ).toHaveAttribute('href', `/coleccion/${PLANTAS.porValidar}/editar`)
      await expect(
        page.getByRole('link', { name: 'Ver la especie en el catálogo' }),
      ).toHaveCount(0)
      await expect(page.locator('.orki-pagehead__meta')).toHaveText(
        /Nombre por validar.*ONC-001.*Híbrido.*Activa/,
      )
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`ficha sin fotos a ${String(ancho)} px`)
    },
  )
}

test(
  'notas: añadir, editar, vaciar y reintentar tras un fallo',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    await page.goto(`/coleccion/${PLANTA}`)
    await expect(notas(page)).toContainText(
      'Aún no has escrito notas sobre esta planta.',
    )

    // Añadir.
    await notas(page).getByRole('button', { name: 'Añadir notas' }).click()
    const campo = notas(page).getByRole('textbox', { name: 'Notas' })
    await expect(campo).toBeFocused()
    await campo.fill('  Llegó sin flor.\nRiego cada 5 días.  ')
    await expect(notas(page).getByText('34 de 2000 caracteres')).toBeVisible()
    await revisarAccesibilidad('notas en edición')
    await notas(page).getByRole('button', { name: 'Guardar' }).click()
    await expect(notas(page).getByRole('status')).toHaveText(
      'Guardaste las notas.',
    )
    expect(planta(supabase).notes).toBe('Llegó sin flor.\nRiego cada 5 días.')
    const editar = notas(page).getByRole('button', { name: 'Editar notas' })
    await expect(editar).toBeFocused()

    // Editar, con un fallo del servidor: lo dice, conserva lo escrito y el
    // reintento guarda.
    let fallar = true
    await page.route('https://supabase.orki.invalid/rest/v1/plants**', (r) =>
      fallar && r.request().method() === 'PATCH'
        ? r.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Error (simulado)' }),
          })
        : r.fallback(),
    )
    await editar.click()
    await campo.fill('Abono cada 15 días.')
    await notas(page).getByRole('button', { name: 'Guardar' }).click()
    await expect(notas(page).getByRole('alert')).toContainText(
      'No se pudieron guardar los cambios',
    )
    await expect(campo).toHaveValue('Abono cada 15 días.')
    fallar = false
    await notas(page).getByRole('button', { name: 'Guardar' }).click()
    await expect(notas(page).getByText('Abono cada 15 días.')).toBeVisible()
    expect(planta(supabase).notes).toBe('Abono cada 15 días.')

    // Vaciar: «sin notas» es null.
    await notas(page).getByRole('button', { name: 'Editar notas' }).click()
    await campo.fill('   ')
    await notas(page).getByRole('button', { name: 'Guardar' }).click()
    await expect(notas(page).getByRole('status')).toHaveText(
      'Quitaste las notas.',
    )
    expect(planta(supabase).notes).toBeNull()
    await expect(
      notas(page).getByRole('button', { name: 'Añadir notas' }),
    ).toBeFocused()
  },
)

test(
  'gestionar planta: dar de baja y eliminar, con sus fotos',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    conFotos(supabase, 2)
    // Dar de baja: la planta se conserva, perdida.
    await page.goto(`/coleccion/${PLANTAS.nobile}`)
    await gestionar(page).click()
    await page
      .getByRole('region', { name: 'Gestionar planta' })
      .getByRole('button', { name: 'Dar de baja' })
      .click()
    const baja = page.getByRole('dialog', { name: 'Dar de baja esta planta' })
    await baja.getByRole('button', { name: 'Dar de baja' }).click()
    await expect(baja).toBeHidden()
    await expect(
      page.getByText(/Diste de baja la planta: perdida\./),
    ).toBeVisible()
    await expect(page.locator('.orki-pagehead__meta')).toContainText('Perdida')
    expect(planta(supabase, PLANTAS.nobile).status).toBe('lost')

    // Eliminar: la confirmación dice qué pasa con las fotos y la bitácora.
    await page.goto(`/coleccion/${PLANTA}`)
    await gestionar(page).click()
    await page.getByRole('button', { name: 'Eliminar planta' }).click()
    const eliminar = page.getByRole('dialog', {
      name: '¿Eliminar esta planta para siempre?',
    })
    await expect(eliminar).toContainText(
      'todas sus fotos y todos los registros de su bitácora',
    )
    await expect(
      eliminar.getByRole('button', { name: 'Cancelar' }),
    ).toBeFocused()
    await revisarAccesibilidad('eliminar desde la ficha')
    await eliminar
      .getByRole('button', { name: 'Eliminar definitivamente' })
      .click()
    await expect(page).toHaveURL(/\/coleccion$/)
    await expect(page.getByText(/Eliminaste de tu colección/)).toBeVisible()
    expect(supabase.plantasDe(USUARIO).some((p) => p.id === PLANTA)).toBe(false)
    expect(supabase.fotosDe(PLANTA)).toEqual([])
    await expect
      .poll(() =>
        [...supabase.archivos.keys()].filter((a) =>
          a.startsWith(`${CARPETA}/`),
        ),
      )
      .toEqual([])
  },
)

test('sin conexión: se ve lo guardado y no se puede editar', async ({
  page,
  context,
  supabase,
  revisarAccesibilidad,
}) => {
  planta(supabase).notes = 'Riego cada 5 días.'
  // Otro detalle con conexión: sin el service worker (bloqueado en estas
  // pruebas), el chunk de la ficha tiene que estar ya cargado.
  await page.goto(`/coleccion/${PLANTAS.amabilis}`)
  await page.getByRole('link', { name: 'Volver a Mi colección' }).click()
  await expect(page.getByRole('article', { name: NOMBRE })).toBeVisible()

  const cortar = (route: { abort: (code: string) => Promise<void> }) =>
    route.abort('internetdisconnected')
  await context.route('https://supabase.orki.invalid/**', cortar)
  await context.setOffline(true)
  await page.getByRole('link', { name: NOMBRE }).click()

  const motivo =
    'Sin conexión: editar la planta o sus notas, darla de baja o eliminarla necesitan conexión. Se activarán solas cuando vuelva.'
  await expect(page.getByText(motivo)).toBeVisible()
  await expect(page.locator('.orki-pagehead__meta')).toContainText('CAT-002')
  await expect(notas(page).getByText('Riego cada 5 días.')).toBeVisible()
  const editar = page.getByRole('button', { name: 'Editar planta' })
  const editarNotas = notas(page).getByRole('button', { name: 'Editar notas' })
  await gestionar(page).click()
  for (const control of [
    editar,
    editarNotas,
    page.getByRole('button', { name: 'Dar de baja' }),
    page.getByRole('button', { name: 'Eliminar planta' }),
  ]) {
    await expect(control).toHaveAttribute('aria-disabled', 'true')
    await expect(control).toHaveAccessibleDescription(motivo)
  }
  // Desactivado (aria-disabled, sigue recibiendo el foco): no abre nada.
  await editarNotas.dispatchEvent('click')
  await expect(notas(page).getByRole('textbox')).toHaveCount(0)
  await revisarAccesibilidad('ficha sin conexión')

  // Al volver la conexión, se puede editar.
  await context.unroute('https://supabase.orki.invalid/**', cortar)
  await context.setOffline(false)
  await expect(page.getByRole('link', { name: 'Editar planta' })).toBeVisible()
  await expect(editarNotas).not.toHaveAttribute('aria-disabled')
})

test(
  'el CSV lleva el identificador y las notas al final',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    // Como en cuenta.spec.ts: la descarga, no la hoja de compartir.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined })
    })
    planta(supabase).notes = 'Llegó sin flor.\nRiego, cada 5 días.'
    await page.goto('/coleccion')
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar a CSV' }).click(),
    ])
    const texto = (await readFile(await descarga.path())).toString('utf8')
    const [cabecera] = texto.replace(/^\uFEFF/, '').split('\r\n')
    expect(cabecera?.split(',').slice(-3)).toEqual([
      'Número de fotos',
      'Identificador',
      'Notas',
    ])
    expect(texto).toContain(',CAT-002,"Llegó sin flor.\nRiego, cada 5 días."')
  },
)
