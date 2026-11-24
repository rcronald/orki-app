import { describe, expect, it, vi } from 'vitest'
import { fakeCollectionSource } from '../test/collection-source.ts'
import { plant } from '../test/collection.ts'
import { createCachedCollectionSource } from './cached-source.ts'
import type { ExtrasFetcher } from './extras-source.ts'
import { coverageOf, extrasStateOf } from './extras-state.ts'
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

/** La copia guardada de "userId", cuando la tenga. */
async function savedCopy(
  storage: ReturnType<typeof setup>['storage'],
  userId: string,
  check: (copy: LocalCopy | null) => void,
) {
  await vi.waitFor(async () => check(await storage.read(userId)))
}

describe('fuente con copia local', () => {
  it('entrega primero la copia y después lo de la red, y guarda lo nuevo', async () => {
    const { network, storage, source, onSaved } = setup()
    const old = [plant({ id: 'vieja' })]
    const fresh = [plant({ id: 'vieja' }), plant({ id: 'nueva' })]
    await storage.write(copyOf('user_a', old))
    source.setActiveUser('user_a')

    const { promise, provided } = load(source, 'user_a')
    // La copia se entrega antes de pedir la colección a la red.
    const request = await network.pending()
    expect(provided).toEqual([old])
    expect(source.getInfo()).toMatchObject({
      userId: 'user_a',
      savedAt: EARLIER,
      unreachable: null,
    })

    request.resolve(fresh)
    await expect(promise).resolves.toEqual(fresh)
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
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
  })

  it('entrega las plantas de la red sin esperar a los extras (#169)', async () => {
    let finishExtras: (extras: OwnershipExtras) => void = () => undefined
    const fetchExtras = vi.fn<ExtrasFetcher>(
      () =>
        new Promise<OwnershipExtras>((resolve) => {
          finishExtras = resolve
        }),
    )
    const { network, source } = setup({ fetchExtras })
    source.setActiveUser('user_a')
    const fresh = [plant({ id: 'nueva' })]
    const { promise, provided } = load(source, 'user_a')
    await network.respond(fresh)
    await vi.waitFor(() => expect(fetchExtras).toHaveBeenCalled())

    // Los extras siguen pendientes y las plantas ya están entregadas.
    expect(provided).toEqual([fresh])
    finishExtras(EXTRAS)
    await expect(promise).resolves.toEqual(fresh)
  })

  it('sin copia, no entrega nada provisional', async () => {
    const { network, source } = setup()
    source.setActiveUser('user_a')
    const { promise, provided } = load(source, 'user_a')
    const request = await network.pending()
    expect(provided).toEqual([])
    request.resolve([])
    await expect(promise).resolves.toEqual([])
  })

  it('sin conexión y con copia, devuelve la copia y lo marca', async () => {
    const { network, storage, source } = setup()
    const old = [plant({ id: 'vieja' })]
    await storage.write(copyOf('user_a', old))
    source.setActiveUser('user_a')

    const { promise } = load(source, 'user_a')
    await network.fail(new CollectionLoadError('offline'))
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
    await network.fail(new CollectionLoadError('offline'))
    await expect(promise).rejects.toMatchObject({ reason: 'offline' })
  })

  it('con otro fallo, rechaza aunque haya copia', async () => {
    const { network, storage, source } = setup()
    await storage.write(copyOf('user_a', [plant()]))
    source.setActiveUser('user_a')
    const { promise } = load(source, 'user_a')
    await network.fail(new CollectionLoadError('session-ended'))
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
    await network.respond(fresh)
    await expect(promise).resolves.toEqual(fresh)
    await savedCopy(storage, 'user_a', (saved) => {
      expect(saved?.plants).toEqual(fresh)
      expect(saved?.extras.speciesNames?.get('species-amabilis')).toHaveLength(
        1,
      )
    })
  })

  it('save() guarda los cambios hechos en la app con la fecha de la última lectura', async () => {
    const { network, storage, source } = setup()
    source.setActiveUser('user_a')
    const { promise } = load(source, 'user_a')
    await network.respond([plant({ id: 'una' })])
    await promise
    await savedCopy(storage, 'user_a', (saved) =>
      expect(saved?.plants).toHaveLength(1),
    )

    const changed = [plant({ id: 'una' }), plant({ id: 'otra' })]
    source.save('user_a', changed)
    await savedCopy(storage, 'user_a', (saved) =>
      expect(saved?.plants.map((item) => item.id)).toEqual(['una', 'otra']),
    )
    const saved = await storage.read('user_a')
    expect(saved?.savedAt).toBe(NOW.toISOString())
    expect(saved?.extras.genusAbbreviations?.size).toBe(1)
  })

  it('setActiveUser borra las copias de las demás cuentas', async () => {
    const { storage, source } = setup()
    await storage.write(copyOf('user_a', [plant()]))
    await storage.write(copyOf('user_b', [plant()]))
    source.setActiveUser('user_b')
    await vi.waitFor(() =>
      expect([...storage.copies.keys()]).toEqual(['user_b']),
    )

    source.setActiveUser(null)
    await vi.waitFor(() => expect(storage.copies.size).toBe(0))
  })

  it('una lectura de otra cuenta que termina tarde no guarda su copia', async () => {
    const { network, storage, source } = setup()
    const write = vi.spyOn(storage, 'write')
    source.setActiveUser('user_a')
    const { promise } = load(source, 'user_a')
    const request = await network.pending()
    source.setActiveUser(null)
    request.resolve([plant()])
    await promise
    source.save('user_a', [plant()])
    // Ni la lectura ni save() llegan a escribir: lo deciden antes del primer
    // await (no hace falta esperar para saber que no escribirán).
    expect(write).not.toHaveBeenCalled()
    expect(storage.copies.size).toBe(0)
  })

  it('la información de otra cuenta se olvida al cambiar de usuario', async () => {
    const { network, source } = setup()
    source.setActiveUser('user_a')
    const { promise } = load(source, 'user_a')
    await network.respond([])
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

  // Si los extras están completos para la colección que se ve (#274).
  describe('estado de los extras (#274)', () => {
    /** Lector de extras que queda pendiente hasta que la prueba responde. */
    function heldExtras() {
      const calls: {
        plants: readonly CollectionPlant[]
        resolve: (extras: OwnershipExtras) => void
        reject: (error: unknown) => void
      }[] = []
      const fetchExtras = vi.fn<ExtrasFetcher>(
        (plants) =>
          new Promise((resolve, reject) => {
            calls.push({ plants, resolve, reject })
          }),
      )
      return { calls, fetchExtras }
    }

    const stateOf = (
      source: ReturnType<typeof setup>['source'],
      plants: readonly CollectionPlant[],
    ) => {
      const info = source.getInfo()
      if (info === null) throw new Error('Sin información de la copia.')
      return extrasStateOf(plants, info.extrasCoverage, info.extrasRequest)
    }

    const AMABILIS = plant({ id: 'amabilis' })
    const RLC = plant({
      id: 'rlc',
      species: null,
      genus: { id: 'genus-rlc', name: 'Rhyncholaeliocattleya' },
    })

    it('primera visita: al entregar las plantas, los extras ya constan como pendientes', async () => {
      const extras = heldExtras()
      const { network, source } = setup({ fetchExtras: extras.fetchExtras })
      source.setActiveUser('user_a')
      // Lo que sabe una pantalla en el momento de recibir las plantas.
      const seen: (string | undefined)[] = []
      const promise = source.load({
        userId: 'user_a',
        signal: new AbortController().signal,
        provide: () => seen.push(source.getInfo()?.extrasRequest),
      })
      await network.respond([AMABILIS])
      await vi.waitFor(() => expect(extras.calls).toHaveLength(1))
      expect(seen).toEqual(['loading'])
      expect(source.getInfo()?.extrasCoverage).toBeNull()
      expect(stateOf(source, [AMABILIS])).toBe('pending')

      extras.calls[0].resolve(EXTRAS)
      await promise
      expect(source.getInfo()?.extrasRequest).toBe('idle')
      expect(stateOf(source, [AMABILIS])).toBe('complete')
    })

    it('si fallan, constan como fallidos y la copia conserva su cobertura anterior', async () => {
      const extras = heldExtras()
      const { network, storage, source } = setup({
        fetchExtras: extras.fetchExtras,
      })
      await storage.write({
        ...copyOf('user_a', [AMABILIS]),
        extrasCoverage: coverageOf([AMABILIS]),
      })
      source.setActiveUser('user_a')
      const { promise } = load(source, 'user_a')
      const request = await network.pending()
      // Con la copia, antes de la red: completos para sus plantas.
      expect(stateOf(source, [AMABILIS])).toBe('complete')

      request.resolve([AMABILIS, RLC])
      await vi.waitFor(() => expect(extras.calls).toHaveLength(1))
      expect(stateOf(source, [AMABILIS, RLC])).toBe('pending')
      extras.calls[0].reject(new TypeError('red'))
      await expect(promise).resolves.toEqual([AMABILIS, RLC])
      expect(source.getInfo()?.extrasRequest).toBe('failed')
      expect(stateOf(source, [AMABILIS, RLC])).toBe('failed')
      // Las plantas que ya estaban siguen completas.
      expect(stateOf(source, [AMABILIS])).toBe('complete')
      await savedCopy(storage, 'user_a', (saved) => {
        expect(saved?.plants).toEqual([AMABILIS, RLC])
        expect(saved?.extrasCoverage).toEqual(coverageOf([AMABILIS]))
      })
    })

    it('una copia de una versión anterior (sin cobertura) no da sus extras por completos', async () => {
      const { network, storage, source } = setup()
      await storage.write(copyOf('user_a', [AMABILIS]))
      source.setActiveUser('user_a')
      const { promise } = load(source, 'user_a')
      const request = await network.pending()
      expect(stateOf(source, [AMABILIS])).toBe('outdated')
      request.reject(new CollectionLoadError('offline'))
      await promise
      expect(stateOf(source, [AMABILIS])).toBe('outdated')
    })

    it('ensureExtras pide solo los que faltan, los añade y los guarda en la copia', async () => {
      const { network, storage, source, fetchExtras } = setup()
      source.setActiveUser('user_a')
      const { promise } = load(source, 'user_a')
      await network.respond([AMABILIS])
      await promise
      vi.mocked(fetchExtras).mockClear()

      // Una planta registrada en la app, de un género nuevo.
      source.save('user_a', [AMABILIS, RLC])
      expect(stateOf(source, [AMABILIS, RLC])).toBe('outdated')
      vi.mocked(fetchExtras).mockResolvedValueOnce({
        speciesNames: new Map(),
        genusAbbreviations: new Map([['genus-rlc', ['Rlc.']]]),
      })
      source.ensureExtras('user_a', [AMABILIS, RLC])
      expect(fetchExtras).toHaveBeenCalledTimes(1)
      expect(vi.mocked(fetchExtras).mock.calls[0][0]).toEqual([RLC])
      expect(stateOf(source, [AMABILIS, RLC])).toBe('pending')

      await vi.waitFor(() =>
        expect(stateOf(source, [AMABILIS, RLC])).toBe('complete'),
      )
      const info = source.getInfo()
      expect(info?.extras.genusAbbreviations?.get('genus-rlc')).toEqual([
        'Rlc.',
      ])
      // Los de antes siguen.
      expect(info?.extras.genusAbbreviations?.get('genus-phal')).toEqual([
        'Phal.',
      ])
      await savedCopy(storage, 'user_a', (saved) => {
        expect(saved?.plants).toEqual([AMABILIS, RLC])
        expect(saved?.extras.genusAbbreviations?.get('genus-rlc')).toEqual([
          'Rlc.',
        ])
        expect(saved?.extrasCoverage).toEqual(coverageOf([AMABILIS, RLC]))
      })
      // Completos: no pide nada más.
      source.ensureExtras('user_a', [AMABILIS, RLC])
      expect(fetchExtras).toHaveBeenCalledTimes(1)
    })

    it('ensureExtras no insiste tras un fallo salvo con force, ni sin sesión confirmada', async () => {
      const extras = heldExtras()
      const { network, source } = setup({ fetchExtras: extras.fetchExtras })
      source.setActiveUser('user_a')
      const { promise } = load(source, 'user_a')
      await network.respond([AMABILIS])
      await vi.waitFor(() => expect(extras.calls).toHaveLength(1))
      // En curso: no se piden dos veces.
      source.ensureExtras('user_a', [AMABILIS], { force: true })
      expect(extras.calls).toHaveLength(1)
      extras.calls[0].reject(new TypeError('red'))
      await promise

      source.ensureExtras('user_a', [AMABILIS])
      expect(extras.calls).toHaveLength(1)
      source.setVerified(false)
      source.ensureExtras('user_a', [AMABILIS], { force: true })
      expect(extras.calls).toHaveLength(1)
      source.setVerified(true)
      source.ensureExtras('user_a', [AMABILIS], { force: true })
      expect(extras.calls).toHaveLength(2)
      expect(stateOf(source, [AMABILIS])).toBe('pending')
      extras.calls[1].resolve(EXTRAS)
      await vi.waitFor(() =>
        expect(stateOf(source, [AMABILIS])).toBe('complete'),
      )
    })

    it('los extras pedidos para otra cuenta se descartan', async () => {
      const extras = heldExtras()
      const { network, source } = setup({ fetchExtras: extras.fetchExtras })
      source.setActiveUser('user_a')
      const { promise } = load(source, 'user_a')
      await network.respond([AMABILIS])
      await vi.waitFor(() => expect(extras.calls).toHaveLength(1))
      extras.calls[0].resolve({})
      await promise
      source.save('user_a', [AMABILIS, RLC])
      source.ensureExtras('user_a', [AMABILIS, RLC])
      expect(extras.calls).toHaveLength(2)

      source.setActiveUser('user_b')
      const listener = vi.fn()
      source.subscribe(listener)
      extras.calls[1].resolve(EXTRAS)
      // La respuesta llega (la promesa ya se cumplió) y no cambia nada.
      await expect(
        extras.fetchExtras.mock.results[1]?.value,
      ).resolves.toBeDefined()
      expect(source.getInfo()).toBeNull()
      expect(listener).not.toHaveBeenCalled()
    })
  })
})
