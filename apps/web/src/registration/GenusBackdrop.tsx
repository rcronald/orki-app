import { useEffect, useState } from 'react'
import { useReducedMotion } from '../lib/useReducedMotion.ts'
import { genusBackgroundUrl } from './genus-backgrounds.ts'

/**
 * Descarga y decodifica la imagen antes de enseñarla, para que aparezca entera
 * y con la transición. Se rechaza si no se puede cargar.
 */
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      // decode() asegura que la imagen está lista para pintarse sin tirón; si
      // el navegador no lo tiene o falla, basta con que haya cargado.
      if (typeof image.decode === 'function') {
        image.decode().then(resolve, () => resolve())
      } else {
        resolve()
      }
    }
    image.onerror = () => reject(new Error(`No se pudo cargar ${src}`))
    image.src = src
  })
}

interface GenusBackdropProps {
  /**
   * Género ya fijado en el formulario (al elegir una especie o un chip), o null.
   * Escribir el nombre no lo cambia, así que el fondo no parpadea al teclear.
   */
  genusName: string | null
  /**
   * screen (por defecto): ocupa la pantalla, detrás de todo el contenido de la
   * página; el contenedor de la app (AppShell) aísla su apilamiento para que
   * quede por encima de su fondo. contained: ocupa el contenedor posicionado
   * (y aislado) más cercano, como en la página de muestra.
   */
  placement?: 'screen' | 'contained'
  /** Precarga de la foto; para las pruebas. */
  loadImage?: (src: string) => Promise<void>
}

/**
 * Fondo por género del registro (#13): la foto del género fijado, bajo el velo
 * overlay-genus, que entra y sale con la transición motion-bg (ninguna con
 * movimiento reducido). Los géneros sin foto, o sin género, dejan el fondo
 * neutro de la página.
 *
 * La foto no retrasa el formulario: solo se pide al fijarse el género, se
 * precarga aparte y, cuando está lista, aparece con la transición. Mientras
 * llega la de otro género sigue la anterior; si no se puede cargar, queda el
 * fondo neutro. Las ya cargadas se quedan montadas (transparentes) para volver
 * a ellas sin otra descarga: son como mucho cinco.
 *
 * Es decorativo: aria-hidden y sin eventos de puntero.
 */
export function GenusBackdrop({
  genusName,
  placement = 'screen',
  loadImage = preloadImage,
}: GenusBackdropProps) {
  const target = genusBackgroundUrl(genusName)
  const reducedMotion = useReducedMotion()
  // Fotos montadas (cada una, una capa) y, de ellas, las ya pintadas al menos
  // una vez con opacidad 0: solo esas pueden aparecer con la transición.
  const [mounted, setMounted] = useState<readonly string[]>([])
  const [ready, setReady] = useState<ReadonlySet<string>>(() => new Set())
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const [shown, setShown] = useState<string | null>(null)

  // La foto visible se deriva al pintar: la del género si ya está lista; nada
  // si no hay género, no tiene foto o falló; si aún se carga, la anterior.
  const next =
    target === null || failed.has(target)
      ? null
      : ready.has(target)
        ? target
        : shown
  if (next !== shown) setShown(next)

  useEffect(() => {
    if (target === null || ready.has(target) || failed.has(target)) return
    let active = true
    let frame = 0
    loadImage(target).then(
      () => {
        if (!active) return
        setMounted((list) => (list.includes(target) ? list : [...list, target]))
        // Dos fotogramas: la capa se pinta primero transparente y después
        // pasa a opaca, así la transición se ve.
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            if (active) setReady((set) => new Set(set).add(target))
          })
        })
      },
      () => {
        if (active) setFailed((set) => new Set(set).add(target))
      },
    )
    return () => {
      active = false
      cancelAnimationFrame(frame)
    }
  }, [target, ready, failed, loadImage])

  const position =
    placement === 'screen'
      ? 'fixed inset-[0]'
      : 'absolute inset-[0] rounded-[inherit]'
  const transition = reducedMotion ? 'none' : 'opacity var(--motion-bg)'

  return (
    <div
      aria-hidden="true"
      data-testid="fondo-genero"
      data-fondo={shown ?? 'neutro'}
      className={`pointer-events-none -z-[1] overflow-hidden ${position}`}
    >
      {mounted.map((src) => (
        <div
          key={src}
          data-foto={src}
          className="absolute inset-[0] bg-cover bg-center"
          style={{
            backgroundImage: `url("${src}")`,
            opacity: src === shown ? 1 : 0,
            transition,
          }}
        />
      ))}
      {/* El velo claro que mantiene legible el formulario sobre la foto. */}
      {mounted.length > 0 && (
        <div className="absolute inset-[0] bg-[var(--overlay-genus)]" />
      )}
    </div>
  )
}
