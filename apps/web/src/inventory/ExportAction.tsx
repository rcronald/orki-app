import { useId } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { EXPORT_TEXT } from './texts.ts'
import { useInventoryExport } from './useInventoryExport.ts'

/**
 * Exportación del inventario a CSV (#17), al final de la lista y encima del
 * pie: una acción discreta con aspecto de enlace e icono de descarga (#208),
 * con una nota breve de qué incluye (todas las plantas, también las dadas de
 * baja, sin importar los filtros). Genera el archivo en el dispositivo con la
 * colección en memoria. El resultado se anuncia en una región de estado, sin
 * mover el foco. Es un botón (hace algo, no navega), con 44 px de alto. La
 * lógica es la de useInventoryExport, compartida con «Tu cuenta» (#214).
 */
export function ExportAction({
  plants,
}: {
  plants: readonly CollectionPlant[]
}) {
  const hintId = useId()
  const { exportCsv, message } = useInventoryExport(plants)

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
