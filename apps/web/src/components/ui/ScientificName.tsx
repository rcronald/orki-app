import { Fragment } from 'react'
import { scientificNameParts } from './scientific-name.ts'

export interface ScientificNameProps {
  /** Nombre tal como está guardado, con el signo "×" si lo lleva. */
  name: string
}

// Nombre científico con cada tramo en cursiva o en redonda según la
// nomenclatura (ver scientific-name.ts): el género y los epítetos en cursiva;
// el signo "×", las abreviaturas de rango, el grex y el cultivar en redonda.
// Solo decide la inclinación: la fuente y el tamaño los pone el contenedor
// (scientific-name, orki-card__name). El lector de pantalla lee el nombre
// entero, sin cortes.
//
// Los tramos en redonda van en la fuente de cuerpo: de Playfair Display el
// sistema solo carga la cursiva 400 y la redonda 600 (styles/fonts.css), y la
// redonda 600 junto a la cursiva 400 se ve como negrita.
const ROMAN = 'not-italic font-body'
export function ScientificName({ name }: ScientificNameProps) {
  return (
    <>
      {scientificNameParts(name).map((part, index) => {
        // Los espacios de los extremos van fuera del <span>: así el nombre
        // accesible conserva la separación entre palabras.
        const [, before = '', text = '', after = ''] =
          /^(\s*)(.*?)(\s*)$/s.exec(part.text) ?? []
        return (
          <Fragment key={index}>
            {before}
            {text !== '' && (
              <span className={part.italic ? 'italic' : ROMAN}>{text}</span>
            )}
            {after}
          </Fragment>
        )
      })}
    </>
  )
}
