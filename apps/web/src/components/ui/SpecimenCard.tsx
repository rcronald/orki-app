import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import sinFoto from '../../assets/sin-foto.svg?inline'
import { ScientificName } from './ScientificName.tsx'
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
  /**
   * Nombre científico, o el género solo si es lo único que se conoce. Con
   * nameStyle="plain", el nombre que ingresó la persona.
   */
  scientificName: string
  /**
   * scientific (por defecto): en cursiva según la nomenclatura, con el signo
   * "×", el grex y el cultivar en redonda (ScientificName). plain: texto
   * normal en la fuente de cuerpo, para un nombre que aún no es del catálogo
   * ("por validar").
   */
  nameStyle?: 'scientific' | 'plain'
  /** Nombre "como lo conocen". */
  commonName?: ReactNode
  status: ValidationStatus
  /** Línea de metadatos: origen y fecha. */
  meta?: ReactNode
  /** Sin foto se muestra el marcador sin-foto.svg del sistema. */
  photo?: SpecimenPhoto
  /** Nivel del encabezado del nombre; h3 por defecto. */
  headingLevel?: 2 | 3 | 4
  /**
   * stacked (por defecto): foto arriba y texto debajo, para cuadrículas.
   * row: miniatura cuadrada a la izquierda y texto a la derecha, para listas.
   */
  layout?: 'stacked' | 'row'
  /**
   * Envuelve el nombre dentro del encabezado; por ejemplo, en un enlace al
   * detalle del ejemplar. El encabezado sigue siendo el nombre accesible de la
   * tarjeta.
   */
  renderName?: (name: ReactNode) => ReactNode
}

// Texto alternativo del marcador: dice que el ejemplar aún no tiene foto.
const NO_PHOTO_ALT = 'Sin foto'

// Tarjeta de un ejemplar (orki-card). La foto es el único color: sin filtros
// ni texto encima. El nombre científico va en cursiva con la fuente de títulos
// (orki-card__name) y el nombre común en la de cuerpo. Un nombre "plain" va
// sin cursiva y en la fuente de cuerpo: la cursiva queda para los nombres del
// catálogo.
export function SpecimenCard({
  scientificName,
  nameStyle = 'scientific',
  commonName,
  status,
  meta,
  photo,
  headingLevel = 3,
  layout = 'stacked',
  renderName,
  className,
  ...props
}: SpecimenCardProps) {
  const headingId = useId()
  const Heading = `h${headingLevel}` as const
  const isRow = layout === 'row'
  const classes = ['orki-card', isRow && 'flex-row', className]
    .filter(Boolean)
    .join(' ')
  const name =
    nameStyle === 'plain' ? (
      scientificName
    ) : (
      <ScientificName name={scientificName} />
    )

  return (
    <article aria-labelledby={headingId} {...props} className={classes}>
      <img
        className={
          isRow
            ? 'orki-card__photo aspect-square w-1/4 flex-none self-start'
            : 'orki-card__photo'
        }
        src={photo?.src ?? sinFoto}
        alt={photo?.alt ?? NO_PHOTO_ALT}
        loading="lazy"
        decoding="async"
      />
      <div
        className={
          isRow
            ? 'orki-card__body min-w-[0] flex-1 p-space-3'
            : 'orki-card__body'
        }
      >
        <Heading
          className={
            nameStyle === 'plain'
              ? 'orki-card__name font-body not-italic'
              : 'orki-card__name'
          }
          id={headingId}
        >
          {renderName ? renderName(name) : name}
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
