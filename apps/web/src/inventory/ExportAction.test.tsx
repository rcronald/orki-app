import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTERS } from '../collection/filters.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { CATTLEYA, plant } from '../test/collection.ts'
import { InventoryView } from './InventoryView.tsx'
import { REVOKE_DELAY_MS, saveFile } from './save-file.ts'

// Exportación a CSV (#17) desde la pantalla. El contenido del archivo se
// prueba en collection/export-csv.test.ts.

const BLOB_URL = 'blob:http://localhost/prueba'
let created: Blob[] = []
let clicked: HTMLAnchorElement[] = []
let revokeObjectURL = vi.fn<(url: string) => void>()

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Mi colección · orqui.apps'
  window.localStorage.clear()
  created = []
  clicked = []
  // jsdom no implementa las URL de objeto ni descarga al pulsar un enlace.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob)
    return BLOB_URL
  })
  revokeObjectURL = vi.fn()
  URL.revokeObjectURL = revokeObjectURL
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'matchMedia')
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
})

function renderInventory(plants: readonly CollectionPlant[]) {
  return render(
    <MemoryRouter>
      <main>
        <InventoryView
          status="ready"
          plants={plants}
          error={null}
          onRetry={() => {}}
          query="maxima"
          onQueryChange={() => {}}
          filters={{ ...DEFAULT_FILTERS, genera: [CATTLEYA.id] }}
          onFiltersChange={() => {}}
        />
      </main>
    </MemoryRouter>,
  )
}

const PLANTS = [
  plant({ displayName: 'Phalaenopsis amabilis', nickname: '=1+1' }),
  plant({ displayName: 'Cattleya maxima', genus: CATTLEYA }),
  plant({ displayName: 'Phalaenopsis aphrodite', status: 'lost' }),
]

const section = () =>
  screen.getByRole('region', { name: 'Exportar tu inventario' })

describe('InventoryView: exportar a CSV', () => {
  it('descarga todas las plantas, también las de baja, sin importar los filtros ni la búsqueda', async () => {
    const user = userEvent.setup()
    renderInventory(PLANTS)
    // En pantalla solo se ve una por la búsqueda y el filtro.
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(section()).toHaveTextContent(
      'también las perdidas y regaladas, sin importar los filtros',
    )

    await user.click(
      within(section()).getByRole('button', { name: 'Exportar a CSV' }),
    )

    expect(created).toHaveLength(1)
    const blob = created[0]
    expect(blob?.type).toBe('text/csv;charset=utf-8')
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      await blob?.arrayBuffer(),
    )
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const lines = text.trimEnd().split('\r\n')
    expect(lines).toHaveLength(4)
    expect(text).toContain("'=1+1")
    expect(text).toContain('Perdida')

    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.href).toBe(BLOB_URL)
    expect(clicked[0]?.download).toMatch(
      /^orqui-apps-inventario-\d{4}-\d{2}-\d{2}\.csv$/,
    )
    // El enlace temporal no se queda en la página.
    expect(document.querySelector(`a[href="${BLOB_URL}"]`)).toBeNull()
    expect(within(section()).getByRole('status')).toHaveTextContent(
      /^Listo: orqui-apps-inventario-.*\.csv, con 3 plantas\.$/,
    )
    await expectNoAxeViolations()
  })

  it('revoca la URL de objeto después de la descarga', async () => {
    vi.useFakeTimers()
    await saveFile('a,b\r\n', 'x.csv', 'text/csv')
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL)
  })

  it('sin plantas no aparece', () => {
    renderInventory([])
    expect(screen.queryByRole('button', { name: 'Exportar a CSV' })).toBeNull()
  })

  it('mientras carga no aparece', () => {
    render(
      <MemoryRouter>
        <InventoryView
          status="loading"
          plants={null}
          error={null}
          onRetry={() => {}}
          query=""
          onQueryChange={() => {}}
          filters={DEFAULT_FILTERS}
          onFiltersChange={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Exportar a CSV' })).toBeNull()
  })
})

describe('saveFile en un celular', () => {
  function touchDevice(share: (data: ShareData) => Promise<void>) {
    const spy = vi.fn(share)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query === '(pointer: coarse)' }),
    })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: spy,
    })
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: vi.fn(() => true),
    })
    return spy
  }

  it('abre la hoja de compartir con el archivo en vez de descargarlo', async () => {
    const share = touchDevice(() => Promise.resolve())
    expect(await saveFile('a\r\n', 'orki.csv', 'text/csv')).toBe('shared')
    const shared = share.mock.calls[0]?.[0]
    expect(shared?.files?.[0]?.name).toBe('orki.csv')
    expect(clicked).toHaveLength(0)
  })

  it('si el usuario cierra la hoja no descarga nada', async () => {
    touchDevice(() =>
      Promise.reject(new DOMException('Cancelado', 'AbortError')),
    )
    expect(await saveFile('a\r\n', 'orki.csv', 'text/csv')).toBe('cancelled')
    expect(clicked).toHaveLength(0)
  })

  it('si compartir falla por otro motivo, descarga', async () => {
    touchDevice(() =>
      Promise.reject(new DOMException('No admitido', 'NotAllowedError')),
    )
    expect(await saveFile('a\r\n', 'orki.csv', 'text/csv')).toBe('downloaded')
    expect(clicked).toHaveLength(1)
  })
})
