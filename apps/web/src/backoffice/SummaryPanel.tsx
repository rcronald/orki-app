import { useId } from 'react'
import type { CatalogSummary } from '../lib/catalogAdmin.ts'
import { CATALOGUE_OF_LIFE_ATTRIBUTION } from './attribution.ts'
import { LoadError } from './parts.tsx'
import {
  formatCount,
  SOURCE_LABEL,
  SOURCE_OPTIONS,
  STATUS_OPTIONS,
  STATUS_PLURAL_LABEL,
} from './texts.ts'
import type { RemoteData } from './useRemoteData.ts'

// Resumen del catálogo (arriba de la pantalla) y atribución del Catalogue of
// Life (abajo).

const ITEM = 'flex flex-col rounded-lg bg-neutral-50 px-space-4 py-space-3'
const VALUE = 'font-display text-xl text-neutral-900'
const LABEL = 'text-sm text-neutral-700'

export function SummaryPanel({
  summary,
}: {
  summary: RemoteData<CatalogSummary> & { retry: () => void }
}) {
  const headingId = useId()
  const loading = summary.status === 'loading' || summary.status === 'idle'

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-space-3">
      <h2 id={headingId} className="text-lg font-semibold text-secondary">
        Resumen
      </h2>
      {summary.status === 'error' ? (
        <LoadError
          compact
          reason={summary.reason}
          message={summary.message}
          onRetry={summary.retry}
        />
      ) : (
        <div aria-busy={loading} className="flex flex-col gap-space-3">
          {loading && (
            <p role="status" className="sr-only">
              Cargando el resumen…
            </p>
          )}
          <SummaryList
            label="Totales"
            items={[
              [
                'Géneros',
                summary.status === 'success' ? summary.data.genusCount : null,
              ],
              [
                'Especies',
                summary.status === 'success' ? summary.data.speciesCount : null,
              ],
              [
                'Híbridos',
                summary.status === 'success' ? summary.data.hybridCount : null,
              ],
              [
                'Sinónimos',
                summary.status === 'success' ? summary.data.synonymCount : null,
              ],
              [
                'Nombres comunes',
                summary.status === 'success'
                  ? summary.data.commonNameCount
                  : null,
              ],
            ]}
          />
          <div className="grid gap-space-3 md:grid-cols-2">
            <SummaryList
              label="Especies e híbridos por estado"
              columns="sm:grid-cols-3"
              items={STATUS_OPTIONS.map((status) => [
                STATUS_PLURAL_LABEL[status],
                summary.status === 'success'
                  ? summary.data.byStatus[status]
                  : null,
              ])}
            />
            <SummaryList
              label="Especies e híbridos por fuente"
              columns="sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4"
              items={SOURCE_OPTIONS.map((source) => [
                SOURCE_LABEL[source],
                summary.status === 'success'
                  ? summary.data.bySource[source]
                  : null,
              ])}
            />
          </div>
        </div>
      )}
    </section>
  )
}

// Una lista de recuentos (dl) con su título. Mientras carga, cada número es un
// marcador de su misma altura, así la pantalla no salta al llegar los datos.
function SummaryList({
  label,
  items,
  columns = 'sm:grid-cols-3 lg:grid-cols-5',
}: {
  label: string
  /** Columnas a partir de 640 px (las listas de media anchura llevan menos). */
  columns?: string
  items: readonly (readonly [string, number | null])[]
}) {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-space-2">
      <h3 id={labelId} className="text-sm font-semibold text-neutral-900">
        {label}
      </h3>
      <dl
        aria-labelledby={labelId}
        className={`grid grid-cols-2 gap-space-2 ${columns}`}
      >
        {items.map(([name, value]) => (
          <div key={name} className={ITEM}>
            <dt className={LABEL}>{name}</dt>
            <dd className={VALUE}>
              {value === null ? (
                <span
                  aria-hidden="true"
                  className="inline-block h-[28px] w-1/2 rounded-sm bg-neutral-0 motion-safe:animate-pulse"
                />
              ) : (
                formatCount(value)
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Cita del Catalogue of Life con su versión, su DOI y su licencia (CC BY 4.0). */
export function Attribution() {
  const { version, doiUrl, license, licenseUrl } = CATALOGUE_OF_LIFE_ATTRIBUTION
  const link = 'font-semibold text-secondary underline [overflow-wrap:anywhere]'
  return (
    <footer className="rounded-lg bg-neutral-50 p-space-4 text-sm text-neutral-900">
      <p>
        Catálogo de especies derivado del{' '}
        <span lang="en">Catalogue of Life</span> ({version}),{' '}
        <a className={link} href={doiUrl}>
          {doiUrl}
        </a>
        , con licencia{' '}
        <a className={link} href={licenseUrl} rel="license">
          {license}
        </a>
        ; filtrado a la familia Orchidaceae y normalizado por orqui.apps.
      </p>
    </footer>
  )
}
