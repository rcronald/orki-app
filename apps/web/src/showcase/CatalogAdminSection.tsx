import { useMemo, useState } from 'react'
import { CatalogAdminView } from '../backoffice/CatalogAdminView.tsx'
import {
  INITIAL_CATALOG_ADMIN_STATE,
  type CatalogAdminState,
} from '../backoffice/url-state.ts'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import {
  createSampleCatalogSource,
  type SampleScenario,
} from './catalog-admin-data.ts'
import { Example, Section } from './layout.tsx'

// La pantalla del backoffice del catálogo (/administracion/catalogo) con un
// catálogo de muestra en memoria, para verla sin base de datos ni sesión, en
// cada uno de sus estados. El estado (pestaña, búsqueda, filtros, página,
// detalle) va en el estado de la sección; en la app va en la URL.

const SCENARIOS: readonly { id: SampleScenario; label: string }[] = [
  { id: 'ejemplo', label: 'Catálogo de ejemplo' },
  { id: 'cargando', label: 'Cargando' },
  { id: 'vacio', label: 'Vacío' },
  { id: 'sin-conexion', label: 'Sin conexión' },
  { id: 'fallo', label: 'Fallo' },
]

export function CatalogAdminSection({ delayMs }: { delayMs?: number }) {
  const [scenario, setScenario] = useState<SampleScenario>('ejemplo')
  const [state, setState] = useState<CatalogAdminState>(
    INITIAL_CATALOG_ADMIN_STATE,
  )
  const source = useMemo(
    () => createSampleCatalogSource(scenario, delayMs),
    [scenario, delayMs],
  )

  return (
    <Section
      id="backoffice"
      title="Backoffice del catálogo"
      description="CatalogAdminView, la pantalla de /administracion/catalogo, con unas 150 especies de muestra. Se pueden dar de alta, editar, borrar y cambiar de estado especies (también por lote), editar sus sinónimos y nombres comunes, fusionar una especie con otra (con su vista previa: plantas que se mueven, nombres que pasan y los que ya existían), ver el historial de cambios de cada especie (la primera trae entradas de ejemplo: una carga, una edición y una fusión), crear, editar y borrar géneros y abreviaturas, y resolver la cola de propuestas de la pestaña «Por validar» (tres grupos de ejemplo con la foto de muestra: enlazarlos a una especie, crear la especie o marcarlos como no identificables): los cambios viven en memoria hasta cambiar de escenario. La búsqueda de la muestra solo compara por prefijo o por contener el texto; la de la base tolera errores de tipeo."
    >
      <ChipGroup aria-label="Estado del backoffice">
        {SCENARIOS.map((option) => (
          <Chip
            key={option.id}
            selected={scenario === option.id}
            onClick={() => {
              setScenario(option.id)
              setState(INITIAL_CATALOG_ADMIN_STATE)
            }}
          >
            {option.label}
          </Chip>
        ))}
      </ChipGroup>
      <Example title="Administración del catálogo">
        <CatalogAdminView
          key={scenario}
          state={state}
          onStateChange={setState}
          source={source}
        />
      </Example>
    </Section>
  )
}
