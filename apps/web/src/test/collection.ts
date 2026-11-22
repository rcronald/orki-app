import type {
  CollectionPlant,
  CollectionPlantRow,
} from '../collection/model.ts'

// Datos de prueba de la colección: filas como las devuelve PostgREST y plantas
// del modelo en memoria, con valores por defecto que cada prueba sobrescribe.

export const PHALAENOPSIS = { id: 'genus-phal', name: 'Phalaenopsis' }
export const CATTLEYA = { id: 'genus-catt', name: 'Cattleya' }
export const RHYNCHOLAELIOCATTLEYA = {
  id: 'genus-rlc',
  name: '× Rhyncholaeliocattleya',
}

/** Fila de plants con su especie y su género embebidos. */
export function plantRow(
  overrides: Partial<CollectionPlantRow> = {},
): CollectionPlantRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    entered_name: 'phalaenopsis amabilis',
    type: 'species',
    validation: 'validated',
    status: 'active',
    acquired_on: '2026-11-01',
    origin: 'Vivero Los Andes',
    location: 'Ventana de la sala',
    nickname: 'La blanca',
    flower_color: 'white',
    photo_in_bloom: true,
    photo_path: 'user_prueba/planta-1.webp',
    thumbnail_path: 'user_prueba/planta-1-mini.webp',
    created_at: '2026-11-01T15:00:00+00:00',
    updated_at: '2026-11-02T10:30:00+00:00',
    species: {
      id: 'species-amabilis',
      scientific_name: 'Phalaenopsis amabilis',
      type: 'species',
      status: 'validated',
    },
    genus: PHALAENOPSIS,
    ...overrides,
  }
}

let nextId = 1

/** Especie validada con este nombre científico (id derivado del nombre). */
export function speciesNamed(
  scientificName: string,
): NonNullable<CollectionPlant['species']> {
  return {
    id: `species-${scientificName}`,
    scientificName,
    type: 'species',
    status: 'validated',
  }
}

/** Planta del modelo; el id es único salvo que se indique. */
export function plant(
  overrides: Partial<CollectionPlant> = {},
): CollectionPlant {
  const id = `plant-${String(nextId++).padStart(4, '0')}`
  return {
    id,
    displayName: 'Phalaenopsis amabilis',
    displayNameIsScientific: true,
    enteredName: 'Phalaenopsis amabilis',
    species: {
      id: 'species-amabilis',
      scientificName: 'Phalaenopsis amabilis',
      type: 'species',
      status: 'validated',
    },
    genus: PHALAENOPSIS,
    type: 'species',
    validation: 'validated',
    status: 'active',
    acquiredOn: '2026-11-01',
    createdAt: '2026-11-01T15:00:00+00:00',
    updatedAt: '2026-11-01T15:00:00+00:00',
    origin: null,
    location: null,
    nickname: null,
    flowerColor: null,
    photoInBloom: false,
    photoPath: null,
    thumbnailPath: null,
    ...overrides,
  }
}
