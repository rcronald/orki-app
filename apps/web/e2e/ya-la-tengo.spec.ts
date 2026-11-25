import type { Page } from '@playwright/test'
import { GENEROS, ESPECIES, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'
import {
  ORIGEN_SUPABASE,
  type SupabaseSimulado,
} from './soporte/supabase-simulado.ts'

// «¿Ya la tengo?» en su pantalla (/ya-la-tengo, #209): coincidencia con
// varios ejemplares y «Ver en mi colección», sin coincidencias y registrar con
// ese nombre, un nombre por validar, y la consulta sin conexión con y sin
// copia local. En un celular estrecho (360 px), con axe en cada respuesta; la
// primera, también en escritorio (1440 px).

const campo = (page: Page) =>
  page.getByRole('searchbox', { name: 'Nombre de la orquídea' })
const respuesta = (page: Page, texto: string) =>
  page.getByRole('status').filter({ hasText: texto })

/** Sin desplazamiento horizontal (WCAG 1.4.10). */
async function sinDesplazamientoHorizontal(page: Page) {
  const sobra = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(sobra).toBeLessThanOrEqual(0)
}

/** Espera a que el service worker esté activo y controle la página. */
async function esperarServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true)
}

// La primera respuesta, a los dos anchos.
for (const ancho of [360, 1440]) {
  test.describe(
    `a ${ancho} px`,
    { tag: ancho > 720 ? '@escritorio' : [] },
    () => {
      test.use({ viewport: { width: ancho, height: 900 } })

      test('varios ejemplares: «Sí, la tienes» y «Ver en mi colección»', async ({
        page,
        supabase,
        revisarAccesibilidad,
      }) => {
        // Un segundo ejemplar de Phalaenopsis amabilis.
        supabase.datos.plantas.push({
          ...supabase.datos.plantas[0],
          id: '00000003-0000-4000-8000-000000000099',
          user_id: USUARIO,
          nickname: 'La de la cocina',
          genus_id: GENEROS.phalaenopsis,
          species_id: ESPECIES.phalaenopsisAmabilis,
          acquired_on: '2026-09-30',
        })
        await page.goto('/ya-la-tengo')
        await expect(
          page.getByRole('heading', { name: '¿Ya la tengo?', level: 1 }),
        ).toBeVisible()
        await expect(campo(page)).toBeFocused()
        await expect(page).toHaveTitle('¿Ya la tengo? · orqui.app')

        await campo(page).pressSequentially('Phalaenopsis amabilis')
        await expect(page).toHaveURL(/\/ya-la-tengo\?q=Phalaenopsis\+amabilis$/)
        await expect(respuesta(page, 'Sí, la tienes')).toContainText(
          '2 ejemplares de Phalaenopsis amabilis',
        )
        await sinDesplazamientoHorizontal(page)
        await revisarAccesibilidad(`¿Ya la tengo? sí, ${ancho} px`)

        // Recargar conserva la consulta.
        await page.reload()
        await expect(campo(page)).toHaveValue('Phalaenopsis amabilis')
        await expect(respuesta(page, 'Sí, la tienes')).toBeVisible()

        await page.getByRole('link', { name: 'Ver en mi colección' }).click()
        await expect(page).toHaveURL(/\/coleccion\?q=Phalaenopsis\+amabilis$/)
        await expect(page.getByRole('main').getByRole('article')).toHaveCount(2)
      })
    },
  )
}

// Las demás, solo a 360 px: el ancho solo cambia el diseño (lo mide la de
// arriba), y la lógica de cada respuesta, sin conexión con y sin copia y el
// evento sin el texto están en OwnershipCheckPage.test.tsx.
test.describe('solo a 360 px', () => {
  test.use({ viewport: { width: 360, height: 900 } })

  // Placeholders que caben enteros (#290), con la fuente de cada motor, y la
  // línea de la colección vacía. Las medidas se redondean.
  test('con la colección vacía: el placeholder cabe y una línea lo explica', async ({
    page,
    supabase,
  }) => {
    supabase.datos.plantas.length = 0
    await page.goto('/ya-la-tengo')
    await expect(
      page.getByText('Tu colección aún está vacía', { exact: false }),
    ).toBeVisible()
    // El placeholder como valor, sin eventos: si cabe, el campo no se
    // desplaza (scrollWidth y clientWidth ya son enteros).
    const medida = await campo(page).evaluate((input: HTMLInputElement) => {
      input.value = input.placeholder
      const resultado = {
        texto: input.scrollWidth,
        hueco: input.clientWidth,
      }
      input.value = ''
      return resultado
    })
    expect(medida.texto).toBeLessThanOrEqual(medida.hueco)
  })

  test(
    'sin coincidencias: «Aún no la tienes» y registrarla con ese nombre',
    { tag: '@logica' },
    async ({ page, supabase, revisarAccesibilidad }) => {
      await page.goto('/ya-la-tengo')
      await campo(page).pressSequentially('Vanda coerulea')
      await expect(respuesta(page, 'Aún no la tienes')).toContainText(
        'Vanda coerulea no está en tu colección.',
      )
      await expect(page.getByText('Sin copia disponible')).toHaveCount(0)
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`¿Ya la tengo? no, 360 px`)

      await page
        .getByRole('link', { name: 'Registrarla con este nombre' })
        .click()
      await expect(page).toHaveURL(
        /\/coleccion\/nueva\?nombre=Vanda\+coerulea$/,
      )
      await expect(page.getByRole('combobox', { name: 'Nombre' })).toHaveValue(
        'Vanda coerulea',
      )

      // Al salir de la pantalla cuenta la búsqueda (#146): un evento, con
      // el resultado y sin el texto.
      await expect.poll(() => supabase.eventos.length).toBe(1)
      expect(supabase.eventos[0]).toMatchObject({
        type: 'have_it_search',
        result: 'not_owned',
        generated_offline: false,
      })
      expect(JSON.stringify(supabase.eventos)).not.toMatch(/vanda|coerulea/i)
    },
  )

  test(
    'nombre por validar: cuenta por el nombre ingresado',
    { tag: '@logica' },
    async ({ page, revisarAccesibilidad }) => {
      await page.goto('/ya-la-tengo')
      await campo(page).pressSequentially('sharry baby')
      await expect(respuesta(page, 'Sí, la tienes')).toContainText(
        '1 ejemplar de Oncidium Sharry Baby',
      )
      const ejemplar = page
        .getByRole('list', { name: 'Ejemplares que coinciden' })
        .getByRole('link')
      await expect(ejemplar).toHaveAccessibleName(/Nombre por validar/)
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`¿Ya la tengo? por validar, 360 px`)

      // Un solo ejemplar: su detalle está a un toque.
      await ejemplar.click()
      await expect(
        page.getByRole('heading', { name: 'Oncidium Sharry Baby', level: 1 }),
      ).toBeVisible()
    },
  )

  // Los sinónimos y abreviaturas («extras») se piden aparte, después de las
  // plantas (#243). Mientras faltan, o si fallan, un «no» no es seguro
  // (#274). Una planta por validar de un género cuya abreviatura no es el
  // comienzo del nombre («Blc.»): solo la encuentra la abreviatura, y el
  // catálogo no la rescata (no hay especie).
  test.describe('sinónimos y abreviaturas que faltan (#274)', () => {
    const GENERO_BLC = '00000002-0000-4000-8000-000000000099'

    function conBrassolaeliocattleya(supabase: SupabaseSimulado) {
      supabase.datos.generos.push({
        id: GENERO_BLC,
        name: 'Brassolaeliocattleya',
        is_quick_access: false,
        abreviaturas: ['Blc.'],
      })
      supabase.datos.plantas.push({
        ...supabase.datos.plantas[0],
        id: '00000003-0000-4000-8000-000000000098',
        user_id: USUARIO,
        entered_name: 'Waikiki Gold',
        species_id: null,
        genus_id: GENERO_BLC,
        type: 'hybrid',
        validation: 'pending',
        nickname: null,
      })
    }

    /** Las peticiones de los extras (species_names y genus_abbreviations). */
    const esDeExtras = (url: URL) =>
      url.origin === ORIGEN_SUPABASE &&
      (url.pathname === '/rest/v1/species_names' ||
        url.pathname === '/rest/v1/genus_abbreviations')

    /** Retiene las peticiones de los extras hasta llamar a la función devuelta. */
    async function retenerExtras(page: Page): Promise<() => void> {
      let soltar = () => {}
      const sueltas = new Promise<void>((resolve) => {
        soltar = resolve
      })
      await page.route(esDeExtras, async (route) => {
        await sueltas
        await route.fallback()
      })
      return soltar
    }

    test(
      'retenidos: «Comprobando…» en vez de «Aún no la tienes», y se resuelve solo',
      { tag: '@logica' },
      async ({ page, supabase }) => {
        conBrassolaeliocattleya(supabase)
        const soltar = await retenerExtras(page)
        await page.goto('/ya-la-tengo')
        await campo(page).fill('Blc. Waikiki')
        await expect(
          respuesta(page, 'Comprobando sinónimos y abreviaturas…'),
        ).toBeVisible()
        await expect(page.getByText('Aún no la tienes')).toHaveCount(0)

        soltar()
        await expect(respuesta(page, 'Sí, la tienes')).toContainText(
          '1 ejemplar de Waikiki Gold',
        )
      },
    )

    test(
      'fallidos: lo dice, no afirma que no la tienes y deja reintentar',
      { tag: '@logica' },
      async ({ page, supabase }) => {
        conBrassolaeliocattleya(supabase)
        await page.route(esDeExtras, (route) => route.abort('failed'))
        await page.goto('/ya-la-tengo')
        await campo(page).fill('Blc. Waikiki')
        // postgrest-js reintenta un GET que falla por la red tres veces (1, 2
        // y 4 s) antes de rendirse; mientras tanto, «Comprobando…».
        await expect(
          respuesta(page, 'Comprobando sinónimos y abreviaturas…'),
        ).toBeVisible()
        await expect(
          respuesta(page, 'no pudimos comprobar sinónimos ni abreviaturas'),
        ).toBeVisible({ timeout: 15_000 })
        await expect(page.getByText('Aún no la tienes')).toHaveCount(0)

        // Vuelve la red para esas peticiones: «Reintentar» las pide otra vez.
        await page.unroute(esDeExtras)
        await page.getByRole('button', { name: 'Reintentar' }).click()
        await expect(respuesta(page, 'Sí, la tienes')).toContainText(
          '1 ejemplar de Waikiki Gold',
        )
      },
    )

    // El objetivo de responder en menos de 5 s (#19): una positiva por el
    // nombre aceptado no espera a los extras. Se anota el tiempo con y sin
    // ellos retenidos.
    for (const retenidos of [false, true]) {
      test(
        `por el nombre aceptado, «Sí, la tienes» en menos de 5 s (extras ${retenidos ? 'retenidos' : 'servidos'})`,
        { tag: '@logica' },
        async ({ page }, testInfo) => {
          if (retenidos) await retenerExtras(page)
          await page.goto('/ya-la-tengo')
          await expect(campo(page)).toBeFocused()
          const inicio = Date.now()
          await campo(page).fill('Phalaenopsis amabilis')
          await expect(respuesta(page, 'Sí, la tienes')).toBeVisible()
          const ms = Date.now() - inicio
          testInfo.annotations.push({
            type: 'tiempo hasta la respuesta',
            description: `${ms} ms`,
          })
          expect(ms).toBeLessThan(5_000)
        },
      )
    }
  })

  test.describe('sin conexión', () => {
    // Como en pwa.spec.ts: el service worker sirve la app sin red, y fuera
    // de Chromium Playwright no intercepta las peticiones de una página que
    // él controla (no llegaría el Supabase simulado).
    test.use({ serviceWorkers: 'allow' })

    test('con copia local: responde y dice cuándo se actualizó', async ({
      page,
      context,
      browserName,
      revisarAccesibilidad,
    }) => {
      test.skip(
        browserName !== 'chromium',
        'Playwright solo intercepta la red de una página con service worker en Chromium.',
      )
      // Abrir la colección con conexión guarda la copia local.
      await page.goto('/coleccion')
      await expect(
        page.getByRole('heading', {
          name: 'Phalaenopsis amabilis',
          level: 2,
        }),
      ).toBeVisible()
      await esperarServiceWorker(page)

      await context.setOffline(true)
      await page.goto('/ya-la-tengo')
      await expect(
        page.getByText('Sin conexión', { exact: true }),
      ).toBeVisible()
      await expect(page.getByText(/^Última actualización: hoy/)).toBeVisible()
      await campo(page).fill('nobile')
      await expect(respuesta(page, 'Sí, la tienes')).toContainText(
        '1 ejemplar de Dendrobium nobile',
      )
      await campo(page).fill('Vanda coerulea')
      await expect(respuesta(page, 'Aún no la tienes')).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Registrarla con este nombre' }),
      ).toHaveAttribute('aria-disabled', 'true')
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`¿Ya la tengo? sin conexión, 360 px`)
    })

    test('sin copia: «Sin copia disponible», no «Aún no la tienes»', async ({
      page,
      context,
      browserName,
      revisarAccesibilidad,
    }) => {
      test.skip(
        browserName !== 'chromium',
        'Playwright solo intercepta la red de una página con service worker en Chromium.',
      )
      // Con sesión pero sin abrir la colección: no hay copia guardada.
      await page.goto('/creditos')
      // La barra de la app: Clerk confirmó la sesión y la app recuerda al
      // usuario, que es con quien abrirá sin conexión.
      await expect(
        page.getByRole('navigation', { name: 'Principal' }),
      ).toBeVisible()
      await esperarServiceWorker(page)

      await context.setOffline(true)
      await page.goto('/ya-la-tengo')
      await expect(respuesta(page, 'Sin copia disponible')).toBeVisible()
      await campo(page).fill('Vanda coerulea')
      await expect(respuesta(page, 'Sin copia disponible')).toBeVisible()
      await expect(page.getByText('Aún no la tienes')).toHaveCount(0)
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`¿Ya la tengo? sin copia, 360 px`)
    })
  })
})
