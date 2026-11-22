import { describe, expect, it, vi } from 'vitest'
import { plant } from '../test/collection.ts'
import { fakeCollectionSource } from '../test/collection-source.ts'
import { CollectionLoadError } from './source.ts'
import { CollectionStore } from './store.ts'

function setup(userId: string | null = 'user_a') {
  const source = fakeCollectionSource()
  const store = new CollectionStore(source)
  store.setUser(userId)
  return { source, store }
}

/** Deja correr las promesas pendientes (la respuesta de la fuente). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('CollectionStore: carga bajo demanda', () => {
  it('no lee nada hasta que alguien la retiene', () => {
    const { source, store } = setup()

    expect(store.getSnapshot()).toEqual({
      userId: 'user_a',
      status: 'idle',
      plants: null,
      error: null,
    })
    expect(source.loads).toHaveLength(0)
  })

  it('la primera retención la carga, con el usuario y una señal de aborto', async () => {
    const { source, store } = setup()
    store.retain()

    expect(store.getSnapshot().status).toBe('loading')
    expect(source.loads).toHaveLength(1)
    expect(source.last().request.userId).toBe('user_a')
    expect(source.last().request.signal.aborted).toBe(false)

    const plants = [plant()]
    source.last().resolve(plants)
    await settle()

    expect(store.getSnapshot()).toEqual({
      userId: 'user_a',
      status: 'ready',
      plants,
      error: null,
    })
  })

  it('varias retenciones comparten la misma lectura y los datos', async () => {
    const { source, store } = setup()
    store.retain()
    store.retain()
    source.last().resolve([])
    await settle()
    const release = store.retain()
    release()
    store.retain()

    expect(source.loads).toHaveLength(1)
  })

  it('soltar todas las retenciones no aborta ni descarta nada', async () => {
    const { source, store } = setup()
    const release = store.retain()
    release()
    release() // Soltar dos veces no descuenta dos.

    expect(source.last().request.signal.aborted).toBe(false)
    source.last().resolve([plant()])
    await settle()
    expect(store.getSnapshot().status).toBe('ready')

    store.retain()
    expect(source.loads).toHaveLength(1)
  })

  it('sin usuario no lee; al fijarlo, carga si ya se necesitaba', () => {
    const { source, store } = setup(null)
    store.retain()
    expect(source.loads).toHaveLength(0)

    store.setUser('user_a')
    expect(source.loads).toHaveLength(1)
  })

  it('notifica a los suscriptores en cada cambio', async () => {
    const { source, store } = setup()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.retain()
    expect(listener).toHaveBeenCalledTimes(1)
    source.last().resolve([])
    await settle()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    store.reload()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('CollectionStore: cambio de usuario', () => {
  it('descarta los datos del usuario anterior', async () => {
    const { source, store } = setup()
    store.retain()
    source.last().resolve([plant()])
    await settle()

    store.setUser('user_b')
    // Sigue habiendo una pantalla que la necesita: se lee la del nuevo.
    expect(store.getSnapshot()).toMatchObject({
      userId: 'user_b',
      status: 'loading',
      plants: null,
    })
    expect(source.last().request.userId).toBe('user_b')
  })

  it('al cerrar sesión, descarta todo', async () => {
    const { source, store } = setup()
    store.retain()
    source.last().resolve([plant()])
    await settle()

    store.setUser(null)
    expect(store.getSnapshot()).toEqual({
      userId: null,
      status: 'idle',
      plants: null,
      error: null,
    })
  })

  it('aborta la lectura en curso e ignora su respuesta tardía', async () => {
    const { source, store } = setup()
    store.retain()
    const fromA = source.last()

    store.setUser('user_b')
    expect(fromA.request.signal.aborted).toBe(true)
    const fromB = source.last()

    // La fuente de A responde igualmente, tarde: no se mezcla con B.
    fromA.resolve([plant({ id: 'de-a' })])
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      userId: 'user_b',
      status: 'loading',
      plants: null,
    })

    const plantsB = [plant({ id: 'de-b' })]
    fromB.resolve(plantsB)
    await settle()
    expect(store.getSnapshot().plants).toBe(plantsB)
  })

  it('un error tardío del usuario anterior también se ignora', async () => {
    const { source, store } = setup()
    store.retain()
    const fromA = source.last()
    store.setUser('user_b')

    fromA.reject(new CollectionLoadError('session-ended'))
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      status: 'loading',
      error: null,
    })
  })

  it('volver a fijar el mismo usuario no hace nada', async () => {
    const { source, store } = setup()
    store.retain()
    source.last().resolve([plant()])
    await settle()
    const before = store.getSnapshot()

    store.setUser('user_a')
    expect(store.getSnapshot()).toBe(before)
    expect(source.loads).toHaveLength(1)
  })
})

describe('CollectionStore: errores y recarga', () => {
  it.each(['offline', 'session-ended', 'failed'] as const)(
    'error con motivo %s',
    async (reason) => {
      const { source, store } = setup()
      store.retain()
      source.last().reject(new CollectionLoadError(reason))
      await settle()

      const { status, error, plants } = store.getSnapshot()
      expect(status).toBe('error')
      expect(error?.reason).toBe(reason)
      expect(plants).toBeNull()
    },
  )

  it('cualquier otro error de la fuente es un fallo', async () => {
    const { source, store } = setup()
    store.retain()
    const cause = new Error('inesperado')
    source.last().reject(cause)
    await settle()

    const { error } = store.getSnapshot()
    expect(error).toBeInstanceOf(CollectionLoadError)
    expect(error?.reason).toBe('failed')
    expect(error?.cause).toBe(cause)
  })

  it('tras un error no se reintenta solo; reload() sí', async () => {
    const { source, store } = setup()
    store.retain()
    source.last().reject(new CollectionLoadError('offline'))
    await settle()

    store.retain()
    expect(source.loads).toHaveLength(1)

    store.reload()
    expect(store.getSnapshot()).toMatchObject({
      status: 'loading',
      error: null,
    })
    const plants = [plant()]
    source.last().resolve(plants)
    await settle()
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', plants })
  })

  it('reload() conserva los datos mientras lee y los sustituye al terminar', async () => {
    const { source, store } = setup()
    store.retain()
    const first = [plant()]
    source.last().resolve(first)
    await settle()

    store.reload()
    expect(source.loads).toHaveLength(2)
    expect(store.getSnapshot()).toMatchObject({
      status: 'loading',
      plants: first,
    })

    const second = [plant(), plant()]
    source.last().resolve(second)
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      status: 'ready',
      plants: second,
    })
  })

  it('una recarga fallida conserva los datos anteriores', async () => {
    const { source, store } = setup()
    store.retain()
    const first = [plant()]
    source.last().resolve(first)
    await settle()

    store.reload()
    source.last().reject(new CollectionLoadError('offline'))
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      status: 'error',
      plants: first,
      error: { reason: 'offline' },
    })
  })

  it('reload() en plena lectura aborta la anterior e ignora su respuesta', async () => {
    const { source, store } = setup()
    store.retain()
    const first = source.last()
    store.reload()

    expect(first.request.signal.aborted).toBe(true)
    first.resolve([plant({ id: 'vieja' })])
    await settle()
    expect(store.getSnapshot().status).toBe('loading')

    const fresh = [plant({ id: 'nueva' })]
    source.last().resolve(fresh)
    await settle()
    expect(store.getSnapshot().plants).toBe(fresh)
  })

  it('reload() sin usuario no hace nada', () => {
    const { source, store } = setup(null)
    store.reload()
    expect(source.loads).toHaveLength(0)
  })
})

describe('CollectionStore: actualización en segundo plano (#141)', () => {
  it('refresh() vuelve a leer sin pasar por loading y cambia los datos al llegar', async () => {
    const { source, store } = setup()
    store.retain()
    const first = [plant({ id: 'a', validation: 'pending' })]
    source.last().resolve(first)
    await settle()

    store.refresh()
    expect(source.loads).toHaveLength(2)
    expect(store.getSnapshot()).toMatchObject({
      status: 'ready',
      plants: first,
    })

    const second = [plant({ id: 'a', validation: 'unidentifiable' })]
    source.last().resolve(second)
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      status: 'ready',
      plants: second,
      error: null,
    })
  })

  it('si falla, no muestra ningún error y conserva los datos', async () => {
    const { source, store } = setup()
    store.retain()
    const first = [plant()]
    source.last().resolve(first)
    await settle()

    store.refresh()
    source.last().reject(new CollectionLoadError('offline'))
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      status: 'ready',
      plants: first,
      error: null,
    })
  })

  it('una operación local durante la lectura de fondo no se pierde al llegar', async () => {
    const { source, store } = setup()
    store.retain()
    source.last().resolve([plant({ id: 'a' })])
    await settle()

    store.refresh()
    const added = plant({ id: 'b' })
    store.upsertPlant(added)
    // La respuesta salió antes de la escritura: no la trae.
    source.last().resolve([plant({ id: 'a' })])
    await settle()
    expect(store.getSnapshot().plants?.map((item) => item.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('sin datos listos no hace nada', async () => {
    const { source, store } = setup()
    store.refresh()
    expect(source.loads).toHaveLength(0)
    store.retain()
    store.refresh()
    expect(source.loads).toHaveLength(1)
    source.last().reject(new CollectionLoadError('failed'))
    await settle()
    store.refresh()
    expect(source.loads).toHaveLength(1)
  })
})

describe('CollectionStore: resultado provisional', () => {
  it('muestra el provisional mientras llega el definitivo', async () => {
    const { source, store } = setup()
    store.retain()
    const cached = [plant({ id: 'de-la-cache' })]
    source.last().request.provide(cached)

    expect(store.getSnapshot()).toMatchObject({
      status: 'loading',
      plants: cached,
    })

    const fresh = [plant({ id: 'de-la-red' })]
    source.last().resolve(fresh)
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      status: 'ready',
      plants: fresh,
    })
  })

  it('si el definitivo falla, se queda el provisional con el error', async () => {
    const { source, store } = setup()
    store.retain()
    const cached = [plant()]
    source.last().request.provide(cached)
    source.last().reject(new CollectionLoadError('offline'))
    await settle()

    expect(store.getSnapshot()).toMatchObject({
      status: 'error',
      plants: cached,
      error: { reason: 'offline' },
    })
  })

  it('un provisional de una lectura que ya no es la actual se ignora', () => {
    const { source, store } = setup()
    store.retain()
    const fromA = source.last()
    store.setUser('user_b')

    fromA.request.provide([plant()])
    expect(store.getSnapshot().plants).toBeNull()
  })
})

describe('CollectionStore: operaciones locales', () => {
  async function loaded() {
    const context = setup()
    context.store.retain()
    const a = plant({ id: 'a', nickname: 'Antes' })
    const b = plant({ id: 'b' })
    context.source.last().resolve([a, b])
    await settle()
    return { ...context, a, b }
  }

  it('upsertPlant añade una planta nueva al final', async () => {
    const { store, a, b } = await loaded()
    const c = plant({ id: 'c' })
    store.upsertPlant(c)

    expect(store.getSnapshot().plants).toEqual([a, b, c])
  })

  it('upsertPlant sustituye la planta con el mismo id, en su sitio', async () => {
    const { store, b } = await loaded()
    const edited = plant({ id: 'a', nickname: 'Después' })
    store.upsertPlant(edited)

    expect(store.getSnapshot().plants).toEqual([edited, b])
  })

  it('removePlant quita la planta; un id que no está no cambia nada', async () => {
    const { store, b } = await loaded()
    store.removePlant('a')
    expect(store.getSnapshot().plants).toEqual([b])

    store.removePlant('no-existe')
    expect(store.getSnapshot().plants).toEqual([b])
  })

  it('no vuelve a leer la colección', async () => {
    const { source, store } = await loaded()
    store.upsertPlant(plant())
    store.removePlant('a')

    expect(source.loads).toHaveLength(1)
    expect(store.getSnapshot().status).toBe('ready')
  })

  it('no modifica la lista anterior (los datos son inmutables)', async () => {
    const { store } = await loaded()
    const before = store.getSnapshot().plants
    store.upsertPlant(plant({ id: 'c' }))

    expect(store.getSnapshot().plants).not.toBe(before)
    expect(before).toHaveLength(2)
  })

  it('sin datos ni lectura en curso, se ignoran', () => {
    const { store } = setup()
    store.upsertPlant(plant())
    store.removePlant('a')

    expect(store.getSnapshot()).toMatchObject({ status: 'idle', plants: null })
  })

  it('durante una lectura, se aplican sobre su resultado', async () => {
    const { source, store } = setup()
    store.retain()
    const created = plant({ id: 'nueva' })
    const edited = plant({ id: 'a', nickname: 'Editada' })
    store.upsertPlant(created)
    store.upsertPlant(edited)
    store.removePlant('borrada')

    // La respuesta salió antes de las escrituras: trae la versión vieja de
    // "a", la borrada y no trae la nueva.
    source
      .last()
      .resolve([
        plant({ id: 'a', nickname: 'Vieja' }),
        plant({ id: 'borrada' }),
      ])
    await settle()

    expect(store.getSnapshot().plants).toEqual([edited, created])
  })

  it('durante una lectura, también sobre el provisional', () => {
    const { source, store } = setup()
    store.retain()
    source.last().request.provide([plant({ id: 'a' })])
    const created = plant({ id: 'nueva' })
    store.upsertPlant(created)

    expect(store.getSnapshot().plants?.map((p) => p.id)).toEqual(['a', 'nueva'])
  })

  it('las de una lectura descartada no pasan a la del usuario siguiente', async () => {
    const { source, store } = setup()
    store.retain()
    store.upsertPlant(plant({ id: 'de-a' }))
    store.setUser('user_b')

    source.last().resolve([])
    await settle()
    expect(store.getSnapshot().plants).toEqual([])
  })

  it('tras una recarga fallida, se aplican sobre los datos que se ven', async () => {
    const { source, store, b } = await loaded()
    store.reload()
    source.last().reject(new CollectionLoadError('offline'))
    await settle()

    store.removePlant('a')
    expect(store.getSnapshot()).toMatchObject({ status: 'error', plants: [b] })
  })
})

describe('CollectionStore: copia local (#18)', () => {
  function setupWithSave() {
    const save = vi.fn<(userId: string, plants: readonly unknown[]) => void>()
    const source = Object.assign(fakeCollectionSource(), { save })
    const store = new CollectionStore(source)
    store.setUser('user_a')
    return { source, store, save }
  }

  it('pasa la colección completa a save() tras cada cambio local', async () => {
    const { source, store, save } = setupWithSave()
    store.retain()
    source.last().resolve([plant({ id: 'a' })])
    await settle()
    expect(save).not.toHaveBeenCalled()

    store.upsertPlant(plant({ id: 'b' }))
    expect(save).toHaveBeenLastCalledWith('user_a', store.getSnapshot().plants)
    store.removePlant('a')
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.lastCall?.[1]).toHaveLength(1)
  })

  it('un cambio durante la lectura se guarda al terminar, con el resultado', async () => {
    const { source, store, save } = setupWithSave()
    store.retain()
    store.upsertPlant(plant({ id: 'nueva' }))
    expect(save).not.toHaveBeenCalled()
    source.last().resolve([plant({ id: 'a' })])
    await settle()
    expect(save).toHaveBeenCalledTimes(1)
    expect(
      (save.mock.lastCall?.[1] as { id: string }[]).map((item) => item.id),
    ).toEqual(['a', 'nueva'])
  })

  it('tras un error no guarda: lo que hay en memoria puede estar incompleto', async () => {
    const { source, store, save } = setupWithSave()
    store.retain()
    source.last().request.provide([plant({ id: 'a' })])
    source.last().reject(new CollectionLoadError('failed'))
    await settle()
    store.upsertPlant(plant({ id: 'b' }))
    expect(save).not.toHaveBeenCalled()
  })

  it('resume() (al recuperar la conexión): en segundo plano con datos; tras un error, una lectura normal; sin pedir, nada', async () => {
    const { source, store } = setup()
    store.resume()
    expect(source.loads).toHaveLength(0)

    store.retain()
    // Con una lectura en curso, no la repite.
    store.resume()
    expect(source.loads).toHaveLength(1)
    source.last().reject(new CollectionLoadError('offline'))
    await settle()
    expect(store.getSnapshot().status).toBe('error')

    // Tras el error: se vuelve a leer, con su carga.
    store.resume()
    expect(source.loads).toHaveLength(2)
    expect(store.getSnapshot().status).toBe('loading')
    source.last().resolve([plant()])
    await settle()

    // Con datos: en segundo plano, como refresh() (#141).
    store.resume()
    expect(source.loads).toHaveLength(3)
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', error: null })
    expect(store.getSnapshot().plants).toHaveLength(1)
  })

  it('un cambio local durante la lectura de fondo se guarda también al terminar', async () => {
    const { source, store, save } = setupWithSave()
    store.retain()
    source.last().resolve([plant({ id: 'a' })])
    await settle()
    store.refresh()
    store.upsertPlant(plant({ id: 'b' }))
    expect(save).toHaveBeenCalledTimes(1)
    source.last().resolve([plant({ id: 'a' })])
    await settle()
    expect(save).toHaveBeenCalledTimes(2)
    expect(
      (save.mock.lastCall?.[1] as { id: string }[]).map((item) => item.id),
    ).toEqual(['a', 'b'])
  })
})
