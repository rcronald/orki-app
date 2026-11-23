import { ADMIN, ESPECIES, PLANTAS } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Backoffice del catálogo (#99, #139, #140), con el rol catalog_admin en el
// token: el resumen, la búsqueda con el detalle de una especie y la cola de
// propuestas por validar, que resuelve los nombres que registraron otros.

test.use({ sesion: { usuario: ADMIN, rol: 'catalog_admin' } })

test(
  'resumen, búsqueda y detalle de una especie',
  { tag: '@logica' },
  async ({ page, revisarAccesibilidad }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Tu cuenta' }).click()
    await page.getByRole('menuitem', { name: 'Administración' }).click()
    await expect(
      page.getByRole('heading', {
        name: 'Administración del catálogo',
        level: 1,
      }),
    ).toBeVisible()
    const especies = page.getByRole('table', {
      name: 'Especies del catálogo, en orden alfabético',
    })
    await expect(especies.getByRole('rowheader')).toHaveCount(6)
    await revisarAccesibilidad('backoffice: especies')

    await page
      .getByRole('searchbox', { name: 'Buscar especies' })
      .fill('flor de mayo')
    const resultados = page.getByRole('table', {
      name: 'Especies que coinciden con «flor de mayo», por relevancia',
    })
    await expect(resultados.getByRole('rowheader')).toHaveCount(1)
    await resultados.getByRole('link', { name: 'Cattleya trianae' }).click()

    await expect(page).toHaveURL(
      new RegExp(`especie=${ESPECIES.cattleyaTrianae}`),
    )
    const panel = page.getByRole('region', {
      name: 'Detalle de Cattleya trianae',
    })
    await expect(
      panel.getByRole('list', { name: 'Nombres comunes (1)' }),
    ).toContainText('Flor de mayo')
    await expect(panel).toContainText('1 planta de usuarios la tiene enlazada')
    await revisarAccesibilidad('backoffice: detalle de especie')
  },
)

test(
  'cola de propuestas: crear la especie y marcar como no identificable',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    await page.goto('/administracion/catalogo')
    await page.getByRole('tab', { name: /^Por validar/ }).click()
    const cola = page.getByRole('region', { name: 'Propuestas por validar' })
    await expect(cola.getByText('2 grupos por validar')).toBeVisible()
    await revisarAccesibilidad('backoffice: propuestas')

    // Dar de alta la especie desde la propuesta: enlaza la planta del grupo.
    await cola
      .getByRole('button', { name: 'Crear la especie «Oncidium Sharry Baby»' })
      .click()
    const alta = page.getByRole('dialog', {
      name: 'Crear la especie desde la propuesta',
    })
    await expect(
      alta.getByRole('textbox', { name: 'Nombre científico' }),
    ).toHaveValue('Oncidium Sharry Baby')
    await revisarAccesibilidad('backoffice: crear especie desde la propuesta')
    await alta.getByRole('button', { name: 'Dar de alta y enlazar' }).click()
    await expect(alta).toBeHidden()
    await expect(cola.getByText('1 grupo por validar')).toBeVisible()
    const enlazada = supabase.datos.plantas.find(
      (p) => p.id === PLANTAS.porValidar,
    )
    expect(enlazada?.validation).toBe('validated')
    expect(
      supabase.datos.especies.find((e) => e.id === enlazada?.species_id),
    ).toMatchObject({
      scientific_name: 'Oncidium Sharry Baby',
      type: 'hybrid',
      source: 'user_proposal',
    })

    // Marcar el otro grupo (dos plantas, con distinta escritura) como no
    // identificable.
    await cola
      .getByRole('button', { name: 'No identificable «Vanda Sansai Blue»' })
      .click()
    const confirmacion = page.getByRole('alertdialog', {
      name: 'Marcar como no identificable',
    })
    await revisarAccesibilidad('backoffice: marcar como no identificable')
    await confirmacion.getByRole('button', { name: 'Marcar 2 plantas' }).click()
    await expect(confirmacion).toBeHidden()
    await expect(cola.getByRole('listitem')).toHaveCount(0)
    expect(
      supabase.datos.plantas
        .filter((p) =>
          [PLANTAS.propuestaAjena, PLANTAS.propuestaAjena2].includes(p.id),
        )
        .map((p) => p.validation),
    ).toEqual(['unidentifiable', 'unidentifiable'])
  },
)
