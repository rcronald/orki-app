import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SpeciesSearchResult } from '../lib/catalogSearch.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import {
  initialPlantFormValues,
  plantFormReducer,
  type PlantFormValues,
} from './form-state.ts'
import { NameField, type NameResolution } from './NameField.tsx'
import { PLANT_FORM_TEXT } from './texts.ts'

// El campo de nombre solo (#280), como lo usa la edición: sin enlazar el
// nombre con el que se abre, enlazando lo que se escribe.

const AMABILIS: SpeciesSearchResult = {
  id: 'amabilis',
  scientificName: 'Phalaenopsis amabilis',
  genusId: 'phalaenopsis',
  genusName: 'Phalaenopsis',
  type: 'species',
  status: 'validated',
  matchedName: 'Phalaenopsis amabilis',
  matchedNameType: 'scientific',
}

const searchSpecies = vi.fn(() => Promise.resolve([AMABILIS]))

function Field({
  start,
  linkInitialName,
  onResolutionChange,
}: {
  start: PlantFormValues
  linkInitialName?: boolean
  onResolutionChange?: (resolution: NameResolution) => void
}) {
  const [values, dispatch] = useReducer(plantFormReducer, start)
  const ref = useRef<HTMLInputElement>(null)
  return (
    <main>
      <NameField
        values={values}
        dispatch={dispatch}
        searchSpecies={searchSpecies}
        inputRef={ref}
        linkInitialName={linkInitialName}
        onResolutionChange={onResolutionChange}
      />
      <output data-testid="species">{values.species?.id ?? 'ninguna'}</output>
    </main>
  )
}

const pendingPlant = {
  ...initialPlantFormValues('2026-11-23'),
  name: 'phalaenopsis amabilis',
  genus: { id: 'phalaenopsis', name: 'Phalaenopsis' },
  type: 'species' as const,
}
const input = () => screen.getByRole('combobox', { name: 'Nombre' })
const linkedSpecies = () => screen.getByTestId('species').textContent

describe('NameField: nombre exacto (#280)', () => {
  it('como en la edición, el nombre con el que se abre no se enlaza solo: se ofrece', async () => {
    document.documentElement.lang = 'es'
    document.title = 'Editar'
    const user = userEvent.setup()
    const resolutions: NameResolution[] = []
    render(
      <Field
        start={pendingPlant}
        onResolutionChange={(resolution) => resolutions.push(resolution)}
      />,
    )

    expect(await screen.findByText(/^Coincide con/)).toHaveTextContent(
      'Coincide con Phalaenopsis amabilis en el catálogo.',
    )
    expect(linkedSpecies()).toBe('ninguna')
    expect(input()).toHaveValue('phalaenopsis amabilis')
    expect(input()).toHaveAccessibleDescription(PLANT_FORM_TEXT.nameHint)
    expect(resolutions.at(-1)).toBe('offer')
    await expectNoAxeViolations()

    await user.click(
      screen.getByRole('button', { name: 'Elegir Phalaenopsis amabilis' }),
    )
    expect(linkedSpecies()).toBe('amabilis')
    expect(input()).toHaveValue('Phalaenopsis amabilis')
    expect(resolutions.at(-1)).toBe('settled')
  })

  it('lo que se escribe sí se enlaza solo, y se anuncia sin mover el foco', async () => {
    const user = userEvent.setup()
    render(<Field start={initialPlantFormValues('2026-11-23')} />)

    await user.type(input(), 'Phalaenopsis amabilis')
    await waitFor(() => expect(linkedSpecies()).toBe('amabilis'))
    expect(input()).toHaveFocus()
    expect(
      screen.getByText(PLANT_FORM_TEXT.nameLinked('Phalaenopsis amabilis')),
    ).toHaveAttribute('role', 'status')
    // La lista se cierra: nada que elegir ni «No está en el catálogo».
    expect(input()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('No está en el catálogo.')).toBeNull()

    // Cambiar el texto la desenlaza, como siempre.
    await user.type(input(), ' alba')
    expect(linkedSpecies()).toBe('ninguna')
  })

  it('con linkInitialName (el registro), el nombre inicial se enlaza al montarse', async () => {
    render(<Field start={pendingPlant} linkInitialName />)
    await waitFor(() => expect(linkedSpecies()).toBe('amabilis'))
    expect(input()).toHaveValue('Phalaenopsis amabilis')
  })

  it('«No la encuentro: guardarla con este nombre» deja el nombre por validar', async () => {
    const user = userEvent.setup()
    render(<Field start={initialPlantFormValues('2026-11-23')} />)

    await user.type(input(), 'Phalaenopsis amabilis')
    await waitFor(() => expect(linkedSpecies()).toBe('amabilis'))
    await user.type(input(), 'x')
    await user.click(
      await screen.findByRole('option', {
        name: 'No la encuentro: guardarla como «Phalaenopsis amabilisx»',
      }),
    )
    expect(linkedSpecies()).toBe('ninguna')
    expect(input()).toHaveAccessibleDescription(PLANT_FORM_TEXT.namePendingHint)
  })
})
