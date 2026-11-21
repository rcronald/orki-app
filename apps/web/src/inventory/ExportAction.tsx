import { useId, useState } from 'react'
import { exportFileName, inventoryCsv } from '../collection/export-csv.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { Button } from '../components/ui/Button.tsx'
import { saveFile, type SaveResult } from './save-file.ts'
import { EXPORT_TEXT } from './texts.ts'

/**
 * Exportación del inventario a CSV (#17), al final de la pantalla: explica
 * qué incluye (todas las plantas, también las dadas de baja, sin importar los
 * filtros) y genera el archivo en el dispositivo con la colección en memoria.
 * El resultado se anuncia en una región de estado, sin mover el foco.
 */
export function ExportAction({
  plants,
}: {
  plants: readonly CollectionPlant[]
}) {
  const headingId = useId()
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
      aria-labelledby={headingId}
      className="flex flex-col items-start gap-space-2 rounded-lg bg-neutral-50 p-space-4"
    >
      {/* Rótulo de la sección, no un encabezado: los encabezados de nivel 2
          de la pantalla son los géneros o las tarjetas. */}
      <p id={headingId} className="text-md font-semibold text-neutral-900">
        {EXPORT_TEXT.title}
      </p>
      <p className="text-sm text-neutral-700">{EXPORT_TEXT.hint}</p>
      <Button onClick={exportCsv}>{EXPORT_TEXT.action}</Button>
      <p role="status" className="text-sm text-neutral-700">
        {message}
      </p>
    </section>
  )
}
