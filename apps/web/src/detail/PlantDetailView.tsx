import type { ReactNode } from 'react'
import { FLOWER_COLOR_LABEL, PLANT_STATUS_LABEL } from '../collection/labels.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { StatusBadge } from '../components/ui/StatusBadge.tsx'
import { plantValidationStatus } from '../inventory/plant-display.ts'
import { formatCalendarDate } from './format.ts'
import { PlantPhoto } from './PlantPhoto.tsx'
import { DETAIL_TEXT, DETAIL_TYPE_LABEL } from './texts.ts'

/**
 * Nombre que se muestra de la planta: el científico del catálogo en cursiva
 * botánica (ScientificName) o el que ingresó la persona, en redonda, si está
 * por validar. Para el h1 del detalle.
 */
export function PlantName({ plant }: { plant: CollectionPlant }) {
  return plant.displayNameIsScientific ? (
    <span className="font-display italic">
      <ScientificName name={plant.displayName} />
    </span>
  ) : (
    <span className="font-body">{plant.displayName}</span>
  )
}

/** Si el nombre ingresado dice algo distinto del que se muestra. */
function enteredNameDiffers(plant: CollectionPlant): boolean {
  const normalize = (text: string) =>
    text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
  return normalize(plant.enteredName) !== normalize(plant.displayName)
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-space-1 border-b border-neutral-50 pb-space-3 last:border-b-0 last:pb-[0]">
      <dt className="text-sm text-neutral-700">{label}</dt>
      <dd className="text-md text-neutral-900 [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  )
}

function Missing() {
  return <span className="text-neutral-700">{DETAIL_TEXT.missing}</span>
}

interface PlantDetailViewProps {
  plant: CollectionPlant
  /** Aviso de lo último que se hizo (guardar, dar de baja…), arriba. */
  notice?: ReactNode
  /** Acciones (editar, dar de baja, eliminar), al final. */
  actions?: ReactNode
}

/**
 * Detalle de un ejemplar (#16) sin la carga de datos: la foto completa y todos
 * sus datos. El nombre va en el h1 de la página (PlantName). Lo usan
 * PlantDetailPage con la colección y la página de muestra con datos fijos.
 *
 * Una planta "no identificable" (la cola de propuestas no pudo identificar
 * su nombre, #141) lleva su propia etiqueta y una frase que explica qué
 * significa y que sigue en la colección.
 */
export function PlantDetailView({
  plant,
  notice,
  actions,
}: PlantDetailViewProps) {
  return (
    <div className="flex flex-col gap-space-4">
      {notice}
      <PlantPhoto plant={plant} />
      <h2 className="sr-only">{DETAIL_TEXT.dataLabel}</h2>
      <dl className="flex flex-col gap-space-3">
        {enteredNameDiffers(plant) && (
          <Row label={DETAIL_TEXT.enteredName}>{plant.enteredName}</Row>
        )}
        <Row label={DETAIL_TEXT.validation}>
          <span className="flex flex-col items-start gap-space-1">
            <StatusBadge status={plantValidationStatus(plant)} />
            {plant.validation === 'unidentifiable' && (
              <span className="text-sm text-neutral-700">
                {DETAIL_TEXT.unidentifiable}
              </span>
            )}
          </span>
        </Row>
        <Row label={DETAIL_TEXT.genus}>{plant.genus.name}</Row>
        <Row label={DETAIL_TEXT.type}>{DETAIL_TYPE_LABEL[plant.type]}</Row>
        <Row label={DETAIL_TEXT.status}>{PLANT_STATUS_LABEL[plant.status]}</Row>
        <Row label={DETAIL_TEXT.acquiredOn}>
          {formatCalendarDate(plant.acquiredOn)}
        </Row>
        <Row label={DETAIL_TEXT.origin}>{plant.origin ?? <Missing />}</Row>
        <Row label={DETAIL_TEXT.location}>{plant.location ?? <Missing />}</Row>
        <Row label={DETAIL_TEXT.nickname}>{plant.nickname ?? <Missing />}</Row>
        <Row label={DETAIL_TEXT.flowerColor}>
          {plant.flowerColor ? (
            FLOWER_COLOR_LABEL[plant.flowerColor]
          ) : (
            <Missing />
          )}
        </Row>
        {plant.photoPath !== null && (
          <Row label={DETAIL_TEXT.photoInBloom}>
            {plant.photoInBloom ? DETAIL_TEXT.yes : DETAIL_TEXT.no}
          </Row>
        )}
      </dl>
      {actions}
    </div>
  )
}
