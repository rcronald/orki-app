import sinFoto from '../assets/sin-foto.svg?inline'
import type { CollectionPlant } from '../collection/model.ts'
import { usePlantImage } from '../photos/usePlantImage.ts'
import { DETAIL_TEXT } from './texts.ts'

/**
 * Foto completa de la planta (#83), pedida solo aquí, en el detalle: la lista
 * pide la miniatura. Mientras carga o si falla, el marcador neutro del
 * sistema con un texto alternativo que dice qué pasa (y si falla, se vuelve a
 * pedir al recuperar la conexión, ver usePlantImage). La caja tiene
 * proporción fija y la foto se ve entera dentro (object-contain): la imagen
 * no mueve nada al llegar, sea vertical u horizontal.
 *
 * Sin conexión (#18), la foto grande no está en el dispositivo (solo se
 * guardan las miniaturas): si no se puede cargar, se muestra la miniatura,
 * que sí está guardada.
 */
export function PlantPhoto({ plant }: { plant: CollectionPlant }) {
  const photo = usePlantImage(plant.photoPath, 'photo')
  const thumbnail = usePlantImage(
    plant.thumbnailPath,
    'thumbnail',
    photo.status === 'error',
  )
  const image =
    photo.status === 'error' && thumbnail.status === 'ready' ? thumbnail : photo
  const name = plant.displayName
  const src = image.status === 'ready' ? image.src : sinFoto
  const alt =
    image.status === 'none'
      ? DETAIL_TEXT.noPhoto
      : image.status === 'ready'
        ? DETAIL_TEXT.photoAlt(name)
        : image.status === 'error'
          ? DETAIL_TEXT.photoFailed(name)
          : DETAIL_TEXT.photoLoading(name)

  return (
    <div className="overflow-hidden rounded-lg bg-neutral-50">
      <img
        className={`block aspect-[4/3] w-full ${image.status === 'ready' ? 'object-contain' : 'object-cover'}`}
        src={src}
        alt={alt}
        decoding="async"
      />
    </div>
  )
}
