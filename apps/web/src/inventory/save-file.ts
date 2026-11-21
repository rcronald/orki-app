// Entrega al usuario un archivo generado en el navegador (la exportación del
// inventario, #17), sin servidor.
//
// - En un dispositivo táctil que sabe compartir archivos (Web Share API nivel
//   2: navigator.canShare({ files })), se abre la hoja de compartir del
//   sistema, desde la que se guarda en Archivos, se manda por correo o se abre
//   en una hoja de cálculo. Es la vía fiable en la app instalada en iPhone:
//   en modo standalone, Safari de iOS no siempre respeta el atributo
//   download de un enlace a un Blob (según la versión, abre una vista previa
//   sin forma clara de guardar o no hace nada). Si el usuario cierra la hoja
//   (AbortError) no se hace nada más; si compartir falla por otro motivo, se
//   descarga.
// - En el resto (escritorio, o sin soporte para compartir archivos), un
//   enlace temporal con download a una URL de objeto del Blob, que se revoca
//   un segundo después (revocarla en el acto corta la descarga en algunos
//   navegadores).
//
// Las dos vías necesitan el gesto del usuario: hay que llamarla dentro del
// manejador del clic, sin esperar antes a nada.

export type SaveResult = 'shared' | 'downloaded' | 'cancelled'

/** Tiempo antes de revocar la URL de objeto. */
export const REVOKE_DELAY_MS = 1000

function prefersShare(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

function canShareFile(file: File): boolean {
  try {
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    )
  } catch {
    return false
  }
}

/** Descarga con un enlace temporal a una URL de objeto. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
  }
}

/** Comparte el archivo (celular) o lo descarga (resto). */
export async function saveFile(
  content: string,
  fileName: string,
  type: string,
): Promise<SaveResult> {
  const blob = new Blob([content], { type })
  if (prefersShare() && typeof File === 'function') {
    const file = new File([blob], fileName, { type })
    if (canShareFile(file)) {
      try {
        await navigator.share({ files: [file], title: fileName })
        return 'shared'
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return 'cancelled'
        }
        // Otro fallo (permiso, tipo no admitido): se descarga.
      }
    }
  }
  downloadBlob(blob, fileName)
  return 'downloaded'
}
