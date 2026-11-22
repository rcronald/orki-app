import { useId, useState } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import type { CatalogSpeciesRow } from '../lib/catalogAdmin.ts'
import { toCatalogWriteError } from '../lib/catalogWrites.ts'
import type { SpeciesStatus } from '../lib/database.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { SelectField } from './parts.tsx'
import type { CatalogAdminSource } from './source.ts'
import {
  formatCount,
  speciesCountText,
  STATUS_LABEL,
  STATUS_OPTIONS,
} from './texts.ts'

// Barra del cambio de estado por lote: aparece sobre la tabla en cuanto hay
// filas seleccionadas, dice cuántas, deja elegir el estado nuevo y lo aplica
// a todas tras confirmar (todas o ninguna; ver set_catalog_species_status()).

const PREVIEW = 5

export interface BatchStatusBarProps {
  rows: readonly CatalogSpeciesRow[]
  source: CatalogAdminSource
  onClear: () => void
  onDone: (message: string) => void
}

export function BatchStatusBar({
  rows,
  source,
  onClear,
  onDone,
}: BatchStatusBarProps) {
  const labelId = useId()
  const statusId = useId()
  const [status, setStatus] = useState<SpeciesStatus>('validated')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const count = rows.length
  const already = rows.filter((row) => row.status === status).length
  const label = STATUS_LABEL[status]

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      const changed = await source.setSpeciesStatus(
        rows.map((row) => row.id),
        status,
      )
      setConfirming(false)
      const rest = count - changed
      onDone(
        `${changed === 1 ? '1 especie pasó' : `${formatCount(changed)} especies pasaron`} a «${label}».` +
          (rest > 0
            ? ` ${rest === 1 ? '1 ya lo estaba' : `${formatCount(rest)} ya lo estaban`}.`
            : ''),
      )
    } catch (caught) {
      setBusy(false)
      setError(toCatalogWriteError(caught).message)
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="flex flex-wrap items-end gap-space-3 rounded-lg bg-secondary-soft p-space-4"
    >
      <p id={labelId} className="text-md font-semibold text-neutral-900">
        {count === 1
          ? '1 especie seleccionada'
          : `${formatCount(count)} especies seleccionadas`}
      </p>
      <div className="min-w-[0] basis-[200px]">
        <SelectField
          id={statusId}
          label="Nuevo estado"
          value={status}
          options={STATUS_OPTIONS}
          labels={STATUS_LABEL}
          onChange={setStatus}
        />
      </div>
      <Button
        variant="primary"
        onClick={() => {
          setError(null)
          setConfirming(true)
        }}
      >
        Cambiar el estado
      </Button>
      <Button icon="x" onClick={onClear}>
        Quitar la selección
      </Button>

      {confirming && (
        <ConfirmDialog
          title={`Cambiar el estado de ${speciesCountText(count)} a «${label}»`}
          confirmLabel={`Cambiar a «${label}»`}
          busy={busy}
          error={error}
          onConfirm={() => void apply()}
          onCancel={() => setConfirming(false)}
        >
          <ul className="flex flex-col gap-space-1">
            {rows.slice(0, PREVIEW).map((row) => (
              <li key={row.id} className="scientific-name">
                <ScientificName name={row.scientificName} />
              </li>
            ))}
            {count > PREVIEW && (
              <li>
                y{' '}
                {count - PREVIEW === 1
                  ? 'otra'
                  : `otras ${formatCount(count - PREVIEW)}`}
                .
              </li>
            )}
          </ul>
          {already > 0 && (
            <p>
              {already === 1 ? '1 ya está' : `${formatCount(already)} ya están`}{' '}
              como «{label}» y no cambia{already === 1 ? '' : 'n'}.
            </p>
          )}
          {status === 'imported' && (
            <p>
              Las especies del Catalogue of Life que vuelvan a «Importada» las
              actualizará la próxima importación con lo que diga la fuente.
            </p>
          )}
          <p>Se cambian todas o ninguna.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
