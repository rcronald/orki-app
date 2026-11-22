import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { useFocusOnNavigation, usePageTitle } from '../routes/navigation.ts'
import { Icon } from './ui/Icon.tsx'

// Página de texto del design system (orki-textpage, #199): privacidad y
// créditos. Enlace para volver (con arrow-left), título en text-hero, frase de
// apoyo, fecha de la última actualización, caja «En esta página»
// (orki-toc) con un enlace a cada sección y las secciones en una columna de
// lectura, cada una con una frase de resumen al principio.
//
// Índice: cada enlace apunta al id del título de su sección (un id estable),
// así la dirección con #id se puede compartir. Al activarlo, el navegador
// salta a la sección sin animación (nada de desplazamiento suave, que además
// tendría que respetar prefers-reduced-motion) y el foco pasa a su título
// (tabIndex -1), para que el lector de pantalla lo lea y el tabulador siga
// desde ahí. El título lleva scroll-margin-top para no quedar pegado al borde
// ni bajo una barra fija.

export interface TextPageSection {
  /** Id del título de la sección, el destino de su enlace del índice. */
  id: string
  title: string
  /** Frase corta de resumen, al principio de la sección. */
  summary: ReactNode
  children: ReactNode
}

interface TextPageProps {
  title: string
  lead: ReactNode
  /** Fecha de la última actualización: el texto visible y la fecha ISO. */
  updated?: { label: string; iso: string }
  /** Enlace para volver, encima del título. */
  back: { to: string; label: string }
  sections: readonly TextPageSection[]
  /** Lo que va después de las secciones. */
  children?: ReactNode
}

export function TextPage({
  title,
  lead,
  updated,
  back,
  sections,
  children,
}: TextPageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  usePageTitle(title)
  useFocusOnNavigation(headingRef)
  const { hash } = useLocation()

  // Al abrir la página con #id (un enlace compartido), a esa sección. La
  // página llega en un chunk diferido, así que el navegador no la encontró
  // al cargar. Solo al llegar; sin mover el foco.
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1))
    if (id === '') return
    document.getElementById(id)?.scrollIntoView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="orki-textpage">
      <div className="orki-textpage__header">
        <Link to={back.to} className="orki-link">
          <Icon name="arrow-left" />
          {back.label}
        </Link>
        <h1 ref={headingRef} tabIndex={-1} className="orki-textpage__title">
          {title}
        </h1>
        <p className="orki-textpage__lead">{lead}</p>
        {updated && (
          <p className="orki-textpage__date">
            Última actualización:{' '}
            <time dateTime={updated.iso}>{updated.label}</time>
          </p>
        )}
      </div>
      <nav aria-labelledby="en-esta-pagina" className="orki-toc">
        <h2 id="en-esta-pagina" className="orki-toc__title">
          En esta página
        </h2>
        <ul className="orki-toc__list">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="orki-toc__link"
                onClick={() => {
                  // El salto lo hace el navegador (y escribe #id en la
                  // dirección); aquí solo se mueve el foco.
                  document
                    .getElementById(section.id)
                    ?.focus({ preventScroll: true })
                }}
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={section.id}
          className="orki-textpage__section"
        >
          <h2 id={section.id} tabIndex={-1} className="orki-textpage__heading">
            {section.title}
          </h2>
          <p className="orki-textpage__summary">{section.summary}</p>
          {section.children}
        </section>
      ))}
      {children}
    </div>
  )
}
