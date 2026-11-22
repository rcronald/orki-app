import { Link } from 'react-router'
import botanicalDrawing from '../assets/portada/dibujo-botanico.svg?no-inline'
import { PublicHeader } from '../components/PublicHeader.tsx'
import { Feature, FeatureList } from '../components/ui/Feature.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { PATHS } from '../routes/paths.ts'
import samplePhoto from './foto-muestra.svg'
import { Example, Section } from './layout.tsx'

// Piezas de las páginas públicas (#190): NavBar (orki-nav), Hero (orki-hero),
// FeatureItem (orki-feature), TextLink (orki-link) y el botón
// orki-btn--strong. Las mismas clases que la portada (HomePage); el ancho de
// la pantalla, no el de la tarjeta, decide si el Hero va en una columna o en
// dos (corte en 720 px).
export function LandingSection() {
  return (
    <Section
      id="portada"
      title="Páginas públicas"
      description="Portada sin sesión: aquí manda el verde (orki-btn--strong, títulos y enlaces en color-secondary-strong); el rosa queda en el logotipo y la foto. Dentro de la app la acción principal sigue siendo orki-btn--primary."
    >
      <Example
        title="Barra superior (NavBar)"
        description="Logotipo que enlaza al inicio, «Iniciar sesión» como enlace y «Crear cuenta gratis» como orki-btn--strong. Hasta 720 px, solo el logotipo."
      >
        <PublicHeader />
      </Example>
      <Example
        title="Bloque principal (Hero)"
        description="Título en text-hero y frase en text-lead; bajo 720 px, text-display y text-lg. orki-hero--art pone el dibujo botánico a la izquierda (oculto bajo 720 px)."
      >
        <section
          aria-label="Ejemplo de Hero"
          className="orki-hero orki-hero--art"
        >
          <img
            className="orki-hero__art"
            src={botanicalDrawing}
            alt=""
            width={220}
            height={490}
          />
          <div>
            <p className="orki-hero__title">
              Tu colección de orquídeas, en un solo lugar
            </p>
            <p className="orki-hero__lead">
              Registra tus plantas con foto y consulta tu colección aunque no
              tengas señal.
            </p>
            <div className="orki-hero__actions">
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
        title="Ventajas (FeatureItem)"
        description="Icono de 28 px en un recuadro color-secondary-soft, título y una frase. De a tres en fila; apiladas bajo 720 px."
      >
        <FeatureList>
          <Feature icon="sprout" title="Organiza tus plantas" headingLevel={3}>
            Registra cada orquídea con su foto y sus datos.
          </Feature>
          <Feature icon="book-open" title="Nombres confiables" headingLevel={3}>
            Más de 32&nbsp;000 especies e híbridos.
          </Feature>
          <Feature icon="search" title="¿Ya la tengo?" headingLevel={3}>
            Compruébalo en segundos, también sin conexión.
          </Feature>
        </FeatureList>
      </Example>
      <Example
        title="Enlace de texto (TextLink)"
        description="Para navegar, en color-secondary-strong: subrayado y con flecha en el contenido; orki-link--nav, sin subrayar, en la barra. La portada aún no lo usa (sin enlace al catálogo hasta #187)."
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
