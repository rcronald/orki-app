import { Link } from 'react-router'
import { Icon } from '../components/ui/Icon.tsx'
import { CATALOG_TEXT } from './texts.ts'

interface PagerProps {
  page: number
  pageCount: number
  /** Dirección de una página. */
  pathFor: (page: number) => string
  /** Para el nombre de la navegación: «Páginas de Cattleya». */
  label?: string
}

/**
 * Paginación (orki-pager, #232): «Anterior», «Página 2 de 5» y «Siguiente»,
 * enlaces con su dirección (?pagina=), así se pueden abrir en otra pestaña y
 * compartir. En la primera y la última página falta el enlace que no lleva a
 * ningún sitio. Con una sola página no se pinta.
 */
export function Pager({ page, pageCount, pathFor, label }: PagerProps) {
  if (pageCount <= 1) return null
  return (
    <nav aria-label={label ?? CATALOG_TEXT.pagesLabel} className="orki-pager">
      {page > 1 ? (
        <Link
          to={pathFor(page - 1)}
          className="orki-btn orki-btn--secondary orki-pager__prev"
        >
          <Icon name="arrow-left" />
          {CATALOG_TEXT.previous}
        </Link>
      ) : null}
      <p className="orki-pager__status">{CATALOG_TEXT.page(page, pageCount)}</p>
      {page < pageCount ? (
        <Link
          to={pathFor(page + 1)}
          className="orki-btn orki-btn--secondary orki-pager__next"
        >
          {CATALOG_TEXT.next}
          <Icon name="arrow-right" />
        </Link>
      ) : null}
    </nav>
  )
}
