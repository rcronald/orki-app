import { useEffect, useId, useRef, useState } from 'react'
import { Autocomplete } from '../components/ui/Autocomplete.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import type { searchGenera } from '../lib/catalogSearch.ts'
import { useCatalogSearch } from '../lib/useCatalogSearch.ts'

// Campo "Género" de los formularios del backoffice: el buscador de géneros
// del registro (por nombre o abreviatura) y, con un género elegido, su nombre
// y "Cambiar". El error del campo va asociado con aria-describedby en los dos
// estados.

export interface PickedGenus {
  id: string
  name: string
}

export interface GenusPickerProps {
  value: PickedGenus | null
  onChange: (genus: PickedGenus | null) => void
  searchGenera: typeof searchGenera
  error?: string | null
  /** Ayuda bajo el campo. */
  hint?: string
  /** id del campo, para llevar el foco a él desde fuera (errores). */
  inputId?: string
}

export function GenusPicker({
  value,
  onChange,
  searchGenera,
  error = null,
  hint,
  inputId,
}: GenusPickerProps) {
  const [text, setText] = useState('')
  const search = useCatalogSearch(searchGenera, text, {
    enabled: value === null,
  })
  const generatedId = useId()
  const id = inputId ?? `${generatedId}-genero`
  const labelId = `${id}-etiqueta`
  const errorId = `${id}-error`
  const hintId = `${id}-ayuda`
  // Al elegir o al pulsar "Cambiar", el campo cambia de forma: el foco pasa
  // al nuevo (el botón o el buscador) en cuanto se pinta.
  const focusAfterChange = useRef(false)
  useEffect(() => {
    if (!focusAfterChange.current) return
    focusAfterChange.current = false
    document.getElementById(id)?.focus()
  }, [value, id])
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
    undefined

  const errorText = error && (
    <span id={errorId} className="orki-field__error">
      <Icon name="triangle-alert" />
      {error}
    </span>
  )
  const hintText = hint && (
    <span id={hintId} className="orki-field__hint">
      {hint}
    </span>
  )

  if (value !== null) {
    return (
      <div className="orki-field">
        <span id={labelId} className="orki-field__label">
          Género
        </span>
        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          className="flex flex-wrap items-center gap-space-3"
        >
          <span className="text-md font-semibold text-neutral-900">
            {value.name}
          </span>
          <Button
            id={id}
            onClick={() => {
              setText('')
              focusAfterChange.current = true
              onChange(null)
            }}
          >
            Cambiar <span className="sr-only">el género</span>
          </Button>
        </div>
        {errorText}
        {hintText}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-space-1">
      <Autocomplete
        id={id}
        label="Género"
        value={text}
        onValueChange={setText}
        options={search.results.map((genus) => ({
          id: genus.id,
          label: genus.name,
          secondary: genus.matchedAbbreviation
            ? `Abreviatura: ${genus.matchedAbbreviation}`
            : undefined,
        }))}
        onOptionSelect={(option) => {
          focusAfterChange.current = true
          onChange({ id: option.id, name: option.label })
        }}
        loading={search.status === 'loading'}
        error={search.error?.message}
        minQueryLength={2}
        placeholder="Nombre o abreviatura"
        emptyText="Ningún género coincide"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {errorText}
      {hintText}
    </div>
  )
}
