// Controles a los que llega el tabulador, para atrapar el foco en un diálogo.

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Los controles a los que llega Tab dentro de `container`, en orden: sin los
 * ocultos (`hidden`) y, de cada grupo de botones de opción, solo el marcado
 * (o el primero, si no hay ninguno), como hace el navegador.
 */
export function tabbableIn(container: HTMLElement): HTMLElement[] {
  const all = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE),
  ).filter((element) => !element.closest('[hidden], [inert]'))
  const radios = new Map<string, HTMLInputElement[]>()
  for (const element of all) {
    if (element instanceof HTMLInputElement && element.type === 'radio') {
      const group = radios.get(element.name) ?? []
      group.push(element)
      radios.set(element.name, group)
    }
  }
  return all.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio')
      return true
    if (element.name === '') return true
    const group = radios.get(element.name) ?? []
    const checked = group.find((radio) => radio.checked)
    return element === (checked ?? group[0])
  })
}
