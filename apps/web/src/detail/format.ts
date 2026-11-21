import { isCalendarDate } from '../lib/localDate.ts'

const LONG_DATE = new Intl.DateTimeFormat('es', {
  dateStyle: 'long',
  timeZone: 'UTC',
})

/**
 * Fecha "AAAA-MM-DD" (fecha local, sin hora) en palabras: "1 de noviembre de
 * 2026". Se formatea en UTC para que el huso del dispositivo no la mueva de
 * día. Si no es una fecha válida, se devuelve tal cual.
 */
export function formatCalendarDate(date: string): string {
  if (!isCalendarDate(date)) return date
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return LONG_DATE.format(new Date(Date.UTC(year, month - 1, day)))
}
