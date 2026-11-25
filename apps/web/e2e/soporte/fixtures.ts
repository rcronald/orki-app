import AxeBuilder from '@axe-core/playwright'
import { test as base, expect } from '@playwright/test'
import { USUARIO } from './datos.ts'
import { ORIGEN_SUPABASE, SupabaseSimulado } from './supabase-simulado.ts'

// Base de todas las pruebas de extremo a extremo (#148).
//
// Cada prueba tiene su propio contexto de navegador (almacenamiento vacío) y su
// propio Supabase simulado con los datos de partida. Además:
//
// - Sesión: la opción `sesion` dice con quién entra la prueba. Se escribe en
//   localStorage antes de que cargue la app, donde la lee el Clerk simulado
//   (apps/web/medicion/clerk-simulado.tsx); después la cambian la propia app
//   (cerrar sesión) o el acceso simulado (entrar).
// - Red cerrada: solo se deja pasar el origen de la app. Supabase se responde
//   desde la memoria (supabase-simulado.ts); Sentry (el DSN ficticio) se
//   responde con un 200 y se anotan los errores que la app le envía. Cualquier
//   otra salida se corta y la prueba falla al terminar, igual que si la app
//   pidió a Supabase algo que el simulado no conoce o informó un error.
// - CSP obligatoria (#282): el servidor la sirve con las cabeceras de Vercel
//   y cualquier violación hace fallar la prueba al terminar.

export const PAUTAS_AA = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
]

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page']

/**
 * La página, con el tipo que espera axe. @axe-core/playwright declara
 * playwright-core como dependencia de pares y npm puede instalarle otra copia
 * (con los mismos tipos, pero distintos para TypeScript) o la misma, según las
 * versiones: pasando por unknown, la conversión vale en los dos casos y ESLint
 * no la da por innecesaria cuando coinciden.
 */
function paraAxe(page: unknown): AxePage {
  return page as AxePage
}

const CLAVE_SESION = 'orki-sesion-simulada'
const ORIGEN_SENTRY = 'https://sentry.orki.invalid'

export interface Sesion {
  usuario: string | null
  rol?: string | null
  /** user.fullName del Clerk simulado; sin la clave, «Persona de Prueba». */
  nombre?: string | null
  /** URL de la foto de la cuenta (del mismo origen); sin ella, sin foto. */
  foto?: string | null
  /**
   * signOut() del Clerk simulado sin la espera de la red: avisa de que ya no
   * hay sesión antes de que el enrutador pinte el destino.
   */
  salidaInmediata?: boolean
}

interface Opciones {
  sesion: Sesion
}

interface Fixtures {
  supabase: SupabaseSimulado
  /**
   * Violaciones de la CSP vistas en la prueba (directiva, lo bloqueado y la
   * página). Si al terminar queda alguna, la prueba falla; una prueba que
   * provoca una a propósito la comprueba y la quita.
   */
  violacionesCsp: string[]
  /** Revisa la pantalla con axe (WCAG 2.2 A y AA) y falla si hay incumplimientos. */
  revisarAccesibilidad: (pantalla: string) => Promise<void>
}

/** Errores que la app intentó enviar a Sentry, a partir de un envelope. */
function erroresDeSentry(cuerpo: string): string[] {
  const errores: string[] = []
  const lineas = cuerpo.split('\n')
  for (let i = 1; i < lineas.length; i += 2) {
    try {
      const cabecera = JSON.parse(lineas[i]) as { type?: string }
      if (cabecera.type !== 'event') continue
      const evento = JSON.parse(lineas[i + 1] ?? '{}') as {
        exception?: { values?: { type?: string; value?: string }[] }
        message?: string
      }
      const excepcion = evento.exception?.values?.at(-1)
      errores.push(
        excepcion
          ? `${excepcion.type ?? 'Error'}: ${excepcion.value ?? ''}`
          : (evento.message ?? 'evento sin mensaje'),
      )
    } catch {
      // Un ítem que no es JSON (adjuntos): no es un error.
    }
  }
  return errores
}

export const test = base.extend<Opciones & Fixtures>({
  sesion: [{ usuario: USUARIO, rol: null }, { option: true }],

  // eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento
  supabase: async ({}, use) => {
    await use(new SupabaseSimulado())
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento
  violacionesCsp: async ({}, use) => {
    await use([])
  },

  context: async (
    { context, baseURL, sesion, supabase, violacionesCsp },
    use,
    testInfo,
  ) => {
    const origenDeLaApp = new URL(baseURL ?? 'http://127.0.0.1').origin
    const salidas: string[] = []
    const erroresInformados: string[] = []

    // Las rutas registradas después tienen prioridad: primero el cierre.
    await context.route('**/*', async (route) => {
      const url = route.request().url()
      // WebKit también pasa por aquí las imágenes en memoria (blob:) que crea
      // la app con URL.createObjectURL: no salen a la red.
      if (
        url.startsWith(`${origenDeLaApp}/`) ||
        url.startsWith(`blob:${origenDeLaApp}/`) ||
        url.startsWith('data:')
      ) {
        await route.continue()
        return
      }
      salidas.push(`${route.request().method()} ${url}`)
      await route.abort('blockedbyclient')
    })
    await context.route(`${ORIGEN_SENTRY}/**`, async (route) => {
      const cuerpo = route.request().postData() ?? ''
      erroresInformados.push(...erroresDeSentry(cuerpo))
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        body: '{}',
      })
    })
    await context.route(`${ORIGEN_SUPABASE}/**`, (route) =>
      supabase.responder(route),
    )

    // CSP (#282): el servidor de las pruebas la sirve como obligatoria
    // (scripts/cabeceras/de-las-pruebas.mjs). Cada violación se anota con la
    // directiva y lo bloqueado, y la prueba falla al terminar.
    await context.exposeBinding(
      '__orkiViolacionCsp',
      (_fuente, texto: string) => {
        violacionesCsp.push(texto)
      },
    )
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (evento) => {
        const avisar = (
          window as unknown as {
            __orkiViolacionCsp?: (texto: string) => Promise<void>
          }
        ).__orkiViolacionCsp
        void avisar?.(
          `${evento.effectiveDirective} bloqueó ${evento.blockedURI || '(en línea)'} en ${location.pathname}` +
            (evento.sourceFile
              ? ` (${evento.sourceFile}:${String(evento.lineNumber)})`
              : ''),
        )
      })
    })

    await context.addInitScript(
      ([clave, valor]) => {
        // Solo la primera vez: al recargar, manda lo que haya dejado la app.
        if (localStorage.getItem(clave) === null) {
          localStorage.setItem(clave, valor)
        }
      },
      [
        CLAVE_SESION,
        JSON.stringify({
          usuario: sesion.usuario,
          rol: sesion.rol ?? null,
          ...(sesion.nombre !== undefined && { nombre: sesion.nombre }),
          ...(sesion.foto != null && { foto: sesion.foto }),
          ...(sesion.salidaInmediata === true && { salidaInmediata: true }),
        }),
      ] as const,
    )

    await use(context)

    // Al terminar: nada salió de lo simulado y la app no informó errores.
    const problemas = [
      ...salidas.map((s) => `Salida a un dominio no simulado: ${s}`),
      ...supabase.sinSimular.map(
        (s) => `Petición a Supabase sin simular: ${s}`,
      ),
      ...erroresInformados.map((e) => `La app informó un error a Sentry: ${e}`),
      ...violacionesCsp.map((v) => `Violación de la CSP: ${v}`),
    ]
    if (problemas.length > 0 && testInfo.status === testInfo.expectedStatus) {
      throw new Error(problemas.join('\n'))
    }
    // Si la prueba ya falló, una violación de la CSP suele ser la causa
    // (lo bloqueado no carga): se adjunta para verla en el informe.
    if (violacionesCsp.length > 0) {
      await testInfo.attach('violaciones-de-la-csp', {
        body: violacionesCsp.join('\n'),
        contentType: 'text/plain',
      })
    }
  },

  revisarAccesibilidad: async ({ page, browserName }, use, testInfo) => {
    await use(async (pantalla) => {
      // axe solo en Chromium (#259): las pautas que comprueba (estructura,
      // nombres, roles, contraste) no dependen del motor, y pasarlo en los
      // demás perfiles repetía lo mismo sobre las mismas pantallas. En
      // Firefox, además, el Firefox de Playwright cerraba la pestaña («Page
      // crashed») mientras axe recorría la página (#170). El diseño que sí
      // cambia con el motor lo miden las propias pruebas.
      if (browserName !== 'chromium') {
        testInfo.annotations.push({
          type: 'accesibilidad',
          description: `axe solo en Chromium: ${pantalla}`,
        })
        return
      }
      await test.step(`Accesibilidad (axe): ${pantalla}`, async () => {
        const resultado = await new AxeBuilder({ page: paraAxe(page) })
          .withTags(PAUTAS_AA)
          .analyze()
        const informe = resultado.violations.map(
          (v) =>
            `${v.id} (${v.impact ?? 'sin impacto'}): ${v.help}\n` +
            v.nodes.map((n) => `  ${n.target.join(' ')}`).join('\n'),
        )
        if (informe.length > 0) {
          await testInfo.attach(`axe-${pantalla}`, {
            body: JSON.stringify(resultado.violations, null, 2),
            contentType: 'application/json',
          })
        }
        expect(informe, `Incumplimientos AA en «${pantalla}»`).toEqual([])
      })
    })
  },
})

export { expect }
