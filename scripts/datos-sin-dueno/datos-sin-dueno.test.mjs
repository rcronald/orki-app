// Pruebas del script de datos sin dueño (#112), con Clerk y Supabase simulados:
// fetch es una función local y el cliente de Supabase un doble en memoria con
// la parte de supabase-js que usa el script. No hay red.
//
//   npm run test:scripts

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import {
  REFS,
  TOPE_PROPORCION,
  comprobarAmbiente,
  crearAccesoSupabase,
  crearClienteClerk,
  leerArgumentos,
  leerCredenciales,
  principal,
} from './datos-sin-dueno.mjs'

const CLAVE_CLERK_DEV = 'sk_test_SECRETOCLERKDEV123'
const CLAVE_CLERK_PROD = 'sk_live_SECRETOCLERKPROD456'
const CLAVE_SUPABASE = 'sb_secret_SECRETOSUPABASE789'
const BUCKET = 'plant-photos'

const entornoDev = {
  SUPABASE_PROJECT_REF: REFS.desarrollo,
  SUPABASE_SECRET_KEY: CLAVE_SUPABASE,
  CLERK_SECRET_KEY: CLAVE_CLERK_DEV,
}
const entornoProd = {
  SUPABASE_PROJECT_REF: REFS.produccion,
  SUPABASE_SECRET_KEY: CLAVE_SUPABASE,
  CLERK_SECRET_KEY: CLAVE_CLERK_PROD,
}

// Doble de Supabase ----------------------------------------------------------

function crearSupabaseFalso({ tablas, objetos }) {
  const estado = {
    tablas: Object.fromEntries(
      Object.entries(tablas).map(([nombre, filas]) => [
        nombre,
        filas.map((fila) => ({ ...fila })),
      ]),
    ),
    objetos: new Set(objetos),
    borrados: [],
    fallarBorradoEn: null,
  }

  function consulta(tabla) {
    let operacion = 'select'
    const filtros = []
    let limite = Infinity
    const constructor = {
      select() {
        operacion = 'select'
        return constructor
      },
      delete() {
        operacion = 'delete'
        return constructor
      },
      gt(columna, valor) {
        filtros.push((fila) => fila[columna] > valor)
        return constructor
      },
      eq(columna, valor) {
        filtros.push((fila) => fila[columna] === valor)
        return constructor
      },
      in(columna, valores) {
        filtros.push((fila) => valores.includes(fila[columna]))
        return constructor
      },
      order() {
        return constructor
      },
      limit(n) {
        limite = n
        return constructor
      },
      then(resolver, rechazar) {
        const filas = estado.tablas[tabla]
        if (filas === undefined) {
          // Como PostgREST con una tabla que el proyecto no tiene.
          return Promise.resolve({
            data: null,
            error: {
              code: 'PGRST205',
              message: `Could not find the table 'public.${tabla}' in the schema cache`,
            },
            count: null,
          }).then(resolver, rechazar)
        }
        const coinciden = filas
          .filter((fila) => filtros.every((filtro) => filtro(fila)))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        if (operacion === 'select') {
          return Promise.resolve({
            data: coinciden.slice(0, limite).map((fila) => ({ ...fila })),
            error: null,
          }).then(resolver, rechazar)
        }
        if (estado.fallarBorradoEn === tabla) {
          return Promise.resolve({
            data: null,
            error: { message: 'fallo simulado' },
            count: null,
          }).then(resolver, rechazar)
        }
        estado.tablas[tabla] = filas.filter((fila) => !coinciden.includes(fila))
        estado.borrados.push({ tabla, ids: coinciden.map((fila) => fila.id) })
        // Lo que hace la base: plant_photos.plant_id con on delete cascade.
        if (tabla === 'plants' && estado.tablas.plant_photos) {
          const plantas = new Set(coinciden.map((fila) => fila.id))
          estado.tablas.plant_photos = estado.tablas.plant_photos.filter(
            (foto) => !plantas.has(foto.plant_id),
          )
        }
        return Promise.resolve({
          data: null,
          error: null,
          count: coinciden.length,
        }).then(resolver, rechazar)
      },
    }
    return constructor
  }

  const almacen = {
    async list(carpeta, { limit, offset }) {
      const prefijo = carpeta ? `${carpeta}/` : ''
      const entradas = new Map()
      for (const ruta of estado.objetos) {
        if (!ruta.startsWith(prefijo)) continue
        const [nombre, ...resto] = ruta.slice(prefijo.length).split('/')
        entradas.set(nombre, resto.length > 0 ? null : `id-${ruta}`)
      }
      const data = [...entradas.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, id]) => ({ name, id }))
        .slice(offset, offset + limit)
      return { data, error: null }
    },
    async remove(rutas) {
      for (const ruta of rutas) estado.objetos.delete(ruta)
      estado.borrados.push({ tabla: 'storage', ids: [...rutas] })
      return { data: rutas.map((name) => ({ name })), error: null }
    },
  }

  return {
    estado,
    cliente: {
      from: (tabla) => consulta(tabla),
      storage: {
        from(nombre) {
          assert.equal(nombre, BUCKET)
          return almacen
        },
      },
    },
  }
}

// Doble de Clerk -------------------------------------------------------------

function json(estado, cuerpo, cabeceras = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json', ...cabeceras },
  })
}

const noEncontrado = () =>
  json(404, {
    errors: [
      {
        message: 'not found',
        long_message: 'User not found',
        code: 'resource_not_found',
      },
    ],
  })

/**
 * fetch simulado de la API de Clerk. `especiales` permite que la consulta de
 * un usuario concreto devuelva otra cosa (o lance, como un fallo de red).
 */
function crearClerkFalso({ existentes, especiales = {}, conteo }) {
  const peticiones = []
  async function fetch(url, opciones) {
    peticiones.push({ url, autorizacion: opciones.headers.Authorization })
    const ruta = new URL(url).pathname.replace(/^\/v1/, '')
    if (ruta === '/users/count') {
      if (conteo) return conteo()
      return json(200, {
        object: 'total_count',
        total_count: existentes.length,
      })
    }
    const id = decodeURIComponent(ruta.replace(/^\/users\//, ''))
    if (especiales[id]) return especiales[id]()
    if (existentes.includes(id)) return json(200, { id, object: 'user' })
    return noEncontrado()
  }
  return { fetch, peticiones }
}

// Datos de partida -----------------------------------------------------------
//
// Existen en Clerk: user_ana, user_beto, user_carla, user_dani, user_eva,
// user_fede, user_gabi y user_hugo. No existen: user_viejo (perfil, plantas
// con varias fotos en plant_photos, eventos y archivos) y user_solofotos (solo
// una carpeta en el bucket). Hay además un id con formato desconocido que
// nunca se consulta ni se borra.

const EXISTENTES = [
  'user_ana',
  'user_beto',
  'user_carla',
  'user_dani',
  'user_eva',
  'user_fede',
  'user_gabi',
  'user_hugo',
]

function datosDePartida() {
  const perfiles = [
    ...EXISTENTES.map((id) => ({ id })),
    { id: 'user_viejo' },
    { id: 'raro con espacios' },
  ]
  const plantas = [
    { id: 'p-ana-1', user_id: 'user_ana' },
    { id: 'p-beto-1', user_id: 'user_beto' },
    { id: 'p-viejo-1', user_id: 'user_viejo' },
    { id: 'p-viejo-2', user_id: 'user_viejo' },
    { id: 'p-raro-1', user_id: 'raro con espacios' },
  ]
  const eventos = [
    { id: 'e-ana-1', user_id: 'user_ana' },
    { id: 'e-viejo-1', user_id: 'user_viejo' },
  ]
  // Varias fotos por planta (#219): la principal y las secundarias.
  const fotosDePlantas = [
    { id: 'f-ana-1', user_id: 'user_ana', plant_id: 'p-ana-1' },
    { id: 'f-viejo-1', user_id: 'user_viejo', plant_id: 'p-viejo-1' },
    { id: 'f-viejo-2', user_id: 'user_viejo', plant_id: 'p-viejo-1' },
    { id: 'f-viejo-3', user_id: 'user_viejo', plant_id: 'p-viejo-2' },
  ]
  const objetos = [
    'user_ana/p-ana-1/photo-1.webp',
    'user_ana/p-ana-1/thumb-1.webp',
    'user_viejo/p-viejo-1/photo-1.webp',
    'user_viejo/p-viejo-1/thumb-1.webp',
    'user_viejo/p-viejo-2/photo-2.jpg',
    'user_solofotos/p-x/photo-1.webp',
  ]
  return crearSupabaseFalso({
    tablas: {
      profiles: perfiles,
      plants: plantas,
      plant_photos: fotosDePlantas,
      product_events: eventos,
    },
    objetos,
  })
}

function ejecutarCon({
  argv,
  entorno = entornoDev,
  supabase = datosDePartida(),
  clerk = crearClerkFalso({ existentes: EXISTENTES }),
}) {
  const lineas = []
  let clientesCreados = 0
  const promesa = principal({
    argv,
    entorno,
    archivoEnv: null,
    crearSupabase: (url, clave) => {
      clientesCreados += 1
      assert.equal(clave, entorno.SUPABASE_SECRET_KEY)
      assert.equal(url, `https://${entorno.SUPABASE_PROJECT_REF}.supabase.co`)
      return supabase.cliente
    },
    nombreBucket: BUCKET,
    fetch: clerk.fetch,
    log: (linea) => lineas.push(linea),
    pausaMs: 0,
  })
  return {
    promesa,
    lineas,
    supabase,
    clerk,
    clientesCreados: () => clientesCreados,
  }
}

function instantanea(supabase) {
  return JSON.stringify({
    tablas: supabase.estado.tablas,
    objetos: [...supabase.estado.objetos].sort(),
  })
}

// Pruebas --------------------------------------------------------------------

describe('modo de prueba', () => {
  test('lista los datos sin dueño y no borra nada', async () => {
    const ejecucion = ejecutarCon({ argv: ['--ambiente', 'desarrollo'] })
    const antes = instantanea(ejecucion.supabase)
    const { informe, borrados } = await ejecucion.promesa

    assert.equal(borrados, null)
    assert.equal(instantanea(ejecucion.supabase), antes)
    assert.deepEqual(ejecucion.supabase.estado.borrados, [])
    assert.deepEqual(
      informe.huerfanos.map((usuario) => usuario.id),
      ['user_solofotos', 'user_viejo'],
    )
    const viejo = informe.huerfanos.find(
      (usuario) => usuario.id === 'user_viejo',
    )
    assert.equal(viejo.perfil, true)
    assert.deepEqual(viejo.plantas, ['p-viejo-1', 'p-viejo-2'])
    assert.deepEqual(viejo.filasDeFotos, [
      'f-viejo-1',
      'f-viejo-2',
      'f-viejo-3',
    ])
    assert.deepEqual(viejo.eventos, ['e-viejo-1'])
    assert.equal(viejo.fotos.length, 3)
    assert.deepEqual(
      informe.formatoDesconocido.map((usuario) => usuario.id),
      ['raro con espacios'],
    )
    assert.ok(
      ejecucion.lineas.some((linea) =>
        linea.startsWith('Modo de prueba: no se ha borrado nada'),
      ),
    )
  })

  test('el id con formato desconocido no se consulta en Clerk', async () => {
    const ejecucion = ejecutarCon({ argv: ['--ambiente', 'desarrollo'] })
    await ejecucion.promesa
    assert.ok(
      ejecucion.clerk.peticiones.every(
        (peticion) => !peticion.url.includes('raro'),
      ),
    )
  })
})

describe('protección de ambiente', () => {
  const casos = [
    {
      nombre: 'ref de producción con --ambiente desarrollo',
      argv: ['--ambiente', 'desarrollo', '--borrar'],
      entorno: { ...entornoDev, SUPABASE_PROJECT_REF: REFS.produccion },
      mensaje: /no es el proyecto de desarrollo.*es el de produccion/,
    },
    {
      nombre: 'ref de desarrollo con --ambiente produccion',
      argv: ['--ambiente', 'produccion'],
      entorno: { ...entornoProd, SUPABASE_PROJECT_REF: REFS.desarrollo },
      mensaje: /no es el proyecto de produccion/,
    },
    {
      nombre: 'ref desconocido',
      argv: ['--ambiente', 'desarrollo'],
      entorno: { ...entornoDev, SUPABASE_PROJECT_REF: 'otroproyectoxxxxxxxx' },
      mensaje: /no es el proyecto de desarrollo/,
    },
    {
      nombre: 'clave de Clerk de producción en desarrollo',
      argv: ['--ambiente', 'desarrollo', '--borrar'],
      entorno: { ...entornoDev, CLERK_SECRET_KEY: CLAVE_CLERK_PROD },
      mensaje: /instancia de desarrollo de Clerk/,
    },
    {
      nombre: 'clave de Clerk de desarrollo en producción',
      argv: [
        '--ambiente',
        'produccion',
        '--borrar',
        '--confirmar-produccion',
        REFS.produccion,
      ],
      entorno: { ...entornoProd, CLERK_SECRET_KEY: CLAVE_CLERK_DEV },
      mensaje: /instancia de produccion de Clerk/,
    },
    {
      nombre: 'borrar en producción sin --confirmar-produccion',
      argv: ['--ambiente', 'produccion', '--borrar'],
      entorno: entornoProd,
      mensaje: /--confirmar-produccion/,
    },
    {
      nombre: 'borrar en producción confirmando con otro ref',
      argv: [
        '--ambiente',
        'produccion',
        '--borrar',
        '--confirmar-produccion',
        REFS.desarrollo,
      ],
      entorno: entornoProd,
      mensaje: /--confirmar-produccion/,
    },
    {
      nombre: 'sin --ambiente',
      argv: ['--borrar'],
      entorno: entornoDev,
      mensaje: /indica el ambiente/,
    },
  ]
  for (const caso of casos) {
    test(`se niega: ${caso.nombre}`, async () => {
      const ejecucion = ejecutarCon({ argv: caso.argv, entorno: caso.entorno })
      const antes = instantanea(ejecucion.supabase)
      await assert.rejects(ejecucion.promesa, caso.mensaje)
      assert.equal(ejecucion.clientesCreados(), 0)
      assert.equal(ejecucion.clerk.peticiones.length, 0)
      assert.equal(instantanea(ejecucion.supabase), antes)
    })
  }

  test('en producción con la confirmación correcta sí borra', async () => {
    const ejecucion = ejecutarCon({
      argv: [
        '--ambiente',
        'produccion',
        '--borrar',
        '--confirmar-produccion',
        REFS.produccion,
      ],
      entorno: entornoProd,
    })
    const { borrados } = await ejecucion.promesa
    assert.equal(borrados.usuarios, 2)
  })

  test('comprobarAmbiente acepta el par correcto', () => {
    assert.doesNotThrow(() => comprobarAmbiente('desarrollo', entornoDev))
    assert.doesNotThrow(() => comprobarAmbiente('produccion', entornoProd))
  })

  test('argumentos incoherentes', () => {
    assert.throws(
      () =>
        leerArgumentos([
          '--ambiente',
          'desarrollo',
          '--confirmar-produccion',
          REFS.produccion,
        ]),
      /solo se usa con --ambiente produccion/,
    )
    assert.throws(
      () =>
        leerArgumentos([
          '--ambiente',
          'desarrollo',
          '--permitir-proporcion-alta',
        ]),
      /solo se usa con --borrar/,
    )
    assert.throws(
      () => leerArgumentos(['--ambiente', 'pruebas']),
      /--ambiente debe ser/,
    )
    assert.throws(
      () => leerArgumentos(['--ambiente', 'desarrollo', '--borar']),
      /argumento desconocido/,
    )
  })
})

describe('un error de Clerk no produce huérfanos', () => {
  const fallos = {
    'límite de peticiones (429)': () =>
      json(
        429,
        { errors: [{ code: 'too_many_requests' }] },
        { 'retry-after': '10' },
      ),
    'error del servidor (500)': () => json(500, { errors: [] }),
    'clave rechazada (401)': () =>
      json(401, { errors: [{ code: 'authentication_invalid' }] }),
    'fallo de red': () => Promise.reject(new TypeError('fetch failed')),
    '404 sin resource_not_found': () =>
      json(404, { errors: [{ code: 'otro' }] }),
    '404 sin cuerpo JSON': () => new Response('Not Found', { status: 404 }),
    '200 con otro usuario': () => json(200, { id: 'user_otro' }),
    '200 sin cuerpo': () => new Response('', { status: 200 }),
  }
  for (const [nombre, respuesta] of Object.entries(fallos)) {
    test(`al consultar un usuario: ${nombre}`, async () => {
      // user_solofotos ya se vio inexistente; luego falla la consulta de
      // user_viejo: el script se detiene sin borrar a ninguno de los dos.
      const ejecucion = ejecutarCon({
        argv: [
          '--ambiente',
          'desarrollo',
          '--borrar',
          '--permitir-proporcion-alta',
        ],
        clerk: crearClerkFalso({
          existentes: EXISTENTES,
          especiales: { user_viejo: respuesta },
        }),
      })
      const antes = instantanea(ejecucion.supabase)
      await assert.rejects(ejecucion.promesa, (error) => {
        assert.equal(error.name, 'ErrorClerk')
        return true
      })
      assert.equal(instantanea(ejecucion.supabase), antes)
      assert.deepEqual(ejecucion.supabase.estado.borrados, [])
    })
  }

  test('al contar los usuarios antes de empezar', async () => {
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'desarrollo', '--borrar'],
      clerk: crearClerkFalso({
        existentes: EXISTENTES,
        conteo: () => json(503, {}),
      }),
    })
    const antes = instantanea(ejecucion.supabase)
    await assert.rejects(ejecucion.promesa, /Clerk/)
    assert.equal(instantanea(ejecucion.supabase), antes)
    // No llegó a consultar ningún usuario.
    assert.equal(ejecucion.clerk.peticiones.length, 1)
  })

  test('el 429 menciona cuándo reintentar', async () => {
    const clerk = crearClienteClerk({
      clave: CLAVE_CLERK_DEV,
      pausaMs: 0,
      fetch: async () => json(429, {}, { 'retry-after': '7' }),
    })
    await assert.rejects(
      clerk.consultarUsuario('user_ana'),
      /429.*reintenta tras 7 s/,
    )
  })
})

describe('borrado', () => {
  test('afecta solo a lo detectado', async () => {
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'desarrollo', '--borrar'],
    })
    const { borrados } = await ejecucion.promesa
    const { tablas, objetos } = ejecucion.supabase.estado

    assert.deepEqual(borrados, {
      usuarios: 2,
      fotos: 4,
      filasDeFotos: 3,
      plantas: 2,
      eventos: 1,
      perfiles: 1,
    })
    assert.deepEqual(
      tablas.profiles.map((fila) => fila.id).sort(),
      [...EXISTENTES, 'raro con espacios'].sort(),
    )
    assert.deepEqual(tablas.plants.map((fila) => fila.id).sort(), [
      'p-ana-1',
      'p-beto-1',
      'p-raro-1',
    ])
    assert.deepEqual(
      tablas.product_events.map((fila) => fila.id),
      ['e-ana-1'],
    )
    assert.deepEqual(
      tablas.plant_photos.map((fila) => fila.id),
      ['f-ana-1'],
    )
    assert.deepEqual([...objetos].sort(), [
      'user_ana/p-ana-1/photo-1.webp',
      'user_ana/p-ana-1/thumb-1.webp',
    ])
    // Cada borrado tocó solo ids de un usuario sin dueño.
    const tocados = ejecucion.supabase.estado.borrados.flatMap((b) => b.ids)
    assert.deepEqual(tocados.sort(), [
      'e-viejo-1',
      'f-viejo-1',
      'f-viejo-2',
      'f-viejo-3',
      'p-viejo-1',
      'p-viejo-2',
      'user_solofotos/p-x/photo-1.webp',
      'user_viejo',
      'user_viejo/p-viejo-1/photo-1.webp',
      'user_viejo/p-viejo-1/thumb-1.webp',
      'user_viejo/p-viejo-2/photo-2.jpg',
    ])
  })

  test('sigue el orden de la app: fotos, filas de fotos, plantas, eventos y perfil', async () => {
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'desarrollo', '--borrar'],
    })
    await ejecucion.promesa
    const orden = ejecucion.supabase.estado.borrados
      .filter((b) => b.ids.some((id) => String(id).includes('viejo')))
      .map((b) => b.tabla)
    assert.deepEqual(orden, [
      'storage',
      'plant_photos',
      'plants',
      'product_events',
      'profiles',
    ])
  })

  test('los borrados filtran también por usuario y por carpeta', async () => {
    // Defensa: aunque la lista de ids trajera uno ajeno, no se toca.
    const supabase = datosDePartida()
    const datos = crearAccesoSupabase(supabase.cliente, BUCKET)
    assert.equal(
      await datos.borrarPlantas('user_viejo', ['p-ana-1', 'p-viejo-1']),
      1,
    )
    assert.ok(
      supabase.estado.tablas.plants.some((fila) => fila.id === 'p-ana-1'),
    )
    await assert.rejects(
      datos.borrarFotos('user_viejo', ['user_ana/p-ana-1/photo-1.webp']),
      /fuera de la carpeta de user_viejo/,
    )
    assert.ok(supabase.estado.objetos.has('user_ana/p-ana-1/photo-1.webp'))
  })

  test('la cascada desde plants ya borra las filas de fotos de las plantas sin dueño', async () => {
    // Aunque falle el borrado explícito de plant_photos, borrar las plantas se
    // lleva sus fotos; el script no deja filas de fotos de un usuario borrado.
    const supabase = datosDePartida()
    const datos = crearAccesoSupabase(supabase.cliente, BUCKET)
    await datos.borrarPlantas('user_viejo', ['p-viejo-1', 'p-viejo-2'])
    assert.deepEqual(
      supabase.estado.tablas.plant_photos.map((fila) => fila.id),
      ['f-ana-1'],
    )
  })

  test('sin la tabla plant_photos (migración sin aplicar) sigue con lo demás', async () => {
    const supabase = datosDePartida()
    delete supabase.estado.tablas.plant_photos
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'desarrollo', '--borrar'],
      supabase,
    })
    const { borrados } = await ejecucion.promesa
    assert.equal(borrados.filasDeFotos, 0)
    assert.equal(borrados.plantas, 2)
  })

  test('un fallo a mitad se detiene y lo dice', async () => {
    const supabase = datosDePartida()
    supabase.estado.fallarBorradoEn = 'plants'
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'desarrollo', '--borrar'],
      supabase,
    })
    await assert.rejects(
      ejecucion.promesa,
      /falló el borrado de user_viejo tras 1 usuarios completos/,
    )
    // El perfil de user_viejo sigue: se borra al final.
    assert.ok(
      supabase.estado.tablas.profiles.some((fila) => fila.id === 'user_viejo'),
    )
  })
})

describe('tope de seguridad', () => {
  test(`se niega a borrar con más del ${TOPE_PROPORCION * 100} % sin dueño`, async () => {
    // Solo dos usuarios existen: 8 de 10 consultados estarían sin dueño.
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'desarrollo', '--borrar'],
      clerk: crearClerkFalso({ existentes: ['user_ana', 'user_beto'] }),
    })
    const supabase = ejecucion.supabase
    const antes = instantanea(supabase)
    await assert.rejects(
      ejecucion.promesa,
      /--permitir-proporcion-alta.*No se ha borrado nada/s,
    )
    assert.equal(instantanea(supabase), antes)
  })

  test('con --permitir-proporcion-alta sí borra', async () => {
    const ejecucion = ejecutarCon({
      argv: [
        '--ambiente',
        'desarrollo',
        '--borrar',
        '--permitir-proporcion-alta',
      ],
      clerk: crearClerkFalso({ existentes: ['user_ana', 'user_beto'] }),
    })
    const { borrados } = await ejecucion.promesa
    assert.equal(borrados.usuarios, 8)
    assert.deepEqual(
      ejecucion.supabase.estado.tablas.profiles.map((fila) => fila.id).sort(),
      ['raro con espacios', 'user_ana', 'user_beto'],
    )
  })
})

describe('credenciales', () => {
  let carpeta
  beforeEach(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'orki-datos-sin-dueno-'))
  })
  afterEach(() => {
    rmSync(carpeta, { recursive: true, force: true })
  })

  test('nunca aparecen en la salida ni en los errores', async () => {
    const correcta = ejecutarCon({
      argv: ['--ambiente', 'desarrollo', '--borrar'],
    })
    await correcta.promesa
    const fallida = ejecutarCon({
      argv: ['--ambiente', 'desarrollo', '--borrar'],
      clerk: crearClerkFalso({
        existentes: EXISTENTES,
        especiales: { user_ana: () => json(401, {}) },
      }),
    })
    let mensaje = ''
    await fallida.promesa.catch((error) => {
      mensaje = error.message
    })
    const salida = [...correcta.lineas, ...fallida.lineas, mensaje].join('\n')
    for (const secreto of [CLAVE_CLERK_DEV, CLAVE_SUPABASE]) {
      assert.ok(!salida.includes(secreto))
    }
    // La clave de Clerk va solo en la cabecera.
    assert.ok(
      correcta.clerk.peticiones.every(
        (peticion) =>
          peticion.autorizacion === `Bearer ${CLAVE_CLERK_DEV}` &&
          !peticion.url.includes(CLAVE_CLERK_DEV),
      ),
    )
  })

  test('faltan variables: nombra las variables, no valores', () => {
    assert.throws(
      () =>
        leerCredenciales({
          ambiente: 'desarrollo',
          entorno: { SUPABASE_PROJECT_REF: REFS.desarrollo },
          archivoEnv: null,
        }),
      /falta SUPABASE_SECRET_KEY, CLERK_SECRET_KEY/,
    )
  })

  test('en desarrollo completa desde supabase/.env; el entorno manda', () => {
    const archivo = join(carpeta, '.env')
    writeFileSync(
      archivo,
      `SUPABASE_PROJECT_REF=otro\nSUPABASE_SECRET_KEY=${CLAVE_SUPABASE}\nCLERK_SECRET_KEY=${CLAVE_CLERK_DEV}\n`,
    )
    const valores = leerCredenciales({
      ambiente: 'desarrollo',
      entorno: { SUPABASE_PROJECT_REF: REFS.desarrollo },
      archivoEnv: archivo,
    })
    assert.equal(valores.SUPABASE_PROJECT_REF, REFS.desarrollo)
    assert.equal(valores.CLERK_SECRET_KEY, CLAVE_CLERK_DEV)
  })

  test('en producción no lee supabase/.env', () => {
    const archivo = join(carpeta, '.env')
    writeFileSync(
      archivo,
      `SUPABASE_PROJECT_REF=${REFS.produccion}\nSUPABASE_SECRET_KEY=${CLAVE_SUPABASE}\nCLERK_SECRET_KEY=${CLAVE_CLERK_PROD}\n`,
    )
    assert.throws(
      () =>
        leerCredenciales({
          ambiente: 'produccion',
          entorno: {},
          archivoEnv: archivo,
        }),
      /solo del entorno/,
    )
  })
})
