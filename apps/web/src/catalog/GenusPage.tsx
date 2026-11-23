import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { Page } from '../components/Page.tsx'
import { ActionList } from '../components/ui/ActionRow.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { listPublicGenusSpecies } from '../lib/publicCatalog.ts'
import { CatalogAttribution } from './CatalogAttribution.tsx'
import {
  BackToCatalog,
  CatalogError,
  CatalogLoading,
  CatalogNotFound,
} from './CatalogStates.tsx'
import { genusLetter } from './letters.ts'
import { Pager } from './Pager.tsx'
import { catalogGenusPath, catalogSpeciesPath, readPage } from './paths.ts'
import { SpeciesRow } from './SearchResults.tsx'
import { CATALOG_TEXT, SPECIES_TYPE_LABEL, speciesCountText } from './texts.ts'
import { rememberCatalogData, useCatalogData } from './useCatalogData.ts'

function genusKey(genusId: string, page: number): string {
  return `genero:${genusId}:${page}`
}

// Especies de un género (/catalogo/genero/<id>, #232), de 50 en 50, con su
// total y la paginación (?pagina=). Una página mayor que la última muestra
// la última (la base devuelve la última y dice cuál) y la dirección se
// corrige sin añadir una entrada al historial. Al cambiar de página, el foco
// va al título de la lista, que dice en qué página se está.
export default function GenusPage() {
  const { genusId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const requestedPage = readPage(searchParams)
  const navigate = useNavigate()
  const data = useCatalogData(genusKey(genusId, requestedPage), (signal) =>
    listPublicGenusSpecies(genusId, requestedPage, { signal }),
  )
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const page = data.status === 'success' ? data.data : null

  // La página que de verdad se muestra, en la dirección.
  useEffect(() => {
    if (page !== null && page.page !== requestedPage) {
      rememberCatalogData(genusKey(genusId, page.page), page)
      void navigate(catalogGenusPath(genusId, page.page), { replace: true })
    }
  }, [page, requestedPage, genusId, navigate])

  // Al pasar de página (no al abrir), el foco al título de la lista.
  const lastShown = useRef<number | null>(null)
  useEffect(() => {
    if (page === null) return
    if (lastShown.current !== null && lastShown.current !== page.page) {
      listHeadingRef.current?.focus()
    }
    lastShown.current = page.page
  }, [page])

  // Mientras llega otra página, la cabecera sigue con el género.
  const [held, setHeld] = useState(page)
  if (page !== null && page !== held) setHeld(page)
  const header = page ?? (held?.genus.id === genusId ? held : null)

  if (data.status === 'success' && page === null) {
    return (
      <Page
        title={CATALOG_TEXT.genusNotFound}
        width="wide"
        header={{ art: false, back: <BackToCatalog /> }}
      >
        <CatalogNotFound text={CATALOG_TEXT.genusNotFoundText} />
      </Page>
    )
  }

  const genusName = header?.genus.name ?? null
  const reserve =
    page?.species.some((species) => species.reference !== null) ?? false
  return (
    <Page
      title={genusName ?? CATALOG_TEXT.title}
      heading={
        genusName === null ? undefined : (
          <span className="font-display font-normal italic">
            <ScientificName name={genusName} />
          </span>
        )
      }
      width="wide"
      header={{
        meta:
          header === null
            ? undefined
            : `${speciesCountText(header.total)} · ${CATALOG_TEXT.page(header.page, header.pageCount)}`,
        back: (
          <BackToCatalog
            letter={genusName === null ? null : genusLetter(genusName)}
          />
        ),
      }}
    >
      <div className="flex flex-col gap-space-4">
        {data.status === 'error' ? (
          <CatalogError reason={data.reason} onRetry={data.retry} />
        ) : page === null ? (
          <CatalogLoading>{CATALOG_TEXT.loadingGenus}</CatalogLoading>
        ) : (
          <section
            aria-labelledby="genero-especies"
            className="flex flex-col gap-space-4"
          >
            <h2
              id="genero-especies"
              ref={listHeadingRef}
              tabIndex={-1}
              className="font-display text-xl font-semibold text-secondary-strong"
            >
              {CATALOG_TEXT.genusSpeciesTitle}
              {page.pageCount > 1 && (
                <span className="sr-only">
                  {`, ${CATALOG_TEXT.page(page.page, page.pageCount).toLowerCase()}`}
                </span>
              )}
            </h2>
            <ActionList>
              {page.species.map((species) => (
                <li key={species.id}>
                  <SpeciesRow
                    to={catalogSpeciesPath(species.id)}
                    name={species.scientificName}
                    details={[
                      species.type === 'hybrid'
                        ? SPECIES_TYPE_LABEL.hybrid
                        : null,
                    ]}
                    reference={species.reference}
                    reserve={reserve}
                  />
                </li>
              ))}
            </ActionList>
            <Pager
              page={page.page}
              pageCount={page.pageCount}
              pathFor={(target) => catalogGenusPath(genusId, target)}
              label={`${CATALOG_TEXT.pagesLabel} de ${page.genus.name}`}
            />
          </section>
        )}
        <CatalogAttribution />
      </div>
    </Page>
  )
}
