import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CatalogAdminError,
  countProposalGroups,
  listProposalGroups,
} from './catalogAdmin.ts'
import {
  CatalogWriteError,
  createSpeciesFromProposal,
  linkProposalGroup,
  markProposalUnidentifiable,
} from './catalogWrites.ts'
import { initSupabase, setSessionTokenSource } from './supabase.ts'

// Cola de propuestas (#139, #140) con la API simulada (fetch): qué envía a
// cada función de la base, cómo convierte las filas y cómo traduce sus
// rechazos.

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const GENUS_ID = '22222222-2222-4222-8222-222222222222'
const SPECIES_ID = '11111111-1111-4111-8111-111111111111'
const GROUP = { nameKey: 'rosa del monte', genusId: GENUS_ID }

const GROUP_ROW = {
  name_key: 'rosa del monte',
  proposed_name: 'Rosa del monte',
  genus_id: GENUS_ID,
  genus_name: 'Vanda',
  type: 'unknown',
  plant_count: 3,
  photos: [
    {
      photo_path: 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp',
      thumbnail_path:
        'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp',
    },
    // Una entrada mal formada se descarta.
    { photo_path: null },
  ],
  total_count: 41,
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const fetchMock = vi.fn<typeof fetch>()

function requests() {
  return fetchMock.mock.calls.map(([input, init]) => ({
    path: new URL(
      input instanceof Request ? input.url : String(input),
    ).pathname.replace('/rest/v1/', ''),
    body:
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : undefined,
  }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setSessionTokenSource(null)
  initSupabase(CONFIG)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('lectura de la cola', () => {
  it('pide la página por desplazamiento y convierte las filas', async () => {
    fetchMock.mockImplementation(() => jsonResponse([GROUP_ROW]))
    const page = await listProposalGroups({ page: 3 })
    expect(requests()).toEqual([
      {
        path: 'rpc/list_proposal_groups',
        body: { page_size: 20, page_offset: 40 },
      },
    ])
    expect(page).toEqual({
      total: 41,
      page: 3,
      rows: [
        {
          nameKey: 'rosa del monte',
          proposedName: 'Rosa del monte',
          genusId: GENUS_ID,
          genusName: 'Vanda',
          type: 'unknown',
          plantCount: 3,
          photos: [
            {
              photoPath:
                'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp',
              thumbnailPath:
                'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp',
            },
          ],
        },
      ],
    })
  })

  it('una página que ya no existe devuelve la última', async () => {
    fetchMock.mockImplementation((_input, init) => {
      const body = JSON.parse(init?.body as string) as { page_offset: number }
      return jsonResponse(
        body.page_offset === 0 || body.page_offset === 20
          ? [{ ...GROUP_ROW, total_count: 25 }]
          : [],
      )
    })
    const page = await listProposalGroups({ page: 5 })
    expect(requests().map((request) => request.body)).toEqual([
      { page_size: 20, page_offset: 80 },
      { page_size: 20, page_offset: 0 },
      { page_size: 20, page_offset: 20 },
    ])
    expect(page.page).toBe(2)
    expect(page.total).toBe(25)
  })

  it('cola vacía', async () => {
    fetchMock.mockImplementation(() => jsonResponse([]))
    expect(await listProposalGroups()).toEqual({ rows: [], total: 0, page: 1 })
  })

  it('cuenta los grupos', async () => {
    fetchMock.mockImplementation(() => jsonResponse(7))
    expect(await countProposalGroups()).toBe(7)
    expect(requests()[0]?.path).toBe('rpc/count_proposal_groups')
  })

  it('sin rol de administrador: forbidden', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse(
        { code: '42501', message: 'permiso', details: null, hint: null },
        403,
      ),
    )
    await expect(listProposalGroups()).rejects.toMatchObject({
      reason: 'forbidden',
    })
    await expect(countProposalGroups()).rejects.toBeInstanceOf(
      CatalogAdminError,
    )
  })
})

describe('resoluciones', () => {
  it('enlazar envía el grupo y la especie y devuelve las plantas', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse([{ action_id: 'a1', plant_count: 3 }]),
    )
    expect(await linkProposalGroup(GROUP, SPECIES_ID)).toEqual({
      plantCount: 3,
    })
    expect(requests()[0]).toEqual({
      path: 'rpc/link_proposal_group',
      body: {
        group_name_key: 'rosa del monte',
        group_genus_id: GENUS_ID,
        target_species_id: SPECIES_ID,
      },
    })
  })

  it('crear envía el nombre limpio, el género y el tipo; sin plantas no hay especie', async () => {
    fetchMock.mockImplementationOnce(() =>
      jsonResponse([
        { action_id: 'a1', plant_count: 3, species_id: SPECIES_ID },
      ]),
    )
    expect(
      await createSpeciesFromProposal(GROUP, {
        scientificName: '  Vanda   rosa ',
        genusId: GENUS_ID,
        type: 'species',
      }),
    ).toEqual({ plantCount: 3, speciesId: SPECIES_ID })
    expect(requests()[0]).toEqual({
      path: 'rpc/create_species_from_proposal',
      body: {
        group_name_key: 'rosa del monte',
        group_genus_id: GENUS_ID,
        new_scientific_name: 'Vanda rosa',
        new_genus_id: GENUS_ID,
        new_type: 'species',
      },
    })

    fetchMock.mockImplementationOnce(() =>
      jsonResponse([{ action_id: null, plant_count: 0, species_id: null }]),
    )
    expect(
      await createSpeciesFromProposal(GROUP, {
        scientificName: 'Vanda rosa',
        genusId: GENUS_ID,
        type: 'species',
      }),
    ).toEqual({ plantCount: 0, speciesId: null })
  })

  it('crear sin nombre ni género no llama a la base', async () => {
    const error = await createSpeciesFromProposal(GROUP, {
      scientificName: '  ',
      genusId: GENUS_ID,
      type: 'species',
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CatalogWriteError)
    expect((error as CatalogWriteError).problem).toBe('name-required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marcar como no identificable; un grupo ya resuelto devuelve 0 plantas', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse([{ action_id: null, plant_count: 0 }]),
    )
    expect(await markProposalUnidentifiable(GROUP)).toEqual({ plantCount: 0 })
    expect(requests()[0]).toEqual({
      path: 'rpc/mark_proposal_unidentifiable',
      body: { group_name_key: 'rosa del monte', group_genus_id: GENUS_ID },
    })
  })

  it('traduce los rechazos de la base', async () => {
    fetchMock.mockImplementationOnce(() =>
      jsonResponse(
        {
          code: 'P0002',
          message: 'La especie elegida ya no está en el catálogo.',
          details: JSON.stringify({
            reason: 'species_not_found',
            species_id: SPECIES_ID,
          }),
          hint: null,
        },
        404,
      ),
    )
    await expect(linkProposalGroup(GROUP, SPECIES_ID)).rejects.toMatchObject({
      problem: 'species-not-found',
    })
    fetchMock.mockImplementationOnce(() =>
      jsonResponse(
        {
          code: '22023',
          message: 'Falta el grupo de la propuesta.',
          details: JSON.stringify({ reason: 'group_required' }),
          hint: null,
        },
        400,
      ),
    )
    await expect(markProposalUnidentifiable(GROUP)).rejects.toMatchObject({
      problem: 'group-required',
      message: 'Falta el grupo de la propuesta: vuelve a cargar la cola.',
    })
  })
})
