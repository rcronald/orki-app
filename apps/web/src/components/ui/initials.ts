/**
 * Iniciales de un nombre para el avatar: la primera letra de la primera y de
 * la última palabra, en mayúsculas («Ana López» → «AL»; «Ana» → «A»). Vacío
 * si no hay nombre. Cuenta los caracteres completos (no las mitades de un
 * par sustituto), así un nombre que empieza por un emoji no se rompe.
 */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const first = [...words[0]][0] ?? ''
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : ''
  return `${first}${last}`.toLocaleUpperCase('es')
}
