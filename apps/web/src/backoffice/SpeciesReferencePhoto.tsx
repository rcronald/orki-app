import { useId, useState } from 'react'
import { Button } from '../components/ui/Button.tsx'
import {
  ReferenceCreditText,
  ReferencePhoto,
} from '../components/ui/ReferencePhoto.tsx'
import type { CatalogSpeciesDetail } from '../lib/catalogAdmin.ts'
import {
  CatalogWriteError,
  SPECIES_PHOTO_REJECTION_REASONS,
  toCatalogWriteError,
} from '../lib/catalogWrites.ts'
import type { SpeciesPhotoRejectionReason } from '../lib/database.ts'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx'
import { BACKOFFICE_CONFIRM } from './confirm.ts'
import type { CatalogAdminSource } from './source.ts'
import { PHOTO_REJECTION_REASON_LABEL } from './texts.ts'

// Foto de referencia de una especie en su detalle del backoffice (#234): la
// foto con su crédito, como la ve el público, y «Retirar foto», con el motivo
// obligatorio y una confirmación (retire_species_photo). Se retira la foto
// que se está viendo: si entretanto cambió (otra persona la retiró o la carga
// la sustituyó), la base no toca nada, se avisa y el detalle se vuelve a
// leer. La retirada queda en el historial de la especie.

const RADIO = 'mt-space-1 size-[24px] flex-none cursor-pointer accent-secondary'

export function SpeciesReferencePhoto({
  species,
  source,
  onChanged,
}: {
  species: CatalogSpeciesDetail
  source: CatalogAdminSource
  onChanged: (message: string) => void
}) {
  const baseId = useId()
  const headingId = `${baseId}-titulo`
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<SpeciesPhotoRejectionReason | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photo = species.referencePhoto

  const retire = async () => {
    if (photo === null) return
    if (reason === null) {
      setError(new CatalogWriteError('reason-required').message)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await source.retireSpeciesPhoto(species.id, photo.sourcePhotoId, reason)
      setOpen(false)
      onChanged(
        `Se retiró la foto de referencia de «${species.scientificName}» (${PHOTO_REJECTION_REASON_LABEL[reason].toLowerCase()}). La carga no la volverá a poner.`,
      )
    } catch (caught) {
      const failure = toCatalogWriteError(caught)
      if (failure.problem === 'species-photo-not-found') {
        setOpen(false)
        onChanged(failure.message)
        return
      }
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-space-2">
      <h3 id={headingId} className="text-sm font-semibold text-neutral-900">
        Foto de referencia
      </h3>
      {photo === null ? (
        <p className="text-sm text-neutral-700">No tiene foto de referencia.</p>
      ) : (
        <>
          <ReferencePhoto
            key={photo.sourcePhotoId}
            picture={photo}
            scientificName={species.scientificName}
            fallback={
              <div className="flex flex-col gap-space-1">
                <p className="text-sm font-semibold text-neutral-900">
                  La imagen no se pudo cargar.
                </p>
                <ReferenceCreditText credit={photo.credit} />
              </div>
            }
          />
          <Button
            variant="danger"
            icon="trash-2"
            aria-haspopup="dialog"
            className="self-start"
            onClick={() => {
              setReason(null)
              setError(null)
              setOpen(true)
            }}
          >
            Retirar foto
          </Button>
        </>
      )}
      {open && photo !== null && (
        <ConfirmDialog
          {...BACKOFFICE_CONFIRM}
          title={`Retirar la foto de «${species.scientificName}»`}
          confirmLabel="Retirar foto"
          confirmVariant="danger"
          busy={busy}
          busyLabel="Retirando…"
          error={error}
          onConfirm={() => void retire()}
          onCancel={() => setOpen(false)}
          initialFocus="cancel"
          description={
            <>
              <p>
                La foto de {photo.credit.author} deja de verse en el catálogo,
                en el registro y en el detalle de las plantas de esta especie.
                La carga no la volverá a poner en esta especie; puede proponer
                otra.
              </p>
            </>
          }
        >
          <fieldset className="flex flex-col gap-space-1" disabled={busy}>
            <legend className="orki-field__label mb-space-2">
              ¿Por qué se retira? (obligatorio)
            </legend>
            {SPECIES_PHOTO_REJECTION_REASONS.map((value) => (
              <label
                key={value}
                htmlFor={`${baseId}-${value}`}
                className="flex min-h-[44px] cursor-pointer items-start gap-space-3 rounded-md p-space-2 hover:bg-neutral-50"
              >
                <input
                  id={`${baseId}-${value}`}
                  type="radio"
                  name={`${baseId}-motivo`}
                  className={RADIO}
                  checked={reason === value}
                  onChange={() => {
                    setReason(value)
                    setError(null)
                  }}
                />
                <span className="text-md text-neutral-900">
                  {PHOTO_REJECTION_REASON_LABEL[value]}
                </span>
              </label>
            ))}
          </fieldset>
        </ConfirmDialog>
      )}
    </section>
  )
}
