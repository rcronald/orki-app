import { useRef } from 'react'
import type { PlantFormField } from './form-state.ts'

/**
 * Las referencias de los campos de la planta, para el registro y la edición,
 * y cómo llevar el foco a uno de ellos (el primero con error al guardar).
 * `otherGenusOpen`: si el buscador de «Otro» del género está abierto.
 */
export function usePlantFieldFocus(otherGenusOpen: boolean) {
  const nameRef = useRef<HTMLInputElement>(null)
  const genusRef = useRef<HTMLDivElement>(null)
  const typeRef = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const originRef = useRef<HTMLInputElement>(null)
  const locationRef = useRef<HTMLInputElement>(null)
  const nicknameRef = useRef<HTMLInputElement>(null)

  const focusField = (field: PlantFormField) => {
    switch (field) {
      case 'name':
        nameRef.current?.focus()
        return
      case 'genus':
        // El buscador de "Otro" si está abierto; si no, el primer chip.
        genusRef.current
          ?.querySelector<HTMLElement>(otherGenusOpen ? 'input' : 'button')
          ?.focus()
        return
      case 'type':
        typeRef.current?.querySelector<HTMLElement>('button')?.focus()
        return
      case 'acquiredOn':
        dateRef.current?.focus()
        return
      case 'origin':
        originRef.current?.focus()
        return
      case 'location':
        locationRef.current?.focus()
        return
      case 'nickname':
        nicknameRef.current?.focus()
        return
    }
  }

  return {
    nameRef,
    genusRef,
    typeRef,
    dateRef,
    originRef,
    locationRef,
    nicknameRef,
    focusField,
  }
}
