import { Logo } from '../components/Logo.tsx'
import { Example, Section } from './layout.tsx'

// Logotipo de orqui.app (#173), en sus dos variantes para fondo claro. Los
// colores son tokens: color-primary (pétalos), color-secondary (pétalo
// central), color-neutral-0 (marca de verificación), color-neutral-900
// («orqui»), color-neutral-700 («.apps») y color-primary-soft (fondo del
// símbolo).
export function BrandSection() {
  return (
    <Section
      id="marca"
      title="Marca"
      description="Componente Logo. Su nombre accesible es «orqui.app»: no se repite el nombre en texto al lado."
    >
      <div className="grid gap-space-4 md:grid-cols-2">
        <Example
          title="Logotipo completo"
          description="Cabecera, inicio y pantallas de acceso."
        >
          <Logo className="block h-auto w-[280px] max-w-full" />
        </Example>
        <Example
          title="Símbolo"
          description="Variante symbol: la flor sobre su fondo, como en los iconos de la PWA."
        >
          <Logo variant="symbol" className="block h-[96px] w-auto" />
        </Example>
      </div>
    </Section>
  )
}
