import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type RefObject,
} from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router'
import type { CollectionPlant } from '../collection/model.ts'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { Collapsible } from '../components/ui/Collapsible.tsx'
import {
  FormActions,
  FormLayout,
  FormPair,
} from '../components/ui/FormLayout.tsx'
import { galleryPhotoLabel } from '../components/ui/gallery-label.ts'
import { Icon } from '../components/ui/Icon.tsx'
import {
  PhotoGallery,
  type GalleryPhoto,
} from '../components/ui/PhotoGallery.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import {
  catalogSearchFailure,
  type CatalogSearchFunction,
  type GenusSearchResult,
  type SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { enumValues, type PlantType } from '../lib/database.ts'
import { localDateString } from '../lib/localDate.ts'
import type {
  NewPlantPhoto,
  PlantPhotosProgress,
  RemoveStoredPlantPhotoResult,
  UploadPlantPhotosResult,
} from '../photos/gallery.ts'
import { MAX_PLANT_PHOTOS } from '../photos/paths.ts'
import type { StoredPlantPhoto } from '../photos/photo-rows.ts'
import { PhotoStorageError, photoStorageErrorFrom } from '../photos/storage.ts'
import { useTouchDevice } from '../photos/useCoarsePointer.ts'
import { useObjectUrls } from '../photos/useObjectUrls.ts'
import { canRetryUpload } from '../photos/usePhotoUpload.ts'
import { useStoredThumbnails } from '../photos/useStoredThumbnails.ts'
import { PATHS, plantEditPath, signInPathFor } from '../routes/paths.ts'
import {
  ChoiceField,
  FORM_CHIP_CLASSES,
  LOCKED_CHIP_CLASSES,
} from './ChoiceField.tsx'
import { clearPlantDraft, readPlantDraft, writePlantDraft } from './draft.ts'
import {
  appDraftPhotoBackend,
  clearDraftPhotos,
  readDraftPhotos,
  writeDraftPhotos,
  type DraftPhotoBackend,
} from './draft-photo.ts'
import { DuplicateNotice } from './DuplicateNotice.tsx'
import {
  initialPlantFormValues,
  isPendingName,
  isPlantFormDirty,
  PLANT_DETAIL_FIELDS,
  PLANT_FORM_FIELDS,
  PLANT_TEXT_MAX_LENGTH,
  plantFormReducer,
  plantFormValuesFrom,
  plantPatch,
  toPlantInsert,
  unlinksSpecies,
  validatePlantForm,
  type FormGenus,
  type NewPlantInsert,
  type PlantFormField,
  type PlantFormValues,
  type PlantPatch,
} from './form-state.ts'
import { GenusField, type QuickGeneraState } from './GenusField.tsx'
import { NameField } from './NameField.tsx'
import { OriginField } from './OriginField.tsx'
import { plantSaveErrorFrom, type PlantSaveError } from './save-plant.ts'
import {
  FLOWER_COLOR_LABEL,
  PLANT_EDIT_NOTICE_TEXT,
  PLANT_EDIT_TEXT,
  PLANT_FORM_TEXT,
  PLANT_TYPE_LABEL,
  type PlantFormTexts,
} from './texts.ts'
import {
  newPhotoEntry,
  storedPhotoEntry,
  usePhotoEntries,
  type NewPhotoEntry,
  type PhotoEntry,
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
 * De dónde saca el formulario los datos y dónde sube las fotos, al registrar
 * y al editar. Deben ser estables entre pintados (funciones de módulo).
 */
export interface PlantFormBaseServices {
  searchSpecies: CatalogSearchFunction<SpeciesSearchResult>
  searchGenera: CatalogSearchFunction<GenusSearchResult>
  /** Géneros de acceso rápido; se rechaza con CatalogSearchError. */
  loadQuickGenera: () => Promise<readonly FormGenus[]>
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

/** Edición de una planta ya guardada (#16). */
export interface PlantFormEditing {
  /**
   * La planta tal como está al abrir la edición: precarga el formulario y es
   * la referencia de lo que cambió. Se lee al montarse.
   */
  plant: CollectionPlant
  /**
   * Guarda los cambios (solo las columnas que cambiaron) y devuelve la planta
   * actualizada; se rechaza con PlantSaveError.
   */
  updatePlant: (plantId: string, patch: PlantPatch) => Promise<CollectionPlant>
  /** Las fotos guardadas, en orden (listPlantPhotos). */
  listPhotos: (options: {
    userId: string
    plantId: string
  }) => Promise<StoredPlantPhoto[]>
  /** Borra una foto guardada (removeStoredPlantPhoto). */
  removePhoto: (options: {
    userId: string
    plantId: string
    photo: StoredPlantPhoto
    onPlantUpdated: (plant: CollectionPlant) => void
  }) => Promise<RemoveStoredPlantPhotoResult>
}

interface PlantFormCommonProps {
  /** Si hay conexión (useOnlineStatus). Sin ella, el formulario se desactiva. */
  online: boolean
  /**
   * El registro (o la edición) terminó: la planta está guardada y sus fotos
   * subidas (o la persona eligió seguir sin las que fallaron). Para salir del
   * formulario. Al editar, `changed` es false si no se escribió nada.
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
   * guardado, gana el borrador; al descartarlo, el formulario vuelve a
   * empezar con este nombre. Al editar no se usa.
   */
  initialName?: string
  /** Dónde se guardan las fotos pendientes del borrador; por defecto, IndexedDB. */
  photoDraftBackend?: DraftPhotoBackend
  /**
   * Salir sin guardar; si había cambios, la persona ya lo confirmó y el
   * borrador ya está borrado.
   */
  onCancel: () => void
  /**
   * Se rellena con la función de "Cancelar" (pregunta si hay cambios): para
   * que el enlace de volver de la cabecera haga lo mismo al editar.
   */
  cancelRef?: RefObject<(() => void) | null>
  /**
   * Plantas del usuario ya cargadas (la colección en memoria), para las
   * sugerencias de origen y el aviso de duplicado; null o sin indicar si aún
   * no están (el formulario funciona igual, sin ellos).
   */
  knownPlants?: readonly CollectionPlant[] | null
  /**
   * Usuario activo (id de Clerk): dueño de las fotos y, al registrar, del
   * borrador. Al registrar, lo escrito y las fotos se guardan en el
   * dispositivo y se recuperan al volver a abrir el formulario (draft.ts y
   * draft-photo.ts); sin usuario, no hay borrador. Si cambia, hay que volver
   * a montar el formulario (key), porque el borrador se lee al montarse. Al
   * editar no hay borrador.
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
 * Registrar (services con savePlant) o editar una planta (editing, #16). Es
 * el mismo formulario, con los mismos campos y el mismo estado; al editar se
 * precarga con la planta y sus fotos y guarda solo lo que cambió.
 */
export type PlantFormProps = PlantFormCommonProps &
  (
    | { editing?: undefined; services: PlantFormServices }
    | { editing: PlantFormEditing; services: PlantFormBaseServices }
  )

const PLANT_TYPES: readonly PlantType[] = ['species', 'hybrid', 'unknown']

const deviceNow = () => new Date()

/** El formulario vacío con `name` ya escrito en el nombre (si lo hay). */
function withName(values: PlantFormValues, name: string): PlantFormValues {
  return name === '' ? values : { ...values, name }
}

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

/** Las fotos después de guardar la planta: subiendo, o con algún fallo. */
type PhotoPhase =
  | { status: 'working' }
  | {
      status: 'failed'
      /** Fotos guardadas que no se pudieron quitar (al editar). */
      removeFailures: number
      /** El primer motivo de fallo. */
      error: PhotoStorageError
    }

/** Al editar: las fotos guardadas, cargando o con fallo. */
type StoredLoad = 'loading' | 'ready' | 'error'

function newPlantId(): string {
  return crypto.randomUUID()
}

function isNew(entry: PhotoEntry): entry is NewPhotoEntry {
  return entry.kind === 'new'
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
 * Aviso discreto de borrador recuperado, con "Descartar borrador". La región
 * role="status" se pinta vacía y el texto llega en el pintado siguiente, para
 * que el lector de pantalla lo anuncie.
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
 * Aviso de la galería con un nombre por validar (#12, #210, #221): el equipo
 * del catálogo podrá ver las fotos para validar el nombre, como dice la
 * página de privacidad. Sin fotos, las recomienda; con fotos, avisa. Describe
 * la galería (aria-describedby), no es un paso más: registrar sin fotos sigue
 * igual.
 *
 * El enlace a Privacidad no pierde lo escrito: al registrar, el borrador se
 * conserva al salir por un enlace de la app y se recupera al volver; al
 * editar no hay borrador, así que se abre en otra pestaña y lo dice.
 */
function PendingPhotoNotice({
  text,
  count,
  newTab,
}: {
  text: PlantFormTexts
  count: number
  newTab: boolean
}) {
  return (
    <>
      {count > 0 ? text.pendingPhotoNotice(count) : text.pendingPhotoHint}{' '}
      {text.pendingPhotoMore}{' '}
      {newTab ? (
        <a href={PATHS.privacy} target="_blank" rel="noopener noreferrer">
          {text.privacyLink}{' '}
          <span className="sr-only">
            {PLANT_EDIT_NOTICE_TEXT.privacyNewTab}
          </span>
        </a>
      ) : (
        <Link to={PATHS.privacy}>{text.privacyLink}</Link>
      )}
      .
    </>
  )
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
 * borra. Se recupera al montarse, con un aviso y "Descartar borrador". Se
 * borra al guardar con éxito, al descartarlo y al salir con "Cancelar" (que
 * avisa antes de perder lo escrito). Salir de otra forma (otra pestaña de la
 * app, cerrar o recargar) lo conserva: es lo que protege de una recarga.
 *
 * Fotos (#221): primero se guarda la planta y después se suben las fotos
 * (uploadPlantPhotos), con el progreso de cada una en su miniatura. Si alguna
 * falla, la planta ya existe: el formulario se queda con las fotos, dice
 * cuáles fallaron y deja reintentar solo esas (la API no duplica las que ya
 * subió) o continuar sin ellas. Al editar, las fotos quitadas se borran al
 * guardar, antes de subir las nuevas.
 */
export function PlantForm(props: PlantFormProps) {
  const {
    services,
    online,
    onSaved,
    onCancel,
    onPlantStored,
    cancelRef,
    knownPlants = null,
    draftUserId = null,
    initialName = '',
    photoDraftBackend = appDraftPhotoBackend(),
    now = deviceNow,
    camera = 'auto',
  } = props
  // Lo que se lee una sola vez al montarse: al registrar, el formulario
  // vacío de hoy y el borrador, si lo hay; al editar, la planta y el
  // formulario con sus datos.
  const [start] = useState(() => {
    if (props.editing !== undefined) {
      const values = plantFormValuesFrom(props.editing.plant)
      return {
        fresh: values,
        draft: null,
        values,
        editing: props.editing,
      }
    }
    const fresh = initialPlantFormValues(localDateString(now()))
    const draft = draftUserId ? readPlantDraft(draftUserId, now()) : null
    const prefilled = withName(fresh, initialName)
    return {
      fresh,
      draft,
      values: draft?.values ?? prefilled,
      editing: null,
    }
  })
  // Con qué se abrió el formulario: vacío (registro) o con los datos de la
  // planta (edición). Es la referencia de "hay cambios".
  const initial = start.fresh
  const edit = start.editing
  const editingPlant = edit?.plant ?? null
  const editing = edit !== null
  const text: PlantFormTexts = editing ? PLANT_EDIT_TEXT : PLANT_FORM_TEXT
  // Al editar no hay borrador; el usuario sigue siendo el dueño de las fotos.
  const draftOwner = editing ? null : draftUserId
  const [values, dispatch] = useReducer(plantFormReducer, start.values)
  const [submitted, setSubmitted] = useState(false)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  // El id de la planta se genera una vez (o viene del borrador) y se
  // reutiliza en cada reintento: si un intento llegó a la base pero no su
  // respuesta, el siguiente no crea otra planta (ver save-plant.ts). Solo
  // cambia al descartar el borrador.
  const [plantId, setPlantId] = useState(
    () => editingPlant?.id ?? start.draft?.plantId ?? newPlantId(),
  )
  const [draftRestored, setDraftRestored] = useState(start.draft !== null)
  // Cerrada por defecto; abierta si el borrador traía algo dentro.
  const [detailsOpen, setDetailsOpen] = useState(() => hasDetails(start.values))
  // Evita el doble envío antes de que React pinte el estado "guardando".
  const savingRef = useRef(false)
  // Si ya se escribió algo en la base (al registrar, siempre; al editar, si
  // los datos cambiaron), para onSaved.
  const changedRef = useRef(true)
  const [quickGenera, retryQuickGenera] = useQuickGenera(
    services.loadQuickGenera,
    online,
  )

  // Fotos ----------------------------------------------------------------
  // Lo que se anuncia (role="status", solo para el lector: la galería ya lo
  // muestra) y, aparte y a la vista, cuántas fotos quedaron fuera de la
  // última selección.
  const [photoStatus, setPhotoStatus] = useState('')
  const [leftOutNotice, setLeftOutNotice] = useState<string | null>(null)
  const [prepareErrors, setPrepareErrors] = useState<string[]>([])
  const photos = usePhotoEntries({
    onSelected: (accepted, leftOut) => {
      const notice =
        leftOut > 0
          ? text.photosLeftOut(accepted, leftOut, MAX_PLANT_PHOTOS)
          : null
      setLeftOutNotice(notice)
      setPhotoStatus(notice ?? text.photosAdding(accepted))
    },
    onPrepared: (count) =>
      setPhotoStatus(text.photoAdded(count, MAX_PLANT_PHOTOS)),
    onPrepareFailed: (fileName, message) =>
      setPrepareErrors((list) => [
        ...list,
        text.photoPrepareFailed(fileName, message),
      ]),
  })
  const { entries } = photos
  // Si la persona ya eligió o quitó una foto: las del borrador, que llegan
  // después (IndexedDB es asíncrono), ya no las sustituyen; y desde entonces
  // cada cambio de las fotos se guarda en el borrador.
  const photosTouched = useRef(false)
  // Al editar: fotos guardadas que se borrarán al guardar, con su lugar, para
  // "Deshacer".
  const [removedStored, setRemovedStored] = useState<
    { entry: PhotoEntry; index: number }[]
  >([])
  const [storedLoad, setStoredLoad] = useState<StoredLoad>(
    editingPlant !== null ? 'loading' : 'ready',
  )
  const [storedAttempt, setStoredAttempt] = useState(0)
  const preparing = entries.some((entry) => entry.kind === 'preparing')
  const photoCount = entries.length
  const newPhotos = entries.filter(isNew)

  // Planta ya guardada cuyas fotos se están subiendo (o quitando) o no se
  // pudieron subir.
  const [registered, setRegistered] = useState<CollectionPlant | null>(null)
  const [phase, setPhase] = useState<PhotoPhase>({ status: 'working' })
  const latestPlant = useRef<CollectionPlant | null>(null)
  const uploadController = useRef<AbortController | null>(null)
  useEffect(() => () => uploadController.current?.abort(), [])
  const primaryRef = useRef<HTMLButtonElement>(null)
  const uploadAlertRef = useRef<HTMLDivElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const touch = useTouchDevice()
  const showCamera = camera === 'show' || (camera === 'auto' && touch)

  // Guarda el borrador de texto con cada cambio. Los valores con los que se
  // montó no se reescriben: recuperar un borrador no renueva su caducidad.
  // Con fotos el borrador se conserva aunque no haya nada escrito: lleva el
  // id de planta con el que van las fotos.
  const hasNewPhotos = newPhotos.length > 0
  useEffect(() => {
    if (draftOwner === null || values === start.values) return
    if (isPlantFormDirty(values, initial) || hasNewPhotos) {
      writePlantDraft(draftOwner, {
        plantId,
        values,
        savedAt: now().getTime(),
      })
    } else {
      clearPlantDraft(draftOwner)
    }
  }, [values, draftOwner, plantId, now, start.values, initial, hasNewPhotos])

  // Las fotos del borrador, en su orden, si van con su id de planta. Sin
  // borrador de texto, las que hubiera se borran.
  useEffect(() => {
    if (draftOwner === null) return
    let active = true
    void readDraftPhotos(photoDraftBackend, draftOwner, {
      plantId: start.draft?.plantId ?? null,
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
    const list = photos.current().filter(isNew)
    const savedAt = now().getTime()
    if (list.length > 0) {
      writePlantDraft(draftOwner, {
        plantId,
        values: valuesRef.current,
        savedAt,
      })
    } else if (!isPlantFormDirty(valuesRef.current, initial)) {
      clearPlantDraft(draftOwner)
    }
    void writeDraftPhotos(photoDraftBackend, draftOwner, {
      plantId,
      savedAt,
      photos: list.map(({ fileName, photo }) => ({ fileName, photo })),
    })
    // Solo cuando cambian las fotos (draftPhotosKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPhotosKey])

  // Al editar, las fotos ya guardadas. Se piden siempre: la planta en memoria
  // puede venir de la copia sin conexión, sin la foto que se añadió después.
  useEffect(() => {
    if (edit === null || draftUserId === null) return
    let active = true
    edit.listPhotos({ userId: draftUserId, plantId: edit.plant.id }).then(
      (stored) => {
        if (!active) return
        if (!photosTouched.current) {
          photos.replace(stored.map(storedPhotoEntry))
        }
        setStoredLoad('ready')
      },
      () => {
        if (active) setStoredLoad('error')
      },
    )
    return () => {
      active = false
    }
    // photos.replace es estable; se vuelve a pedir con "Volver a cargar".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, draftUserId, storedAttempt])

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

  /**
   * Fotos tras guardar la planta: al editar, primero borra las quitadas y
   * después sube las nuevas que faltan (todas, o solo `onlyKeys`). Termina
   * el registro si todo salió bien; si no, deja el formulario con los fallos.
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

    // 1. Las guardadas que se quitaron (al editar).
    let removeFailures = 0
    if (edit !== null && firstError === null) {
      for (const removal of removedStored) {
        if (removal.entry.kind !== 'stored' || draftUserId === null) continue
        try {
          await edit.removePhoto({
            userId: draftUserId,
            plantId: plant.id,
            photo: removal.entry.stored,
            onPlantUpdated,
          })
          setRemovedStored((list) => list.filter((item) => item !== removal))
        } catch (error) {
          removeFailures += 1
          firstError ??= photoStorageErrorFrom(error)
        }
      }
    }

    // 2. Las nuevas que aún no están guardadas.
    const all = photos.current()
    const pending = all.filter(
      (entry): entry is NewPhotoEntry =>
        isNew(entry) &&
        entry.upload.status !== 'saved' &&
        (onlyKeys === undefined || onlyKeys.includes(entry.key)),
    )
    const setUpload = (key: string, upload: NewPhotoEntry['upload']) =>
      photos.update((list) =>
        list.map((entry) =>
          entry.key === key && isNew(entry) ? { ...entry, upload } : entry,
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
      .some((entry) => isNew(entry) && entry.upload.status !== 'saved')
    if (firstError === null && !failedNow && removeFailures === 0) {
      onSaved(latestPlant.current ?? plant, {
        changed: true,
        photos: photos.current().length,
      })
      return
    }
    setPhase({
      status: 'failed',
      removeFailures,
      error: firstError ?? new PhotoStorageError('failed'),
    })
  }

  /**
   * Guarda la edición (#16): primero los datos que cambiaron (si cambió
   * alguno) y después las fotos, como al registrar: un fallo de las fotos no
   * pierde los cambios. Sin cambios, sale sin escribir nada.
   */
  const saveEdit = async (current: PlantFormEditing) => {
    // Si las fotos guardadas no llegaron a cargarse, se da por hecho que
    // siguen ahí: "en floración" no se toca.
    const anyPhoto = photoCount > 0 || storedLoad !== 'ready'
    const patch = plantPatch(
      { ...values, photoInBloom: values.photoInBloom && anyPhoto },
      initial,
    )
    let plant = current.plant
    changedRef.current = Object.keys(patch).length > 0
    if (changedRef.current) {
      savingRef.current = true
      setSave({ status: 'saving' })
      try {
        plant = await current.updatePlant(current.plant.id, patch)
      } catch (error) {
        savingRef.current = false
        setSave({ status: 'error', error: plantSaveErrorFrom(error) })
        return
      }
      savingRef.current = false
      setSave({ status: 'idle' })
      onPlantStored?.(plant)
    }
    if (newPhotos.length > 0 || removedStored.length > 0) {
      latestPlant.current = plant
      await runPhotoPhase(plant)
    } else {
      onSaved(plant, { changed: changedRef.current, photos: photoCount })
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current || !online || registered !== null) return
    // Con fotos a medio preparar no se guarda: el botón lo dice.
    if (preparing) return
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

    if (props.editing !== undefined) {
      await saveEdit(props.editing)
      return
    }
    savingRef.current = true
    setSave({ status: 'saving' })
    let plant: CollectionPlant
    try {
      // "En floración" solo tiene sentido con foto.
      plant = await props.services.savePlant(
        toPlantInsert(
          { ...values, photoInBloom: values.photoInBloom && photoCount > 0 },
          plantId,
        ),
      )
    } catch (error) {
      savingRef.current = false
      setSave({ status: 'error', error: plantSaveErrorFrom(error) })
      return
    }
    savingRef.current = false
    // La planta ya existe: el borrador (y sus fotos) sobran. Las fotos siguen
    // en memoria para subirlas y reintentarlo.
    if (draftOwner !== null) {
      clearPlantDraft(draftOwner)
      void clearDraftPhotos(photoDraftBackend, draftOwner)
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
        (entry) => !isNew(entry) || entry.upload.status === 'saved',
      ).length
    onSaved(latestPlant.current ?? registered, {
      changed: changedRef.current,
      photos: savedCount,
    })
  }

  const cancelUpload = () => uploadController.current?.abort()

  const openPicker = (input: HTMLInputElement | null) => {
    if (registered !== null || saving || !online) return
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
    if (removed.kind === 'stored') {
      setRemovedStored((list) => [...list, { entry: removed, index }])
      setPhotoStatus(text.storedPhotoRemoved(left, MAX_PLANT_PHOTOS))
    } else {
      setPhotoStatus(text.photoRemoved(left, MAX_PLANT_PHOTOS, index === 0))
    }
    // Sin fotos, "en floración" no tiene sentido.
    if (left === 0 && values.photoInBloom) {
      dispatch({ type: 'photoInBloomChanged', photoInBloom: false })
    }
  }

  const undoRemove = () => {
    const last = removedStored.at(-1)
    if (!last || registered !== null) return
    setRemovedStored((list) => list.slice(0, -1))
    photos.insert(last.entry, last.index)
    setPhotoStatus(text.storedPhotoRestored)
  }

  // Si hay algo que se perdería al salir: al registrar, lo escrito o las
  // fotos; al editar, cualquier cambio respecto de la planta.
  const dirty = editing
    ? Object.keys(plantPatch(values, initial)).length > 0 ||
      newPhotos.length > 0 ||
      entries.some((entry) => entry.kind === 'preparing') ||
      removedStored.length > 0
    : isPlantFormDirty(values, initial) || photoCount > 0

  const cancel = () => {
    if (saving || registered !== null) return
    if (dirty && !window.confirm(text.confirmDiscard)) return
    if (draftOwner !== null) {
      clearPlantDraft(draftOwner)
      void clearDraftPhotos(photoDraftBackend, draftOwner)
    }
    onCancel()
  }
  useEffect(() => {
    if (!cancelRef) return
    cancelRef.current = cancel
    return () => {
      cancelRef.current = null
    }
  })

  // Empieza de cero: formulario vacío con la fecha de hoy, sin fotos y otro
  // id de planta (el del borrador pudo llegar a la base en un intento
  // anterior).
  const discardDraft = () => {
    if (saving || registered !== null) return
    if (draftOwner !== null) {
      clearPlantDraft(draftOwner)
      void clearDraftPhotos(photoDraftBackend, draftOwner)
    }
    dispatch({
      type: 'restored',
      values: withName(
        initialPlantFormValues(localDateString(now())),
        initialName,
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

  // Miniaturas: las nuevas, de su Blob; las guardadas, de Storage.
  const thumbnailUrls = useObjectUrls(
    newPhotos.map((entry) => entry.photo.thumbnail.blob),
  )
  const storedUrls = useStoredThumbnails(
    entries.flatMap((entry) =>
      entry.kind === 'stored' ? [entry.stored.thumbnailPath] : [],
    ),
  )
  const galleryPhotos: GalleryPhoto[] = entries.map((entry) => {
    switch (entry.kind) {
      case 'preparing':
        return { id: entry.key, state: { status: 'preparing' } }
      case 'stored':
        return {
          id: entry.key,
          src: storedUrls.get(entry.stored.thumbnailPath),
          state: { status: 'ready' },
        }
      case 'new': {
        const src = thumbnailUrls.get(entry.photo.thumbnail.blob)
        const { upload } = entry
        switch (upload.status) {
          case 'idle':
            return { id: entry.key, src, state: { status: 'ready' } }
          case 'uploading':
            return {
              id: entry.key,
              src,
              state: { status: 'uploading', progress: upload.progress },
            }
          case 'saved':
            return { id: entry.key, src, state: { status: 'saved' } }
          case 'error':
            return {
              id: entry.key,
              src,
              state: {
                status: 'error',
                message:
                  upload.error.reason === 'aborted'
                    ? 'Cancelada'
                    : 'No se subió',
              },
            }
        }
      }
    }
  })

  const failedLabels = entries.flatMap((entry, index) =>
    isNew(entry) && entry.upload.status === 'error'
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
      : saving || preparing || !online

  // Al editar, el aviso de duplicado solo sale al cambiar de especie y no
  // cuenta la propia planta.
  const duplicateSpecies =
    editing && values.species?.id === initial.species?.id
      ? null
      : values.species
  const duplicateCandidates =
    editingPlant === null || knownPlants === null
      ? knownPlants
      : knownPlants.filter((known) => known.id !== editingPlant.id)
  const unlinkedSpecies =
    editing && unlinksSpecies(values, initial) && isPendingName(values)
      ? initial.species
      : null

  const fieldsDisabled = !online || registered !== null
  const galleryDisabled = fieldsDisabled || saving || storedLoad !== 'ready'

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
        />
        <DuplicateNotice
          species={duplicateSpecies}
          knownPlants={duplicateCandidates}
          after={text.duplicateAfter}
        />
        {/*
          Al editar, quitar la especie la devuelve a "por validar" (lo hace
          la base): se avisa antes de guardar, en una región ya montada.
        */}
        {editing && (
          <div role="status">
            {unlinkedSpecies !== null && (
              <p className="mt-space-2 flex items-start gap-space-2 rounded-lg bg-neutral-50 p-space-3 text-sm text-neutral-900">
                <Icon
                  name="triangle-alert"
                  className="mt-[2px] size-[16px] flex-none"
                />
                <span className="[overflow-wrap:anywhere]">
                  {PLANT_EDIT_NOTICE_TEXT.unlinkBefore}
                  <em className="font-display">
                    <ScientificName name={unlinkedSpecies.scientificName} />
                  </em>
                  {PLANT_EDIT_NOTICE_TEXT.unlinkAfter}
                </span>
              </p>
            )}
          </div>
        )}
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
        segmented
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

      <FormPair>
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
        <OriginField
          value={values.origin}
          dispatch={dispatch}
          knownPlants={knownPlants}
          error={errors.origin}
          inputRef={originRef}
        />
      </FormPair>
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
          <PendingPhotoNotice text={text} count={photoCount} newTab={editing} />
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
        {storedLoad === 'loading' ? text.photosLoading : photoStatus}
      </p>
      {storedLoad === 'loading' && (
        <p className="orki-gallery__notice">{text.photosLoading}</p>
      )}
      {leftOutNotice !== null && (
        <p className="orki-gallery__notice">{leftOutNotice}</p>
      )}
      {removedStored.length > 0 && registered === null && (
        <div className="flex flex-wrap items-center gap-space-3">
          <p className="orki-gallery__notice">
            {text.storedPhotosPending(removedStored.length)}
          </p>
          <Button onClick={undoRemove}>{text.undoRemove}</Button>
        </div>
      )}
      {storedLoad === 'error' && (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="orki-gallery__notice">
            {text.photosLoadFailed}
          </p>
          <Button
            onClick={() => {
              setStoredLoad('loading')
              setStoredAttempt((value) => value + 1)
            }}
          >
            {text.photosLoadRetry}
          </Button>
        </div>
      )}
      {prepareErrors.length > 0 && (
        <div role="alert" className="flex flex-col gap-space-1">
          {prepareErrors.map((message) => (
            <p
              key={message}
              className="flex items-start gap-space-2 text-sm text-danger"
            >
              <Icon
                name="triangle-alert"
                className="mt-[2px] size-[16px] flex-none"
              />
              {message}
            </p>
          ))}
        </div>
      )}
    </PhotoGallery>
  )

  const extra = (
    <fieldset disabled={fieldsDisabled} className="min-w-[0]">
      <Collapsible
        title={
          <span>
            {PLANT_FORM_TEXT.detailsTitle}{' '}
            <span className="font-normal text-neutral-700">
              {PLANT_FORM_TEXT.optional}
            </span>
          </span>
        }
        headingLevel={2}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        className="rounded-md border border-secondary"
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
        </div>
      </Collapsible>
    </fieldset>
  )

  return (
    <form
      noValidate
      aria-label={text.title}
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
            {text.offline}
          </p>
        )}
      </div>

      {/*
        Sin conexión, los campos quedan desactivados; lo escrito y las fotos
        se conservan. Con la planta ya guardada (subiendo sus fotos), no hay
        nada más que editar.
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
            <Button type="submit" aria-disabled={!online || undefined}>
              {PLANT_FORM_TEXT.retry}
            </Button>
            {save.error.reason === 'session-ended' && (
              <Link
                to={signInPathFor(
                  editingPlant
                    ? plantEditPath(editingPlant.id)
                    : PATHS.newPlant,
                )}
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
              : failedLabels.length > 0
                ? text.photosFailed(text.savedPrefix, failedLabels)
                : text.photosRemoveFailed(
                    text.savedPrefix,
                    failure.removeFailures,
                  )}
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
            !online && (registered === null || canRetry) ? offlineId : undefined
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
