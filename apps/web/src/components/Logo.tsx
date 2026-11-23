import type { ComponentPropsWithRef } from 'react'
import logotipo from '../assets/marca/orqui-apps-light.svg?inline'
import simbolo from '../assets/marca/orqui-apps-light-icon.svg?inline'

/** Nombre de la app, tal como se escribe: siempre en minúsculas. */
const APP_NAME = 'orqui.app'

// Variantes para fondo claro (la app no tiene tema oscuro). Las de fondo
// oscuro (orqui-apps-dark*.svg) están en la misma carpeta, sin usarse.
const VARIANTS = {
  // Flor y «orqui.app»: la marca en la cabecera, el inicio y el acceso.
  full: { src: logotipo, width: 384, height: 116 },
  // Solo la flor, sobre su fondo rosa pálido (el de los iconos de la PWA).
  symbol: { src: simbolo, width: 512, height: 512 },
} as const

export type LogoProps = Omit<
  ComponentPropsWithRef<'img'>,
  'src' | 'alt' | 'width' | 'height' | 'children'
> & {
  /**
   * full (por defecto): flor y nombre. symbol: solo la flor. compact: flor y
   * nombre en escritorio y solo la flor hasta 720 px (la barra de la app, que
   * en el celular necesita el sitio para sus pestañas).
   */
  variant?: keyof typeof VARIANTS | 'compact'
}

/** El mismo corte que las piezas del sistema (publico-estrecho). */
const NARROW = '(max-width: 720px)'

// Logotipo de orqui.app. Es una imagen con el nombre de la app como texto
// alternativo, así que su nombre accesible es «orqui.app»: al lado no debe
// repetirse el nombre en texto visible. El tamaño lo da `className` (por
// ejemplo, una altura con anchura automática); width y height son los del
// dibujo, para reservar el hueco con su proporción antes de que se pinte.
//
// Los SVG van en línea en el JavaScript (?inline, como sin-foto.svg): llegan
// con el chunk, que el service worker precachea, y se ven también sin
// conexión, sin una petición aparte.
export function Logo({ variant = 'full', ...props }: LogoProps) {
  if (variant === 'compact') {
    // Una sola imagen (un solo nombre accesible); el navegador elige el
    // dibujo según el ancho. La proporción va en cada fuente.
    const { symbol } = VARIANTS
    return (
      <picture>
        <source
          media={NARROW}
          srcSet={symbol.src}
          width={symbol.width}
          height={symbol.height}
        />
        <Logo {...props} variant="full" />
      </picture>
    )
  }
  const { src, width, height } = VARIANTS[variant]
  return (
    <img {...props} src={src} alt={APP_NAME} width={width} height={height} />
  )
}
