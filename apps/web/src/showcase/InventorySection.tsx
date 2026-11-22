import { useId, useMemo, useState } from 'react'
import {
  countActiveFilters,
  DEFAULT_FILTERS,
  type PlantFilters,
} from '../collection/filters.ts'
import type { CollectionPlant } from '../collection/model.ts'
import {
  CollectionLoadError,
  type CollectionErrorReason,
} from '../collection/source.ts'
import type { CollectionStatus } from '../collection/store.ts'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { InventoryView } from '../inventory/InventoryView.tsx'
import { OfflineNotice } from '../inventory/OfflineNotice.tsx'
import { OwnershipPanel } from '../inventory/OwnershipPanel.tsx'
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
  { id: 'copia', label: 'Copia sin conexión' },
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
  const offlineNoticeId = useId()
  // Copia sin conexión (#18): ayer a las 18:30, para la fecha del indicador.
  const [savedAt] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 1)
    date.setHours(18, 30, 0, 0)
    return date.toISOString()
  })
  const readOnly = scenario === 'copia'

  const state: ScenarioState = (() => {
    switch (scenario) {
      case 'ejemplo':
      case 'copia':
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
      description="InventoryView, la pantalla de /coleccion, con datos fijos. Por defecto solo cuenta las plantas activas: la regalada y la perdida de la muestra se ven con el filtro de estado. «Filtros» abre el panel de estado, género, color y origen. Bajo el buscador, la respuesta de «¿Ya la tengo?» sobre la colección de la muestra. «Copia sin conexión» es la colección guardada en el dispositivo, en solo lectura: el indicador con la fecha de la última actualización (OfflineNotice) y los accesos a registrar desactivados. Reintentar no hace nada aquí."
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
        {readOnly && (
          <OfflineNotice
            id={offlineNoticeId}
            reason="offline"
            savedAt={savedAt}
          />
        )}
        <InventoryView
          status={state.status}
          plants={state.plants}
          error={state.error}
          onRetry={() => {}}
          query={query}
          onQueryChange={setQuery}
          filters={filters}
          onFiltersChange={setFilters}
          searchResult={
            <OwnershipPanel
              plants={state.plants}
              query={query}
              filtered={countActiveFilters(filters) > 0}
              // Datos fijos: sin consultar el catálogo.
              searchSpecies={null}
              registerDisabledBy={readOnly ? offlineNoticeId : undefined}
            />
          }
          writeDisabledBy={readOnly ? offlineNoticeId : undefined}
        />
      </Example>
    </Section>
  )
}
