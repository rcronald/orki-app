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
import type { CatalogGenusDetail } from '../lib/catalogAdmin.ts'
import {
  cleanGenusName,
  toCatalogWriteError,
  withFinalDot,
  type WrittenGenus,
} from '../lib/catalogWrites.ts'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx'
import { BACKOFFICE_CONFIRM } from './confirm.ts'
import { InlineForm } from './InlineForm.tsx'
import { LoadError } from './parts.tsx'
import { revealPanel, SIDE_PANEL } from './side-panel.ts'
import type { CatalogAdminSource } from './source.ts'
import { speciesCountText } from './texts.ts'
import { useRemoteData } from './useRemoteData.ts'

// Edición de un género (#107), en un panel junto a la tabla de géneros:
// nombre (con o sin el signo «×» de los nothogéneros) y acceso rápido, sus
// abreviaturas (añadir, editar, quitar) y la baja, solo sin especies.
//
// Marcar o quitar el acceso rápido cambia los chips del formulario de
// registro de todos los usuarios: se confirma diciéndolo.

const QUICK_ACCESS_HINT =
  'Sale como chip en el formulario de registro de todos los usuarios.'

export interface GenusPanelProps {
  genusId: string
  source: CatalogAdminSource
  revision: number
  /** Cambia cada vez que se abre: el foco va al título. */
  focusRequest: number
  onClose: () => void
  onChanged: (message: string) => void
  onDeleted: (message: string) => void
  /** Aviso del resultado de la última escritura (ResultNotice), bajo el título. */
  notice?: ReactNode
}

export function GenusPanel({
  genusId,
  source,
  revision,
  focusRequest,
  onClose,
  onChanged,
  onDeleted,
  notice,
}: GenusPanelProps) {
  const headingId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const detail = useRemoteData(
    genusId,
    (signal) => source.genusDetail(genusId, { signal }),
    { revision },
  )
  const ready = detail.status !== 'loading' && detail.status !== 'idle'
  useEffect(() => {
    if (focusRequest > 0 && ready)
      revealPanel(panelRef.current, headingRef.current)
  }, [focusRequest, ready])
  const genus = detail.status === 'success' ? detail.data : null

  return (
    <section
      ref={panelRef}
      aria-labelledby={headingId}
      aria-busy={!ready}
      className={`${SIDE_PANEL} gap-space-4`}
    >
      <div className="flex items-start justify-between gap-space-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="min-w-[0] text-lg font-semibold text-secondary [overflow-wrap:anywhere]"
        >
          {genus ? `Género ${genus.name}` : 'Género'}
        </h2>
        <Button icon="x" onClick={onClose} className="flex-none">
          Cerrar
        </Button>
      </div>
      {notice}
      {!ready ? (
        <p role="status" className="text-sm text-neutral-700">
          Cargando el género…
        </p>
      ) : detail.status === 'error' ? (
        <LoadError
          compact
          reason={detail.reason}
          message={detail.message}
          onRetry={detail.retry}
        />
      ) : genus === null ? (
        <p className="text-md text-neutral-900">
          Este género ya no está en el catálogo.
        </p>
      ) : (
        <>
          <GenusForm
            key={`${genus.id}-${genus.name}-${genus.isQuickAccess}`}
            genus={genus}
            source={source}
            onSaved={(written, before) =>
              onChanged(genusSavedMessage(before, written))
            }
          />
          <Abbreviations genus={genus} source={source} onChanged={onChanged} />
          <GenusDelete genus={genus} source={source} onDeleted={onDeleted} />
        </>
      )}
    </section>
  )
}

function genusSavedMessage(
  before: CatalogGenusDetail,
  written: WrittenGenus,
): string {
  const parts: string[] = []
  if (before.name !== written.name)
    parts.push(`El género «${before.name}» se llama ahora «${written.name}».`)
  if (before.isQuickAccess !== written.isQuickAccess)
    parts.push(
      written.isQuickAccess
        ? `«${written.name}» sale ahora como chip de acceso rápido en el registro.`
        : `«${written.name}» ya no sale como chip de acceso rápido en el registro.`,
    )
  return parts.join(' ') || `Se guardó el género «${written.name}».`
}

// Nombre y acceso rápido -----------------------------------------------------------

function GenusForm({
  genus,
  source,
  onSaved,
}: {
  genus: CatalogGenusDetail
  source: CatalogAdminSource
  onSaved: (written: WrittenGenus, before: CatalogGenusDetail) => void
}) {
  const id = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(genus.name)
  const [quick, setQuick] = useState(genus.isQuickAccess)
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const clean = cleanGenusName(name)
  const changed = clean !== genus.name || quick !== genus.isQuickAccess

  const save = async () => {
    setSaving(true)
    setDialogError(null)
    try {
      const written = await source.updateGenus(genus.id, {
        name: clean,
        isQuickAccess: quick,
      })
      setSaving(false)
      setConfirming(false)
      onSaved(written, genus)
    } catch (caught) {
      setSaving(false)
      const error = toCatalogWriteError(caught)
      if (error.field) {
        setConfirming(false)
        setNameError(error.message)
        setFormError(null)
        nameRef.current?.focus()
      } else if (confirming) {
        setDialogError(error.message)
      } else {
        setFormError(error.message)
      }
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving || !changed) return
    setName(clean)
    setNameError(null)
    setFormError(null)
    if (clean === '') {
      setNameError('Escribe el nombre del género.')
      nameRef.current?.focus()
      return
    }
    if (quick !== genus.isQuickAccess) {
      setDialogError(null)
      setConfirming(true)
      return
    }
    void save()
  }

  return (
    <form
      noValidate
      aria-labelledby={`${id}-titulo`}
      onSubmit={submit}
      className="flex flex-col gap-space-3"
    >
      <h3
        id={`${id}-titulo`}
        className="text-sm font-semibold text-neutral-900"
      >
        Nombre y acceso rápido
      </h3>
      <TextField
        ref={nameRef}
        label="Nombre del género"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => setName((value) => cleanGenusName(value))}
        autoComplete="off"
        spellCheck={false}
        error={nameError}
        hint={`Una palabra; un nothogénero lleva «× » delante (× Rhyncholaeliocattleya). Cambiar el nombre no cambia el nombre científico de sus ${speciesCountText(genus.speciesCount)}.`}
      />
      <div className="flex items-start gap-space-2">
        <input
          id={`${id}-rapido`}
          type="checkbox"
          className="mt-[2px] size-[24px] flex-none cursor-pointer accent-secondary"
          checked={quick}
          onChange={(event) => setQuick(event.target.checked)}
          aria-describedby={`${id}-rapido-ayuda`}
        />
        <div className="flex flex-col">
          <label
            htmlFor={`${id}-rapido`}
            className="cursor-pointer text-md text-neutral-900"
          >
            Acceso rápido en el registro
          </label>
          <span id={`${id}-rapido-ayuda`} className="orki-field__hint">
            {QUICK_ACCESS_HINT}
          </span>
        </div>
      </div>
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
      <div>
        <Button
          type="submit"
          variant="primary"
          aria-disabled={saving || !changed}
        >
          {saving ? 'Guardando…' : 'Guardar el género'}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {saving ? 'Guardando…' : ''}
      </p>
      {confirming && (
        <ConfirmDialog
          {...BACKOFFICE_CONFIRM}
          title={
            quick
              ? `Poner «${clean}» como acceso rápido`
              : `Quitar «${clean}» del acceso rápido`
          }
          confirmLabel={
            quick ? 'Marcar como acceso rápido' : 'Quitar del acceso rápido'
          }
          busy={saving}
          error={dialogError}
          onConfirm={() => void save()}
          onCancel={() => setConfirming(false)}
          initialFocus="confirm"
          description={
            <>
              <p>
                {quick
                  ? `«${clean}» aparecerá como chip de acceso rápido en el formulario de registro de todos los usuarios.`
                  : `«${clean}» dejará de aparecer como chip de acceso rápido en el formulario de registro de todos los usuarios; se podrá seguir eligiendo con «Otro».`}
              </p>
              {clean !== genus.name && (
                <p>
                  También se guarda el nombre nuevo: «{genus.name}» pasa a
                  llamarse «{clean}».
                </p>
              )}
            </>
          }
        />
      )}
    </form>
  )
}

// Abreviaturas ------------------------------------------------------------------------

function Abbreviations({
  genus,
  source,
  onChanged,
}: {
  genus: CatalogGenusDetail
  source: CatalogAdminSource
  onChanged: (message: string) => void
}) {
  const baseId = useId()
  const headingId = `${baseId}-titulo`
  const addId = `${baseId}-anadir`
  const editId = (id: string) => `${baseId}-editar-${id}`
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{
    id: string
    abbreviation: string
  } | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // Botón al que vuelve el foco tras guardar, cancelar o quitar: se enfoca
  // en el pintado siguiente.
  const focusTarget = useRef<string | null>(null)
  const removed = useRef(false)

  useEffect(() => {
    if (focusTarget.current === null) return
    document.getElementById(focusTarget.current)?.focus()
    focusTarget.current = null
  })

  const hint =
    'Se guarda con su punto final (Phal.). Una abreviatura solo puede ser de un género.'

  const remove = async (item: { id: string; abbreviation: string }) => {
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      await source.deleteAbbreviation(item.id)
      removed.current = true
      setRemoveBusy(false)
      setRemoving(null)
      onChanged(
        `Se quitó la abreviatura «${item.abbreviation}» de ${genus.name}.`,
      )
    } catch (caught) {
      setRemoveBusy(false)
      setRemoveError(toCatalogWriteError(caught).message)
    }
  }

  return (
    <div className="flex flex-col gap-space-2">
      <h3 id={headingId} className="text-sm font-semibold text-neutral-900">
        Abreviaturas ({genus.abbreviations.length})
      </h3>
      {genus.abbreviations.length === 0 ? (
        <p className="text-sm text-neutral-700">No tiene abreviaturas.</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-space-2">
          {genus.abbreviations.map((item) =>
            editing === item.id ? (
              <li key={item.id}>
                <InlineForm
                  title={`Editar la abreviatura ${item.abbreviation}`}
                  label="Abreviatura"
                  initialValue={item.abbreviation}
                  hint={hint}
                  requiredMessage="Escribe la abreviatura."
                  normalize={withFinalDot}
                  onSubmit={async (text) => {
                    await source.updateAbbreviation(item.id, text)
                    setEditing(null)
                    focusTarget.current = editId(item.id)
                    onChanged(
                      `Se guardó la abreviatura «${text}» de ${genus.name}.`,
                    )
                  }}
                  onCancel={() => {
                    setEditing(null)
                    focusTarget.current = editId(item.id)
                  }}
                />
              </li>
            ) : (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-space-2"
              >
                <span className="text-md text-neutral-900">
                  {item.abbreviation}
                </span>
                <span className="flex gap-space-1">
                  <Button
                    id={editId(item.id)}
                    className="px-space-2 py-space-1"
                    onClick={() => setEditing(item.id)}
                  >
                    Editar{' '}
                    <span className="sr-only">
                      la abreviatura {item.abbreviation}
                    </span>
                  </Button>
                  <Button
                    className="px-space-2 py-space-1"
                    onClick={() => {
                      removed.current = false
                      setRemoveError(null)
                      setRemoving(item)
                    }}
                  >
                    Quitar{' '}
                    <span className="sr-only">
                      la abreviatura {item.abbreviation}
                    </span>
                  </Button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === 'add' ? (
        <InlineForm
          title="Añadir abreviatura"
          label="Abreviatura"
          hint={hint}
          requiredMessage="Escribe la abreviatura."
          normalize={withFinalDot}
          onSubmit={async (text) => {
            await source.addAbbreviation(genus.id, text)
            setEditing(null)
            focusTarget.current = addId
            onChanged(`Se añadió la abreviatura «${text}» a ${genus.name}.`)
          }}
          onCancel={() => {
            setEditing(null)
            focusTarget.current = addId
          }}
        />
      ) : (
        <div>
          <Button
            id={addId}
            icon="plus"
            className="py-space-2"
            onClick={() => setEditing('add')}
          >
            Añadir abreviatura
          </Button>
        </div>
      )}
      {removing && (
        <ConfirmDialog
          {...BACKOFFICE_CONFIRM}
          title={`Quitar la abreviatura «${removing.abbreviation}»`}
          confirmLabel="Quitar"
          confirmVariant="danger"
          busy={removeBusy}
          busyLabel="Quitando…"
          error={removeError}
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
          returnFocusTo={() =>
            removed.current ? document.getElementById(addId) : null
          }
          initialFocus="cancel"
          description={
            <>
              <p>
                La búsqueda dejará de entender «{removing.abbreviation}» como{' '}
                {genus.name}.
              </p>
            </>
          }
        />
      )}
    </div>
  )
}

// Baja ---------------------------------------------------------------------------------

function GenusDelete({
  genus,
  source,
  onDeleted,
}: {
  genus: CatalogGenusDetail
  source: CatalogAdminSource
  onDeleted: (message: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (genus.speciesCount > 0) {
    return (
      <p className="text-sm text-neutral-700">
        No se puede borrar: tiene {speciesCountText(genus.speciesCount)}. Para
        quitarlo, bórralas o cámbialas de género antes.
      </p>
    )
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await source.deleteGenus(genus.id)
      setConfirming(false)
      onDeleted(`Se borró el género «${genus.name}» del catálogo.`)
    } catch (caught) {
      setBusy(false)
      setError(toCatalogWriteError(caught).message)
    }
  }

  return (
    <div>
      <Button
        variant="danger"
        icon="trash-2"
        onClick={() => {
          setError(null)
          setConfirming(true)
        }}
      >
        Borrar el género
      </Button>
      {confirming && (
        <ConfirmDialog
          {...BACKOFFICE_CONFIRM}
          title={`Borrar el género «${genus.name}»`}
          confirmLabel="Borrar del catálogo"
          confirmVariant="danger"
          busy={busy}
          busyLabel="Borrando…"
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
          initialFocus="cancel"
          description={
            <>
              <p>
                No tiene especies.
                {genus.abbreviations.length > 0
                  ? ` Se borran también sus abreviaturas (${genus.abbreviations.map((item) => item.abbreviation).join(', ')}).`
                  : ''}{' '}
                No se puede deshacer.
              </p>
              {genus.isQuickAccess && (
                <p>
                  Es de acceso rápido: dejará de salir en el formulario de
                  registro.
                </p>
              )}
            </>
          }
        />
      )}
    </div>
  )
}
