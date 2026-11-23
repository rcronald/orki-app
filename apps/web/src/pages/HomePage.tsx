import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { isAccountDeletedState } from '../account/deletion-status.ts'
import { DELETED_NOTICE } from '../account/texts.ts'
import { Feature, FeatureList } from '../components/ui/Feature.tsx'
import { useFocusOnNavigation, usePageTitle } from '../routes/navigation.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { PATHS } from '../routes/paths.ts'
import { HeroPhoto } from './HeroPhoto.tsx'

// Portada (#179, #200), según las maquetas de escritorio y de celular, con las
// piezas del design system: Hero dividido (orki-hero--split: título, frase,
// acciones y la foto a toda la altura) y tres FeatureItem sin recuadro
// (orki-features--plain). La NavBar y el pie los pone PublicShell. Se ve
// también sin conexión y aunque Clerk no cargue.
//
// Los textos describen funciones que existen hoy. Bajo las ventajas,
// «Explorar el catálogo» (#232), un enlace de texto a la consulta pública.
// Sin el dibujo botánico de la versión anterior (sigue en src/assets/portada/,
// sin uso).
//
// Va prerrenderada en index.html (src/prerender/, #204): cualquier cambio
// aquí sale igual en las dos, porque las dos pintan este componente.
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
      <section
        aria-labelledby="portada-titulo"
        className="orki-hero orki-hero--split"
      >
        <div className="orki-hero__panel">
          <h1
            id="portada-titulo"
            ref={headingRef}
            tabIndex={-1}
            className="orki-hero__title"
          >
            Tu colección de orquídeas, en un solo lugar
          </h1>
          <p className="orki-hero__lead">
            Registra las orquídeas que tienes y, antes de comprar otra,
            comprueba desde el celular si esa especie ya está en tu colección.
          </p>
          <div className="orki-hero__actions">
            <Link to={PATHS.signUp} className="orki-btn orki-btn--strong">
              Crear cuenta gratis
            </Link>
            <Link to={PATHS.signIn} className="orki-btn orki-btn--secondary">
              Iniciar sesión
            </Link>
          </div>
        </div>
        <HeroPhoto />
      </section>
      <FeatureList plain>
        <Feature icon="search" title="¿Ya la tengo?">
          Comprueba cuántos ejemplares tienes. Si ya cargaste tu colección en
          este dispositivo, puedes consultarla sin señal.
        </Feature>
        <Feature icon="square-plus" title="Registra una orquídea">
          Elige un nombre sugerido por el catálogo y añade la fecha de
          adquisición. La foto es opcional.
        </Feature>
        <Feature icon="layers" title="Organiza tu colección">
          Ve tus plantas en lista o cuadrícula, agrúpalas por género y exporta
          tu inventario a CSV.
        </Feature>
      </FeatureList>
      <p className="flex justify-center px-space-4 pb-space-6">
        <Link to={PATHS.catalog} className="orki-link min-h-[44px]">
          Explorar el catálogo
          <Icon name="arrow-right" />
        </Link>
      </p>
    </>
  )
}
