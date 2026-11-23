import { useCallback, useId, useState } from 'react'
import {
  NavigationType,
  useLocation,
  useNavigationType,
  useSearchParams,
} from 'react-router'
import { Page } from '../components/Page.tsx'
import { SearchField } from '../components/ui/SearchField.tsx'
import { prepareSearchQuery } from '../lib/catalogSearch.ts'
import {
  PUBLIC_SEARCH_MAX_RESULTS,
  searchPublicSpecies,
  type PublicSpeciesResult,
} from '../lib/publicCatalog.ts'
import { SEARCH_DEBOUNCE_MS } from '../lib/useCatalogSearch.ts'
import { CatalogAttribution } from './CatalogAttribution.tsx'
import { GenusIndex } from './GenusIndex.tsx'
import { CATALOG_PARAMS } from './paths.ts'
import { SearchResults } from './SearchResults.tsx'
import { CATALOG_TEXT } from './texts.ts'
import { useCatalogData, type CatalogData } from './useCatalogData.ts'

// Portada del catálogo público (/catalogo, #232): el buscador y, sin
// búsqueda, los géneros por letra.
//
// - Lo buscado va en la dirección (?q=), sustituyendo la entrada del
//   historial: recargar, volver con «atrás» desde una ficha o compartir el
//   enlace conservan la búsqueda. Como en «Mi colección», el campo tiene su
//   propio estado (la dirección llega atrasada y, si el campo leyera de ella,
//   al escribir deprisa se perderían letras); la dirección solo manda al
//   abrir y cuando cambia por otra navegación (PUSH o POP).
// - Busca con 250 ms de espera entre pulsaciones, desde 2 caracteres, con
//   search_public_species (nombre científico, sinónimo o nombre común, con
//   la tolerancia del registro).
export default function CatalogHome() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get(CATALOG_PARAMS.query) ?? ''
  const [query, setQueryText] = useState(urlQuery)
  const navigationType = useNavigationType()
  const location = useLocation()
  const [seenLocation, setSeenLocation] = useState(location.key)
  if (seenLocation !== location.key) {
    setSeenLocation(location.key)
    if (navigationType !== NavigationType.Replace) setQueryText(urlQuery)
  }

  const setQuery = useCallback(
    (value: string) => {
      setQueryText(value)
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === '') next.delete(CATALOG_PARAMS.query)
          else next.set(CATALOG_PARAMS.query, value)
          return next
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [setSearchParams],
  )

  const prepared = prepareSearchQuery(query)
  const search = useCatalogData(
    prepared === null ? null : `busqueda:${prepared}`,
    (signal) => searchPublicSpecies(prepared ?? '', { signal }),
    { debounceMs: SEARCH_DEBOUNCE_MS },
  )
  const statusId = useId()
  const tooShort = prepared === null && query.trim() !== ''

  return (
    <Page
      title={CATALOG_TEXT.title}
      width="wide"
      header={{ meta: CATALOG_TEXT.lead }}
    >
      <div className="flex flex-col gap-space-5">
        <div role="search" className="flex flex-col gap-space-2">
          <SearchField
            label={CATALOG_TEXT.searchLabel}
            placeholder={CATALOG_TEXT.searchPlaceholder}
            value={query}
            onValueChange={setQuery}
            aria-describedby={statusId}
            maxLength={100}
          />
          <p id={statusId} role="status" className="text-sm text-neutral-700">
            {tooShort
              ? CATALOG_TEXT.searchHint
              : prepared === null
                ? null
                : searchSummary(search, prepared)}
          </p>
        </div>
        {prepared === null ? (
          <GenusIndex letter={searchParams.get(CATALOG_PARAMS.letter)} />
        ) : (
          <SearchResults query={prepared} search={search} />
        )}
        <CatalogAttribution />
      </div>
    </Page>
  )
}

/** Lo que dice la región del buscador: buscando, cuántas o ninguna. */
function searchSummary(
  search: CatalogData<PublicSpeciesResult[]>,
  query: string,
): string | null {
  switch (search.status) {
    case 'idle':
    case 'error':
      return null
    case 'loading':
      return CATALOG_TEXT.searching
    case 'success': {
      const count = search.data.length
      if (count === 0) return CATALOG_TEXT.noResults(query)
      return count >= PUBLIC_SEARCH_MAX_RESULTS
        ? `${CATALOG_TEXT.results(count)} ${CATALOG_TEXT.moreResults(count)}`
        : CATALOG_TEXT.results(count)
    }
  }
}
