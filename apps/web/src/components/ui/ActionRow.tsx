import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from './Icon.tsx'

interface ActionRowBase {
  icon: IconName
  /** Título de la fila: «Exportar tu colección a CSV». */
  title: string
  /** Texto secundario: «El archivo CSV no incluye las fotos». */
  description?: ReactNode
  /**
   * Motivo por el que no se puede usar ahora («Necesitas conexión para…»).
   * Con él la fila queda deshabilitada (aria-disabled, sigue recibiendo el
   * foco para que se lea el motivo) y el motivo ocupa el texto secundario.
   */
  disabledReason?: string
}

export type ActionRowProps = ActionRowBase &
  (
    | {
        /** Ruta interna: la fila es un enlace (Link de React Router). */
        to: string
        /** Estado de navegación, como privacyLinkProps('cuenta').state. */
        state?: unknown
        onClick?: never
      }
    | {
        to?: never
        state?: never
        /**
         * Sin `to`, la fila es un botón. Opcional solo con disabledReason
         * (una fila deshabilitada no hace nada).
         */
        onClick?: () => void
      }
  )

// Fila de acción (orki-action, #213): icono, título, texto secundario y
// chevron-right, con área táctil de todo el ancho (mínimo 56 px). Va dentro
// de ActionList, que pone la línea entre filas. El nombre accesible es el
// título seguido del texto secundario (aria-labelledby con los dos).
export function ActionRow({
  icon,
  title,
  description,
  disabledReason,
  ...target
}: ActionRowProps) {
  const id = useId()
  const titleId = `${id}-titulo`
  const descriptionId = `${id}-texto`
  const secondary = disabledReason ?? description
  const content = (
    <>
      <Icon name={icon} />
      <span className="orki-action__text">
        <span id={titleId} className="orki-action__title">
          {title}
        </span>
        {/* Espacio entre el título y el texto (no ocupa sitio en la
            columna flex): sin él, el texto visible que lee axe los junta
            («CSVEl archivo…») y no lo encuentra en el nombre. */}
        {secondary != null && ' '}
        {secondary != null && (
          <span id={descriptionId} className="orki-action__desc">
            {secondary}
          </span>
        )}
      </span>
      <Icon name="chevron-right" />
    </>
  )
  // El nombre accesible lleva todo el texto visible, el título primero (WCAG
  // 2.5.3, «Etiqueta en el nombre»; axe, label-content-name-mismatch): con
  // solo el título, el texto secundario visible quedaba fuera del nombre.
  const labelledBy = secondary != null ? `${titleId} ${descriptionId}` : titleId

  if (disabledReason !== undefined) {
    return (
      <button
        type="button"
        className="orki-action"
        aria-disabled="true"
        aria-labelledby={labelledBy}
      >
        {content}
      </button>
    )
  }
  if (target.to !== undefined) {
    return (
      <Link
        to={target.to}
        state={target.state}
        className="orki-action"
        aria-labelledby={labelledBy}
      >
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      className="orki-action"
      aria-labelledby={labelledBy}
      onClick={target.onClick}
    >
      {content}
    </button>
  )
}

export type ActionListProps = ComponentPropsWithRef<'ul'>

// Lista de filas de acción (orki-actions): una línea color-neutral-200 entre
// filas. Cada fila va en su <li>.
export function ActionList({ className, ...props }: ActionListProps) {
  return (
    <ul
      {...props}
      className={['orki-actions', className].filter(Boolean).join(' ')}
    />
  )
}
