import { fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import {
  Autocomplete,
  type AutocompleteAction,
  type AutocompleteOption,
} from './Autocomplete.tsx'

const SPECIES: readonly AutocompleteOption[] = [
  { id: 'p-amabilis', label: 'Phalaenopsis amabilis', secondary: 'Mariposa' },
  {
    id: 'p-aphrodite',
    label: 'Phalaenopsis aphrodite',
    secondary: 'Sinónimo: Phalaenopsis amabilis var. aphrodite',
  },
  { id: 'c-maxima', label: 'Cattleya maxima' },
]

interface HarnessProps {
  options?: readonly AutocompleteOption[]
  loading?: boolean
  error?: string
  minQueryLength?: number
  action?: AutocompleteAction
  onOptionSelect?: (option: AutocompleteOption) => void
  initialValue?: string
}

// Quien usa el componente filtra y guarda el texto; aquí, con un filtro simple.
function Harness({
  options = SPECIES,
  loading,
  error,
  minQueryLength,
  action,
  onOptionSelect,
  initialValue = '',
}: HarnessProps) {
  const [value, setValue] = useState(initialValue)
  const query = value.trim().toLowerCase()
  const filtered = query
    ? options.filter((option) => option.label.toLowerCase().includes(query))
    : []
  return (
    <Autocomplete
      label="Nombre científico"
      hint="Si no aparece, guárdala con el nombre como la conoces."
      labelStyle="scientific"
      value={value}
      onValueChange={setValue}
      options={filtered}
      loading={loading}
      error={error}
      minQueryLength={minQueryLength}
      action={action}
      onOptionSelect={(option) => {
        setValue(option.label)
        onOptionSelect?.(option)
      }}
    />
  )
}

function getInput() {
  return screen.getByRole('combobox', { name: 'Nombre científico' })
}

function type(text: string) {
  fireEvent.change(getInput(), { target: { value: text } })
}

function key(name: string, init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(getInput(), { key: name, ...init })
}

describe('Autocomplete', () => {
  it('tiene etiqueta visible, ayuda y los atributos de combobox cerrado', () => {
    render(<Harness />)
    const input = getInput()

    expect(screen.getByText('Nombre científico')).toBeVisible()
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(input).toHaveAccessibleDescription(
      'Si no aparece, guárdala con el nombre como la conoces.',
    )
    const listbox = screen.getByRole('listbox', { hidden: true })
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    expect(listbox).not.toBeVisible()
    // La lista con scroll no es una parada de Tab (Chrome la haría enfocable).
    expect(listbox.parentElement).toHaveAttribute('tabindex', '-1')
  })

  it('abre la lista al escribir y anuncia el número de resultados', () => {
    render(<Harness />)
    getInput().focus()
    type('phal')

    expect(getInput()).toHaveAttribute('aria-expanded', 'true')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAccessibleName(
      /^Phalaenopsis amabilis,\s*Mariposa$/,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 resultados. Usa las flechas para elegir.',
    )
  })

  it('recorre las sugerencias con las flechas, con vuelta al principio', () => {
    render(<Harness />)
    getInput().focus()
    type('phal')
    const [first, second] = screen.getAllByRole('option')

    key('ArrowDown')
    expect(getInput()).toHaveAttribute('aria-activedescendant', first?.id)
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(second).toHaveAttribute('aria-selected', 'false')

    key('ArrowDown')
    expect(getInput()).toHaveAttribute('aria-activedescendant', second?.id)

    key('ArrowDown')
    expect(getInput()).toHaveAttribute('aria-activedescendant', first?.id)

    key('ArrowUp')
    expect(getInput()).toHaveAttribute('aria-activedescendant', second?.id)

    // El foco real sigue en el campo.
    expect(getInput()).toHaveFocus()
  })

  it('Inicio y Fin devuelven la opción activa al campo', () => {
    render(<Harness />)
    getInput().focus()
    type('phal')
    key('ArrowDown')
    key('Home')

    expect(getInput()).not.toHaveAttribute('aria-activedescendant')
    expect(getInput()).toHaveAttribute('aria-expanded', 'true')
  })

  it('elige con Enter, cierra la lista y avisa a quien lo usa', () => {
    const onOptionSelect = vi.fn()
    render(<Harness onOptionSelect={onOptionSelect} />)
    getInput().focus()
    type('phal')
    key('ArrowDown')
    key('ArrowDown')
    key('Enter')

    expect(onOptionSelect).toHaveBeenCalledWith(SPECIES[1])
    expect(getInput()).toHaveValue('Phalaenopsis aphrodite')
    expect(getInput()).toHaveAttribute('aria-expanded', 'false')
    expect(getInput()).not.toHaveAttribute('aria-activedescendant')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('Enter sin opción activa no elige nada', () => {
    const onOptionSelect = vi.fn()
    render(<Harness onOptionSelect={onOptionSelect} />)
    getInput().focus()
    type('phal')
    key('Enter')

    expect(onOptionSelect).not.toHaveBeenCalled()
    expect(getInput()).toHaveAttribute('aria-expanded', 'true')
  })

  it('elige con clic sin quitar el foco del campo', () => {
    const onOptionSelect = vi.fn()
    render(<Harness onOptionSelect={onOptionSelect} />)
    getInput().focus()
    type('catt')
    const option = screen.getByRole('option', { name: 'Cattleya maxima' })

    expect(fireEvent.mouseDown(option)).toBe(false)
    fireEvent.click(option)

    expect(onOptionSelect).toHaveBeenCalledWith(SPECIES[2])
    expect(getInput()).toHaveValue('Cattleya maxima')
  })

  it('Escape cierra la lista y, con la lista cerrada, borra el texto', () => {
    render(<Harness />)
    getInput().focus()
    type('phal')
    key('ArrowDown')
    key('Escape')

    expect(getInput()).toHaveAttribute('aria-expanded', 'false')
    expect(getInput()).not.toHaveAttribute('aria-activedescendant')
    expect(getInput()).toHaveValue('phal')

    key('Escape')
    expect(getInput()).toHaveValue('')
  })

  it('flecha abajo reabre la lista cerrada y activa la primera sugerencia', () => {
    render(<Harness />)
    getInput().focus()
    type('phal')
    key('Escape')
    key('ArrowDown')

    expect(getInput()).toHaveAttribute('aria-expanded', 'true')
    expect(getInput()).toHaveAttribute(
      'aria-activedescendant',
      screen.getAllByRole('option')[0]?.id,
    )
  })

  it('Alt + flecha abajo reabre la lista sin activar ninguna sugerencia', () => {
    render(<Harness />)
    getInput().focus()
    type('phal')
    key('Escape')
    key('ArrowDown', { altKey: true })

    expect(getInput()).toHaveAttribute('aria-expanded', 'true')
    expect(getInput()).not.toHaveAttribute('aria-activedescendant')
  })

  it('se cierra al perder el foco', () => {
    render(<Harness />)
    getInput().focus()
    type('phal')
    fireEvent.blur(getInput())

    expect(getInput()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('listbox', { hidden: true })).not.toBeVisible()
  })

  it('muestra y anuncia que no hay resultados', () => {
    render(<Harness />)
    getInput().focus()
    type('zzz')

    expect(screen.getByText('Sin resultados')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Sin resultados.')
    // Sin sugerencias ni acción no hay lista que expandir.
    expect(getInput()).toHaveAttribute('aria-expanded', 'false')
    key('ArrowDown')
    expect(getInput()).not.toHaveAttribute('aria-activedescendant')
  })

  it('muestra y anuncia la carga', () => {
    render(<Harness loading />)
    getInput().focus()
    type('zzz')

    expect(
      screen.getByText('Buscando…', {
        selector: '.orki-autocomplete__message',
      }),
    ).toBeVisible()
    expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Buscando…')
  })

  it('la acción final se alcanza con el teclado igual que una sugerencia', () => {
    const onAction = vi.fn()
    render(
      <Harness
        action={{
          label: 'No la encuentro: guardarla con este nombre',
          onSelect: onAction,
        }}
      />,
    )
    getInput().focus()
    type('Phalenopsis amabils')

    expect(screen.getByText('Sin resultados')).toBeVisible()
    expect(getInput()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sin resultados. Usa las flechas para elegir.',
    )
    const action = screen.getByRole('option', {
      name: 'No la encuentro: guardarla con este nombre',
    })

    key('ArrowDown')
    expect(getInput()).toHaveAttribute('aria-activedescendant', action.id)
    expect(action).toHaveAttribute('aria-selected', 'true')

    key('Enter')
    expect(onAction).toHaveBeenCalledOnce()
    expect(getInput()).toHaveAttribute('aria-expanded', 'false')
  })

  it('la acción va después de las sugerencias', () => {
    const onAction = vi.fn()
    const onOptionSelect = vi.fn()
    render(
      <Harness
        onOptionSelect={onOptionSelect}
        action={{ label: 'No la encuentro', onSelect: onAction }}
      />,
    )
    getInput().focus()
    type('catt')
    key('ArrowUp')
    key('Enter')

    expect(onAction).toHaveBeenCalledOnce()
    expect(onOptionSelect).not.toHaveBeenCalled()
  })

  it('muestra el nombre científico en cursiva o el texto normal', () => {
    const { rerender } = render(
      <Autocomplete
        label="Origen"
        value="viv"
        onValueChange={() => {}}
        options={[{ id: 'v1', label: 'Vivero Moyobamba' }]}
        onOptionSelect={() => {}}
      />,
    )
    const input = screen.getByRole('combobox', { name: 'Origen' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByText('Vivero Moyobamba')).not.toHaveClass(
      'orki-autocomplete__label--scientific',
    )

    rerender(
      <Autocomplete
        label="Origen"
        labelStyle="scientific"
        value="viv"
        onValueChange={() => {}}
        options={[{ id: 'v1', label: 'Vivero Moyobamba' }]}
        onOptionSelect={() => {}}
      />,
    )
    expect(screen.getByText('Vivero Moyobamba')).toHaveClass(
      'orki-autocomplete__label--scientific',
    )
  })

  it('reenvía ref, atributos nativos y manejadores del campo', () => {
    const ref = createRef<HTMLInputElement>()
    const onKeyDown = vi.fn()
    const onBlur = vi.fn()
    render(
      <Autocomplete
        ref={ref}
        label="Origen"
        name="origen"
        placeholder="Tienda o vivero"
        required
        aria-describedby="externo"
        value=""
        onValueChange={() => {}}
        options={[]}
        onOptionSelect={() => {}}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />,
    )
    const input = screen.getByRole('combobox', { name: 'Origen' })

    expect(ref.current).toBe(input)
    expect(input).toHaveAttribute('name', 'origen')
    expect(input).toHaveAttribute('placeholder', 'Tienda o vivero')
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-describedby', 'externo')
    fireEvent.keyDown(input, { key: 'a' })
    fireEvent.blur(input)
    expect(onKeyDown).toHaveBeenCalledOnce()
    expect(onBlur).toHaveBeenCalledOnce()
  })
  describe('error y longitud mínima', () => {
    const OFFLINE =
      'Sin conexión: no se puede buscar en el catálogo. Revisa tu conexión y vuelve a escribir.'
    const message = { selector: '.orki-autocomplete__message' }

    it('muestra y anuncia el error en lugar de "sin resultados"', () => {
      render(<Harness options={[]} error={OFFLINE} />)
      getInput().focus()
      type('phal')

      expect(screen.getByText(OFFLINE, message)).toBeVisible()
      expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(OFFLINE)
      expect(getInput()).toHaveAttribute('aria-expanded', 'false')
    })

    it('con error, el campo sigue usable y la acción final se alcanza con el teclado', () => {
      const onAction = vi.fn()
      render(
        <Harness
          options={[]}
          error={OFFLINE}
          action={{ label: 'No la encuentro', onSelect: onAction }}
        />,
      )
      getInput().focus()
      type('phal')
      expect(screen.getByRole('status')).toHaveTextContent(
        `${OFFLINE} Usa las flechas para elegir.`,
      )

      key('ArrowDown')
      key('Enter')
      expect(onAction).toHaveBeenCalledOnce()

      type('phala')
      expect(getInput()).toHaveValue('phala')
      key('Escape')
      key('Escape')
      expect(getInput()).toHaveValue('')
    })

    it('mientras carga no muestra el error', () => {
      render(<Harness options={[]} error={OFFLINE} loading />)
      getInput().focus()
      type('phal')

      expect(screen.queryByText(OFFLINE, message)).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Buscando…')
    })

    it('por debajo de la longitud mínima no muestra "sin resultados" ni el error', () => {
      render(<Harness options={[]} minQueryLength={2} error={OFFLINE} />)
      getInput().focus()
      type(' p ')

      expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument()
      expect(screen.queryByText(OFFLINE, message)).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toBeEmptyDOMElement()

      type('ph')
      expect(screen.getByText(OFFLINE, message)).toBeVisible()
    })

    it('no tiene fallos A ni AA con el error a la vista', async () => {
      document.documentElement.lang = 'es'
      document.title = 'Prueba'
      render(
        <main>
          <Harness
            options={[]}
            error={OFFLINE}
            action={{ label: 'No la encuentro', onSelect: () => {} }}
          />
        </main>,
      )
      getInput().focus()
      type('phal')

      await expectNoAxeViolations()
    })
  })
})
