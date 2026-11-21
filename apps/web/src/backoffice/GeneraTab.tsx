import { useId } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import {
  CATALOG_PAGE_SIZE,
  type CatalogGenusRow,
  type NumberedPage,
} from '../lib/catalogAdmin.ts'
import { LoadError, Notice, Pagination, SearchField } from './parts.tsx'
import type { CatalogAdminSource } from './source.ts'
import { formatCount, genusCountText, pageText } from './texts.ts'
import {
  INITIAL_CATALOG_ADMIN_STATE,
  type CatalogAdminState,
  type GeneraViewState,
} from './url-state.ts'
import { useDebouncedValue, useRemoteData } from './useRemoteData.ts'

// Pestaña "Géneros": los géneros con sus abreviaturas, si son de acceso rápido
// y cuántas especies tienen, con búsqueda por nombre o abreviatura y páginas
// numeradas. El número de especies lleva a la pestaña de especies filtrada por
// ese género.

export interface GeneraTabProps {
  state: GeneraViewState
  onChange: (next: GeneraViewState, options?: { replace?: boolean }) => void
  /** Abre la pestaña de especies con el filtro de un género. */
  onShowSpecies: (genusId: string) => void
  source: CatalogAdminSource
  fullState: CatalogAdminState
  hrefFor?: (state: CatalogAdminState) => string
}

export function GeneraTab({
  state,
  onChange,
  onShowSpecies,
  source,
  fullState,
  hrefFor,
}: GeneraTabProps) {
  const captionId = useId()
  const settledQuery = useDebouncedValue(state.query)
  const typing = settledQuery !== state.query
  const query = settledQuery.trim()

  const key = JSON.stringify({
    q: query,
    rapido: state.quickAccessOnly,
    pagina: state.page,
  })
  const genera = useRemoteData<NumberedPage<CatalogGenusRow>>(key, (signal) =>
    source.listGenera({
      query,
      quickAccessOnly: state.quickAccessOnly,
      page: state.page,
      signal,
    }),
  )
  const loading = typing || genera.status === 'loading'
  const data = !typing && genera.status === 'success' ? genera.data : null
  const pageCount = data ? Math.ceil(data.total / CATALOG_PAGE_SIZE) : 0
  const filtered = state.query.trim() !== '' || state.quickAccessOnly

  const statusText = loading
    ? 'Cargando géneros…'
    : data === null
      ? ''
      : data.total === 0
        ? 'Ningún género coincide.'
        : `${genusCountText(data.total)}. ${pageText(data.page, pageCount)}.`

  const speciesHref = (genusId: string) =>
    hrefFor?.({
      ...fullState,
      tab: 'especies',
      species: {
        ...INITIAL_CATALOG_ADMIN_STATE.species,
        filters: { genusId },
      },
    })

  const th =
    'border-b-2 border-secondary px-space-3 py-space-2 text-left text-sm font-semibold whitespace-nowrap text-neutral-900'
  const td = 'border-b border-neutral-50 px-space-3 py-space-2 align-top'

  return (
    <div className="flex flex-col gap-space-4">
      <div className="flex flex-wrap items-end gap-space-4">
        <div className="min-w-[0] flex-1 basis-[280px]">
          <SearchField
            label="Buscar géneros"
            placeholder="Nombre o abreviatura"
            value={state.query}
            onValueChange={(value) =>
              onChange({ ...state, query: value, page: 1 }, { replace: true })
            }
          />
        </div>
        <Chip
          className="py-space-3"
          selected={state.quickAccessOnly}
          onClick={() =>
            onChange({
              ...state,
              quickAccessOnly: !state.quickAccessOnly,
              page: 1,
            })
          }
        >
          Solo de acceso rápido
        </Chip>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <p role="status" className="text-sm text-neutral-700">
          {statusText}
        </p>
        {filtered && (
          <Button
            icon="x"
            onClick={() => onChange(INITIAL_CATALOG_ADMIN_STATE.genera)}
          >
            Limpiar búsqueda y filtro
          </Button>
        )}
      </div>

      {genera.status === 'error' && !typing ? (
        <LoadError
          reason={genera.reason}
          message={genera.message}
          onRetry={genera.retry}
        />
      ) : data !== null && data.rows.length === 0 ? (
        <Notice
          action={
            filtered ? (
              <Button
                icon="x"
                onClick={() => onChange(INITIAL_CATALOG_ADMIN_STATE.genera)}
              >
                Limpiar búsqueda y filtro
              </Button>
            ) : undefined
          }
        >
          {filtered
            ? 'Ningún género coincide con la búsqueda.'
            : 'El catálogo no tiene géneros.'}
        </Notice>
      ) : (
        <div
          role="region"
          aria-labelledby={captionId}
          // La tabla se desplaza en horizontal dentro de este contenedor: es
          // enfocable para moverla con el teclado (regla scrollable-region-focusable).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          aria-busy={data === null}
          className="overflow-x-auto rounded-lg"
        >
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <caption id={captionId} className="sr-only">
              Géneros del catálogo, en orden alfabético
            </caption>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Género
                </th>
                <th scope="col" className={th}>
                  Abreviaturas
                </th>
                <th scope="col" className={th}>
                  Acceso rápido
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Especies
                </th>
              </tr>
            </thead>
            <tbody>
              {data === null
                ? Array.from({ length: 10 }, (_, index) => (
                    <tr key={index} aria-hidden="true">
                      {Array.from({ length: 4 }, (_, cell) => (
                        <td key={cell} className={`${td} h-[41px]`}>
                          <span className="block h-space-4 w-3/4 rounded-sm bg-neutral-50 motion-safe:animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                : data.rows.map((genus) => {
                    const href = speciesHref(genus.id)
                    const count = (
                      <>
                        {formatCount(genus.speciesCount)}{' '}
                        <span className="sr-only">
                          especies de {genus.name}
                        </span>
                      </>
                    )
                    return (
                      <tr key={genus.id}>
                        <th
                          scope="row"
                          className={`${td} text-left font-semibold text-neutral-900`}
                        >
                          {genus.name}
                        </th>
                        <td className={td}>
                          {genus.abbreviations.length > 0
                            ? genus.abbreviations.join(', ')
                            : '—'}
                        </td>
                        <td className={td}>
                          {genus.isQuickAccess ? (
                            <span className="inline-flex items-center gap-space-1">
                              <Icon name="check" className="size-[16px]" />
                              Sí
                            </span>
                          ) : (
                            'No'
                          )}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {genus.speciesCount === 0 ? (
                            '0'
                          ) : href ? (
                            <Link
                              to={href}
                              className="font-semibold text-secondary underline"
                            >
                              {count}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onShowSpecies(genus.id)}
                              className="cursor-pointer font-semibold text-secondary underline"
                            >
                              {count}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>
      )}

      {data !== null && data.total > CATALOG_PAGE_SIZE && (
        <Pagination
          label="Páginas de géneros"
          page={data.page}
          pageCount={pageCount}
          hasPrevious={data.page > 1}
          hasNext={data.page < pageCount}
          onFirst={() => onChange({ ...state, page: 1 })}
          onPrevious={() => onChange({ ...state, page: data.page - 1 })}
          onNext={() => onChange({ ...state, page: data.page + 1 })}
          onLast={() => onChange({ ...state, page: pageCount })}
        />
      )}
    </div>
  )
}
