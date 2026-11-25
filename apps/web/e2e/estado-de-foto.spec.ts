import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './soporte/fixtures.ts'

// Estado de cada miniatura de la galería del registro a 360 px (#247):
// «Preparando…», «Subiendo…» y «No se subió» se leen enteros, dentro de su
// miniatura y sin solaparse con el botón de quitar ni con «Principal»; quitar y
// «Reintentar» conservan su objetivo táctil de 44 px.

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/photos/fixtures',
)
const FOTOS = ['sin-metadatos.jpg', 'sin-metadatos.png'].map((nombre) =>
  path.join(FIXTURES, nombre),
)

const SUBIDA = /\/storage\/v1\/object\/plant-photos\/.+/

const galeria = (page: Page) =>
  page.getByRole('region', { name: 'Fotos (opcional)' })

interface Caja {
  x: number
  y: number
  width: number
  height: number
}

// Medidas redondeadas al píxel: los motores difieren en los decimales.
async function caja(locator: Locator): Promise<Caja> {
  const medida = await locator.boundingBox()
  expect(medida).not.toBeNull()
  const { x, y, width, height } = medida as Caja
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

function seCortan(a: Caja, b: Caja): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

/**
 * Comprueba cada miniatura con estado: el texto cabe entero en su franja, la
 * franja queda dentro de la miniatura y no se corta con quitar ni con
 * «Principal»; quitar y «Reintentar» miden al menos 44 px.
 */
async function comprobarEstados(page: Page, texto: string | RegExp) {
  const items = galeria(page).locator('.orki-gallery__item')
  const conEstado = items.filter({
    has: page.locator('.orki-gallery__state'),
  })
  await expect(conEstado.first()).toBeVisible()
  const total = await conEstado.count()
  expect(total).toBeGreaterThan(0)
  for (let i = 0; i < total; i++) {
    const item = conEstado.nth(i)
    const estado = item.locator('.orki-gallery__state')
    await expect(estado).toContainText(texto)
    // El texto no se desborda (nada recortado por la miniatura).
    const desborde = await estado.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    )
    expect(desborde).toBeLessThanOrEqual(0)
    const cajaItem = await caja(item)
    const cajaEstado = await caja(estado)
    expect(cajaEstado.x).toBeGreaterThanOrEqual(cajaItem.x)
    expect(cajaEstado.y).toBeGreaterThanOrEqual(cajaItem.y)
    expect(cajaEstado.x + cajaEstado.width).toBeLessThanOrEqual(
      cajaItem.x + cajaItem.width,
    )
    expect(cajaEstado.y + cajaEstado.height).toBeLessThanOrEqual(
      cajaItem.y + cajaItem.height,
    )
    for (const otro of [
      item.locator('.orki-gallery__remove'),
      item.locator('.orki-gallery__badge'),
    ]) {
      if ((await otro.count()) === 0) continue
      expect(seCortan(cajaEstado, await caja(otro))).toBe(false)
    }
    const quitar = item.locator('.orki-gallery__remove')
    if ((await quitar.count()) > 0) {
      const cajaQuitar = await caja(quitar)
      expect(cajaQuitar.width).toBeGreaterThanOrEqual(44)
      expect(cajaQuitar.height).toBeGreaterThanOrEqual(44)
    }
    const reintentar = item.locator('.orki-gallery__retry')
    if ((await reintentar.count()) > 0) {
      const cajaReintentar = await caja(reintentar)
      expect(cajaReintentar.height).toBeGreaterThanOrEqual(44)
      expect(seCortan(cajaReintentar, cajaEstado)).toBe(true)
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  // La preparación de las fotos espera a que la prueba la suelte, para ver
  // «Preparando…» sin depender de cuánto tarda cada navegador.
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window)
    let soltar = () => {}
    const suelta = new Promise<void>((resolve) => {
      soltar = resolve
    })
    Object.assign(window, { soltarPreparacion: () => soltar() })
    window.createImageBitmap = (async (
      ...args: Parameters<typeof createImageBitmap>
    ) => {
      await suelta
      return original(...args)
    }) as typeof createImageBitmap
  })
})

test('a 360 px, cada estado de una foto se lee entero y sin solaparse', async ({
  page,
}) => {
  await page.goto('/coleccion/nueva')
  await page.getByRole('combobox', { name: 'Nombre' }).fill('Phal. amab')
  await page.getByRole('option', { name: 'Phalaenopsis amabilis' }).click()
  // Sin desplazamiento horizontal a 360 px.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  // Preparando…
  const selector = page.waitForEvent('filechooser')
  await galeria(page).getByRole('button', { name: 'Añadir fotos' }).click()
  await (await selector).setFiles(FOTOS)
  await expect(page.locator('.orki-gallery__item--preparing')).toHaveCount(2)
  await comprobarEstados(page, 'Preparando…')
  await page.evaluate(() => {
    ;(
      window as unknown as { soltarPreparacion: () => void }
    ).soltarPreparacion()
  })
  await expect(page.locator('.orki-gallery__item--preparing')).toHaveCount(0)

  // Subiendo…: la subida espera hasta que la prueba la suelte; después falla.
  let soltarSubida = () => {}
  const subidaSuelta = new Promise<void>((resolve) => {
    soltarSubida = resolve
  })
  await page.route(SUBIDA, async (ruta) => {
    if (ruta.request().method() !== 'POST') return ruta.fallback()
    await subidaSuelta
    await ruta.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: '503', message: 'Fallo' }),
    })
  })
  await page.getByRole('button', { name: 'Registrar orquídea' }).click()
  await expect(page.locator('.orki-gallery__item--uploading')).toHaveCount(2)
  await comprobarEstados(page, 'Subiendo…')

  // No se subió, con «Reintentar».
  soltarSubida()
  await expect(page.locator('.orki-gallery__item--error')).toHaveCount(2)
  await expect(
    galeria(page).getByRole('button', { name: 'Reintentar foto principal' }),
  ).toBeVisible()
  await comprobarEstados(page, 'No se subió')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})
