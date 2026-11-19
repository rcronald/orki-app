import {
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Droplets,
  Flower2,
  Image,
  MapPin,
  Nfc,
  Pencil,
  Plus,
  Search,
  Sprout,
  Store,
  Tag,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'

// Subconjunto de Lucide del design system (assets/Icons). Solo estos nombres
// existen en la app; para uno nuevo, primero se añade al sistema.
const ICONS = {
  calendar: Calendar,
  camera: Camera,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'circle-check': CircleCheck,
  droplets: Droplets,
  'flower-2': Flower2,
  image: Image,
  'map-pin': MapPin,
  nfc: Nfc,
  pencil: Pencil,
  plus: Plus,
  search: Search,
  sprout: Sprout,
  store: Store,
  tag: Tag,
  'trash-2': Trash2,
  'triangle-alert': TriangleAlert,
  x: X,
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

type IconProps = Omit<
  LucideProps,
  'ref' | 'size' | 'width' | 'height' | 'color' | 'strokeWidth'
> & {
  name: IconName
}

// Icono en línea con stroke="currentColor": toma el color del texto. Siempre
// acompaña a una palabra, así que es decorativo para el lector de pantalla. El
// tamaño lo fija bundle.css según dónde va (14, 16, 20 o 24 px).
export function Icon({ name, ...props }: IconProps) {
  const LucideComponent = ICONS[name]
  return <LucideComponent {...props} aria-hidden="true" />
}
