import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  enumValues,
  type FlowerColor,
  type Genus,
  type GenusAbbreviation,
  type Plant,
  type PlantInsert,
  type PlantStatus,
  type PlantType,
  type PlantUpdate,
  type PlantValidation,
  type Profile,
  type Species,
  type SpeciesName,
  type SpeciesNameType,
  type SpeciesSource,
  type SpeciesStatus,
  type SpeciesType,
} from './database.ts'
import { getSupabase, type OrkiSupabaseClient } from './supabase.ts'

// Pruebas de los tipos del esquema. Lo importante pasa al compilar (npm run typecheck): cada
// `@ts-expect-error` marca un uso incorrecto que TypeScript debe rechazar; si dejara de ser un
// error (por ejemplo, porque el cliente perdiera el tipo Database), el typecheck fallaría.
// Ninguna prueba hace consultas: los constructores de consultas de supabase-js no envían nada
// hasta que se esperan con await, y aquí nunca se esperan.

// Solo se compila: describe usos válidos e inválidos del cliente tipado.
function usosDelCliente(supabase: OrkiSupabaseClient) {
  // Válidos.
  void supabase.from('plants').select('id, nickname, status')
  void supabase.from('plants').insert({
    entered_name: 'Phalaenopsis amabilis',
    genus_id: '00000000-0000-0000-0000-000000000000',
    type: 'species',
    status: 'active',
  })
  void supabase.from('species').update({ status: 'validated' }).eq('id', 'x')

  // Tabla inexistente.
  // @ts-expect-error: no hay tabla "orchids".
  void supabase.from('orchids').select('*')

  // Columna inexistente al insertar, actualizar y filtrar.
  void supabase
    .from('plants')
    // @ts-expect-error: "color" no es una columna de plants (es flower_color).
    .insert({ entered_name: 'x', genus_id: 'x', type: 'hybrid', color: 'pink' })
  // @ts-expect-error: "scientific" no es una columna de species.
  void supabase.from('species').update({ scientific: 'x' })
  // @ts-expect-error: "nombre" no es una columna de genera.
  void supabase.from('genera').select('*').eq('nombre', 'Cattleya')

  // Columna no seleccionada al leer: la fila no tiene esa propiedad.
  async function leer() {
    const { data } = await supabase.from('plants').select('id, nickname')
    const fila = data?.[0]
    expectTypeOf(fila).toEqualTypeOf<
      { id: string; nickname: string | null } | undefined
    >()
    // @ts-expect-error: no se seleccionó "location".
    void fila?.location
  }
  void leer

  // Valor de enumerado inválido.
  // @ts-expect-error: "dead" no es un valor de plant_status.
  void supabase.from('plants').update({ status: 'dead' })
  // @ts-expect-error: "green" no es un valor de flower_color.
  void supabase.from('plants').update({ flower_color: 'green' })
  // @ts-expect-error: falta la columna obligatoria entered_name.
  void supabase.from('plants').insert({ genus_id: 'x', type: 'species' })

  // Funciones expuestas en la API.
  void supabase.rpc('requesting_user_id')
  // @ts-expect-error: la función no existe.
  void supabase.rpc('no_existe')
}
void usosDelCliente

describe('tipos del esquema', () => {
  it('el cliente se crea con el tipo Database', () => {
    expectTypeOf(
      getSupabase,
    ).returns.resolves.toEqualTypeOf<OrkiSupabaseClient>()
  })

  it('exporta los alias de las tablas', () => {
    expectTypeOf<Plant['status']>().toEqualTypeOf<PlantStatus>()
    expectTypeOf<Plant['species_id']>().toEqualTypeOf<string | null>()
    expectTypeOf<PlantInsert['entered_name']>().toEqualTypeOf<string>()
    expectTypeOf<PlantUpdate>().toEqualTypeOf<Partial<PlantUpdate>>()
    expectTypeOf<Species['type']>().toEqualTypeOf<SpeciesType>()
    expectTypeOf<Species['status']>().toEqualTypeOf<SpeciesStatus>()
    expectTypeOf<Species['source']>().toEqualTypeOf<SpeciesSource>()
    expectTypeOf<SpeciesName['type']>().toEqualTypeOf<SpeciesNameType>()
    expectTypeOf<Genus['name']>().toEqualTypeOf<string>()
    expectTypeOf<GenusAbbreviation['genus_id']>().toEqualTypeOf<string>()
    expectTypeOf<Profile['id']>().toEqualTypeOf<string>()
  })

  it('los enumerados son uniones de sus valores', () => {
    expectTypeOf<PlantType>().toEqualTypeOf<'species' | 'hybrid' | 'unknown'>()
    expectTypeOf<PlantValidation>().toEqualTypeOf<
      'pending' | 'validated' | 'unidentifiable'
    >()
    expectTypeOf<FlowerColor>().toEqualTypeOf<
      'white' | 'pink' | 'purple' | 'yellow' | 'orange' | 'bicolor'
    >()
    // @ts-expect-error: "dead" no es un PlantStatus.
    const estado: PlantStatus = 'dead'
    void estado
  })

  it('expone los valores de los enumerados para la interfaz', () => {
    expect(enumValues.plant_status).toEqual(['active', 'lost', 'gifted'])
    expect(enumValues.plant_validation).toEqual([
      'pending',
      'validated',
      'unidentifiable',
    ])
    expectTypeOf(enumValues.flower_color).items.toEqualTypeOf<FlowerColor>()
  })
})
