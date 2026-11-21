import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { Collapsible } from '../components/ui/Collapsible.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import {
  catalogSearchFailure,
  type CatalogSearchFunction,
  type GenusSearchResult,
  type SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { enumValues, type PlantType } from '../lib/database.ts'
import { localDateString } from '../lib/localDate.ts'
import { PATHS, signInPathFor } from '../routes/paths.ts'
import {
  ChoiceField,
  FORM_CHIP_CLASSES,
  LOCKED_CHIP_CLASSES,
} from './ChoiceField.tsx'
import { clearPlantDraft, readPlantDraft, writePlantDraft } from './draft.ts'
import { DuplicateNotice } from './DuplicateNotice.tsx'
import {
  initialPlantFormValues,
  isPlantFormDirty,
  PLANT_DETAIL_FIELDS,
  PLANT_FORM_FIELDS,
  PLANT_TEXT_MAX_LENGTH,
  plantFormReducer,
  toPlantInsert,
  validatePlantForm,
  type FormGenus,
  type NewPlantInsert,
  type PlantFormField,
  type PlantFormValues,
} from './form-state.ts'
import { GenusField, type QuickGeneraState } from './GenusField.tsx'
import { NameField } from './NameField.tsx'
import { OriginField } from './OriginField.tsx'
import { plantSaveErrorFrom, type PlantSaveError } from './save-plant.ts'
import {
  FLOWER_COLOR_LABEL,
  PLANT_FORM_TEXT,
  PLANT_TYPE_LABEL,
} from './texts.ts'

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
  /**
   * Salir sin guardar; si había cambios, la persona ya lo confirmó y el
   * borrador ya está borrado.
   */
  onCancel: () => void
  /**
   * Plantas del usuario ya cargadas (la colección en memoria), para las
   * sugerencias de origen y el aviso de duplicado; null o sin indicar si aún
   * no están (el formulario funciona igual, sin ellos).
   */
  knownPlants?: readonly CollectionPlant[] | null
  /**
   * Dueño del borrador (id del usuario). Con él, lo escrito se guarda en el
   * dispositivo y se recupera al volver a abrir el formulario (draft.ts); sin
   * él, no hay borrador. Si cambia, hay que volver a montar el formulario
   * (key), porque el borrador se lee al montarse.
   */
  draftUserId?: string | null
  /** Reloj, para las pruebas. Por defecto, la hora del dispositivo. */
  now?: () => Date
}

const PLANT_TYPES: readonly PlantType[] = ['species', 'hybrid', 'unknown']

const deviceNow = () => new Date()

/** Si hay algo escrito dentro de "Más detalles". */
function hasDetails(values: PlantFormValues): boolean {
  return (
    values.location.trim() !== '' ||
    values.nickname.trim() !== '' ||
    values.flowerColor !== null
  )
}

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
 * Aviso discreto de borrador recuperado, con "Descartar borrador". Como en
 * RegisteredNotice, la región role="status" se pinta vacía y el texto llega en
 * el pintado siguiente, para que el lector de pantalla lo anuncie.
 */
function DraftNotice({ onDiscard }: { onDiscard: () => void }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div role="status">
      {visible && (
        <div className="flex flex-wrap items-center justify-between gap-space-2 rounded-lg bg-neutral-50 px-space-4 py-space-2">
          <p className="text-sm text-neutral-900">
            {PLANT_FORM_TEXT.draftRestored}
          </p>
          <Button className="flex-none" onClick={onDiscard}>
            {PLANT_FORM_TEXT.draftDiscard}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Formulario de registro de una planta: los cuatro campos obligatorios
 * (nombre, género, tipo y fecha de adquisición, #85), el aviso de duplicado
 * (#88), el origen y la sección plegable "Más detalles" (#86). Todo el estado de los campos vive en un
 * reductor (form-state.ts); aquí van la validación al enviar, el guardado y
 * sus errores, y el borrador en el dispositivo (draft.ts).
 *
 * Borrador: cada cambio se guarda; si el formulario vuelve a estar vacío, se
 * borra. Se recupera al montarse, con un aviso y "Descartar borrador". Se
 * borra al guardar con éxito, al descartarlo y al salir con "Cancelar" (que
 * avisa antes de perder lo escrito). Salir de otra forma (otra pestaña de la
 * app, cerrar o recargar) lo conserva: es lo que protege de una recarga.
 */
export function PlantForm({
  services,
  online,
  onSaved,
  onCancel,
  knownPlants = null,
  draftUserId = null,
  now = deviceNow,
}: PlantFormProps) {
  // Lo que se lee una sola vez al montarse: el formulario vacío de hoy y el
  // borrador, si lo hay.
  const [start] = useState(() => {
    const fresh = initialPlantFormValues(localDateString(now()))
    const draft = draftUserId ? readPlantDraft(draftUserId, now()) : null
    return { fresh, draft, values: draft?.values ?? fresh }
  })
  const initial = start.fresh
  const [values, dispatch] = useReducer(plantFormReducer, start.values)
  const [submitted, setSubmitted] = useState(false)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  // El id de la planta se genera una vez (o viene del borrador) y se
  // reutiliza en cada reintento: si un intento llegó a la base pero no su
  // respuesta, el siguiente no crea otra planta (ver save-plant.ts). Solo
  // cambia al descartar el borrador.
  const [plantId, setPlantId] = useState(
    () => start.draft?.plantId ?? newPlantId(),
  )
  const [draftRestored, setDraftRestored] = useState(start.draft !== null)
  // Cerrada por defecto; abierta si el borrador traía algo dentro.
  const [detailsOpen, setDetailsOpen] = useState(() => hasDetails(start.values))
  // Evita el doble envío antes de que React pinte el estado "guardando".
  const savingRef = useRef(false)
  const [quickGenera, retryQuickGenera] = useQuickGenera(
    services.loadQuickGenera,
    online,
  )

  // Guarda el borrador con cada cambio. Los valores con los que se montó no
  // se reescriben: recuperar un borrador no renueva su caducidad.
  useEffect(() => {
    if (draftUserId === null || values === start.values) return
    if (isPlantFormDirty(values, initial)) {
      writePlantDraft(draftUserId, {
        plantId,
        values,
        savedAt: now().getTime(),
      })
    } else {
      clearPlantDraft(draftUserId)
    }
  }, [values, draftUserId, plantId, now, start.values, initial])

  const offlineId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const genusRef = useRef<HTMLDivElement>(null)
  const typeRef = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const originRef = useRef<HTMLInputElement>(null)
  const locationRef = useRef<HTMLInputElement>(null)
  const nicknameRef = useRef<HTMLInputElement>(null)

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
      case 'origin':
        originRef.current?.focus()
        return
      case 'location':
        locationRef.current?.focus()
        return
      case 'nickname':
        nicknameRef.current?.focus()
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
      // Un error dentro de "Más detalles" la abre, para que se vea; se pinta
      // ya, antes de mover el foco a un campo que estaba oculto.
      if (PLANT_DETAIL_FIELDS.some((field) => found[field])) {
        flushSync(() => setDetailsOpen(true))
      }
      focusField(firstInvalid)
      return
    }

    savingRef.current = true
    setSave({ status: 'saving' })
    try {
      const plant = await services.savePlant(toPlantInsert(values, plantId))
      savingRef.current = false
      if (draftUserId !== null) clearPlantDraft(draftUserId)
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
    if (draftUserId !== null) clearPlantDraft(draftUserId)
    onCancel()
  }

  // Empieza de cero: formulario vacío con la fecha de hoy y otro id de planta
  // (el del borrador pudo llegar a la base en un intento anterior).
  const discardDraft = () => {
    if (saving) return
    if (draftUserId !== null) clearPlantDraft(draftUserId)
    dispatch({
      type: 'restored',
      values: initialPlantFormValues(localDateString(now())),
    })
    setPlantId(newPlantId())
    setDraftRestored(false)
    setDetailsOpen(false)
    setSubmitted(false)
    setSave({ status: 'idle' })
    // El botón desaparece con el aviso: el foco va al primer campo.
    nameRef.current?.focus()
  }

  return (
    <form
      noValidate
      aria-label={PLANT_FORM_TEXT.title}
      className="flex flex-col gap-space-5"
      onSubmit={(event) => void handleSubmit(event)}
    >
      {draftRestored && <DraftNotice onDiscard={discardDraft} />}

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
        {/* El aviso de duplicado (#88) va pegado al nombre, sin hueco propio. */}
        <div>
          <NameField
            values={values}
            dispatch={dispatch}
            searchSpecies={services.searchSpecies}
            error={errors.name}
            inputRef={nameRef}
          />
          <DuplicateNotice species={values.species} knownPlants={knownPlants} />
        </div>

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

        {/* #87: la foto va aquí, antes del origen. */}

        <OriginField
          value={values.origin}
          dispatch={dispatch}
          knownPlants={knownPlants}
          error={errors.origin}
          inputRef={originRef}
        />

        <Collapsible
          title={PLANT_FORM_TEXT.detailsTitle}
          headingLevel={2}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        >
          <div className="flex flex-col gap-space-5 pt-space-3">
            <TextField
              ref={locationRef}
              label={PLANT_FORM_TEXT.locationLabel}
              hint={PLANT_FORM_TEXT.locationHint}
              value={values.location}
              maxLength={PLANT_TEXT_MAX_LENGTH}
              autoCapitalize="sentences"
              error={errors.location}
              onChange={(event) =>
                dispatch({
                  type: 'textChanged',
                  field: 'location',
                  value: event.target.value,
                })
              }
            />
            <TextField
              ref={nicknameRef}
              label={PLANT_FORM_TEXT.nicknameLabel}
              hint={PLANT_FORM_TEXT.nicknameHint}
              value={values.nickname}
              maxLength={PLANT_TEXT_MAX_LENGTH}
              autoCapitalize="sentences"
              error={errors.nickname}
              onChange={(event) =>
                dispatch({
                  type: 'textChanged',
                  field: 'nickname',
                  value: event.target.value,
                })
              }
            />
            <ChoiceField label={PLANT_FORM_TEXT.flowerColorLabel}>
              {() =>
                enumValues.flower_color.map((flowerColor) => (
                  <Chip
                    key={flowerColor}
                    className={FORM_CHIP_CLASSES}
                    selected={values.flowerColor === flowerColor}
                    onClick={() =>
                      dispatch({ type: 'flowerColorToggled', flowerColor })
                    }
                  >
                    {FLOWER_COLOR_LABEL[flowerColor]}
                  </Chip>
                ))
              }
            </ChoiceField>
            {/*
              #87: "La foto es en floración" (values.photoInBloom, acción
              photoInBloomChanged) va aquí y solo con una foto elegida: sin
              foto no tiene sentido. Ya viaja en la fila y en el borrador.
            */}
          </div>
        </Collapsible>
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
