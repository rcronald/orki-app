import { useCallback, useState } from 'react'
import { exportFileName, inventoryCsv } from '../collection/export-csv.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { saveFile, type SaveResult } from './save-file.ts'
import { EXPORT_TEXT } from './texts.ts'

export interface InventoryExport {
  /**
   * Genera el CSV y lo entrega al dispositivo. Hay que llamarla en el
   * manejador del clic, sin esperas antes: los navegadores exigen el gesto
   * del usuario para compartir o descargar.
   */
  exportCsv: () => void
  /** Resultado para anunciar en una región de estado; vacío si no hay. */
  message: string
}

/**
 * Exportación del inventario a CSV (#17): la lógica que comparten «Mi
 * colección» (ExportAction) y «Tu cuenta» (#214). Todas las plantas, también
 * las dadas de baja y sin importar los filtros; sin plantas, el archivo solo
 * lleva la cabecera. El resultado («Listo: …», o el error) queda en `message`
 * para anunciarlo sin mover el foco; si la persona cierra la hoja de
 * compartir, no se dice nada.
 */
export function useInventoryExport(
  plants: readonly CollectionPlant[] | null,
): InventoryExport {
  const [message, setMessage] = useState('')

  const exportCsv = useCallback(() => {
    if (plants === null) return
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
  }, [plants])

  return { exportCsv, message }
}
