import { useState } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { Collapsible } from '../components/ui/Collapsible.tsx'
import { PlantDetailView, PlantName } from '../detail/PlantDetailView.tsx'
import type { PlantImageSource } from '../photos/read.ts'
import { PlantImagesContext } from '../photos/usePlantImage.ts'
import samplePhoto from './foto-muestra.svg'
import { SAMPLE_COLLECTION } from './inventory-data.ts'
import { Example, Section } from './layout.tsx'

// El detalle de un ejemplar (/coleccion/:plantId, #16) con plantas de la
// colección de ejemplo, para revisarlo sin base de datos ni sesión. La foto
// sale de una fuente que siempre devuelve la foto de muestra.

const images: PlantImageSource = {
  acquire: () => Promise.resolve(samplePhoto),
  release: () => {},
  clear: () => {},
}

function find(name: string): CollectionPlant | undefined {
  return SAMPLE_COLLECTION.find((plant) => plant.displayName === name)
}

const SCENARIOS = [
  {
    id: 'validada',
    label: 'Validada, con foto',
    plant: find('Phalaenopsis amabilis'),
    withPhoto: true,
  },
  {
    id: 'por-validar',
    label: 'Por validar',
    plant: find('la naranja del mercado'),
    withPhoto: false,
  },
  {
    id: 'no-identificable',
    label: 'No identificable',
    plant: find('dendrobio del regalo'),
    withPhoto: true,
  },
  {
    id: 'perdida',
    label: 'Perdida',
    plant: find('Phalaenopsis schilleriana'),
    withPhoto: false,
  },
] as const

type ScenarioId = (typeof SCENARIOS)[number]['id']

export function DetailSection() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('validada')
  const scenario =
    SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0]
  const base = scenario.plant
  const plant: CollectionPlant | undefined =
    base && scenario.withPhoto
      ? {
          ...base,
          photoPath: `muestra/${base.id}/photo.svg`,
          thumbnailPath: `muestra/${base.id}/thumb.svg`,
        }
      : base

  return (
    <Section
      id="detalle"
      title="Detalle del ejemplar"
      description="PlantDetailView, el contenido de /coleccion/:plantId, con plantas de la colección de ejemplo: la foto completa (solo se pide aquí, nunca en la lista) y todos los datos. Una planta no identificable lleva la etiqueta «Nombre por validar» y una frase que lo explica."
    >
      <Collapsible title="Ver el detalle" headingLevel={3}>
        <div className="flex flex-col gap-space-4 pt-space-3">
          <ChipGroup aria-label="Planta del detalle">
            {SCENARIOS.map((item) => (
              <Chip
                key={item.id}
                selected={scenarioId === item.id}
                onClick={() => setScenarioId(item.id)}
              >
                {item.label}
              </Chip>
            ))}
          </ChipGroup>
          {plant && (
            <Example
              title="Detalle de una planta"
              className="mx-auto w-full max-w-lg"
            >
              <p className="font-display text-xl font-semibold text-neutral-900">
                <PlantName plant={plant} />
              </p>
              <PlantImagesContext value={images}>
                <PlantDetailView key={plant.id} plant={plant} />
              </PlantImagesContext>
            </Example>
          )}
        </div>
      </Collapsible>
    </Section>
  )
}
