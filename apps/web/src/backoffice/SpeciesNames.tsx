import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import type {
  CatalogSpeciesDetail,
  CatalogSpeciesName,
} from '../lib/catalogAdmin.ts'
import { toCatalogWriteError } from '../lib/catalogWrites.ts'
import type { SpeciesNameType } from '../lib/database.ts'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx'
import { BACKOFFICE_CONFIRM } from './confirm.ts'
import { InlineForm } from './InlineForm.tsx'
import { SelectField } from './parts.tsx'
import { NAME_CHANGE_AREAS, type CatalogChanged } from './revisions.ts'
import type { CatalogAdminSource } from './source.ts'
import { NAME_TYPE_LABEL } from './texts.ts'

// Sinónimos y nombres comunes de una especie, en su detalle (#107): cada
// lista con sus nombres, "Editar" y "Quitar" en cada uno y "Añadir" al final.
// Un nombre se puede pasar de una lista a otra al editarlo. El idioma solo se
// pide en los nombres comunes (la base lo ignora en los sinónimos, que son
// nombres científicos). Las reglas (único por especie sin distinguir
// mayúsculas, sin espacios sobrantes, ni el nombre científico de la especie)
// las comprueba la base; aquí se muestran sus errores junto al campo.
//
// Foco: el formulario lo toma al abrirse; al guardar o cancelar vuelve al
// botón que lo abrió, y al quitar un nombre, a "Añadir" de su lista.

const NAME_TYPES: readonly SpeciesNameType[] = ['synonym', 'common']

const LIST_TEXT: Record<
  SpeciesNameType,
  { title: string; empty: string; add: string; label: string; one: string }
> = {
  synonym: {
    title: 'Sinónimos',
    empty: 'No tiene sinónimos.',
    add: 'Añadir sinónimo',
    label: 'Sinónimo',
    one: 'el sinónimo',
  },
  common: {
    title: 'Nombres comunes',
    empty: 'No tiene nombres comunes.',
    add: 'Añadir nombre común',
    label: 'Nombre común',
    one: 'el nombre común',
  },
}

type Editing =
  | { kind: 'add'; type: SpeciesNameType }
  | { kind: 'edit'; name: CatalogSpeciesName }
  | null

export interface SpeciesNamesProps {
  species: CatalogSpeciesDetail
  source: CatalogAdminSource
  /** Se guardó un nombre: la pantalla relee lo que cambia (NAME_CHANGE_AREAS). */
  onChanged: CatalogChanged
}

export function SpeciesNames({
  species,
  source,
  onChanged,
}: SpeciesNamesProps) {
  const baseId = useId()
  const [editing, setEditing] = useState<Editing>(null)
  const [removing, setRemoving] = useState<CatalogSpeciesName | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // Botón al que vuelve el foco tras guardar, cancelar o quitar: se enfoca
  // en el pintado siguiente.
  const focusTarget = useRef<string | null>(null)
  // Al quitar un nombre, el foco va a "Añadir" de su lista.
  const removed = useRef(false)

  useEffect(() => {
    if (focusTarget.current === null) return
    document.getElementById(focusTarget.current)?.focus()
    focusTarget.current = null
  })

  const addId = (type: SpeciesNameType) => `${baseId}-anadir-${type}`
  const editId = (nameId: string) => `${baseId}-editar-${nameId}`

  const remove = async (name: CatalogSpeciesName) => {
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      await source.deleteName(name.id)
      removed.current = true
      setRemoving(null)
      setRemoveBusy(false)
      onChanged(
        `Se quitó ${LIST_TEXT[name.type].one} «${name.name}» de «${species.scientificName}».`,
        NAME_CHANGE_AREAS,
      )
    } catch (caught) {
      setRemoveBusy(false)
      setRemoveError(toCatalogWriteError(caught).message)
    }
  }

  return (
    <>
      {NAME_TYPES.map((type) => {
        const names = species.names.filter((name) => name.type === type)
        const text = LIST_TEXT[type]
        const headingId = `${baseId}-${type}`
        return (
          <div key={type} className="flex flex-col gap-space-2">
            <h3
              id={headingId}
              className="text-sm font-semibold text-neutral-900"
            >
              {text.title} ({names.length})
            </h3>
            {names.length === 0 ? (
              <p className="text-sm text-neutral-700">{text.empty}</p>
            ) : (
              <ul
                aria-labelledby={headingId}
                className="flex flex-col gap-space-2"
              >
                {names.map((name) =>
                  editing?.kind === 'edit' && editing.name.id === name.id ? (
                    <li key={name.id}>
                      <NameForm
                        title={`Editar ${text.one} ${name.name}`}
                        initial={name}
                        onSubmit={async (input) => {
                          await source.updateName(name.id, input)
                          setEditing(null)
                          focusTarget.current = editId(name.id)
                          onChanged(
                            `Se guardó el nombre «${input.name}».`,
                            NAME_CHANGE_AREAS,
                          )
                        }}
                        onCancel={() => {
                          setEditing(null)
                          focusTarget.current = editId(name.id)
                        }}
                      />
                    </li>
                  ) : (
                    <li
                      key={name.id}
                      className="flex flex-wrap items-start justify-between gap-x-space-3 gap-y-space-1 [overflow-wrap:anywhere]"
                    >
                      <span className="min-w-[0]">
                        {type === 'synonym' ? (
                          <span className="scientific-name text-md">
                            <ScientificName name={name.name} />
                          </span>
                        ) : (
                          <span className="text-md text-neutral-900">
                            {name.name}
                          </span>
                        )}
                        {name.language && (
                          <span className="text-sm text-neutral-700">
                            {' '}
                            ({name.language})
                          </span>
                        )}
                      </span>
                      <span className="flex flex-none gap-space-1">
                        <Button
                          id={editId(name.id)}
                          className="px-space-2 py-space-1"
                          onClick={() => setEditing({ kind: 'edit', name })}
                        >
                          Editar{' '}
                          <span className="sr-only">
                            {text.one} {name.name}
                          </span>
                        </Button>
                        <Button
                          className="px-space-2 py-space-1"
                          onClick={() => {
                            removed.current = false
                            setRemoveError(null)
                            setRemoving(name)
                          }}
                        >
                          Quitar{' '}
                          <span className="sr-only">
                            {text.one} {name.name}
                          </span>
                        </Button>
                      </span>
                    </li>
                  ),
                )}
              </ul>
            )}
            {editing?.kind === 'add' && editing.type === type ? (
              <NameForm
                title={text.add}
                fixedType={type}
                onSubmit={async (input) => {
                  await source.addName(species.id, input)
                  setEditing(null)
                  focusTarget.current = addId(type)
                  onChanged(
                    `Se añadió ${LIST_TEXT[input.type].one} «${input.name}» a «${species.scientificName}».`,
                    NAME_CHANGE_AREAS,
                  )
                }}
                onCancel={() => {
                  setEditing(null)
                  focusTarget.current = addId(type)
                }}
              />
            ) : (
              <div>
                <Button
                  id={addId(type)}
                  icon="plus"
                  className="py-space-2"
                  onClick={() => setEditing({ kind: 'add', type })}
                >
                  {text.add}
                </Button>
              </div>
            )}
          </div>
        )
      })}

      {removing && (
        <ConfirmDialog
          {...BACKOFFICE_CONFIRM}
          title={`Quitar ${LIST_TEXT[removing.type].one} «${removing.name}»`}
          confirmLabel="Quitar"
          confirmVariant="danger"
          busy={removeBusy}
          busyLabel="Quitando…"
          error={removeError}
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
          returnFocusTo={() =>
            removed.current
              ? document.getElementById(addId(removing.type))
              : null
          }
          initialFocus="cancel"
          description={
            <>
              <p>
                «{species.scientificName}» dejará de encontrarse por este nombre
                en la búsqueda. No se puede deshacer, pero se puede volver a
                añadir.
              </p>
            </>
          }
        />
      )}
    </>
  )
}

interface NameInput {
  name: string
  type: SpeciesNameType
  language: string | null
}

function NameForm({
  title,
  initial,
  fixedType,
  onSubmit,
  onCancel,
}: {
  title: string
  initial?: CatalogSpeciesName
  /** Al añadir, la lista decide el tipo; al editar, se puede cambiar. */
  fixedType?: SpeciesNameType
  onSubmit: (input: NameInput) => Promise<void>
  onCancel: () => void
}) {
  const typeId = useId()
  const [type, setType] = useState<SpeciesNameType>(
    fixedType ?? initial?.type ?? 'synonym',
  )
  const [language, setLanguage] = useState(initial?.language ?? '')
  return (
    <InlineForm
      title={title}
      label={LIST_TEXT[type].label}
      initialValue={initial?.name}
      requiredMessage="Escribe el nombre."
      hint={
        type === 'synonym'
          ? 'Nombre científico sin autor, como Laelia purpurata.'
          : undefined
      }
      onCancel={onCancel}
      onSubmit={(name) =>
        onSubmit({
          name,
          type,
          language: type === 'common' ? language.trim() || null : null,
        })
      }
      extra={({ languageError, languageId }) => (
        <>
          {fixedType === undefined && (
            <SelectField
              id={typeId}
              label="Tipo de nombre"
              value={type}
              options={NAME_TYPES}
              labels={NAME_TYPE_LABEL}
              onChange={setType}
            />
          )}
          {type === 'common' && (
            <div className="orki-field">
              <label className="orki-field__label" htmlFor={languageId}>
                Idioma (opcional)
              </label>
              <input
                id={languageId}
                className="orki-field__input"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={languageError ? true : undefined}
                aria-describedby={`${languageId}-ayuda${languageError ? ` ${languageId}-error` : ''}`}
              />
              {languageError && (
                <span id={`${languageId}-error`} className="orki-field__error">
                  <Icon name="triangle-alert" />
                  {languageError}
                </span>
              )}
              <span id={`${languageId}-ayuda`} className="orki-field__hint">
                Etiqueta corta: es, en, pt-BR.
              </span>
            </div>
          )}
        </>
      )}
    />
  )
}
