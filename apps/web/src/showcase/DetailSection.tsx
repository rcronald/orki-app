import { useState } from 'react'
import { PLANT_STATUS_LABEL } from '../collection/labels.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { Collapsible } from '../components/ui/Collapsible.tsx'
import {
  PlantActions,
  type PlantActionServices,
} from '../detail/PlantActions.tsx'
import { PlantDetailView, PlantName } from '../detail/PlantDetailView.tsx'
import type { PlantImageSource } from '../photos/read.ts'
import { PlantImagesContext } from '../photos/usePlantImage.ts'
import samplePhoto from './foto-muestra.svg'
import { SAMPLE_COLLECTION } from './inventory-data.ts'
import { Example, Section } from './layout.tsx'

// El detalle de un ejemplar (/coleccion/:plantId, #16) con plantas de la
// colección de ejemplo, para revisarlo sin base de datos ni sesión. La foto
// sale de una fuente que siempre devuelve la foto de muestra. Las acciones
// funcionan sin escribir nada: dar de baja y reactivar cambian la planta de la
// muestra; eliminar solo lo dice.

const wait = () => new Promise((resolve) => setTimeout(resolve, 600))

const services: PlantActionServices = {
  setStatus: async (plant, status) => {
    await wait()
    return { ...plant, status }
  },
  deletePlant: async () => {
    await wait()
    return { photosDeleted: true }
  },
}

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
  // Cambios de estado hechos en la muestra, por planta.
  const [changed, setChanged] = useState<Record<string, CollectionPlant>>({})
  const [result, setResult] = useState<string | null>(null)
  const scenario =
    SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0]
  const base = scenario.plant && (changed[scenario.plant.id] ?? scenario.plant)
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
      description="PlantDetailView, el contenido de /coleccion/:plantId, con plantas de la colección de ejemplo: la foto completa (solo se pide aquí, nunca en la lista) y todos los datos. Una planta no identificable lleva la etiqueta «Nombre por validar» y una frase que lo explica. Dar de baja y eliminar abren el diálogo de confirmación (ConfirmDialog): el foco queda dentro y Escape cancela. No se escribe nada."
    >
      <Collapsible title="Ver el detalle" headingLevel={3}>
        <div className="flex flex-col gap-space-4 pt-space-3">
          <ChipGroup aria-label="Planta del detalle">
            {SCENARIOS.map((item) => (
              <Chip
                key={item.id}
                selected={scenarioId === item.id}
                onClick={() => {
                  setScenarioId(item.id)
                  setResult(null)
                }}
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
                <PlantDetailView
                  key={plant.id}
                  plant={plant}
                  notice={
                    <p role="status" className="text-sm text-neutral-700">
                      {result}
                    </p>
                  }
                  actions={
                    <PlantActions
                      plant={plant}
                      online
                      services={services}
                      onStatusChanged={(updated) => {
                        setChanged((current) => ({
                          ...current,
                          [updated.id]: updated,
                        }))
                        setResult(
                          `Estado de la muestra: ${PLANT_STATUS_LABEL[updated.status]}.`,
                        )
                      }}
                      onDeleted={() =>
                        setResult(
                          'Eliminada (en la app, vuelve al inventario).',
                        )
                      }
                    />
                  }
                />
              </PlantImagesContext>
            </Example>
          )}
        </div>
      </Collapsible>
    </Section>
  )
}
