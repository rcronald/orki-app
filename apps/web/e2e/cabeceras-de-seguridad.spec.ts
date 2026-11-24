import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESPECIES, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Cabeceras de seguridad y CSP (#282). El servidor de las pruebas sirve la app
// con las cabeceras firmes de vercel.json y la CSP del middleware de Vercel
// como obligatoria, generada por apps/web/seguridad/politica.ts con las
// variables ficticias del build (scripts/cabeceras/de-las-pruebas.mjs). La
// fixture `violacionesCsp` anota cada violación y hace fallar cualquier
// prueba que la tenga; esta recorre de punta a punta los flujos que cargan de
// otros orígenes o crean imágenes en memoria.

const FOTO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/photos/fixtures/sin-metadatos.jpg',
)

const TITULO_PORTADA = 'Tu colección de orquídeas, en un solo lugar'

test('la página lleva la CSP obligatoria y las cabeceras firmes; los archivos con hash, sin CSP', async ({
  page,
}) => {
  const respuesta = await page.goto('/')
  const cabeceras = respuesta?.headers() ?? {}
  expect(cabeceras['content-security-policy']).toMatch(
    /^default-src 'self'; script-src 'self' 'sha256-/,
  )
  expect(cabeceras['content-security-policy']).toContain(
    "frame-ancestors 'none'",
  )
  expect(cabeceras['content-security-policy-report-only']).toBeUndefined()
  expect(cabeceras).toMatchObject({
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin-allow-popups',
  })
  expect(cabeceras['permissions-policy']).toContain('camera=(self)')

  const script = await page
    .locator('script[type="module"][src^="/assets/"]')
    .getAttribute('src')
  const archivo = await page.request.get(script ?? '')
  expect(archivo.headers()['content-security-policy']).toBeUndefined()
  expect(archivo.headers()['x-content-type-options']).toBe('nosniff')
})

test('la CSP bloquea un script en línea que no está en la lista', async ({
  page,
  violacionesCsp,
}) => {
  await page.goto('/catalogo')
  await expect(
    page.getByRole('heading', { name: 'Catálogo', level: 1 }),
  ).toBeVisible()
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.orkiInyectado = true'
    document.head.append(script)
  })
  await expect.poll(() => violacionesCsp.length).toBe(1)
  expect(violacionesCsp[0]).toMatch(/^script-src(-elem)? bloqueó/)
  expect(
    await page.evaluate(
      () => (window as { orkiInyectado?: boolean }).orkiInyectado,
    ),
  ).toBeUndefined()
  // Provocada a propósito: no hace fallar la prueba.
  violacionesCsp.length = 0
})

test.describe('recorrido sin violaciones', () => {
  test.use({ sesion: { usuario: null } })

  test('portada, catálogo, acceso, colección, registro con foto y ficha', async ({
    page,
    supabase,
    violacionesCsp,
  }) => {
    // Lo que algún motor solo dice en la consola.
    const avisos: string[] = []
    page.on('console', (mensaje) => {
      if (/Content[- ]Security[- ]Policy/i.test(mensaje.text())) {
        avisos.push(mensaje.text())
      }
    })

    await test.step('portada prerrenderada', async () => {
      await page.goto('/')
      await expect(
        page.getByRole('heading', { name: TITULO_PORTADA, level: 1 }),
      ).toBeVisible()
      // La foto de la portada cargó (su precarga la pide el script en línea).
      const foto = page.getByRole('img', {
        name: 'Phalaenopsis rosada en floración',
      })
      await expect(foto).toBeVisible()
      await expect
        .poll(() =>
          foto.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth,
          ),
        )
        .toBeGreaterThan(0)
    })

    await test.step('catálogo público y ficha de una especie', async () => {
      await page.goto('/catalogo')
      await page
        .getByRole('navigation', { name: 'Géneros por letra' })
        .getByRole('link', { name: 'P' })
        .click()
      await page.getByRole('link', { name: /Phalaenopsis/ }).click()
      await page.getByRole('link', { name: /Phalaenopsis amabilis/ }).click()
      await expect(
        page.getByRole('heading', { name: 'Phalaenopsis amabilis', level: 1 }),
      ).toBeVisible()
    })

    await test.step('acceso: iniciar sesión vuelve a la colección', async () => {
      await page.goto('/coleccion')
      await expect(page).toHaveURL(/\/iniciar-sesion\?redirect_url=/)
      await page
        .getByRole('button', { name: 'Entrar con la cuenta de prueba' })
        .click()
      await expect(
        page.getByRole('heading', { name: 'Mi colección', level: 1 }),
      ).toBeVisible()
    })

    let planta = ''
    await test.step('registro con una foto', async () => {
      await page.getByRole('link', { name: 'Registrar orquídea' }).click()
      await page.getByRole('combobox', { name: 'Nombre' }).fill('Cattleya max')
      await page.getByRole('option', { name: /^Cattleya maxima/ }).click()
      const galeria = page.getByRole('region', { name: 'Fotos (opcional)' })
      const selector = page.waitForEvent('filechooser')
      await galeria.getByRole('button', { name: 'Elegir fotos' }).click()
      await (await selector).setFiles([FOTO])
      await expect(page.locator('.orki-gallery__item--preparing')).toHaveCount(
        0,
      )
      // La vista previa de la foto preparada es una imagen en memoria.
      await expect(
        galeria.getByRole('img', { name: 'Foto principal' }),
      ).toHaveAttribute('src', /^blob:/)
      await page.getByRole('button', { name: 'Registrar orquídea' }).click()
      await expect(page).toHaveURL(/\/coleccion$/)
      planta =
        supabase
          .plantasDe(USUARIO)
          .find(
            (p) =>
              p.species_id === ESPECIES.cattleyaMaxima && p.photo_path !== null,
          )?.id ?? ''
      expect(planta).not.toBe('')
    })

    await test.step('ficha de la planta con su foto', async () => {
      await page.goto(`/coleccion/${planta}`)
      await expect(
        page.getByRole('heading', { name: 'Cattleya maxima', level: 1 }),
      ).toBeVisible()
      await expect(
        page.getByRole('img', { name: 'Foto principal de Cattleya maxima' }),
      ).toHaveAttribute('src', /^blob:/)
    })

    expect(violacionesCsp).toEqual([])
    expect(avisos).toEqual([])
  })
})
