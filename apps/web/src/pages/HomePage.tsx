import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import botanicalDrawing from '../assets/portada/dibujo-botanico.svg?no-inline'
import { isAccountDeletedState } from '../account/deletion-status.ts'
import { DELETED_NOTICE } from '../account/texts.ts'
import { Feature, FeatureList } from '../components/ui/Feature.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { useFocusOnNavigation, usePageTitle } from '../routes/navigation.ts'
import { PATHS } from '../routes/paths.ts'
import { HeroPhoto } from './HeroPhoto.tsx'

// Portada pública (#179, #192), según las maquetas y con las piezas de las
// páginas públicas del design system: Hero (título, frase, dos acciones, foto
// y dibujo botánico) y tres FeatureItem. La NavBar la pone PublicShell. Se
// ve sin sesión, también sin conexión y aunque Clerk no cargue; con sesión,
// `/` lleva a la colección (HomeRoute).
//
// Los textos son los propuestos en #179: nada que la app no haga hoy. Sin
// enlaces al catálogo hasta que exista la consulta pública (#187).
//
// Tras eliminar la cuenta (#110) se llega aquí con el estado
// { accountDeleted: true } y se muestra la confirmación.
export function HomePage() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  usePageTitle(null)
  useFocusOnNavigation(headingRef)
  const location = useLocation()
  const navigate = useNavigate()
  const [deleted] = useState(() => isAccountDeletedState(location.state))
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!deleted) return
    // La región ya está montada (vacía) cuando llega el texto, un instante
    // después: así el lector de pantalla lo anuncia.
    const timer = setTimeout(() => setNotice(DELETED_NOTICE), 0)
    // Sin el estado en el historial, recargar no repite el aviso.
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    )
    return () => clearTimeout(timer)
    // Solo al llegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleted])

  return (
    <>
      {deleted && (
        <div role="status" className="px-space-4 pt-space-4">
          {notice && (
            <p className="mx-auto max-w-sm rounded-md bg-neutral-50 p-space-3 text-center text-md text-neutral-900">
              {notice}
            </p>
          )}
        </div>
      )}
      {/* Desde 721 px, sin margen arriba: la foto arranca en la línea de la
          cabecera, como en la maqueta de escritorio (el sistema deja 32 px). */}
      <section
        aria-labelledby="portada-titulo"
        className="orki-hero orki-hero--bleed orki-hero--art not-publico-estrecho:pt-[0]"
      >
        {/* Dibujo botánico decorativo (alt vacío). bundle.css lo oculta
            hasta 720 px; con carga diferida, el celular no lo descarga. */}
        <img
          className="orki-hero__art"
          src={botanicalDrawing}
          alt=""
          width={220}
          height={490}
          loading="lazy"
        />
        <div>
          <h1
            id="portada-titulo"
            ref={headingRef}
            tabIndex={-1}
            className="orki-hero__title"
          >
            Tu colección de orquídeas, en un solo lugar
          </h1>
          <p className="orki-hero__lead">
            Registra tus plantas con foto, usa sus nombres científicos correctos
            y consulta tu colección aunque no tengas señal.
          </p>
          {/* Hasta 720 px, una acción debajo de otra y a todo el ancho, como
              en la maqueta de celular (el sistema las deja en fila). */}
          <div className="orki-hero__actions publico-estrecho:flex-col">
            <Link to={PATHS.signUp} className="orki-btn orki-btn--strong">
              <Icon name="sprout" />
              Crear cuenta gratis
            </Link>
            <Link to={PATHS.signIn} className="orki-btn orki-btn--secondary">
              <Icon name="user" />
              Iniciar sesión
            </Link>
          </div>
        </div>
        <HeroPhoto />
      </section>
      {/* Cada ventaja lleva una frase corta hasta 720 px y la completa desde
          ahí, en dos líneas como máximo (regla del sistema): por eso dos
          frases del #179 van un poco recortadas. La otra está oculta con display: none, así que el lector de
          pantalla solo lee una. */}
      <div className="px-space-6 publico-estrecho:px-space-4">
        <FeatureList>
          <Feature icon="sprout" title="Organiza tus plantas">
            <span className="hidden publico-estrecho:inline">
              Registra cada orquídea con su foto y sus datos.
            </span>
            <span className="publico-estrecho:hidden">
              Registra cada orquídea en menos de un minuto, con su foto y sus
              datos esenciales.
            </span>
          </Feature>
          <Feature icon="book-open" title="Nombres confiables">
            <span className="hidden publico-estrecho:inline">
              Más de 32&nbsp;000 especies e híbridos.
            </span>
            <span className="publico-estrecho:hidden">
              Más de 32&nbsp;000 especies e híbridos, con sus sinónimos y
              nombres comunes.
            </span>
          </Feature>
          <Feature icon="search" title="¿Ya la tengo?">
            <span className="hidden publico-estrecho:inline">
              Compruébalo en segundos, también sin conexión.
            </span>
            <span className="publico-estrecho:hidden">
              Antes de comprar, comprueba en segundos si ya la tienes, también
              sin conexión.
            </span>
          </Feature>
        </FeatureList>
      </div>
    </>
  )
}
