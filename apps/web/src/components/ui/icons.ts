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
} from 'lucide-react'

// Subconjunto de Lucide del design system (assets/Icons). Solo estos nombres
// existen en la app; para uno nuevo, primero se añade al sistema. Vive aparte
// de Icon.tsx para poder exportar la lista sin romper el refresco en caliente.
export const ICONS = {
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

/** Nombres de todos los iconos del sistema, en el orden del mapa. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[]
