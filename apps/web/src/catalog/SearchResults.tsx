import { Link } from 'react-router'
import { ActionList } from '../components/ui/ActionRow.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { speciesMatchText } from '../lib/catalogSearch.ts'
import type { PublicSpeciesResult } from '../lib/publicCatalog.ts'
import { CatalogError } from './CatalogStates.tsx'
import { catalogSpeciesPath } from './paths.ts'
import { CATALOG_TEXT, SPECIES_TYPE_LABEL } from './texts.ts'
import type { CatalogData } from './useCatalogData.ts'

/**
 * Resultados del buscador del catálogo (#232): cada especie con su nombre
 * aceptado en cursiva, su género y, si coincidió por otro nombre, cuál
 * («Sinónimo: Laelia purpurata», «Nombre común: Orquídea luna»). Cada fila
 * abre la ficha. El número de resultados lo anuncia el campo (CatalogHome).
 */
export function SearchResults({
  query,
  search,
}: {
  query: string
  search: CatalogData<PublicSpeciesResult[]> & { retry: () => void }
}) {
  if (search.status === 'error') {
    return <CatalogError reason={search.reason} onRetry={search.retry} />
  }
  if (search.status !== 'success') return null
  if (search.data.length === 0) {
    return (
      <div className="flex flex-col gap-space-1">
        <p className="text-md font-semibold text-neutral-900">
          {CATALOG_TEXT.noResults(query)}
        </p>
        <p className="text-md text-neutral-700">{CATALOG_TEXT.noResultsHint}</p>
      </div>
    )
  }
  return (
    <section aria-labelledby="catalogo-resultados">
      <h2 id="catalogo-resultados" className="sr-only">
        {CATALOG_TEXT.resultsTitle}
      </h2>
      <ActionList>
        {search.data.map((result) => (
          <li key={result.id}>
            <SpeciesRow
              to={catalogSpeciesPath(result.id)}
              name={result.scientificName}
              details={[
                result.genusName,
                result.type === 'hybrid' ? SPECIES_TYPE_LABEL.hybrid : null,
                speciesMatchText(result) ?? null,
              ]}
            />
          </li>
        ))}
      </ActionList>
    </section>
  )
}

/**
 * Fila de una especie o un género en las listas del catálogo: la pieza
 * orki-action (como ActionRow) con el nombre en cursiva botánica y, debajo,
 * los datos que haya, separados por « · ».
 */
export function SpeciesRow({
  to,
  name,
  details,
}: {
  to: string
  name: string
  details: readonly (string | null)[]
}) {
  const text = details.filter((detail) => detail !== null).join(' · ')
  return (
    <Link to={to} className="orki-action">
      <span className="orki-action__text">
        <span className="orki-action__title scientific-name">
          <ScientificName name={name} />
        </span>
        {text !== '' && <span className="orki-action__desc">{text}</span>}
      </span>
      <Icon name="chevron-right" />
    </Link>
  )
}
