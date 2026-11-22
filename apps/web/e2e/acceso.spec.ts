import { USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Acceso (#148): lo que hace la app alrededor de Clerk. Las pantallas de Clerk
// están sustituidas por un botón (apps/web/medicion/clerk-simulado.tsx), así
// que aquí se prueban las rutas protegidas, la vuelta a la página pedida, el
// perfil del primer ingreso, el cierre de sesión y la ruta de administración;
// no el formulario de Clerk.

test.describe('sin sesión', () => {
  test.use({ sesion: { usuario: null } })

  test('el inicio ofrece entrar o crear la cuenta', async ({
    page,
    revisarAccesibilidad,
  }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Orki', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Iniciar sesión' }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Crear cuenta' })).toBeVisible()
    await revisarAccesibilidad('inicio sin sesión')
  })

  test('una ruta protegida lleva a iniciar sesión y vuelve a ella al entrar', async ({
    page,
    supabase,
    revisarAccesibilidad,
  }) => {
    await page.goto('/coleccion?q=cattleya')
    await expect(page).toHaveURL(
      /\/iniciar-sesion\?redirect_url=%2Fcoleccion%3Fq%3Dcattleya$/,
    )
    await expect(page).toHaveTitle(/Iniciar sesión/)
    await revisarAccesibilidad('iniciar sesión')

    await page
      .getByRole('button', { name: 'Entrar con la cuenta de prueba' })
      .click()

    await expect(page).toHaveURL(/\/coleccion\?q=cattleya$/)
    await expect(
      page.getByRole('heading', { name: 'Mi colección', level: 1 }),
    ).toBeVisible()
    await expect(page.getByRole('searchbox')).toHaveValue('cattleya')
    await expect(
      page.getByRole('heading', { name: 'Cattleya maxima', level: 2 }),
    ).toBeVisible()
    // Primer ingreso: la app crea el perfil con el token de la sesión.
    await expect.poll(() => supabase.perfiles.has(USUARIO)).toBe(true)
  })

  test('crear la cuenta deja la sesión iniciada', async ({
    page,
    revisarAccesibilidad,
  }) => {
    await page.goto('/registro')
    await expect(page).toHaveTitle(/Crear cuenta/)
    await revisarAccesibilidad('crear cuenta')
    await page
      .getByRole('button', { name: 'Crear la cuenta de prueba' })
      .click()

    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.getByRole('button', { name: 'Cerrar sesión' }),
    ).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: 'Mi colección' })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Mi colección', level: 1 }),
    ).toBeVisible()
  })
})

test('cerrar sesión vuelve al inicio y protege de nuevo la colección', async ({
  page,
}) => {
  await page.goto('/coleccion')
  await expect(
    page.getByRole('heading', { name: 'Phalaenopsis amabilis', level: 2 }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Cerrar sesión' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible()
  // La app deja de mostrar la sesión al momento y pide a Clerk que la cierre
  // (PendingSignOut); hasta que Clerk confirma, guarda el cierre pendiente.
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('orki-salida-pendiente')),
    )
    .toBeNull()
  await page.goto('/coleccion')
  await expect(page).toHaveURL(/\/iniciar-sesion\?redirect_url=%2Fcoleccion$/)
})

test('sin el rol de administrador no hay backoffice', async ({
  page,
  revisarAccesibilidad,
}) => {
  await page.goto('/')
  const navegacion = page.getByRole('navigation', { name: 'Principal' })
  await expect(
    navegacion.getByRole('link', { name: 'Mi colección' }),
  ).toBeVisible()
  await expect(
    navegacion.getByRole('link', { name: 'Administración' }),
  ).toHaveCount(0)

  await page.goto('/administracion/catalogo')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /no tienes acceso/i,
  )
  await revisarAccesibilidad('sin acceso al backoffice')
})
