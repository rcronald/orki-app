import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { galleryPhotoLabel } from '../components/ui/gallery-label.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import { MAX_PHOTO_NOTE_LENGTH, noteLength } from '../photos/gallery.ts'
import { EDIT_TEXT } from './texts.ts'

/** Lo escrito de una foto (fecha y nota como texto, «en flor»). */
export interface PhotoDetailsText {
  takenAt: string
  note: string
  inBloom: boolean
}

/** Qué está mal en lo escrito de una foto, ya con su texto. */
export interface PhotoDetailsErrors {
  takenAt?: string
  note?: string
}

export interface ManagedPhoto {
  key: string
  /** Miniatura, si ya está. */
  src?: string
  /** Aún sin guardar (elegida en esta edición). */
  isNew: boolean
  /** Preparándose: sin imagen ni datos que cambiar todavía. */
  preparing: boolean
  details: PhotoDetailsText
  errors: PhotoDetailsErrors
}

export type ManagerAction = 'main' | 'earlier' | 'later' | 'remove'

interface PhotoManagerProps {
  photos: readonly ManagedPhoto[]
  max: number
  /** Sin cambios posibles (guardando, sin conexión). */
  disabled: boolean
  today: string
  onMakeMain: (key: string) => void
  onMove: (key: string, offset: -1 | 1) => void
  onRemove: (key: string) => void
  onDetails: (key: string, details: Partial<PhotoDetailsText>) => void
  onAdd: () => void
  onDone: () => void
  /** Botón «Listo», para devolverle el foco al cerrar otra cosa. */
  doneRef?: Ref<HTMLButtonElement>
  /**
   * Tras un cambio, a qué botón de qué foto vuelve el foco (React mueve el
   * nodo al reordenar y el navegador lo suelta); null si a ninguno.
   */
  focusTarget: { key: string; action: ManagerAction } | null
  onFocused: () => void
  /** Mensajes, «Deshacer», inputs ocultos: al final del recuadro. */
  children?: ReactNode
  titleRef?: Ref<HTMLHeadingElement>
}

/**
 * «Gestionar fotos» de la edición (#266): un modo de la galería en el mismo
 * sitio (no un diálogo), con una ficha por foto en su orden. En cada una, su
 * fecha, su nota (hasta 500 caracteres, con contador) y «En flor», y «Hacer
 * principal», «Mover antes», «Mover después» y «Quitar». Todo cambia solo el
 * formulario: se guarda con «Guardar cambios». «Listo» vuelve a la galería.
 *
 * Accesibilidad: cada foto es un grupo con nombre («Foto principal», «Foto 2
 * de 3»), así los botones se entienden sin repetir la foto en su nombre. Los
 * botones que no aplican (la principal no se hace principal, la primera no
 * va antes) quedan con aria-disabled y el motivo. Al mover una foto, el foco
 * sigue en el mismo botón de esa foto.
 */
export function PhotoManager({
  photos,
  max,
  disabled,
  today,
  onMakeMain,
  onMove,
  onRemove,
  onDetails,
  onAdd,
  onDone,
  doneRef,
  focusTarget,
  onFocused,
  children,
  titleRef,
}: PhotoManagerProps) {
  const id = useId()
  const titleId = `${id}-titulo`
  const helpId = `${id}-ayuda`
  const limitId = `${id}-limite`
  const reasonIds = {
    main: `${id}-principal`,
    first: `${id}-primera`,
    last: `${id}-ultima`,
  }
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const addRef = useRef<HTMLButtonElement>(null)
  const full = photos.length >= max

  useEffect(() => {
    if (focusTarget === null) return
    const target =
      buttons.current.get(`${focusTarget.key}:${focusTarget.action}`) ??
      addRef.current
    target?.focus()
    onFocused()
  }, [focusTarget, photos, onFocused])

  const register =
    (key: string, action: ManagerAction) =>
    (element: HTMLButtonElement | null) => {
      const name = `${key}:${action}`
      if (element) buttons.current.set(name, element)
      else buttons.current.delete(name)
    }

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={helpId}
      className="orki-gallery"
    >
      <div className="orki-gallery__head">
        <h2
          ref={titleRef}
          id={titleId}
          tabIndex={-1}
          className="orki-gallery__title"
        >
          {EDIT_TEXT.managePhotos}
        </h2>
        <span className="orki-gallery__count">
          {photos.length} de {max}
          <span className="sr-only"> fotos</span>
        </span>
      </div>
      <p id={helpId} className="orki-gallery__notice">
        {EDIT_TEXT.manageHelp}
      </p>

      {photos.length === 0 ? (
        <p className="orki-gallery__empty">
          <Icon name="image" />
          Aún no hay fotos.
        </p>
      ) : (
        <ol
          aria-label={EDIT_TEXT.manageList}
          className="m-[0] flex list-none flex-col gap-space-3 p-[0]"
        >
          {photos.map((photo, index) => {
            const label = galleryPhotoLabel(index, photos.length)
            const rowTitle = `${id}-${photo.key}`
            const first = index === 0
            const last = index === photos.length - 1
            const noteId = `${rowTitle}-nota`
            const noteHint = `${noteId}-ayuda`
            const noteError = `${noteId}-error`
            const blocked = disabled || photo.preparing
            return (
              <li
                key={photo.key}
                className="rounded-md border border-neutral-200 bg-neutral-0 p-space-3"
              >
                <fieldset
                  aria-labelledby={rowTitle}
                  disabled={disabled}
                  className="m-[0] flex min-w-[0] flex-col gap-space-3 border-[0] p-[0]"
                >
                  <div className="flex items-center gap-space-3">
                    {photo.src ? (
                      <img
                        src={photo.src}
                        alt=""
                        decoding="async"
                        className="size-[72px] flex-none rounded-md object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="size-[72px] flex-none rounded-md bg-neutral-50"
                      />
                    )}
                    <div className="flex min-w-[0] flex-col">
                      <h3
                        id={rowTitle}
                        className="text-md font-semibold text-neutral-900"
                      >
                        {label}
                      </h3>
                      {(photo.isNew || photo.preparing) && (
                        <p className="text-sm text-neutral-700">
                          {photo.preparing
                            ? 'Preparando…'
                            : `${EDIT_TEXT.newPhoto}: se guardará al guardar los cambios.`}
                        </p>
                      )}
                    </div>
                  </div>

                  {!photo.preparing && (
                    <>
                      <div className="flex flex-wrap items-end gap-space-3">
                        <TextField
                          className="min-w-[0] flex-[1_1_12em]"
                          type="date"
                          label={EDIT_TEXT.photoDate}
                          max={today}
                          value={photo.details.takenAt}
                          error={photo.errors.takenAt}
                          data-foto={photo.key}
                          data-campo="takenAt"
                          onChange={(event) =>
                            onDetails(photo.key, {
                              takenAt: event.target.value,
                            })
                          }
                        />
                        <Chip
                          selected={photo.details.inBloom}
                          className="mb-[2px]"
                          onClick={() =>
                            onDetails(photo.key, {
                              inBloom: !photo.details.inBloom,
                            })
                          }
                        >
                          {EDIT_TEXT.inBloom}
                        </Chip>
                      </div>
                      <div className="orki-field">
                        <label className="orki-field__label" htmlFor={noteId}>
                          {EDIT_TEXT.photoNote}
                        </label>
                        <textarea
                          id={noteId}
                          className="orki-field__input"
                          rows={2}
                          value={photo.details.note}
                          data-foto={photo.key}
                          data-campo="note"
                          aria-invalid={photo.errors.note ? true : undefined}
                          aria-describedby={[
                            photo.errors.note ? noteError : '',
                            noteHint,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onChange={(event) =>
                            onDetails(photo.key, { note: event.target.value })
                          }
                        />
                        {photo.errors.note && (
                          <span className="orki-field__error" id={noteError}>
                            <Icon name="triangle-alert" />
                            {photo.errors.note}
                          </span>
                        )}
                        <span className="orki-field__hint" id={noteHint}>
                          {EDIT_TEXT.photoNoteCount(
                            noteLength(photo.details.note.trim()),
                            MAX_PHOTO_NOTE_LENGTH,
                          )}
                        </span>
                      </div>
                    </>
                  )}

                  <div className="grid grid-cols-[repeat(auto-fit,minmax(8em,1fr))] gap-space-2">
                    <Button
                      ref={register(photo.key, 'main')}
                      icon="circle-check"
                      aria-disabled={blocked || first || undefined}
                      aria-describedby={first ? reasonIds.main : undefined}
                      onClick={() => {
                        if (!blocked && !first) onMakeMain(photo.key)
                      }}
                    >
                      {EDIT_TEXT.makeMain}
                    </Button>
                    <Button
                      ref={register(photo.key, 'earlier')}
                      icon="arrow-left"
                      aria-disabled={disabled || first || undefined}
                      aria-describedby={first ? reasonIds.first : undefined}
                      onClick={() => {
                        if (!disabled && !first) onMove(photo.key, -1)
                      }}
                    >
                      {EDIT_TEXT.moveEarlier}
                    </Button>
                    <Button
                      ref={register(photo.key, 'later')}
                      icon="arrow-right"
                      aria-disabled={disabled || last || undefined}
                      aria-describedby={last ? reasonIds.last : undefined}
                      onClick={() => {
                        if (!disabled && !last) onMove(photo.key, 1)
                      }}
                    >
                      {EDIT_TEXT.moveLater}
                    </Button>
                    <Button
                      ref={register(photo.key, 'remove')}
                      icon="trash-2"
                      aria-disabled={disabled || undefined}
                      onClick={() => {
                        if (!disabled) onRemove(photo.key)
                      }}
                    >
                      {EDIT_TEXT.remove}
                    </Button>
                  </div>
                </fieldset>
              </li>
            )
          })}
        </ol>
      )}
      <span hidden id={reasonIds.main}>
        {EDIT_TEXT.alreadyMain}
      </span>
      <span hidden id={reasonIds.first}>
        {EDIT_TEXT.firstAlready}
      </span>
      <span hidden id={reasonIds.last}>
        {EDIT_TEXT.lastAlready}
      </span>

      <div className="orki-gallery__actions grid-cols-[minmax(0,1fr)]">
        <Button
          ref={addRef}
          icon="plus"
          aria-disabled={disabled || full || undefined}
          aria-describedby={full ? limitId : undefined}
          onClick={() => {
            if (!disabled && !full) onAdd()
          }}
        >
          {EDIT_TEXT.addPhotos}
        </Button>
        <Button ref={doneRef} icon="check" onClick={onDone}>
          {EDIT_TEXT.manageDone}
        </Button>
      </div>
      <p id={limitId} className="orki-gallery__help">
        {full
          ? `Ya tienes ${String(max)} fotos. Quita una para añadir otra.`
          : `Puedes añadir hasta ${String(max)} fotos.`}
      </p>
      {children}
    </section>
  )
}
