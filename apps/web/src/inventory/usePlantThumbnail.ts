import type { RefObject } from 'react'
import sinFoto from '../assets/sin-foto.svg?inline'
import type { CollectionPlant } from '../collection/model.ts'
import type { SpecimenPhoto } from '../components/ui/SpecimenCard.tsx'
import { useNearViewport, usePlantImage } from '../photos/usePlantImage.ts'
import { plantPhotoAlt } from './plant-display.ts'

/**
 * Miniatura de una planta para su tarjeta (#83). Solo pide la miniatura
 * (thumbnailPath), nunca la foto grande, y solo cuando la tarjeta está en
 * pantalla o cerca. Mientras carga o si falla, el marcador neutro del
 * sistema, con un texto alternativo que dice qué pasa; la caja de la foto
 * tiene proporción fija, así que la imagen no mueve nada al llegar. Sin
 * thumbnailPath, undefined: la tarjeta pone su marcador "Sin foto".
 */
export function usePlantThumbnail(
  plant: CollectionPlant,
  cardRef: RefObject<Element | null>,
): SpecimenPhoto | undefined {
  const path = plant.thumbnailPath
  const near = useNearViewport(cardRef)
  const image = usePlantImage(path, 'thumbnail', near)
  if (path === null) return undefined
  if (image.status === 'ready') {
    return { src: image.src, alt: plantPhotoAlt(plant) }
  }
  return {
    src: sinFoto,
    alt:
      image.status === 'error'
        ? `${plantPhotoAlt(plant)}: no se pudo cargar`
        : `${plantPhotoAlt(plant)}: cargando`,
  }
}
