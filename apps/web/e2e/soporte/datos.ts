// Datos de partida del Supabase simulado (supabase-simulado.ts): un catálogo
// pequeño y la colección de la persona de prueba. Cada prueba recibe una copia
// nueva, así lo que escribe una no lo ve otra.

export const USUARIO = 'user_e2e'
export const ADMIN = 'user_admin_e2e'
export const OTRO_USUARIO = 'user_otro_e2e'

export type TipoDeEspecie = 'species' | 'hybrid'
export type TipoDePlanta = TipoDeEspecie | 'unknown'
export type EstadoDeEspecie = 'imported' | 'validated' | 'observed'
export type FuenteDeEspecie = 'col' | 'curated' | 'user_proposal' | 'gbif'

export interface Genero {
  id: string
  name: string
  is_quick_access: boolean
  abreviaturas: string[]
}

export interface Especie {
  id: string
  scientific_name: string
  genus_id: string
  type: TipoDeEspecie
  status: EstadoDeEspecie
  source: FuenteDeEspecie
  source_ref: string | null
  created_at: string
  updated_at: string
}

export interface NombreDeEspecie {
  id: string
  species_id: string
  name: string
  type: 'synonym' | 'common'
  language: string | null
}

export interface Planta {
  id: string
  user_id: string
  entered_name: string
  species_id: string | null
  genus_id: string
  type: TipoDePlanta
  validation: 'validated' | 'pending' | 'unidentifiable'
  status: 'active' | 'lost' | 'gifted'
  acquired_on: string
  origin: string | null
  location: string | null
  nickname: string | null
  flower_color:
    'white' | 'pink' | 'purple' | 'yellow' | 'orange' | 'bicolor' | null
  photo_in_bloom: boolean
  photo_path: string | null
  thumbnail_path: string | null
  created_at: string
  updated_at: string
}

export interface Catalogo {
  generos: Genero[]
  especies: Especie[]
  nombres: NombreDeEspecie[]
  plantas: Planta[]
}

const uuid = (grupo: number, n: number) =>
  `${String(grupo).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`

export const GENEROS = {
  cattleya: uuid(2, 1),
  dendrobium: uuid(2, 2),
  oncidium: uuid(2, 3),
  phalaenopsis: uuid(2, 4),
  vanda: uuid(2, 5),
  masdevallia: uuid(2, 6),
} as const

export const ESPECIES = {
  phalaenopsisAmabilis: uuid(1, 1),
  cattleyaMaxima: uuid(1, 2),
  dendrobiumNobile: uuid(1, 3),
  masdevalliaVeitchiana: uuid(1, 4),
  cattleyaTrianae: uuid(1, 5),
  vandaCoerulea: uuid(1, 6),
} as const

export const PLANTAS = {
  amabilis: uuid(3, 1),
  maxima: uuid(3, 2),
  nobile: uuid(3, 3),
  veitchiana: uuid(3, 4),
  porValidar: uuid(3, 5),
  perdida: uuid(3, 6),
  propuestaAjena: uuid(3, 7),
  propuestaAjena2: uuid(3, 8),
} as const

const CREADA = '2026-10-01T12:00:00.000Z'

function especie(
  id: string,
  scientific_name: string,
  genus_id: string,
  type: TipoDeEspecie = 'species',
): Especie {
  return {
    id,
    scientific_name,
    genus_id,
    type,
    status: 'validated',
    source: 'col',
    source_ref: null,
    created_at: CREADA,
    updated_at: CREADA,
  }
}

function planta(
  datos: Partial<Planta> &
    Pick<Planta, 'id' | 'entered_name' | 'genus_id' | 'acquired_on'>,
): Planta {
  return {
    user_id: USUARIO,
    species_id: null,
    type: 'species',
    validation: datos.species_id ? 'validated' : 'pending',
    status: 'active',
    origin: null,
    location: null,
    nickname: null,
    flower_color: null,
    photo_in_bloom: false,
    photo_path: null,
    thumbnail_path: null,
    created_at: `${datos.acquired_on}T12:00:00.000Z`,
    updated_at: `${datos.acquired_on}T12:00:00.000Z`,
    ...datos,
  }
}

/** Una copia nueva del catálogo y la colección de partida. */
export function catalogoInicial(): Catalogo {
  return {
    generos: [
      {
        id: GENEROS.cattleya,
        name: 'Cattleya',
        is_quick_access: true,
        abreviaturas: ['C.'],
      },
      {
        id: GENEROS.dendrobium,
        name: 'Dendrobium',
        is_quick_access: true,
        abreviaturas: ['Den.'],
      },
      {
        id: GENEROS.oncidium,
        name: 'Oncidium',
        is_quick_access: true,
        abreviaturas: ['Onc.'],
      },
      {
        id: GENEROS.phalaenopsis,
        name: 'Phalaenopsis',
        is_quick_access: true,
        abreviaturas: ['Phal.'],
      },
      {
        id: GENEROS.vanda,
        name: 'Vanda',
        is_quick_access: true,
        abreviaturas: ['V.'],
      },
      {
        id: GENEROS.masdevallia,
        name: 'Masdevallia',
        is_quick_access: false,
        abreviaturas: ['Masd.'],
      },
    ],
    especies: [
      especie(
        ESPECIES.phalaenopsisAmabilis,
        'Phalaenopsis amabilis',
        GENEROS.phalaenopsis,
      ),
      especie(ESPECIES.cattleyaMaxima, 'Cattleya maxima', GENEROS.cattleya),
      especie(
        ESPECIES.dendrobiumNobile,
        'Dendrobium nobile',
        GENEROS.dendrobium,
      ),
      especie(
        ESPECIES.masdevalliaVeitchiana,
        'Masdevallia veitchiana',
        GENEROS.masdevallia,
      ),
      especie(ESPECIES.cattleyaTrianae, 'Cattleya trianae', GENEROS.cattleya),
      especie(ESPECIES.vandaCoerulea, 'Vanda coerulea', GENEROS.vanda),
    ],
    nombres: [
      {
        id: uuid(4, 1),
        species_id: ESPECIES.phalaenopsisAmabilis,
        name: 'Phalaenopsis grandiflora',
        type: 'synonym',
        language: null,
      },
      {
        id: uuid(4, 2),
        species_id: ESPECIES.phalaenopsisAmabilis,
        name: 'Orquídea luna',
        type: 'common',
        language: 'es',
      },
      {
        id: uuid(4, 3),
        species_id: ESPECIES.cattleyaTrianae,
        name: 'Flor de mayo',
        type: 'common',
        language: 'es',
      },
    ],
    plantas: [
      planta({
        id: PLANTAS.amabilis,
        entered_name: 'Phalaenopsis amabilis',
        species_id: ESPECIES.phalaenopsisAmabilis,
        genus_id: GENEROS.phalaenopsis,
        acquired_on: '2026-03-14',
        origin: 'Vivero Los Andes',
        location: 'Ventana de la sala',
        nickname: 'La blanca',
        flower_color: 'white',
      }),
      planta({
        id: PLANTAS.maxima,
        entered_name: 'Cattleya maxima',
        species_id: ESPECIES.cattleyaMaxima,
        genus_id: GENEROS.cattleya,
        acquired_on: '2026-05-02',
        origin: 'Feria de Lima',
        flower_color: 'purple',
      }),
      planta({
        id: PLANTAS.nobile,
        entered_name: 'Dendrobium nobile',
        species_id: ESPECIES.dendrobiumNobile,
        genus_id: GENEROS.dendrobium,
        acquired_on: '2026-06-20',
        origin: 'Vivero Los Andes',
        flower_color: 'pink',
      }),
      planta({
        id: PLANTAS.veitchiana,
        entered_name: 'Masdevallia veitchiana',
        species_id: ESPECIES.masdevalliaVeitchiana,
        genus_id: GENEROS.masdevallia,
        acquired_on: '2026-07-11',
        flower_color: 'orange',
      }),
      planta({
        id: PLANTAS.porValidar,
        entered_name: 'Oncidium Sharry Baby',
        genus_id: GENEROS.oncidium,
        type: 'hybrid',
        acquired_on: '2026-08-05',
        origin: 'Intercambio',
      }),
      planta({
        id: PLANTAS.perdida,
        entered_name: 'Cattleya trianae',
        species_id: ESPECIES.cattleyaTrianae,
        genus_id: GENEROS.cattleya,
        acquired_on: '2025-12-01',
        status: 'lost',
      }),
      // De otra persona: no salen en la colección de USUARIO, sí en la cola de
      // propuestas del backoffice.
      planta({
        id: PLANTAS.propuestaAjena,
        user_id: OTRO_USUARIO,
        entered_name: 'Vanda Sansai Blue',
        genus_id: GENEROS.vanda,
        type: 'hybrid',
        acquired_on: '2026-09-01',
      }),
      planta({
        id: PLANTAS.propuestaAjena2,
        user_id: OTRO_USUARIO,
        entered_name: 'vanda sansai blue',
        genus_id: GENEROS.vanda,
        type: 'hybrid',
        acquired_on: '2026-09-15',
      }),
    ],
  }
}
