import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { SupabaseSimulado } from './soporte/supabase-simulado.ts'
import { USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Fotos que quedan por subir al registrar (#284): salir mientras suben pide
// confirmación; si se recarga a mitad, la ficha de la planta las ofrece como
// «Fotos pendientes de subir» para subirlas o descartarlas, y el registro
// avisa de ellas con un enlace a esa ficha.
//
// Las subidas se retienen en la red (page.route) hasta que la prueba las
// suelta: así «a mitad de la subida» no depende de tiempos.
//
// La recuperación tras recargar no corre en WebKit: el de Playwright usa un
// perfil efímero, como la navegación privada de Safari, que no guarda Blob en
// IndexedDB (lo mismo que en registro.spec.ts). Allí se comprueba que el aviso
// de salir dice que las fotos se perderían.

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/photos/fixtures',
)
const FOTOS = ['sin-metadatos.jpg', 'sin-metadatos.png'].map((nombre) =>
  path.join(FIXTURES, nombre),
)

const galeria = (page: Page) =>
  page.getByRole('region', { name: 'Fotos (opcional)' })

/** Retiene las subidas al bucket hasta `soltar()`. */
async function retenerSubidas(page: Page) {
  let soltar: () => void = () => undefined
  const sueltas = new Promise<void>((resolve) => {
    soltar = resolve
  })
  let retener = true
  await page.route(/\/storage\/v1\/object\/plant-photos\/.+/, async (ruta) => {
    if (ruta.request().method() === 'POST' && retener) await sueltas
    // Tras recargar, la petición ya no existe: no hay nada que responder.
    await ruta.fallback().catch(() => undefined)
  })
  return {
    soltar: () => {
      retener = false
      soltar()
    },
  }
}

/** Registra una Cattleya maxima con dos fotos y espera a que suban. */
async function registrarConFotos(page: Page, supabase: SupabaseSimulado) {
  const antes = new Set(supabase.plantasDe(USUARIO).map((planta) => planta.id))
  await page.goto('/coleccion/nueva')
  await page.getByRole('combobox', { name: 'Nombre' }).fill('Cattleya max')
  await page.getByRole('option', { name: /^Cattleya maxima/ }).click()
  await expect(page.getByText('Coincidencia en el catálogo')).toBeVisible()
  const selector = page.waitForEvent('filechooser')
  await galeria(page).getByRole('button', { name: 'Elegir fotos' }).click()
  await (await selector).setFiles(FOTOS)
  await expect(page.locator('.orki-gallery__item--preparing')).toHaveCount(0)
  await expect(galeria(page).getByRole('img')).toHaveCount(2)

  await page.getByRole('button', { name: 'Registrar orquídea' }).click()
  await expect(
    page.getByText(/Tu orquídea quedó registrada\. Subiendo las fotos/),
  ).toBeVisible()
  const nueva = supabase
    .plantasDe(USUARIO)
    .find((planta) => !antes.has(planta.id))
  expect(nueva).toBeDefined()
  return nueva?.id ?? ''
}

test('salir mientras suben las fotos pide confirmación; «Seguir aquí» termina el registro', async ({
  page,
  supabase,
  browserName,
  revisarAccesibilidad,
}) => {
  const subidas = await retenerSubidas(page)
  const plantaId = await registrarConFotos(page, supabase)

  // El enlace de volver de la cabecera.
  await page.getByRole('link', { name: 'Volver a Mi colección' }).click()
  const dialogo = page.getByRole('dialog', {
    name: '¿Salir con fotos sin subir?',
  })
  await expect(dialogo).toBeVisible()
  await expect(dialogo).toContainText('Tu orquídea ya quedó registrada')
  // WebKit de Playwright no guarda las fotos en el dispositivo (ver arriba):
  // el aviso lo dice.
  await expect(dialogo).toContainText(
    browserName === 'webkit'
      ? 'si sales, se perderán'
      : 'podrás subirlas desde su ficha',
  )
  const quedarse = dialogo.getByRole('button', { name: 'Seguir aquí' })
  await expect(quedarse).toBeFocused()
  await revisarAccesibilidad('aviso al salir con fotos sin subir')

  await quedarse.click()
  await expect(dialogo).toBeHidden()
  await expect(page).toHaveURL(/\/coleccion\/nueva$/)

  // «Atrás» del navegador también pregunta.
  await page.goBack()
  await expect(dialogo).toBeVisible()
  await dialogo.getByRole('button', { name: 'Seguir aquí' }).click()
  await expect(page).toHaveURL(/\/coleccion\/nueva$/)

  subidas.soltar()
  await expect(page).toHaveURL(/\/coleccion$/)
  expect(supabase.fotosDe(plantaId)).toHaveLength(2)
  // Nada queda pendiente: al volver a la ficha no se ofrece nada.
  await page.goto(`/coleccion/${plantaId}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Cattleya maxima',
  )
  await expect(
    page.getByRole('region', { name: 'Fotos pendientes de subir' }),
  ).toHaveCount(0)
})

test.describe('tras recargar a mitad de la subida', () => {
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'WebKit de Playwright no guarda Blob en IndexedDB',
  )

  test('el registro avisa y la ficha ofrece las fotos y las sube', async ({
    page,
    supabase,
    browserName,
    revisarAccesibilidad,
  }) => {
    const subidas = await retenerSubidas(page)
    const plantaId = await registrarConFotos(page, supabase)
    // Recargar: el navegador pide confirmar (beforeunload) y se acepta.
    const avisos: string[] = []
    page.on('dialog', (dialogo) => {
      avisos.push(dialogo.type())
      void dialogo.accept()
    })
    await page.reload()
    subidas.soltar()
    // Solo se comprueba donde se probó (Firefox no arranca en las máquinas de
    // desarrollo; en el CI basta con que la recarga siga adelante).
    if (browserName === 'chromium') expect(avisos).toEqual(['beforeunload'])

    // El registro vuelve vacío y avisa de las fotos de la planta guardada.
    const enlace = page.getByRole('link', { name: 'Subirlas desde su ficha' })
    await expect(enlace).toBeVisible()
    await expect(enlace).toHaveAccessibleDescription(
      'Quedaron 2 fotos sin subir de Cattleya maxima.',
    )
    expect(supabase.fotosDe(plantaId)).toHaveLength(0)
    await enlace.click()

    await expect(page).toHaveURL(new RegExp(`/coleccion/${plantaId}$`))
    const pendientes = page.getByRole('region', {
      name: 'Fotos pendientes de subir',
    })
    await expect(pendientes).toContainText(
      'Al registrar esta planta, 2 fotos no llegaron a subirse.',
    )
    await expect(
      pendientes
        .getByRole('list', { name: 'Fotos sin subir' })
        .getByRole('img'),
    ).toHaveCount(2)
    await revisarAccesibilidad('ficha con fotos pendientes de subir')

    await pendientes.getByRole('button', { name: 'Subir fotos' }).click()
    const hecho = page.getByText('Se subieron las 2 fotos pendientes.')
    await expect(hecho).toBeVisible()
    await expect(hecho).toBeFocused()
    await expect(pendientes).toHaveCount(0)
    const fotos = supabase.fotosDe(plantaId)
    expect(fotos.map((foto) => foto.position)).toEqual([0, 1])
    for (const foto of fotos) {
      expect(supabase.archivos.has(foto.photo_path)).toBe(true)
      expect(supabase.archivos.has(foto.thumbnail_path)).toBe(true)
    }
    // La galería de la ficha ya las muestra, sin recargar.
    await expect(page.getByLabel(/^Foto 2 de 2/).first()).toBeVisible()

    // Al volver al registro, ya no hay aviso.
    await page.goto('/coleccion/nueva')
    await expect(page.getByRole('combobox', { name: 'Nombre' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Subirlas desde su ficha' }),
    ).toHaveCount(0)
  })

  test('descartarlas pide confirmación y no sube nada', async ({
    page,
    supabase,
  }) => {
    const subidas = await retenerSubidas(page)
    const plantaId = await registrarConFotos(page, supabase)
    page.on('dialog', (dialogo) => void dialogo.accept())
    await page.goto(`/coleccion/${plantaId}`)
    subidas.soltar()

    const pendientes = page.getByRole('region', {
      name: 'Fotos pendientes de subir',
    })
    await pendientes.getByRole('button', { name: 'Descartar fotos' }).click()
    const dialogo = page.getByRole('dialog', {
      name: '¿Descartar las fotos sin subir?',
    })
    await expect(
      dialogo.getByRole('button', { name: 'Conservarlas' }),
    ).toBeFocused()
    await dialogo.getByRole('button', { name: 'Descartar fotos' }).click()

    const hecho = page.getByText('Descartaste las fotos sin subir.')
    await expect(hecho).toBeFocused()
    await expect(pendientes).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Cattleya maxima',
    )
    await expect(
      page.getByRole('region', { name: 'Fotos pendientes de subir' }),
    ).toHaveCount(0)
    expect(supabase.fotosDe(plantaId)).toHaveLength(0)
  })
})
