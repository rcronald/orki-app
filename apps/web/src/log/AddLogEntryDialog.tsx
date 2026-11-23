import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { Button } from '../components/ui/Button.tsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { Modal } from '../components/ui/Modal.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import type { PlantLogEntryType } from '../lib/database.ts'
import { loadPhotoProcessing } from '../photos/load.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import { useObjectUrls } from '../photos/useObjectUrls.ts'
import { PlantLogError } from './entries.ts'
import {
  LOG_ENTRY_TYPES,
  LOG_TYPE_ICON,
  LOG_TYPE_LABEL,
  logTextLength,
  MAX_LOG_DESCRIPTION_LENGTH,
  MAX_LOG_TITLE_LENGTH,
  normalizeLogText,
  type LogEntry,
} from './model.ts'
import { saveLogEntry, SaveLogEntryError } from './save.ts'
import { usePlantLogServices } from './services.ts'
import { LOG_FORM_TEXT, LOG_SAVE_ERROR_TEXT } from './texts.ts'

export interface AddLogEntryDialogProps {
  plant: CollectionPlant
  userId: string
  /** Con conexión y la sesión confirmada: si no, no se puede guardar. */
  online: boolean
  /** Se cerró sin guardar (Cancelar, Escape, cerrar o volver). */
  onCancel: () => void
  /** Se guardó: el registro tal como lo devolvió la base. */
  onSaved: (entry: LogEntry) => void
}

type Bloom = 'unknown' | 'yes' | 'no'

type PhotoState =
  | { status: 'none' }
  | { status: 'preparing' }
  | { status: 'ready'; photo: ProcessedPhoto }

const BLOOM_VALUE: Record<Bloom, boolean | null> = {
  unknown: null,
  yes: true,
  no: false,
}

const BLOOM_OPTIONS: readonly { value: Bloom; label: string }[] = [
  { value: 'unknown', label: LOG_FORM_TEXT.bloomUnknown },
  { value: 'yes', label: LOG_FORM_TEXT.bloomYes },
  { value: 'no', label: LOG_FORM_TEXT.bloomNo },
]

/** Opción de un grupo de opción única con aspecto de tarjeta (radio nativo oculto). */
const CHOICE_CLASSES =
  'group flex cursor-pointer items-center rounded-md border-[1.5px] border-neutral-200 bg-neutral-0 text-md text-neutral-900 has-[:checked]:border-secondary-strong has-[:focus-visible]:outline-[2px] has-[:focus-visible]:outline-offset-[2px] has-[:focus-visible]:outline-secondary has-[:focus-visible]:outline-solid has-[:disabled]:cursor-not-allowed'

/**
 * «Nuevo registro de bitácora» (#267, maqueta del #263): diálogo modal en
 * escritorio y pantalla completa hasta 720 px, sobre Modal (foco atrapado,
 * Escape, resto de la página inerte y foco devuelto a «Añadir registro»).
 *
 * - Arriba, el nombre y el identificador del ejemplar («Cattleya adelinae ·
 *   CAT-012») para confirmar dónde se guarda; forman parte del título
 *   accesible, después de «Nuevo registro de bitácora».
 * - Tipo de actividad (obligatorio) y floración observada (Sin indicar, Sí,
 *   No): grupos de opción única con radios nativos (fieldset y legend; las
 *   flechas cambian la opción). Título (obligatorio, hasta 120), descripción
 *   (opcional, hasta 2000, con contador) y una foto opcional, preparada como
 *   las de la galería (sin metadatos, reducida y con miniatura).
 * - Al abrir, el foco va al primer tipo de actividad. Al enviar con errores,
 *   cada campo dice el suyo y el foco va al primero.
 * - Guardar: el botón queda ocupado mientras guarda (no hay dos envíos) y la
 *   clave de reintento, generada una vez al abrir, hace que un reintento no
 *   duplique el registro. Si falla, lo escrito y la foto siguen y se puede
 *   reintentar.
 * - Cerrar con algo escrito o una foto elegida pregunta antes de descartar
 *   (ConfirmDialog, «Seguir escribiendo» primero); sin nada, cierra.
 * - Las acciones van al final del formulario, sin barras fijas: con el
 *   teclado del celular abierto se llega a ellas desplazando el diálogo.
 */
export function AddLogEntryDialog({
  plant,
  userId,
  online,
  onCancel,
  onSaved,
}: AddLogEntryDialogProps) {
  const services = usePlantLogServices()
  const baseId = useId()
  const typeErrorId = `${baseId}-tipo-error`
  const descriptionId = `${baseId}-descripcion`
  const descriptionHintId = `${baseId}-descripcion-contador`
  const descriptionErrorId = `${baseId}-descripcion-error`
  const photoHintId = `${baseId}-foto-ayuda`
  const photoErrorId = `${baseId}-foto-error`
  const offlineId = `${baseId}-sin-conexion`
  const firstType = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const photoButton = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [type, setType] = useState<PlantLogEntryType | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [bloom, setBloom] = useState<Bloom>('unknown')
  const [photo, setPhoto] = useState<PhotoState>({ status: 'none' })
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [photoStatus, setPhotoStatus] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  // Un intento quedó en duda (quizá se guardó): desde entonces no se borra la
  // foto subida (ver save.ts).
  const uncertain = useRef(false)
  const preparing = useRef<AbortController | null>(null)
  useEffect(() => () => preparing.current?.abort(), [])

  const thumbnailBlobs =
    photo.status === 'ready' ? [photo.photo.thumbnail.blob] : []
  const thumbnailUrls = useObjectUrls(thumbnailBlobs)
  const thumbnailUrl =
    photo.status === 'ready'
      ? thumbnailUrls.get(photo.photo.thumbnail.blob)
      : undefined

  const titleLength = logTextLength(title)
  const descriptionLength = logTextLength(description)
  const errors = {
    type: type === null ? LOG_FORM_TEXT.typeRequired : null,
    title:
      titleLength === 0
        ? LOG_FORM_TEXT.titleRequired
        : titleLength > MAX_LOG_TITLE_LENGTH
          ? LOG_FORM_TEXT.titleTooLong(MAX_LOG_TITLE_LENGTH)
          : null,
    description:
      descriptionLength > MAX_LOG_DESCRIPTION_LENGTH
        ? LOG_FORM_TEXT.descriptionTooLong(MAX_LOG_DESCRIPTION_LENGTH)
        : null,
  }
  const shown = checked
    ? errors
    : { type: null, title: null, description: null }
  const dirty =
    type !== null ||
    title.trim() !== '' ||
    description.trim() !== '' ||
    bloom !== 'unknown' ||
    photo.status !== 'none'

  // Descartar: primero se cierra la confirmación (el foco vuelve a este
  // diálogo) y, ya pintado, este.
  useEffect(() => {
    if (discarding) onCancel()
  }, [discarding, onCancel])

  const requestClose = () => {
    if (busy) return
    if (dirty) setConfirmDiscard(true)
    else onCancel()
  }

  const choosePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Vaciar el campo: elegir el mismo archivo otra vez vuelve a avisar.
    event.target.value = ''
    if (!file) return
    preparing.current?.abort()
    const controller = new AbortController()
    preparing.current = controller
    setPhotoError(null)
    setPhoto({ status: 'preparing' })
    setPhotoStatus(LOG_FORM_TEXT.preparing)
    try {
      const { processPhoto, PhotoProcessingError } = await loadPhotoProcessing()
      try {
        const processed = await processPhoto(file, {
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setPhoto({ status: 'ready', photo: processed })
        setPhotoStatus(LOG_FORM_TEXT.photoPrepared)
      } catch (error) {
        if (controller.signal.aborted) return
        setPhoto({ status: 'none' })
        setPhotoStatus('')
        setPhotoError(
          error instanceof PhotoProcessingError
            ? error.message
            : 'No se pudo preparar la foto. Vuelve a intentarlo.',
        )
      }
    } catch {
      if (controller.signal.aborted) return
      setPhoto({ status: 'none' })
      setPhotoStatus('')
      setPhotoError(LOG_FORM_TEXT.photoModuleFailed)
    }
  }

  const removePhoto = () => {
    preparing.current?.abort()
    setPhoto({ status: 'none' })
    setPhotoError(null)
    setPhotoStatus(LOG_FORM_TEXT.photoRemoved)
    photoButton.current?.focus()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !online || photo.status === 'preparing') return
    setChecked(true)
    if (errors.type) {
      firstType.current?.focus()
      return
    }
    if (errors.title) {
      titleRef.current?.focus()
      return
    }
    if (errors.description) {
      descriptionRef.current?.focus()
      return
    }
    if (type === null) return
    setBusy(true)
    setSaveError(null)
    try {
      const entry = await saveLogEntry({
        userId,
        plantId: plant.id,
        draft: {
          type,
          title: title.trim(),
          description: normalizeLogText(description),
          inBloom: BLOOM_VALUE[bloom],
        },
        photo: photo.status === 'ready' ? photo.photo : null,
        idempotencyKey,
        entries: services.entries,
        storage: services.storage,
        keepUploadOnFailure: uncertain.current,
      })
      setBusy(false)
      onSaved(entry)
    } catch (error) {
      setBusy(false)
      if (error instanceof SaveLogEntryError) {
        if (error.uncertain) uncertain.current = true
        setSaveError(
          error.failure instanceof PlantLogError
            ? LOG_SAVE_ERROR_TEXT[error.failure.reason]
            : error.failure.message,
        )
      } else {
        setSaveError(LOG_SAVE_ERROR_TEXT.failed)
      }
    }
  }

  const heading = (
    <>
      <span>{LOG_FORM_TEXT.title}</span>
      <span className="sr-only">: </span>
      <span className="order-first flex flex-wrap items-baseline gap-x-space-2 font-body text-md font-normal text-neutral-700">
        {plant.displayNameIsScientific ? (
          <span className="font-display text-lg italic text-neutral-900">
            <ScientificName name={plant.displayName} />
          </span>
        ) : (
          <span className="text-neutral-900">{plant.displayName}</span>
        )}
        {plant.code !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span className="sr-only">, </span>
            <span>{plant.code}</span>
          </>
        )}
      </span>
    </>
  )

  return (
    <Modal
      title={heading}
      busy={busy}
      initialFocus={() => firstType.current?.focus()}
      onCancel={requestClose}
      overlayClassName="fixed inset-[0] z-50 flex items-center justify-center bg-neutral-900/40 p-space-4 publico-estrecho:p-[0]"
      panelClassName="relative flex max-h-[100%] w-[100%] max-w-[560px] flex-col gap-space-4 overflow-y-auto rounded-lg bg-neutral-0 p-space-5 pb-[calc(var(--space-5)_+_env(safe-area-inset-bottom))] shadow-card publico-estrecho:h-[100%] publico-estrecho:max-w-none publico-estrecho:rounded-none"
      titleClassName="flex flex-col gap-space-1 pr-[48px] font-display text-display font-semibold text-neutral-900 publico-estrecho:pr-[0] publico-estrecho:text-xl"
    >
      <button
        type="button"
        className="absolute top-space-4 right-space-4 flex size-[44px] cursor-pointer items-center justify-center rounded-md text-neutral-900 hover:bg-neutral-50 aria-disabled:cursor-not-allowed publico-estrecho:hidden [&_svg]:size-[24px]"
        aria-label={LOG_FORM_TEXT.close}
        aria-disabled={busy || undefined}
        onClick={requestClose}
      >
        <Icon name="x" />
      </button>
      <button
        type="button"
        className="orki-link order-first hidden min-h-[44px] cursor-pointer self-start publico-estrecho:inline-flex"
        aria-disabled={busy || undefined}
        onClick={requestClose}
      >
        <Icon name="arrow-left" />
        {LOG_FORM_TEXT.back}
      </button>

      <form
        className="flex flex-col gap-space-4"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <fieldset
          className="flex flex-col gap-space-2"
          aria-describedby={shown.type ? typeErrorId : undefined}
        >
          <legend className="orki-field__label mb-space-2">
            {LOG_FORM_TEXT.type}
          </legend>
          <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-space-3">
            {LOG_ENTRY_TYPES.map((value, index) => {
              const selected = type === value
              return (
                <label
                  key={value}
                  className={`${CHOICE_CLASSES} min-h-[56px] gap-space-3 px-space-4 py-space-2 has-[:checked]:bg-secondary-soft has-[:checked]:font-semibold publico-estrecho:px-space-3 [&_svg]:size-[24px] [&_svg]:flex-none`}
                >
                  <input
                    ref={index === 0 ? firstType : undefined}
                    type="radio"
                    name={`${baseId}-tipo`}
                    value={value}
                    className="sr-only"
                    checked={selected}
                    disabled={busy}
                    onChange={() => setType(value)}
                  />
                  <span
                    className={selected ? 'text-secondary-strong' : undefined}
                  >
                    <Icon
                      name={selected ? 'circle-check' : LOG_TYPE_ICON[value]}
                    />
                  </span>
                  {LOG_TYPE_LABEL[value]}
                </label>
              )
            })}
          </div>
          {shown.type && (
            <span id={typeErrorId} className="orki-field__error">
              <Icon name="triangle-alert" />
              {shown.type}
            </span>
          )}
        </fieldset>

        <TextField
          ref={titleRef}
          label={LOG_FORM_TEXT.entryTitle}
          value={title}
          disabled={busy}
          autoComplete="off"
          error={shown.title}
          hint={
            titleLength > MAX_LOG_TITLE_LENGTH - 20
              ? LOG_FORM_TEXT.titleHint(titleLength, MAX_LOG_TITLE_LENGTH)
              : undefined
          }
          onChange={(event) => setTitle(event.target.value)}
        />

        <div className="orki-field">
          <label className="orki-field__label" htmlFor={descriptionId}>
            {LOG_FORM_TEXT.description}
          </label>
          <textarea
            ref={descriptionRef}
            id={descriptionId}
            className="orki-field__input resize-y"
            rows={3}
            value={description}
            disabled={busy}
            aria-invalid={shown.description ? true : undefined}
            aria-describedby={
              [shown.description && descriptionErrorId, descriptionHintId]
                .filter(Boolean)
                .join(' ') || undefined
            }
            onChange={(event) => setDescription(event.target.value)}
          />
          {shown.description && (
            <span className="orki-field__error" id={descriptionErrorId}>
              <Icon name="triangle-alert" />
              {shown.description}
            </span>
          )}
          <span className="orki-field__hint" id={descriptionHintId}>
            {LOG_FORM_TEXT.count(descriptionLength, MAX_LOG_DESCRIPTION_LENGTH)}
          </span>
        </div>

        <div className="flex flex-col gap-space-2">
          <div className="flex items-center gap-space-3">
            {photo.status === 'ready' && thumbnailUrl && (
              <img
                src={thumbnailUrl}
                alt={LOG_FORM_TEXT.photoPreview}
                width={96}
                height={96}
                className="size-[96px] flex-none rounded-md border border-neutral-200 object-cover"
              />
            )}
            <div className="flex min-w-[0] flex-wrap gap-space-3">
              <Button
                ref={photoButton}
                icon="camera"
                aria-disabled={
                  busy || photo.status === 'preparing' || undefined
                }
                aria-describedby={
                  [photoError && photoErrorId, photoHintId]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onClick={() => {
                  if (!busy && photo.status !== 'preparing') {
                    fileInput.current?.click()
                  }
                }}
              >
                {photo.status === 'ready'
                  ? LOG_FORM_TEXT.changePhoto
                  : photo.status === 'preparing'
                    ? LOG_FORM_TEXT.preparing
                    : LOG_FORM_TEXT.addPhoto}
              </Button>
              {photo.status === 'ready' && (
                <Button
                  icon="trash-2"
                  aria-disabled={busy || undefined}
                  onClick={() => {
                    if (!busy) removePhoto()
                  }}
                >
                  {LOG_FORM_TEXT.removePhoto}
                </Button>
              )}
            </div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void choosePhoto(event)}
          />
          {photoError && (
            <span id={photoErrorId} className="orki-field__error">
              <Icon name="triangle-alert" />
              {photoError}
            </span>
          )}
          <span id={photoHintId} className="orki-field__hint">
            {LOG_FORM_TEXT.photoHint}
          </span>
          <p role="status" className="sr-only">
            {photoStatus}
          </p>
        </div>

        <fieldset className="flex flex-col gap-space-2">
          <legend className="orki-field__label mb-space-2">
            {LOG_FORM_TEXT.bloom}
          </legend>
          <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-space-2">
            {BLOOM_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`${CHOICE_CLASSES} min-h-[48px] justify-center gap-space-2 px-space-2 whitespace-nowrap has-[:checked]:bg-secondary-strong has-[:checked]:font-semibold has-[:checked]:text-neutral-0`}
              >
                <input
                  type="radio"
                  name={`${baseId}-floracion`}
                  value={option.value}
                  className="sr-only"
                  checked={bloom === option.value}
                  disabled={busy}
                  onChange={() => setBloom(option.value)}
                />
                <span
                  aria-hidden="true"
                  className="grid size-[20px] flex-none place-items-center rounded-pill border-[2px] border-current"
                >
                  <span className="size-[10px] rounded-pill bg-current opacity-0 group-has-[:checked]:opacity-100" />
                </span>
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <p className="flex items-center gap-space-2 rounded-md bg-neutral-50 p-space-3 text-sm text-neutral-900 [&_svg]:size-[20px] [&_svg]:flex-none">
          <Icon name="clock" />
          {LOG_FORM_TEXT.automaticDate}
        </p>

        {!online && (
          <p
            id={offlineId}
            className="flex items-start gap-space-2 rounded-md bg-neutral-50 p-space-3 text-sm text-neutral-900 [&_svg]:mt-[2px] [&_svg]:size-[16px] [&_svg]:flex-none"
          >
            <Icon name="cloud-off" />
            {LOG_FORM_TEXT.offline}
          </p>
        )}

        {saveError && (
          <p role="alert" className="orki-viewer__error">
            <Icon name="triangle-alert" />
            {saveError}
          </p>
        )}

        <div className="flex gap-space-3 border-t border-neutral-200 pt-space-4">
          <Button
            className="flex-[1]"
            aria-disabled={busy || undefined}
            onClick={requestClose}
          >
            {LOG_FORM_TEXT.cancel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="flex-[2]"
            aria-disabled={
              busy || !online || photo.status === 'preparing' || undefined
            }
            aria-describedby={online ? undefined : offlineId}
          >
            {busy ? LOG_FORM_TEXT.saving : LOG_FORM_TEXT.save}
          </Button>
        </div>
      </form>

      {confirmDiscard && (
        <ConfirmDialog
          title={LOG_FORM_TEXT.discardTitle}
          description={LOG_FORM_TEXT.discardDescription}
          confirmLabel={LOG_FORM_TEXT.discardConfirm}
          cancelLabel={LOG_FORM_TEXT.discardStay}
          confirmVariant="danger"
          initialFocus="cancel"
          onConfirm={() => {
            setConfirmDiscard(false)
            setDiscarding(true)
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </Modal>
  )
}
