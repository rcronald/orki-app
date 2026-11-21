import { useEffect } from 'react'
import tokensCss from '../styles/tokens.css?raw'
import { parseTokens } from '../styles/tokens.ts'
import { AccountSection } from './AccountSection.tsx'
import { CatalogAdminSection } from './CatalogAdminSection.tsx'
import { ComponentSections } from './ComponentSections.tsx'
import { InventorySection } from './InventorySection.tsx'
import { RegistrationSection } from './RegistrationSection.tsx'
import { PhotoSection } from './PhotoSection.tsx'
import { TokenSections } from './TokenSections.tsx'

// Página interna de muestra del design system (issue #45). Solo existe fuera
// de producción: main.tsx la carga de forma diferida en /muestra y, con
// VITE_APP_ENV=prod, el build no la incluye.

const DESIGN_SYSTEM_URL = 'https://claude.ai/artifact/BCQrAtoNqdjgkxEBfLpoaK'
const PAGE_TITLE = 'Muestra del design system · Orki'

const tokens = parseTokens(tokensCss)

const SECTIONS = [
  { id: 'colores', label: 'Color' },
  { id: 'tipografia', label: 'Tipografía' },
  { id: 'espaciado', label: 'Espaciado, radios y sombra' },
  { id: 'iconos', label: 'Iconos' },
  { id: 'botones', label: 'Botones' },
  { id: 'chips', label: 'Chips' },
  { id: 'campos', label: 'Campo de texto' },
  { id: 'insignias', label: 'Insignias' },
  { id: 'tarjetas', label: 'Tarjetas de ejemplar' },
  { id: 'respuesta', label: 'Respuesta de ¿Ya la tengo?' },
  { id: 'buscador', label: 'Buscador' },
  { id: 'plegable', label: 'Sección plegable' },
  { id: 'inventario', label: 'Pantalla de inventario' },
  { id: 'registro', label: 'Formulario de registro' },
  { id: 'backoffice', label: 'Backoffice del catálogo' },
  { id: 'fotos', label: 'Fotos' },
  { id: 'cuenta', label: 'Pantalla de cuenta' },
] as const

export default function ShowcasePage() {
  useEffect(() => {
    const previous = document.title
    document.title = PAGE_TITLE
    return () => {
      document.title = previous
    }
  }, [])

  return (
    <div className="min-h-dvh bg-neutral-0 text-neutral-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-space-5 px-space-4 pt-space-6 pb-space-6">
        <header className="flex flex-col gap-space-3">
          <p className="text-sm text-neutral-700">
            Orki · página interna, solo fuera de producción
          </p>
          <h1 className="font-display text-display text-neutral-900">
            Muestra del design system
          </h1>
          <p className="max-w-prose text-md text-neutral-700">
            Tokens y componentes tal como los usa la app. Los valores se leen de{' '}
            <code>tokens.css</code>; la fuente de verdad del diseño es el{' '}
            <a
              className="font-semibold text-secondary underline"
              href={DESIGN_SYSTEM_URL}
            >
              design system de Orki
            </a>
            .
          </p>
          <nav aria-label="Secciones de la muestra">
            <ul className="flex flex-wrap gap-x-space-4 gap-y-space-2 text-sm">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    className="inline-block py-space-1 text-secondary underline"
                    href={`#${section.id}`}
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main className="flex flex-col gap-space-5">
          <TokenSections tokens={tokens} />
          <ComponentSections />
          <InventorySection />
          <RegistrationSection />
          <CatalogAdminSection />
          <PhotoSection />
          <AccountSection />
        </main>
      </div>
    </div>
  )
}
