import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, type InitialEntry } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '../routes/AppRouter.tsx'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import {
  isPrivacyContactPending,
  PRIVACY_CONTACT,
  PRIVACY_CONTACT_PLACEHOLDER,
  privacyContactHref,
} from './contact.ts'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

beforeEach(() => {
  resetFakeClerk()
  document.documentElement.lang = 'es'
  document.title = 'orqui.app'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  localStorage.clear()
})

// Todas las frases del texto aprobado el 22 de noviembre de 2026 (#111),
// tal como estaban antes del rediseño (#202), salvo la atribución del
// catálogo, que pasó a «Créditos y fuentes» (CreditsPage.test.tsx), y con la
// frase de la cola de propuestas puesta al día para varias fotos (#184) y con
// las notas y la bitácora (#267, aprobado el 23 de noviembre de 2026). Si
// falta una, la prueba falla: recortar el texto es una decisión del
// responsable.
const APPROVED_TEXT = [
  'Tu cuenta: tu correo y, si entras con Google, los datos de tu perfil de Google que recibe el servicio de acceso (como tu nombre y tu foto). Además, orqui.app guarda un perfil con tu identificador de usuario y el idioma de la app.',
  'Tus plantas: lo que registras de cada una: el nombre, el género, el tipo, la fecha de adquisición, el origen y, si los añades, la ubicación, el apodo, el color de la flor y su estado (activa, perdida o regalada). También las notas que escribas sobre ella.',
  'La bitácora de tus plantas: los registros que añades a cada una: el tipo de actividad (riego, nutrición, mantenimiento preventivo o sanidad preventiva), el título, la fecha y la hora en que lo guardaste y, si los añades, una descripción, una foto y si observaste floración.',
  'Las fotos de tus plantas: antes de subirlas, la app las reduce en tu dispositivo y les quita los metadatos que guarda la cámara, incluida la ubicación. Se guardan la foto y una miniatura. Las fotos de la bitácora se preparan igual.',
  'Mediciones de uso y errores: lo explicamos en la sección siguiente.',
  'Los usamos para que la app funcione: que entres en tu cuenta y veas y gestiones tu colección. Las mediciones y los errores, además, para mejorarla.',
  'La app registra dos tipos de evento de uso:',
  'Cuando registras una planta: cuánto tardaste, si llevaba foto y si el nombre quedó «por validar».',
  'Cuando buscas si ya tienes una planta («¿Ya la tengo?»): cuánto tardó la respuesta y cuál fue (la tienes, no la tienes o tienes parecidas).',
  'Cada evento lleva también tu identificador de usuario, la hora y si se generó sin conexión. No lleva el texto que buscaste, los nombres de tus plantas, tu correo ni tu nombre.',
  'Los usamos para saber si la app cumple su objetivo: que registrar una orquídea tome menos de un minuto y que saber si ya la tienes tome menos de cinco segundos.',
  'Si la app falla, envía el error a Sentry para que podamos corregirlo. El informe lleva el mensaje del error, en qué parte del código ocurrió, la dirección de la pantalla, tu navegador y tu sistema, la versión de la app, tu identificador de usuario y los últimos pasos que hiciste en la app (pantallas abiertas, botones pulsados y peticiones al servidor). Antes de enviarlo, la app quita tu correo, tu nombre, tu dirección IP, las cookies, el contenido de las peticiones, lo que escribiste en la búsqueda y en otros parámetros de las direcciones, tu zona horaria y tu idioma, los mensajes de la consola y los textos de los botones pulsados. No graba la pantalla ni mide el rendimiento.',
  'Sentry también recibe un aviso cada vez que abres la app, con la versión, tu navegador y tu identificador de usuario, para saber cuántas veces termina con un fallo.',
  'En orqui.app no hay publicidad ni otros servicios de analítica o de publicidad.',
  'Clerk gestiona el acceso: tu cuenta, tu correo, el acceso con Google y tu sesión.',
  'Supabase guarda tu perfil, tus plantas con sus notas y su bitácora, sus fotos y tus eventos de uso. Las fotos están en un almacenamiento privado: no tienen una dirección pública.',
  'Sentry recibe los informes de errores de la app.',
  'Vercel aloja la app y la entrega a tu navegador.',
  'El catálogo de especies que usa el buscador es común para todos y no contiene datos de quienes usan orqui.app. Las fotos de referencia de las especies muestran el nombre de su autor, como exige su licencia.',
  'Tus plantas, sus notas, su bitácora y sus fotos solo las ves tú. La base de datos solo entrega a cada cuenta sus propias plantas.',
  'Las personas que administran el catálogo de especies tienen dos excepciones:',
  'Pueden ver cuántas plantas de todos los usuarios están enlazadas a cada especie: solo el número, sin saber de quién son.',
  'Ven las plantas cuyo nombre está «por validar», para confirmar a qué especie corresponden. Las ven agrupadas con las de otros usuarios que escribieron el mismo nombre con el mismo género. De cada grupo ven el nombre tal como lo escribió la mayoría, el género, el tipo más frecuente, cuántas plantas hay y hasta seis fotos. Pueden abrir todas las fotos de esas plantas mientras el nombre está «por validar», no las de las demás. No reciben el origen, la ubicación, el apodo, las fechas, las notas de la planta ni las de las fotos, y la pantalla no les muestra de quién son. Tampoco ven la bitácora de esas plantas, ni sus registros ni sus fotos.',
  'Los cambios que hacen en el catálogo quedan registrados. Cuando resuelven un nombre «por validar», el registro guarda ese nombre, el género y cuántas plantas había, pero no de quién eran ni sus fotos.',
  'Ninguna cuenta de la app puede leer los eventos de uso, tampoco los tuyos: solo se consultan en la base de datos para calcular las mediciones.',
  'Una copia de tu inventario, para que puedas verlo y buscar en él sin conexión. Se borra al cerrar sesión.',
  'Las miniaturas de tus fotos, para que la colección cargue rápido y se vea sin conexión. Se borran al cerrar sesión.',
  'Los eventos de uso que aún no se enviaron, por ejemplo porque no había conexión. Se borran al enviarse, a los 29 días o al cerrar sesión.',
  'Tu identificador de usuario (no tu correo ni tu nombre), para mostrarte tu copia sin conexión. Se borra al cerrar sesión. Si cierras sesión sin conexión, se guarda hasta que la app pueda avisar al servicio de acceso.',
  'Los borradores de las plantas que estás registrando (hasta dos), con sus fotos si las elegiste, para no perderlos si se recarga la página o te quedas sin conexión. Cada uno se borra al registrarla o al descartarlo, y caduca a las 24 horas de su último cambio.',
  'Cómo prefieres ver el inventario (lista o cuadrícula).',
  'La bitácora no se guarda en tu dispositivo: para verla, añadir o eliminar registros hace falta conexión. Mientras la ves, sus fotos solo están en la memoria de la pestaña abierta.',
  'Los archivos de la propia app, para que abra sin conexión, y lo que el servicio de acceso necesita para mantener tu sesión.',
  'Cerrar sesión borra la copia, las miniaturas, los eventos pendientes y tu identificador, también sin conexión. Mientras no la cierres, quien tenga tu dispositivo desbloqueado puede ver la copia de tu inventario.',
  'Desde la app, con la sesión iniciada: Tu cuenta, Eliminar mi cuenta. Necesitas conexión. Se borran tus plantas con sus notas y su bitácora, sus fotos (también las de la bitácora), tu perfil, tus eventos de uso y tu cuenta de acceso. También lo que orqui.app guarda en ese dispositivo: la copia de tu inventario, las miniaturas, los eventos pendientes de enviar, tu identificador, los borradores y tus preferencias. No se puede deshacer.',
  'No se borran los informes de errores que ya se enviaron a Sentry (llevan tu identificador, no tu correo). Tampoco el registro de cambios del catálogo: si ya se resolvió un nombre que escribiste, ese nombre sigue ahí, sin decir de quién era.',
  'Puedes eliminar un registro de la bitácora desde la ficha de su planta: se borra con su foto. Al eliminar una planta se borran también sus notas, toda su bitácora y todas sus fotos. Las dos cosas necesitan conexión y no se pueden deshacer.',
  'Antes, o cuando quieras, puedes descargar tu inventario en un archivo CSV con «Exportar a CSV», al final de Mi colección. Incluye todas tus plantas, también las perdidas y regaladas, con todos sus datos, sus notas y la fecha en que las registraste. No incluye las fotos ni la bitácora.',
  `Para cualquier consulta sobre tus datos, escribe a ${PRIVACY_CONTACT}.`,
]

const TOC = [
  ['Qué datos guardamos', '#privacidad-datos'],
  ['Quién puede verlos', '#privacidad-acceso'],
  ['Qué se guarda en tu dispositivo', '#privacidad-dispositivo'],
  ['Cómo eliminar tu cuenta', '#privacidad-eliminar'],
]

function normalized(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** La sección (h2) que contiene ese título, de nivel 2 o 3. */
function section(title: string): HTMLElement {
  const found = screen.getByRole('heading', { name: title }).closest('section')
  if (!found) throw new Error(`Falta la sección «${title}».`)
  return found
}

function renderAt(entry: InitialEntry) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AppRouter appEnv="dev" clerkPublishableKey="pk_test_clave_de_prueba" />
    </MemoryRouter>,
  )
}

// La página va en su propio chunk: con la máquina cargada, la primera carga
// puede pasar del segundo que espera findBy por defecto.
function findTitle() {
  return screen.findByRole(
    'heading',
    { level: 1, name: 'Privacidad' },
    { timeout: 10_000 },
  )
}

describe('PrivacyPage', () => {
  it('se abre sin sesión, con título, frase, fecha, índice de cuatro secciones y axe', async () => {
    renderAt('/privacidad')

    expect(await findTitle()).toBeInTheDocument()
    expect(document.title).toBe('Privacidad · orqui.app')
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['En esta página', ...TOC.map(([title]) => title), 'Contacto'])
    expect(screen.getByText('23 de noviembre de 2026')).toHaveAttribute(
      'datetime',
      '2026-11-23',
    )
    const toc = screen.getByRole('navigation', { name: 'En esta página' })
    expect(
      within(toc)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual(TOC)
    for (const [, href] of TOC) {
      expect(document.getElementById(href.slice(1))).toHaveAttribute(
        'tabindex',
        '-1',
      )
    }
    await expectNoAxeViolations()
  })

  it('conserva todas las frases del texto aprobado', async () => {
    renderAt('/privacidad')
    await findTitle()
    const text = normalized(document.body.textContent)
    const missing = APPROVED_TEXT.filter((sentence) => !text.includes(sentence))
    expect(missing).toEqual([])
  })

  it('reparte el texto en las cuatro secciones, con subsecciones h3', async () => {
    renderAt('/privacidad')
    await findTitle()

    const data = section('Qué datos guardamos')
    expect(
      within(data)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Mediciones de uso y errores',
      'Dónde se guardan y quién los procesa',
    ])
    expect(data).toHaveTextContent('envía el error a Sentry')
    expect(data).toHaveTextContent('Vercel aloja la app')

    // Junto a la regla general, la excepción de los nombres por validar.
    const access = section('Quién puede verlos')
    const paragraphs = access.querySelectorAll('p')
    expect(normalized(paragraphs[0]?.textContent)).toBe(
      'Tu colección es privada. Si el nombre de una planta queda por validar, el equipo del catálogo puede revisar el nombre y las fotos asociadas.',
    )
    expect(normalized(paragraphs[1]?.textContent)).toMatch(
      /^Tus plantas, sus notas, su bitácora y sus fotos solo las ves tú\./,
    )

    expect(section('Qué se guarda en tu dispositivo')).toHaveTextContent(
      'Una copia de tu inventario',
    )

    const deletion = section('Cómo eliminar tu cuenta')
    expect(
      within(deletion).getByRole('link', { name: 'Tu cuenta' }),
    ).toHaveAttribute('href', '/cuenta')
    expect(
      within(deletion).getByRole('link', {
        name: 'Tu cuenta, Eliminar mi cuenta',
      }),
    ).toHaveAttribute('href', '/cuenta')
    expect(
      within(deletion)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Borrar un registro o una planta', 'Descargar tu inventario'])
    expect(
      within(deletion).getByRole('link', { name: 'Mi colección' }),
    ).toHaveAttribute('href', '/coleccion')
  })

  it('el índice lleva el foco al título de la sección y conserva el enlace de volver', async () => {
    const user = userEvent.setup()
    renderAt({ pathname: '/privacidad', state: { origen: 'registro' } })
    await findTitle()

    const toc = screen.getByRole('navigation', { name: 'En esta página' })
    await user.click(
      within(toc).getByRole('link', { name: 'Cómo eliminar tu cuenta' }),
    )
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Cómo eliminar tu cuenta',
      }),
    ).toHaveFocus()
    expect(
      screen.getByRole('link', { name: 'Volver al registro' }),
    ).toHaveAttribute('href', '/registro')

    // También con el teclado.
    within(toc).getByRole('link', { name: 'Quién puede verlos' }).focus()
    await user.keyboard('{Enter}')
    expect(
      screen.getByRole('heading', { level: 2, name: 'Quién puede verlos' }),
    ).toHaveFocus()
  })

  it.each([
    ['abierta directamente', undefined, 'Volver al inicio', '/'],
    [
      'desde el registro',
      { origen: 'registro' },
      'Volver al registro',
      '/registro',
    ],
    [
      'desde la colección',
      { origen: 'coleccion' },
      'Volver a Mi colección',
      '/coleccion',
    ],
    ['desde Tu cuenta', { origen: 'cuenta' }, 'Volver a Tu cuenta', '/cuenta'],
    ['con un estado desconocido', { origen: 'otro' }, 'Volver al inicio', '/'],
  ])('enlace de volver %s', async (_case, state, label, href) => {
    renderAt({ pathname: '/privacidad', state })
    await findTitle()
    expect(screen.getByRole('link', { name: label })).toHaveAttribute(
      'href',
      href,
    )
  })

  it('también se abre si Clerk no carga', async () => {
    setFakeClerk({ status: 'error' })
    renderAt('/privacidad')
    expect(await findTitle()).toBeInTheDocument()
  })

  it('la atribución del catálogo está en «Créditos y fuentes», enlazada desde aquí', async () => {
    renderAt('/privacidad')
    await findTitle()
    expect(document.body).not.toHaveTextContent('COL26.10 XR')
    expect(
      within(section('Qué datos guardamos')).getByRole('link', {
        name: 'Créditos y fuentes',
      }),
    ).toHaveAttribute('href', '/creditos')
  })

  it('muestra el contacto como enlace de correo, nunca el marcador', async () => {
    renderAt('/privacidad')
    await findTitle()
    expect(document.body).not.toHaveTextContent(PRIVACY_CONTACT_PLACEHOLDER)
    expect(screen.getByRole('link', { name: PRIVACY_CONTACT })).toHaveAttribute(
      'href',
      `mailto:${PRIVACY_CONTACT}`,
    )
  })

  it('desde el pie de la portada: «Volver al inicio»', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.click(
      within(await screen.findByRole('contentinfo')).getByRole('link', {
        name: 'Privacidad',
      }),
    )
    expect(await findTitle()).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Volver al inicio' }),
    ).toHaveAttribute('href', '/')
  })

  it('desde el pie de la colección: «Volver a Mi colección»', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true })
    renderAt('/coleccion')
    await screen.findByRole('heading', { level: 1, name: 'Mi colección' })
    await user.click(
      within(screen.getByRole('contentinfo')).getByRole('link', {
        name: 'Privacidad',
      }),
    )
    expect(await findTitle()).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Volver a Mi colección' }),
    ).toHaveAttribute('href', '/coleccion')
  })

  it('desde Tu cuenta: «Volver a Tu cuenta»', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true })
    renderAt('/cuenta')
    await screen.findByRole('heading', { level: 1, name: 'Tu cuenta' })
    await user.click(
      within(screen.getByRole('main')).getByRole('link', {
        name: /^Aviso de privacidad/,
      }),
    )
    expect(await findTitle()).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Volver a Tu cuenta' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tu cuenta' }),
    ).toBeInTheDocument()
  })

  it('desde crear cuenta, junto al formulario: «Volver al registro»', async () => {
    const user = userEvent.setup()
    renderAt('/registro')
    const link = await screen.findByRole('link', { name: 'Privacidad' })
    expect(link.closest('main')).not.toBeNull()
    await user.click(link)
    expect(await findTitle()).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Volver al registro' }),
    ).toHaveAttribute('href', '/registro')
  })

  it('la pantalla de inicio de sesión enlaza la privacidad', async () => {
    renderAt('/iniciar-sesion')
    expect(
      await screen.findByRole('link', { name: 'Privacidad' }),
    ).toHaveAttribute('href', '/privacidad')
  })
})

describe('contacto de privacidad', () => {
  it('hay un contacto real publicado', () => {
    expect(isPrivacyContactPending()).toBe(false)
    expect(isPrivacyContactPending(PRIVACY_CONTACT_PLACEHOLDER)).toBe(true)
    expect(isPrivacyContactPending('  ')).toBe(true)
  })

  it('con un contacto real deja de estar pendiente y se enlaza', () => {
    expect(isPrivacyContactPending('privacidad@ejemplo.test')).toBe(false)
    expect(privacyContactHref('privacidad@ejemplo.test')).toBe(
      'mailto:privacidad@ejemplo.test',
    )
    expect(privacyContactHref('https://ejemplo.test/contacto')).toBe(
      'https://ejemplo.test/contacto',
    )
  })
})
