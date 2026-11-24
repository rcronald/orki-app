import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { plantDetailPath } from '../routes/paths.ts'
import type { PendingUpload } from './pending-upload.ts'
import { PENDING_UPLOAD_TEXT } from './texts.ts'

/** El nombre de la planta en una frase: en cursiva si es el científico. */
export function PendingPlantName({ upload }: { upload: PendingUpload }) {
  return upload.plantNameIsScientific ? (
    <em className="font-display">
      <ScientificName name={upload.plantName} />
    </em>
  ) : (
    <>{upload.plantName}</>
  )
}

/**
 * Aviso del registro (#284): plantas ya registradas con fotos que quedaron
 * por subir (por ejemplo, tras recargar a mitad de la subida), cada una con
 * un enlace a su ficha, donde se suben o se descartan. Como el aviso de
 * borrador, la región role="status" se pinta vacía y el texto llega en el
 * pintado siguiente, para que el lector de pantalla lo anuncie.
 */
export function PendingUploadsNotice({
  uploads,
}: {
  uploads: readonly PendingUpload[]
}) {
  const [visible, setVisible] = useState(false)
  const baseId = useId()
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const text = PENDING_UPLOAD_TEXT

  return (
    <div role="status">
      {visible && uploads.length > 0 && (
        <div className="flex flex-col gap-space-2 rounded-lg bg-neutral-50 px-space-4 py-space-2">
          {uploads.map((upload) => {
            const textId = `${baseId}-${upload.plantId}`
            return (
              <div
                key={upload.plantId}
                className="flex flex-wrap items-center justify-between gap-space-2"
              >
                <p
                  id={textId}
                  className="flex min-w-[0] items-start gap-space-2 text-sm text-neutral-900 [overflow-wrap:anywhere]"
                >
                  <Icon
                    name="cloud-off"
                    className="mt-[2px] size-[16px] flex-none"
                  />
                  <span className="min-w-[0]">
                    {text.noticeBefore(upload.photos.length)}
                    <PendingPlantName upload={upload} />
                    {text.noticeAfter}
                  </span>
                </p>
                <Link
                  to={plantDetailPath(upload.plantId)}
                  className="orki-btn orki-btn--secondary flex-none"
                  aria-describedby={textId}
                >
                  {text.noticeAction}
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
