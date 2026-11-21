import { useId, useRef, type KeyboardEvent } from 'react'
import { GeneraTab } from './GeneraTab.tsx'
import type { CatalogAdminSource } from './source.ts'
import { SpeciesTab } from './SpeciesTab.tsx'
import { Attribution, SummaryPanel } from './SummaryPanel.tsx'
import {
  INITIAL_CATALOG_ADMIN_STATE,
  type CatalogAdminState,
  type CatalogAdminTab,
} from './url-state.ts'
import { useRemoteData } from './useRemoteData.ts'

export interface CatalogAdminViewProps {
  state: CatalogAdminState
  /** Nuevo estado; replace si sustituye la entrada del historial (al escribir). */
  onStateChange: (
    next: CatalogAdminState,
    options?: { replace?: boolean },
  ) => void
  source: CatalogAdminSource
  /** Dirección de un estado, para los enlaces (ver SpeciesTab). */
  hrefFor?: (state: CatalogAdminState) => string
}

const TABS: readonly { id: CatalogAdminTab; label: string }[] = [
  { id: 'especies', label: 'Especies' },
  { id: 'generos', label: 'Géneros' },
]

/**
 * Pantalla del catálogo para administradores, sin la conexión a la URL:
 * resumen, pestañas de especies y géneros y atribución del Catalogue of Life.
 * Solo lectura. La usa CatalogAdminPage con la URL y Supabase, y la página de
 * muestra con estado propio y datos fijos.
 */
export function CatalogAdminView({
  state,
  onStateChange,
  source,
  hrefFor,
}: CatalogAdminViewProps) {
  const summary = useRemoteData('resumen', (signal) =>
    source.summary({ signal }),
  )
  const baseId = useId()
  const tabRefs = useRef(new Map<CatalogAdminTab, HTMLButtonElement>())

  const selectTab = (tab: CatalogAdminTab, focus = false) => {
    if (tab !== state.tab) onStateChange({ ...state, tab })
    if (focus) tabRefs.current.get(tab)?.focus()
  }

  // Pestañas del patrón de WAI-ARIA con activación automática: las flechas,
  // Inicio y Fin mueven el foco y cambian de pestaña.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((tab) => tab.id === state.tab)
    const last = TABS.length - 1
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (target === null) return
    event.preventDefault()
    const tab = TABS[target]
    if (tab) selectTab(tab.id, true)
  }

  const tabId = (tab: CatalogAdminTab) => `${baseId}-pestana-${tab}`
  const panelId = (tab: CatalogAdminTab) => `${baseId}-panel-${tab}`

  return (
    <div className="flex flex-col gap-space-5">
      <p className="max-w-prose text-md text-neutral-700">
        El catálogo de especies tal como lo ven la búsqueda y el registro. Solo
        lectura: la edición llegará más adelante.
      </p>
      <SummaryPanel summary={summary} />

      <div className="flex flex-col gap-space-4">
        <div
          role="tablist"
          aria-label="Contenido del catálogo"
          className="flex gap-space-2 border-b-2 border-neutral-50"
        >
          {TABS.map((tab) => {
            const selected = tab.id === state.tab
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  if (element) tabRefs.current.set(tab.id, element)
                  else tabRefs.current.delete(tab.id)
                }}
                type="button"
                role="tab"
                id={tabId(tab.id)}
                aria-selected={selected}
                aria-controls={panelId(tab.id)}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                onKeyDown={onTabKeyDown}
                className={`-mb-[2px] min-h-[48px] cursor-pointer rounded-t-md border-b-2 px-space-4 text-md ${
                  selected
                    ? 'border-primary font-semibold text-neutral-900'
                    : 'border-transparent text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <div
          role="tabpanel"
          id={panelId(state.tab)}
          aria-labelledby={tabId(state.tab)}
        >
          {state.tab === 'especies' ? (
            <SpeciesTab
              state={state.species}
              onChange={(species, options) =>
                onStateChange({ ...state, species }, options)
              }
              source={source}
              fullState={state}
              hrefFor={hrefFor}
            />
          ) : (
            <GeneraTab
              state={state.genera}
              onChange={(genera, options) =>
                onStateChange({ ...state, genera }, options)
              }
              onShowSpecies={(genusId) =>
                onStateChange({
                  ...state,
                  tab: 'especies',
                  species: {
                    ...INITIAL_CATALOG_ADMIN_STATE.species,
                    filters: { genusId },
                  },
                })
              }
              source={source}
              fullState={state}
              hrefFor={hrefFor}
            />
          )}
        </div>
      </div>

      <Attribution />
    </div>
  )
}
