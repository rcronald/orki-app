import { USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

const TITULO_PORTADA = 'Tu colección de orquídeas, en un solo lugar'

// Acceso (#148): lo que hace la app alrededor de Clerk. Las pantallas de Clerk
// están sustituidas por un botón (apps/web/medicion/clerk-simulado.tsx), así
// que aquí se prueban las rutas protegidas, la vuelta a la página pedida, el
// perfil del primer ingreso, el cierre de sesión y la ruta de administración;
// no el formulario de Clerk.

test.describe('sin sesión', () => {
  test.use({ sesion: { usuario: null } })

  test('el inicio es la portada: ofrece crear la cuenta o entrar, sin chips', async ({
    page,
    revisarAccesibilidad,
  }) => {
    await page.goto('/')
    const portada = page.getByRole('region', { name: TITULO_PORTADA })
    await expect(
      page.getByRole('heading', { name: TITULO_PORTADA, level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Principal' }),
    ).toHaveCount(0)
    await revisarAccesibilidad('inicio sin sesión')

    await portada.getByRole('link', { name: 'Crear cuenta gratis' }).click()
    await expect(page).toHaveURL(/\/registro$/)
    await page.goBack()
    await portada.getByRole('link', { name: 'Iniciar sesión' }).click()
    await expect(page).toHaveURL(/\/iniciar-sesion$/)
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

    // Clerk vuelve al inicio, que con sesión lleva a la colección.
    await expect(page).toHaveURL(/\/coleccion$/)
    await expect(
      page.getByRole('button', { name: 'Cerrar sesión' }),
    ).toBeVisible()
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
  await expect(
    page.getByRole('heading', { name: TITULO_PORTADA, level: 1 }),
  ).toBeVisible()
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
  // Con sesión, el inicio lleva a la colección; sin «Inicio» ni «Catálogo».
  await page.goto('/')
  await expect(page).toHaveURL(/\/coleccion$/)
  const navegacion = page.getByRole('navigation', { name: 'Principal' })
  await expect(navegacion.getByRole('link')).toHaveText(['Mi colección'])
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
