import { useEffect, useRef, useState, type Dispatch, type Ref } from 'react'
import {
  Autocomplete,
  type AutocompleteOption,
} from '../components/ui/Autocomplete.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import {
  genusMatchText,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  type CatalogSearchFunction,
  type GenusSearchResult,
} from '../lib/catalogSearch.ts'
import { useCatalogSearch } from '../lib/useCatalogSearch.ts'
import {
  ChoiceField,
  FORM_CHIP_CLASSES,
  LOCKED_CHIP_CLASSES,
} from './ChoiceField.tsx'
import type {
  FormGenus,
  PlantFormAction,
  PlantFormValues,
} from './form-state.ts'
import { PLANT_FORM_TEXT } from './texts.ts'

/** Géneros de acceso rápido: cargando, listos o con el motivo del fallo. */
export type QuickGeneraState =
  | { status: 'loading' }
  | { status: 'ready'; genera: readonly FormGenus[] }
  | { status: 'error'; reason: 'offline' | 'failed' }

interface GenusFieldProps {
  values: PlantFormValues
  dispatch: Dispatch<PlantFormAction>
  quickGenera: QuickGeneraState
  onRetryQuickGenera: () => void
  searchGenera: CatalogSearchFunction<GenusSearchResult>
  error?: string
  containerRef?: Ref<HTMLDivElement>
}

/**
 * Género: chips de acceso rápido del catálogo y "Otro", que abre el buscador
 * de géneros (search_genera, también por abreviatura). Si el género elegido no
 * es de acceso rápido (lo eligió en "Otro" o lo trajo la especie), aparece
 * como un chip más, ya elegido. Siempre queda un género real del catálogo.
 */
export function GenusField({
  values,
  dispatch,
  quickGenera,
  onRetryQuickGenera,
  searchGenera,
  error,
  containerRef,
}: GenusFieldProps) {
  const locked = values.species !== null
  const { genus, otherGenusOpen } = values
  const quick = quickGenera.status === 'ready' ? quickGenera.genera : []
  const chips =
    genus && !quick.some((item) => item.id === genus.id)
      ? [...quick, genus]
      : quick

  // Al elegir un género en el buscador, este se cierra y el foco pasa al chip
  // del género elegido, que ya existe en el siguiente pintado. Abrir "Otro"
  // lo reinicia, así elegir otra vez el mismo género también mueve el foco.
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())
  const [focusGenusId, setFocusGenusId] = useState<string | null>(null)
  useEffect(() => {
    if (focusGenusId === null) return
    chipRefs.current.get(focusGenusId)?.focus()
  }, [focusGenusId])

  const [query, setQuery] = useState('')
  const search = useCatalogSearch(searchGenera, query, {
    enabled: otherGenusOpen,
  })
  const options: AutocompleteOption[] = search.results.map((result) => ({
    id: result.id,
    label: result.name,
    secondary: genusMatchText(result),
  }))

  const toggleOther = () => {
    if (locked) return
    setQuery('')
    setFocusGenusId(null)
    dispatch({ type: 'otherGenusToggled' })
  }

  const after = (
    <>
      {quickGenera.status === 'loading' && (
        <p role="status" className="text-sm text-neutral-700">
          {PLANT_FORM_TEXT.quickGeneraLoading}
        </p>
      )}
      {quickGenera.status === 'error' && (
        <div className="flex flex-wrap items-center gap-space-2">
          <p className="text-sm text-neutral-900">
            {quickGenera.reason === 'offline'
              ? PLANT_FORM_TEXT.quickGeneraOffline
              : PLANT_FORM_TEXT.quickGeneraError}
          </p>
          <Button onClick={onRetryQuickGenera}>
            {PLANT_FORM_TEXT.quickGeneraRetry}
          </Button>
        </div>
      )}
      {otherGenusOpen && (
        <Autocomplete
          label={PLANT_FORM_TEXT.otherGenusSearchLabel}
          hint={PLANT_FORM_TEXT.otherGenusHint}
          value={query}
          onValueChange={setQuery}
          options={options}
          loading={search.status === 'loading'}
          error={search.error?.message}
          minQueryLength={SEARCH_QUERY_MIN_LENGTH}
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          emptyText="Ningún género del catálogo coincide."
          spellCheck={false}
          autoCorrect="off"
          onOptionSelect={(option) => {
            const result = search.results.find((item) => item.id === option.id)
            if (!result) return
            dispatch({
              type: 'genusSelected',
              genus: { id: result.id, name: result.name },
            })
            setQuery('')
            setFocusGenusId(result.id)
          }}
        />
      )}
    </>
  )

  return (
    <ChoiceField
      label={PLANT_FORM_TEXT.genusLabel}
      lockedHint={locked ? PLANT_FORM_TEXT.lockedHint : undefined}
      error={error}
      containerRef={containerRef}
      after={after}
    >
      {(describedBy) => (
        <>
          {chips.map((item) => {
            const selected = !otherGenusOpen && genus?.id === item.id
            return (
              <Chip
                key={item.id}
                ref={(element) => {
                  if (element) chipRefs.current.set(item.id, element)
                  else chipRefs.current.delete(item.id)
                }}
                className={[
                  FORM_CHIP_CLASSES,
                  locked && !selected ? LOCKED_CHIP_CLASSES : '',
                ].join(' ')}
                selected={selected}
                aria-disabled={locked || undefined}
                aria-describedby={describedBy}
                onClick={() => {
                  if (locked) return
                  dispatch({
                    type: 'genusSelected',
                    genus: { id: item.id, name: item.name },
                  })
                }}
              >
                {item.name}
              </Chip>
            )
          })}
          <Chip
            className={[
              FORM_CHIP_CLASSES,
              locked ? LOCKED_CHIP_CLASSES : '',
            ].join(' ')}
            selected={otherGenusOpen}
            aria-disabled={locked || undefined}
            aria-describedby={describedBy}
            onClick={toggleOther}
          >
            {PLANT_FORM_TEXT.otherGenus}
          </Chip>
        </>
      )}
    </ChoiceField>
  )
}
