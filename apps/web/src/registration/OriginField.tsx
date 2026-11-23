import { useId, useMemo, type Dispatch, type Ref } from 'react'
import {
  Autocomplete,
  type AutocompleteOption,
} from '../components/ui/Autocomplete.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import type { CollectionPlant } from '../collection/model.ts'
import { PLANT_TEXT_MAX_LENGTH, type PlantFormAction } from './form-state.ts'
import { knownOrigins, suggestOrigins } from './origin-suggestions.ts'
import { PLANT_FORM_TEXT } from './texts.ts'

/** Textos de cada campo con sugerencias. */
const FIELD_TEXT = {
  origin: {
    label: PLANT_FORM_TEXT.originLabel,
    hint: PLANT_FORM_TEXT.originHint,
    count: (count: number) =>
      count === 1
        ? '1 origen que ya usaste'
        : `${count} orígenes que ya usaste`,
  },
  location: {
    label: PLANT_FORM_TEXT.locationLabel,
    hint: PLANT_FORM_TEXT.locationHint,
    count: (count: number) =>
      count === 1
        ? '1 ubicación que ya usaste'
        : `${count} ubicaciones que ya usaste`,
  },
} as const

interface OriginFieldProps {
  /**
   * Qué campo es: el origen (por defecto) o la ubicación, que la edición
   * (#266) muestra a la vista con las ubicaciones que ya usaste.
   */
  field?: 'origin' | 'location'
  value: string
  dispatch: Dispatch<PlantFormAction>
  /** Plantas del usuario ya cargadas; null si aún no están (sin sugerencias). */
  knownPlants: readonly CollectionPlant[] | null
  error?: string
  inputRef: Ref<HTMLInputElement>
}

/**
 * Origen (tienda, vivero, intercambio...) con las sugerencias de los que el
 * usuario ya usó (origin-suggestions.ts). Acepta cualquier texto nuevo: no
 * hay "sin resultados" ni acción final. Con field="location", lo mismo para
 * la ubicación.
 */
export function OriginField({
  field = 'origin',
  value,
  dispatch,
  knownPlants,
  error,
  inputRef,
}: OriginFieldProps) {
  const errorId = useId()
  const text = FIELD_TEXT[field]
  const origins = useMemo(
    () =>
      knownPlants ? knownOrigins(knownPlants, (plant) => plant[field]) : [],
    [knownPlants, field],
  )
  const options: AutocompleteOption[] = suggestOrigins(origins, value).map(
    (origin) => ({ id: origin.key, label: origin.label }),
  )

  return (
    <div className="flex flex-col gap-space-1">
      <Autocomplete
        ref={inputRef}
        label={text.label}
        hint={text.hint}
        value={value}
        onValueChange={(typed) =>
          dispatch({ type: 'textChanged', field, value: typed })
        }
        options={options}
        onOptionSelect={(option) =>
          dispatch({ type: 'textChanged', field, value: option.label })
        }
        formatResultCount={text.count}
        // Un origen nuevo es lo normal: sin sugerencias no se muestra "sin
        // resultados" (con un mínimo inalcanzable, la lista solo se abre si
        // hay sugerencias).
        minQueryLength={Number.POSITIVE_INFINITY}
        maxLength={PLANT_TEXT_MAX_LENGTH}
        autoCapitalize="sentences"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
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
