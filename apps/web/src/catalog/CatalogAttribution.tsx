import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { CATALOGUE_OF_LIFE_ATTRIBUTION } from '../backoffice/attribution.ts'
import { PATHS } from '../routes/paths.ts'
import { textPageState } from '../routes/text-page-origin.ts'
import { CATALOG_TEXT } from './texts.ts'

const LINK = 'text-secondary-strong underline underline-offset-[3px]'

/** Enlace a otro sitio, en otra pestaña y avisándolo al lector de pantalla. */
export function ExternalLink({
  href,
  children,
  className = LINK,
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      className={className}
    >
      {children}
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  )
}

/**
 * Atribución del catálogo al pie de sus pantallas (#232): la del Catalogue of
 * Life que pide CC BY 4.0 (versión, DOI y licencia, de
 * backoffice/attribution.ts, como el backoffice y «Créditos y fuentes»), la
 * lista curada de híbridos y el enlace a «Créditos y fuentes».
 */
export function CatalogAttribution() {
  const { version, doiUrl, license, licenseUrl } = CATALOGUE_OF_LIFE_ATTRIBUTION
  return (
    <footer className="mt-space-4 flex flex-col gap-space-2 border-t border-neutral-200 pt-space-4 text-sm text-neutral-700">
      <p>
        Las especies salen del <span lang="en">Catalogue of Life</span> (
        {version}), <ExternalLink href={doiUrl}>{doiUrl}</ExternalLink>, con
        licencia <ExternalLink href={licenseUrl}>{license}</ExternalLink>,
        filtradas a las orquídeas y normalizadas. Los híbridos de vivero salen
        de una lista curada por orqui.app.
      </p>
      <p>
        <Link
          to={PATHS.credits}
          state={textPageState('catalogo')}
          className={`${LINK} inline-flex min-h-[44px] items-center`}
        >
          {CATALOG_TEXT.credits}
        </Link>
      </p>
    </footer>
  )
}
