import { useId, useState, type Dispatch, type Ref } from 'react'
import {
  Autocomplete,
  type AutocompleteOption,
} from '../components/ui/Autocomplete.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import {
  SEARCH_QUERY_MIN_LENGTH,
  speciesMatchText,
  type CatalogSearchFunction,
  type SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { useCatalogSearch } from '../lib/useCatalogSearch.ts'
import {
  isPendingName,
  normalizePlantName,
  PLANT_NAME_MAX_LENGTH,
  type PlantFormAction,
  type PlantFormValues,
} from './form-state.ts'
import { PLANT_FORM_TEXT } from './texts.ts'

interface NameFieldProps {
  values: PlantFormValues
  dispatch: Dispatch<PlantFormAction>
  searchSpecies: CatalogSearchFunction<SpeciesSearchResult>
  error?: string
  inputRef: Ref<HTMLInputElement>
}

const renderScientificName = (option: AutocompleteOption) => (
  <ScientificName name={option.label} />
)

/**
 * Nombre con autocompletado contra el catálogo (search_species). Elegir una
 * especie la enlaza; escribir algo que no está deja el nombre libre, "por
 * validar", y la acción final de la lista lo confirma.
 */
export function NameField({
  values,
  dispatch,
  searchSpecies,
  error,
  inputRef,
}: NameFieldProps) {
  const errorId = useId()
  const linked = values.species !== null
  // Con una especie elegida no se busca: el texto es su nombre científico.
  const search = useCatalogSearch(searchSpecies, values.name, {
    enabled: !linked,
  })

  const options: AutocompleteOption[] = search.results.map((result) => ({
    id: result.id,
    label: result.scientificName,
    secondary: speciesMatchText(result),
  }))

  // Texto para el que se eligió la acción "guardarla con este nombre"; deja
  // de valer en cuanto el texto cambia.
  const [freeNameChosenFor, setFreeNameChosenFor] = useState<string | null>(
    null,
  )
  const freeName = normalizePlantName(values.name)
  // El aviso de "por validar" sale al elegir la acción o cuando la búsqueda
  // ya terminó; mientras busca, no se adelanta.
  const pending =
    isPendingName(values) &&
    (freeNameChosenFor === values.name || search.status !== 'loading')
  const hint = linked
    ? PLANT_FORM_TEXT.nameLinkedHint
    : pending
      ? PLANT_FORM_TEXT.namePendingHint
      : PLANT_FORM_TEXT.nameHint

  return (
    <div className="flex flex-col gap-space-1">
      <Autocomplete
        ref={inputRef}
        label={PLANT_FORM_TEXT.nameLabel}
        labelStyle="scientific"
        renderLabel={renderScientificName}
        value={values.name}
        onValueChange={(name) => dispatch({ type: 'nameChanged', name })}
        options={options}
        loading={search.status === 'loading'}
        error={search.error?.message}
        minQueryLength={SEARCH_QUERY_MIN_LENGTH}
        emptyText="No está en el catálogo."
        hint={hint}
        maxLength={PLANT_NAME_MAX_LENGTH}
        spellCheck={false}
        autoCorrect="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onOptionSelect={(option) => {
          const result = search.results.find((item) => item.id === option.id)
          if (!result) return
          dispatch({
            type: 'speciesSelected',
            species: {
              id: result.id,
              scientificName: result.scientificName,
              genus: { id: result.genusId, name: result.genusName },
              type: result.type,
            },
          })
        }}
        action={
          !linked && freeName !== ''
            ? {
                label: PLANT_FORM_TEXT.freeNameAction(freeName),
                // El nombre ya está escrito: elegir la acción solo cierra la
                // lista y deja el nombre libre, sin pasos de más.
                onSelect: () => setFreeNameChosenFor(values.name),
              }
            : undefined
        }
      />
      {error && (
        <span id={errorId} className="orki-field__error">
          <Icon name="triangle-alert" />
          {error}
        </span>
      )}
    </div>
  )
}
