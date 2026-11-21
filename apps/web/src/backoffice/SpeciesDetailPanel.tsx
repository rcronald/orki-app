import { useEffect, useId, useRef } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import type {
  CatalogSpeciesDetail,
  CatalogSpeciesName,
} from '../lib/catalogAdmin.ts'
import { catalogueOfLifeTaxonUrl } from './attribution.ts'
import { LoadError, SpeciesStatusBadge } from './parts.tsx'
import {
  formatDateTime,
  plantCountText,
  SOURCE_LABEL,
  TYPE_LABEL,
} from './texts.ts'
import type { RemoteData } from './useRemoteData.ts'

export interface SpeciesDetailData {
  /** null si la especie ya no existe. */
  species: CatalogSpeciesDetail | null
  plantCount: number
}

export interface SpeciesDetailPanelProps {
  detail: RemoteData<SpeciesDetailData> & { retry: () => void }
  onClose: () => void
  /** Cambia cada vez que la persona abre un detalle: el foco va al título. */
  focusRequest: number
}

// Detalle de una especie, en un panel junto a la tabla (debajo en pantallas
// estrechas): nombres alternativos, referencia de la fuente con enlace a la
// ficha del Catalogue of Life, fechas y número de plantas enlazadas. Solo
// lectura.
export function SpeciesDetailPanel({
  detail,
  onClose,
  focusRequest,
}: SpeciesDetailPanelProps) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const ready = detail.status !== 'loading'

  useEffect(() => {
    if (focusRequest > 0 && ready) headingRef.current?.focus()
  }, [focusRequest, ready])

  const species = detail.status === 'success' ? detail.data.species : null

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={!ready}
      className="flex flex-col gap-space-3 self-start rounded-lg bg-neutral-50 p-space-4"
    >
      <div className="flex items-start justify-between gap-space-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="min-w-[0] text-lg font-semibold text-secondary [overflow-wrap:anywhere]"
        >
          {species ? (
            <>
              <span className="sr-only">Detalle de</span>{' '}
              <span className="scientific-name text-neutral-900">
                <ScientificName name={species.scientificName} />
              </span>
            </>
          ) : (
            'Detalle de la especie'
          )}
        </h2>
        <Button icon="x" onClick={onClose} className="flex-none">
          Cerrar
        </Button>
      </div>

      {detail.status === 'loading' || detail.status === 'idle' ? (
        <>
          <p role="status" className="sr-only">
            Cargando el detalle…
          </p>
          <div aria-hidden="true" className="flex flex-col gap-space-2">
            {['w-3/4', 'w-1/2', 'w-full', 'w-1/2'].map((width, index) => (
              <div
                key={index}
                className={`h-space-4 rounded-sm bg-neutral-0 motion-safe:animate-pulse ${width}`}
              />
            ))}
          </div>
        </>
      ) : detail.status === 'error' ? (
        <LoadError
          compact
          reason={detail.reason}
          message={detail.message}
          onRetry={detail.retry}
        />
      ) : species === null ? (
        <p className="text-md text-neutral-900">
          Esta especie ya no está en el catálogo.
        </p>
      ) : (
        <DetailBody species={species} plantCount={detail.data.plantCount} />
      )}
    </section>
  )
}

const TERM = 'text-sm font-semibold text-neutral-700'
const VALUE = 'text-md text-neutral-900 [overflow-wrap:anywhere]'

function DetailBody({
  species,
  plantCount,
}: {
  species: CatalogSpeciesDetail
  plantCount: number
}) {
  const synonyms = species.names.filter((name) => name.type === 'synonym')
  const commonNames = species.names.filter((name) => name.type === 'common')

  return (
    <>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-space-3 gap-y-space-2">
        <dt className={TERM}>Género</dt>
        <dd className={VALUE}>{species.genusName}</dd>
        <dt className={TERM}>Tipo</dt>
        <dd className={VALUE}>{TYPE_LABEL[species.type]}</dd>
        <dt className={TERM}>Estado</dt>
        <dd className={VALUE}>
          <SpeciesStatusBadge status={species.status} />
        </dd>
        <dt className={TERM}>Fuente</dt>
        <dd className={VALUE}>{SOURCE_LABEL[species.source]}</dd>
        <dt className={TERM}>Referencia</dt>
        <dd className={VALUE}>
          {species.sourceRef === null ? (
            'Sin referencia'
          ) : species.source === 'col' ? (
            <a
              className="font-semibold text-secondary underline"
              href={catalogueOfLifeTaxonUrl(species.sourceRef)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {species.sourceRef}{' '}
              <span className="font-normal">
                · Ver la ficha en el <span lang="en">Catalogue of Life</span>
              </span>{' '}
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          ) : (
            species.sourceRef
          )}
        </dd>
        <dt className={TERM}>Alta</dt>
        <dd className={VALUE}>{formatDateTime(species.createdAt)}</dd>
        <dt className={TERM}>Última modificación</dt>
        <dd className={VALUE}>{formatDateTime(species.updatedAt)}</dd>
        <dt className={TERM}>Plantas</dt>
        <dd className={VALUE}>{plantCountText(plantCount)}</dd>
      </dl>
      <NameList
        title={`Sinónimos (${synonyms.length})`}
        names={synonyms}
        empty="No tiene sinónimos."
        scientific
      />
      <NameList
        title={`Nombres comunes (${commonNames.length})`}
        names={commonNames}
        empty="No tiene nombres comunes."
      />
    </>
  )
}

function NameList({
  title,
  names,
  empty,
  scientific = false,
}: {
  title: string
  names: readonly CatalogSpeciesName[]
  empty: string
  scientific?: boolean
}) {
  const headingId = useId()
  return (
    <div className="flex flex-col gap-space-1">
      <h3 id={headingId} className="text-sm font-semibold text-neutral-900">
        {title}
      </h3>
      {names.length === 0 ? (
        <p className="text-sm text-neutral-700">{empty}</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-space-1">
          {names.map((name) => (
            <li key={name.id} className="[overflow-wrap:anywhere]">
              {scientific ? (
                <span className="scientific-name text-md">
                  <ScientificName name={name.name} />
                </span>
              ) : (
                <span className="text-md text-neutral-900">{name.name}</span>
              )}
              {name.language && (
                <span className="text-sm text-neutral-700">
                  {' '}
                  ({name.language})
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
