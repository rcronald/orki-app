import { describe, expect, it, vi } from 'vitest'

// Las fotos de la cola de propuestas (#184: hasta seis por grupo, también las
// secundarias) son de otros usuarios: se descargan como en la app, pero sin
// guardar las miniaturas en la caché de miniaturas del dispositivo.

const createPlantImageSource = vi.fn(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  clear: vi.fn(),
}))

vi.mock('../photos/read.ts', () => ({ createPlantImageSource }))

describe('fotos de las propuestas', () => {
  it('se leen sin la caché de miniaturas y con una sola fuente', async () => {
    const { supabaseCatalogAdminSource } = await import('./source.ts')
    const first = supabaseCatalogAdminSource.proposalImages()
    const second = supabaseCatalogAdminSource.proposalImages()

    expect(second).toBe(first)
    expect(createPlantImageSource).toHaveBeenCalledOnce()
    expect(createPlantImageSource).toHaveBeenCalledWith({
      thumbnailCache: null,
    })
  })
})
