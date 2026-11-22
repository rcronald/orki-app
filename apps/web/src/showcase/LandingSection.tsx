import { Link } from 'react-router'
import botanicalDrawing from '../assets/portada/dibujo-botanico.svg?no-inline'
import { PublicHeader } from '../components/PublicHeader.tsx'
import { SiteFooter } from '../components/SiteFooter.tsx'
import { Feature, FeatureList } from '../components/ui/Feature.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { PATHS } from '../routes/paths.ts'
import samplePhoto from './foto-muestra.svg'
import { Example, Section } from './layout.tsx'

// Piezas de las páginas públicas (#190, #199): NavBar (orki-nav), Hero
// (orki-hero, con la variante --split de la portada), FeatureItem
// (orki-feature, con la fila --plain), pie (orki-footer), página de texto
// (orki-textpage con su índice orki-toc), TextLink (orki-link) y el botón
// orki-btn--strong. Las mismas clases que la portada (HomePage), la
// privacidad y los créditos; el ancho de la pantalla, no el de la tarjeta,
// decide cuándo se apilan (corte en 720 px).
export function LandingSection() {
  return (
    <Section
      id="portada"
      title="Páginas públicas"
      description="Portada y páginas de texto: aquí manda el verde (orki-btn--strong, títulos y enlaces en color-secondary-strong); el rosa queda en el logotipo y la foto. Dentro de la app la acción principal sigue siendo orki-btn--primary."
    >
      <Example
        title="Barra superior (NavBar)"
        description="Logotipo que enlaza al inicio y dos botones: orki-btn--secondary y orki-btn--strong. Hasta 720 px, solo el logotipo, centrado."
      >
        <PublicHeader />
      </Example>
      <Example
        title="Bloque principal dividido (Hero --split)"
        description="Panel de texto sobre color-neutral-50 (orki-hero__panel) y foto a toda la altura hasta el borde derecho, con esquinas rectas. Hasta 720 px: texto, acciones apiladas a todo el ancho y la foto en 2:1 con radius-lg. orki-hero__action--narrow solo se ve hasta 720 px."
      >
        <section
          aria-label="Ejemplo de Hero dividido"
          className="orki-hero orki-hero--split"
        >
          <div className="orki-hero__panel">
            <p className="orki-hero__title">
              Tu colección de orquídeas, en un solo lugar
            </p>
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
          <img
            className="orki-hero__photo"
            src={samplePhoto}
            alt="Foto de muestra"
            width={400}
            height={300}
          />
        </section>
      </Example>
      <Example
        title="Bloque principal con dibujo (Hero --art)"
        description="Variante anterior, sin uso en la portada desde #200: título en text-hero y frase en text-lead; orki-hero--art pone el dibujo botánico a la izquierda (oculto hasta 720 px)."
      >
        <section
          aria-label="Ejemplo de Hero con dibujo"
          className="orki-hero orki-hero--art"
        >
          <img
            className="orki-hero__art"
            src={botanicalDrawing}
            alt=""
            width={220}
            height={490}
            loading="lazy"
          />
          <div>
            <p className="orki-hero__title">
              Tu colección de orquídeas, en un solo lugar
            </p>
            <p className="orki-hero__lead">
              Registra tus plantas y consulta tu colección aunque no tengas
              señal.
            </p>
            <div className="orki-hero__actions">
              <Link to={PATHS.signUp} className="orki-btn orki-btn--strong">
                <Icon name="sprout" />
                Crear cuenta gratis
              </Link>
            </div>
          </div>
          <img
            className="orki-hero__photo"
            src={samplePhoto}
            alt="Otra foto de muestra"
            width={400}
            height={300}
          />
        </section>
      </Example>
      <Example
        title="Ventajas sin recuadro (FeatureItem, orki-features--plain)"
        description="Icono de trazo de 44 px en color-secondary-strong, sin recuadro ni líneas entre ventajas; el margen de la página va incluido. De a tres en fila; apiladas hasta 720 px, sin separadores."
      >
        <FeatureList plain>
          <Feature icon="search" title="¿Ya la tengo?" headingLevel={3}>
            Comprueba cuántos ejemplares tienes. Si ya cargaste tu colección en
            este dispositivo, puedes consultarla sin señal.
          </Feature>
          <Feature
            icon="square-plus"
            title="Registra una orquídea"
            headingLevel={3}
          >
            Elige un nombre sugerido por el catálogo y añade la fecha de
            adquisición. La foto es opcional.
          </Feature>
          <Feature icon="layers" title="Organiza tu colección" headingLevel={3}>
            Ve tus plantas en lista o cuadrícula, agrúpalas por género y exporta
            tu inventario a CSV.
          </Feature>
        </FeatureList>
      </Example>
      <Example
        title="Ventajas con recuadro (FeatureItem)"
        description="Icono de 28 px en un recuadro color-secondary-soft, con líneas entre ventajas en fila."
      >
        <FeatureList>
          <Feature icon="sprout" title="Organiza tus plantas" headingLevel={3}>
            Registra cada orquídea con su foto y sus datos.
          </Feature>
          <Feature icon="book-open" title="Nombres confiables" headingLevel={3}>
            Más de 32&nbsp;000 especies e híbridos.
          </Feature>
          <Feature icon="search" title="Sin conexión" headingLevel={3}>
            Consulta tu colección también sin señal.
          </Feature>
        </FeatureList>
      </Example>
      <Example
        title="Pie de página (orki-footer)"
        description="Banda color-secondary-soft con línea superior color-secondary (decorativa), logotipo, lema y enlaces. En escritorio, los enlaces a la derecha; hasta 720 px, una fila por enlace con chevron-right y separador color-neutral-200."
      >
        <SiteFooter />
      </Example>
      <Example
        title="Página de texto (orki-textpage y orki-toc)"
        description="Volver con arrow-left, título en text-hero (text-display hasta 720 px), frase en text-lead, fecha en color-neutral-700, caja «En esta página» y secciones con título en font-display (subsecciones con orki-textpage__subheading), en una columna de lectura de unos 72 caracteres."
      >
        <div className="orki-textpage">
          <div className="orki-textpage__header">
            <Link to={PATHS.home} className="orki-link">
              <Icon name="arrow-left" />
              Volver al inicio
            </Link>
            <p className="orki-textpage__title">Privacidad</p>
            <p className="orki-textpage__lead">
              Qué datos guarda orqui.apps, quién puede verlos y cómo puedes
              eliminarlos.
            </p>
            <p className="orki-textpage__date">
              Última actualización: 22 de noviembre de 2026
            </p>
          </div>
          <nav aria-label="Ejemplo de índice" className="orki-toc">
            <p className="orki-toc__title">En esta página</p>
            <ul className="orki-toc__list">
              <li>
                <a href="#muestra-seccion" className="orki-toc__link">
                  Qué datos guarda orqui.apps
                </a>
              </li>
            </ul>
          </nav>
          <div className="orki-textpage__section">
            <p id="muestra-seccion" className="orki-textpage__heading">
              Qué datos guarda orqui.apps
            </p>
            <p className="orki-textpage__summary">
              Tu cuenta, tus plantas y sus fotos.
            </p>
            <p className="orki-textpage__subheading">
              Subsección (h3 en la página)
            </p>
            <ul>
              <li>Una lista con viñetas, como la del texto de privacidad.</li>
              <li>
                Con un <a href="#muestra-seccion">enlace en el texto</a>.
              </li>
            </ul>
          </div>
        </div>
      </Example>
      <Example
        title="Enlace de texto (TextLink)"
        description="Para navegar, en color-secondary-strong: subrayado y con flecha en el contenido; orki-link--nav, sin subrayar, en una barra."
      >
        <div className="flex flex-wrap items-center gap-space-5">
          <Link to={PATHS.privacy} className="orki-link">
            Leer la privacidad
            <Icon name="arrow-right" />
          </Link>
          <Link to={PATHS.privacy} className="orki-link orki-link--nav">
            Privacidad
          </Link>
        </div>
      </Example>
    </Section>
  )
}
