import { memo, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import { SpecimenCard } from '../components/ui/SpecimenCard.tsx'
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

// Tarjeta de una planta del inventario: nombre (en cursiva si es del
// catálogo; el ingresado, sin cursiva, si está por validar), apodo, género e
// insignia de validación. La miniatura se pide solo cuando la tarjeta está
// cerca de la pantalla (usePlantThumbnail).
//
// Es la entrada al detalle (#16): el nombre del encabezado es un enlace, que
// es también el nombre accesible de la tarjeta, y su ::after cubre la tarjeta
// entera, así que se puede tocar en cualquier parte (también la foto). El
// anillo de foco lo pinta ese ::after, por dentro del borde (la tarjeta
// recorta lo que sobresale). Lleva en el estado de la navegación que se llegó
// desde el inventario: "Volver" en el detalle es entonces "atrás" y recupera
// la búsqueda, los filtros y la posición. Va con memo: escribir en el buscador
// no vuelve a pintar las tarjetas que siguen igual.

const LINK_CLASSES = [
  'hover:underline focus-visible:outline-none',
  "after:absolute after:inset-[0] after:rounded-lg after:content-['']",
  'focus-visible:after:[outline:2px_solid_var(--color-secondary)]',
  'focus-visible:after:[outline-offset:-2px]',
].join(' ')
export const PlantCard = memo(function PlantCard({
  plant,
  view,
  headingLevel,
}: PlantCardProps) {
  const ref = useRef<HTMLElement>(null)
  const photo = usePlantThumbnail(plant, ref)
  return (
    <SpecimenCard
      ref={ref}
      // Más compacta que la tarjeta por defecto (cuerpo con space-3 y nombre a
      // 16 px): en la cuadrícula de 360 px caben dos por fila sin partir
      // "Phalaenopsis". El cuerpo es el <div> hijo y el nombre, el encabezado.
      className="relative h-full [&>div]:p-space-3 [&_h2]:text-md [&_h3]:text-md"
      layout={view === 'list' ? 'row' : 'stacked'}
      headingLevel={headingLevel}
      scientificName={plant.displayName}
      nameStyle={plant.displayNameIsScientific ? 'scientific' : 'plain'}
      commonName={plant.nickname ?? undefined}
      status={plantValidationStatus(plant)}
      meta={plant.genus.name}
      photo={photo}
      renderName={(name: ReactNode) => (
        <Link
          to={plantDetailPath(plant.id)}
          state={FROM_INVENTORY}
          className={LINK_CLASSES}
        >
          {name}
        </Link>
      )}
    />
  )
})
