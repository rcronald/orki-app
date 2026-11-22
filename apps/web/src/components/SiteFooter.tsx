import { Link } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import { Logo } from './Logo.tsx'
import { Icon } from './ui/Icon.tsx'

/** Lema de la app, el del pie y el del título de la portada. */
export const TAGLINE = 'Tu colección de orquídeas, en un solo lugar.'

// Pie de página del design system (orki-footer, #199): banda
// color-secondary-soft con una línea verde arriba, el logotipo, el lema y los
// enlaces a «Privacidad» y a «Créditos y fuentes». En escritorio, los enlaces
// a la derecha; hasta 720 px, una fila por enlace con su chevron-right (que
// solo se ve ahí) y una línea entre filas. Lo usan la portada (PublicShell) y
// el resto de la app (AppShell); las pantallas de acceso conservan su enlace a
// la privacidad.
export function SiteFooter() {
  return (
    <footer className="orki-footer">
      <div className="orki-footer__brand">
        <Logo className="orki-footer__logo" />
        <p className="orki-footer__tagline">{TAGLINE}</p>
      </div>
      <ul className="orki-footer__links">
        <li>
          <Link to={PATHS.privacy} className="orki-link orki-footer__link">
            Privacidad
            <Icon name="chevron-right" />
          </Link>
        </li>
        <li>
          <Link to={PATHS.credits} className="orki-link orki-footer__link">
            Créditos y fuentes
            <Icon name="chevron-right" />
          </Link>
        </li>
      </ul>
    </footer>
  )
}
