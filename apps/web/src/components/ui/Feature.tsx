import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon.tsx'

// FeatureItem del design system (#190): ventaja de la app con un icono en un
// recuadro color-secondary-soft, un título y una frase. FeatureList
// (orki-features) las pone de a tres en fila, con sus líneas divisorias; bajo
// 720 px se apilan.
//
// Va como lista (ul/li) en lugar de los div del ejemplo del sistema: son tres
// elementos del mismo tipo y el lector de pantalla anuncia cuántos hay. Las
// listas no llevan viñetas ni sangría por el reinicio de estilos de Tailwind.
//
// Apiladas, el sistema las separa solo con espacio; la maqueta de celular
// pone una línea color-neutral-200 entre una y otra, y se añade aquí con
// utilidades (propuesta para el sistema).

export function FeatureList({ children }: { children: ReactNode }) {
  return <ul className="orki-features">{children}</ul>
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
    <li className="orki-feature publico-estrecho:not-first:border-t publico-estrecho:not-first:border-neutral-200 publico-estrecho:not-first:pt-space-5">
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
