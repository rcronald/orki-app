import { describe, expect, it, vi } from 'vitest'
import { fakeCollectionSource } from '../test/collection-source.ts'
import { plant } from '../test/collection.ts'
import { createCachedCollectionSource } from './cached-source.ts'
import type { ExtrasFetcher } from './extras-source.ts'
import { createMemoryCopyStorage, type LocalCopy } from './local-copy.ts'
import type { CollectionPlant } from './model.ts'
import type { OwnershipExtras } from './ownership.ts'
import { CollectionLoadError } from './source.ts'

const NOW = new Date('2026-11-21T12:00:00.000Z')
const EARLIER = '2026-11-20T08:00:00.000Z'

const EXTRAS: OwnershipExtras = {
  speciesNames: new Map([
    ['species-amabilis', [{ name: 'Orquídea mariposa', type: 'common' }]],
  ]),
  genusAbbreviations: new Map([['genus-phal', ['Phal.']]]),
}

function setup({
  fetchExtras = vi.fn<ExtrasFetcher>(() => Promise.resolve(EXTRAS)),
}: { fetchExtras?: ExtrasFetcher } = {}) {
  const network = fakeCollectionSource()
  const storage = createMemoryCopyStorage()
  const onSaved = vi.fn()
  const source = createCachedCollectionSource({
    network,
    storage,
    fetchExtras,
    now: () => NOW,
    onSaved,
  })
  return { network, storage, source, onSaved, fetchExtras }
}

function copyOf(userId: string, plants: readonly CollectionPlant[]): LocalCopy {
  return { userId, savedAt: EARLIER, plants, extras: EXTRAS }
}

function load(
  source: ReturnType<typeof setup>['source'],
  userId: string,
  { signal = new AbortController().signal } = {},
) {
  const provided: (readonly CollectionPlant[])[] = []
  const promise = source.load({
    userId,
    signal,
    provide: (plants) => provided.push(plants),
  })
  return { promise, provided }
}

/** Deja correr las promesas pendientes (lecturas de la copia en memoria). */
async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

describe('fuente con copia local', () => {
  it('entrega primero la copia y después lo de la red, y guarda lo nuevo', async () => {
    const { network, storage, source, onSaved } = setup()
    const old = [plant({ id: 'vieja' })]
    const fresh = [plant({ id: 'vieja' }), plant({ id: 'nueva' })]
    await storage.write(copyOf('user_a', old))
    source.setActiveUser('user_a')

    const { promise, provided } = load(source, 'user_a')
    await flush()
    expect(provided).toEqual([old])
    expect(source.getInfo()).toMatchObject({
      userId: 'user_a',
      savedAt: EARLIER,
      unreachable: null,
    })

    network.last().resolve(fresh)
    await expect(promise).resolves.toEqual(fresh)
    await flush()
    const saved = await storage.read('user_a')
    expect(saved?.plants).toEqual(fresh)
    expect(saved?.savedAt).toBe(NOW.toISOString())
    expect(saved?.extras.genusAbbreviations?.get('genus-phal')).toEqual([
      'Phal.',
    ])
    expect(source.getInfo()).toMatchObject({
      savedAt: NOW.toISOString(),
      unreachable: null,
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('entrega las plantas de la red sin esperar a los extras (#169)', async () => {
    let finishExtras: (extras: OwnershipExtras) => void = () => undefined
    const { network, source } = setup({
      fetchExtras: () =>
        new Promise<OwnershipExtras>((resolve) => {
          finishExtras = resolve
        }),
    })
    source.setActiveUser('user_a')
    const fresh = [plant({ id: 'nueva' })]
    const { promise, provided } = load(source, 'user_a')
    await flush()
    network.last().resolve(fresh)
    await flush()

    // Los extras siguen pendientes y las plantas ya están entregadas.
    expect(provided).toEqual([fresh])
    finishExtras(EXTRAS)
    await expect(promise).resolves.toEqual(fresh)
  })

  it('sin copia, no entrega nada provisional', async () => {
    const { network, source } = setup()
    source.setActiveUser('user_a')
    const { promise, provided } = load(source, 'user_a')
    await flush()
    expect(provided).toEqual([])
    network.last().resolve([])
    await expect(promise).resolves.toEqual([])
  })

  it('sin conexión y con copia, devuelve la copia y lo marca', async () => {
    const { network, storage, source } = setup()
    const old = [plant({ id: 'vieja' })]
    await storage.write(copyOf('user_a', old))
    source.setActiveUser('user_a')

    const { promise } = load(source, 'user_a')
    await flush()
    network.last().reject(new CollectionLoadError('offline'))
    await expect(promise).resolves.toEqual(old)
    expect(source.getInfo()).toMatchObject({
      savedAt: EARLIER,
      unreachable: 'offline',
    })
    expect(
      source.getInfo()?.extras.genusAbbreviations?.get('genus-phal'),
    ).toEqual(['Phal.'])
  })

  it('sin conexión y sin copia, rechaza como la red', async () => {
    const { network, source } = setup()
    source.setActiveUser('user_a')
    const { promise } = load(source, 'user_a')
    await flush()
    network.last().reject(new CollectionLoadError('offline'))
    await expect(promise).rejects.toMatchObject({ reason: 'offline' })
  })

  it('con otro fallo, rechaza aunque haya copia', async () => {
    const { network, storage, source } = setup()
    await storage.write(copyOf('user_a', [plant()]))
    source.setActiveUser('user_a')
    const { promise } = load(source, 'user_a')
    await flush()
    network.last().reject(new CollectionLoadError('session-ended'))
    await expect(promise).rejects.toMatchObject({ reason: 'session-ended' })
  })

  it('si los extras fallan, guarda las plantas con los extras anteriores', async () => {
    const { network, storage, source } = setup({
      fetchExtras: () => Promise.reject(new Error('sin red')),
    })
    await storage.write(copyOf('user_a', []))
    source.setActiveUser('user_a')
    const fresh = [plant({ id: 'nueva' })]
    const { promise } = load(source, 'user_a')
    await flush()
    network.last().resolve(fresh)
    await expect(promise).resolves.toEqual(fresh)
    await flush()
    const saved = await storage.read('user_a')
    expect(saved?.plants).toEqual(fresh)
    expect(saved?.extras.speciesNames?.get('species-amabilis')).toHaveLength(1)
  })

  it('save() guarda los cambios hechos en la app con la fecha de la última lectura', async () => {
    const { network, storage, source } = setup()
    source.setActiveUser('user_a')
    const { promise } = load(source, 'user_a')
    await flush()
    network.last().resolve([plant({ id: 'una' })])
    await promise
    await flush()

    const changed = [plant({ id: 'una' }), plant({ id: 'otra' })]
    source.save('user_a', changed)
    await flush()
    const saved = await storage.read('user_a')
    expect(saved?.plants.map((item) => item.id)).toEqual(['una', 'otra'])
    expect(saved?.savedAt).toBe(NOW.toISOString())
    expect(saved?.extras.genusAbbreviations?.size).toBe(1)
  })

  it('setActiveUser borra las copias de las demás cuentas', async () => {
    const { storage, source } = setup()
    await storage.write(copyOf('user_a', [plant()]))
    await storage.write(copyOf('user_b', [plant()]))
    source.setActiveUser('user_b')
    await flush()
    expect([...storage.copies.keys()]).toEqual(['user_b'])

    source.setActiveUser(null)
    await flush()
    expect(storage.copies.size).toBe(0)
  })

  it('una lectura de otra cuenta que termina tarde no guarda su copia', async () => {
    const { network, storage, source } = setup()
    source.setActiveUser('user_a')
    const { promise } = load(source, 'user_a')
    await flush()
    source.setActiveUser(null)
    network.last().resolve([plant()])
    await promise
    await flush()
    expect(storage.copies.size).toBe(0)
    source.save('user_a', [plant()])
    await flush()
    expect(storage.copies.size).toBe(0)
  })

  it('la información de otra cuenta se olvida al cambiar de usuario', async () => {
    const { network, source } = setup()
    source.setActiveUser('user_a')
    const { promise } = load(source, 'user_a')
    await flush()
    network.last().resolve([])
    await promise
    expect(source.getInfo()?.userId).toBe('user_a')
    const listener = vi.fn()
    source.subscribe(listener)
    source.setActiveUser('user_b')
    expect(source.getInfo()).toBeNull()
    expect(listener).toHaveBeenCalled()
  })

  it('cancelada, no entrega la copia', async () => {
    const { storage, source } = setup()
    await storage.write(copyOf('user_a', [plant()]))
    source.setActiveUser('user_a')
    const controller = new AbortController()
    controller.abort()
    const { promise, provided } = load(source, 'user_a', {
      signal: controller.signal,
    })
    await expect(promise).rejects.toBeDefined()
    expect(provided).toEqual([])
  })

  it('sin la sesión confirmada no pide nada a la red: solo la copia', async () => {
    const { network, storage, source } = setup()
    const old = [plant({ id: 'vieja' })]
    await storage.write(copyOf('user_a', old))
    source.setActiveUser('user_a')
    source.setVerified(false)
    const { promise } = load(source, 'user_a')
    await expect(promise).resolves.toEqual(old)
    expect(network.loads).toHaveLength(0)
    expect(source.getInfo()?.unreachable).toBe('offline')
    expect((await storage.read('user_a'))?.plants).toEqual(old)

    await storage.deleteExcept(null)
    await expect(load(source, 'user_a').promise).rejects.toMatchObject({
      reason: 'offline',
    })
  })
})
