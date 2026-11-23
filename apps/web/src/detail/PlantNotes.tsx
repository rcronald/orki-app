import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import {
  MAX_PLANT_NOTES_LENGTH,
  normalizePlantNotes,
  plantNotesLength,
} from './notes.ts'
import { NOTES_TEXT } from './texts.ts'

interface PlantNotesProps {
  plant: CollectionPlant
  /** Si se puede escribir: con conexión y la sesión confirmada (#18). */
  canEdit: boolean
  /** id del texto que explica por qué no se puede (sin conexión). */
  reasonId?: string
  /**
   * Guarda las notas (null: sin notas) y devuelve la planta releída; se
   * rechaza con un Error cuyo mensaje se muestra tal cual.
   */
  onSave: (notes: string | null) => Promise<CollectionPlant>
  /** La planta con las notas ya guardadas, para la colección. */
  onSaved: (plant: CollectionPlant) => void
}

/**
 * Panel «Notas» de la ficha (#265): el texto con sus saltos de línea y
 * «Editar» (o «Añadir notas» si no hay), que lo cambia en el sitio por un
 * área de texto con su contador, «Cancelar» y «Guardar».
 *
 * - Vacío (o solo espacios) es «sin notas»: se guarda null.
 * - Hasta 2000 caracteres; si se pasa, «Guardar» lo dice y no envía nada.
 * - Si falla, el motivo y lo escrito se quedan para reintentar.
 * - Sin conexión, «Editar» y «Guardar» quedan con aria-disabled y el motivo.
 * - El foco va al área de texto al abrir y vuelve a «Editar» al cerrar;
 *   Escape cancela.
 *
 * Se compone con las clases de Panel (orki-panel) porque el título lleva su
 * acción al lado, como en la maqueta.
 */
export function PlantNotes({
  plant,
  canEdit,
  reasonId,
  onSave,
  onSaved,
}: PlantNotesProps) {
  const titleId = useId()
  const fieldId = useId()
  const hintId = `${fieldId}-contador`
  const fieldErrorId = `${fieldId}-error`
  const editButton = useRef<HTMLButtonElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  // Tras cerrar el área de texto, el foco vuelve a «Editar».
  const refocus = useRef(false)

  const notes = plant.notes
  const length = plantNotesLength(draft)
  const tooLong = length > MAX_PLANT_NOTES_LENGTH
  const fieldError =
    checked && tooLong ? NOTES_TEXT.tooLong(MAX_PLANT_NOTES_LENGTH) : null

  useEffect(() => {
    if (editing) {
      fieldRef.current?.focus()
      return
    }
    if (!refocus.current) return
    refocus.current = false
    editButton.current?.focus()
  }, [editing])

  const open = () => {
    if (!canEdit) return
    setDraft(notes ?? '')
    setChecked(false)
    setError(null)
    setStatus('')
    setEditing(true)
  }

  const close = () => {
    if (busy) return
    refocus.current = true
    setEditing(false)
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !canEdit) return
    setChecked(true)
    if (tooLong) {
      fieldRef.current?.focus()
      return
    }
    const next = normalizePlantNotes(draft)
    // Sin cambios: nada que guardar.
    if (next === notes) {
      close()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await onSave(next)
      setBusy(false)
      onSaved(updated)
      refocus.current = true
      setEditing(false)
      setStatus(next === null ? NOTES_TEXT.removed : NOTES_TEXT.saved)
    } catch (failure) {
      setBusy(false)
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <section aria-labelledby={titleId} className="orki-panel">
      <div className="flex flex-wrap items-center justify-between gap-x-space-3">
        <h2 id={titleId} className="orki-panel__title">
          {NOTES_TEXT.title}
        </h2>
        {!editing && (
          <button
            ref={editButton}
            type="button"
            className="orki-link -my-[10px] min-h-[44px] cursor-pointer aria-disabled:cursor-not-allowed aria-disabled:text-neutral-700"
            aria-disabled={!canEdit || undefined}
            aria-describedby={canEdit ? undefined : reasonId}
            onClick={open}
          >
            <Icon name={notes === null ? 'plus' : 'pencil'} />
            {notes === null ? (
              NOTES_TEXT.add
            ) : (
              <span>
                {NOTES_TEXT.edit}{' '}
                <span className="sr-only">{NOTES_TEXT.editHidden}</span>
              </span>
            )}
          </button>
        )}
      </div>

      {editing ? (
        <form
          className="flex flex-col gap-space-4"
          aria-labelledby={titleId}
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <div className="orki-field">
            <textarea
              ref={fieldRef}
              id={fieldId}
              className="orki-field__input resize-y"
              rows={6}
              value={draft}
              disabled={busy}
              aria-labelledby={titleId}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={
                [fieldError && fieldErrorId, hintId]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {fieldError && (
              <span className="orki-field__error" id={fieldErrorId}>
                <Icon name="triangle-alert" />
                {fieldError}
              </span>
            )}
            <span className="orki-field__hint" id={hintId}>
              {NOTES_TEXT.count(length, MAX_PLANT_NOTES_LENGTH)}
            </span>
          </div>
          {error && (
            <p role="alert" className="orki-viewer__error">
              <Icon name="triangle-alert" />
              {error}
            </p>
          )}
          <div className="orki-viewer__formactions">
            <Button disabled={busy} onClick={close}>
              {NOTES_TEXT.cancel}
            </Button>
            <Button
              type="submit"
              variant="primary"
              aria-disabled={!canEdit || busy || undefined}
              aria-describedby={canEdit ? undefined : reasonId}
            >
              {busy ? NOTES_TEXT.saving : NOTES_TEXT.save}
            </Button>
          </div>
        </form>
      ) : notes === null ? (
        <p className="orki-panel__text text-neutral-700">{NOTES_TEXT.empty}</p>
      ) : (
        <p className="orki-panel__text whitespace-pre-line [overflow-wrap:anywhere]">
          {notes}
        </p>
      )}

      <p role="status" className="text-sm text-neutral-700 empty:-mt-space-4">
        {status}
      </p>
    </section>
  )
}
