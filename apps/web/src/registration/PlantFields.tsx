import type { Dispatch, Ref } from 'react'
import { Chip } from '../components/ui/Chip.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import {
  enumValues,
  type FlowerColor,
  type PlantType,
} from '../lib/database.ts'
import {
  ChoiceField,
  FORM_CHIP_CLASSES,
  LOCKED_CHIP_CLASSES,
} from './ChoiceField.tsx'
import {
  PLANT_TEXT_MAX_LENGTH,
  type PlantFormAction,
  type PlantFormValues,
} from './form-state.ts'
import {
  FLOWER_COLOR_LABEL,
  PLANT_FORM_TEXT,
  PLANT_TYPE_LABEL,
} from './texts.ts'

// Campos de la planta que el registro (PlantForm) y la edición
// (EditPlantForm) pintan igual. Cada formulario decide dónde va cada uno.

const PLANT_TYPES: readonly PlantType[] = ['species', 'hybrid', 'unknown']

/**
 * El tipo (especie, híbrido, no lo sé), como control segmentado. Con la
 * especie del catálogo elegida (`values.species`) queda bloqueado.
 */
export function PlantTypeField({
  values,
  dispatch,
  error,
  containerRef,
}: {
  values: PlantFormValues
  dispatch: Dispatch<PlantFormAction>
  error?: string
  containerRef: Ref<HTMLDivElement>
}) {
  const locked = values.species !== null
  return (
    <ChoiceField
      label={PLANT_FORM_TEXT.typeLabel}
      lockedHint={locked ? PLANT_FORM_TEXT.lockedHint : undefined}
      error={error}
      containerRef={containerRef}
      segmented
    >
      {(describedBy) =>
        PLANT_TYPES.map((plantType) => {
          const selected = values.type === plantType
          return (
            <Chip
              key={plantType}
              className={[
                FORM_CHIP_CLASSES,
                locked && !selected ? LOCKED_CHIP_CLASSES : '',
              ].join(' ')}
              selected={selected}
              aria-disabled={locked || undefined}
              aria-describedby={describedBy}
              onClick={() => dispatch({ type: 'typeSelected', plantType })}
            >
              {PLANT_TYPE_LABEL[plantType]}
            </Chip>
          )
        })
      }
    </ChoiceField>
  )
}

/** La fecha de adquisición, como mucho `max` (hoy). */
export function AcquiredOnField({
  value,
  max,
  error,
  dispatch,
  inputRef,
}: {
  value: string
  max: string
  error?: string
  dispatch: Dispatch<PlantFormAction>
  inputRef: Ref<HTMLInputElement>
}) {
  return (
    <TextField
      ref={inputRef}
      label={PLANT_FORM_TEXT.dateLabel}
      type="date"
      max={max}
      value={value}
      error={error}
      onChange={(event) =>
        dispatch({
          type: 'acquiredOnChanged',
          acquiredOn: event.target.value,
        })
      }
    />
  )
}

/** El apodo, texto libre. */
export function NicknameField({
  value,
  error,
  dispatch,
  inputRef,
}: {
  value: string
  error?: string
  dispatch: Dispatch<PlantFormAction>
  inputRef: Ref<HTMLInputElement>
}) {
  return (
    <TextField
      ref={inputRef}
      label={PLANT_FORM_TEXT.nicknameLabel}
      hint={PLANT_FORM_TEXT.nicknameHint}
      value={value}
      maxLength={PLANT_TEXT_MAX_LENGTH}
      autoCapitalize="sentences"
      error={error}
      onChange={(event) =>
        dispatch({
          type: 'textChanged',
          field: 'nickname',
          value: event.target.value,
        })
      }
    />
  )
}

/** El color de la flor: un chip por color, que se elige o se quita. */
export function FlowerColorField({
  value,
  dispatch,
}: {
  value: FlowerColor | null
  dispatch: Dispatch<PlantFormAction>
}) {
  return (
    <ChoiceField label={PLANT_FORM_TEXT.flowerColorLabel}>
      {() =>
        enumValues.flower_color.map((flowerColor) => (
          <Chip
            key={flowerColor}
            className={FORM_CHIP_CLASSES}
            selected={value === flowerColor}
            onClick={() =>
              dispatch({ type: 'flowerColorToggled', flowerColor })
            }
          >
            {FLOWER_COLOR_LABEL[flowerColor]}
          </Chip>
        ))
      }
    </ChoiceField>
  )
}

/** Las fotos que no se pudieron preparar, con su motivo (role="alert"). */
export function PhotoPrepareErrors({
  messages,
}: {
  messages: readonly string[]
}) {
  if (messages.length === 0) return null
  return (
    <div role="alert" className="flex flex-col gap-space-1">
      {messages.map((message) => (
        <p
          key={message}
          className="flex items-start gap-space-2 text-sm text-danger"
        >
          <Icon
            name="triangle-alert"
            className="mt-[2px] size-[16px] flex-none"
          />
          {message}
        </p>
      ))}
    </div>
  )
}
