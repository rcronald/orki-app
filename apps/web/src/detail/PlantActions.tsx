import { useId, useState } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { Button } from '../components/ui/Button.tsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import type { PlantStatus } from '../lib/database.ts'
import { PhotoStorageError } from '../photos/storage.ts'
import { plantSaveErrorFrom } from '../registration/save-plant.ts'
import { DELETE_ERROR_TEXT, DETAIL_TEXT } from './texts.ts'

/** Lo que hacen las acciones en la base; la página pasa los de Supabase. */
export interface PlantActionServices {
  /** Cambia el estado y devuelve la planta; se rechaza con PlantSaveError. */
  setStatus: (
    plant: CollectionPlant,
    status: PlantStatus,
  ) => Promise<CollectionPlant>
  /**
   * Borra la planta y después sus fotos (deletePlantWithPhotos); se rechaza
   * con PhotoStorageError si no se pudo borrar la planta.
   */
  deletePlant: (plant: CollectionPlant) => Promise<{ photosDeleted: boolean }>
}

interface PlantActionsProps {
  plant: CollectionPlant
  /** Si se puede escribir: con conexión y la sesión confirmada (#18). */
  online: boolean
  /** Motivo cuando no se puede; por defecto, el de sin conexión. */
  offlineText?: string
  /**
   * id de un motivo que la página ya muestra (la ficha lo pone arriba, #265):
   * si se pasa, las acciones lo citan y no repiten el texto.
   */
  reasonId?: string
  services: PlantActionServices
  /** El estado cambió en la base (baja o reactivación). */
  onStatusChanged: (plant: CollectionPlant) => void
  /** La planta ya no existe (aunque sus fotos quizá queden). */
  onDeleted: (result: { photosDeleted: boolean }) => void
}

type Dialog = null | 'retire' | 'delete'

type Retired = Exclude<PlantStatus, 'active'>

function deleteErrorText(error: unknown): string {
  const reason = error instanceof PhotoStorageError ? error.reason : 'failed'
  if (reason === 'offline' || reason === 'session-ended') {
    return DELETE_ERROR_TEXT[reason]
  }
  return DELETE_ERROR_TEXT.failed
}

/**
 * Acciones del detalle (#16): dar de baja (o reactivar) y eliminar. En la
 * ficha del #265 van dentro de «Gestionar planta», plegado al final, cada
 * una con una frase que dice qué hace; «Editar planta» pasó a la cabecera.
 *
 * - Dar de baja pide el motivo (perdida o regalada, el enumerado
 *   plant_status) en un diálogo: la planta se conserva y deja de contar como
 *   activa. Se puede deshacer, así que la confirmación es la principal.
 * - Reactivar devuelve una baja a activa sin preguntar: no destruye nada.
 * - Eliminar es para registros creados por error: el diálogo dice que no se
 *   puede deshacer, el foco empieza en "Cancelar" y la confirmación va en la
 *   variante danger. Si falla, no se borró nada y se puede reintentar.
 * - Sin conexión, todas quedan desactivadas con el motivo.
 */
export function PlantActions({
  plant,
  online,
  offlineText = DETAIL_TEXT.offline,
  reasonId,
  services,
  onStatusChanged,
  onDeleted,
}: PlantActionsProps) {
  const offlineId = useId()
  const errorId = useId()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [reason, setReason] = useState<Retired>('lost')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = plant.status === 'active'
  const offlineHint = online ? undefined : (reasonId ?? offlineId)

  const open = (next: Dialog) => {
    if (!online || busy) return
    setError(null)
    setReason('lost')
    setDialog(next)
  }

  const close = () => {
    if (busy) return
    setDialog(null)
    setError(null)
  }

  const changeStatus = async (status: PlantStatus) => {
    if (busy || !online) return
    setBusy(true)
    setError(null)
    try {
      const updated = await services.setStatus(plant, status)
      setBusy(false)
      setDialog(null)
      onStatusChanged(updated)
    } catch (failure) {
      setBusy(false)
      setError(plantSaveErrorFrom(failure).message)
    }
  }

  const remove = async () => {
    if (busy || !online) return
    setBusy(true)
    setError(null)
    try {
      const result = await services.deletePlant(plant)
      setBusy(false)
      onDeleted(result)
    } catch (failure) {
      setBusy(false)
      // Ya no existía (otro dispositivo la borró, o un intento anterior
      // llegó y se perdió la respuesta): el resultado es el mismo.
      if (
        failure instanceof PhotoStorageError &&
        failure.reason === 'not-found'
      ) {
        onDeleted({ photosDeleted: true })
        return
      }
      setError(deleteErrorText(failure))
    }
  }

  const errorBox = error && (
    <p
      id={errorId}
      role="alert"
      className="flex items-start gap-space-2 rounded-lg bg-danger-soft p-space-3 text-sm text-neutral-900"
    >
      <Icon
        name="triangle-alert"
        className="mt-[2px] size-[16px] flex-none text-danger"
      />
      {error}
    </p>
  )

  return (
    <section
      aria-label={DETAIL_TEXT.actionsLabel}
      className="flex flex-col gap-space-4"
    >
      {/* Región siempre presente: así se anuncia al perder la conexión. */}
      {reasonId === undefined && (
        <div role="status">
          {!online && (
            <p id={offlineId} className="text-sm text-neutral-700">
              {offlineText}
            </p>
          )}
        </div>
      )}
      {/* Errores de reactivar, que no tiene diálogo. */}
      {dialog === null && errorBox}
      <div className="flex flex-col items-start gap-space-2">
        <p className="text-sm text-neutral-700">
          {active ? DETAIL_TEXT.retireHint : DETAIL_TEXT.reactivateHint}
        </p>
        {active ? (
          <Button
            aria-disabled={!online || undefined}
            aria-describedby={offlineHint}
            onClick={() => open('retire')}
          >
            {DETAIL_TEXT.retire}
          </Button>
        ) : (
          <Button
            icon="sprout"
            aria-disabled={!online || busy || undefined}
            aria-describedby={offlineHint}
            onClick={() => void changeStatus('active')}
          >
            {busy && dialog === null
              ? DETAIL_TEXT.reactivateBusy
              : DETAIL_TEXT.reactivate}
          </Button>
        )}
      </div>
      <div className="flex flex-col items-start gap-space-2 border-t border-neutral-200 pt-space-4">
        <p className="text-sm text-neutral-700">{DETAIL_TEXT.deleteHint}</p>
        <Button
          variant="danger-outline"
          icon="trash-2"
          aria-disabled={!online || undefined}
          aria-describedby={offlineHint}
          onClick={() => open('delete')}
        >
          {DETAIL_TEXT.delete}
        </Button>
      </div>

      {dialog === 'retire' && (
        <ConfirmDialog
          title={DETAIL_TEXT.retireTitle}
          description={DETAIL_TEXT.retireDescription}
          confirmLabel={DETAIL_TEXT.retireConfirm}
          busyLabel={DETAIL_TEXT.retireBusy}
          busy={busy}
          confirmDisabled={!online}
          onConfirm={() => void changeStatus(reason)}
          onCancel={close}
        >
          <fieldset className="flex min-w-[0] flex-col gap-space-2">
            <legend className="mb-space-2 text-sm font-semibold text-neutral-900">
              {DETAIL_TEXT.retireReason}
            </legend>
            {(
              [
                ['lost', DETAIL_TEXT.retireLost],
                ['gifted', DETAIL_TEXT.retireGifted],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-[44px] cursor-pointer items-center gap-space-3 rounded-md bg-neutral-50 px-space-3 text-md text-neutral-900"
              >
                <input
                  type="radio"
                  name="motivo-de-baja"
                  value={value}
                  checked={reason === value}
                  disabled={busy}
                  onChange={() => setReason(value)}
                  className="size-[20px] accent-primary"
                />
                {label}
              </label>
            ))}
          </fieldset>
          {errorBox}
        </ConfirmDialog>
      )}

      {dialog === 'delete' && (
        <ConfirmDialog
          title={DETAIL_TEXT.deleteTitle}
          description={DETAIL_TEXT.deleteDescription}
          confirmLabel={DETAIL_TEXT.deleteConfirm}
          busyLabel={DETAIL_TEXT.deleteBusy}
          confirmVariant="danger"
          initialFocus="cancel"
          busy={busy}
          confirmDisabled={!online}
          onConfirm={() => void remove()}
          onCancel={close}
        >
          {errorBox}
        </ConfirmDialog>
      )}
    </section>
  )
}
