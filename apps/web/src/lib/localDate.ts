// Fechas de calendario ("AAAA-MM-DD") en la zona horaria del dispositivo.
//
// La fecha de adquisición de una planta es un día del calendario de quien la
// registra, sin hora. No sirve toISOString(): da la fecha en UTC, y a las
// 20:00 en Lima (UTC−5) en UTC ya es el día siguiente. Por lo mismo, la app
// envía la fecha a la base en lugar de dejar el valor por defecto de la
// columna (current_date, en UTC en Supabase).

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

/**
 * Fecha local de `date` (por defecto, ahora) como "AAAA-MM-DD", con el año,
 * el mes y el día que ve la persona en su dispositivo.
 */
export function localDateString(date: Date = new Date()): string {
  return [
    pad(date.getFullYear(), 4),
    pad(date.getMonth() + 1, 2),
    pad(date.getDate(), 2),
  ].join('-')
}

/**
 * Si `value` es una fecha de calendario real con el formato "AAAA-MM-DD" (el
 * que da <input type="date">): "2026-02-30" o "2026-13-01" no lo son.
 */
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number) as [
    number,
    number,
    number,
    number,
  ]
  if (year < 1) return false
  // Date.UTC no depende de la zona horaria; los años de 0 a 99 se ajustan a
  // mano porque Date.UTC los toma como 1900–1999.
  const check = new Date(Date.UTC(2000, month - 1, day))
  check.setUTCFullYear(year)
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  )
}
