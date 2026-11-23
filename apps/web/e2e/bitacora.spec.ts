import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'
import type {
  RegistroDeBitacora,
  SupabaseSimulado,
} from './soporte/supabase-simulado.ts'

// Bitácora del ejemplar (#267, maquetas «Ficha de la planta» y «Nuevo
// registro de bitácora» del #263): la lista con su filtro y «Cargar más»,
// «Añadir registro» con y sin foto, el reintento sin duplicados, cancelar
// sin dejar archivos, eliminar un registro, sin conexión, el diálogo con el
// teclado y a pantalla completa en el celular, y la eliminación de la
// planta con las fotos de su bitácora. Con el Supabase simulado de cada
// prueba (datos descartables).

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FOTO = readFileSync(
  path.join(RAIZ, 'src/photos/fixtures/sin-metadatos.webp'),
)
const FOTO_JPG = path.join(RAIZ, 'src/photos/fixtures/sin-metadatos.jpg')

const PLANTA = PLANTAS.maxima
const CARPETA_LOG = `${USUARIO}/${PLANTA}/log/`
const ficha = `/coleccion/${PLANTA}`

// Antes del reloj del simulado (21 de noviembre): lo que guarde la app en la
// prueba es siempre más reciente.
let reloj = Date.parse('2026-11-20T10:00:00.000Z')

/** Un registro guardado directamente en el simulado (el más nuevo, el último). */
function registro(
  supabase: SupabaseSimulado,
  datos: Partial<RegistroDeBitacora> = {},
): RegistroDeBitacora {
  reloj += 60_000
  const fila: RegistroDeBitacora = {
    id: crypto.randomUUID(),
    plant_id: PLANTA,
    user_id: USUARIO,
    type: 'watering',
    title: 'Riego',
    description: null,
    photo_path: null,
    thumbnail_path: null,
    in_bloom: null,
    idempotency_key: null,
    created_at: new Date(reloj).toISOString().replace('Z', '123+00:00'),
    ...datos,
  }
  supabase.registros.push(fila)
  return fila
}

/** Un registro con su foto y su miniatura en log/. */
function registroConFoto(
  supabase: SupabaseSimulado,
  datos: Partial<RegistroDeBitacora> = {},
) {
  const version = crypto.randomUUID()
  const foto = `${CARPETA_LOG}photo-${version}.webp`
  const miniatura = `${CARPETA_LOG}thumb-${version}.webp`
  for (const ruta of [foto, miniatura]) {
    supabase.archivos.set(ruta, { tipo: 'image/webp', bytes: FOTO })
  }
  return registro(supabase, {
    photo_path: foto,
    thumbnail_path: miniatura,
    ...datos,
  })
}

const archivosDeLaBitacora = (supabase: SupabaseSimulado) =>
  [...supabase.archivos.keys()].filter((ruta) => ruta.startsWith(CARPETA_LOG))

const bitacora = (page: Page) =>
  page.getByRole('region', { name: 'Bitácora', exact: true })
const lista = (page: Page) =>
  page.getByRole('list', { name: 'Registros de la bitácora' })
const titulos = (page: Page) => lista(page).getByRole('heading', { level: 3 })
const anadir = (page: Page) =>
  page.getByRole('button', { name: 'Añadir registro' })
const filtro = (page: Page) =>
  page.getByRole('combobox', { name: 'Filtrar por actividad' })
const dialogo = (page: Page) =>
  page.getByRole('dialog', { name: /^Nuevo registro de bitácora/ })
const estado = (page: Page) => bitacora(page).getByRole('status')

/** Abre «Nuevo registro de bitácora» con el teclado. */
async function abrir(page: Page) {
  await anadir(page).focus()
  await page.keyboard.press('Enter')
  await expect(dialogo(page)).toBeVisible()
  await expect(
    dialogo(page).getByRole('radio', { name: 'Riego' }),
  ).toBeFocused()
}

/** Rellena el tipo y el título (y la descripción si se da). */
async function rellenar(
  page: Page,
  tipo: string,
  titulo: string,
  descripcion?: string,
) {
  await dialogo(page).getByText(tipo, { exact: true }).click()
  await dialogo(page).getByRole('textbox', { name: 'Título' }).fill(titulo)
  if (descripcion !== undefined) {
    await dialogo(page)
      .getByRole('textbox', { name: 'Descripción (opcional)' })
      .fill(descripcion)
  }
}

async function elegirFoto(page: Page) {
  const selector = page.waitForEvent('filechooser')
  await dialogo(page).getByRole('button', { name: 'Añadir foto' }).click()
  await (await selector).setFiles(FOTO_JPG)
  await expect(
    dialogo(page).getByRole('button', { name: 'Quitar foto' }),
  ).toBeVisible()
}

const guardar = (page: Page) =>
  dialogo(page).getByRole('button', { name: 'Guardar registro' })

/** Sin desplazamiento horizontal (medidas redondeadas). */
async function sinDesplazamientoHorizontal(page: Page) {
  const { ancho, visible } = await page.evaluate(() => ({
    ancho: Math.round(document.documentElement.scrollWidth),
    visible: Math.round(document.documentElement.clientWidth),
  }))
  expect(ancho).toBeLessThanOrEqual(visible)
}

async function caja(elemento: Locator) {
  const medida = await elemento.boundingBox()
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
  test(
    `a ${String(ancho)} px: la bitácora y el diálogo sin desbordes y con axe`,
    { tag: escritorio ? '@escritorio' : [] },
    async ({ page, supabase, revisarAccesibilidad }) => {
      await page.setViewportSize({ width: ancho, height: alto })
      registro(supabase, {
        title: 'Riego por inmersión',
        description: 'Diez minutos en agua de lluvia y escurrido completo.',
      })
      registroConFoto(supabase, {
        type: 'preventive_health',
        title: 'Revisión de hojas y raíces, sin plagas a la vista',
        in_bloom: false,
      })
      await page.goto(ficha)
      await expect(titulos(page)).toHaveText([
        'Revisión de hojas y raíces, sin plagas a la vista',
        'Riego por inmersión',
      ])
      const [revision] = await lista(page).getByRole('article').all()
      if (!revision) throw new Error('Sin registros')
      await expect(revision.getByText('Sanidad preventiva')).toBeVisible()
      await expect(revision.getByText('Floración observada: no')).toBeVisible()
      await expect(revision.locator('time')).toHaveText(
        /^20 nov 2026, \d{1,2}:\d{2}$/,
      )
      // La miniatura se pide al acercarse a la pantalla.
      await revision.scrollIntoViewIfNeeded()
      await expect(revision.locator('img')).toHaveAttribute('src', /^blob:/)
      // La fecha: a la derecha en escritorio; debajo del texto en el celular.
      const fecha = await caja(revision.locator('time'))
      const titulo = await caja(revision.getByRole('heading'))
      if (escritorio) expect(fecha.x).toBeGreaterThan(titulo.x + titulo.ancho)
      else expect(fecha.y).toBeGreaterThan(titulo.y)
      // La papelera mide 44 × 44.
      const papelera = await caja(
        revision.getByRole('button', { name: /^Eliminar el registro/ }),
      )
      expect(papelera.ancho).toBeGreaterThanOrEqual(44)
      expect(papelera.alto).toBeGreaterThanOrEqual(44)
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`bitácora a ${String(ancho)} px`)

      await abrir(page)
      await expect(dialogo(page)).toContainText('CAT-002')
      const panel = await caja(dialogo(page))
      if (escritorio) {
        // Diálogo centrado, de 560 px como mucho.
        expect(panel.ancho).toBeLessThanOrEqual(560)
        expect(panel.x).toBeGreaterThan(0)
        await expect(
          dialogo(page).getByRole('button', { name: 'Cerrar' }),
        ).toBeVisible()
      } else {
        // Pantalla completa, con «Volver a la ficha» arriba.
        expect(panel).toMatchObject({ x: 0, y: 0, ancho, alto })
        await expect(
          dialogo(page).getByRole('button', { name: 'Volver a la ficha' }),
        ).toBeVisible()
      }
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`diálogo a ${String(ancho)} px`)
      await guardar(page).click()
      await expect(
        dialogo(page).getByText('Elige el tipo de actividad.'),
      ).toBeVisible()
      await revisarAccesibilidad(`diálogo con errores a ${String(ancho)} px`)
    },
  )
}

test(
  'crear sin foto: arriba de la lista, con la floración, sin tocar el estado de la planta',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    registro(supabase, { title: 'Anterior' })
    const antes = supabase.plantasDe(USUARIO).find((p) => p.id === PLANTA)
    const fotosAntes = JSON.stringify(supabase.fotosDe(PLANTA))
    await page.goto(ficha)
    await expect(titulos(page)).toHaveText(['Anterior'])

    await abrir(page)
    await rellenar(
      page,
      'Nutrición',
      'Abono equilibrado',
      'Media dosis, disuelto en el agua de riego.',
    )
    await dialogo(page).getByText('Sí', { exact: true }).click()
    await guardar(page).click()

    await expect(dialogo(page)).toHaveCount(0)
    await expect(titulos(page)).toHaveText(['Abono equilibrado', 'Anterior'])
    await expect(anadir(page)).toBeFocused()
    await expect(estado(page)).toHaveText(
      'Guardaste el registro «Abono equilibrado».',
    )
    await expect(lista(page).getByText('Floración observada: sí')).toBeVisible()

    const [nuevo] = supabase.registrosDe(PLANTA)
    expect(nuevo).toMatchObject({
      type: 'nutrition',
      title: 'Abono equilibrado',
      description: 'Media dosis, disuelto en el agua de riego.',
      in_bloom: true,
      photo_path: null,
    })
    expect(nuevo?.idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
    // La floración observada no cambia el estado de la planta ni sus fotos.
    const despues = supabase.plantasDe(USUARIO).find((p) => p.id === PLANTA)
    expect(despues?.status).toBe(antes?.status)
    expect(despues?.photo_in_bloom).toBe(antes?.photo_in_bloom)
    expect(despues?.updated_at).toBe(antes?.updated_at)
    expect(JSON.stringify(supabase.fotosDe(PLANTA))).toBe(fotosAntes)
  },
)

test('crear con foto: una foto y su miniatura en log/, que no cuentan en la galería', async ({
  page,
  supabase,
}) => {
  await page.goto(ficha)
  await expect(page.getByText('Aún no hay registros')).toBeVisible()
  await abrir(page)
  await rellenar(page, 'Sanidad preventiva', 'Revisión de hojas')
  await elegirFoto(page)
  await expect(
    dialogo(page).getByRole('img', { name: 'Foto elegida' }),
  ).toHaveAttribute('src', /^blob:/)
  await guardar(page).click()
  await expect(dialogo(page)).toHaveCount(0)

  const [nuevo] = supabase.registrosDe(PLANTA)
  const archivos = archivosDeLaBitacora(supabase)
  expect(archivos.sort()).toEqual(
    [nuevo?.photo_path, nuevo?.thumbnail_path].sort(),
  )
  expect(supabase.fotosDe(PLANTA)).toHaveLength(0)
  const miniatura = lista(page).getByRole('button', {
    name: 'Ver en grande la foto del registro «Revisión de hojas»',
  })
  await expect(miniatura.locator('img')).toHaveAttribute('src', /^blob:/)
  // Se abre en grande con el visor y vuelve a la miniatura. Con el teclado:
  // en Safari un clic no da el foco al botón.
  await miniatura.focus()
  await page.keyboard.press('Enter')
  const visor = page.getByRole('dialog', {
    name: 'Foto del registro «Revisión de hojas»',
  })
  await expect(visor.getByRole('img')).toHaveAttribute('src', /^blob:/)
  await page.keyboard.press('Escape')
  await expect(visor).toHaveCount(0)
  await expect(miniatura).toBeFocused()
})

test(
  'orden y filtros: filtro sin resultados y la entrada nueva se ve aunque el filtro la escondería',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    registro(supabase, { title: 'Riego 1' })
    registro(supabase, { type: 'nutrition', title: 'Abono' })
    registro(supabase, { title: 'Riego 2' })
    await page.goto(ficha)
    await expect(titulos(page)).toHaveText(['Riego 2', 'Abono', 'Riego 1'])

    await filtro(page).selectOption({ label: 'Riego' })
    await expect(titulos(page)).toHaveText(['Riego 2', 'Riego 1'])
    await filtro(page).selectOption({ label: 'Mantenimiento preventivo' })
    await expect(
      bitacora(page).getByText('No hay registros de Mantenimiento preventivo.'),
    ).toBeVisible()
    await bitacora(page).getByRole('button', { name: 'Ver todas' }).click()
    await expect(titulos(page)).toHaveText(['Riego 2', 'Abono', 'Riego 1'])
    await expect(filtro(page)).toBeFocused()

    // Con el filtro «Nutrición», se guarda un riego: el filtro se quita.
    await filtro(page).selectOption({ label: 'Nutrición' })
    await expect(titulos(page)).toHaveText(['Abono'])
    await abrir(page)
    await rellenar(page, 'Riego', 'Riego nuevo')
    await guardar(page).click()
    await expect(titulos(page)).toHaveText([
      'Riego nuevo',
      'Riego 2',
      'Abono',
      'Riego 1',
    ])
    await expect(filtro(page)).toHaveValue('')
    await expect(estado(page)).toHaveText(
      'Guardaste el registro «Riego nuevo». Quitamos el filtro «Nutrición» para mostrarlo arriba.',
    )
  },
)

test(
  '«Cargar más» trae los más antiguos con el cursor',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    for (let n = 1; n <= 23; n += 1) {
      registro(supabase, { title: `Registro ${String(n)}` })
    }
    await page.goto(ficha)
    await expect(titulos(page)).toHaveCount(20)
    await expect(titulos(page).first()).toHaveText('Registro 23')
    await bitacora(page).getByRole('button', { name: 'Cargar más' }).click()
    await expect(titulos(page)).toHaveCount(23)
    await expect(titulos(page).last()).toHaveText('Registro 1')
    await expect(
      bitacora(page).getByRole('button', { name: 'Cargar más' }),
    ).toHaveCount(0)
    await expect(
      lista(page).getByRole('article', { name: 'Registro 3' }),
    ).toBeFocused()
  },
)

test(
  'un reintento tras perder la respuesta no duplica: una fila y un par de archivos',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    // El primer intento se guarda, pero la respuesta es un error.
    supabase.fallosDeBitacora.push({ operacion: 'alta', cuando: 'despues' })
    await page.goto(ficha)
    await abrir(page)
    await rellenar(page, 'Riego', 'Riego por inmersión', 'Diez minutos.')
    await elegirFoto(page)
    await guardar(page).click()

    await expect(dialogo(page).getByRole('alert')).toContainText(
      'No se guardó el registro',
    )
    // Lo escrito y la foto siguen ahí.
    await expect(
      dialogo(page).getByRole('textbox', { name: 'Título' }),
    ).toHaveValue('Riego por inmersión')
    await expect(
      dialogo(page).getByRole('img', { name: 'Foto elegida' }),
    ).toBeVisible()
    expect(supabase.registros).toHaveLength(1)

    await guardar(page).click()
    await expect(dialogo(page)).toHaveCount(0)
    await expect(titulos(page)).toHaveText(['Riego por inmersión'])
    expect(supabase.registros).toHaveLength(1)
    expect(archivosDeLaBitacora(supabase)).toHaveLength(2)
  },
)

test(
  'si el registro falla con seguridad, la foto subida se borra; cancelar no deja archivos',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    supabase.fallosDeBitacora.push({
      operacion: 'alta',
      cuando: 'antes',
      status: 400,
    })
    await page.goto(ficha)
    await abrir(page)
    await rellenar(page, 'Riego', 'Riego')
    await elegirFoto(page)
    await guardar(page).click()
    await expect(dialogo(page).getByRole('alert')).toBeVisible()
    await expect.poll(() => archivosDeLaBitacora(supabase)).toEqual([])

    await dialogo(page).getByRole('button', { name: 'Cancelar' }).click()
    const aviso = page.getByRole('dialog', {
      name: '¿Descartar este registro?',
    })
    await expect(
      aviso.getByRole('button', { name: 'Seguir escribiendo' }),
    ).toBeFocused()
    await aviso.getByRole('button', { name: 'Descartar' }).click()
    await expect(dialogo(page)).toHaveCount(0)
    await expect(anadir(page)).toBeFocused()
    expect(supabase.registros).toHaveLength(0)
    expect(archivosDeLaBitacora(supabase)).toEqual([])
  },
)

test('el diálogo con el teclado: foco al abrir, validación, Escape y foco de vuelta', async ({
  page,
}) => {
  await page.goto(ficha)
  await abrir(page)
  // Las flechas cambian el tipo (grupo de opción única).
  await page.keyboard.press('Space')
  await expect(
    dialogo(page).getByRole('radio', { name: 'Riego' }),
  ).toBeChecked()
  await page.keyboard.press('ArrowRight')
  await expect(
    dialogo(page).getByRole('radio', { name: 'Nutrición' }),
  ).toBeChecked()
  // Sin título: el foco va al título, con su error.
  await guardar(page).focus()
  await page.keyboard.press('Enter')
  const titulo = dialogo(page).getByRole('textbox', { name: 'Título' })
  await expect(titulo).toBeFocused()
  await expect(titulo).toHaveAttribute('aria-invalid', 'true')
  // Con algo elegido, Escape pregunta; «Seguir escribiendo» vuelve.
  await page.keyboard.press('Escape')
  const aviso = page.getByRole('dialog', { name: '¿Descartar este registro?' })
  await expect(aviso).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(aviso).toHaveCount(0)
  await expect(dialogo(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await aviso.getByRole('button', { name: 'Descartar' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialogo(page)).toHaveCount(0)
  await expect(anadir(page)).toBeFocused()

  // Sin nada escrito, Escape cierra sin preguntar.
  await abrir(page)
  await page.keyboard.press('Escape')
  await expect(dialogo(page)).toHaveCount(0)
  await expect(anadir(page)).toBeFocused()
})

test('celular con el teclado abierto: las acciones se alcanzan y el foco no queda tapado', async ({
  page,
}) => {
  // El teclado del celular deja visible solo la parte de arriba: una
  // ventana baja lo simula.
  await page.setViewportSize({ width: 390, height: 420 })
  await page.goto(ficha)
  await abrir(page)
  const panel = await caja(dialogo(page))
  expect(panel).toMatchObject({ x: 0, y: 0, ancho: 390, alto: 420 })
  // Dentro del diálogo nada queda fijo al desplazarlo.
  const fijos = await dialogo(page).evaluate(
    (caja) =>
      [...caja.querySelectorAll('*')].filter((el) =>
        ['fixed', 'sticky'].includes(getComputedStyle(el).position),
      ).length,
  )
  expect(fijos).toBe(0)
  const titulo = dialogo(page).getByRole('textbox', { name: 'Título' })
  await titulo.focus()
  await titulo.fill('Riego')
  for (const control of [
    dialogo(page).getByRole('textbox', { name: 'Descripción (opcional)' }),
    guardar(page),
  ]) {
    await control.focus()
    await expect
      .poll(() =>
        control.evaluate((el) => {
          const r = el.getBoundingClientRect()
          const visible =
            Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)
          return Math.round((visible / r.height) * 10) / 10
        }),
      )
      .toBeGreaterThanOrEqual(0.5)
  }
})

test.describe('eliminar un registro', () => {
  test(
    'con foto: confirma, borra la fila y sus archivos, y el foco pasa al siguiente',
    { tag: '@logica' },
    async ({ page, supabase }) => {
      registro(supabase, { title: 'Primero' })
      registroConFoto(supabase, { title: 'Con foto' })
      registro(supabase, { title: 'Último' })
      await page.goto(ficha)
      await expect(titulos(page)).toHaveText(['Último', 'Con foto', 'Primero'])
      await lista(page)
        .getByRole('button', { name: 'Eliminar el registro «Con foto»' })
        .click()
      const confirmar = page.getByRole('dialog', {
        name: '¿Eliminar este registro?',
      })
      await expect(confirmar).toContainText(
        'Se borrará «Con foto» de la bitácora, con su foto. No se puede deshacer.',
      )
      await expect(
        confirmar.getByRole('button', { name: 'Cancelar' }),
      ).toBeFocused()
      await confirmar.getByRole('button', { name: 'Eliminar registro' }).click()
      await expect(titulos(page)).toHaveText(['Último', 'Primero'])
      await expect(
        lista(page).getByRole('article', { name: 'Primero' }),
      ).toBeFocused()
      await expect(estado(page)).toHaveText(
        'Eliminaste el registro «Con foto».',
      )
      expect(supabase.registros.map((r) => r.title).sort()).toEqual([
        'Primero',
        'Último',
      ])
      expect(archivosDeLaBitacora(supabase)).toEqual([])
    },
  )

  test(
    'sin foto, cancelar, y un fallo con reintento',
    { tag: '@logica' },
    async ({ page, supabase }) => {
      registro(supabase, { title: 'Único' })
      await page.goto(ficha)
      const papelera = lista(page).getByRole('button', {
        name: 'Eliminar el registro «Único»',
      })
      // Cancelar no borra nada. Con el teclado: en Safari un clic no da el
      // foco al botón, y es al que vuelve.
      await papelera.focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('Escape')
      await expect(papelera).toBeFocused()
      expect(supabase.registros).toHaveLength(1)

      // Un fallo: se dice en la confirmación y se reintenta.
      supabase.fallosDeBitacora.push({ operacion: 'borrado', cuando: 'antes' })
      await papelera.click()
      const confirmar = page.getByRole('dialog', {
        name: '¿Eliminar este registro?',
      })
      await expect(confirmar).toContainText('No se puede deshacer.')
      await expect(confirmar).not.toContainText('con su foto')
      await confirmar.getByRole('button', { name: 'Eliminar registro' }).click()
      await expect(confirmar.getByRole('alert')).toContainText(
        'No se eliminó el registro',
      )
      expect(supabase.registros).toHaveLength(1)
      await confirmar.getByRole('button', { name: 'Eliminar registro' }).click()
      await expect(page.getByText('Aún no hay registros')).toBeVisible()
      await expect(anadir(page)).toBeFocused()
      expect(supabase.registros).toHaveLength(0)
    },
  )
})

test('sin conexión: lo dice, no guarda en el dispositivo y no deja añadir ni eliminar', async ({
  page,
  context,
  supabase,
  revisarAccesibilidad,
}) => {
  registro(supabase, { title: 'Riego por inmersión' })
  await page.goto(ficha)
  await expect(titulos(page)).toHaveText(['Riego por inmersión'])

  const cortar = (route: { abort: (code: string) => Promise<void> }) =>
    route.abort('internetdisconnected')
  await context.route('https://supabase.orki.invalid/**', cortar)
  await context.setOffline(true)

  const motivo =
    'Sin conexión: la bitácora no se guarda en este dispositivo. Para verla, añadir o eliminar registros hace falta conexión.'
  await expect(bitacora(page).getByText(motivo)).toBeVisible()
  // Lo ya leído se sigue viendo.
  await expect(titulos(page)).toHaveText(['Riego por inmersión'])
  const papelera = lista(page).getByRole('button', {
    name: 'Eliminar el registro «Riego por inmersión»',
  })
  for (const control of [anadir(page), papelera]) {
    await expect(control).toHaveAttribute('aria-disabled', 'true')
    await expect(control).toHaveAccessibleDescription(motivo)
  }
  // Con el teclado (un clic sintético tumbaba Firefox): no abre nada.
  await anadir(page).focus()
  await page.keyboard.press('Enter')
  await papelera.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await revisarAccesibilidad('bitácora sin conexión')

  // Al volver la conexión, se puede añadir.
  await context.unroute('https://supabase.orki.invalid/**', cortar)
  await context.setOffline(false)
  await expect(anadir(page)).not.toHaveAttribute('aria-disabled')
})

test(
  'eliminar la planta borra también las fotos de su bitácora',
  { tag: '@logica' },
  async ({ page, supabase }) => {
    registroConFoto(supabase, { title: 'Con foto' })
    registro(supabase, { title: 'Sin foto' })
    expect(archivosDeLaBitacora(supabase)).toHaveLength(2)
    await page.goto(ficha)
    await expect(titulos(page)).toHaveCount(2)
    await page.getByRole('button', { name: 'Gestionar planta' }).click()
    await page.getByRole('button', { name: 'Eliminar planta' }).click()
    await page
      .getByRole('dialog', { name: '¿Eliminar esta planta para siempre?' })
      .getByRole('button', { name: 'Eliminar definitivamente' })
      .click()
    await expect(page).toHaveURL(/\/coleccion$/)
    await expect(page.getByText(`Eliminaste de tu colección`)).toBeVisible()
    expect(supabase.registros).toHaveLength(0)
    await expect
      .poll(() =>
        [...supabase.archivos.keys()].filter((ruta) =>
          ruta.startsWith(`${USUARIO}/${PLANTA}/`),
        ),
      )
      .toEqual([])
  },
)
