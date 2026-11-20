import { describe, expect, it } from 'vitest'
import { getSupabase, initSupabase } from './supabase.ts'

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

describe('cliente de Supabase', () => {
  it('falla si se pide antes de inicializarlo', () => {
    expect(() => getSupabase()).toThrow('no se ha inicializado')
  })

  it('crea un único cliente compartido', () => {
    const client = initSupabase(CONFIG)

    expect(initSupabase(CONFIG)).toBe(client)
    expect(getSupabase()).toBe(client)
  })
})
