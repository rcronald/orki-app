import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import sinFoto from '../../assets/sin-foto.svg?inline'
import { StatusBadge, type ValidationStatus } from './StatusBadge.tsx'

export interface SpecimenPhoto {
  src: string
  /** Qué se ve en la foto: "Phalaenopsis amabilis en floración". */
  alt: string
}

export type SpecimenCardProps = Omit<
  ComponentPropsWithRef<'article'>,
  'children'
> & {
  /** Nombre científico, o el género solo si es lo único que se conoce. */
  scientificName: string
  /** Nombre "como lo conocen". */
  commonName?: ReactNode
  status: ValidationStatus
  /** Línea de metadatos: origen y fecha. */
  meta?: ReactNode
  /** Sin foto se muestra el marcador sin-foto.svg del sistema. */
  photo?: SpecimenPhoto
  /** Nivel del encabezado del nombre; h3 por defecto. */
  headingLevel?: 2 | 3 | 4
}

// Texto alternativo del marcador: dice que el ejemplar aún no tiene foto.
const NO_PHOTO_ALT = 'Sin foto'

// Tarjeta de un ejemplar (orki-card). La foto es el único color: sin filtros
// ni texto encima. El nombre científico va en cursiva con la fuente de títulos
// (orki-card__name) y el nombre común en la de cuerpo.
export function SpecimenCard({
  scientificName,
  commonName,
  status,
  meta,
  photo,
  headingLevel = 3,
  className,
  ...props
}: SpecimenCardProps) {
  const headingId = useId()
  const Heading = `h${headingLevel}` as const
  const classes = ['orki-card', className].filter(Boolean).join(' ')

  return (
    <article aria-labelledby={headingId} {...props} className={classes}>
      <img
        className="orki-card__photo"
        src={photo?.src ?? sinFoto}
        alt={photo?.alt ?? NO_PHOTO_ALT}
        loading="lazy"
        decoding="async"
      />
      <div className="orki-card__body">
        <Heading className="orki-card__name" id={headingId}>
          {scientificName}
        </Heading>
        {commonName != null && (
          <p className="orki-card__common">{commonName}</p>
        )}
        <StatusBadge status={status} />
        {meta != null && <p className="orki-card__meta">{meta}</p>}
      </div>
    </article>
  )
}
