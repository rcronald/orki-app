import { useState } from 'react'
import { PLANT_STATUS_LABEL } from '../collection/labels.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { Collapsible } from '../components/ui/Collapsible.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import {
  PlantActions,
  type PlantActionServices,
} from '../detail/PlantActions.tsx'
import {
  PlantDetailView,
  PlantMeta,
  PlantName,
} from '../detail/PlantDetailView.tsx'
import { PlantGallery } from '../detail/PlantGallery.tsx'
import { PlantNotes } from '../detail/PlantNotes.tsx'
import { DETAIL_TEXT } from '../detail/texts.ts'
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
// del navegador. Las notas (#265) se editan en memoria; con «Fallar al
// guardar las notas» el guardado falla para ver el error y el reintento.

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
  const [notesFail, setNotesFail] = useState(false)
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
      description="La ficha de /coleccion/:plantId (#265, maqueta «Ficha de la planta» del #263) con plantas de la colección de ejemplo: el nombre con la línea de datos (PlantMeta: insignia, identificador, tipo y estado, separados por una raya fina), la galería (PlantGallery: «1 de 3» sobre la esquina con orki-gallery__count, «Foto anterior» y «Foto siguiente» sobre la foto, miniaturas, «Editar fecha y nota» y «Ordenar fotos», que despliega «Hacer principal», «Mover antes» y «Mover después»; sin fotos, un estado vacío compacto), «Datos de la planta» en dos columnas con «Ver la especie en el catálogo» y «Completar datos», «Notas» editables en el sitio (PlantNotes) y «Gestionar planta» plegado (Collapsible con borde) con dar de baja y eliminar. En escritorio, dos columnas (orki-detail, la de la galería algo más ancha); hasta 720 px, una. La foto grande y las miniaturas son miniaturas; la foto completa solo se pide al abrir el visor (flechas, deslizar, Escape). Todo se guarda en memoria; no se escribe nada."
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
          <div>
            <Chip selected={notesFail} onClick={() => setNotesFail((v) => !v)}>
              Fallar al guardar las notas
            </Chip>
          </div>
          {plant && (
            <Example title="Detalle de una planta" className="w-full">
              <p className="font-display text-xl font-semibold text-neutral-900">
                <PlantName plant={plant} />
              </p>
              <div className="text-md text-neutral-700">
                <PlantMeta plant={plant} />
              </div>
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
                    notes={
                      <PlantNotes
                        plant={plant}
                        canEdit
                        onSave={async (notes) => {
                          await wait()
                          if (notesFail) {
                            throw new Error(
                              'No se pudieron guardar los cambios por un error del servidor. Vuelve a intentarlo en unos momentos.',
                            )
                          }
                          return { ...plant, notes }
                        }}
                        onSaved={(updated) =>
                          setChanged((current) => ({
                            ...current,
                            [updated.id]: updated,
                          }))
                        }
                      />
                    }
                    manage={
                      <Collapsible
                        headingLevel={3}
                        className="rounded-lg border border-neutral-200"
                        title={
                          <span className="flex items-center gap-space-3">
                            <Icon
                              name="settings"
                              className="size-[24px] flex-none"
                            />
                            {DETAIL_TEXT.actionsLabel}
                          </span>
                        }
                      >
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
                      </Collapsible>
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
