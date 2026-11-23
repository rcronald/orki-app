import { useState, type ReactNode, type Ref } from 'react'
import art240 from '../../assets/ilustraciones/cabecera-240.webp'
import art480 from '../../assets/ilustraciones/cabecera-480.webp'

export interface PageHeaderProps {
  /** Contenido del h1: «Mi colección». */
  title: ReactNode
  /**
   * Línea bajo el título: el contador o la frase de apoyo. Un texto va en un
   * <p>; un elemento (una lista, por ejemplo), en un <div>.
   */
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
  /**
   * Con la ilustración de la esquina (por defecto, sí). Si no carga (sin
   * conexión: no va en el precaché), la cabecera sigue sin ella, sin el hueco
   * de una imagen rota.
   */
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
  // La ilustración no va en el precaché: sin red no carga y el navegador
  // pintaría el icono de una imagen rota. Si falla, se quita y el texto
  // vuelve a su sitio (las reglas de orki-pagehead__art + … dejan de aplicar).
  const [artFailed, setArtFailed] = useState(false)
  const classes = [
    'orki-pagehead',
    variant === 'center' && 'orki-pagehead--center',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      {art && !artFailed && (
        <img
          onError={() => setArtFailed(true)}
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
        {meta != null &&
          // Un texto va en un párrafo; algo con estructura (la lista de
          // datos de la ficha, #265), en un div con la misma clase.
          (typeof meta === 'string' || typeof meta === 'number' ? (
            <p className="orki-pagehead__meta">{meta}</p>
          ) : (
            <div className="orki-pagehead__meta">{meta}</div>
          ))}
      </div>
      {actions != null && variant === 'default' && (
        <div className="orki-pagehead__actions">{actions}</div>
      )}
    </div>
  )
}
