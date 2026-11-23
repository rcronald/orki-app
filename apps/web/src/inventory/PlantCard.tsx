import { memo, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import { CollectionCard } from '../components/ui/CollectionCard.tsx'
import { StatusBadge } from '../components/ui/StatusBadge.tsx'
import { FROM_INVENTORY } from '../detail/navigation.ts'
import { plantDetailPath } from '../routes/paths.ts'
import { plantValidationStatus } from './plant-display.ts'
import type { InventoryView } from './preferences.ts'
import { usePlantThumbnail } from './usePlantThumbnail.ts'

interface PlantCardProps {
  plant: CollectionPlant
  view: InventoryView
  headingLevel: 2 | 3
}

// Tarjeta de una planta del inventario (CollectionCard, #208): foto o el
// marcador sin foto, nombre (en cursiva si es del catálogo; el ingresado, sin
// cursiva, si está por validar), apodo y ubicación si los hay, e insignia solo
// cuando el nombre pide atención: «Nombre por validar» o «No identificable».
// Con más de una foto, el número sobre la esquina de la foto (#181). Bajo el
// nombre, el identificador («PHA-001», #292), que distingue las tarjetas de
// varias plantas de la misma especie; una copia sin conexión anterior al
// #265 no lo trae y no se pinta.
// Las validadas no llevan insignia: es lo normal. La miniatura se pide solo
// cuando la tarjeta está cerca de la pantalla (usePlantThumbnail).
//
// Es la entrada al detalle (#16): el nombre del encabezado es un enlace
// (orki-card__link), que es también el nombre accesible de la tarjeta, y su
// ::after cubre la tarjeta entera, así que se puede tocar en cualquier parte
// (también la foto); el anillo de foco va por dentro del borde. Lleva en el
// estado de la navegación que se llegó desde el inventario: "Volver" en el
// detalle es entonces "atrás" y recupera la búsqueda, los filtros y la
// posición. Va con memo: escribir en el buscador no vuelve a pintar las
// tarjetas que siguen igual.
export const PlantCard = memo(function PlantCard({
  plant,
  view,
  headingLevel,
}: PlantCardProps) {
  const ref = useRef<HTMLElement>(null)
  const photo = usePlantThumbnail(plant, ref)
  const status = plantValidationStatus(plant)
  return (
    <CollectionCard
      ref={ref}
      className="h-full"
      layout={view}
      headingLevel={headingLevel}
      scientificName={plant.displayName}
      nameStyle={plant.displayNameIsScientific ? 'scientific' : 'plain'}
      nickname={plant.nickname ?? undefined}
      location={plant.location ?? undefined}
      code={plant.code ?? undefined}
      badge={
        status === 'validated' ? undefined : <StatusBadge status={status} />
      }
      photo={photo}
      photoCount={plant.photoCount}
      renderName={(name: ReactNode) => (
        <Link
          to={plantDetailPath(plant.id)}
          state={FROM_INVENTORY}
          className="orki-card__link"
        >
          {name}
        </Link>
      )}
    />
  )
})
