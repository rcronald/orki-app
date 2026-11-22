import type { ReactNode, Ref } from 'react'
import art240 from '../../assets/ilustraciones/cabecera-240.webp'
import art480 from '../../assets/ilustraciones/cabecera-480.webp'

export interface PageHeaderProps {
  /** Contenido del h1: «Mi colección». */
  title: ReactNode
  /** Línea bajo el título: el contador o la frase de apoyo. */
  meta?: ReactNode
  /**
   * Hasta dos acciones (la principal primero): a la derecha en escritorio y
   * apiladas a todo el ancho hasta 720 px. Solo en la variante por defecto.
   */
  actions?: ReactNode
  /** Enlace de volver, encima del título (orki-pagehead__back). */
  back?: ReactNode
  /**
   * default: título a la izquierda y acciones a la derecha. center: pantalla
   * de una sola tarea («¿Ya la tengo?»), con el título y la frase centrados.
   */
  variant?: 'default' | 'center'
  /** Con la ilustración de la esquina (por defecto, sí). */
  art?: boolean
  /** Referencia al h1, para darle el foco al navegar (Page lo hace). */
  headingRef?: Ref<HTMLHeadingElement>
  /** Nivel del título; h1 salvo en la página de muestra. */
  headingLevel?: 1 | 2
  className?: string
}

const ART_SIZES = '(max-width: 720px) 96px, 160px'
// Medidas de las dos variantes (assets/ilustraciones/medidas.json).
const ART = { small: { width: 240, height: 186 }, largeWidth: 480 }

// Cabecera de pantalla del sistema (orki-pagehead, #206): título grande en
// font-display y color-secondary-strong (64 px; 32 hasta 720 px), una línea de
// contador o de apoyo en color-neutral-700, hueco para dos acciones e
// ilustración en color en la esquina superior izquierda. La ilustración es
// decorativa (alt vacío): el texto se aparta para que no lo tape y no provoca
// desplazamiento horizontal. Se usa a través de Page (prop header), que pone
// el título de la pestaña y el foco al navegar.
export function PageHeader({
  title,
  meta,
  actions,
  back,
  variant = 'default',
  art = true,
  headingRef,
  headingLevel = 1,
  className,
}: PageHeaderProps) {
  const Heading = `h${headingLevel}` as const
  const classes = [
    'orki-pagehead',
    variant === 'center' && 'orki-pagehead--center',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      {art && (
        <img
          className="orki-pagehead__art"
          src={art240}
          srcSet={`${art240} ${ART.small.width}w, ${art480} ${ART.largeWidth}w`}
          sizes={ART_SIZES}
          width={ART.small.width}
          height={ART.small.height}
          alt=""
          decoding="async"
        />
      )}
      <div className="orki-pagehead__text">
        {back}
        <Heading
          ref={headingRef}
          tabIndex={-1}
          className="orki-pagehead__title"
        >
          {title}
        </Heading>
        {meta != null && <p className="orki-pagehead__meta">{meta}</p>}
      </div>
      {actions != null && variant === 'default' && (
        <div className="orki-pagehead__actions">{actions}</div>
      )}
    </div>
  )
}
