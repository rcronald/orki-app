import { screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'

/**
 * El resultado de una escritura del backoffice (#257): se anuncia una sola vez
 * en la región de estado de la pantalla y se ve, además, una copia junto a la
 * acción con aria-hidden (ResultNotice). Devuelve la región de estado.
 */
export async function findAnnouncement(
  text: string | RegExp,
): Promise<HTMLElement> {
  let status: HTMLElement | undefined
  await waitFor(() => {
    const found = screen.getAllByText(text)
    const hidden = found.filter((element) =>
      element.closest('[aria-hidden="true"]'),
    )
    const announced = found.filter(
      (element) => element.getAttribute('role') === 'status',
    )
    expect(hidden).toHaveLength(1)
    expect(announced).toHaveLength(1)
    expect(found).toHaveLength(2)
    status = announced[0]
  })
  return status as HTMLElement
}
