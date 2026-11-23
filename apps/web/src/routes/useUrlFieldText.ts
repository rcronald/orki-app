import { useState, type Dispatch, type SetStateAction } from 'react'
import { NavigationType, useLocation, useNavigationType } from 'react-router'

/**
 * Texto de un campo (un buscador) que se guarda también en la dirección
 * (?q=…), sin perder letras al escribir deprisa (#229, #256).
 *
 * El campo tiene su propio estado y es la fuente de verdad mientras la
 * pantalla está abierta: la dirección se actualiza dentro de una transición
 * del enrutador y llega atrasada, así que si el campo leyera de ella (o se
 * corrigiera con ella al pintar), React le devolvería el valor viejo en cada
 * pulsación y se perderían letras.
 *
 * La dirección (`urlValue`) solo manda al abrir la pantalla y cuando cambia
 * por OTRA navegación: un enlace a la misma pantalla (PUSH) o atrás y adelante
 * (POP). Quien usa el hook escribe el texto en la dirección siempre con
 * `replace`, así que una navegación REPLACE nunca trae un texto nuevo de fuera
 * y no toca el campo.
 */
export function useUrlFieldText(
  urlValue: string,
): [string, Dispatch<SetStateAction<string>>] {
  const [text, setText] = useState(urlValue)
  const navigationType = useNavigationType()
  const location = useLocation()
  // Ajuste al cambiar de ubicación, al pintar (sin efecto): en una navegación
  // REPLACE solo se anota la ubicación; el texto del campo no se toca.
  const [seenLocation, setSeenLocation] = useState(location.key)
  if (seenLocation !== location.key) {
    setSeenLocation(location.key)
    if (navigationType !== NavigationType.Replace) setText(urlValue)
  }
  return [text, setText]
}
