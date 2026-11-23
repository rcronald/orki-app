import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import { localDateString } from '../lib/localDate.ts'
import {
  checkPlantPhotoDetails,
  MAX_PHOTO_NOTE_LENGTH,
  noteLength,
  type PlantPhotoDetails,
} from '../photos/gallery.ts'
import type { StoredPlantPhoto } from '../photos/photo-rows.ts'
import { GALLERY_TEXT } from './texts.ts'

interface PhotoDetailsFormProps {
  photo: StoredPlantPhoto
  /** Si se puede guardar (con conexión y la sesión confirmada). */
  canSave: boolean
  /** id del texto que explica por qué no se puede guardar. */
  reasonId?: string
  /** Guarda; rechaza con el texto del error para mostrarlo. */
  onSave: (details: PlantPhotoDetails) => Promise<void>
  onCancel: () => void
}

/**
 * Formulario de la fecha, la nota y "en flor" de una foto (#183), bajo la foto
 * elegida. Fecha opcional y no posterior a hoy; nota opcional de hasta 500
 * caracteres, con su contador. Guardado explícito: «Guardar» muestra
 * «Guardando…» y, si falla, el motivo; lo escrito se conserva para
 * reintentar. Sin conexión, «Guardar» queda con aria-disabled y el motivo.
 * Al abrirse, el foco va a la fecha.
 */
export function PhotoDetailsForm({
  photo,
  canSave,
  reasonId,
  onSave,
  onCancel,
}: PhotoDetailsFormProps) {
  const titleId = useId()
  const noteId = useId()
  const errorId = useId()
  const dateRef = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const [takenAt, setTakenAt] = useState(photo.takenAt ?? '')
  const [note, setNote] = useState(photo.note ?? '')
  const [inBloom, setInBloom] = useState(photo.inBloom)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = localDateString()
  const { details, problems } = checkPlantPhotoDetails(
    { takenAt, note, inBloom },
    today,
  )
  const dateError = !checked
    ? null
    : problems.takenAt === 'future'
      ? GALLERY_TEXT.dateFuture
      : problems.takenAt === 'invalid'
        ? GALLERY_TEXT.dateInvalid
        : null
  const noteError =
    checked && problems.note
      ? GALLERY_TEXT.noteTooLong(MAX_PHOTO_NOTE_LENGTH)
      : null

  useEffect(() => {
    dateRef.current?.focus()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !canSave) return
    setChecked(true)
    if (problems.takenAt) {
      dateRef.current?.focus()
      return
    }
    if (problems.note) {
      noteRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(details)
    } catch (failure) {
      setBusy(false)
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const length = noteLength(note.trim())
  const noteHintId = `${noteId}-hint`
  const noteErrorId = `${noteId}-error`

  return (
    <form
      className="orki-viewer__form"
      aria-labelledby={titleId}
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <h3 id={titleId} className="orki-viewer__formtitle">
        {GALLERY_TEXT.formTitle}
      </h3>
      <TextField
        ref={dateRef}
        type="date"
        label={GALLERY_TEXT.dateLabel}
        value={takenAt}
        max={today}
        disabled={busy}
        error={dateError}
        onChange={(event) => setTakenAt(event.target.value)}
      />
      <div className="orki-field">
        <label className="orki-field__label" htmlFor={noteId}>
          {GALLERY_TEXT.noteLabel}
        </label>
        <textarea
          ref={noteRef}
          id={noteId}
          className="orki-field__input"
          rows={3}
          value={note}
          disabled={busy}
          aria-invalid={noteError ? true : undefined}
          aria-describedby={
            [noteError && noteErrorId, noteHintId].filter(Boolean).join(' ') ||
            undefined
          }
          onChange={(event) => setNote(event.target.value)}
        />
        {noteError && (
          <span className="orki-field__error" id={noteErrorId}>
            <Icon name="triangle-alert" />
            {noteError}
          </span>
        )}
        <span className="orki-field__hint" id={noteHintId}>
          {GALLERY_TEXT.noteCount(length, MAX_PHOTO_NOTE_LENGTH)}
        </span>
      </div>
      <div>
        <Chip
          selected={inBloom}
          disabled={busy}
          onClick={() => setInBloom((value) => !value)}
        >
          {GALLERY_TEXT.inBloomLabel}
        </Chip>
      </div>
      {error && (
        <p id={errorId} role="alert" className="orki-viewer__error">
          <Icon name="triangle-alert" />
          {error}
        </p>
      )}
      <div className="orki-viewer__formactions">
        <Button disabled={busy} onClick={onCancel}>
          {GALLERY_TEXT.cancel}
        </Button>
        <Button
          type="submit"
          variant="primary"
          aria-disabled={!canSave || busy || undefined}
          aria-describedby={canSave ? undefined : reasonId}
        >
          {busy ? GALLERY_TEXT.saving : GALLERY_TEXT.save}
        </Button>
      </div>
    </form>
  )
}
