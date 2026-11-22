import { readFile } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './soporte/fixtures.ts'

// «Tu cuenta» (#214): perfil, datos y privacidad, eliminación y cerrar
// sesión, en escritorio y a 360 px (el ancho más estrecho que se soporta),
// con axe. El editor de perfil de Clerk es el del sustituto
// (medicion/clerk-simulado.tsx): marca <body data-perfil-simulado="abierto">
// y, con el evento "orki-perfil-simulado", cambia el nombre como si se
// hubiera guardado en el editor.

async function sinDesplazamientoHorizontal(page: Page) {
  const anchos = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: document.documentElement.clientWidth,
  }))
  expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana)
}

async function alto(control: Locator): Promise<number> {
  return (await control.boundingBox())?.height ?? 0
}

/** Descarga el CSV con `exportar` y devuelve su nombre y su contenido. */
async function descargar(page: Page, exportar: () => Promise<void>) {
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    exportar(),
  ])
  const ruta = await descarga.path()
  return {
    nombre: descarga.suggestedFilename(),
    contenido: await readFile(ruta),
  }
}

for (const ancho of [1440, 360]) {
  test(`a ${ancho} px: perfil, exportar, privacidad, cancelar la eliminación y cerrar sesión`, async ({
    page,
    revisarAccesibilidad,
  }) => {
    // En el celular, la exportación abre la hoja de compartir del sistema si
    // el navegador sabe compartir archivos (inventory/save-file.ts); aquí se
    // fuerza la descarga para poder leer el archivo.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined })
    })
    await page.setViewportSize({ width: ancho, height: 900 })
    // Se llega desde el menú «Tu cuenta» de la barra.
    await page.goto('/coleccion')
    await expect(
      page.getByRole('heading', { name: 'Mi colección', level: 1 }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Tu cuenta' }).click()
    await page.getByRole('menuitem', { name: 'Mi cuenta' }).click()
    await expect(page).toHaveURL(/\/cuenta$/)
    await expect(
      page.getByRole('heading', { name: 'Tu cuenta', level: 1 }),
    ).toBeVisible()

    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { level: 2 })).toHaveText([
      'Perfil',
      'Datos y privacidad',
      'Eliminar cuenta',
    ])
    const perfil = main.getByRole('region', { name: 'Perfil' })
    const datos = main.getByRole('region', { name: 'Datos y privacidad' })
    const exportar = datos.getByRole('button', {
      name: 'Exportar inventario a CSV',
    })
    const privacidad = datos.getByRole('link', { name: 'Aviso de privacidad' })
    const eliminar = main.getByRole('button', { name: 'Eliminar mi cuenta' })
    const editar = perfil.getByRole('button', { name: 'Editar perfil' })
    const cerrar = main.getByRole('button', { name: 'Cerrar sesión' })
    const volver = main.getByRole('link', { name: 'Volver a Mi colección' })

    await expect(perfil.getByText('Persona de Prueba')).toBeVisible()
    await expect(perfil.getByText('persona@orki.invalid')).toBeVisible()
    await expect(exportar).toBeEnabled()
    await expect(exportar).not.toHaveAttribute('aria-disabled')
    await sinDesplazamientoHorizontal(page)
    for (const control of [editar, exportar, privacidad, eliminar, cerrar]) {
      expect(await alto(control)).toBeGreaterThanOrEqual(44)
    }
    // Escritorio: «Editar perfil» al lado de los datos. Móvil: debajo, a todo
    // el ancho, y las filas con el área táctil de todo el panel.
    const cajaEditar = await editar.boundingBox()
    const cajaNombre = await perfil.getByText('Persona de Prueba').boundingBox()
    const cajaFila = await exportar.boundingBox()
    const cajaDatos = await datos.boundingBox()
    if (ancho > 720) {
      expect(cajaEditar?.x ?? 0).toBeGreaterThan(
        (cajaNombre?.x ?? 0) + (cajaNombre?.width ?? 0),
      )
    } else {
      expect(cajaEditar?.y ?? 0).toBeGreaterThan(
        (cajaNombre?.y ?? 0) + (cajaNombre?.height ?? 0),
      )
      expect(cajaEditar?.width ?? 0).toBeGreaterThan(ancho - 100)
    }
    expect(cajaFila?.width ?? 0).toBeGreaterThan((cajaDatos?.width ?? 0) - 60)
    await revisarAccesibilidad(`Tu cuenta a ${ancho} px`)

    // Editar perfil: abre el editor de Clerk y, al guardar, el nombre nuevo
    // se ve sin recargar.
    await editar.click()
    await expect(page.locator('body')).toHaveAttribute(
      'data-perfil-simulado',
      'abierto',
    )
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('orki-perfil-simulado', {
          detail: { nombre: 'Ana López' },
        }),
      ),
    )
    await expect(perfil.getByText('Ana López')).toBeVisible()
    await expect(perfil.locator('.orki-avatar')).toHaveText('AL')

    // Exportar: el mismo archivo que desde «Mi colección».
    const desdeCuenta = await descargar(page, () => exportar.click())
    await expect(datos.getByRole('status')).toContainText('Listo:')
    expect(desdeCuenta.nombre).toMatch(
      /^orqui-apps-inventario-\d{4}-\d{2}-\d{2}\.csv$/,
    )

    // Privacidad, con «Volver a Tu cuenta».
    await privacidad.click()
    await expect(page).toHaveURL(/\/privacidad$/)
    await expect(
      page.getByRole('heading', { name: 'Privacidad', level: 1 }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Volver a Tu cuenta' }).click()
    await expect(page).toHaveURL(/\/cuenta$/)

    // Eliminar: la confirmación se abre y «Cancelar» no borra nada y devuelve
    // el foco al botón.
    // Con el teclado: Safari no da el foco a un botón al pulsarlo con el
    // ratón, así que no habría a dónde devolverlo.
    await eliminar.focus()
    await page.keyboard.press('Enter')
    const dialogo = page.getByRole('dialog', { name: '¿Eliminar tu cuenta?' })
    await expect(dialogo).toBeVisible()
    await expect(
      dialogo.getByRole('button', { name: 'Eliminar mi cuenta para siempre' }),
    ).toBeDisabled()
    await sinDesplazamientoHorizontal(page)
    await revisarAccesibilidad(`confirmación de la eliminación a ${ancho} px`)
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialogo).toBeHidden()
    await expect(eliminar).toBeFocused()
    await expect(perfil.getByText('persona@orki.invalid')).toBeVisible()

    // Volver a Mi colección y descargar desde allí el mismo CSV.
    await volver.click()
    await expect(page).toHaveURL(/\/coleccion$/)
    const desdeColeccion = await descargar(page, () =>
      page.getByRole('button', { name: 'Exportar a CSV' }).click(),
    )
    expect(desdeColeccion.nombre).toBe(desdeCuenta.nombre)
    expect(desdeColeccion.contenido.equals(desdeCuenta.contenido)).toBe(true)
    expect(desdeCuenta.contenido.length).toBeGreaterThan(100)

    // Cerrar sesión, desde la pantalla de cuenta.
    await page.goto('/cuenta')
    await cerrar.click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: 'Tu cuenta' })).toHaveCount(0)
  })
}

test.describe('sin nombre en la cuenta', () => {
  test.use({ sesion: { usuario: 'user_sin_nombre', nombre: null } })

  test('el correo hace de identificación, con el icono de perfil', async ({
    page,
    revisarAccesibilidad,
  }) => {
    await page.goto('/cuenta')
    const perfil = page.getByRole('region', { name: 'Perfil' })
    await expect(perfil.locator('.orki-profile__name')).toHaveText(
      'persona@orki.invalid',
    )
    await expect(perfil.locator('.orki-avatar .lucide-user')).toHaveCount(1)
    await revisarAccesibilidad('Tu cuenta sin nombre')
  })
})
