import type { ComponentPropsWithRef, ReactNode } from 'react'

export interface FormLayoutProps {
  /** Datos principales: columna izquierda en escritorio, lo primero en móvil. */
  main: ReactNode
  /** Columna derecha en escritorio (la galería), alineada arriba con main. */
  aside?: ReactNode
  /** Bajo main en escritorio; en móvil, después de aside («Más detalles»). */
  extra?: ReactNode
  className?: string
}

// Formulario a dos columnas (orki-form, #220): en escritorio los datos a la
// izquierda (3 partes) y la galería a la derecha (2 partes), alineada arriba
// con el primer campo; lo de `extra` sigue en la columna izquierda. Hasta
// 720 px, una sola columna en el orden del documento: main, aside y extra. El
// orden del tabulador es siempre ese mismo.
export function FormLayout({ main, aside, extra, className }: FormLayoutProps) {
  return (
    <div className={['orki-form', className].filter(Boolean).join(' ')}>
      <div className="orki-form__main">{main}</div>
      {aside != null && <div className="orki-form__aside">{aside}</div>}
      {extra != null && <div className="orki-form__extra">{extra}</div>}
    </div>
  )
}

export type FormPairProps = ComponentPropsWithRef<'div'>

// Dos campos cortos en una fila (orki-form__pair), como la fecha y el origen;
// uno debajo del otro hasta 720 px.
export function FormPair({ className, ...props }: FormPairProps) {
  return (
    <div
      {...props}
      className={['orki-form__pair', className].filter(Boolean).join(' ')}
    />
  )
}

export type FormActionsProps = ComponentPropsWithRef<'div'>

// Pie de acciones de un formulario (orki-formactions, #220): en escritorio,
// las acciones a la derecha, en el orden en que se pasan (la secundaria y
// después la principal). Hasta 720 px, se apilan al revés: la principal a
// todo el ancho al final y, encima, la secundaria; con la clase
// orki-formactions__secondary, la secundaria se ve como un enlace. Nada queda
// fijo al desplazar la página.
export function FormActions({ className, ...props }: FormActionsProps) {
  return (
    <div
      {...props}
      className={['orki-formactions', className].filter(Boolean).join(' ')}
    />
  )
}
