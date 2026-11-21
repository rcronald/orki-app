import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import {
  catalogSearchFailure,
  type CatalogSearchFunction,
  type GenusSearchResult,
  type SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import type { PlantType } from '../lib/database.ts'
import { localDateString } from '../lib/localDate.ts'
import { PATHS, signInPathFor } from '../routes/paths.ts'
import {
  ChoiceField,
  FORM_CHIP_CLASSES,
  LOCKED_CHIP_CLASSES,
} from './ChoiceField.tsx'
import {
  initialPlantFormValues,
  isPlantFormDirty,
  PLANT_FORM_FIELDS,
  plantFormReducer,
  toPlantInsert,
  validatePlantForm,
  type FormGenus,
  type NewPlantInsert,
  type PlantFormField,
} from './form-state.ts'
import { GenusField, type QuickGeneraState } from './GenusField.tsx'
import { NameField } from './NameField.tsx'
import { plantSaveErrorFrom, type PlantSaveError } from './save-plant.ts'
import { PLANT_FORM_TEXT, PLANT_TYPE_LABEL } from './texts.ts'

/**
 * De dónde saca el formulario los datos y dónde guarda. La pantalla de
 * registro pasa los de Supabase; la página de muestra, unos con datos fijos.
 * Deben ser estables entre pintados (funciones de módulo).
 */
export interface PlantFormServices {
  searchSpecies: CatalogSearchFunction<SpeciesSearchResult>
  searchGenera: CatalogSearchFunction<GenusSearchResult>
  /** Géneros de acceso rápido; se rechaza con CatalogSearchError. */
  loadQuickGenera: () => Promise<readonly FormGenus[]>
  /** Inserta la planta; se rechaza con PlantSaveError. */
  savePlant: (insert: NewPlantInsert) => Promise<CollectionPlant>
}

export interface PlantFormProps {
  services: PlantFormServices
  /** Si hay conexión (useOnlineStatus). Sin ella, el formulario se desactiva. */
  online: boolean
  /** La planta ya está guardada. */
  onSaved: (plant: CollectionPlant) => void
  /** Salir sin guardar; si había cambios, la persona ya lo confirmó. */
  onCancel: () => void
  /** Reloj, para las pruebas. Por defecto, la hora del dispositivo. */
  now?: () => Date
}

const PLANT_TYPES: readonly PlantType[] = ['species', 'hybrid', 'unknown']

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'error'; error: PlantSaveError }

function newPlantId(): string {
  return crypto.randomUUID()
}

function useQuickGenera(
  load: () => Promise<readonly FormGenus[]>,
  online: boolean,
): [QuickGeneraState, () => void] {
  const [state, setState] = useState<QuickGeneraState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // Se vuelve a pedir al recuperar la conexión; la carga está en caché, así
  // que si ya llegó no sale ninguna petición.
  useEffect(() => {
    let active = true
    load().then(
      (genera) => {
        if (active) setState({ status: 'ready', genera })
      },
      (error: unknown) => {
        if (!active) return
        const reason =
          catalogSearchFailure(error) === 'offline' ? 'offline' : 'failed'
        setState({ status: 'error', reason })
      },
    )
    return () => {
      active = false
    }
  }, [load, attempt, online])

  const retry = () => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }
  return [state, retry]
}

/**
 * Formulario de registro de una planta (#85) con los cuatro campos
 * obligatorios: nombre, género, tipo y fecha de adquisición. Todo el estado
 * de los campos vive en un reductor (form-state.ts); aquí van la validación al
 * enviar, el guardado y sus errores.
 */
export function PlantForm({
  services,
  online,
  onSaved,
  onCancel,
  now = () => new Date(),
}: PlantFormProps) {
  const [initial] = useState(() =>
    initialPlantFormValues(localDateString(now())),
  )
  const [values, dispatch] = useReducer(plantFormReducer, initial)
  const [submitted, setSubmitted] = useState(false)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  // El id de la planta se genera una vez y se reutiliza en cada reintento:
  // si un intento llegó a la base pero no su respuesta, el siguiente no crea
  // otra planta (ver save-plant.ts).
  const [plantId] = useState(newPlantId)
  // Evita el doble envío antes de que React pinte el estado "guardando".
  const savingRef = useRef(false)
  const [quickGenera, retryQuickGenera] = useQuickGenera(
    services.loadQuickGenera,
    online,
  )

  const offlineId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const genusRef = useRef<HTMLDivElement>(null)
  const typeRef = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)

  const today = localDateString(now())
  // Sin validar mientras se escribe: los errores aparecen al intentar
  // guardar y, desde entonces, se actualizan con cada cambio.
  const errors = submitted ? validatePlantForm(values, today) : {}
  const saving = save.status === 'saving'
  const locked = values.species !== null

  const focusField = (field: PlantFormField) => {
    switch (field) {
      case 'name':
        nameRef.current?.focus()
        return
      case 'genus':
        // El buscador de "Otro" si está abierto; si no, el primer chip.
        genusRef.current
          ?.querySelector<HTMLElement>(
            values.otherGenusOpen ? 'input' : 'button',
          )
          ?.focus()
        return
      case 'type':
        typeRef.current?.querySelector<HTMLElement>('button')?.focus()
        return
      case 'acquiredOn':
        dateRef.current?.focus()
        return
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current || !online) return
    setSubmitted(true)
    const found = validatePlantForm(values, localDateString(now()))
    const firstInvalid = PLANT_FORM_FIELDS.find((field) => found[field])
    if (firstInvalid) {
      focusField(firstInvalid)
      return
    }

    savingRef.current = true
    setSave({ status: 'saving' })
    try {
      const plant = await services.savePlant(toPlantInsert(values, plantId))
      savingRef.current = false
      setSave({ status: 'idle' })
      onSaved(plant)
    } catch (error) {
      savingRef.current = false
      setSave({ status: 'error', error: plantSaveErrorFrom(error) })
    }
  }

  const cancel = () => {
    if (saving) return
    if (
      isPlantFormDirty(values, initial) &&
      !window.confirm(PLANT_FORM_TEXT.confirmDiscard)
    ) {
      return
    }
    onCancel()
  }

  return (
    <form
      noValidate
      aria-label={PLANT_FORM_TEXT.title}
      className="flex flex-col gap-space-5"
      onSubmit={(event) => void handleSubmit(event)}
    >
      {/* Región siempre presente: así se anuncia al perder la conexión. */}
      <div id={offlineId} role="status">
        {!online && (
          <p className="flex items-start gap-space-2 rounded-lg bg-neutral-50 p-space-4 text-sm text-neutral-900">
            <Icon
              name="triangle-alert"
              className="mt-[2px] size-[16px] flex-none"
            />
            {PLANT_FORM_TEXT.offline}
          </p>
        )}
      </div>

      {/* Sin conexión, todo el formulario queda desactivado; lo escrito se conserva. */}
      <fieldset
        disabled={!online}
        className="flex min-w-[0] flex-col gap-space-5"
      >
        <NameField
          values={values}
          dispatch={dispatch}
          searchSpecies={services.searchSpecies}
          error={errors.name}
          inputRef={nameRef}
        />

        {/* #88: el aviso de "ya la tienes" irá aquí, bajo el nombre. */}

        <GenusField
          values={values}
          dispatch={dispatch}
          quickGenera={quickGenera}
          onRetryQuickGenera={retryQuickGenera}
          searchGenera={services.searchGenera}
          error={errors.genus}
          containerRef={genusRef}
        />

        <ChoiceField
          label={PLANT_FORM_TEXT.typeLabel}
          lockedHint={locked ? PLANT_FORM_TEXT.lockedHint : undefined}
          error={errors.type}
          containerRef={typeRef}
        >
          {(describedBy) =>
            PLANT_TYPES.map((plantType) => {
              const selected = values.type === plantType
              return (
                <Chip
                  key={plantType}
                  className={[
                    FORM_CHIP_CLASSES,
                    locked && !selected ? LOCKED_CHIP_CLASSES : '',
                  ].join(' ')}
                  selected={selected}
                  aria-disabled={locked || undefined}
                  aria-describedby={describedBy}
                  onClick={() => dispatch({ type: 'typeSelected', plantType })}
                >
                  {PLANT_TYPE_LABEL[plantType]}
                </Chip>
              )
            })
          }
        </ChoiceField>

        <TextField
          ref={dateRef}
          label={PLANT_FORM_TEXT.dateLabel}
          type="date"
          max={today}
          value={values.acquiredOn}
          error={errors.acquiredOn}
          onChange={(event) =>
            dispatch({
              type: 'acquiredOnChanged',
              acquiredOn: event.target.value,
            })
          }
        />

        {/* #87: la foto. #86: el origen y la sección plegable "Más detalles". */}
      </fieldset>

      {save.status === 'error' && (
        <div
          role="alert"
          className="flex flex-col items-start gap-space-3 rounded-lg bg-danger-soft p-space-4"
        >
          <p className="flex items-start gap-space-2 text-sm text-neutral-900">
            <Icon
              name="triangle-alert"
              className="mt-[2px] size-[16px] flex-none text-danger"
            />
            {save.error.message}
          </p>
          <div className="flex flex-wrap gap-space-3">
            <Button type="submit" aria-disabled={!online || undefined}>
              {PLANT_FORM_TEXT.retry}
            </Button>
            {save.error.reason === 'session-ended' && (
              <Link
                to={signInPathFor(PATHS.newPlant)}
                className="orki-btn orki-btn--secondary"
              >
                {PLANT_FORM_TEXT.signIn}
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Acciones fijas abajo, al alcance del pulgar. */}
      <div className="sticky bottom-[0] z-10 -mx-space-4 flex gap-space-3 bg-neutral-0 px-space-4 pt-space-3 pb-[calc(var(--space-3)_+_env(safe-area-inset-bottom))]">
        <Button
          className="flex-none px-space-4"
          aria-disabled={saving || undefined}
          onClick={cancel}
        >
          {PLANT_FORM_TEXT.cancel}
        </Button>
        <Button
          type="submit"
          variant="primary"
          className="min-w-[0] flex-1 px-space-4"
          aria-disabled={saving || !online || undefined}
          aria-describedby={!online ? offlineId : undefined}
        >
          {saving ? PLANT_FORM_TEXT.submitting : PLANT_FORM_TEXT.submit}
        </Button>
      </div>
    </form>
  )
}
