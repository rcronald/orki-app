import { useId } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { Button } from '../components/ui/Button.tsx'
import { EXPORT_TEXT } from './texts.ts'
import { useInventoryExport } from './useInventoryExport.ts'

/**
 * Exportación del inventario a CSV (#17), al final de la pantalla: explica
 * qué incluye (todas las plantas, también las dadas de baja, sin importar los
 * filtros) y genera el archivo en el dispositivo con la colección en memoria.
 * El resultado se anuncia en una región de estado, sin mover el foco. La
 * lógica es la de useInventoryExport, compartida con «Tu cuenta» (#214).
 */
export function ExportAction({
  plants,
}: {
  plants: readonly CollectionPlant[]
}) {
  const headingId = useId()
  const { exportCsv, message } = useInventoryExport(plants)

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
