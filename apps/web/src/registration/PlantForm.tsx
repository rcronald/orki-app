import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import { normalizeSearchText } from '../collection/normalize.ts'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx'
import { FormActions, FormLayout } from '../components/ui/FormLayout.tsx'
import { galleryPhotoLabel } from '../components/ui/gallery-label.ts'
import { Icon } from '../components/ui/Icon.tsx'
import {
  PhotoGallery,
  type GalleryPhoto,
} from '../components/ui/PhotoGallery.tsx'
import type {
  CatalogSearchFunction,
  GenusSearchResult,
  SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { localDateString } from '../lib/localDate.ts'
import type {
  NewPlantPhoto,
  PlantPhotosProgress,
  UploadPlantPhotosResult,
} from '../photos/gallery.ts'
import { MAX_PLANT_PHOTOS } from '../photos/paths.ts'
import { PhotoStorageError, photoStorageErrorFrom } from '../photos/storage.ts'
import { useTouchDevice } from '../photos/useCoarsePointer.ts'
import { useObjectUrls } from '../photos/useObjectUrls.ts'
import { photoVersionFor } from '../photos/upload.ts'
import { canRetryUpload } from '../photos/usePhotoUpload.ts'
import { EDIT_LEAVE_TEXT } from '../editing/texts.ts'
import { useLeaveGuard } from '../editing/useLeaveGuard.tsx'
import { PATHS, signInPathFor } from '../routes/paths.ts'
import { FORM_CHIP_CLASSES } from './ChoiceField.tsx'
import {
  clearPlantDraft,
  readPlantDrafts,
  writePlantDraft,
  type PlantDraft,
} from './draft.ts'
import { decideStart, startName } from './draft-choice.ts'
import { DraftChoice, DraftNameText } from './DraftChoice.tsx'
import {
  appDraftPhotoBackend,
  clearDraftPhotos,
  pruneDraftPhotos,
  readDraftPhotoCounts,
  readDraftPhotos,
  writeDraftPhotos,
  type DraftPhotoBackend,
} from './draft-photo.ts'
import { DuplicateNotice } from './DuplicateNotice.tsx'
import {
  hasDetailValues,
  PLANT_DETAIL_FIELDS,
  PLANT_FORM_FIELDS,
} from './field-order.ts'
import {
  initialPlantFormValues,
  isPendingName,
  isPlantFormDirty,
  plantFormReducer,
  toPlantInsert,
  validatePlantForm,
  type FormGenus,
  type FormSpecies,
  type NewPlantInsert,
  type PlantFormValues,
} from './form-state.ts'
import { GenusField, type QuickGeneraState } from './GenusField.tsx'
import { NameField, type NameResolution } from './NameField.tsx'
import { PendingPhotoNotice } from './PendingPhotoNotice.tsx'
import {
  clearPendingUpload,
  listPendingUploads,
  writePendingUpload,
  type PendingUpload,
  type PendingUploadPhoto,
} from './pending-upload.ts'
import { PendingUploadsNotice } from './PendingUploadsNotice.tsx'
import { plantSaveErrorFrom, type PlantSaveError } from './save-plant.ts'
import {
  DateAndPlaceRow,
  PhotoPrepareErrors,
  PlantDetailsSection,
  PlantTypeField,
} from './PlantFields.tsx'
import { PENDING_UPLOAD_TEXT, PLANT_FORM_TEXT } from './texts.ts'
import { SpeciesPreview, type LoadReferencePhoto } from './SpeciesPreview.tsx'
import { useDeducedGenus } from './useDeducedGenus.ts'
import { usePlantFieldFocus } from './usePlantFieldFocus.ts'
import { useQuickGenera } from './useQuickGenera.ts'
import {
  isNewEntry,
  newPhotoEntry,
  toGalleryPhoto,
  usePhotoSelection,
  type NewPhotoEntry,
} from './usePhotoEntries.ts'

/** Opciones con las que el formulario sube las fotos de una planta guardada. */
export interface PlantPhotosUploadOptions {
  userId: string
  plantId: string
  signal: AbortSignal
  onProgress: (progress: PlantPhotosProgress) => void
  /** La planta cambió de foto principal (releída, para la colección). */
  onPlantUpdated: (plant: CollectionPlant) => void
}

/**
 * De dónde saca el formulario los datos y dónde sube las fotos. Deben ser
 * estables entre pintados (funciones de módulo).
 */
export interface PlantFormBaseServices {
  searchSpecies: CatalogSearchFunction<SpeciesSearchResult>
  searchGenera: CatalogSearchFunction<GenusSearchResult>
  /** Géneros de acceso rápido; se rechaza con CatalogSearchError. */
  loadQuickGenera: () => Promise<readonly FormGenus[]>
  /**
   * La foto de referencia de la especie elegida (#234), para «Así es esta
   * especie»; sin ella, no se muestra.
   */
  loadReferencePhoto?: LoadReferencePhoto
  /**
   * Sube las fotos a la planta ya guardada (uploadPlantPhotos): no duplica
   * las que ya subió un intento anterior.
   */
  uploadPhotos: (
    photos: readonly NewPlantPhoto[],
    options: PlantPhotosUploadOptions,
  ) => Promise<UploadPlantPhotosResult>
}

/**
 * Servicios del registro. La pantalla de registro pasa los de Supabase; la
 * página de muestra, unos con datos fijos.
 */
export interface PlantFormServices extends PlantFormBaseServices {
  /** Inserta la planta; se rechaza con PlantSaveError. */
  savePlant: (insert: NewPlantInsert) => Promise<CollectionPlant>
}

interface PlantFormCommonProps {
  /**
   * Si hay conexión (useOnlineStatus). Sin ella no se envía nada ni se busca
   * en el catálogo; con un usuario (draftUserId), lo demás se sigue
   * completando y queda en el borrador del dispositivo (#296). Sin usuario,
   * el formulario se desactiva.
   */
  online: boolean
  /**
   * La sesión es la recordada en el dispositivo, sin que Clerk la confirme
   * (useReadOnly, #120): como sin conexión, el envío espera, pero con red se
   * sigue buscando en el catálogo (es público).
   */
  sessionUnverified?: boolean
  /**
   * El registro terminó: la planta está guardada y sus fotos subidas (o la
   * persona eligió seguir sin las que fallaron). Para salir del formulario.
   * `photos` es cuántas fotos quedaron guardadas con la planta.
   */
  onSaved: (
    plant: CollectionPlant,
    outcome: { changed: boolean; photos: number },
  ) => void
  /**
   * La fila de la planta cambió en la base: al guardarla y, después, al
   * cambiar su foto principal. Para reflejarla en la colección (upsertPlant)
   * en cuanto existe, aunque una foto falle o la persona salga a mitad.
   */
  onPlantStored?: (plant: CollectionPlant) => void
  /**
   * Nombre con el que empieza el registro, como si se hubiera escrito en el
   * campo: lo buscado en "¿Ya la tengo?" (#123, ?nombre=). Si hay un borrador
   * guardado con otro nombre, la persona elige (#296, draft-choice.ts); al
   * descartar el borrador, el formulario vuelve a empezar con este nombre.
   */
  initialName?: string
  /**
   * Especie del catálogo con la que empieza el registro, ya elegida como si se
   * hubiera escogido en el autocompletado: «Registrar esta especie» de la
   * ficha del catálogo (#232). Gana a initialName y, como él, se ofrece junto
   * a un borrador de otra cosa (#296) y vuelve al descartarlo.
   */
  initialSpecies?: FormSpecies | null
  /**
   * Llevar el foco a «Nombre» al montarse (#280): la pantalla de registro, como
   * «¿Ya la tengo?» con su campo. La página de muestra no lo pide.
   */
  autoFocusName?: boolean
  /** Dónde se guardan las fotos pendientes del borrador; por defecto, IndexedDB. */
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
   * Usuario activo (id de Clerk): dueño de las fotos y de los borradores. Lo
   * escrito y las fotos se guardan en el dispositivo y se recuperan al volver
   * a abrir el formulario (draft.ts y draft-photo.ts); sin usuario, no hay
   * borrador. Si cambia, hay que volver a montar el formulario (key), porque
   * los borradores se leen al montarse.
   */
  draftUserId?: string | null
  /** Reloj, para las pruebas. Por defecto, la hora del dispositivo. */
  now?: () => Date
  /**
   * «Tomar foto»: auto (por defecto) solo en dispositivos táctiles; show y
   * hide lo fuerzan (pruebas, página de muestra).
   */
  camera?: 'auto' | 'show' | 'hide'
}

/**
 * Registrar una planta. La edición (#16, rediseñada en el #266) tiene su
 * propio formulario (editing/EditPlantForm.tsx), que reutiliza los campos,
 * el reductor y la validación de este.
 */
export type PlantFormProps = PlantFormCommonProps & {
  services: PlantFormServices
}

const deviceNow = () => new Date()

/** El formulario vacío con `name` ya escrito en el nombre (si lo hay). */
function withName(values: PlantFormValues, name: string): PlantFormValues {
  return name === '' ? values : { ...values, name }
}

/** El formulario con la especie inicial elegida o, si no hay, con el nombre. */
function withStart(
  values: PlantFormValues,
  name: string,
  species: FormSpecies | null,
): PlantFormValues {
  return species === null
    ? withName(values, name)
    : plantFormReducer(values, { type: 'speciesSelected', species })
}

/** Los géneros de la colección (sin repetir, por nombre), para usarlos sin conexión. */
function generaOf(
  plants: readonly CollectionPlant[] | null,
): readonly FormGenus[] {
  if (plants === null) return []
  const byId = new Map<string, FormGenus>()
  for (const plant of plants) {
    byId.set(plant.genus.id, { id: plant.genus.id, name: plant.genus.name })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/**
 * Si `after` es `before` con solo su nombre enlazado a una especie del
 * catálogo (el mismo texto, con la especie, su género y su tipo).
 */
function isOnlyLinked(
  before: PlantFormValues,
  after: PlantFormValues,
): boolean {
  if (before.species !== null || after.species === null) return false
  const same = (field: keyof PlantFormValues) => before[field] === after[field]
  return (
    normalizeSearchText(before.name) === normalizeSearchText(after.name) &&
    (
      [
        'acquiredOn',
        'origin',
        'location',
        'nickname',
        'flowerColor',
        'photoInBloom',
      ] as const
    ).every(same)
  )
}

/** Si hay algo escrito dentro de "Más detalles". */
function hasDetails(values: PlantFormValues): boolean {
  return hasDetailValues(values) || values.photoInBloom
}

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'error'; error: PlantSaveError }

/** Las fotos después de guardar la planta: subiendo, o con algún fallo. */
type PhotoPhase =
  | { status: 'working' }
  | {
      status: 'failed'
      /** El primer motivo de fallo. */
      error: PhotoStorageError
    }

function newPlantId(): string {
  return crypto.randomUUID()
}

/** Otro borrador guardado, que se puede continuar en vez del que está abierto. */
interface OtherDraft {
  draft: PlantDraft
  photos: number
}

/**
 * Aviso discreto de borrador recuperado, con "Descartar borrador", y de los
 * otros borradores guardados (#296), con «Continuar ese borrador». La región
 * role="status" se pinta vacía y el texto llega en el pintado siguiente, para
 * que el lector de pantalla lo anuncie.
 */
function DraftNotice({
  restored,
  others,
  onDiscard,
  onSwitch,
}: {
  restored: boolean
  /** Vacío mientras se guarda: entonces no se cambia de borrador. */
  others: readonly OtherDraft[]
  onDiscard: () => void
  onSwitch: (draft: PlantDraft) => void
}) {
  const [visible, setVisible] = useState(false)
  const baseId = useId()
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div role="status">
      {visible && (restored || others.length > 0) && (
        <div className="flex flex-col gap-space-2 rounded-lg bg-neutral-50 px-space-4 py-space-2">
          {restored && (
            <div className="flex flex-wrap items-center justify-between gap-space-2">
              <p className="text-sm text-neutral-900">
                {PLANT_FORM_TEXT.draftRestored}
              </p>
              <Button className="flex-none" onClick={onDiscard}>
                {PLANT_FORM_TEXT.draftDiscard}
              </Button>
            </div>
          )}
          {others.map(({ draft, photos }) => {
            const textId = `${baseId}-${draft.plantId}`
            return (
              <div
                key={draft.plantId}
                className="flex flex-wrap items-center justify-between gap-space-2"
              >
                <p
                  id={textId}
                  className="text-sm text-neutral-900 [overflow-wrap:anywhere]"
                >
                  {PLANT_FORM_TEXT.otherDraftBefore}
                  <DraftNameText draft={draft} />
                  {PLANT_FORM_TEXT.draftPhotos(photos)}
                  {PLANT_FORM_TEXT.otherDraftAfter}
                </p>
                <Button
                  className="flex-none"
                  aria-describedby={textId}
                  onClick={() => onSwitch(draft)}
                >
                  {PLANT_FORM_TEXT.otherDraftContinue}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Qué muestra el registro: la elección (#296) o el formulario con un borrador. */
type Selection =
  | { kind: 'choice' }
  | {
      kind: 'form'
      /** El borrador con el que empieza; null, con lo que llega (o vacío). */
      draft: PlantDraft | null
      /** Para volver a montar el formulario al cambiar de borrador. */
      key: string
      /** Se llegó eligiendo (la elección o «Continuar ese borrador»). */
      chosen: boolean
    }

/**
 * Registro de una planta: decide con qué empieza (draft-choice.ts, #296) y
 * monta el formulario (PlantFormBody) con ese borrador. Si hay un borrador de
 * otra cosa que lo que llega de la ficha del catálogo o de «¿Ya la tengo?»,
 * primero se elige (DraftChoice). Los borradores se leen al montarse; cambiar
 * de borrador vuelve a montar el formulario.
 */
export function PlantForm(props: PlantFormProps) {
  const {
    draftUserId = null,
    initialName = '',
    initialSpecies = null,
    photoDraftBackend = appDraftPhotoBackend(),
    now = deviceNow,
  } = props
  const readDrafts = () =>
    draftUserId === null ? [] : readPlantDrafts(draftUserId, now())
  const [drafts, setDrafts] = useState<readonly PlantDraft[]>(readDrafts)
  const [selection, setSelection] = useState<Selection>(() => {
    const decision = decideStart(drafts, {
      species: initialSpecies,
      name: initialName,
    })
    return decision.kind === 'choice'
      ? { kind: 'choice' }
      : {
          kind: 'form',
          draft: decision.draft,
          key: decision.draft?.plantId ?? 'nuevo',
          chosen: false,
        }
  })
  const fresh = useRef(0)

  // Las fotos que ya no son de ningún borrador (o de otra cuenta, o
  // caducadas) se borran al abrir el registro.
  const [initialDrafts] = useState(drafts)
  useEffect(() => {
    if (draftUserId === null) return
    void pruneDraftPhotos(photoDraftBackend, draftUserId, {
      plantIds: initialDrafts.map((draft) => draft.plantId),
      now: now(),
    })
  }, [draftUserId, photoDraftBackend, initialDrafts, now])

  // Cuántas fotos tiene cada borrador, para nombrarlos.
  const [photoCounts, setPhotoCounts] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  )
  useEffect(() => {
    if (draftUserId === null || drafts.length === 0) return
    let active = true
    void readDraftPhotoCounts(photoDraftBackend, draftUserId, {
      plantIds: drafts.map((draft) => draft.plantId),
      now: now(),
    }).then((counts) => {
      if (active) setPhotoCounts(counts)
    })
    return () => {
      active = false
    }
  }, [draftUserId, photoDraftBackend, drafts, now])

  const openDraft = (plantId: string) => {
    const all = readDrafts()
    setDrafts(all)
    const draft = all.find((item) => item.plantId === plantId) ?? null
    fresh.current += 1
    setSelection({
      kind: 'form',
      draft,
      key: draft?.plantId ?? `nuevo-${String(fresh.current)}`,
      chosen: true,
    })
  }

  if (selection.kind === 'choice') {
    return (
      <DraftChoice
        drafts={drafts}
        photoCounts={photoCounts}
        incomingName={startName({ species: initialSpecies, name: initialName })}
        incomingIsSpecies={initialSpecies !== null}
        onContinue={(draft) => openDraft(draft.plantId)}
        onRegister={() => {
          // Ningún borrador se toca: siguen guardados para retomarlos.
          setDrafts(readDrafts())
          fresh.current += 1
          setSelection({
            kind: 'form',
            draft: null,
            key: `nuevo-${String(fresh.current)}`,
            chosen: true,
          })
        }}
        onDiscard={(draft) => {
          if (draftUserId === null) return
          clearPlantDraft(draftUserId, draft.plantId)
          void clearDraftPhotos(photoDraftBackend, draftUserId, draft.plantId)
          setDrafts(readDrafts())
        }}
      />
    )
  }

  const current = selection.draft?.plantId
  const others = drafts
    .filter((draft) => draft.plantId !== current)
    .map((draft) => ({
      draft,
      photos: photoCounts.get(draft.plantId) ?? 0,
    }))
  return (
    <PlantFormBody
      key={selection.key}
      {...props}
      draft={selection.draft}
      otherDrafts={others}
      onSwitchDraft={(draft) => openDraft(draft.plantId)}
      focusNameOnMount={selection.chosen}
    />
  )
}

interface PlantFormBodyProps extends PlantFormProps {
  /** El borrador con el que empieza; null, con lo que llega (o vacío). */
  draft: PlantDraft | null
  /** Los demás borradores guardados, que se pueden continuar en su lugar. */
  otherDrafts: readonly OtherDraft[]
  /** Cambiar al borrador `draft` (lo que se escribió aquí ya está guardado). */
  onSwitchDraft: (draft: PlantDraft) => void
  /**
   * Se monta porque la persona eligió con qué seguir (#296): con
   * autoFocusName, el foco va a «Nombre» aunque estuviera en otro sitio.
   */
  focusNameOnMount: boolean
}

/**
 * Formulario de registro de una planta (#85, rediseñado en el #221): los
 * cuatro campos obligatorios (nombre, género, tipo y fecha de adquisición),
 * el aviso de duplicado (#88), el origen, la galería de 0 a 6 fotos y la
 * sección plegable "Más detalles" (#86). En escritorio, a dos columnas (los
 * datos a la izquierda y la galería a la derecha); en el celular, una sola,
 * con la galería después del origen. Todo el estado de los campos vive en un
 * reductor (form-state.ts) y el de las fotos en usePhotoEntries; aquí van la
 * validación al enviar, el guardado y sus errores, la subida de las fotos y el
 * borrador en el dispositivo (draft.ts y draft-photo.ts).
 *
 * Borrador: cada cambio se guarda; si el formulario vuelve a estar vacío, se
 * borra. Se recupera al montarse (PlantForm decide cuál, #296), con un aviso y
 * "Descartar borrador". Se borra al guardar con éxito, al descartarlo y al
 * salir con "Cancelar" (que avisa antes de perder lo escrito). Salir de otra
 * forma (otra pestaña de la app, cerrar o recargar) lo conserva: es lo que
 * protege de una recarga. Todo eso toca solo el borrador de este formulario
 * (su id de planta): los demás borradores guardados siguen ahí.
 *
 * Fotos (#221): primero se guarda la planta y después se suben las fotos
 * (uploadPlantPhotos), con el progreso de cada una en su miniatura. Si alguna
 * falla, la planta ya existe: el formulario se queda con las fotos, dice
 * cuáles fallaron y deja reintentar solo esas (la API no duplica las que ya
 * subió) o continuar sin ellas.
 *
 * Fotos por subir (#284): al guardar la planta, sus fotos pasan del borrador a
 * las «fotos por subir» de esa planta (pending-upload.ts) y cada una que se
 * sube se quita de ahí. Mientras quede alguna sin subir, salir pide
 * confirmación (useLeaveGuard: enlaces de la app, «atrás», cerrar o recargar
 * la pestaña); si se sale igual, se recarga o se pierde la conexión, la ficha
 * de la planta las ofrece para subirlas o descartarlas, y este formulario
 * avisa de ellas al volver a abrirlo.
 */
function PlantFormBody(props: PlantFormBodyProps) {
  const {
    services,
    online,
    onSaved,
    onCancel,
    onPlantStored,
    knownPlants = null,
    draftUserId = null,
    initialName = '',
    initialSpecies = null,
    autoFocusName = false,
    photoDraftBackend = appDraftPhotoBackend(),
    now = deviceNow,
    camera = 'auto',
    otherDrafts,
    onSwitchDraft,
    focusNameOnMount,
    sessionUnverified = false,
  } = props
  // Lo que se fija una sola vez al montarse: el formulario vacío de hoy y el
  // borrador con el que empieza, si lo hay.
  const [start] = useState(() => {
    const fresh = initialPlantFormValues(localDateString(now()))
    const draft = draftUserId === null ? null : props.draft
    const prefilled = withStart(fresh, initialName, initialSpecies)
    return { fresh, draft, values: draft?.values ?? prefilled }
  })
  // El formulario vacío: la referencia de "hay cambios".
  const initial = start.fresh
  const text = PLANT_FORM_TEXT
  const draftOwner = draftUserId
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
  const [loadedGenera, retryQuickGenera] = useQuickGenera(
    services.loadQuickGenera,
    online,
  )
  // Sin conexión, si los géneros frecuentes no cargaron (o aún no se sabe:
  // la petición tarda en fallar), los de la colección, que están en el
  // dispositivo, para poder elegir uno igual (#296).
  const collectionGenera = generaOf(knownPlants)
  const quickGenera: QuickGeneraState =
    ((!online && loadedGenera.status === 'loading') ||
      (loadedGenera.status === 'error' && loadedGenera.reason === 'offline')) &&
    collectionGenera.length > 0
      ? { status: 'ready', genera: collectionGenera }
      : loadedGenera

  // Si el envío tiene que esperar (#296): sin conexión o con la sesión sin
  // confirmar. Con un usuario se sigue completando el borrador; sin él, el
  // formulario se desactiva como antes.
  const blocked = !online || sessionUnverified
  const keepsDraft = draftUserId !== null
  // Qué hay del borrador en el dispositivo, para el aviso sin conexión.
  const [stored, setStored] = useState<'none' | 'saved' | 'failed'>(
    props.draft !== null ? 'saved' : 'none',
  )

  // Fotos ----------------------------------------------------------------
  // Lo que se anuncia (role="status", solo para el lector: la galería ya lo
  // muestra) y, aparte y a la vista, cuántas fotos quedaron fuera de la
  // última selección.
  const {
    photos,
    photoStatus,
    setPhotoStatus,
    leftOutNotice,
    setLeftOutNotice,
    prepareErrors,
    setPrepareErrors,
  } = usePhotoSelection(text)
  const { entries } = photos
  // Si la persona ya eligió o quitó una foto: las del borrador, que llegan
  // después (IndexedDB es asíncrono), ya no las sustituyen; y desde entonces
  // cada cambio de las fotos se guarda en el borrador.
  const photosTouched = useRef(false)
  const preparing = entries.some((entry) => entry.kind === 'preparing')
  const photoCount = entries.length
  const newPhotos = entries.filter(isNewEntry)

  // Planta ya guardada cuyas fotos se están subiendo (o quitando) o no se
  // pudieron subir.
  const [registered, setRegistered] = useState<CollectionPlant | null>(null)
  const [phase, setPhase] = useState<PhotoPhase>({ status: 'working' })
  const latestPlant = useRef<CollectionPlant | null>(null)
  const uploadController = useRef<AbortController | null>(null)
  useEffect(() => () => uploadController.current?.abort(), [])
  // Si el formulario sigue montado: tras salir, una subida que termina ya no
  // lleva a ningún sitio.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // Las fotos por subir de la planta guardada (#284), por clave de la foto,
  // y si quedaron en el dispositivo (para el aviso al salir).
  const pendingRef = useRef<{
    plant: CollectionPlant
    photos: Map<string, PendingUploadPhoto>
  } | null>(null)
  const [pendingKept, setPendingKept] = useState(false)
  // Las de otras plantas, de antes (una recarga a mitad de la subida).
  const [otherUploads, setOtherUploads] = useState<readonly PendingUpload[]>([])
  useEffect(() => {
    if (draftUserId === null) return
    let active = true
    void listPendingUploads(photoDraftBackend, draftUserId, {
      now: now(),
    }).then((found) => {
      if (active) setOtherUploads(found)
    })
    return () => {
      active = false
    }
  }, [draftUserId, photoDraftBackend, now])
  const primaryRef = useRef<HTMLButtonElement>(null)
  const uploadAlertRef = useRef<HTMLDivElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const touch = useTouchDevice()
  const showCamera = camera === 'show' || (camera === 'auto' && touch)

  // Con la planta guardada y alguna foto sin subir, salir pide confirmación
  // (#284). El aviso dice si las que faltan quedaron en el dispositivo.
  const photosLeft =
    registered !== null &&
    newPhotos.some((entry) => entry.upload.status !== 'saved')
  const guard = useLeaveGuard({
    dirty: photosLeft,
    text: {
      title: PENDING_UPLOAD_TEXT.leaveTitle,
      description: (
        <p>
          {pendingKept
            ? PENDING_UPLOAD_TEXT.leaveKept
            : PENDING_UPLOAD_TEXT.leaveLost}
        </p>
      ),
      confirm: PENDING_UPLOAD_TEXT.leaveConfirm,
      stay: PENDING_UPLOAD_TEXT.leaveStay,
    },
  })

  // Guarda el borrador de texto con cada cambio. Los valores con los que se
  // montó no se reescriben: recuperar un borrador no renueva su caducidad.
  // Con fotos el borrador se conserva aunque no haya nada escrito: lleva el
  // id de planta con el que van las fotos.
  const hasNewPhotos = newPhotos.length > 0
  useEffect(() => {
    if (draftOwner === null || values === start.values) return
    // Enlazar solo el nombre con el que se abrió (#280) no es un cambio de la
    // persona: no crea un borrador ni renueva la caducidad del recuperado.
    if (!hasNewPhotos && isOnlyLinked(start.values, values)) return
    let next: 'none' | 'saved' | 'failed' = 'none'
    if (isPlantFormDirty(values, initial) || hasNewPhotos) {
      const saved = writePlantDraft(draftOwner, {
        plantId,
        values,
        savedAt: now().getTime(),
      })
      next = saved ? 'saved' : 'failed'
    } else {
      clearPlantDraft(draftOwner, plantId)
    }
    // El aviso sin conexión dice si el borrador quedó guardado (#296): es el
    // resultado de escribir en localStorage, un sistema externo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStored((current) => (current === next ? current : next))
  }, [values, draftOwner, plantId, now, start.values, initial, hasNewPhotos])

  // Las fotos del borrador con el que empezó, en su orden. Las que no son de
  // ningún borrador las borra PlantForm al abrir el registro.
  useEffect(() => {
    if (draftOwner === null || start.draft === null) return
    let active = true
    void readDraftPhotos(photoDraftBackend, draftOwner, {
      plantId: start.draft.plantId,
      now: now(),
    }).then((found) => {
      if (!active || found === null || photosTouched.current) return
      photos.replace(
        found.photos.map(({ fileName, photo }) =>
          newPhotoEntry(fileName, photo),
        ),
      )
    })
    return () => {
      active = false
    }
    // photos.replace es estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftOwner, photoDraftBackend, start.draft, now])

  // Cada cambio de las fotos ya preparadas (añadir, quitar) va al borrador,
  // con su orden. El borrador de texto va con ellas: lleva el id de planta.
  const draftPhotosKey = newPhotos.map((entry) => entry.key).join(' ')
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  })
  useEffect(() => {
    if (draftOwner === null || !photosTouched.current || registered !== null) {
      return
    }
    const list = photos.current().filter(isNewEntry)
    const savedAt = now().getTime()
    let textSaved = true
    if (list.length > 0) {
      textSaved = writePlantDraft(draftOwner, {
        plantId,
        values: valuesRef.current,
        savedAt,
      })
    } else if (!isPlantFormDirty(valuesRef.current, initial)) {
      clearPlantDraft(draftOwner, plantId)
    }
    void writeDraftPhotos(photoDraftBackend, draftOwner, {
      plantId,
      savedAt,
      photos: list.map(({ fileName, photo }) => ({ fileName, photo })),
    }).then((photosSaved) => {
      if (!textSaved || !photosSaved) setStored('failed')
      else if (list.length > 0) setStored('saved')
    })
    // Solo cuando cambian las fotos (draftPhotosKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPhotosKey])

  const offlineId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const fieldFocus = usePlantFieldFocus(values.otherGenusOpen)
  const { nameRef, genusRef, typeRef, focusField } = fieldFocus

  // Después del efecto de Page, que lleva el foco al título al navegar. Este
  // componente va dentro de Page y su efecto corre antes que el de Page (en
  // «¿Ya la tengo?» es al revés: la pantalla contiene Page), así que el foco
  // se mueve en una microtarea, cuando ya corrieron todos los efectos.
  // Mientras se confirma la sesión el formulario está desactivado y el campo
  // no admite el foco: se lleva al activarse, una sola vez y solo si la
  // persona no lo puso ya en otro sitio (sigue en la página o en el título).
  const nameFocused = useRef(false)
  const fieldsDisabled = registered !== null || (blocked && !keepsDraft)
  const nameDisabled = fieldsDisabled
  useEffect(() => {
    if (!autoFocusName || nameFocused.current || nameDisabled) return
    nameFocused.current = true
    queueMicrotask(() => {
      // Tras elegir un borrador o lo que llega (#296), el botón pulsado ya no
      // está: el foco va al nombre (WebKit lo deja en <main>, que se pulsó).
      const active = document.activeElement
      if (
        !focusNameOnMount &&
        active !== null &&
        active !== document.body &&
        active.tagName !== 'H1'
      ) {
        return
      }
      nameRef.current?.focus()
    })
    // nameRef no cambia: es una referencia de usePlantFieldFocus.
  }, [autoFocusName, nameDisabled, focusNameOnMount, nameRef])

  // Nombre exacto (#280): si se envía mientras aún se busca el nombre (Enter
  // justo después de escribirlo), el guardado espera a saber si es una especie
  // del catálogo, que se enlaza sola. Si resulta que hay que elegir (un
  // sinónimo, varias), no se guarda: la persona lo ve y decide.
  const [nameResolution, setNameResolution] =
    useState<NameResolution>('settled')
  const submitQueued = useRef(false)
  useEffect(() => {
    if (!submitQueued.current || nameResolution === 'resolving') return
    submitQueued.current = false
    // Fuera del efecto: el envío usa flushSync (abrir «Más detalles» antes de
    // llevar el foco a un error), que dentro de un efecto no pinta a tiempo.
    if (nameResolution === 'settled') {
      queueMicrotask(() => formRef.current?.requestSubmit())
    }
  }, [nameResolution])

  // Género de la primera palabra de un nombre libre (#280).
  const deducedGenus = useDeducedGenus(
    values,
    dispatch,
    services.searchGenera,
    online && registered === null,
  )
  const genusDispatch: typeof dispatch = (action) => {
    deducedGenus.forget()
    dispatch(action)
  }

  const today = localDateString(now())
  // Sin validar mientras se escribe: los errores aparecen al intentar
  // guardar y, desde entonces, se actualizan con cada cambio.
  const errors = submitted ? validatePlantForm(values, today) : {}
  const saving = save.status === 'saving'

  /** Guarda en el dispositivo las fotos que aún quedan por subir. */
  const savePending = (): Promise<boolean> => {
    const pending = pendingRef.current
    if (pending === null || draftOwner === null) return Promise.resolve(false)
    return writePendingUpload(photoDraftBackend, draftOwner, {
      plantId: pending.plant.id,
      plantName: pending.plant.displayName,
      plantNameIsScientific: pending.plant.displayNameIsScientific,
      savedAt: now().getTime(),
      photos: [...pending.photos.values()],
    })
  }

  /** La foto `key` ya está guardada: deja de estar por subir. */
  const forgetPending = (key: string) => {
    const pending = pendingRef.current
    if (pending === null || !pending.photos.delete(key)) return
    void savePending()
  }

  /** Ninguna foto queda por subir (todas subidas o la persona sigue sin ellas). */
  const clearPending = () => {
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending === null || draftOwner === null) return
    void clearPendingUpload(photoDraftBackend, draftOwner, pending.plant.id)
  }

  /**
   * Fotos tras guardar la planta: sube las nuevas que faltan (todas, o solo
   * `onlyKeys`). Termina el registro si todo salió bien; si no, deja el
   * formulario con los fallos.
   */
  const runPhotoPhase = async (plant: CollectionPlant, onlyKeys?: string[]) => {
    uploadController.current?.abort()
    const controller = new AbortController()
    uploadController.current = controller
    setRegistered(plant)
    setPhase({ status: 'working' })
    latestPlant.current ??= plant
    const onPlantUpdated = (updated: CollectionPlant) => {
      latestPlant.current = updated
      onPlantStored?.(updated)
    }
    let firstError: PhotoStorageError | null = null
    if (draftUserId === null) {
      firstError = new PhotoStorageError('session-ended')
    }

    // Las nuevas que aún no están guardadas.
    const all = photos.current()
    const pending = all.filter(
      (entry): entry is NewPhotoEntry =>
        isNewEntry(entry) &&
        entry.upload.status !== 'saved' &&
        (onlyKeys === undefined || onlyKeys.includes(entry.key)),
    )
    const setUpload = (key: string, upload: NewPhotoEntry['upload']) =>
      photos.update((list) =>
        list.map((entry) =>
          entry.key === key && isNewEntry(entry) ? { ...entry, upload } : entry,
        ),
      )
    if (pending.length > 0) {
      const keys = pending.map((entry) => entry.key)
      if (firstError?.reason === 'session-ended') {
        for (const key of keys)
          setUpload(key, { status: 'error', error: firstError })
      } else {
        for (const key of keys) setUpload(key, { status: 'uploading' })
        // "En floración" es de la principal: la primera de la galería.
        const mainKey = all[0]?.key
        try {
          const result = await services.uploadPhotos(
            pending.map((entry) => ({
              files: entry.photo,
              inBloom: entry.key === mainKey && values.photoInBloom,
            })),
            {
              userId: draftUserId ?? '',
              plantId: plant.id,
              signal: controller.signal,
              onPlantUpdated,
              onProgress: (progress) => {
                const key = keys[progress.index]
                if (key === undefined) return
                if (progress.step === 'uploading') {
                  const { bytesDone, bytesTotal } = progress.files
                  setUpload(key, {
                    status: 'uploading',
                    progress: bytesTotal > 0 ? bytesDone / bytesTotal : 0,
                  })
                } else if (progress.step === 'saving') {
                  setUpload(key, { status: 'uploading', progress: 1 })
                } else if (progress.result.status === 'uploaded') {
                  // Aunque ya se haya salido: la entrada del dispositivo
                  // refleja lo que de verdad falta.
                  forgetPending(key)
                }
              },
            },
          )
          result.results.forEach((outcome, index) => {
            const key = keys[index]
            if (key === undefined) return
            if (outcome.status === 'uploaded') {
              setUpload(key, { status: 'saved' })
              return
            }
            const error =
              outcome.status === 'failed'
                ? outcome.error
                : new PhotoStorageError('aborted')
            firstError ??= error
            setUpload(key, { status: 'error', error })
          })
          if (result.plant) latestPlant.current = result.plant
        } catch (error) {
          const failure = photoStorageErrorFrom(error)
          firstError ??= failure
          for (const key of keys)
            setUpload(key, { status: 'error', error: failure })
        }
      }
    }
    if (uploadController.current !== controller) return
    uploadController.current = null

    const failedNow = photos
      .current()
      .some((entry) => isNewEntry(entry) && entry.upload.status !== 'saved')
    if (firstError === null && !failedNow) {
      clearPending()
      if (!mounted.current) return
      const saved = latestPlant.current ?? plant
      const count = photos.current().length
      void guard.leave(() => onSaved(saved, { changed: true, photos: count }))
      return
    }
    if (!mounted.current) return
    setPhase({
      status: 'failed',
      error: firstError ?? new PhotoStorageError('failed'),
    })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current || blocked || registered !== null) return
    // Con fotos a medio preparar no se guarda: el botón lo dice.
    if (preparing) return
    if (nameResolution === 'resolving') {
      submitQueued.current = true
      return
    }
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
    let plant: CollectionPlant
    try {
      // "En floración" no va en la planta: se guarda con la foto principal
      // al subirla (runPhotoPhase, #186).
      plant = await props.services.savePlant(toPlantInsert(values, plantId))
    } catch (error) {
      savingRef.current = false
      setSave({ status: 'error', error: plantSaveErrorFrom(error) })
      return
    }
    savingRef.current = false
    // La planta ya existe: sus fotos pasan del borrador a las «por subir» de
    // la planta (#284), antes de borrar el borrador, para que una recarga en
    // medio no las pierda. Siguen en memoria para subirlas y reintentarlo.
    if (draftOwner !== null && photoCount > 0) {
      const all = photos.current()
      const mainKey = all[0]?.key
      pendingRef.current = {
        plant,
        photos: new Map(
          all.filter(isNewEntry).map((entry) => [
            entry.key,
            {
              fileName: entry.fileName,
              photo: entry.photo,
              version: photoVersionFor(entry.photo),
              inBloom: entry.key === mainKey && values.photoInBloom,
            },
          ]),
        ),
      }
      setPendingKept(await savePending())
    }
    // El borrador (y sus fotos) ya sobran.
    if (draftOwner !== null) {
      clearPlantDraft(draftOwner, plantId)
      void clearDraftPhotos(photoDraftBackend, draftOwner, plantId)
    }
    setSave({ status: 'idle' })
    onPlantStored?.(plant)
    if (photoCount === 0) {
      onSaved(plant, { changed: true, photos: 0 })
      return
    }
    latestPlant.current = plant
    await runPhotoPhase(plant)
  }

  const uploading = registered !== null && phase.status === 'working'
  const failure =
    registered !== null && phase.status === 'failed' ? phase : null
  const canRetry = failure !== null && canRetryUpload(failure.error.reason)

  // Tras un fallo de las fotos, el foco va a la acción que sigue (reintentar
  // o, si no se puede, continuar) y el mensaje que lo explica se desplaza a la
  // vista.
  const failed = failure !== null
  useEffect(() => {
    if (!failed) return
    primaryRef.current?.focus()
    // jsdom no tiene scrollIntoView.
    uploadAlertRef.current?.scrollIntoView?.({ block: 'center' })
  }, [failed])

  const retryPhotos = (onlyKeys?: string[]) => {
    if (!online || registered === null || phase.status !== 'failed') return
    void runPhotoPhase(registered, onlyKeys)
  }

  // La planta ya está registrada (o editada); se sale sin las fotos que
  // fallaron.
  const continueWithout = () => {
    if (registered === null || phase.status === 'working') return
    const savedCount = photos
      .current()
      .filter(
        (entry) => !isNewEntry(entry) || entry.upload.status === 'saved',
      ).length
    // La persona decidió seguir sin ellas: no se ofrecen después.
    clearPending()
    const saved = latestPlant.current ?? registered
    void guard.leave(() =>
      onSaved(saved, { changed: true, photos: savedCount }),
    )
  }

  const cancelUpload = () => uploadController.current?.abort()

  const openPicker = (input: HTMLInputElement | null) => {
    if (saving || fieldsDisabled) return
    input?.click()
  }

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    // Vaciar el campo permite volver a elegir las mismas fotos.
    event.target.value = ''
    if (files.length === 0) return
    photosTouched.current = true
    setPrepareErrors([])
    photos.add(files)
  }

  const removePhoto = (key: string) => {
    if (registered !== null || saving) return
    const index = photos.current().findIndex((entry) => entry.key === key)
    const removed = photos.remove(key)
    if (removed === null) return
    photosTouched.current = true
    setLeftOutNotice(null)
    const left = photos.current().length
    setPhotoStatus(text.photoRemoved(left, MAX_PLANT_PHOTOS, index === 0))
    // Sin fotos, "en floración" no tiene sentido.
    if (left === 0 && values.photoInBloom) {
      dispatch({ type: 'photoInBloomChanged', photoInBloom: false })
    }
  }

  // Si hay algo que se perdería al salir: lo escrito o las fotos.
  const dirty = isPlantFormDirty(values, initial) || photoCount > 0

  // «Cancelar» con cambios pregunta con el diálogo de la app, como la edición
  // (#335): «Seguir editando» primero, Escape lo cierra y el foco vuelve a
  // «Cancelar».
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const discardAndLeave = () => {
    setConfirmingCancel(false)
    if (draftOwner !== null) {
      clearPlantDraft(draftOwner, plantId)
      void clearDraftPhotos(photoDraftBackend, draftOwner, plantId)
    }
    onCancel()
  }
  const cancel = () => {
    if (saving || registered !== null) return
    if (dirty) setConfirmingCancel(true)
    else discardAndLeave()
  }

  // Empieza de cero: formulario vacío con la fecha de hoy, sin fotos y otro
  // id de planta (el del borrador pudo llegar a la base en un intento
  // anterior). Los demás borradores guardados no se tocan.
  const discardDraft = () => {
    if (saving || registered !== null) return
    if (draftOwner !== null) {
      clearPlantDraft(draftOwner, plantId)
      void clearDraftPhotos(photoDraftBackend, draftOwner, plantId)
    }
    dispatch({
      type: 'restored',
      values: withStart(
        initialPlantFormValues(localDateString(now())),
        initialName,
        initialSpecies,
      ),
    })
    photosTouched.current = false
    photos.replace([])
    setPhotoStatus('')
    setLeftOutNotice(null)
    setPrepareErrors([])
    setPlantId(newPlantId())
    setDraftRestored(false)
    setDetailsOpen(false)
    setSubmitted(false)
    setSave({ status: 'idle' })
    // El botón desaparece con el aviso: el foco va al primer campo.
    nameRef.current?.focus()
  }

  // Miniaturas de las fotos nuevas, de su Blob.
  const thumbnailUrls = useObjectUrls(
    newPhotos.map((entry) => entry.photo.thumbnail.blob),
  )
  // Las guardadas ('stored') solo las usa la edición: aquí no hay miniatura.
  const galleryPhotos: GalleryPhoto[] = entries.map((entry) =>
    toGalleryPhoto(
      entry,
      isNewEntry(entry)
        ? thumbnailUrls.get(entry.photo.thumbnail.blob)
        : undefined,
      (error) =>
        error.reason === 'aborted'
          ? text.photoCancelled
          : text.photoNotUploaded,
    ),
  )

  const failedLabels = entries.flatMap((entry, index) =>
    isNewEntry(entry) && entry.upload.status === 'error'
      ? [galleryPhotoLabel(index, entries.length)]
      : [],
  )
  const uploadedCount = newPhotos.filter(
    (entry) => entry.upload.status === 'saved',
  ).length

  let primaryText: string
  if (registered !== null) {
    primaryText = uploading
      ? text.photosUploadingButton
      : canRetry
        ? text.photosRetry
        : text.photosContinue
  } else if (saving) {
    primaryText = text.submitting
  } else if (preparing) {
    primaryText = text.photosPreparing
  } else {
    primaryText = text.submit
  }
  const primaryBlocked =
    registered !== null
      ? uploading || (canRetry && !online)
      : saving || preparing || blocked

  const galleryDisabled = fieldsDisabled || saving
  // Los campos de lugar, la fecha, el apodo y el color (PlantFields.tsx).
  const placeProps = { values, errors, dispatch, knownPlants, refs: fieldFocus }

  const main = (
    <fieldset
      disabled={fieldsDisabled}
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
          linkInitialName
          onResolutionChange={setNameResolution}
          offline={!online}
        />
        <DuplicateNotice
          species={values.species}
          knownPlants={knownPlants}
          after={text.duplicateAfter}
        />
        {/* «Así es su especie» (#234): al elegirla. */}
        {values.species !== null && services.loadReferencePhoto && (
          <SpeciesPreview
            speciesId={values.species.id}
            scientificName={values.species.scientificName}
            load={services.loadReferencePhoto}
          />
        )}
      </div>

      <GenusField
        values={values}
        dispatch={genusDispatch}
        quickGenera={quickGenera}
        onRetryQuickGenera={retryQuickGenera}
        searchGenera={services.searchGenera}
        error={errors.genus}
        containerRef={genusRef}
      />

      <PlantTypeField
        values={values}
        dispatch={dispatch}
        error={errors.type}
        containerRef={typeRef}
      />

      <DateAndPlaceRow {...placeProps} today={today} />
    </fieldset>
  )

  const gallery = (
    <PhotoGallery
      photos={galleryPhotos}
      max={MAX_PLANT_PHOTOS}
      title={text.photosTitle}
      titleSuffix={text.optional}
      disabled={galleryDisabled}
      // Con la planta ya guardada, las fotos no se quitan: se reintenta o se
      // sigue sin las que fallaron.
      onRemove={registered === null ? removePhoto : undefined}
      onRetry={
        failure !== null && canRetry ? (key) => retryPhotos([key]) : undefined
      }
      onTakePhoto={
        showCamera ? () => openPicker(cameraInput.current) : undefined
      }
      onChoosePhotos={() => openPicker(filesInput.current)}
      notice={
        isPendingName(values) ? (
          <PendingPhotoNotice count={photoCount} newTab={false} />
        ) : undefined
      }
    >
      {showCamera && (
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFiles}
        />
      )}
      <input
        ref={filesInput}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFiles}
      />
      {/*
        Región siempre montada, solo para el lector: anuncia lo que pasa con
        las fotos (la galería ya lo muestra con el contador y las miniaturas).
      */}
      <p role="status" className="sr-only">
        {photoStatus}
      </p>
      {leftOutNotice !== null && (
        <p className="orki-gallery__notice">{leftOutNotice}</p>
      )}
      <PhotoPrepareErrors messages={prepareErrors} />
    </PhotoGallery>
  )

  const extra = (
    <PlantDetailsSection
      {...placeProps}
      open={detailsOpen}
      onOpenChange={setDetailsOpen}
      disabled={fieldsDisabled}
    >
      {/* Solo con alguna foto: sin fotos no tiene sentido. */}
      {photoCount > 0 && (
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
    </PlantDetailsSection>
  )

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={text.title}
      className="flex flex-col gap-space-5"
      onSubmit={(event) => void handleSubmit(event)}
    >
      {guard.dialog}
      {confirmingCancel && (
        <ConfirmDialog
          title={EDIT_LEAVE_TEXT.title}
          description={<p>{text.discardDescription}</p>}
          confirmLabel={EDIT_LEAVE_TEXT.confirm}
          cancelLabel={EDIT_LEAVE_TEXT.stay}
          initialFocus="cancel"
          onConfirm={discardAndLeave}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
      {registered === null &&
        otherUploads.some((upload) => upload.plantId !== plantId) && (
          <PendingUploadsNotice
            uploads={otherUploads.filter(
              (upload) => upload.plantId !== plantId,
            )}
          />
        )}
      {(draftRestored || otherDrafts.length > 0) && (
        <DraftNotice
          restored={draftRestored}
          // Con la planta ya guardando o guardada, no se cambia de borrador.
          others={saving || registered !== null ? [] : otherDrafts}
          onDiscard={discardDraft}
          onSwitch={onSwitchDraft}
        />
      )}

      {/*
        Región siempre presente: así se anuncia al perder la conexión. Con un
        usuario, dice que el borrador queda en el dispositivo y que el envío
        espera (#296); sin él, que el formulario se activará al volver.
      */}
      <div id={offlineId} role="status">
        {blocked && registered === null && !keepsDraft && (
          <p className="flex items-start gap-space-2 rounded-lg bg-neutral-50 p-space-4 text-sm text-neutral-900">
            <Icon
              name="triangle-alert"
              className="mt-[2px] size-[16px] flex-none"
            />
            {text.offline}
          </p>
        )}
        {blocked && registered === null && keepsDraft && (
          <p className="flex items-start gap-space-2 rounded-lg bg-neutral-50 p-space-4 text-sm text-neutral-900">
            <Icon name="cloud-off" className="mt-[2px] size-[16px] flex-none" />
            {`${online ? text.unverifiedTitle : text.offlineTitle} ${(stored ===
              'saved'
              ? text.draftSavedHere
              : stored === 'failed'
                ? text.draftNotSavedHere
                : text.draftWillSaveHere)(
              online ? text.whenVerified : text.whenOnline,
            )}`}
          </p>
        )}
        {blocked && registered !== null && !online && (
          <p className="flex items-start gap-space-2 rounded-lg bg-neutral-50 p-space-4 text-sm text-neutral-900">
            <Icon
              name="triangle-alert"
              className="mt-[2px] size-[16px] flex-none"
            />
            {text.offline}
          </p>
        )}
      </div>

      {/*
        Sin conexión, con un usuario, todo se sigue completando y va al
        borrador (#296); sin usuario, los campos quedan desactivados y lo
        escrito y las fotos se conservan. Con la planta ya guardada (subiendo
        sus fotos), no hay nada más que editar.
      */}
      <FormLayout main={main} aside={gallery} extra={extra} />

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
            <Button type="submit" aria-disabled={blocked || undefined}>
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

      {/* Región siempre presente: anuncia la subida de las fotos. */}
      <div role="status">
        {uploading && (
          <p className="text-sm text-neutral-900">
            {text.photosUploading(
              text.savedPrefix,
              uploadedCount,
              newPhotos.length,
            )}
          </p>
        )}
      </div>

      {failure !== null && (
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
            {failure.error.reason === 'aborted'
              ? text.photosCancelled(text.savedPrefix)
              : text.photosFailed(text.savedPrefix, failedLabels)}
          </p>
          {failure.error.reason !== 'aborted' && <p>{failure.error.message}</p>}
          {canRetry && <p>{text.photosRetryHint}</p>}
        </div>
      )}

      {/*
        El mismo botón principal en todas las fases (registrar, subiendo,
        reintentar o continuar): el foco no se pierde al cambiar de una a otra.
      */}
      <FormActions>
        {registered === null ? (
          <Button
            className="orki-formactions__secondary"
            aria-disabled={saving || undefined}
            onClick={cancel}
          >
            {text.cancel}
          </Button>
        ) : uploading ? (
          <Button
            className="orki-formactions__secondary"
            onClick={cancelUpload}
          >
            {text.photosUploadCancel}
          </Button>
        ) : (
          canRetry && (
            <Button
              className="orki-formactions__secondary"
              onClick={continueWithout}
            >
              {text.photosContinueWithout}
            </Button>
          )
        )}
        <Button
          ref={primaryRef}
          type={registered === null ? 'submit' : 'button'}
          variant="primary"
          aria-disabled={primaryBlocked || undefined}
          aria-describedby={
            (blocked && registered === null) || (!online && canRetry)
              ? offlineId
              : undefined
          }
          onClick={
            registered === null || uploading
              ? undefined
              : canRetry
                ? () => retryPhotos()
                : continueWithout
          }
        >
          {primaryText}
        </Button>
      </FormActions>
    </form>
  )
}
