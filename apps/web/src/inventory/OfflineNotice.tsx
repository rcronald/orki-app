import type { ReadOnlyReason } from '../collection/useReadOnly.ts'
import { lastUpdateText } from './last-update.ts'

/**
 * Por qué se ve la copia guardada en el dispositivo (#18, #120):
 * - offline / unverified: los de useReadOnly() (solo lectura);
 * - unreachable: el navegador dice tener conexión, pero la colección no
 *   llegó de la red por falta de conexión (una wifi sin salida a internet).
 */
export type OfflineNoticeReason = ReadOnlyReason | 'unreachable'

const TITLE: Record<OfflineNoticeReason, string> = {
  offline: 'Sin conexión',
  unverified: 'Sesión sin confirmar',
  unreachable: 'Sin conexión con el servidor',
}

const BODY: Record<OfflineNoticeReason, string> = {
  offline:
    'Ves la copia guardada en este dispositivo. Puedes buscar y filtrar; para registrar, editar o dar de baja necesitas conexión.',
  unverified:
    'No se pudo confirmar tu sesión, así que ves la copia guardada en este dispositivo. Puedes buscar y filtrar; para registrar, editar o dar de baja hace falta confirmarla con conexión.',
  unreachable:
    'Ves la copia guardada en este dispositivo. Se actualizará sola cuando vuelva la conexión.',
}

interface OfflineNoticeProps {
  reason: OfflineNoticeReason
  /** Última actualización de la copia desde la red (ISO 8601); null si no hay. */
  savedAt: string | null
  /** Id del texto, para que los controles desactivados lo citen. */
  id?: string
  /** Reloj, para las pruebas y la página de muestra. */
  now?: Date
}

/**
 * Indicador de "sin conexión" con la fecha de la última actualización de la
 * copia local (#18, #120). Sin región propia: quien lo usa lo pone dentro
 * de una región role="status" siempre montada, para que se anuncie al perder
 * la conexión (es un estado, no una alerta: la app se sigue usando). Los
 * botones de escribir desactivados lo citan con aria-describedby.
 */
export function OfflineNotice({
  reason,
  savedAt,
  id,
  now,
}: OfflineNoticeProps) {
  return (
    // Sin icono: el sistema no tiene uno de "sin conexión" (icons.ts).
    <div className="rounded-lg bg-neutral-50 p-space-4 text-neutral-900">
      <div id={id} className="flex min-w-[0] flex-col gap-space-1">
        <p className="font-semibold">{TITLE[reason]}</p>
        <p className="text-md">{BODY[reason]}</p>
        <p className="text-sm text-neutral-700">
          {lastUpdateText(savedAt, now)}
        </p>
      </div>
    </div>
  )
}
