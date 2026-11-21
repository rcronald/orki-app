import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import {
  cleanCatalogText,
  toCatalogWriteError,
  type CatalogWriteError,
} from '../lib/catalogWrites.ts'

// Formulario pequeño del backoffice, dentro de una lista: un campo de texto
// (un sinónimo, un nombre común, una abreviatura, el nombre de un género),
// otros campos opcionales y "Guardar" / "Cancelar".
//
// - Al aparecer, el foco va al campo de texto. Escape lo cancela.
// - Vacío no se envía: el error va junto al campo.
// - Un rechazo de la base que corresponde a un campo (CatalogWriteError.field)
//   se muestra junto a él, enlazado con aria-describedby y con el foco en él;
//   los demás, en una alerta sobre los botones.

export interface InlineFormProps {
  /** Nombre accesible del formulario ("Añadir sinónimo"). */
  title: string
  label: string
  initialValue?: string
  hint?: ReactNode
  /** Texto del error si el campo queda vacío. */
  requiredMessage: string
  submitLabel?: string
  /** Campos adicionales, entre el texto y los botones. */
  extra?: (field: { languageError?: string; languageId: string }) => ReactNode
  /** Guarda; si falla, lanza (normalmente un CatalogWriteError). */
  onSubmit: (text: string) => Promise<void>
  onCancel: () => void
  /** Texto con el formato con que se guarda (por ejemplo, con punto final). */
  normalize?: (text: string) => string
}

export function InlineForm({
  title,
  label,
  initialValue = '',
  hint,
  requiredMessage,
  submitLabel = 'Guardar',
  extra,
  onSubmit,
  onCancel,
  normalize = cleanCatalogText,
}: InlineFormProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(initialValue)
  const [textError, setTextError] = useState<string | null>(null)
  const [languageError, setLanguageError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const show = (error: CatalogWriteError) => {
    setTextError(null)
    setLanguageError(null)
    setFormError(null)
    if (error.field === 'language') {
      setLanguageError(error.message)
      document.getElementById(`${id}-idioma`)?.focus()
    } else if (error.field !== null) {
      setTextError(error.message)
      inputRef.current?.focus()
    } else {
      setFormError(error.message)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const value = normalize(text)
    setText(value)
    if (value === '') {
      setTextError(requiredMessage)
      setFormError(null)
      inputRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      await onSubmit(value)
    } catch (caught) {
      setSaving(false)
      show(toCatalogWriteError(caught))
    }
  }

  return (
    <form
      noValidate
      aria-label={title}
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-space-3 rounded-md bg-neutral-0 p-space-3"
    >
      <TextField
        ref={inputRef}
        label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        autoComplete="off"
        spellCheck={false}
        error={textError}
        hint={hint}
      />
      {extra?.({
        languageError: languageError ?? undefined,
        languageId: `${id}-idioma`,
      })}
      {formError && (
        <p
          role="alert"
          className="flex items-start gap-space-2 text-sm font-semibold text-danger"
        >
          <Icon
            name="triangle-alert"
            className="mt-space-1 size-[16px] flex-none"
          />
          {formError}
        </p>
      )}
      <div className="flex flex-wrap gap-space-2">
        <Button type="submit" variant="primary" aria-disabled={saving}>
          {saving ? 'Guardando…' : submitLabel}
        </Button>
        <Button onClick={onCancel}>Cancelar</Button>
      </div>
      <p role="status" className="sr-only">
        {saving ? 'Guardando…' : ''}
      </p>
    </form>
  )
}
