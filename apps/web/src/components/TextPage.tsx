import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useFocusOnNavigation, usePageTitle } from '../routes/navigation.ts'
import { textPageBack } from '../routes/text-page-origin.ts'
import { Icon } from './ui/Icon.tsx'

// Página de texto del design system (orki-textpage, #199): privacidad y
// créditos. Enlace para volver (con arrow-left), título en text-hero, frase de
// apoyo, fecha de la última actualización, caja «En esta página»
// (orki-toc) con un enlace a cada sección y las secciones en una columna de
// lectura, cada una con una frase de resumen al principio.
//
// El enlace de volver depende de dónde se vino (#202): «Volver al inicio»,
// «Volver al registro» o «Volver a Mi colección», según el estado de
// navegación del enlace que trajo aquí (routes/text-page-origin.ts); abierta
// la dirección directamente, «Volver al inicio».
//
// Índice: cada enlace apunta al id del título de su sección (un id estable),
// así la dirección con #id se puede compartir. Al activarlo, el foco pasa a
// su título (tabIndex -1), que el navegador lleva a la vista sin animación
// (nada de desplazamiento suave, que además tendría que respetar
// prefers-reduced-motion): el lector de pantalla lo lee y el tabulador sigue
// desde ahí. El #id se escribe en la dirección sustituyendo la entrada del
// historial y conservando su estado, para no perder el enlace de volver. El
// título lleva scroll-margin-top para no quedar pegado al borde ni bajo una
// barra fija.

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
  sections: readonly TextPageSection[]
  /** Lo que va después de las secciones. */
  children?: ReactNode
}

export function TextPage({
  title,
  lead,
  updated,
  sections,
  children,
}: TextPageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  usePageTitle(title)
  useFocusOnNavigation(headingRef)
  const location = useLocation()
  const navigate = useNavigate()
  const state: unknown = location.state
  const back = textPageBack(state)
  const { hash } = location

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
        {/* 44 px de alto (#174) en el mismo sitio: el margen negativo
            descuenta lo que crece sobre la línea de 24 px. */}
        <Link to={back.to} className="orki-link -my-[10px] min-h-[44px]">
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
                onClick={(event) => {
                  const heading = document.getElementById(section.id)
                  if (heading === null) return
                  event.preventDefault()
                  heading.focus()
                  void navigate(
                    { hash: `#${section.id}` },
                    { replace: true, state },
                  )
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
