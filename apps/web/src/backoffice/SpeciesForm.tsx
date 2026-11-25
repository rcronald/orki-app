import { useId, useRef, useState, type FormEvent } from 'react'
import { normalizeSearchText } from '../collection/normalize.ts'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import type { CatalogSpeciesDetail } from '../lib/catalogAdmin.ts'
import {
  cleanCatalogText,
  toCatalogWriteError,
  validateSpeciesInput,
  type CatalogWriteError,
  type CatalogWriteField,
  type ProposalSpeciesInput,
  type SpeciesInput,
  type WrittenSpecies,
} from '../lib/catalogWrites.ts'
import type { SpeciesStatus, SpeciesType } from '../lib/database.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { SelectField } from './parts.tsx'
import { GenusPicker, type PickedGenus } from './GenusPicker.tsx'
import type { CatalogAdminSource } from './source.ts'
import {
  formatCount,
  STATUS_LABEL,
  STATUS_OPTIONS,
  TYPE_LABEL,
  TYPE_OPTIONS,
} from './texts.ts'

// Formulario de alta y de edición de una especie: nombre científico, género
// (con el buscador de géneros), tipo y estado.
//
// - Antes de enviar recorta los espacios y comprueba que haya nombre y
//   género; la base lo vuelve a comprobar todo y sus rechazos se muestran
//   junto al campo al que corresponden (aria-describedby), con el foco en él.
// - Al editar, si cambian el género o el tipo y la especie tiene plantas
//   enlazadas, pide confirmación diciendo a cuántas plantas afecta (el número
//   se vuelve a pedir en ese momento).
// - Avisa de lo que hará la base: una importada editada pasa a validada; una
//   entrada de la lista curada de híbridos la puede revertir la carga.
// - Desde la cola de propuestas (#140, prop `proposal`) es un alta con el
//   nombre, el género y el tipo del grupo ya rellenos, sin elegir el estado
//   (la especie nace validada) y guardada con la función de la propuesta.

/** Alta desde un grupo de la cola de propuestas. */
export interface SpeciesFormProposal {
  scientificName: string
  genus: PickedGenus
  type: SpeciesType
  /** Plantas del grupo que se enlazarán a la especie. */
  plantCount: number
  /** Guarda la especie y enlaza el grupo; falla con CatalogWriteError. */
  save: (input: ProposalSpeciesInput) => Promise<void>
}

export interface SpeciesFormProps {
  /** Sin especie, es un alta. */
  species?: CatalogSpeciesDetail
  /** Plantas enlazadas que se conocen (para el aviso antes de guardar). */
  plantCount?: number
  /** Alta desde la cola de propuestas: valores iniciales y otra forma de guardar. */
  proposal?: SpeciesFormProposal
  source: CatalogAdminSource
  /** Tras guardar (no se llama en el alta desde una propuesta). */
  onSaved?: (written: WrittenSpecies, autoValidated: boolean) => void
  onCancel: () => void
  /** id del campo del nombre, para enfocarlo desde fuera. */
  nameInputId?: string
}

type FieldErrors = Partial<Record<CatalogWriteField, string>>

/**
 * El nombre empieza por el género, sin contar mayúsculas, tildes ni el signo
 * de híbrido: con la normalización de la búsqueda (normalizeSearchText, que
 * también transcribe ø, æ, œ, ß, ł y đ, #337).
 */
function startsWithGenus(name: string, genus: string): boolean {
  const key = (text: string) => normalizeSearchText(text).split(' ')[0] ?? ''
  return key(name) === key(genus)
}

export function SpeciesForm({
  species,
  plantCount = 0,
  proposal,
  source,
  onSaved,
  onCancel,
  nameInputId,
}: SpeciesFormProps) {
  const editing = species !== undefined
  const id = useId()
  const fieldId = (field: CatalogWriteField) =>
    field === 'scientificName' && nameInputId ? nameInputId : `${id}-${field}`
  const nameRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(
    species?.scientificName ?? proposal?.scientificName ?? '',
  )
  const [genus, setGenus] = useState<PickedGenus | null>(
    species
      ? { id: species.genusId, name: species.genusName }
      : (proposal?.genus ?? null),
  )
  const [type, setType] = useState<SpeciesType>(
    species?.type ?? proposal?.type ?? 'species',
  )
  const [status, setStatus] = useState<SpeciesStatus>(
    species?.status ?? 'validated',
  )
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Confirmación de la propagación: plantas que se actualizarán.
  const [confirmPlants, setConfirmPlants] = useState<number | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const statusOptions = editing
    ? STATUS_OPTIONS
    : STATUS_OPTIONS.filter((option) => option !== 'imported')
  const genusChanged = editing && genus !== null && genus.id !== species.genusId
  const typeChanged = editing && type !== species.type
  const propagates = genusChanged || typeChanged
  const dataChanged =
    editing && (cleanCatalogText(name) !== species.scientificName || propagates)

  const input = (): SpeciesInput => ({
    scientificName: name,
    genusId: genus?.id ?? null,
    type,
    status,
  })

  const showError = (error: CatalogWriteError) => {
    if (error.field) {
      setErrors({ [error.field]: error.message })
      setFormError(null)
      const target = document.getElementById(fieldId(error.field))
      target?.focus()
    } else {
      setErrors({})
      setFormError(error.message)
    }
  }

  const save = async () => {
    setSaving(true)
    setDialogError(null)
    try {
      if (proposal) {
        await proposal.save({
          scientificName: name,
          genusId: genus?.id ?? null,
          type,
        })
        setSaving(false)
        return
      }
      const written = editing
        ? await source.updateSpecies(species.id, input())
        : await source.createSpecies(input())
      const autoValidated =
        editing &&
        species.status === 'imported' &&
        status === 'imported' &&
        written.status === 'validated'
      setConfirmPlants(null)
      onSaved?.(written, autoValidated)
    } catch (caught) {
      const error = toCatalogWriteError(caught)
      setSaving(false)
      if (confirmPlants !== null && !error.field) {
        setDialogError(error.message)
        return
      }
      setConfirmPlants(null)
      showError(error)
    }
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const invalid = validateSpeciesInput(input())
    if (invalid) {
      showError(invalid)
      return
    }
    setErrors({})
    setFormError(null)
    if (editing && propagates) {
      setSaving(true)
      let count: number
      try {
        count = await source.plantCount(species.id)
      } catch {
        // Sin el número no se guarda a ciegas: se avisa con el que se conocía.
        count = plantCount
      }
      setSaving(false)
      if (count > 0) {
        setConfirmPlants(count)
        return
      }
    }
    await save()
  }

  const insertHybridSign = () => {
    const element = nameRef.current
    const start = element?.selectionStart ?? name.length
    const end = element?.selectionEnd ?? name.length
    const before = name.slice(0, start)
    const insert = `${before === '' || before.endsWith(' ') ? '' : ' '}× `
    const next = before + insert + name.slice(end)
    setName(next)
    requestAnimationFrame(() => {
      element?.focus()
      const caret = before.length + insert.length
      element?.setSelectionRange(caret, caret)
    })
  }

  const nameHint =
    genus !== null &&
    cleanCatalogText(name) !== '' &&
    !startsWithGenus(name, genus.name)
      ? `Aviso: el nombre no empieza por el género elegido (${genus.name}).`
      : 'Sin autor. Híbrido natural con «×» (Phalaenopsis × intermedia); de vivero, con el nombre del grex (Phalaenopsis Sogo Yukidian).'

  const propagationText =
    propagates && plantCount > 0
      ? `Este cambio se aplicará también a ${plantCount === 1 ? '1 planta de usuarios enlazada' : `${formatCount(plantCount)} plantas de usuarios enlazadas`}: tomarán el género y el tipo nuevos.`
      : null

  return (
    <form
      noValidate
      aria-labelledby={`${id}-titulo`}
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-space-4"
    >
      <h3
        id={`${id}-titulo`}
        className="text-md font-semibold text-neutral-900"
      >
        {editing
          ? 'Editar la especie'
          : proposal
            ? 'Especie nueva desde la propuesta'
            : 'Nueva especie o híbrido'}
      </h3>

      {editing && species.status === 'imported' && (
        <p className="text-sm text-neutral-700">
          Es una especie importada: si cambias el nombre, el género o el tipo,
          pasará a «Validada» para que la próxima importación no la pise.
        </p>
      )}
      {editing && species.source === 'curated' && species.sourceRef && (
        <p className="text-sm text-neutral-700">
          Viene de la lista curada de híbridos ({species.sourceRef}). Mientras
          siga «Validada», la próxima carga de la lista devolverá el nombre, el
          género y el tipo a lo que diga la lista: corrígela en la lista, o
          márcala como «Observada» para que la carga no la toque.
        </p>
      )}
      {!editing && !proposal && (
        <p className="text-sm text-neutral-700">
          Se da de alta con fuente «Lista curada», sin referencia.
        </p>
      )}
      {proposal && (
        <p className="text-sm text-neutral-700">
          Se da de alta como «Validada», con fuente «Propuesta de usuario», y se
          le enlazan{' '}
          {proposal.plantCount === 1
            ? 'la planta del grupo'
            : `las ${formatCount(proposal.plantCount)} plantas del grupo`}
          . Revisa el nombre: es el que verán todos los usuarios.
        </p>
      )}

      <div className="flex flex-col gap-space-2">
        <TextField
          ref={nameRef}
          id={fieldId('scientificName')}
          label="Nombre científico"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setName((value) => cleanCatalogText(value))}
          autoComplete="off"
          spellCheck={false}
          error={errors.scientificName}
          hint={nameHint}
        />
        <div>
          <Button onClick={insertHybridSign} className="py-space-2">
            Insertar el signo «×»
          </Button>
        </div>
      </div>

      <GenusPicker
        inputId={fieldId('genus')}
        value={genus}
        onChange={(next) => {
          setGenus(next)
          setErrors((current) => ({ ...current, genus: undefined }))
          // En un alta sin nombre, se empieza por el género.
          if (!editing && next && cleanCatalogText(name) === '') {
            setName(`${next.name.replace(/^×\s*/, '')} `)
          }
        }}
        searchGenera={source.searchGenera}
        error={errors.genus}
      />

      <div className="grid gap-space-4 sm:grid-cols-2">
        <SelectField
          id={fieldId('type')}
          label="Tipo"
          value={type}
          options={TYPE_OPTIONS}
          labels={TYPE_LABEL}
          onChange={setType}
          error={errors.type}
        />
        {!proposal && (
          <SelectField
            id={fieldId('status')}
            label="Estado"
            value={status}
            options={statusOptions}
            labels={STATUS_LABEL}
            onChange={setStatus}
            error={errors.status}
            hint={
              editing &&
              dataChanged &&
              species.status === 'imported' &&
              status === 'imported'
                ? 'Al guardar quedará «Validada».'
                : undefined
            }
          />
        )}
      </div>

      <p aria-live="polite" className="text-sm text-neutral-900">
        {propagationText}
      </p>

      {formError && (
        <p
          role="alert"
          className="flex items-start gap-space-2 text-md font-semibold text-danger"
        >
          <Icon
            name="triangle-alert"
            className="mt-space-1 size-[16px] flex-none"
          />
          {formError}
        </p>
      )}

      <div className="flex flex-wrap gap-space-3">
        <Button type="submit" variant="primary" aria-disabled={saving}>
          {saving
            ? 'Guardando…'
            : editing
              ? 'Guardar cambios'
              : proposal
                ? 'Dar de alta y enlazar'
                : 'Dar de alta'}
        </Button>
        <Button onClick={onCancel}>Cancelar</Button>
      </div>
      <p role="status" className="sr-only">
        {saving ? 'Guardando…' : ''}
      </p>

      {confirmPlants !== null && editing && (
        <ConfirmDialog
          title="Cambiar también las plantas de los usuarios"
          confirmLabel="Guardar y actualizar las plantas"
          busy={saving}
          error={dialogError}
          onConfirm={() => void save()}
          onCancel={() => {
            setConfirmPlants(null)
            setDialogError(null)
          }}
        >
          <p>
            {confirmPlants === 1
              ? '1 planta de usuarios tiene enlazada esta especie.'
              : `${formatCount(confirmPlants)} plantas de usuarios tienen enlazada esta especie.`}{' '}
            Al guardar, {confirmPlants === 1 ? 'pasará' : 'pasarán'} a
            {genusChanged && genus ? ` ser del género ${genus.name}` : ''}
            {genusChanged && typeChanged ? ' y' : ''}
            {typeChanged ? ` ser de tipo «${TYPE_LABEL[type]}»` : ''}.
          </p>
          <p>Sus dueños lo verán en su colección.</p>
        </ConfirmDialog>
      )}
    </form>
  )
}
