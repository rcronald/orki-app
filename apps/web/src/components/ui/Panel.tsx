import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'

export type PanelProps = Omit<
  ComponentPropsWithRef<'section'>,
  'title' | 'children'
> & {
  /** Título de la sección en font-display: «Perfil». */
  title: ReactNode
  /** Nivel del título; h2 por defecto. */
  headingLevel?: 2 | 3
  /**
   * default: borde fino color-neutral-200, sin fondo ni sombra. danger: borde
   * color-danger, fondo color-danger-soft y título en color-danger, para
   * «Eliminar cuenta».
   */
  tone?: 'default' | 'danger'
  children?: ReactNode
}

// Sección con borde (orki-panel, #213): una caja con radius-lg, su título y
// el contenido. Es una región con nombre (el título). Para un párrafo dentro,
// <p className="orki-panel__text">.
export function Panel({
  title,
  headingLevel = 2,
  tone = 'default',
  className,
  children,
  ...props
}: PanelProps) {
  const titleId = useId()
  const Heading = `h${headingLevel}` as const
  const classes = [
    'orki-panel',
    tone === 'danger' && 'orki-panel--danger',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <section aria-labelledby={titleId} {...props} className={classes}>
      <Heading id={titleId} className="orki-panel__title">
        {title}
      </Heading>
      {children}
    </section>
  )
}
