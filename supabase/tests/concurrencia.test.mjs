// Concurrencia real en la base (#295): npm run db:test:concurrencia
//
// Las pruebas de supabase/tests/*.sql corren cada una en una sola sesión y no pueden probar
// dos transacciones a la vez. Estas abren dos conexiones a una base desechable con todas las
// migraciones (scripts/db-desechable, la misma que npm run db:test) y reproducen, paso a paso
// y sin depender de tiempos, lo que pasa cuando dos peticiones chocan:
//
//   1. La sesión A empieza su transacción y hace su escritura, sin confirmar.
//   2. La sesión B hace la suya y se queda esperando un bloqueo de A (se comprueba en
//      pg_stat_activity, no con una pausa).
//   3. A confirma (o revierte) y se mira qué le pasó a B y cómo quedan los datos.
//
// Cubre las fusiones simultáneas de especies (el "for update" de merge_species), el contador
// de identificadores de planta (su "on conflict"), la idempotencia de la bitácora y la séptima
// foto. Cada prueba crea sus propios datos, con nombres que no se repiten, y confirma de
// verdad: la base entera se borra al terminar.
//
// Usa el mismo servidor que npm run db:test: ORKI_TEST_DB_URL o un clúster temporal (ver
// scripts/db-desechable/index.mjs y la sección del README).

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import {
  abrirSesionPsql,
  conBaseDesechable,
} from '../../scripts/db-desechable/index.mjs'

// Lo que tarda como mucho una sesión en llegar al bloqueo: holgado para un CI lento, y solo
// se agota si la prueba falla.
const ESPERA_MAXIMA_MS = 15_000

let base
let soltarBase
let trabajo

before(
  async () => {
    await new Promise((listo, fallo) => {
      trabajo = conBaseDesechable(async (datos) => {
        base = datos
        listo()
        await new Promise((resolver) => {
          soltarBase = resolver
        })
      })
      trabajo.catch(fallo)
    })
  },
  { timeout: 300_000 },
)

after(async () => {
  soltarBase?.()
  await trabajo
})

// Consulta como superusuario, sin RLS, y devuelve la primera columna de la primera fila.
function valor(sql) {
  return base.consultar(sql)[0]
}

function texto(valorSql) {
  return `'${String(valorSql).replaceAll("'", "''")}'`
}

// Una petición de la API: transacción en READ COMMITTED (el nivel de PostgREST) con el rol
// authenticated y el token de "usuario".
function inicioDePeticion(usuario, { administrador = false } = {}) {
  const claims = {
    sub: usuario,
    role: 'authenticated',
    ...(administrador && { app_role: 'catalog_admin' }),
  }
  return (
    'begin isolation level read committed; set local role authenticated; ' +
    `set local request.jwt.claims = ${texto(JSON.stringify(claims))};`
  )
}

let sesionesAbiertas = []
let contadorDeSesiones = 0

function abrirSesion(etiqueta) {
  contadorDeSesiones += 1
  const sesion = abrirSesionPsql(base.conexion, {
    nombre: `${etiqueta}-${contadorDeSesiones}`,
  })
  sesionesAbiertas.push(sesion)
  return sesion
}

async function cerrarSesiones() {
  const sesiones = sesionesAbiertas
  sesionesAbiertas = []
  await Promise.all(sesiones.map((sesion) => sesion.cerrar()))
}

// Espera a que la orden en curso de "sesion" quede bloqueada por otra transacción. Si la
// orden termina antes, falla: entonces no había nada que la frenara.
async function esperarBloqueo(sesion, orden) {
  let terminada = false
  void orden.then(
    () => {
      terminada = true
    },
    () => {
      terminada = true
    },
  )
  const limite = Date.now() + ESPERA_MAXIMA_MS
  for (;;) {
    const esperando = valor(
      `select count(*) from pg_stat_activity
         where application_name = ${texto(`orki-sesion-${sesion.nombre}`)}
           and wait_event_type = 'Lock'`,
    )
    if (esperando === '1') return
    // Se cede el turno para que lleguen las respuestas de psql.
    await new Promise((resolver) => setTimeout(resolver, 20))
    if (terminada) {
      const resultado = await orden
      assert.fail(
        `la sesión ${sesion.nombre} no esperó a la otra transacción: ` +
          (resultado.ok ? 'terminó sin error' : resultado.error),
      )
    }
    if (Date.now() > limite) {
      assert.fail(
        `la sesión ${sesion.nombre} no llegó a esperar un bloqueo en ${ESPERA_MAXIMA_MS} ms`,
      )
    }
  }
}

async function correcto(promesa, descripcion) {
  const resultado = await promesa
  assert.ok(resultado.ok, `${descripcion}: ${resultado.error}`)
  return resultado
}

function falloCon(resultado, codigo, descripcion) {
  assert.equal(
    resultado.ok,
    false,
    `${descripcion}: se esperaba el error ${codigo} y terminó sin error`,
  )
  assert.match(
    resultado.error,
    new RegExp(`ERROR:\\s+${codigo}:`),
    `${descripcion}: se esperaba el error ${codigo}`,
  )
}

function nombreUnico(prefijo) {
  return `${prefijo} ${randomUUID().slice(0, 8)}`
}

describe('fusiones simultáneas de especies', () => {
  // Tres especies de un género nuevo y una planta en la que se absorbe.
  function prepararEspecies() {
    const genero = valor(
      `insert into public.genera (name) values (${texto(nombreUnico('Fusionalis'))}) returning id`,
    )
    const especie = (nombre) =>
      valor(
        `insert into public.species (scientific_name, genus_id, type, status, source)
           values (${texto(nombreUnico(nombre))}, ${texto(genero)}, 'species', 'validated', 'curated')
           returning id`,
      )
    const absorbida = especie('Fusionalis prima')
    const conservada = especie('Fusionalis secunda')
    const otra = especie('Fusionalis tertia')
    const usuario = `user_${randomUUID().slice(0, 8)}`
    valor(
      `insert into public.profiles (id) values (${texto(usuario)}) returning id`,
    )
    const planta = valor(
      `insert into public.plants (user_id, entered_name, genus_id, type, species_id)
         values (${texto(usuario)}, 'Planta de la fusión', ${texto(genero)}, 'species', ${texto(absorbida)})
         returning id`,
    )
    return { absorbida, conservada, otra, planta }
  }

  const fusion = (absorbida, conservada) =>
    `select action_id as valor from public.merge_species(${texto(absorbida)}, ${texto(conservada)})`

  const fusionesDe = (especie) =>
    valor(
      `select count(*) from public.catalog_audit_log
         where action = 'merge_species' and details ->> 'merged_species_id' = ${texto(especie)}`,
    )

  after(cerrarSesiones)

  it('dos fusiones de la misma especie en otras dos: la segunda espera y dice que ya no está', async () => {
    const { absorbida, conservada, otra, planta } = prepararEspecies()
    const a = abrirSesion('fusion-a')
    const b = abrirSesion('fusion-b')
    const admin = inicioDePeticion('user_admin', { administrador: true })

    await correcto(a.ejecutar(admin), 'A empieza')
    await correcto(
      a.ejecutar(fusion(absorbida, conservada), { valor: true }),
      'A fusiona',
    )
    await correcto(b.ejecutar(admin), 'B empieza')
    const deB = b.ejecutar(fusion(absorbida, otra), { valor: true })
    await esperarBloqueo(b, deB)
    await correcto(a.ejecutar('commit'), 'A confirma')

    const resultado = await deB
    falloCon(resultado, 'P0002', 'la segunda fusión')
    assert.match(resultado.error, /"reason": "species_not_found"/)
    await correcto(b.ejecutar('rollback'), 'B revierte')

    assert.equal(
      valor(
        `select count(*) from public.species where id = ${texto(absorbida)}`,
      ),
      '0',
    )
    assert.equal(
      valor(`select species_id from public.plants where id = ${texto(planta)}`),
      conservada,
      'la planta queda en la especie de la fusión que se hizo',
    )
    assert.equal(fusionesDe(absorbida), '1', 'una sola fusión en la auditoría')
  })

  it('dos fusiones cruzadas (A en B y B en A): no se interbloquean y solo se hace una', async () => {
    const { absorbida, conservada, planta } = prepararEspecies()
    const a = abrirSesion('cruce-a')
    const b = abrirSesion('cruce-b')
    const admin = inicioDePeticion('user_admin', { administrador: true })

    await correcto(a.ejecutar(admin), 'A empieza')
    await correcto(
      a.ejecutar(fusion(absorbida, conservada), { valor: true }),
      'A fusiona',
    )
    await correcto(b.ejecutar(admin), 'B empieza')
    const deB = b.ejecutar(fusion(conservada, absorbida), { valor: true })
    await esperarBloqueo(b, deB)
    await correcto(a.ejecutar('commit'), 'A confirma')

    const resultado = await deB
    falloCon(resultado, 'P0002', 'la fusión cruzada')
    assert.match(resultado.error, /"species_role": "kept"/)
    await correcto(b.ejecutar('rollback'), 'B revierte')

    assert.equal(
      valor(
        `select count(*) from public.species where id in (${texto(absorbida)}, ${texto(conservada)})`,
      ),
      '1',
    )
    assert.equal(
      valor(`select species_id from public.plants where id = ${texto(planta)}`),
      conservada,
    )
    assert.equal(fusionesDe(conservada), '0')
  })
})

describe('contador de identificadores de planta', () => {
  function prepararUsuario() {
    const genero = valor(
      `insert into public.genera (name) values (${texto(nombreUnico('Contadoria'))}) returning id`,
    )
    const usuario = `user_${randomUUID().slice(0, 8)}`
    valor(
      `insert into public.profiles (id) values (${texto(usuario)}) returning id`,
    )
    return { genero, usuario }
  }

  const alta = (genero, nombre) =>
    `insert into public.plants (entered_name, genus_id, type)
       values (${texto(nombre)}, ${texto(genero)}, 'unknown')`

  const numeros = (usuario) =>
    valor(
      `select string_agg(code_number::text, ',' order by code_number)
         from public.plants where user_id = ${texto(usuario)}`,
    )

  after(cerrarSesiones)

  it('la primera planta de un prefijo, dos a la vez: la segunda espera y recibe el 2', async () => {
    const { genero, usuario } = prepararUsuario()
    const a = abrirSesion('contador-a')
    const b = abrirSesion('contador-b')

    await correcto(a.ejecutar(inicioDePeticion(usuario)), 'A empieza')
    await correcto(a.ejecutar(alta(genero, 'Uno')), 'A da de alta')
    await correcto(b.ejecutar(inicioDePeticion(usuario)), 'B empieza')
    const deB = b.ejecutar(alta(genero, 'Dos'))
    await esperarBloqueo(b, deB)
    await correcto(a.ejecutar('commit'), 'A confirma')
    await correcto(deB, 'B da de alta')
    await correcto(b.ejecutar('commit'), 'B confirma')

    assert.equal(numeros(usuario), '1,2')
  })

  it('con el contador ya creado, dos altas a la vez reciben números seguidos y distintos', async () => {
    const { genero, usuario } = prepararUsuario()
    const a = abrirSesion('contador2-a')
    const b = abrirSesion('contador2-b')

    await correcto(
      a.ejecutar(
        `${inicioDePeticion(usuario)} ${alta(genero, 'Primera')}; commit`,
      ),
      'la primera planta',
    )
    await correcto(a.ejecutar(inicioDePeticion(usuario)), 'A empieza')
    await correcto(a.ejecutar(alta(genero, 'Segunda')), 'A da de alta')
    await correcto(b.ejecutar(inicioDePeticion(usuario)), 'B empieza')
    const deB = b.ejecutar(alta(genero, 'Tercera'))
    await esperarBloqueo(b, deB)
    await correcto(a.ejecutar('commit'), 'A confirma')
    await correcto(deB, 'B da de alta')
    await correcto(b.ejecutar('commit'), 'B confirma')

    assert.equal(numeros(usuario), '1,2,3')
  })

  it('si la primera se revierte, la que esperaba toma su número', async () => {
    const { genero, usuario } = prepararUsuario()
    const a = abrirSesion('contador3-a')
    const b = abrirSesion('contador3-b')

    await correcto(a.ejecutar(inicioDePeticion(usuario)), 'A empieza')
    await correcto(a.ejecutar(alta(genero, 'Revertida')), 'A da de alta')
    await correcto(b.ejecutar(inicioDePeticion(usuario)), 'B empieza')
    const deB = b.ejecutar(alta(genero, 'Confirmada'))
    await esperarBloqueo(b, deB)
    await correcto(a.ejecutar('rollback'), 'A revierte')
    await correcto(deB, 'B da de alta')
    await correcto(b.ejecutar('commit'), 'B confirma')

    assert.equal(numeros(usuario), '1')
  })
})

describe('idempotencia de la bitácora', () => {
  function prepararPlanta() {
    const genero = valor(
      `insert into public.genera (name) values (${texto(nombreUnico('Bitacoria'))}) returning id`,
    )
    const usuario = `user_${randomUUID().slice(0, 8)}`
    valor(
      `insert into public.profiles (id) values (${texto(usuario)}) returning id`,
    )
    const planta = valor(
      `insert into public.plants (user_id, entered_name, genus_id, type)
         values (${texto(usuario)}, 'Con bitácora', ${texto(genero)}, 'unknown') returning id`,
    )
    return { usuario, planta }
  }

  const registro = (planta, clave, titulo) =>
    `select id as valor from public.add_plant_log_entry(
       ${texto(planta)}, 'watering', ${texto(titulo)}, idempotency_key => ${texto(clave)})`

  const registrosCon = (clave) =>
    valor(
      `select count(*) from public.plant_log_entries where idempotency_key = ${texto(clave)}`,
    )

  after(cerrarSesiones)

  it('el mismo alta dos veces a la vez: la segunda espera y devuelve el mismo registro', async () => {
    const { usuario, planta } = prepararPlanta()
    const clave = randomUUID()
    const a = abrirSesion('bitacora-a')
    const b = abrirSesion('bitacora-b')

    await correcto(a.ejecutar(inicioDePeticion(usuario)), 'A empieza')
    const deA = await correcto(
      a.ejecutar(registro(planta, clave, 'Riego'), { valor: true }),
      'A registra',
    )
    await correcto(b.ejecutar(inicioDePeticion(usuario)), 'B empieza')
    const deB = b.ejecutar(registro(planta, clave, 'Riego'), { valor: true })
    await esperarBloqueo(b, deB)
    await correcto(a.ejecutar('commit'), 'A confirma')
    const reintento = await correcto(deB, 'B reintenta')
    await correcto(b.ejecutar('commit'), 'B confirma')

    assert.match(deA.valor ?? '', /^[0-9a-f-]{36}$/)
    assert.equal(reintento.valor, deA.valor, 'el mismo registro')
    assert.equal(registrosCon(clave), '1')
  })

  it('si la primera se revierte, la segunda crea el registro', async () => {
    const { usuario, planta } = prepararPlanta()
    const clave = randomUUID()
    const a = abrirSesion('bitacora2-a')
    const b = abrirSesion('bitacora2-b')

    await correcto(a.ejecutar(inicioDePeticion(usuario)), 'A empieza')
    const deA = await correcto(
      a.ejecutar(registro(planta, clave, 'Riego'), { valor: true }),
      'A registra',
    )
    await correcto(b.ejecutar(inicioDePeticion(usuario)), 'B empieza')
    const deB = b.ejecutar(registro(planta, clave, 'Riego'), { valor: true })
    await esperarBloqueo(b, deB)
    await correcto(a.ejecutar('rollback'), 'A revierte')
    const reintento = await correcto(deB, 'B reintenta')
    await correcto(b.ejecutar('commit'), 'B confirma')

    assert.notEqual(reintento.valor, deA.valor)
    assert.equal(
      valor(
        `select id from public.plant_log_entries where idempotency_key = ${texto(clave)}`,
      ),
      reintento.valor,
    )
  })
})

describe('la séptima foto', () => {
  // Una planta con cinco fotos (posiciones 0 a 4): queda un solo hueco.
  function prepararPlanta() {
    const genero = valor(
      `insert into public.genera (name) values (${texto(nombreUnico('Fotographia'))}) returning id`,
    )
    const usuario = `user_${randomUUID().slice(0, 8)}`
    valor(
      `insert into public.profiles (id) values (${texto(usuario)}) returning id`,
    )
    const planta = valor(
      `insert into public.plants (user_id, entered_name, genus_id, type)
         values (${texto(usuario)}, 'Con fotos', ${texto(genero)}, 'unknown') returning id`,
    )
    valor(
      `insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
         select ${texto(planta)}, ${texto(`${usuario}/${planta}/photo-`)} || i || '.webp',
                ${texto(`${usuario}/${planta}/thumb-`)} || i || '.webp', i
         from generate_series(0, 4) i
       returning 1`,
    )
    return { usuario, planta }
  }

  const foto = (usuario, planta, posicion) => {
    const archivo = randomUUID()
    return `insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
      values (${texto(planta)}, ${texto(`${usuario}/${planta}/photo-${archivo}.webp`)},
              ${texto(`${usuario}/${planta}/thumb-${archivo}.webp`)}, ${posicion})`
  }

  const fotosDe = (planta) =>
    valor(
      `select count(*) from public.plant_photos where plant_id = ${texto(planta)}`,
    )

  after(cerrarSesiones)

  it('dos fotos a la vez en el último hueco: la segunda espera y falla; quedan seis', async () => {
    const { usuario, planta } = prepararPlanta()
    const a = abrirSesion('fotos-a')
    const b = abrirSesion('fotos-b')

    await correcto(a.ejecutar(inicioDePeticion(usuario)), 'A empieza')
    await correcto(a.ejecutar(foto(usuario, planta, 5)), 'A añade la sexta')
    await correcto(b.ejecutar(inicioDePeticion(usuario)), 'B empieza')
    const deB = b.ejecutar(foto(usuario, planta, 5))
    await esperarBloqueo(b, deB)
    await correcto(a.ejecutar('commit'), 'A confirma')
    falloCon(await deB, '23505', 'la séptima en el mismo hueco')
    await correcto(b.ejecutar('rollback'), 'B revierte')

    // Y en un hueco que no existe tampoco cabe.
    await correcto(b.ejecutar(inicioDePeticion(usuario)), 'B vuelve a empezar')
    falloCon(
      await b.ejecutar(foto(usuario, planta, 6)),
      '23514',
      'la séptima en la posición 6',
    )
    await correcto(b.ejecutar('rollback'), 'B revierte')

    assert.equal(fotosDe(planta), '6')
  })

  it('si la primera se revierte, la que esperaba ocupa el hueco', async () => {
    const { usuario, planta } = prepararPlanta()
    const a = abrirSesion('fotos2-a')
    const b = abrirSesion('fotos2-b')

    await correcto(a.ejecutar(inicioDePeticion(usuario)), 'A empieza')
    await correcto(a.ejecutar(foto(usuario, planta, 5)), 'A añade la sexta')
    await correcto(b.ejecutar(inicioDePeticion(usuario)), 'B empieza')
    const deB = b.ejecutar(foto(usuario, planta, 5))
    await esperarBloqueo(b, deB)
    await correcto(a.ejecutar('rollback'), 'A revierte')
    await correcto(deB, 'B añade la sexta')
    await correcto(b.ejecutar('commit'), 'B confirma')

    assert.equal(fotosDe(planta), '6')
  })
})
