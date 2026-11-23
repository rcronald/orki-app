import { Link, useParams } from 'react-router'
import {
  CATALOGUE_OF_LIFE_ATTRIBUTION,
  catalogueOfLifeTaxonUrl,
} from '../backoffice/attribution.ts'
import { Page } from '../components/Page.tsx'
import { Panel } from '../components/ui/Panel.tsx'
import { ReferencePhoto } from '../components/ui/ReferencePhoto.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { getPublicSpecies, type PublicSpecies } from '../lib/publicCatalog.ts'
import { CatalogAttribution, ExternalLink } from './CatalogAttribution.tsx'
import {
  BackToCatalog,
  CatalogError,
  CatalogLoading,
  CatalogNotFound,
} from './CatalogStates.tsx'
import { genusLetter } from './letters.ts'
import { catalogGenusPath } from './paths.ts'
import { SpeciesOwnership } from './SpeciesOwnership.tsx'
import {
  CATALOG_TEXT,
  languageName,
  SPECIES_SOURCE_LABEL,
  SPECIES_TYPE_LABEL,
} from './texts.ts'
import { useCatalogData } from './useCatalogData.ts'

// Ficha de una especie (/catalogo/especie/<id>, #232): el nombre aceptado en
// cursiva, el género (enlace a su página), el tipo, los sinónimos, los nombres
// comunes con su idioma y la fuente con su atribución. Con sesión, si la
// persona la tiene y «Registrar esta especie» (SpeciesOwnership). Un id que no
// existe o no es público: «Especie no encontrada», con la vuelta al catálogo.
// Si la especie tiene foto de referencia (#234), arriba, con su crédito; sin
// ella (o si no carga), la ficha empieza por lo demás, sin hueco.
export default function SpeciesPage() {
  const { speciesId = '' } = useParams()
  const data = useCatalogData(`especie:${speciesId}`, (signal) =>
    getPublicSpecies(speciesId, { signal }),
  )

  if (data.status === 'success' && data.data === null) {
    return (
      <Page
        title={CATALOG_TEXT.speciesNotFound}
        width="medium"
        header={{ art: false, back: <BackToCatalog /> }}
      >
        <CatalogNotFound text={CATALOG_TEXT.speciesNotFoundText} />
      </Page>
    )
  }

  const species = data.status === 'success' ? data.data : null
  return (
    <Page
      title={species?.scientificName ?? CATALOG_TEXT.title}
      heading={
        species === null ? undefined : (
          <span className="font-display font-normal italic">
            <ScientificName name={species.scientificName} />
          </span>
        )
      }
      width="medium"
      header={{
        meta:
          species === null
            ? undefined
            : `${SPECIES_TYPE_LABEL[species.type]} del género ${species.genus.name}`,
        back: (
          <BackToCatalog
            letter={species === null ? null : genusLetter(species.genus.name)}
          />
        ),
      }}
    >
      <div className="flex flex-col gap-space-5">
        {data.status === 'error' ? (
          <CatalogError reason={data.reason} onRetry={data.retry} />
        ) : species === null ? (
          <CatalogLoading>{CATALOG_TEXT.loadingSpecies}</CatalogLoading>
        ) : (
          <SpeciesDetail species={species} />
        )}
        <CatalogAttribution />
      </div>
    </Page>
  )
}

function SpeciesDetail({ species }: { species: PublicSpecies }) {
  return (
    <>
      {species.reference && (
        <ReferencePhoto
          key={species.reference.sourcePhotoId}
          picture={species.reference}
          scientificName={species.scientificName}
        />
      )}
      <SpeciesOwnership species={species} />
      <Panel title={CATALOG_TEXT.classification}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-space-4 gap-y-space-2 text-md">
          <dt className="text-neutral-700">{CATALOG_TEXT.genus}</dt>
          <dd>
            <Link
              to={catalogGenusPath(species.genus.id)}
              className="orki-link scientific-name"
            >
              <ScientificName name={species.genus.name} />
            </Link>
          </dd>
          <dt className="text-neutral-700">{CATALOG_TEXT.type}</dt>
          <dd>{SPECIES_TYPE_LABEL[species.type]}</dd>
        </dl>
      </Panel>
      <Panel title={CATALOG_TEXT.synonyms}>
        {species.synonyms.length === 0 ? (
          <p className="orki-panel__text text-neutral-700">
            {CATALOG_TEXT.noSynonyms}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-space-1">
              {species.synonyms.map((synonym) => (
                <li key={synonym} className="scientific-name text-md">
                  <ScientificName name={synonym} />
                </li>
              ))}
            </ul>
            {species.synonymCount > species.synonyms.length && (
              <p className="orki-panel__text text-sm text-neutral-700">
                {CATALOG_TEXT.synonymsShown(
                  species.synonyms.length,
                  species.synonymCount,
                )}
              </p>
            )}
          </>
        )}
      </Panel>
      <Panel title={CATALOG_TEXT.commonNames}>
        {species.commonNames.length === 0 ? (
          <p className="orki-panel__text text-neutral-700">
            {CATALOG_TEXT.noCommonNames}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-space-1 text-md">
              {species.commonNames.map((name) => (
                <li key={`${name.name}|${name.language ?? ''}`}>
                  <span lang={name.language ?? undefined}>{name.name}</span>
                  {name.language && (
                    <span className="text-neutral-700">
                      {' '}
                      ({languageName(name.language)})
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {species.commonNameCount > species.commonNames.length && (
              <p className="orki-panel__text text-sm text-neutral-700">
                {CATALOG_TEXT.commonNamesShown(
                  species.commonNames.length,
                  species.commonNameCount,
                )}
              </p>
            )}
          </>
        )}
      </Panel>
      <Panel title={CATALOG_TEXT.source}>
        <SpeciesSource species={species} />
      </Panel>
    </>
  )
}

function SpeciesSource({ species }: { species: PublicSpecies }) {
  const label = SPECIES_SOURCE_LABEL[species.source]
  switch (species.source) {
    case 'col':
      return (
        <>
          <p className="orki-panel__text">
            <span lang="en">{label}</span> (
            {CATALOGUE_OF_LIFE_ATTRIBUTION.version}), con licencia{' '}
            {CATALOGUE_OF_LIFE_ATTRIBUTION.license}.
          </p>
          {species.sourceRef !== null && (
            <ExternalLink
              href={catalogueOfLifeTaxonUrl(species.sourceRef)}
              className="orki-link self-start"
            >
              {CATALOG_TEXT.viewInCol}
            </ExternalLink>
          )}
        </>
      )
    case 'curated':
      return (
        <>
          <p className="orki-panel__text font-semibold">{label}</p>
          <p className="orki-panel__text">{CATALOG_TEXT.curatedSource}</p>
        </>
      )
    case 'user_proposal':
      return <p className="orki-panel__text">{CATALOG_TEXT.proposalSource}</p>
    case 'gbif':
      return <p className="orki-panel__text">{label}</p>
  }
}
