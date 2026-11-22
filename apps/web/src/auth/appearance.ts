import type { ClerkProviderProps } from '@clerk/react'

export type ClerkAppearance = NonNullable<ClerkProviderProps['appearance']>

// Apariencia de los componentes de Clerk con los tokens del design system.
// Cada valor es una variable CSS de tokens.css, nunca un valor copiado, así un
// cambio de token llega también a las pantallas de acceso. La prueba
// appearance.test.ts comprueba que todas las variables existen en tokens.css.
//
// Clerk deriva sus tonos (hover, bordes, fondos atenuados) con color-mix() y la
// sintaxis de color relativo, que con variables CSS piden Safari 16.4+ y
// Chrome 119+. Tailwind 4, que ya usa la app, exige Safari 16.4+, así que el
// soporte de navegadores no cambia en la práctica.
// https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables
export const clerkAppearance = {
  variables: {
    // La acción principal es verde en toda la app (#206).
    colorPrimary: 'var(--color-secondary-strong)',
    colorPrimaryForeground: 'var(--color-neutral-0)',
    colorBackground: 'var(--color-neutral-0)',
    colorForeground: 'var(--color-neutral-900)',
    colorMuted: 'var(--color-neutral-50)',
    colorMutedForeground: 'var(--color-neutral-700)',
    colorNeutral: 'var(--color-neutral-900)',
    colorInput: 'var(--color-neutral-0)',
    colorInputForeground: 'var(--color-neutral-900)',
    colorDanger: 'var(--color-danger)',
    colorSuccess: 'var(--color-success)',
    colorWarning: 'var(--color-warning)',
    // Anillo de foco del sistema: color-secondary.
    colorRing: 'var(--color-secondary)',
    colorShadow: 'var(--color-neutral-900)',
    colorShimmer: 'var(--color-neutral-50)',
    // Desde Clerk Core 3 el fondo del modal se pinta opaco: hace falta un color
    // con transparencia, y el único del sistema es overlay-genus.
    colorModalBackdrop: 'var(--overlay-genus)',
    fontFamily: 'var(--font-body)',
    fontFamilyButtons: 'var(--font-body)',
    fontSize: {
      xs: 'var(--text-xs)',
      sm: 'var(--text-sm)',
      md: 'var(--text-md)',
      lg: 'var(--text-lg)',
      xl: 'var(--text-xl)',
    },
    // El sistema solo tiene dos pesos: el texto medio y el negrita van en
    // semibold, como los botones del sistema.
    fontWeight: {
      normal: 'var(--font-weight-normal)',
      medium: 'var(--font-weight-semibold)',
      semibold: 'var(--font-weight-semibold)',
      bold: 'var(--font-weight-semibold)',
    },
    // Radio base de Clerk (campos y botones), el mismo que los del sistema.
    borderRadius: 'var(--radius-md)',
  },
  elements: {
    // Los títulos del sistema van en font-display.
    headerTitle: {
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--font-weight-semibold)',
    },
    card: {
      boxShadow: 'var(--shadow-card)',
    },
  },
} satisfies ClerkAppearance
