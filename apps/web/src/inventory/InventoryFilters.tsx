import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import {
  countActiveFilters,
  DEFAULT_FILTERS,
  toggleValue,
  type FilterOptions,
  type PlantFilters,
} from '../collection/filters.ts'
import { FLOWER_COLOR_LABEL } from '../collection/labels.ts'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import type { ActiveFilterChip } from './filter-chips.ts'
import {
  FILTERS_TEXT,
  STATUS_FILTER_LABEL,
  VALIDATION_FILTER_LABEL,
} from './texts.ts'

// Filtros del inventario (#15) en el celular: un botón "Filtros" con el número
// de activos, que abre y cierra un panel (patrón disclosure: aria-expanded y
// aria-controls, el foco se queda en el botón y el panel le sigue en el orden
// del tabulador), y una fila con los filtros activos, cada uno quitable, y
// "Quitar filtros". Los filtros que reciben estos componentes ya están
// resueltos contra las opciones (resolveFilters).

// Chips de 44 px de alto o más (zona táctil): el chip del sistema mide 36.
const TOUCH_CHIP = 'py-space-3'

/** Opciones que se ven de entrada en género y origen; el resto, con "Ver más". */
export const VISIBLE_OPTIONS = 8

export function FiltersToggle({
  ref,
  open,
  count,
  panelId,
  onToggle,
}: {
  ref?: Ref<HTMLButtonElement>
  open: boolean
  count: number
  panelId: string
  onToggle: () => void
}) {
  return (
    <button
      ref={ref}
      type="button"
      className="orki-btn orki-btn--secondary min-h-[44px] px-space-4 py-space-2"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
    >
      {FILTERS_TEXT.toggle}
      {count > 0 && (
        <>
          <span
            aria-hidden="true"
            className="rounded-pill bg-secondary px-space-2 text-sm font-semibold text-neutral-0"
          >
            {count}
          </span>
          <span className="sr-only">, {FILTERS_TEXT.activeCount(count)}</span>
        </>
      )}
      <Icon
        name="chevron-down"
        className={`motion-safe:transition-transform ${open ? 'rotate-[180deg]' : ''}`}
      />
    </button>
  )
}

interface FiltersPanelProps {
  id: string
  open: boolean
  options: FilterOptions
  filters: PlantFilters
  onChange: (filters: PlantFilters) => void
  /** Cierra el panel; quien lo usa devuelve el foco al botón "Filtros". */
  onClose: () => void
}

/**
 * Panel de filtros: estado (uno solo), género, color, origen y validación del
 * nombre (varios). Un
 * grupo sin opciones (nadie registró el color) no aparece. Escape lo cierra.
 */
export function FiltersPanel({
  id,
  open,
  options,
  filters,
  onChange,
  onClose,
}: FiltersPanelProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Escape dentro del panel lo cierra (escuchado a mano: el panel no es un
  // control, y un onKeyDown en un <div> no se admite en el JSX accesible).
  useEffect(() => {
    const panel = ref.current
    if (!panel || !open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    panel.addEventListener('keydown', onKeyDown)
    return () => panel.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const active = countActiveFilters(filters) > 0

  return (
    <section
      ref={ref}
      id={id}
      aria-label={FILTERS_TEXT.panelLabel}
      hidden={!open}
      className="flex flex-col gap-space-4 rounded-lg bg-neutral-50 p-space-4"
    >
      <FilterGroup label={FILTERS_TEXT.status}>
        {options.statuses.map((status) => (
          <Chip
            key={status}
            className={`${TOUCH_CHIP} bg-neutral-0`}
            selected={filters.status === status}
            onClick={() => onChange({ ...filters, status })}
          >
            {STATUS_FILTER_LABEL[status]}
          </Chip>
        ))}
      </FilterGroup>
      {options.genera.length > 0 && (
        <ExpandableGroup
          label={FILTERS_TEXT.genus}
          items={options.genera.map(({ genus }) => ({
            key: genus.id,
            label: genus.name,
          }))}
          selected={filters.genera}
          onToggle={(key) =>
            onChange({ ...filters, genera: toggleValue(filters.genera, key) })
          }
        />
      )}
      {options.colors.length > 0 && (
        <FilterGroup label={FILTERS_TEXT.color}>
          {options.colors.map(({ color }) => (
            <Chip
              key={color}
              className={`${TOUCH_CHIP} bg-neutral-0`}
              selected={filters.colors.includes(color)}
              onClick={() =>
                onChange({
                  ...filters,
                  colors: toggleValue(filters.colors, color),
                })
              }
            >
              {FLOWER_COLOR_LABEL[color]}
            </Chip>
          ))}
        </FilterGroup>
      )}
      {options.origins.length > 0 && (
        <ExpandableGroup
          label={FILTERS_TEXT.origin}
          items={options.origins.map(({ key, label }) => ({ key, label }))}
          selected={filters.origins}
          onToggle={(key) =>
            onChange({
              ...filters,
              origins: toggleValue(filters.origins, key),
            })
          }
        />
      )}
      {options.validations.length > 0 && (
        <FilterGroup label={FILTERS_TEXT.validation}>
          {options.validations.map((validation) => (
            <Chip
              key={validation}
              className={`${TOUCH_CHIP} bg-neutral-0`}
              selected={filters.validations.includes(validation)}
              onClick={() =>
                onChange({
                  ...filters,
                  validations: toggleValue(filters.validations, validation),
                })
              }
            >
              {VALIDATION_FILTER_LABEL[validation]}
            </Chip>
          ))}
        </FilterGroup>
      )}
      <div className="flex flex-wrap gap-space-3">
        <Button onClick={onClose}>{FILTERS_TEXT.done}</Button>
        {active && (
          <Button icon="x" onClick={() => onChange(DEFAULT_FILTERS)}>
            {FILTERS_TEXT.clearAll}
          </Button>
        )}
      </div>
    </section>
  )
}

function FilterGroup({
  label,
  id,
  children,
  after,
}: {
  label: string
  id?: string
  children: ReactNode
  after?: ReactNode
}) {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-space-2">
      <p id={labelId} className="text-sm font-semibold text-neutral-900">
        {label}
      </p>
      <ChipGroup id={id} aria-labelledby={labelId}>
        {children}
      </ChipGroup>
      {after}
    </div>
  )
}

/**
 * Grupo de selección múltiple que, con muchas opciones, enseña las primeras
 * VISIBLE_OPTIONS (más las elegidas que queden fuera) y un botón para ver el
 * resto. El orden lo dan las opciones: géneros alfabéticos, orígenes por uso.
 */
function ExpandableGroup({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string
  items: readonly { key: string; label: string }[]
  selected: readonly string[]
  onToggle: (key: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const groupId = useId()
  const chosen = new Set(selected)
  const visible =
    expanded || items.length <= VISIBLE_OPTIONS
      ? items
      : items.filter(
          (item, index) => index < VISIBLE_OPTIONS || chosen.has(item.key),
        )
  const hiddenCount = items.length - visible.length

  return (
    <FilterGroup
      label={label}
      id={groupId}
      after={
        items.length > VISIBLE_OPTIONS &&
        (expanded || hiddenCount > 0) && (
          <button
            type="button"
            className="self-start rounded-sm py-space-3 text-sm font-semibold text-secondary underline"
            aria-expanded={expanded}
            aria-controls={groupId}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? FILTERS_TEXT.showLess
              : FILTERS_TEXT.showMore(hiddenCount)}
          </button>
        )
      }
    >
      {visible.map((item) => (
        <Chip
          key={item.key}
          className={`${TOUCH_CHIP} bg-neutral-0 [overflow-wrap:anywhere]`}
          selected={chosen.has(item.key)}
          onClick={() => onToggle(item.key)}
        >
          {item.label}
        </Chip>
      ))}
    </FilterGroup>
  )
}

/**
 * Fila de filtros activos, a la vista con el panel cerrado. Cada chip quita
 * su filtro; el foco pasa al chip que ocupa su lugar (o al anterior) y, si no
 * queda ninguno, a `onEmpty` (el botón "Filtros").
 */
export function ActiveFilters({
  chips,
  onChange,
  onEmpty,
}: {
  chips: readonly ActiveFilterChip[]
  onChange: (filters: PlantFilters) => void
  onEmpty: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<number | null>(null)

  useLayoutEffect(() => {
    const index = pendingFocus.current
    if (index === null) return
    pendingFocus.current = null
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>(
      'button[data-filtro]',
    )
    if (!buttons || buttons.length === 0) return
    buttons[Math.min(index, buttons.length - 1)]?.focus()
  }, [chips])

  if (chips.length === 0) return null

  const remove = (chip: ActiveFilterChip, index: number) => {
    onChange(chip.without)
    if (chips.length === 1) onEmpty()
    else pendingFocus.current = index
  }

  return (
    <div
      ref={ref}
      role="group"
      aria-label={FILTERS_TEXT.activeLabel}
      className="orki-chips items-center"
    >
      {chips.map((chip, index) => (
        <button
          key={chip.id}
          type="button"
          data-filtro=""
          className={`orki-chip orki-chip--selected ${TOUCH_CHIP} [overflow-wrap:anywhere]`}
          aria-label={FILTERS_TEXT.remove(chip.group, chip.label)}
          onClick={() => remove(chip, index)}
        >
          {chip.label}
          <Icon name="x" />
        </button>
      ))}
      <button
        type="button"
        className="rounded-sm px-space-2 py-space-3 text-sm font-semibold text-secondary underline"
        onClick={() => {
          onChange(DEFAULT_FILTERS)
          onEmpty()
        }}
      >
        {FILTERS_TEXT.clearAll}
      </button>
    </div>
  )
}
