import type { AutocompleteOption } from '../components/ui/Autocomplete.tsx'

// Datos de ejemplo de la página de muestra: especies reales, lugares de compra
// y fechas verosímiles. No salen de ninguna base de datos.

export const SPECIES: readonly AutocompleteOption[] = [
  {
    id: 'phalaenopsis-amabilis',
    label: 'Phalaenopsis amabilis',
    secondary: 'Orquídea mariposa',
  },
  {
    id: 'phalaenopsis-schilleriana',
    label: 'Phalaenopsis schilleriana',
    secondary: 'Orquídea de Schiller',
  },
  {
    id: 'phalaenopsis-aphrodite',
    label: 'Phalaenopsis aphrodite',
    secondary: 'Sinónimo: Phalaenopsis amabilis var. aphrodite',
  },
  {
    id: 'cattleya-maxima',
    label: 'Cattleya maxima',
    secondary: 'Flor de mayo',
  },
  { id: 'cattleya-rex', label: 'Cattleya rex' },
  {
    id: 'masdevallia-veitchiana',
    label: 'Masdevallia veitchiana',
    secondary: 'Wakanki',
  },
  {
    id: 'phragmipedium-kovachii',
    label: 'Phragmipedium kovachii',
  },
  { id: 'dendrobium-nobile', label: 'Dendrobium nobile' },
  {
    id: 'oncidium-sphacelatum',
    label: 'Oncidium sphacelatum',
    secondary: 'Lluvia de oro',
  },
  { id: 'vanda-coerulea', label: 'Vanda coerulea', secondary: 'Vanda azul' },
  {
    id: 'sobralia-dichotoma',
    label: 'Sobralia dichotoma',
    secondary: 'Flor del paraíso',
  },
]

export const PLACES: readonly AutocompleteOption[] = [
  {
    id: 'vivero-moyobamba',
    label: 'Vivero Moyobamba',
    secondary: 'San Martín',
  },
  {
    id: 'orquideas-alto-mayo',
    label: 'Orquídeas del Alto Mayo',
    secondary: 'Rioja, San Martín',
  },
  {
    id: 'mercado-acho',
    label: 'Mercado de flores de Acho',
    secondary: 'Lima',
  },
  {
    id: 'feria-miraflores',
    label: 'Feria de orquídeas de Miraflores',
    secondary: 'Lima',
  },
  {
    id: 'vivero-cieneguilla',
    label: 'Vivero Los Jardines de Cieneguilla',
    secondary: 'Lima',
  },
  { id: 'regalo', label: 'Regalo de un familiar' },
]

export const GENERA = [
  'Phalaenopsis',
  'Cattleya',
  'Masdevallia',
  'Dendrobium',
  'Oncidium',
  'Vanda',
] as const

/** Los géneros de GENERA como sugerencias del buscador de géneros. */
export const GENUS_OPTIONS: readonly AutocompleteOption[] = GENERA.map(
  (name) => ({ id: name.toLowerCase(), label: name }),
)

export const PLANT_STATES = ['Activa', 'Perdida', 'Regalada'] as const

/** Muestras de los estilos de texto (las de tokens.json del design system). */
export const TEXT_SAMPLES: Readonly<Record<string, string>> = {
  'text-hero': 'Tu colección de orquídeas',
  'text-display': 'Mi colección',
  'text-xl': 'Registrar orquídea',
  'text-lead': 'Registra tus plantas con foto.',
  'text-lg': '¿Ya la tengo?',
  'text-md': 'Comprada en el vivero el 19 de noviembre.',
  'text-sm': 'Nombre por validar',
  'text-xs': 'Agregada hace 3 días',
}

/** Estilos que van con font-display; el resto, con font-body. */
export const DISPLAY_TEXT_STYLES: ReadonlySet<string> = new Set([
  'text-hero',
  'text-display',
  'text-xl',
])

// Sin tildes ni mayúsculas, para que "orquidea" encuentre "Orquídea".
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/** Sugerencias cuyo texto principal o secundario contiene lo escrito. */
export function filterOptions(
  options: readonly AutocompleteOption[],
  query: string,
): AutocompleteOption[] {
  const needle = normalize(query)
  if (needle === '') return []
  return options.filter(
    (option) =>
      normalize(option.label).includes(needle) ||
      (option.secondary !== undefined &&
        normalize(option.secondary).includes(needle)),
  )
}
