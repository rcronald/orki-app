import type { CollectionGenus, CollectionPlant } from '../collection/model.ts'

// Colección de ejemplo para ver la pantalla de inventario en la página de
// muestra, sin base de datos ni sesión. Nombres reales del catálogo (especies,
// grex con y sin género híbrido, un híbrido natural), plantas por validar, dos
// dadas de baja (que no se cuentan) y apodos y orígenes verosímiles.

const genus = (id: string, name: string): CollectionGenus => ({ id, name })

const PHALAENOPSIS = genus('muestra-phal', 'Phalaenopsis')
const CATTLEYA = genus('muestra-catt', 'Cattleya')
const MASDEVALLIA = genus('muestra-masd', 'Masdevallia')
const ONCIDIUM = genus('muestra-onc', 'Oncidium')
const RLC = genus('muestra-rlc', '× Rhyncholaeliocattleya')
const DENDROBIUM = genus('muestra-den', 'Dendrobium')

let nextId = 1

/** Las tres primeras letras del género, sin «×» ni tildes, en mayúsculas. */
function codePrefix(genus: string): string {
  const letters = genus
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  return letters.slice(0, 3).padEnd(3, 'x').toUpperCase()
}

function samplePlant(
  data: Pick<CollectionPlant, 'displayName' | 'genus' | 'createdAt'> &
    Partial<CollectionPlant>,
): CollectionPlant {
  const id = `muestra-${String(nextId++).padStart(4, '0')}`
  const scientific = data.displayNameIsScientific ?? true
  return {
    id,
    displayNameIsScientific: scientific,
    enteredName: data.displayName,
    species: scientific
      ? {
          id: `especie-${id}`,
          scientificName: data.displayName,
          type: data.type === 'hybrid' ? 'hybrid' : 'species',
          status: 'validated',
        }
      : null,
    type: 'species',
    validation: scientific ? 'validated' : 'pending',
    status: 'active',
    acquiredOn: data.createdAt.slice(0, 10),
    updatedAt: data.createdAt,
    origin: null,
    location: null,
    nickname: null,
    flowerColor: null,
    photoInBloom: false,
    photoPath: null,
    thumbnailPath: null,
    photoCount: (data.photoPath ?? null) === null ? 0 : 1,
    // Como el de la base (#264): tres letras del género y un correlativo.
    code: `${codePrefix(data.genus.name)}-${String(nextId).padStart(3, '0')}`,
    notes: null,
    ...data,
  }
}

export const SAMPLE_COLLECTION: readonly CollectionPlant[] = [
  samplePlant({
    displayName: 'Phalaenopsis amabilis',
    genus: PHALAENOPSIS,
    nickname: 'La blanca de la sala',
    flowerColor: 'white',
    origin: 'Vivero Moyobamba',
    createdAt: '2026-11-19T15:00:00+00:00',
  }),
  samplePlant({
    displayName: 'Phalaenopsis Sogo Yukidian',
    genus: PHALAENOPSIS,
    flowerColor: 'white',
    type: 'hybrid',
    origin: 'Feria de orquídeas de Miraflores',
    createdAt: '2026-11-12T15:00:00+00:00',
  }),
  samplePlant({
    displayName: 'Phalaenopsis × intermedia',
    genus: PHALAENOPSIS,
    type: 'hybrid',
    createdAt: '2026-10-02T15:00:00+00:00',
  }),
  samplePlant({
    displayName: 'Cattleya maxima',
    genus: CATTLEYA,
    flowerColor: 'pink',
    nickname: 'Flor de mayo',
    origin: 'Orquídeas del Alto Mayo',
    createdAt: '2026-09-21T15:00:00+00:00',
  }),
  samplePlant({
    displayName: 'Cattleya rex',
    genus: CATTLEYA,
    createdAt: '2026-08-14T15:00:00+00:00',
  }),
  samplePlant({
    displayName: '× Rhyncholaeliocattleya Memoria Anna Balmores',
    genus: RLC,
    flowerColor: 'purple',
    type: 'hybrid',
    origin: 'Mercado de flores de Acho',
    createdAt: '2026-11-17T15:00:00+00:00',
  }),
  samplePlant({
    displayName: 'Masdevallia veitchiana',
    genus: MASDEVALLIA,
    flowerColor: 'orange',
    nickname: 'Wakanki',
    createdAt: '2026-07-03T15:00:00+00:00',
  }),
  samplePlant({
    displayName: 'la naranja del mercado',
    displayNameIsScientific: false,
    genus: MASDEVALLIA,
    origin: 'Mercado de flores de Acho',
    createdAt: '2026-11-08T15:00:00+00:00',
  }),
  samplePlant({
    displayName: 'Oncidium Sharry Baby',
    genus: ONCIDIUM,
    flowerColor: 'bicolor',
    type: 'hybrid',
    nickname: 'La de chocolate',
    createdAt: '2026-06-30T15:00:00+00:00',
  }),
  samplePlant({
    displayName: 'dendrobio del regalo',
    displayNameIsScientific: false,
    validation: 'unidentifiable',
    genus: DENDROBIUM,
    origin: 'Regalo de un familiar',
    createdAt: '2026-05-11T15:00:00+00:00',
  }),
  samplePlant({
    displayName: 'Dendrobium nobile',
    genus: DENDROBIUM,
    status: 'gifted',
    createdAt: '2026-11-20T09:00:00+00:00',
  }),
  samplePlant({
    displayName: 'Phalaenopsis schilleriana',
    genus: PHALAENOPSIS,
    status: 'lost',
    flowerColor: 'pink',
    origin: 'Vivero Moyobamba',
    createdAt: '2026-04-02T15:00:00+00:00',
  }),
]

// Orígenes de la colección grande: más de los que el panel de filtros enseña
// de entrada, para ver "Ver más".
const LARGE_ORIGINS = [
  'Vivero Moyobamba',
  'Feria de orquídeas de Miraflores',
  'Mercado de flores de Acho',
  'Orquídeas del Alto Mayo',
  'Intercambio con la asociación',
  'Vivero Los Andes',
  'Feria de Oxapampa',
  'Regalo de un familiar',
  'Tienda en línea',
  'Vivero San Isidro',
  'Exposición de Tarapoto',
  'Mercado de Surquillo',
]

/**
 * Colección grande para probar la fluidez (#96): `count` plantas repartidas
 * entre los géneros de la muestra, con fechas de alta distintas.
 */
export function largeSampleCollection(count = 300): CollectionPlant[] {
  const base = SAMPLE_COLLECTION.filter((plant) => plant.status === 'active')
  return Array.from({ length: count }, (_, index) => {
    const model = base[index % base.length] ?? SAMPLE_COLLECTION[0]
    if (model === undefined) throw new Error('Muestra vacía.')
    return {
      ...model,
      id: `muestra-grande-${String(index).padStart(4, '0')}`,
      nickname: `Ejemplar ${index + 1}`,
      origin: LARGE_ORIGINS[index % LARGE_ORIGINS.length] ?? null,
      createdAt: new Date(
        Date.UTC(2026, 10, 20) - index * 3_600_000,
      ).toISOString(),
    }
  })
}
