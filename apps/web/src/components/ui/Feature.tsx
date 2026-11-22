import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon.tsx'

// FeatureItem del design system (#190, #199): ventaja de la app con un icono,
// un título y una frase. FeatureList (orki-features) las pone de a tres en
// fila; hasta 720 px se apilan, sin líneas separadoras.
//
// Dos variantes, de toda la fila:
// - por defecto: icono en un recuadro color-secondary-soft y líneas
//   verticales entre ventajas;
// - plain (orki-features--plain, la de la portada): icono de trazo, sin
//   recuadro ni líneas, con el margen de la página ya incluido.
//
// Va como lista (ul/li) en lugar de los div del ejemplo del sistema: son tres
// elementos del mismo tipo y el lector de pantalla anuncia cuántos hay. Las
// listas no llevan viñetas ni sangría por el reinicio de estilos de Tailwind.

interface FeatureListProps {
  /** Icono de trazo sin recuadro ni líneas entre ventajas. */
  plain?: boolean
  children: ReactNode
}

export function FeatureList({ plain = false, children }: FeatureListProps) {
  return (
    <ul
      className={plain ? 'orki-features orki-features--plain' : 'orki-features'}
    >
      {children}
    </ul>
  )
}

interface FeatureProps {
  icon: IconName
  title: string
  /** Nivel del título: h2 en la portada; h3 donde la jerarquía lo pida. */
  headingLevel?: 2 | 3
  children: ReactNode
}

export function Feature({
  icon,
  title,
  headingLevel = 2,
  children,
}: FeatureProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <li className="orki-feature">
      <span className="orki-feature__icon">
        <Icon name={icon} />
      </span>
      <div>
        <Heading className="orki-feature__title">{title}</Heading>
        <p className="orki-feature__text">{children}</p>
      </div>
    </li>
  )
}
