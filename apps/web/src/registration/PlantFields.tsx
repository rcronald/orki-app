import type { Dispatch, ReactNode, Ref } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { Chip } from '../components/ui/Chip.tsx'
import { Collapsible } from '../components/ui/Collapsible.tsx'
import { FormPair } from '../components/ui/FormLayout.tsx'
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
import { PLACE_FIELDS, type PlaceField } from './field-order.ts'
import {
  PLANT_TEXT_MAX_LENGTH,
  type PlantFormAction,
  type PlantFormErrors,
  type PlantFormValues,
} from './form-state.ts'
import { OriginField } from './OriginField.tsx'
import {
  FLOWER_COLOR_LABEL,
  PLANT_FORM_TEXT,
  PLANT_TYPE_LABEL,
} from './texts.ts'

// Campos de la planta que el registro (PlantForm) y la edición
// (EditPlantForm) pintan igual. Dónde va cada uno lo dice field-order.ts.

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
function AcquiredOnField({
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
function NicknameField({
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
function FlowerColorField({
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

/** Referencias de los campos que pintan DateAndPlaceRow y PlantDetailsSection. */
export interface PlaceFieldRefs {
  dateRef: Ref<HTMLInputElement>
  originRef: Ref<HTMLInputElement>
  locationRef: Ref<HTMLInputElement>
  nicknameRef: Ref<HTMLInputElement>
}

interface PlaceFieldsProps {
  values: PlantFormValues
  errors: PlantFormErrors
  dispatch: Dispatch<PlantFormAction>
  /** Plantas ya cargadas, para sugerir los orígenes y ubicaciones que ya usaste. */
  knownPlants: readonly CollectionPlant[] | null
  refs: PlaceFieldRefs
}

/** El origen o la ubicación, con las sugerencias de los que ya usaste. */
function PlaceInput({
  field,
  values,
  errors,
  dispatch,
  knownPlants,
  refs,
}: PlaceFieldsProps & { field: PlaceField }) {
  return (
    <OriginField
      field={field}
      value={values[field]}
      dispatch={dispatch}
      knownPlants={knownPlants}
      error={errors[field]}
      inputRef={field === 'origin' ? refs.originRef : refs.locationRef}
    />
  )
}

/**
 * La fecha de adquisición y, a su lado, el campo de lugar que va a la vista
 * (PLACE_FIELDS.beside). La fecha, como mucho `today`.
 */
export function DateAndPlaceRow({
  today,
  ...props
}: PlaceFieldsProps & { today: string }) {
  return (
    <FormPair>
      <AcquiredOnField
        value={props.values.acquiredOn}
        max={today}
        error={props.errors.acquiredOn}
        dispatch={props.dispatch}
        inputRef={props.refs.dateRef}
      />
      <PlaceInput field={PLACE_FIELDS.beside} {...props} />
    </FormPair>
  )
}

/**
 * «Más detalles (opcional)», plegable: el campo de lugar que no va a la vista
 * (PLACE_FIELDS.inDetails), el apodo, el color de la flor y, al final,
 * `children` (lo propio de cada formulario).
 */
export function PlantDetailsSection({
  open,
  onOpenChange,
  disabled,
  children,
  ...props
}: PlaceFieldsProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  children?: ReactNode
}) {
  return (
    <fieldset disabled={disabled} className="min-w-[0]">
      <Collapsible
        title={
          <span>
            {PLANT_FORM_TEXT.detailsTitle}{' '}
            <span className="font-normal text-neutral-700">
              {PLANT_FORM_TEXT.optional}
            </span>
          </span>
        }
        headingLevel={2}
        open={open}
        onOpenChange={onOpenChange}
        className="rounded-md border border-secondary"
      >
        <div className="flex flex-col gap-space-5 pt-space-3">
          <PlaceInput field={PLACE_FIELDS.inDetails} {...props} />
          <NicknameField
            value={props.values.nickname}
            error={props.errors.nickname}
            dispatch={props.dispatch}
            inputRef={props.refs.nicknameRef}
          />
          <FlowerColorField
            value={props.values.flowerColor}
            dispatch={props.dispatch}
          />
          {children}
        </div>
      </Collapsible>
    </fieldset>
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
