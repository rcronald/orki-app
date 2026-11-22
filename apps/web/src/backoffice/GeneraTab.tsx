import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import {
  CATALOG_PAGE_SIZE,
  type CatalogGenusRow,
  type NumberedPage,
} from '../lib/catalogAdmin.ts'
import { cleanGenusName } from '../lib/catalogWrites.ts'
import { GenusPanel } from './GenusPanel.tsx'
import { InlineForm } from './InlineForm.tsx'
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
// ese género. "Añadir género" crea uno y "Editar" abre su panel (GenusPanel):
// nombre, acceso rápido, abreviaturas y baja (#107).

export interface GeneraTabProps {
  state: GeneraViewState
  onChange: (next: GeneraViewState, options?: { replace?: boolean }) => void
  /** Abre la pestaña de especies con el filtro de un género. */
  onShowSpecies: (genusId: string) => void
  source: CatalogAdminSource
  fullState: CatalogAdminState
  hrefFor?: (state: CatalogAdminState) => string
  /** Cambia tras cada escritura: la lista y el panel se vuelven a leer. */
  revision?: number
  /** Se guardó un cambio en el catálogo: la pantalla lo anuncia y relee. */
  onCatalogChanged?: (message: string) => void
}

export function GeneraTab({
  state,
  onChange,
  onShowSpecies,
  source,
  fullState,
  hrefFor,
  revision = 0,
  onCatalogChanged = () => {},
}: GeneraTabProps) {
  const captionId = useId()
  const baseId = useId()
  const [creating, setCreating] = useState(false)
  const [newQuickAccess, setNewQuickAccess] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  // Género abierto en el panel de edición, y a qué botón vuelve el foco.
  const [openId, setOpenId] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const returnFocusTo = useRef<string | null>(null)
  const editButtonId = (id: string) => `${baseId}-editar-${id}`
  useEffect(() => {
    if (openId !== null || returnFocusTo.current === null) return
    ;(
      document.getElementById(returnFocusTo.current) ?? addButtonRef.current
    )?.focus()
    returnFocusTo.current = null
  }, [openId])
  const open = (id: string) => {
    setCreating(false)
    setOpenId(id)
    setFocusRequest((value) => value + 1)
  }
  const settledQuery = useDebouncedValue(state.query)
  const typing = settledQuery !== state.query
  const query = settledQuery.trim()

  const key = JSON.stringify({
    q: query,
    rapido: state.quickAccessOnly,
    pagina: state.page,
  })
  const genera = useRemoteData<NumberedPage<CatalogGenusRow>>(
    key,
    (signal) =>
      source.listGenera({
        query,
        quickAccessOnly: state.quickAccessOnly,
        page: state.page,
        signal,
      }),
    { revision },
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
        <Button
          ref={addButtonRef}
          icon="plus"
          aria-expanded={creating}
          onClick={() => {
            setNewQuickAccess(false)
            setCreating(true)
          }}
        >
          Añadir género
        </Button>
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

      {creating && (
        <div className="max-w-[480px]">
          <InlineForm
            title="Añadir género"
            label="Nombre del género"
            requiredMessage="Escribe el nombre del género."
            hint="Una palabra; un nothogénero lleva «× » delante (× Rhyncholaeliocattleya)."
            submitLabel="Crear el género"
            normalize={cleanGenusName}
            onCancel={() => {
              setCreating(false)
              addButtonRef.current?.focus()
            }}
            onSubmit={async (name) => {
              const written = await source.createGenus({
                name,
                isQuickAccess: newQuickAccess,
              })
              setCreating(false)
              open(written.id)
              onCatalogChanged(
                `Se creó el género «${written.name}»${written.isQuickAccess ? ', de acceso rápido' : ''}.`,
              )
            }}
            extra={() => (
              <div className="flex items-start gap-space-2">
                <input
                  id={`${baseId}-nuevo-rapido`}
                  type="checkbox"
                  className="mt-[2px] size-[24px] flex-none cursor-pointer accent-secondary"
                  checked={newQuickAccess}
                  onChange={(event) => setNewQuickAccess(event.target.checked)}
                  aria-describedby={`${baseId}-nuevo-rapido-ayuda`}
                />
                <div className="flex flex-col">
                  <label
                    htmlFor={`${baseId}-nuevo-rapido`}
                    className="cursor-pointer text-md text-neutral-900"
                  >
                    Acceso rápido en el registro
                  </label>
                  <span
                    id={`${baseId}-nuevo-rapido-ayuda`}
                    className="orki-field__hint"
                  >
                    Saldrá como chip en el formulario de registro de todos los
                    usuarios.
                  </span>
                </div>
              </div>
            )}
          />
        </div>
      )}

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

      <div
        className={`grid gap-space-4 ${openId ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]' : ''}`}
      >
        <div className="flex min-w-[0] flex-col gap-space-4">
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
                    <th scope="col" className={th}>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data === null
                    ? Array.from({ length: 10 }, (_, index) => (
                        <tr key={index} aria-hidden="true">
                          {Array.from({ length: 5 }, (_, cell) => (
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
                          <tr
                            key={genus.id}
                            className={
                              genus.id === openId
                                ? 'bg-secondary-soft'
                                : undefined
                            }
                          >
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
                            <td className={td}>
                              <Button
                                id={editButtonId(genus.id)}
                                className="px-space-2 py-space-1"
                                aria-current={
                                  genus.id === openId ? 'true' : undefined
                                }
                                onClick={() => open(genus.id)}
                              >
                                Editar{' '}
                                <span className="sr-only">
                                  el género {genus.name}
                                </span>
                              </Button>
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
        {openId && (
          <GenusPanel
            genusId={openId}
            source={source}
            revision={revision}
            focusRequest={focusRequest}
            onClose={() => {
              returnFocusTo.current = editButtonId(openId)
              setOpenId(null)
            }}
            onChanged={onCatalogChanged}
            onDeleted={(message) => {
              returnFocusTo.current = editButtonId(openId)
              setOpenId(null)
              onCatalogChanged(message)
            }}
          />
        )}
      </div>
    </div>
  )
}
