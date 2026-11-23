import {
  useCallback,
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
import { Link, useNavigate } from 'react-router'
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
import type {
  CatalogSearchFunction,
  GenusSearchResult,
  SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { enumValues, type PlantType } from '../lib/database.ts'
import { localDateString } from '../lib/localDate.ts'
import {
  checkPlantPhotoDetails,
  MAX_PHOTO_NOTE_LENGTH,
  type PlantPhotoDetails,
} from '../photos/gallery.ts'
import { MAX_PLANT_PHOTOS } from '../photos/paths.ts'
import type { PlantPhotoRows, StoredPlantPhoto } from '../photos/photo-rows.ts'
import {
  EDIT_REUSE_MS,
  forgetPlantPhotosOf,
  recentPlantPhotos,
  rememberPlantPhotos,
} from '../photos/plant-photos-memory.ts'
import { PhotoStorageError, type PhotoStorage } from '../photos/storage.ts'
import { useObjectUrls } from '../photos/useObjectUrls.ts'
import { useStoredThumbnails } from '../photos/useStoredThumbnails.ts'
import {
  ChoiceField,
  FORM_CHIP_CLASSES,
  LOCKED_CHIP_CLASSES,
} from '../registration/ChoiceField.tsx'
import { DuplicateNotice } from '../registration/DuplicateNotice.tsx'
import {
  isPendingName,
  PLANT_TEXT_MAX_LENGTH,
  plantFormReducer,
  plantFormValuesFrom,
  plantPatch,
  unlinksSpecies,
  validatePlantForm,
  type FormGenus,
  type PlantFormErrors,
  type PlantFormField,
  type PlantFormValues,
  type PlantPatch,
} from '../registration/form-state.ts'
import { GenusField } from '../registration/GenusField.tsx'
import { NameField } from '../registration/NameField.tsx'
import { OriginField } from '../registration/OriginField.tsx'
import { PendingPhotoNotice } from '../registration/PendingPhotoNotice.tsx'
import { PlantSaveError } from '../registration/save-plant.ts'
import {
  SpeciesPreview,
  type LoadReferencePhoto,
} from '../registration/SpeciesPreview.tsx'
import {
  FLOWER_COLOR_LABEL,
  PLANT_EDIT_NOTICE_TEXT,
  PLANT_FORM_TEXT,
  PLANT_TYPE_LABEL,
} from '../registration/texts.ts'
import {
  storedPhotoEntry,
  usePhotoEntries,
  type NewPhotoEntry,
  type PhotoEntry,
} from '../registration/usePhotoEntries.ts'
import { useQuickGenera } from '../registration/useQuickGenera.ts'
import { PATHS, plantEditPath, signInPathFor } from '../routes/paths.ts'
import {
  applyPlantEdit,
  discardUploads,
  PlantEditError,
  type PlannedPhoto,
  type PlantEditEvent,
  type PlantEditPlan,
  type UploadedPhotos,
} from './edit-plan.ts'
import {
  PhotoManager,
  type ManagedPhoto,
  type ManagerAction,
  type PhotoDetailsErrors,
  type PhotoDetailsText,
} from './PhotoManager.tsx'
import { EDIT_TEXT } from './texts.ts'
import { useLeaveGuard } from './useLeaveGuard.tsx'

/** De dónde saca la edición los datos y dónde escribe. Estables entre pintados. */
export interface EditPlantServices {
  searchSpecies: CatalogSearchFunction<SpeciesSearchResult>
  searchGenera: CatalogSearchFunction<GenusSearchResult>
  loadQuickGenera: () => Promise<readonly FormGenus[]>
  loadReferencePhoto?: LoadReferencePhoto
  rows: PlantPhotoRows
  storage: PhotoStorage
  /** Guarda las columnas que cambiaron; rechaza con PlantSaveError. */
  updatePlant: (plantId: string, patch: PlantPatch) => Promise<CollectionPlant>
}

export interface EditPlantFormProps {
  /** La planta tal como está al abrir la edición; se lee al montarse. */
  plant: CollectionPlant
  /** Dueño de la planta y de sus fotos (id de Clerk). */
  userId: string | null
  services: EditPlantServices
  /** Con conexión y la sesión confirmada; si no, el formulario se desactiva. */
  online: boolean
  /** Plantas ya cargadas, para las sugerencias y el aviso de duplicado. */
  knownPlants: readonly CollectionPlant[] | null
  /** La fila de la planta cambió en la base (para la colección). */
  onPlantStored: (plant: CollectionPlant) => void
  /** Se guardó (o no había nada que guardar): salir a la ficha. */
  onSaved: (plant: CollectionPlant, outcome: { changed: boolean }) => void
  /** Salir sin guardar (ya confirmado si había cambios). */
  onCancel: () => void
  /** Se rellena con «Cancelar», para el enlace de volver de la cabecera. */
  cancelRef: RefObject<(() => void) | null>
  /** Reloj, para las pruebas. */
  now?: () => Date
}

const PLANT_TYPES: readonly PlantType[] = ['species', 'hybrid', 'unknown']

/** Campos en el orden de la pantalla: el primero con error recibe el foco. */
const FIELD_ORDER: readonly PlantFormField[] = [
  'name',
  'genus',
  'type',
  'acquiredOn',
  'location',
  'origin',
  'nickname',
]

/** Los de «Más detalles». */
const DETAIL_FIELDS: readonly PlantFormField[] = ['origin', 'nickname']

const deviceNow = () => new Date()

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'error'; error: PlantEditError }

/** Tope de las notas (restricción plants_notes_valid). */
const PLANT_NOTES_MAX_LENGTH = 2000

/** Notas como se guardan: sin espacios a los lados; vacías, null. */
function normalizeNotes(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/** Largo como lo cuenta Postgres (char_length). */
function characters(text: string): number {
  return [...text].length
}

function storedDetails(photo: StoredPlantPhoto): PhotoDetailsText {
  return {
    takenAt: photo.takenAt ?? '',
    note: photo.note ?? '',
    inBloom: photo.inBloom,
  }
}

const EMPTY_DETAILS: PhotoDetailsText = {
  takenAt: '',
  note: '',
  inBloom: false,
}

function sameDetails(a: PlantPhotoDetails, b: PlantPhotoDetails): boolean {
  return a.takenAt === b.takenAt && a.note === b.note && a.inBloom === b.inBloom
}

function isNew(entry: PhotoEntry): entry is NewPhotoEntry {
  return entry.kind === 'new'
}

/** Textos del error de un guardado: qué falló y, aparte, el motivo. */
function failureText(
  error: PlantEditError,
  labels: readonly string[],
): { title: string; reason: string | null } {
  if (error.plantGone) return { title: EDIT_TEXT.plantGone, reason: null }
  switch (error.step) {
    case 'upload':
      return { title: EDIT_TEXT.uploadFailed(labels), reason: error.message }
    case 'read':
      return { title: EDIT_TEXT.readFailed, reason: error.message }
    case 'data':
      return { title: error.message, reason: null }
    default:
      return { title: EDIT_TEXT.photosFailed, reason: error.message }
  }
}

function sessionEnded(error: PlantEditError): boolean {
  const cause: unknown = error.cause
  return (
    (cause instanceof PlantSaveError || cause instanceof PhotoStorageError) &&
    cause.reason === 'session-ended'
  )
}

/**
 * Formulario de edición de una planta (#266, rediseño del #16). Los mismos
 * campos, autocompletado y validación que el registro (form-state.ts y sus
 * campos), en dos columnas en escritorio: a la vista el nombre, el género, el
 * tipo, la fecha de adquisición y la ubicación; en «Más detalles» el origen,
 * el apodo, el color de la flor y las notas; a la derecha, las fotos. El
 * identificador no se edita (lo muestra la cabecera).
 *
 * Nada se guarda hasta «Guardar cambios»: quitar, añadir, ordenar, elegir la
 * principal y cambiar la fecha o la nota de una foto solo cambian el
 * formulario. Al guardar se aplica el plan de edit-plan.ts (ver allí el orden
 * y por qué es seguro); si falla, lo editado sigue aquí, se dice qué falló y
 * «Reintentar» sigue donde se quedó, sin duplicar nada. «Cancelar» no tiene
 * nada que deshacer.
 *
 * Salir con cambios sin guardar pregunta antes (useLeaveGuard): por un
 * enlace de la app, con «atrás», con «Cancelar» o «Volver a la ficha», o al
 * cerrar o recargar la pestaña. Mientras se guarda no se puede salir (#279):
 * esas vías solo avisan de que hay que esperar. Si el formulario se desmonta
 * de todos modos, no navega al terminar y lo que sobre se borra cuando el
 * intento en curso termina (discardUploads).
 */
export function EditPlantForm({
  plant,
  userId,
  services,
  online,
  knownPlants,
  onPlantStored,
  onSaved,
  onCancel,
  cancelRef,
  now = deviceNow,
}: EditPlantFormProps) {
  const [initial] = useState(() => plantFormValuesFrom(plant))
  const [values, dispatch] = useReducer(plantFormReducer, initial)
  const [submitted, setSubmitted] = useState(false)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  const savingRef = useRef(false)
  // Lo ya guardado de los datos en un intento anterior (para no reenviarlo).
  const savedValues = useRef<PlantFormValues>(initial)
  const savedNotes = useRef<string | null | undefined>(undefined)
  // Un intento ya dejó algo en la base (para el aviso al salir).
  const [partial, setPartial] = useState(false)
  // Archivos subidos de las fotos nuevas, de un intento al siguiente.
  const uploaded = useRef<UploadedPhotos>(new Map())
  // Si el formulario sigue montado (al terminar un guardado, #279).
  const mounted = useRef(false)
  const navigate = useNavigate()
  const [quickGenera, retryQuickGenera] = useQuickGenera(
    services.loadQuickGenera,
    online,
  )
  const today = localDateString(now())

  // Notas --------------------------------------------------------------------
  // Las de la planta de la colección. Una copia sin conexión anterior al #265
  // no las trae (null) y la lectura de la red puede llegar después: mientras
  // la persona no las toque, el campo sigue a la planta, y solo se envían si
  // las cambió (así no se pisan con null unas notas que sí están en la base).
  const originalNotes = plant.notes
  const [notes, setNotes] = useState(originalNotes ?? '')
  const notesTouched = useRef(false)
  useEffect(() => {
    if (!notesTouched.current) setNotes(originalNotes ?? '')
  }, [originalNotes])

  // Más detalles: abierta si algún campo suyo tiene valor (o error).
  const [detailsOpen, setDetailsOpen] = useState(
    () =>
      initial.origin.trim() !== '' ||
      initial.nickname.trim() !== '' ||
      initial.flowerColor !== null ||
      Boolean(originalNotes?.trim()),
  )
  const detailsToggled = useRef(false)
  useEffect(() => {
    if (originalNotes && !detailsToggled.current) setDetailsOpen(true)
  }, [originalNotes])

  // Fotos ----------------------------------------------------------------------
  const [photoStatus, setPhotoStatus] = useState('')
  const [leftOutNotice, setLeftOutNotice] = useState<string | null>(null)
  const [prepareErrors, setPrepareErrors] = useState<string[]>([])
  const photos = usePhotoEntries({
    onSelected: (accepted, leftOut) => {
      const notice =
        leftOut > 0
          ? EDIT_TEXT.photosLeftOut(accepted, leftOut, MAX_PLANT_PHOTOS)
          : null
      setLeftOutNotice(notice)
      setPhotoStatus(notice ?? EDIT_TEXT.photosAdding(accepted))
    },
    onPrepared: (count) =>
      setPhotoStatus(EDIT_TEXT.photoAdded(count, MAX_PLANT_PHOTOS)),
    onPrepareFailed: (fileName, message) =>
      setPrepareErrors((list) => [
        ...list,
        EDIT_TEXT.photoPrepareFailed(fileName, message),
      ]),
  })
  const { entries } = photos
  const [details, setDetails] = useState<Record<string, PhotoDetailsText>>({})
  // Las fotos tal como estaban (orden y datos), para saber si cambiaron.
  const [storedBefore, setStoredBefore] = useState<StoredPlantPhoto[]>([])
  const [removed, setRemoved] = useState<
    { entry: PhotoEntry; index: number }[]
  >([])
  // Fotos quitadas cuya fila ya borró un intento (#279): no se pueden
  // deshacer, pero sus archivos se borran al terminar de guardar.
  const [goneIds, setGoneIds] = useState<ReadonlySet<string>>(new Set())
  const undoable = removed.filter(
    ({ entry }) => entry.kind !== 'stored' || !goneIds.has(entry.stored.id),
  )
  const markGone = (ids: readonly string[]) => {
    if (ids.length > 0) setGoneIds((current) => new Set([...current, ...ids]))
  }
  const [storedLoad, setStoredLoad] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [storedAttempt, setStoredAttempt] = useState(0)
  const [managing, setManaging] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{
    key: string
    action: ManagerAction
  } | null>(null)
  const clearFocusTarget = useCallback(() => setFocusTarget(null), [])
  const manageButton = useRef<HTMLButtonElement>(null)
  const managerTitle = useRef<HTMLHeadingElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  // Las fotos guardadas: de plant_photos, no de la planta en memoria (puede
  // venir de la copia sin conexión). Si la ficha las acaba de leer, se usan
  // esas (#285, photos/plant-photos-memory.ts): el plan de guardado vuelve a
  // leerlas al empezar y concilia con ellas lo que haya cambiado entre tanto.
  useEffect(() => {
    if (userId === null) return
    let active = true
    const plantId = plant.id.toLowerCase()
    const remembered =
      storedAttempt === 0
        ? recentPlantPhotos(services.rows, userId, plantId, EDIT_REUSE_MS)
        : null
    // Solo si su principal es la de la planta: si no, algo cambió después.
    const recent =
      remembered &&
      (remembered[0]?.photoPath ?? null) === (plant.photoPath ?? null)
        ? remembered
        : null
    const read = recent
      ? Promise.resolve(recent)
      : services.rows.list(plantId, userId)
    read.then(
      (stored) => {
        if (!active) return
        if (!recent) rememberPlantPhotos(services.rows, userId, plantId, stored)
        photos.replace(stored.map(storedPhotoEntry))
        setStoredBefore(stored)
        setDetails(
          Object.fromEntries(
            stored.map((photo) => [
              storedPhotoEntry(photo).key,
              storedDetails(photo),
            ]),
          ),
        )
        setStoredLoad('ready')
      },
      () => {
        if (active) setStoredLoad('error')
      },
    )
    return () => {
      active = false
    }
    // photos.replace es estable; se vuelve a pedir con «Volver a cargar».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.rows, plant.id, userId, storedAttempt])

  const detailsOf = (entry: PhotoEntry): PhotoDetailsText =>
    details[entry.key] ??
    (entry.kind === 'stored' ? storedDetails(entry.stored) : EMPTY_DETAILS)

  // Cambios ------------------------------------------------------------------
  const patchFor = (
    base: PlantFormValues,
    notesBase: string | null | undefined,
  ) => {
    // «En flor» es de cada foto (Gestionar fotos): la planta no lo cambia aquí.
    const patch: PlantPatch = plantPatch(
      { ...values, photoInBloom: base.photoInBloom },
      base,
    )
    const nextNotes = normalizeNotes(notes)
    if (notesBase !== undefined && nextNotes !== notesBase) {
      patch.notes = nextNotes
    }
    return patch
  }
  const dataDirty = Object.keys(patchFor(initial, originalNotes)).length > 0
  const photosDirty =
    removed.length > 0 ||
    entries.some((entry) => entry.kind !== 'stored') ||
    entries.length !== storedBefore.length ||
    entries.some((entry, index) => {
      if (entry.kind !== 'stored') return true
      const before = storedBefore[index]
      if (before?.id !== entry.stored.id) return true
      const current = checkPlantPhotoDetails(detailsOf(entry), today).details
      return !sameDetails(current, {
        takenAt: before.takenAt,
        note: before.note,
        inBloom: before.inBloom,
      })
    })
  // Tras un guardado a medias la base ya no es la de antes: guardar aplica el
  // plan aunque el formulario vuelva a verse como al abrirlo (por ejemplo,
  // tras quitar una foto nueva que ya tenía fila).
  const dirty = dataDirty || photosDirty || partial

  // Errores (desde el primer intento de guardar) -------------------------------
  const errors: PlantFormErrors = submitted
    ? validatePlantForm(values, today)
    : {}
  const notesError =
    submitted && characters(notes.trim()) > PLANT_NOTES_MAX_LENGTH
      ? EDIT_TEXT.notesTooLong(PLANT_NOTES_MAX_LENGTH)
      : undefined
  const photoErrors = (entry: PhotoEntry): PhotoDetailsErrors => {
    if (!submitted || entry.kind === 'preparing') return {}
    const { problems } = checkPlantPhotoDetails(detailsOf(entry), today)
    return {
      takenAt:
        problems.takenAt === 'future'
          ? EDIT_TEXT.photoDateFuture
          : problems.takenAt === 'invalid'
            ? EDIT_TEXT.photoDateInvalid
            : undefined,
      note: problems.note
        ? EDIT_TEXT.photoNoteTooLong(MAX_PHOTO_NOTE_LENGTH)
        : undefined,
    }
  }

  const saving = save.status === 'saving'
  const guard = useLeaveGuard({ dirty, partial, busy: saving })

  // Al desmontarse (se salió, con o sin preguntar), se borran los archivos
  // subidos que no llegaron a tener fila y los de las fotos quitadas cuya
  // fila ya borró un intento. discardUploads espera a que termine
  // el intento en curso, si lo hay: hasta entonces puede crear la fila que
  // los cita.
  const discardRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    discardRef.current = () => {
      if (userId === null) return
      void discardUploads(
        uploaded.current,
        { userId, plantId: plant.id },
        services,
        removed.flatMap(({ entry }) =>
          entry.kind === 'stored' ? [entry.stored] : [],
        ),
      )
    }
  })
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      discardRef.current()
    }
  }, [])

  const preparing = entries.some((entry) => entry.kind === 'preparing')
  const locked = values.species !== null

  const cancel = () => {
    if (saving) return
    guard.requestLeave(onCancel)
  }
  useEffect(() => {
    // «Volver a la ficha»: durante un guardado avisa de que hay que esperar.
    cancelRef.current = () => guard.requestLeave(onCancel)
    return () => {
      cancelRef.current = null
    }
  })

  // Foco de los campos -----------------------------------------------------------
  const offlineId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const genusRef = useRef<HTMLDivElement>(null)
  const typeRef = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const originRef = useRef<HTMLInputElement>(null)
  const locationRef = useRef<HTMLInputElement>(null)
  const nicknameRef = useRef<HTMLInputElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  const focusField = (field: PlantFormField) => {
    switch (field) {
      case 'name':
        nameRef.current?.focus()
        return
      case 'genus':
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

  // Fotos: acciones ------------------------------------------------------------------
  const setUpload = (key: string, upload: NewPhotoEntry['upload']) =>
    photos.update((list) =>
      list.map((entry) =>
        entry.key === key && isNew(entry) ? { ...entry, upload } : entry,
      ),
    )

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0) return
    setPrepareErrors([])
    photos.add(files)
  }

  const openPicker = () => {
    if (saving || !online || storedLoad !== 'ready') return
    filesInput.current?.click()
  }

  const removePhoto = (key: string) => {
    if (saving) return
    const list = photos.current()
    const index = list.findIndex((entry) => entry.key === key)
    const entry = photos.remove(key)
    if (entry === null) return
    if (entry.kind === 'stored') {
      setRemoved((items) => [...items, { entry, index }])
    }
    setLeftOutNotice(null)
    const left = photos.current()
    setPhotoStatus(
      EDIT_TEXT.photoRemoved(left.length, MAX_PLANT_PHOTOS, index === 0),
    )
    // El foco: al «Quitar» de la que ocupa su lugar, o al de la anterior.
    const next = left[Math.min(index, left.length - 1)]
    setFocusTarget(
      next
        ? { key: next.key, action: 'remove' }
        : { key: '', action: 'remove' },
    )
  }

  const undoRemove = () => {
    const last = undoable.at(-1)
    if (!last || saving) return
    setRemoved((items) => items.filter((item) => item !== last))
    photos.insert(last.entry, last.index)
    setPhotoStatus(EDIT_TEXT.photoRestored)
  }

  const movePhoto = (key: string, offset: -1 | 1) => {
    const list = [...photos.current()]
    const from = list.findIndex((entry) => entry.key === key)
    const to = from + offset
    const moving = list[from]
    const other = list[to]
    if (from === -1 || !moving || !other) return
    list[from] = other
    list[to] = moving
    photos.replace(list)
    setPhotoStatus(
      to === 0 ? EDIT_TEXT.madeMain : EDIT_TEXT.moved(to + 1, list.length),
    )
    setFocusTarget({ key, action: offset === -1 ? 'earlier' : 'later' })
  }

  const makeMain = (key: string) => {
    const list = photos.current()
    const moving = list.find((entry) => entry.key === key)
    if (!moving) return
    photos.replace([moving, ...list.filter((entry) => entry.key !== key)])
    setPhotoStatus(EDIT_TEXT.madeMain)
    setFocusTarget({ key, action: 'main' })
  }

  const changeDetails = (key: string, change: Partial<PhotoDetailsText>) => {
    const entry = photos.current().find((item) => item.key === key)
    if (!entry) return
    setDetails((current) => ({
      ...current,
      [key]: { ...detailsOf(entry), ...change },
    }))
  }

  const openManager = () => {
    if (saving) return
    flushSync(() => setManaging(true))
    managerTitle.current?.focus()
  }

  const closeManager = () => {
    flushSync(() => setManaging(false))
    manageButton.current?.focus()
  }

  // Guardar ------------------------------------------------------------------------
  const planFrom = (): PlantEditPlan | null => {
    if (userId === null) return null
    const planned: PlannedPhoto[] = []
    for (const entry of photos.current()) {
      const { details: normalized } = checkPlantPhotoDetails(
        detailsOf(entry),
        today,
      )
      if (entry.kind === 'stored') {
        planned.push({
          kind: 'stored',
          key: entry.key,
          stored: entry.stored,
          details: normalized,
        })
      } else if (entry.kind === 'new') {
        planned.push({
          kind: 'new',
          key: entry.key,
          files: entry.photo,
          details: normalized,
        })
      }
    }
    return {
      userId,
      plantId: plant.id,
      patch: patchFor(
        savedValues.current,
        savedNotes.current === undefined ? originalNotes : savedNotes.current,
      ),
      photos: planned,
      removed: removed.flatMap(({ entry }) =>
        entry.kind === 'stored' ? [entry.stored] : [],
      ),
    }
  }

  // Conciliar el formulario con las filas leídas al empezar un intento
  // (#279): lo que otro intento u otro dispositivo ya cambió.
  const reconcile = (rows: readonly StoredPlantPhoto[]) => {
    const ids = new Set(rows.map((row) => row.id))
    const uploadedPaths = new Set(
      [...uploaded.current.values()].map((paths) => paths.photoPath),
    )
    const known = new Set([
      ...photos
        .current()
        .flatMap((entry) => (entry.kind === 'stored' ? [entry.stored.id] : [])),
      ...removed.flatMap(({ entry }) =>
        entry.kind === 'stored' ? [entry.stored.id] : [],
      ),
    ])
    const foreign = rows.filter(
      (row) => !known.has(row.id) && !uploadedPaths.has(row.photoPath),
    )
    // Guardadas sin fila: se quitaron en otro lado.
    photos.update((list) => [
      ...list.filter(
        (entry) => entry.kind !== 'stored' || ids.has(entry.stored.id),
      ),
      ...foreign.map(storedPhotoEntry),
    ])
    if (foreign.length > 0) {
      setDetails((current) => ({
        ...current,
        ...Object.fromEntries(
          foreign.map((row) => [storedPhotoEntry(row).key, storedDetails(row)]),
        ),
      }))
    }
    // Quitadas cuya fila ya no está: ya no se pueden deshacer.
    markGone(
      removed.flatMap(({ entry }) =>
        entry.kind === 'stored' && !ids.has(entry.stored.id)
          ? [entry.stored.id]
          : [],
      ),
    )
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current || !online || preparing || storedLoad !== 'ready') {
      return
    }
    setSubmitted(true)
    const found = validatePlantForm(values, today)
    const firstInvalid = FIELD_ORDER.find((field) => found[field])
    const notesTooLong = characters(notes.trim()) > PLANT_NOTES_MAX_LENGTH
    if (firstInvalid || notesTooLong) {
      // Un error dentro de «Más detalles» la abre, para que se vea.
      const inDetails =
        notesTooLong ||
        (firstInvalid !== undefined && DETAIL_FIELDS.includes(firstInvalid))
      if (inDetails) flushSync(() => setDetailsOpen(true))
      if (firstInvalid) focusField(firstInvalid)
      else notesRef.current?.focus()
      return
    }
    // La fecha y la nota de cada foto: con algún error, se abre la gestión
    // de fotos y el foco va al primer campo mal.
    const badPhoto = photos.current().find((entry) => {
      if (entry.kind === 'preparing') return false
      const { problems } = checkPlantPhotoDetails(detailsOf(entry), today)
      return problems.takenAt !== undefined || problems.note !== undefined
    })
    if (badPhoto) {
      const { problems } = checkPlantPhotoDetails(detailsOf(badPhoto), today)
      flushSync(() => setManaging(true))
      document
        .querySelector<HTMLElement>(
          `[data-foto="${badPhoto.key}"][data-campo="${problems.takenAt ? 'takenAt' : 'note'}"]`,
        )
        ?.focus()
      return
    }

    if (!dirty) {
      void guard.leave(() => onSaved(plant, { changed: false }))
      return
    }
    const plan = planFrom()
    if (plan === null) {
      setSave({
        status: 'error',
        error: new PlantEditError('data', new PlantSaveError('session-ended')),
      })
      return
    }

    savingRef.current = true
    setSave({ status: 'saving' })
    setManaging(false)
    for (const entry of photos.current()) {
      if (isNew(entry) && entry.upload.status === 'error') {
        setUpload(entry.key, { status: 'idle' })
      }
    }
    const onEvent = (edit: PlantEditEvent) => {
      switch (edit.type) {
        case 'upload-progress':
          setUpload(edit.key, { status: 'uploading', progress: edit.progress })
          return
        case 'uploaded':
          setUpload(edit.key, { status: 'uploading', progress: 1 })
          return
        case 'upload-failed':
          setUpload(edit.key, { status: 'error', error: edit.error })
          return
        case 'data-saved':
          savedValues.current = values
          savedNotes.current = normalizeNotes(notes)
          setPartial(true)
          onPlantStored(edit.plant)
          return
        case 'photos-written':
          setPartial(true)
          return
        case 'rows-read':
          reconcile(edit.rows)
          return
        case 'row-removed':
          markGone([edit.id])
          return
      }
    }
    try {
      const result = await applyPlantEdit(
        plan,
        services,
        uploaded.current,
        onEvent,
      )
      if (result.plant) onPlantStored(result.plant)
      // Las filas como quedaron: la ficha no las vuelve a leer al volver.
      rememberPlantPhotos(
        services.rows,
        plan.userId,
        plan.plantId,
        result.photos,
        'saved',
      )
      savingRef.current = false
      // Si la persona ya no está en la edición, no se la lleva a la ficha.
      if (!mounted.current) return
      await guard.leave(() => {
        if (mounted.current) onSaved(result.plant ?? plant, { changed: true })
      })
    } catch (error) {
      savingRef.current = false
      // Pudo quedar a medias: lo recordado de la planta ya no vale.
      forgetPlantPhotosOf(services.rows, plan.userId, plan.plantId)
      // Las que sí se subieron vuelven a verse como pendientes: aún no son
      // de la planta (solo las que fallaron dicen «No se subió»).
      photos.update((list) =>
        list.map((entry) =>
          isNew(entry) && entry.upload.status === 'uploading'
            ? { ...entry, upload: { status: 'idle' } }
            : entry,
        ),
      )
      setSave({
        status: 'error',
        error:
          error instanceof PlantEditError
            ? error
            : new PlantEditError('data', error),
      })
    }
  }

  // Tras un fallo, el mensaje se ve y el foco va a «Reintentar» (o a «Ir a
  // Mi colección», si la planta ya no existe).
  const failure = save.status === 'error' ? save.error : null
  const retryRef = useRef<HTMLButtonElement>(null)
  const collectionRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (failure === null) return
    alertRef.current?.scrollIntoView?.({ block: 'center' })
    ;(collectionRef.current ?? retryRef.current)?.focus()
  }, [failure])

  // Miniaturas: las nuevas, de su Blob; las guardadas, de Storage.
  const newEntries = entries.filter(isNew)
  const thumbnailUrls = useObjectUrls(
    newEntries.map((entry) => entry.photo.thumbnail.blob),
  )
  const storedUrls = useStoredThumbnails(
    entries.flatMap((entry) =>
      entry.kind === 'stored' ? [entry.stored.thumbnailPath] : [],
    ),
  )
  const srcOf = (entry: PhotoEntry): string | undefined =>
    entry.kind === 'stored'
      ? storedUrls.get(entry.stored.thumbnailPath)
      : entry.kind === 'new'
        ? thumbnailUrls.get(entry.photo.thumbnail.blob)
        : undefined

  const galleryPhotos: GalleryPhoto[] = entries.map((entry) => {
    const src = srcOf(entry)
    if (entry.kind === 'preparing') {
      return { id: entry.key, state: { status: 'preparing' } }
    }
    if (entry.kind === 'stored') {
      return { id: entry.key, src, state: { status: 'ready' } }
    }
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
          state: { status: 'error', message: EDIT_TEXT.photoNotUploaded },
        }
    }
  })

  const managed: ManagedPhoto[] = entries.map((entry) => ({
    key: entry.key,
    src: srcOf(entry),
    isNew: entry.kind !== 'stored',
    preparing: entry.kind === 'preparing',
    details: detailsOf(entry),
    errors: photoErrors(entry),
  }))

  const failedLabels = failure
    ? entries.flatMap((entry, index) =>
        failure.failedKeys.includes(entry.key)
          ? [galleryPhotoLabel(index, entries.length)]
          : [],
      )
    : []

  // El aviso de duplicado solo sale al cambiar de especie y no cuenta la
  // propia planta.
  const duplicateSpecies =
    values.species?.id === initial.species?.id ? null : values.species
  const duplicateCandidates =
    knownPlants === null
      ? null
      : knownPlants.filter((known) => known.id !== plant.id)
  const unlinkedSpecies =
    unlinksSpecies(values, initial) && isPendingName(values)
      ? initial.species
      : null

  const fieldsDisabled = !online || saving
  const galleryDisabled = fieldsDisabled || storedLoad !== 'ready'
  const photoCount = entries.length

  const main = (
    <fieldset
      disabled={fieldsDisabled}
      className="flex min-w-[0] flex-col gap-space-5"
    >
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
          after={EDIT_TEXT.duplicateAfter}
        />
        {duplicateSpecies !== null && services.loadReferencePhoto && (
          <SpeciesPreview
            speciesId={duplicateSpecies.id}
            scientificName={duplicateSpecies.scientificName}
            load={services.loadReferencePhoto}
          />
        )}
        {/*
          Quitar la especie devuelve la planta a "por validar" (lo hace la
          base): se avisa antes de guardar, en una región ya montada.
        */}
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
          field="location"
          value={values.location}
          dispatch={dispatch}
          knownPlants={knownPlants}
          error={errors.location}
          inputRef={locationRef}
        />
      </FormPair>
    </fieldset>
  )

  const notesHintId = `${offlineId}-notas-ayuda`
  const notesErrorId = `${offlineId}-notas-error`
  const notesId = `${offlineId}-notas`

  const extra = (
    <fieldset disabled={fieldsDisabled} className="min-w-[0]">
      <Collapsible
        title={
          <span>
            {EDIT_TEXT.detailsTitle}{' '}
            <span className="font-normal text-neutral-700">
              {EDIT_TEXT.optional}
            </span>
          </span>
        }
        headingLevel={2}
        open={detailsOpen}
        onOpenChange={(open) => {
          detailsToggled.current = true
          setDetailsOpen(open)
        }}
        className="rounded-md border border-secondary"
      >
        <div className="flex flex-col gap-space-5 pt-space-3">
          <OriginField
            value={values.origin}
            dispatch={dispatch}
            knownPlants={knownPlants}
            error={errors.origin}
            inputRef={originRef}
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
          <div className="orki-field">
            <label className="orki-field__label" htmlFor={notesId}>
              {EDIT_TEXT.notesLabel}
            </label>
            <textarea
              ref={notesRef}
              id={notesId}
              className="orki-field__input"
              rows={4}
              value={notes}
              autoCapitalize="sentences"
              aria-invalid={notesError ? true : undefined}
              aria-describedby={[notesError ? notesErrorId : '', notesHintId]
                .filter(Boolean)
                .join(' ')}
              onChange={(event) => {
                notesTouched.current = true
                setNotes(event.target.value)
              }}
            />
            {notesError && (
              <span className="orki-field__error" id={notesErrorId}>
                <Icon name="triangle-alert" />
                {notesError}
              </span>
            )}
            <span className="orki-field__hint" id={notesHintId}>
              {`${EDIT_TEXT.notesHint} ${EDIT_TEXT.notesCount(
                characters(notes.trim()),
                PLANT_NOTES_MAX_LENGTH,
              )}`}
            </span>
          </div>
        </div>
      </Collapsible>
    </fieldset>
  )

  const galleryChildren = (
    <>
      {/* Solo para el lector: la galería ya lo muestra. */}
      <p role="status" className="sr-only">
        {storedLoad === 'loading' ? EDIT_TEXT.photosLoading : photoStatus}
      </p>
      {storedLoad === 'loading' && (
        <p className="orki-gallery__notice">{EDIT_TEXT.photosLoading}</p>
      )}
      {leftOutNotice !== null && (
        <p className="orki-gallery__notice">{leftOutNotice}</p>
      )}
      {undoable.length > 0 && (
        <div className="flex flex-wrap items-center gap-space-3">
          <p className="orki-gallery__notice">
            {EDIT_TEXT.removedPending(undoable.length)}
          </p>
          <Button aria-disabled={saving || undefined} onClick={undoRemove}>
            {EDIT_TEXT.undoRemove}
          </Button>
        </div>
      )}
      {storedLoad === 'error' && (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="orki-gallery__notice">
            {EDIT_TEXT.photosLoadFailed}
          </p>
          <Button
            onClick={() => {
              setStoredLoad('loading')
              setStoredAttempt((value) => value + 1)
            }}
          >
            {EDIT_TEXT.photosLoadRetry}
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
    </>
  )

  const aside = (
    <>
      {managing ? (
        <PhotoManager
          photos={managed}
          max={MAX_PLANT_PHOTOS}
          disabled={galleryDisabled}
          today={today}
          onMakeMain={makeMain}
          onMove={movePhoto}
          onRemove={removePhoto}
          onDetails={changeDetails}
          onAdd={openPicker}
          onDone={closeManager}
          focusTarget={focusTarget}
          onFocused={clearFocusTarget}
          titleRef={managerTitle}
        >
          {galleryChildren}
        </PhotoManager>
      ) : (
        <PhotoGallery
          // «Añadir fotos» y «Gestionar fotos», cada uno a todo el ancho: en
          // la columna de la galería no caben dos en una fila sin partirse.
          className="[&_.orki-gallery\_\_actions]:grid-cols-[minmax(0,1fr)]"
          photos={galleryPhotos}
          max={MAX_PLANT_PHOTOS}
          title={EDIT_TEXT.photosTitle}
          titleSuffix=""
          disabled={galleryDisabled}
          chooseLabel={EDIT_TEXT.addPhotos}
          chooseIcon="plus"
          onChoosePhotos={openPicker}
          extraActions={
            photoCount > 0 ? (
              <Button
                ref={manageButton}
                icon="image"
                aria-disabled={galleryDisabled || undefined}
                onClick={() => {
                  if (!galleryDisabled) openManager()
                }}
              >
                {EDIT_TEXT.managePhotos}
              </Button>
            ) : undefined
          }
          notice={
            isPendingName(values) ? (
              <PendingPhotoNotice count={photoCount} newTab />
            ) : undefined
          }
        >
          {galleryChildren}
        </PhotoGallery>
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
    </>
  )

  const failureCopy = failure ? failureText(failure, failedLabels) : null
  const primaryText = saving
    ? EDIT_TEXT.submitting
    : preparing
      ? EDIT_TEXT.photosPreparing
      : EDIT_TEXT.submit
  const primaryBlocked =
    saving || preparing || !online || storedLoad !== 'ready'

  return (
    <form
      noValidate
      aria-label={EDIT_TEXT.title}
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
            {EDIT_TEXT.offline}
          </p>
        )}
      </div>

      {/*
        «Más detalles» va con los datos, en la misma columna (no como `extra`
        de FormLayout): así, al abrir «Gestionar fotos», la columna de las
        fotos crece sola sin abrir un hueco entre la ubicación y «Más
        detalles»; y en el celular queda antes de las fotos, como en la
        maqueta.
      */}
      <FormLayout
        main={
          <>
            {main}
            {extra}
          </>
        }
        aside={aside}
      />

      {failure !== null && failureCopy !== null && (
        <div
          ref={alertRef}
          role="alert"
          className="flex flex-col items-start gap-space-3 rounded-lg bg-danger-soft p-space-4 text-sm text-neutral-900"
        >
          <p className="flex items-start gap-space-2 font-semibold">
            <Icon
              name="triangle-alert"
              className="mt-[2px] size-[16px] flex-none text-danger"
            />
            {failureCopy.title}
          </p>
          {failureCopy.reason !== null && <p>{failureCopy.reason}</p>}
          {failure.plantGone ? (
            <Link
              ref={collectionRef}
              to={PATHS.collection}
              className="orki-btn orki-btn--secondary"
              data-sin-aviso=""
              onClick={(event) => {
                event.preventDefault()
                // No queda nada que guardar: se sale sin preguntar.
                void guard.leave(() => void navigate(PATHS.collection))
              }}
            >
              {EDIT_TEXT.goToCollection}
            </Link>
          ) : (
            <>
              <p>{partial ? EDIT_TEXT.partlySaved : EDIT_TEXT.nothingSaved}</p>
              <div className="flex flex-wrap gap-space-3">
                <Button
                  ref={retryRef}
                  type="submit"
                  aria-disabled={!online || undefined}
                  aria-describedby={!online ? offlineId : undefined}
                >
                  {EDIT_TEXT.retry}
                </Button>
                {sessionEnded(failure) && (
                  <Link
                    to={signInPathFor(plantEditPath(plant.id))}
                    className="orki-btn orki-btn--secondary"
                    data-sin-aviso=""
                  >
                    {EDIT_TEXT.signIn}
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <FormActions>
        <Button
          className="orki-formactions__secondary"
          aria-disabled={saving || undefined}
          onClick={cancel}
        >
          {EDIT_TEXT.cancel}
        </Button>
        <Button
          type="submit"
          variant="primary"
          aria-disabled={primaryBlocked || undefined}
          aria-describedby={!online ? offlineId : undefined}
        >
          {primaryText}
        </Button>
      </FormActions>
      {guard.dialog}
    </form>
  )
}
