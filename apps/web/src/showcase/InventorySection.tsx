import { useMemo, useState } from 'react'
import { DEFAULT_FILTERS, type PlantFilters } from '../collection/filters.ts'
import type { CollectionPlant } from '../collection/model.ts'
import {
  CollectionLoadError,
  type CollectionErrorReason,
} from '../collection/source.ts'
import type { CollectionStatus } from '../collection/store.ts'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { InventoryView } from '../inventory/InventoryView.tsx'
import { largeSampleCollection, SAMPLE_COLLECTION } from './inventory-data.ts'
import { Example, Section } from './layout.tsx'

// La pantalla de inventario (/coleccion) con datos fijos, para verla sin base
// de datos ni sesión, en cada uno de sus estados. Las preferencias de vista se
// guardan en este navegador, igual que en la app; la búsqueda y los filtros,
// en el estado de la sección (en la app van en la URL).

const SCENARIOS = [
  { id: 'ejemplo', label: 'Colección de ejemplo' },
  { id: 'grande', label: '300 plantas' },
  { id: 'vacia', label: 'Vacía' },
  { id: 'cargando', label: 'Cargando' },
  { id: 'sin-conexion', label: 'Sin conexión' },
  { id: 'sesion', label: 'Sesión terminada' },
  { id: 'fallo', label: 'Fallo' },
  { id: 'recarga', label: 'Recarga fallida' },
] as const

type ScenarioId = (typeof SCENARIOS)[number]['id']

interface ScenarioState {
  status: CollectionStatus
  plants: readonly CollectionPlant[] | null
  error: CollectionLoadError | null
}

const failed = (reason: CollectionErrorReason): ScenarioState => ({
  status: 'error',
  plants: null,
  error: new CollectionLoadError(reason),
})

export function InventorySection() {
  const [scenario, setScenario] = useState<ScenarioId>('ejemplo')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<PlantFilters>(DEFAULT_FILTERS)
  const large = useMemo(() => largeSampleCollection(300), [])

  const state: ScenarioState = (() => {
    switch (scenario) {
      case 'ejemplo':
        return { status: 'ready', plants: SAMPLE_COLLECTION, error: null }
      case 'grande':
        return { status: 'ready', plants: large, error: null }
      case 'vacia':
        return { status: 'ready', plants: [], error: null }
      case 'cargando':
        return { status: 'loading', plants: null, error: null }
      case 'sin-conexion':
        return failed('offline')
      case 'sesion':
        return failed('session-ended')
      case 'fallo':
        return failed('failed')
      case 'recarga':
        return {
          status: 'error',
          plants: SAMPLE_COLLECTION,
          error: new CollectionLoadError('offline'),
        }
    }
  })()

  return (
    <Section
      id="inventario"
      title="Pantalla de inventario"
      description="InventoryView, la pantalla de /coleccion, con datos fijos. Por defecto solo cuenta las plantas activas: la regalada y la perdida de la muestra se ven con el filtro de estado. «Filtros» abre el panel de estado, género, color y origen. Reintentar no hace nada aquí."
    >
      <ChipGroup aria-label="Estado del inventario">
        {SCENARIOS.map((option) => (
          <Chip
            key={option.id}
            selected={scenario === option.id}
            onClick={() => setScenario(option.id)}
          >
            {option.label}
          </Chip>
        ))}
      </ChipGroup>
      <Example title="Mi colección">
        <InventoryView
          status={state.status}
          plants={state.plants}
          error={state.error}
          onRetry={() => {}}
          query={query}
          onQueryChange={setQuery}
          filters={filters}
          onFiltersChange={setFilters}
        />
      </Example>
    </Section>
  )
}
