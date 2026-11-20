import { useMemo, useState } from 'react'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { InventoryView } from '../inventory/InventoryView.tsx'
import { largeSampleCollection, SAMPLE_COLLECTION } from './inventory-data.ts'
import { Example, Section } from './layout.tsx'

// La pantalla de inventario (/coleccion) con datos fijos, para verla sin base
// de datos ni sesión. Las preferencias de vista se guardan en este navegador,
// igual que en la app.

const SCENARIOS = [
  { id: 'ejemplo', label: 'Colección de ejemplo' },
  { id: 'grande', label: '300 plantas' },
] as const

type ScenarioId = (typeof SCENARIOS)[number]['id']

export function InventorySection() {
  const [scenario, setScenario] = useState<ScenarioId>('ejemplo')
  const large = useMemo(() => largeSampleCollection(300), [])
  const plants = scenario === 'grande' ? large : SAMPLE_COLLECTION

  return (
    <Section
      id="inventario"
      title="Pantalla de inventario"
      description="InventoryView, la pantalla de /coleccion, con datos fijos. Solo cuenta las plantas activas: la regalada de la muestra no aparece."
    >
      <ChipGroup aria-label="Datos del inventario">
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
          status="ready"
          plants={plants}
          error={null}
          onRetry={() => {}}
        />
      </Example>
    </Section>
  )
}
