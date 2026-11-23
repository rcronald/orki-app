import { useEffect, useId, useRef, useState, type Ref } from 'react'
import { Link } from 'react-router'
import sinFoto from '../assets/sin-foto.svg?inline'
import type { CollectionPlant } from '../collection/model.ts'
import type { ReadOnlyReason } from '../collection/useReadOnly.ts'
import { Button } from '../components/ui/Button.tsx'
import { galleryPhotoLabel } from '../components/ui/gallery-label.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { PhotoLightbox } from '../components/ui/PhotoLightbox.tsx'
import { ReferencePhoto } from '../components/ui/ReferencePhoto.tsx'
import type { ReferencePicture } from '../lib/referencePhotos.ts'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import {
  orderWithMain,
  orderWithMove,
  type PlantPhotoDetails,
  type ReorderPlantPhotosResult,
  type UpdatePlantPhotoResult,
} from '../photos/gallery.ts'
import type { StoredPlantPhoto } from '../photos/photo-rows.ts'
import { PhotoStorageError } from '../photos/storage.ts'
import { usePlantImage } from '../photos/usePlantImage.ts'
import { plantEditPath } from '../routes/paths.ts'
import { formatCalendarDate } from './format.ts'
import { FROM_DETAIL } from './navigation.ts'
import { PhotoDetailsForm } from './PhotoDetailsForm.tsx'
import { GALLERY_ERROR_TEXT, GALLERY_TEXT } from './texts.ts'
import type { PlantGallery as PlantGalleryData } from './usePlantGallery.ts'

/** Lo que hace la galería en la base; la página pasa los de gallery.ts. */
export interface PlantGalleryServices {
  updatePhoto: (options: {
    photo: StoredPlantPhoto
    main: boolean
    details: PlantPhotoDetails
  }) => Promise<UpdatePlantPhotoResult>
  reorderPhotos: (options: {
    photos: readonly StoredPlantPhoto[]
    order: readonly string[]
  }) => Promise<ReorderPlantPhotosResult>
}

interface PlantGalleryProps {
  plant: CollectionPlant
  gallery: PlantGalleryData
  /** null si se puede escribir; si no, por qué no (#18). */
  readOnly: ReadOnlyReason | null
  services: PlantGalleryServices
  /** La planta releída tras cambiar la principal o su «en flor». */
  onPlantUpdated: (plant: CollectionPlant) => void
  /**
   * La foto de referencia de su especie (#234): solo se muestra mientras la
   * planta no tiene ninguna foto propia, en lugar del hueco vacío.
   */
  reference?: ReferencePicture | null
  /**
   * id de un motivo que la página ya muestra cuando no se puede escribir (la
   * ficha lo pone arriba, #265): si se pasa, la galería lo cita y no pinta el
   * suyo.
   */
  reasonId?: string
}

/** Texto del error de una escritura; recarga si la galería cambió. */
function errorText(failure: unknown): {
  text: string
  reload: boolean
} {
  const reason = failure instanceof PhotoStorageError ? failure.reason : null
  switch (reason) {
    case 'offline':
    case 'session-ended':
      return { text: GALLERY_ERROR_TEXT[reason], reload: false }
    case 'not-found':
      return { text: GALLERY_ERROR_TEXT['not-found'], reload: true }
    case 'position-taken':
      return { text: GALLERY_ERROR_TEXT.changed, reload: true }
    default:
      return { text: GALLERY_ERROR_TEXT.failed, reload: false }
  }
}

/** Fecha, «en flor» y nota de una foto; nada si no tiene. */
export function PhotoFacts({ photo }: { photo: StoredPlantPhoto }) {
  if (photo.takenAt === null && photo.note === null && !photo.inBloom) {
    return null
  }
  return (
    <div className="orki-viewer__facts">
      {(photo.takenAt !== null || photo.inBloom) && (
        <p className="orki-viewer__meta">
          {photo.takenAt !== null && (
            <span>
              {GALLERY_TEXT.takenAt(formatCalendarDate(photo.takenAt))}
            </span>
          )}
          {photo.inBloom && (
            <span className="orki-match">
              <Icon name="flower-2" />
              {GALLERY_TEXT.inBloom}
            </span>
          )}
        </p>
      )}
      {photo.note !== null && <p className="orki-viewer__note">{photo.note}</p>}
    </div>
  )
}

/** La planta sin ninguna foto (#265): el marcador sin-foto.svg, pequeño. */
function EmptyPhoto() {
  return (
    <p className="flex items-center gap-space-3 text-md text-neutral-900">
      <img
        className="size-[64px] flex-none rounded-md object-cover"
        src={sinFoto}
        alt={GALLERY_TEXT.noPhoto}
        width={64}
        height={64}
      />
      {GALLERY_TEXT.empty}
    </p>
  )
}

/** Hueco de una foto que no está: sin conexión o que no se pudo cargar. */
function Missing({ online, compact }: { online: boolean; compact?: boolean }) {
  return (
    <span className="orki-viewer__missing">
      <Icon name="cloud-off" />
      {!compact && (online ? GALLERY_TEXT.failed : GALLERY_TEXT.unavailable)}
    </span>
  )
}

/**
 * La foto grande de la página: la miniatura de la elegida (la foto completa
 * solo se descarga en el visor). Siempre el mismo botón, así el foco vuelve a
 * él al cerrar el visor.
 */
function MainPhoto({
  photo,
  alt,
  onOpen,
  buttonRef,
}: {
  photo: StoredPlantPhoto
  alt: string
  onOpen: () => void
  buttonRef: Ref<HTMLButtonElement>
}) {
  const image = usePlantImage(photo.thumbnailPath, 'thumbnail')
  const online = useOnlineStatus()
  return (
    <button
      ref={buttonRef}
      type="button"
      // 3:2 en lugar del 4:3 del sistema y, hasta 720 px, como mucho 240 px de
      // alto: así se llega pronto a los datos y a la bitácora (#265).
      className="orki-viewer__main aspect-[3/2] publico-estrecho:max-h-[240px]"
      aria-label={GALLERY_TEXT.open(alt)}
      onClick={onOpen}
    >
      {image.status === 'ready' ? (
        <img
          className="orki-viewer__photo"
          src={image.src}
          alt={alt}
          decoding="async"
        />
      ) : image.status === 'error' ? (
        <Missing online={online} />
      ) : null}
    </button>
  )
}

function Thumb({
  photo,
  label,
  selected,
  onSelect,
}: {
  photo: StoredPlantPhoto
  label: string
  selected: boolean
  onSelect: () => void
}) {
  const image = usePlantImage(photo.thumbnailPath, 'thumbnail')
  const online = useOnlineStatus()
  const state =
    image.status === 'error'
      ? online
        ? GALLERY_TEXT.failed
        : GALLERY_TEXT.unavailable
      : null
  return (
    <li className="w-[64px] publico-estrecho:w-[48px]">
      <button
        type="button"
        className="orki-viewer__thumb"
        aria-pressed={selected}
        aria-label={state ? `${label}: ${state}` : label}
        onClick={onSelect}
      >
        {image.status === 'ready' ? (
          <img src={image.src} alt="" decoding="async" />
        ) : image.status === 'error' ? (
          <Missing online={online} compact />
        ) : null}
      </button>
    </li>
  )
}

/**
 * La foto en el visor: la completa, que se pide aquí (al abrirlo o al pasar a
 * ella). Mientras llega, o si no se puede (sin conexión), la miniatura, con
 * un aviso; si tampoco está, el hueco.
 */
function ViewerPhoto({ photo, alt }: { photo: StoredPlantPhoto; alt: string }) {
  const full = usePlantImage(photo.photoPath, 'photo')
  const thumbnail = usePlantImage(photo.thumbnailPath, 'thumbnail')
  const online = useOnlineStatus()
  const image = full.status === 'ready' ? full : thumbnail
  return (
    <>
      {image.status === 'ready' ? (
        <img className="orki-lightbox__photo" src={image.src} alt={alt} />
      ) : image.status === 'error' ? (
        <span className="orki-lightbox__photo">
          <Missing online={online} />
          <span className="sr-only">{alt}</span>
        </span>
      ) : (
        <span className="orki-lightbox__photo" role="img" aria-label={alt} />
      )}
      {full.status === 'error' && image.status === 'ready' && (
        <p className="orki-lightbox__notice">
          {online
            ? GALLERY_TEXT.viewerThumbnailFailed
            : GALLERY_TEXT.viewerThumbnail}
        </p>
      )}
    </>
  )
}

/**
 * Galería de la ficha de una planta (#183, rediseñada en el #265 según la
 * maqueta del #263): la foto elegida en grande (la principal al entrar), con
 * «1 de 3» sobre la esquina y «Foto anterior» y «Foto siguiente» sobre ella
 * si hay más de una; debajo, las miniaturas y, a su lado, «Editar fecha y
 * nota» (PhotoDetailsForm) y «Ordenar fotos», que despliega «Hacer
 * principal», «Mover antes» y «Mover después». La fecha, la nota y «En flor»
 * de la elegida van debajo. Al tocar la grande se abre el visor a pantalla
 * completa (PhotoLightbox), con el teclado y deslizando. Con una sola foto no
 * hay flechas, contador, miniaturas ni orden. Añadir y quitar fotos es cosa
 * de la edición: «Añadir o quitar fotos».
 *
 * El título «Fotos» (h2) solo lo oye el lector: la maqueta no lo pinta.
 *
 * Cambiar algo exige conexión y la lista leída de la base; sin ella (sin
 * conexión al abrir) se ve solo la principal de la colección y lo dice.
 *
 * Sin fotos propias, un estado vacío compacto: la foto de referencia de su
 * especie si la hay (#234), en pequeño, rotulada y con su crédito, y una
 * frase que dice que no es de su ejemplar (no es «principal» ni abre el
 * visor); si no, el marcador sin foto. Y «Añadir fotos».
 */
export function PlantGallery({
  plant,
  gallery,
  readOnly,
  services,
  onPlantUpdated,
  reference = null,
  reasonId: pageReasonId,
}: PlantGalleryProps) {
  const titleId = useId()
  const ownReasonId = useId()
  const reasonId = pageReasonId ?? ownReasonId
  const firstId = useId()
  const lastId = useId()
  const mainId = useId()
  const toolsId = useId()
  const mainButton = useRef<HTMLButtonElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const { photos, known, load } = gallery
  const count = photos.length
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewer, setViewer] = useState(false)
  const [editing, setEditing] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Tras cerrar el formulario, el foco vuelve a «Editar fecha y nota».
  const refocusEdit = useRef(false)

  const found = photos.findIndex((photo) => photo.id === selectedId)
  const index = found === -1 ? 0 : found
  const selected = photos.at(index)
  const canWrite = readOnly === null && known
  // Sin la lista: sin conexión (o la lectura falló por la red), solo la
  // principal; si falló por otra cosa, se puede reintentar.
  const failed = load.status === 'error'
  const offline =
    readOnly === 'offline' || (failed && load.reason === 'offline')
  const reason =
    readOnly === 'unverified' ? GALLERY_TEXT.unverified : GALLERY_TEXT.offline
  const name = plant.displayName
  const label = (at: number) => galleryPhotoLabel(at, count)
  const altOf = (photo: StoredPlantPhoto, at: number) =>
    GALLERY_TEXT.alt(label(at), name, photo.inBloom)

  useEffect(() => {
    if (editing || !refocusEdit.current) return
    refocusEdit.current = false
    editButton.current?.focus()
  }, [editing])

  const select = (at: number) => {
    const photo = photos.at(at)
    if (!photo) return
    setSelectedId(photo.id)
    setEditing(false)
    setError(null)
  }

  const fail = (failure: unknown) => {
    const { text, reload } = errorText(failure)
    if (reload) gallery.reload()
    return text
  }

  const reorder = async (
    order: string[],
    done: (photos: StoredPlantPhoto[]) => string,
  ) => {
    if (!canWrite || busy || !selected) return
    setBusy(true)
    setError(null)
    setStatus(GALLERY_TEXT.orderBusy)
    try {
      const result = await services.reorderPhotos({ photos, order })
      gallery.replace(result.photos)
      if (result.plant) onPlantUpdated(result.plant)
      setSelectedId(selected.id)
      setStatus(done(result.photos))
    } catch (failure) {
      setStatus('')
      setError(fail(failure))
    } finally {
      setBusy(false)
    }
  }

  const placeOf = (list: StoredPlantPhoto[]) =>
    list.findIndex((photo) => photo.id === selected?.id) + 1

  const save = async (details: PlantPhotoDetails) => {
    if (!selected) return
    try {
      const result = await services.updatePhoto({
        photo: selected,
        main: index === 0,
        details,
      })
      gallery.replace(
        photos.map((photo) =>
          photo.id === result.photo.id ? result.photo : photo,
        ),
      )
      if (result.plant) onPlantUpdated(result.plant)
      setEditing(false)
      refocusEdit.current = true
      setStatus(GALLERY_TEXT.saved)
    } catch (failure) {
      throw new Error(fail(failure), { cause: failure })
    }
  }

  const disabled = (extra: boolean) => !canWrite || busy || extra || undefined

  const manage =
    readOnly === null ? (
      <Link
        to={plantEditPath(plant.id)}
        state={FROM_DETAIL}
        className={
          count === 0
            ? 'orki-btn orki-btn--secondary self-start'
            : 'orki-link -my-[10px] min-h-[44px]'
        }
      >
        <Icon name="image" />
        {count === 0 ? GALLERY_TEXT.addPhotos : GALLERY_TEXT.manage}
      </Link>
    ) : (
      <Button
        icon="image"
        className="self-start"
        aria-disabled
        aria-describedby={reasonId}
      >
        {count === 0 ? GALLERY_TEXT.addPhotos : GALLERY_TEXT.manage}
      </Button>
    )

  const arrow = (direction: -1 | 1) => {
    const edge = direction === -1 ? index === 0 : index === count - 1
    return (
      <button
        type="button"
        className={`absolute top-[50%] grid size-[44px] -translate-y-[50%] cursor-pointer place-items-center rounded-pill border border-neutral-200 bg-neutral-0 text-neutral-900 aria-disabled:cursor-not-allowed aria-disabled:bg-neutral-50 aria-disabled:text-neutral-700 [&_svg]:size-[20px] ${
          direction === -1 ? 'left-space-3' : 'right-space-3'
        }`}
        aria-label={
          direction === -1 ? GALLERY_TEXT.previous : GALLERY_TEXT.next
        }
        aria-disabled={edge || undefined}
        onClick={() => {
          if (!edge) select(index + direction)
        }}
      >
        <Icon name={direction === -1 ? 'arrow-left' : 'arrow-right'} />
      </button>
    )
  }

  return (
    <section aria-labelledby={titleId} className="orki-viewer">
      <h2 id={titleId} className="sr-only">
        {GALLERY_TEXT.title}
      </h2>

      {selected ? (
        <div className="relative">
          <MainPhoto
            photo={selected}
            alt={altOf(selected, index)}
            buttonRef={mainButton}
            onOpen={() => setViewer(true)}
          />
          {count > 1 && (
            <>
              <span className="orki-gallery__count pointer-events-none absolute right-space-3 top-space-3">
                <span className="sr-only">{GALLERY_TEXT.positionHidden}</span>
                {GALLERY_TEXT.position(index + 1, count)}
              </span>
              {arrow(-1)}
              {arrow(1)}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-space-3">
          {reference !== null ? (
            <ReferencePhoto
              key={reference.sourcePhotoId}
              picture={reference}
              scientificName={plant.species?.scientificName ?? name}
              variant="compact"
              title={GALLERY_TEXT.referenceTitle}
              fallback={<EmptyPhoto />}
            />
          ) : (
            <EmptyPhoto />
          )}
          {reference !== null && (
            <p className="orki-viewer__hint">{GALLERY_TEXT.referenceNote}</p>
          )}
          {manage}
        </div>
      )}

      {selected && (count > 1 || (known && !editing)) && (
        <div className="flex flex-wrap items-center gap-x-space-4 gap-y-space-3">
          {count > 1 && (
            <ul
              className="orki-viewer__thumbs flex flex-wrap"
              aria-label={GALLERY_TEXT.choose}
            >
              {photos.map((photo, at) => (
                <Thumb
                  key={photo.id}
                  photo={photo}
                  label={label(at)}
                  selected={at === index}
                  onSelect={() => select(at)}
                />
              ))}
            </ul>
          )}
          {known && !editing && (
            <button
              ref={editButton}
              type="button"
              className={`orki-link -my-[10px] min-h-[44px] cursor-pointer aria-disabled:cursor-not-allowed aria-disabled:text-neutral-700 ${count > 1 ? 'ml-auto' : ''}`}
              aria-disabled={disabled(false)}
              aria-describedby={canWrite ? undefined : reasonId}
              onClick={() => {
                if (!canWrite || busy) return
                setError(null)
                setStatus('')
                setEditing(true)
              }}
            >
              <Icon name="pencil" />
              {GALLERY_TEXT.editDetails}
            </button>
          )}
        </div>
      )}

      {!known && plant.photoPath !== null && (offline || failed) && (
        <p className="orki-viewer__notice">
          <Icon name="cloud-off" />
          <span>
            {offline ? GALLERY_TEXT.onlyMain : GALLERY_TEXT.loadFailed}
          </span>
          {!offline && (
            <Button className="orki-viewer__retry" onClick={gallery.reload}>
              {GALLERY_TEXT.retry}
            </Button>
          )}
        </p>
      )}

      {selected && known && editing ? (
        <PhotoDetailsForm
          key={selected.id}
          photo={selected}
          canSave={canWrite}
          reasonId={reasonId}
          onSave={save}
          onCancel={() => {
            setEditing(false)
            refocusEdit.current = true
          }}
        />
      ) : (
        selected && <PhotoFacts photo={selected} />
      )}

      {selected && (
        <div className="flex flex-wrap items-center gap-x-space-5 gap-y-space-3">
          {manage}
          {known && !editing && count > 1 && (
            <button
              type="button"
              className="orki-link -my-[10px] min-h-[44px] cursor-pointer"
              aria-expanded={ordering}
              aria-controls={toolsId}
              onClick={() => setOrdering((open) => !open)}
            >
              <Icon name="list" />
              {GALLERY_TEXT.order}
            </button>
          )}
        </div>
      )}

      {selected && known && !editing && count > 1 && ordering && (
        <div id={toolsId} className="orki-viewer__tools">
          {count > 1 && (
            <>
              <Button
                icon="circle-check"
                aria-disabled={disabled(index === 0)}
                aria-describedby={
                  index === 0 ? mainId : canWrite ? undefined : reasonId
                }
                onClick={() => {
                  if (index === 0) return
                  void reorder(
                    orderWithMain(photos, selected.id),
                    () => GALLERY_TEXT.madeMain,
                  )
                }}
              >
                {GALLERY_TEXT.makeMain}
              </Button>
              <Button
                icon="arrow-left"
                aria-disabled={disabled(index === 0)}
                aria-describedby={
                  index === 0 ? firstId : canWrite ? undefined : reasonId
                }
                onClick={() => {
                  if (index === 0) return
                  void reorder(
                    orderWithMove(photos, selected.id, -1),
                    (list) =>
                      placeOf(list) === 1
                        ? GALLERY_TEXT.madeMain
                        : GALLERY_TEXT.moved(placeOf(list), list.length),
                  )
                }}
              >
                {GALLERY_TEXT.moveEarlier}
              </Button>
              <Button
                icon="arrow-right"
                aria-disabled={disabled(index === count - 1)}
                aria-describedby={
                  index === count - 1 ? lastId : canWrite ? undefined : reasonId
                }
                onClick={() => {
                  if (index === count - 1) return
                  void reorder(orderWithMove(photos, selected.id, 1), (list) =>
                    GALLERY_TEXT.moved(placeOf(list), list.length),
                  )
                }}
              >
                {GALLERY_TEXT.moveLater}
              </Button>
              <span hidden id={mainId}>
                {GALLERY_TEXT.alreadyMain}
              </span>
              <span hidden id={firstId}>
                {GALLERY_TEXT.firstAlready}
              </span>
              <span hidden id={lastId}>
                {GALLERY_TEXT.lastAlready}
              </span>
            </>
          )}
        </div>
      )}

      {readOnly !== null && pageReasonId === undefined && (
        <p id={reasonId} className="orki-viewer__hint">
          {reason}
        </p>
      )}

      <p role="status" className="orki-viewer__status">
        {status}
      </p>
      {error && (
        <p role="alert" className="orki-viewer__error">
          <Icon name="triangle-alert" />
          {error}
        </p>
      )}

      {viewer && selected && (
        <PhotoLightbox
          title={GALLERY_TEXT.viewerTitle(name)}
          count={count}
          index={index}
          onIndexChange={select}
          onClose={() => setViewer(false)}
          caption={<PhotoFacts photo={selected} />}
        >
          <ViewerPhoto
            key={selected.id}
            photo={selected}
            alt={altOf(selected, index)}
          />
        </PhotoLightbox>
      )}
    </section>
  )
}
