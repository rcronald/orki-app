import { useId, useState } from 'react'
import { exportFileName, inventoryCsv } from '../collection/export-csv.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { saveFile, type SaveResult } from './save-file.ts'
import { EXPORT_TEXT } from './texts.ts'

/**
 * Exportación del inventario a CSV (#17), al final de la lista y encima del
 * pie: una acción discreta con aspecto de enlace e icono de descarga (#208),
 * con una nota breve de qué incluye (todas las plantas, también las dadas de
 * baja, sin importar los filtros). Genera el archivo en el dispositivo con la
 * colección en memoria. El resultado se anuncia en una región de estado, sin
 * mover el foco. Es un botón (hace algo, no navega), con 44 px de alto.
 */
export function ExportAction({
  plants,
}: {
  plants: readonly CollectionPlant[]
}) {
  const hintId = useId()
  const [message, setMessage] = useState('')

  const exportCsv = () => {
    // Todo en el manejador del clic, sin esperas antes de compartir o
    // descargar: los navegadores exigen el gesto del usuario.
    const fileName = exportFileName()
    let result: Promise<SaveResult>
    try {
      result = saveFile(
        inventoryCsv(plants),
        fileName,
        'text/csv;charset=utf-8',
      )
    } catch {
      setMessage(EXPORT_TEXT.failed)
      return
    }
    result.then(
      (outcome) => {
        setMessage(
          outcome === 'cancelled'
            ? ''
            : EXPORT_TEXT.done(fileName, plants.length),
        )
      },
      () => setMessage(EXPORT_TEXT.failed),
    )
  }

  return (
    <section
      aria-label={EXPORT_TEXT.title}
      className="flex flex-col items-start gap-space-1"
    >
      <button
        type="button"
        className="orki-link min-h-[44px] cursor-pointer"
        aria-describedby={hintId}
        onClick={exportCsv}
      >
        <Icon name="download" />
        {EXPORT_TEXT.action}
      </button>
      <p id={hintId} className="text-sm text-neutral-700">
        {EXPORT_TEXT.hint}
      </p>
      <p role="status" className="text-sm text-neutral-700">
        {message}
      </p>
    </section>
  )
}
