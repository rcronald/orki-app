import {
  useId,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from 'react'
import { Icon } from './Icon.tsx'

type HeadingLevel = 2 | 3 | 4 | 5 | 6

export interface CollapsibleProps extends Omit<
  ComponentPropsWithRef<'div'>,
  'title'
> {
  /** Título de la cabecera, por ejemplo "Más detalles". */
  title: ReactNode
  /** Abierta al montarse (modo no controlado). Por defecto, cerrada. */
  defaultOpen?: boolean
  /** Estado abierto o cerrado (modo controlado). */
  open?: boolean
  /** Se llama con el estado nuevo al pulsar la cabecera. */
  onOpenChange?: (open: boolean) => void
  /** Si se indica, la cabecera va dentro de un encabezado de ese nivel. */
  headingLevel?: HeadingLevel
  children: ReactNode
}

/**
 * Sección plegable (patrón disclosure de WAI-ARIA APG). La cabecera es un
 * botón con aria-expanded y aria-controls; el contenido cerrado lleva el
 * atributo hidden, así que no se alcanza con el teclado ni lo leen los
 * lectores de pantalla. El botón no se vuelve a montar al cambiar de estado,
 * por lo que conserva el foco.
 */
export function Collapsible({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  headingLevel,
  className,
  children,
  ...rest
}: CollapsibleProps) {
  const baseId = useId()
  const contentId = `${baseId}-content`
  const [openState, setOpenState] = useState(defaultOpen)
  const open = openProp ?? openState

  const toggle = () => {
    const next = !open
    if (openProp === undefined) setOpenState(next)
    onOpenChange?.(next)
  }

  const header = (
    <button
      type="button"
      className="orki-collapsible__header"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={toggle}
    >
      <span>{title}</span>
      <Icon name="chevron-down" className="orki-collapsible__icon" />
    </button>
  )

  const Heading = headingLevel ? (`h${headingLevel}` as const) : null

  return (
    <div
      {...rest}
      className={['orki-collapsible', className].filter(Boolean).join(' ')}
    >
      {Heading ? (
        <Heading className="orki-collapsible__heading">{header}</Heading>
      ) : (
        header
      )}
      <div id={contentId} className="orki-collapsible__content" hidden={!open}>
        {children}
      </div>
    </div>
  )
}
