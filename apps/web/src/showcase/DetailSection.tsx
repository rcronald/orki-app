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
import { PlantGallery } from '../detail/PlantGallery.tsx'
import { usePlantGallery } from '../detail/usePlantGallery.ts'
import { reorderPlantPhotos, updatePlantPhoto } from '../photos/gallery.ts'
import { createMemoryPlantPhotoRows } from '../photos/memory-photo-rows.ts'
import type { PlantImageSource } from '../photos/read.ts'
import { PlantImagesContext } from '../photos/usePlantImage.ts'
import { PlantPhotoRowsContext } from '../photos/usePlantPhotoRows.ts'
import samplePhoto from './foto-muestra.svg'
import { SAMPLE_COLLECTION } from './inventory-data.ts'
import { Example, Section } from './layout.tsx'

// El detalle de un ejemplar (/coleccion/:plantId, #16) con plantas de la
// colección de ejemplo, para revisarlo sin base de datos ni sesión. La foto
// sale de una fuente que siempre devuelve la foto de muestra. Las acciones
// funcionan sin escribir nada: dar de baja y reactivar cambian la planta de la
// muestra; eliminar solo lo dice. La galería (#183) lee y escribe en
// plant_photos en memoria: la validada tiene tres fotos (la tercera con fecha
// y nota), la no identificable una; sin conexión se prueba con el modo avión
// del navegador.

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

const SAMPLE_USER = 'muestra'

/** plant_photos de la muestra: `count` fotos por planta, en memoria. */
const sampleRows = createMemoryPlantPhotoRows()

function seedPhotos(plant: CollectionPlant, count: number) {
  sampleRows.plants.set(plant.id, { ...plant, userId: SAMPLE_USER })
  if (sampleRows.photosOf(plant.id).length > 0) return
  for (let position = 0; position < count; position += 1) {
    const id = `${plant.id}-foto-${String(position)}`
    sampleRows.rows.set(id, {
      id,
      plantId: plant.id,
      userId: SAMPLE_USER,
      photoPath: `muestra/${plant.id}/photo-${String(position)}.svg`,
      thumbnailPath: `muestra/${plant.id}/thumb-${String(position)}.svg`,
      inBloom: position === 2,
      takenAt: position === 2 ? '2026-10-05' : null,
      note: position === 2 ? 'Primera vara floral del año.' : null,
      position,
      createdAt: '2026-11-22T12:00:00.000Z',
    })
  }
}

/** La galería con las filas de la muestra; la planta, con su principal. */
function SampleGallery({
  plant,
  onPlantUpdated,
}: {
  plant: CollectionPlant
  onPlantUpdated: (plant: CollectionPlant) => void
}) {
  const gallery = usePlantGallery(plant, SAMPLE_USER)
  const options = {
    userId: SAMPLE_USER,
    plantId: plant.id,
    rows: sampleRows,
    onPlantUpdated,
  }
  return (
    <PlantGallery
      plant={plant}
      gallery={gallery}
      readOnly={null}
      onPlantUpdated={onPlantUpdated}
      services={{
        updatePhoto: async ({ photo, main, details }) => {
          await wait()
          return updatePlantPhoto({ ...options, photo, main, changes: details })
        },
        reorderPhotos: async ({ photos, order }) => {
          await wait()
          return reorderPlantPhotos({ ...options, photos, order })
        },
      }}
    />
  )
}

function find(name: string): CollectionPlant | undefined {
  return SAMPLE_COLLECTION.find((plant) => plant.displayName === name)
}

const SCENARIOS = [
  {
    id: 'validada',
    label: 'Validada, con foto',
    plant: find('Phalaenopsis amabilis'),
    withPhoto: 3,
  },
  {
    id: 'por-validar',
    label: 'Por validar',
    plant: find('la naranja del mercado'),
    withPhoto: 0,
  },
  {
    id: 'no-identificable',
    label: 'No identificable',
    plant: find('dendrobio del regalo'),
    withPhoto: 1,
  },
  {
    id: 'perdida',
    label: 'Perdida',
    plant: find('Phalaenopsis schilleriana'),
    withPhoto: 0,
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
  const base: CollectionPlant | undefined =
    scenario.plant && scenario.withPhoto > 0
      ? {
          ...scenario.plant,
          photoPath: `muestra/${scenario.plant.id}/photo-0.svg`,
          thumbnailPath: `muestra/${scenario.plant.id}/thumb-0.svg`,
        }
      : scenario.plant
  // Con la baja, la reactivación o la principal que se cambió en la muestra.
  const plant = base && (changed[base.id] ?? base)
  if (plant) seedPhotos(plant, scenario.withPhoto)

  return (
    <Section
      id="detalle"
      title="Detalle del ejemplar"
      description="PlantDetailView, el contenido de /coleccion/:plantId, con plantas de la colección de ejemplo: la galería (PlantGallery, piezas orki-detail, orki-viewer y el visor orki-lightbox), todos los datos y las acciones. La foto grande y las miniaturas son miniaturas; la foto completa solo se pide al abrir el visor. Elige una miniatura, ábrela en grande (flechas, deslizar, Escape), edita su fecha y su nota, hazla principal o muévela: todo se guarda en memoria. Una planta no identificable lleva la etiqueta «Nombre por validar» y una frase que lo explica. Dar de baja y eliminar abren el diálogo de confirmación (ConfirmDialog): el foco queda dentro y Escape cancela. No se escribe nada."
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
            <Example title="Detalle de una planta" className="w-full">
              <p className="font-display text-xl font-semibold text-neutral-900">
                <PlantName plant={plant} />
              </p>
              <PlantImagesContext value={images}>
                <PlantPhotoRowsContext value={sampleRows}>
                  <PlantDetailView
                    key={plant.id}
                    plant={plant}
                    gallery={
                      <SampleGallery
                        key={plant.id}
                        plant={plant}
                        onPlantUpdated={(updated) =>
                          setChanged((current) => ({
                            ...current,
                            [updated.id]: updated,
                          }))
                        }
                      />
                    }
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
                </PlantPhotoRowsContext>
              </PlantImagesContext>
            </Example>
          )}
        </div>
      </Collapsible>
    </Section>
  )
}
