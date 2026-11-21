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
import { PhotoField, type PhotoFieldValue } from '../photos/PhotoField.tsx'
import { PhotoStorageError } from '../photos/storage.ts'
import type {
  PhotoFiles,
  PlantPhotoChangeResult,
  UploadProgress,
} from '../photos/upload.ts'
import { canRetryUpload, usePhotoUpload } from '../photos/usePhotoUpload.ts'
import { PATHS, signInPathFor } from '../routes/paths.ts'
import {
  ChoiceField,
  FORM_CHIP_CLASSES,
  LOCKED_CHIP_CLASSES,
} from './ChoiceField.tsx'
import { clearPlantDraft, readPlantDraft, writePlantDraft } from './draft.ts'
import {
  appDraftPhotoBackend,
  clearDraftPhoto,
  readDraftPhoto,
  writeDraftPhoto,
  type DraftPhotoBackend,
} from './draft-photo.ts'
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
  isPendingName,
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
  /**
   * Sube la foto de la planta ya guardada y la apunta a ella
   * (replacePlantPhoto); se rechaza con PhotoStorageError.
   */
  uploadPhoto: (
    files: PhotoFiles,
    options: PlantPhotoUploadOptions,
  ) => Promise<PlantPhotoChangeResult>
}

export interface PlantPhotoUploadOptions {
  userId: string
  plant: CollectionPlant
  signal: AbortSignal
  onProgress: (progress: UploadProgress) => void
  /** La planta ya apunta a la foto nueva. */
  onPlantUpdated: (plant: CollectionPlant) => void
}

export interface PlantFormProps {
  services: PlantFormServices
  /** Si hay conexión (useOnlineStatus). Sin ella, el formulario se desactiva. */
  online: boolean
  /**
   * El registro terminó: la planta está guardada y, si había foto, subida (o
   * la persona eligió seguir sin ella). Para salir del formulario.
   */
  onSaved: (plant: CollectionPlant) => void
  /**
   * La fila de la planta cambió en la base: al guardarla y, después, al
   * apuntarla a su foto. Para reflejarla en la colección (upsertPlant) en
   * cuanto existe, aunque la foto falle o la persona salga a mitad.
   */
  onPlantStored?: (plant: CollectionPlant) => void
  /**
   * Entrada "desde la cámara" (#87, /coleccion/nueva?foto=1): el campo de
   * foto va arriba del todo y, al elegir la primera foto, el foco pasa al
   * nombre.
   */
  photoFirst?: boolean
  /** Dónde se guarda la foto pendiente del borrador; por defecto, IndexedDB. */
  photoDraftBackend?: DraftPhotoBackend
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
    values.flowerColor !== null ||
    values.photoInBloom
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
 * (#88), el origen, la sección plegable "Más detalles" (#86) y la foto
 * (#87). Todo el estado de los campos vive en un reductor (form-state.ts);
 * aquí van la validación al enviar, el guardado y sus errores, la subida de
 * la foto y el borrador en el dispositivo (draft.ts y draft-photo.ts).
 *
 * Borrador: cada cambio se guarda; si el formulario vuelve a estar vacío, se
 * borra. Se recupera al montarse, con un aviso y "Descartar borrador". Se
 * borra al guardar con éxito, al descartarlo y al salir con "Cancelar" (que
 * avisa antes de perder lo escrito). Salir de otra forma (otra pestaña de la
 * app, cerrar o recargar) lo conserva: es lo que protege de una recarga.
 *
 * Foto (#87): opcional. Primero se guarda la planta y después se sube la foto
 * (replacePlantPhoto), así que un fallo de la foto no pierde el registro. La
 * subida se espera aquí, con su estado: si falla, la planta ya está
 * registrada y se ofrece reintentar con la misma foto ya preparada o
 * continuar sin ella.
 */
export function PlantForm({
  services,
  online,
  onSaved,
  onCancel,
  onPlantStored,
  knownPlants = null,
  draftUserId = null,
  photoFirst = false,
  photoDraftBackend = appDraftPhotoBackend(),
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

  // Foto elegida (ya preparada), aún sin subir. No va en el reductor: es un
  // archivo, no un dato de la fila.
  const [photo, setPhoto] = useState<PhotoFieldValue | null>(null)
  const hasPhoto = photo !== null
  const [photoProcessing, setPhotoProcessing] = useState(false)
  // Si la persona ya eligió o quitó una foto: la del borrador, que llega
  // después (IndexedDB es asíncrono), ya no la sustituye.
  const photoTouched = useRef(false)
  // Planta ya guardada cuya foto se está subiendo o no se pudo subir.
  const [registered, setRegistered] = useState<CollectionPlant | null>(null)
  const upload = usePhotoUpload<PlantPhotoChangeResult>()
  const primaryRef = useRef<HTMLButtonElement>(null)
  const uploadAlertRef = useRef<HTMLDivElement>(null)

  // Guarda el borrador con cada cambio. Los valores con los que se montó no
  // se reescriben: recuperar un borrador no renueva su caducidad. Con una foto
  // el borrador se conserva aunque no haya nada escrito: lleva el id de
  // planta con el que va la foto.
  useEffect(() => {
    if (draftUserId === null || values === start.values) return
    if (isPlantFormDirty(values, initial) || hasPhoto) {
      writePlantDraft(draftUserId, {
        plantId,
        values,
        savedAt: now().getTime(),
      })
    } else {
      clearPlantDraft(draftUserId)
    }
  }, [values, draftUserId, plantId, now, start.values, initial, hasPhoto])

  // La foto pendiente del borrador, si va con su id de planta. Sin borrador
  // de texto, la que hubiera se borra.
  useEffect(() => {
    if (draftUserId === null) return
    let active = true
    void readDraftPhoto(photoDraftBackend, draftUserId, {
      plantId: start.draft?.plantId ?? null,
      now: now(),
    }).then((found) => {
      if (!active || found === null || photoTouched.current) return
      setPhoto({ kind: 'new', photo: found.photo, fileName: found.fileName })
    })
    return () => {
      active = false
    }
  }, [draftUserId, photoDraftBackend, start.draft, now])

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

  /** Sube la foto de la planta ya guardada; reintentar repite esta tarea. */
  const startUpload = (plant: CollectionPlant, files: PhotoFiles) =>
    upload.start(({ signal, onProgress }) => {
      if (draftUserId === null) {
        return Promise.reject(new PhotoStorageError('session-ended'))
      }
      return services.uploadPhoto(files, {
        userId: draftUserId,
        plant,
        signal,
        onProgress,
        onPlantUpdated: (updated) => onPlantStored?.(updated),
      })
    })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current || !online || registered !== null) return
    // Con la foto a medio preparar no se guarda: el botón lo dice.
    if (photoProcessing) return
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

    const files = photo?.kind === 'new' ? photo.photo : null
    savingRef.current = true
    setSave({ status: 'saving' })
    let plant: CollectionPlant
    try {
      // "En floración" solo tiene sentido con foto.
      plant = await services.savePlant(
        toPlantInsert(
          { ...values, photoInBloom: values.photoInBloom && files !== null },
          plantId,
        ),
      )
    } catch (error) {
      savingRef.current = false
      setSave({ status: 'error', error: plantSaveErrorFrom(error) })
      return
    }
    savingRef.current = false
    // La planta ya existe: el borrador (y su foto) sobran. La foto sigue en
    // memoria para subirla y reintentarlo.
    if (draftUserId !== null) {
      clearPlantDraft(draftUserId)
      void clearDraftPhoto(photoDraftBackend, draftUserId)
    }
    setSave({ status: 'idle' })
    onPlantStored?.(plant)
    if (files === null) {
      onSaved(plant)
      return
    }
    setRegistered(plant)
    const result = await startUpload(plant, files)
    if (result) onSaved(result.plant)
  }

  const uploadError =
    registered !== null && upload.state.status === 'error'
      ? upload.state.error
      : null
  const uploading = registered !== null && uploadError === null
  const canRetry = uploadError !== null && canRetryUpload(uploadError.reason)

  // Tras un fallo de la subida, el foco va a la acción que sigue (reintentar
  // o, si no se puede, continuar), que está en la barra fija de abajo, y el
  // mensaje que lo explica se desplaza a la vista: queda al final del
  // formulario, quizá fuera de la pantalla.
  const uploadFailed = uploadError !== null
  useEffect(() => {
    if (!uploadFailed) return
    primaryRef.current?.focus()
    // jsdom no tiene scrollIntoView.
    uploadAlertRef.current?.scrollIntoView?.({ block: 'center' })
  }, [uploadFailed])

  const retryUpload = async () => {
    if (!online || upload.state.status !== 'error') return
    const result = await upload.retry()
    if (result) onSaved(result.plant)
  }

  // La planta ya está registrada; se sale sin foto.
  const continueWithoutPhoto = () => {
    if (registered === null || upload.state.status === 'uploading') return
    onSaved(registered)
  }

  const changePhoto = (next: PhotoFieldValue | null) => {
    photoTouched.current = true
    const first = photo === null
    setPhoto(next)
    // Sin foto, "en floración" no tiene sentido.
    if (next === null && values.photoInBloom) {
      dispatch({ type: 'photoInBloomChanged', photoInBloom: false })
    }
    if (draftUserId !== null) {
      if (next?.kind === 'new') {
        const savedAt = now().getTime()
        // El borrador de texto lleva el id de planta con el que va la foto.
        writePlantDraft(draftUserId, { plantId, values, savedAt })
        void writeDraftPhoto(photoDraftBackend, draftUserId, {
          plantId,
          savedAt,
          fileName: next.fileName,
          photo: next.photo,
        })
      } else {
        void clearDraftPhoto(photoDraftBackend, draftUserId)
        if (!isPlantFormDirty(values, initial)) clearPlantDraft(draftUserId)
      }
    }
    // Desde la cámara, tras la primera foto se sigue por el nombre.
    if (photoFirst && first && next !== null && values.name === '') {
      nameRef.current?.focus()
    }
  }

  const cancel = () => {
    if (saving || registered !== null) return
    if (
      (isPlantFormDirty(values, initial) || hasPhoto) &&
      !window.confirm(PLANT_FORM_TEXT.confirmDiscard)
    ) {
      return
    }
    if (draftUserId !== null) {
      clearPlantDraft(draftUserId)
      void clearDraftPhoto(photoDraftBackend, draftUserId)
    }
    onCancel()
  }

  // Empieza de cero: formulario vacío con la fecha de hoy, sin foto y otro id
  // de planta (el del borrador pudo llegar a la base en un intento anterior).
  const discardDraft = () => {
    if (saving || registered !== null) return
    if (draftUserId !== null) {
      clearPlantDraft(draftUserId)
      void clearDraftPhoto(photoDraftBackend, draftUserId)
    }
    dispatch({
      type: 'restored',
      values: initialPlantFormValues(localDateString(now())),
    })
    photoTouched.current = true
    setPhoto(null)
    setPlantId(newPlantId())
    setDraftRestored(false)
    setDetailsOpen(false)
    setSubmitted(false)
    setSave({ status: 'idle' })
    // El botón desaparece con el aviso: el foco va al primer campo.
    nameRef.current?.focus()
  }

  const photoField = (
    <PhotoField
      value={photo}
      onChange={changePhoto}
      label={PLANT_FORM_TEXT.photoLabel}
      description={
        isPendingName(values)
          ? PLANT_FORM_TEXT.pendingPhotoHint
          : photoFirst
            ? PLANT_FORM_TEXT.photoFirstHint
            : PLANT_FORM_TEXT.photoHint
      }
      disabled={saving || registered !== null}
      onProcessingChange={setPhotoProcessing}
    />
  )

  let primaryText: string
  if (registered !== null) {
    primaryText = uploading
      ? PLANT_FORM_TEXT.photoUploadingButton
      : canRetry
        ? PLANT_FORM_TEXT.photoUploadRetry
        : PLANT_FORM_TEXT.photoContinueWithout
  } else if (saving) {
    primaryText = PLANT_FORM_TEXT.submitting
  } else if (photoProcessing) {
    primaryText = PLANT_FORM_TEXT.photoPreparing
  } else {
    primaryText = PLANT_FORM_TEXT.submit
  }
  const primaryBlocked =
    registered !== null
      ? uploading || (canRetry && !online)
      : saving || photoProcessing || !online
  const progress =
    upload.state.status === 'uploading' ? upload.state.progress : null

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

      {/*
        Sin conexión, todo el formulario queda desactivado; lo escrito y la
        foto se conservan. Con la planta ya guardada (subiendo su foto), no
        hay nada más que editar.
      */}
      <fieldset
        disabled={!online || registered !== null}
        className="flex min-w-[0] flex-col gap-space-5"
      >
        {/* Desde la cámara, la foto va lo primero. */}
        {photoFirst && photoField}

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

        {/*
          La foto, opcional, después de los obligatorios: registrar sin foto
          no pasa por ella. Con un nombre por validar (#12) recomienda
          añadirla, sin exigirla.
        */}
        {!photoFirst && photoField}

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
            {/* Solo con una foto elegida: sin foto no tiene sentido. */}
            {hasPhoto && (
              <div>
                <Chip
                  className={FORM_CHIP_CLASSES}
                  selected={values.photoInBloom}
                  onClick={() =>
                    dispatch({
                      type: 'photoInBloomChanged',
                      photoInBloom: !values.photoInBloom,
                    })
                  }
                >
                  {PLANT_FORM_TEXT.photoInBloom}
                </Chip>
              </div>
            )}
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

      {/* Región siempre presente: anuncia la subida de la foto. */}
      <div role="status">
        {uploading && (
          <p className="text-sm text-neutral-900">
            {progress
              ? PLANT_FORM_TEXT.photoUploadProgress(
                  progress.filesDone,
                  progress.filesTotal,
                )
              : PLANT_FORM_TEXT.photoUploading}
          </p>
        )}
      </div>

      {uploadError !== null && (
        <div
          ref={uploadAlertRef}
          role="alert"
          className="flex flex-col gap-space-2 rounded-lg bg-danger-soft p-space-4 text-sm text-neutral-900"
        >
          <p className="flex items-start gap-space-2 font-semibold">
            <Icon
              name="triangle-alert"
              className="mt-[2px] size-[16px] flex-none text-danger"
            />
            {uploadError.reason === 'aborted'
              ? PLANT_FORM_TEXT.photoUploadCancelled
              : PLANT_FORM_TEXT.photoUploadFailed}
          </p>
          {uploadError.reason !== 'aborted' && <p>{uploadError.message}</p>}
          {canRetry && <p>{PLANT_FORM_TEXT.photoUploadRetryHint}</p>}
        </div>
      )}

      {/* Acciones fijas abajo, al alcance del pulgar. */}
      <div className="sticky bottom-[0] z-10 -mx-space-4 flex gap-space-3 bg-neutral-0 px-space-4 pt-space-3 pb-[calc(var(--space-3)_+_env(safe-area-inset-bottom))]">
        {registered === null ? (
          <Button
            className="flex-none px-space-4"
            aria-disabled={saving || undefined}
            onClick={cancel}
          >
            {PLANT_FORM_TEXT.cancel}
          </Button>
        ) : uploading ? (
          <Button className="flex-none px-space-4" onClick={upload.cancel}>
            {PLANT_FORM_TEXT.photoUploadCancel}
          </Button>
        ) : (
          canRetry && (
            <Button
              className="flex-none px-space-4"
              onClick={continueWithoutPhoto}
            >
              {PLANT_FORM_TEXT.photoContinueWithout}
            </Button>
          )
        )}
        {/*
          El mismo botón en todas las fases (registrar, subiendo, reintentar o
          continuar): el foco no se pierde al cambiar de una a otra.
        */}
        <Button
          ref={primaryRef}
          type={registered === null ? 'submit' : 'button'}
          variant="primary"
          className="min-w-[0] flex-1 px-space-4"
          aria-disabled={primaryBlocked || undefined}
          aria-describedby={
            !online && (registered === null || canRetry) ? offlineId : undefined
          }
          onClick={
            registered === null
              ? undefined
              : uploading
                ? undefined
                : canRetry
                  ? () => void retryUpload()
                  : continueWithoutPhoto
          }
        >
          {primaryText}
        </Button>
      </div>
    </form>
  )
}
