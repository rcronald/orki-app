import { memo } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { SpecimenCard } from '../components/ui/SpecimenCard.tsx'
import { plantThumbnail, plantValidationStatus } from './plant-display.ts'
import type { InventoryView } from './preferences.ts'

interface PlantCardProps {
  plant: CollectionPlant
  view: InventoryView
  headingLevel: 2 | 3
}

// Tarjeta de una planta del inventario: nombre (en cursiva si es del
// catálogo; el ingresado, sin cursiva, si está por validar), apodo, género e
// insignia de validación.
//
// Será el punto de entrada al detalle (#16): cuando exista la ruta, basta con
// pasar a SpecimenCard renderName={(name) => <Link to={...}>{name}</Link>}; el
// nombre del encabezado pasa a ser el enlace y el resto de la tarjeta no
// cambia. Va con memo: escribir en el buscador no vuelve a pintar las tarjetas
// que siguen igual.
export const PlantCard = memo(function PlantCard({
  plant,
  view,
  headingLevel,
}: PlantCardProps) {
  return (
    <SpecimenCard
      // Más compacta que la tarjeta por defecto (cuerpo con space-3 y nombre a
      // 16 px): en la cuadrícula de 360 px caben dos por fila sin partir
      // "Phalaenopsis". El cuerpo es el <div> hijo y el nombre, el encabezado.
      className="h-full [&>div]:p-space-3 [&_h2]:text-md [&_h3]:text-md"
      layout={view === 'list' ? 'row' : 'stacked'}
      headingLevel={headingLevel}
      scientificName={plant.displayName}
      nameStyle={plant.displayNameIsScientific ? 'scientific' : 'plain'}
      commonName={plant.nickname ?? undefined}
      status={plantValidationStatus(plant)}
      meta={plant.genus.name}
      photo={plantThumbnail(plant)}
    />
  )
})
