import type { ReactNode } from 'react'

interface SectionProps {
  id: string
  title: string
  description?: ReactNode
  children: ReactNode
}

// Sección de la página de muestra: fondo color-neutral-50 y título en
// font-display, como las secciones del sistema.
export function Section({ id, title, description, children }: SectionProps) {
  const titleId = `${id}-titulo`
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className="flex scroll-mt-space-4 flex-col gap-space-4 rounded-lg bg-neutral-50 p-space-4"
    >
      <div className="flex flex-col gap-space-1">
        <h2 id={titleId} className="font-display text-xl text-secondary">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-neutral-700">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

interface ExampleProps {
  title: string
  description?: ReactNode
  children: ReactNode
  className?: string
}

// Zona de ejemplo: fondo color-neutral-0, como una pantalla de la app. Lleva
// como mucho una acción primaria.
export function Example({
  title,
  description,
  children,
  className,
}: ExampleProps) {
  return (
    <div
      className={[
        'flex min-w-0 flex-col gap-space-3 rounded-md bg-neutral-0 p-space-4',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex flex-col gap-space-1">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {description && (
          <p className="text-sm text-neutral-700">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}
