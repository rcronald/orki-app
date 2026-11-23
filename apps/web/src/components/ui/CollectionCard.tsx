import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import sinFoto from '../../assets/sin-foto.svg?inline'
import { Icon } from './Icon.tsx'
import { ScientificName } from './ScientificName.tsx'
import type { SpecimenPhoto } from './SpecimenCard.tsx'

export type CollectionCardProps = Omit<
  ComponentPropsWithRef<'article'>,
  'children'
> & {
  /** Nombre del ejemplar: el científico o, con nameStyle="plain", el ingresado. */
  scientificName: string
  /**
   * scientific (por defecto): cursiva de nomenclatura en font-display.
   * plain: texto en la fuente de cuerpo, para un nombre por validar.
   */
  nameStyle?: 'scientific' | 'plain'
  /** Segunda línea opcional: el apodo. */
  nickname?: ReactNode
  /**
   * Insignia opcional, solo si aplica (por ejemplo <StatusBadge
   * status="pending" />); la tarjeta no decide cuándo.
   */
  badge?: ReactNode
  /** Ubicación, con el icono map-pin; sin ella no hay fila. */
  location?: ReactNode
  /** Sin foto se muestra el marcador sin-foto.svg del sistema. */
  photo?: SpecimenPhoto
  /**
   * Número de fotos de la planta. Con más de una, un indicador sobre la
   * esquina de la foto (icono image y el número) y «N fotos» como
   * descripción de la tarjeta; con 0 o 1, nada.
   */
  photoCount?: number
  /** Nivel del encabezado del nombre; h3 por defecto. */
  headingLevel?: 2 | 3 | 4
  /** grid (por defecto): foto 3:2 arriba. list: miniatura a la izquierda. */
  layout?: 'grid' | 'list'
  /**
   * Envuelve el nombre en un enlace al detalle. Con la clase
   * orki-card__link, el enlace cubre toda la tarjeta (también la foto) y el
   * anillo de foco rodea la tarjeta.
   */
  renderName?: (name: ReactNode) => ReactNode
}

const NO_PHOTO_ALT = 'Sin foto'

// Indicador del número de fotos (#181, #184): la píldora orki-count (verde,
// número claro, como en «Filtros») con el icono image, colocada sobre la
// esquina de la foto: arriba a la derecha en la cuadrícula y arriba a la
// izquierda de la miniatura en la lista. El anillo blanco la separa de
// cualquier foto. No intercepta los toques: el enlace sigue cubriendo la
// tarjeta. Lo visible es decorativo; el lector lee «3 fotos», que es también
// la descripción de la tarjeta (el nombre sigue siendo el del encabezado).
const PHOTO_COUNT_CLASSES = {
  grid: 'right-space-2',
  list: 'left-space-2',
} as const

// Tarjeta de ejemplar de «Mi colección» (#206): borde fino color-neutral-200
// sobre color-neutral-0, radius-lg y sin sombra (orki-card orki-card--outline,
// un modificador de orki-card, que siguen usando el detalle y la muestra).
// Foto 3:2, nombre en cursiva font-display, apodo, insignia opcional y la fila
// de ubicación con map-pin. layout="list" (orki-card--row) es la fila de la
// vista en lista: miniatura de 96 px a la izquierda y el texto a la derecha.
export function CollectionCard({
  scientificName,
  nameStyle = 'scientific',
  nickname,
  badge,
  location,
  photo,
  photoCount = 0,
  headingLevel = 3,
  layout = 'grid',
  renderName,
  className,
  ...props
}: CollectionCardProps) {
  const headingId = useId()
  const photoCountId = useId()
  const showPhotoCount = photoCount > 1
  const Heading = `h${headingLevel}` as const
  const classes = [
    'orki-card orki-card--outline',
    layout === 'list' && 'orki-card--row',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const name =
    nameStyle === 'plain' ? (
      scientificName
    ) : (
      <ScientificName name={scientificName} />
    )

  return (
    <article
      aria-labelledby={headingId}
      aria-describedby={showPhotoCount ? photoCountId : undefined}
      {...props}
      className={classes}
    >
      <img
        className="orki-card__photo"
        src={photo?.src ?? sinFoto}
        alt={photo?.alt ?? NO_PHOTO_ALT}
        loading="lazy"
        decoding="async"
      />
      <div className="orki-card__body">
        <Heading
          id={headingId}
          className={
            nameStyle === 'plain'
              ? 'orki-card__name font-body not-italic'
              : 'orki-card__name'
          }
        >
          {renderName ? renderName(name) : name}
        </Heading>
        {nickname != null && <p className="orki-card__common">{nickname}</p>}
        {badge}
        {location != null && (
          <p className="orki-card__place">
            <Icon name="map-pin" />
            <span className="sr-only">Ubicación: </span>
            {location}
          </p>
        )}
        {showPhotoCount && (
          <span
            className={`orki-count pointer-events-none absolute top-space-2 grid-flow-col gap-space-1 px-space-2 shadow-[0_0_0_2px_var(--color-neutral-0)] ${PHOTO_COUNT_CLASSES[layout]}`}
          >
            <Icon name="image" className="size-[14px]" />
            <span aria-hidden="true">{photoCount}</span>
            <span id={photoCountId} className="sr-only">
              {photoCount} fotos
            </span>
          </span>
        )}
      </div>
    </article>
  )
}
