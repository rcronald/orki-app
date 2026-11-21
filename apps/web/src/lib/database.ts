// Alias de los tipos del esquema para el resto de la app.
//
// Los tipos salen de database.types.ts, que se genera con `npm run db:types` a partir de las
// migraciones; este módulo solo les pone nombres cómodos y no se regenera. Si una migración
// añade una tabla o un enumerado, añade aquí su alias.
//
// Por tabla hay tres formas: la fila tal como se lee (Row), lo que se envía al insertar
// (Insert: las columnas con valor por defecto son opcionales) y lo que se envía al actualizar
// (Update: todo opcional).

import {
  Constants,
  type Enums,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
} from './database.types.ts'

export type { Database, Json } from './database.types.ts'

// Tablas -------------------------------------------------------------------------------

export type Genus = Tables<'genera'>
export type GenusInsert = TablesInsert<'genera'>
export type GenusUpdate = TablesUpdate<'genera'>

export type GenusAbbreviation = Tables<'genus_abbreviations'>
export type GenusAbbreviationInsert = TablesInsert<'genus_abbreviations'>
export type GenusAbbreviationUpdate = TablesUpdate<'genus_abbreviations'>

export type Species = Tables<'species'>
export type SpeciesInsert = TablesInsert<'species'>
export type SpeciesUpdate = TablesUpdate<'species'>

export type SpeciesName = Tables<'species_names'>
export type SpeciesNameInsert = TablesInsert<'species_names'>
export type SpeciesNameUpdate = TablesUpdate<'species_names'>

export type Profile = Tables<'profiles'>
export type ProfileInsert = TablesInsert<'profiles'>
export type ProfileUpdate = TablesUpdate<'profiles'>

export type Plant = Tables<'plants'>
export type PlantInsert = TablesInsert<'plants'>
export type PlantUpdate = TablesUpdate<'plants'>

// Enumerados ---------------------------------------------------------------------------

export type SpeciesType = Enums<'species_type'>
export type SpeciesStatus = Enums<'species_status'>
export type SpeciesSource = Enums<'species_source'>
export type SpeciesNameType = Enums<'species_name_type'>
/** Por qué nombre coincidió una especie en la búsqueda: científico, sinónimo o común. */
export type SpeciesMatchType = Enums<'species_match_type'>
export type PlantType = Enums<'plant_type'>
export type PlantStatus = Enums<'plant_status'>
export type PlantValidation = Enums<'plant_validation'>
export type FlowerColor = Enums<'flower_color'>

/**
 * Valores de cada enumerado en el orden en que los declara la base de datos, para recorrerlos
 * en la interfaz (selectores, filtros). Los textos en español los pone la interfaz.
 */
export const enumValues = Constants.public.Enums
