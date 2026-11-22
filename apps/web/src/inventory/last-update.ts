// Texto de la última actualización de la copia local (#18, OfflineNotice).

const SAME_DAY = new Intl.DateTimeFormat('es', {
  hour: 'numeric',
  minute: '2-digit',
})
const OTHER_DAY = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
})
const OTHER_YEAR = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Fecha de la última actualización de la copia local (#18), para el
 * indicador de sin conexión: "hoy a las 10:30", "21 de noviembre, 18:05" o,
 * de otro año, solo el día.
 */
export function lastUpdateText(
  savedAt: string | null,
  now: Date = new Date(),
): string {
  if (savedAt === null)
    return 'Aún no hay una copia guardada en este dispositivo.'
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return 'Fecha de la copia desconocida.'
  if (sameDay(date, now)) {
    return `Última actualización: hoy a las ${SAME_DAY.format(date)}.`
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `Última actualización: ${OTHER_DAY.format(date)}.`
  }
  return `Última actualización: ${OTHER_YEAR.format(date)}.`
}
