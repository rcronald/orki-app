import { useId } from 'react'
import { PLANT_SORTS, type PlantSort } from '../collection/selectors.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { SORT_TEXT } from './texts.ts'

interface SortSelectProps {
  value: PlantSort
  onChange: (sort: PlantSort) => void
  /**
   * inline: la etiqueta a la izquierda (la barra del buscador, en
   * escritorio). stacked: encima (el panel de filtros, en el celular).
   */
  layout: 'inline' | 'stacked'
  className?: string
}

const LAYOUT_CLASSES = {
  inline: 'flex-row items-center',
  stacked: 'flex-col items-start',
} as const

/**
 * «Ordenar» de «Mi colección» (#292): un `select` nativo con su etiqueta
 * visible («Ordenar», con el estilo de orki-field__label), sin el aspecto
 * nativo (Safari ignora el alto de un select nativo y lo dejaba en 26 px) y
 * con la flecha del sistema encima, como el filtro de la bitácora. Mide lo
 * mismo que el buscador: 48 px de alto como mínimo.
 */
export function SortSelect({
  value,
  onChange,
  layout,
  className,
}: SortSelectProps) {
  const id = useId()
  return (
    <div
      className={`flex gap-space-2 ${LAYOUT_CLASSES[layout]} ${className ?? ''}`}
    >
      <label htmlFor={id} className="orki-field__label">
        {SORT_TEXT.label}
      </label>
      <div className="relative flex max-w-[100%]">
        <select
          id={id}
          className="orki-field__input min-h-[48px] w-auto max-w-[100%] cursor-pointer appearance-none pr-[44px]"
          value={value}
          onChange={(event) => onChange(event.target.value as PlantSort)}
        >
          {PLANT_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SORT_TEXT.options[sort]}
            </option>
          ))}
        </select>
        <Icon
          name="chevron-down"
          className="pointer-events-none absolute top-[50%] right-space-3 size-[20px] -translate-y-[50%] text-neutral-900"
        />
      </div>
    </div>
  )
}
