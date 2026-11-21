import { describe, expect, it } from 'vitest'
import {
  APP_ROLE_CLAIM,
  CATALOG_ADMIN_ROLE,
  hasCatalogAdminRole,
} from './roles.ts'

describe('hasCatalogAdminRole', () => {
  it('usa el claim app_role con el valor catalog_admin', () => {
    expect(APP_ROLE_CLAIM).toBe('app_role')
    expect(CATALOG_ADMIN_ROLE).toBe('catalog_admin')
    expect(hasCatalogAdminRole({ app_role: 'catalog_admin' })).toBe(true)
  })

  it.each([
    null,
    undefined,
    {},
    { app_role: 'user' },
    { app_role: '' },
    { app_role: ['catalog_admin'] },
    // El claim role es de Supabase (authenticated); no cuenta.
    { role: 'catalog_admin' },
    { metadata: { role: 'catalog_admin' } },
  ])('no da el rol con %j', (claims) => {
    expect(hasCatalogAdminRole(claims)).toBe(false)
  })
})
