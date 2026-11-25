import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { DIALOG_TEXT } from '../account/texts.ts'
import type { Database } from '../lib/database.types.ts'
import PrivacyPage from './PrivacyPage.tsx'

// Los datos que guarda orqui.app de cada planta, de sus fotos y de su
// bitácora tienen que estar en la página de privacidad y en el diálogo de
// eliminar la cuenta (#291).
//
// Cada tabla enumera TODAS las columnas de su fila en los tipos generados de
// la base (database.types.ts): las que rellena el usuario, con el término con
// el que salen en los dos textos, y las técnicas, con el motivo. La
// exhaustividad la comprueba el compilador (npm run typecheck), no Vitest: el
// objeto «satisfies Record<columna, ...>» falla si falta una columna o si
// sobra una que ya no existe. Así, una columna nueva en una migración (con
// npm run db:types) rompe el typecheck hasta que alguien decide si es del
// usuario y, si lo es, la añade a los dos textos.

type Tables = Database['public']['Tables']
type Table = 'plants' | 'plant_photos' | 'plant_log_entries'

/** Columna que no es un dato que escriba el usuario, con el motivo. */
interface Technical {
  readonly technical: string
}

function technical(reason: string): Technical {
  return { technical: reason }
}

type Columns<T extends Table> = Record<
  keyof Tables[T]['Row'],
  string | Technical
>

interface TableTexts<T extends Table> {
  /** Comienzo del punto de la lista «Qué datos guardamos» de la privacidad. */
  readonly privacy: string
  /** Comienzo del punto de la lista del diálogo de eliminar la cuenta. */
  readonly dialog: string
  readonly columns: Columns<T>
}

const ID = technical('identificador interno')
const OWNER = technical('dueño de la fila')
const PLANT = technical('planta a la que pertenece')
const CREATED = technical('fecha de sistema')
const PATH = technical('ruta del archivo en el almacenamiento')

const PLANTS = {
  privacy: 'Tus plantas:',
  dialog: 'Tus plantas,',
  columns: {
    entered_name: 'nombre',
    species_id: 'nombre',
    genus_id: 'género',
    type: 'tipo',
    acquired_on: 'fecha de adquisición',
    origin: 'origen',
    location: 'ubicación',
    nickname: 'apodo',
    flower_color: 'color de la flor',
    status: 'estado',
    notes: 'notas',
    code: 'identificador',
    code_prefix: 'identificador',
    code_number: 'identificador',
    id: ID,
    user_id: OWNER,
    created_at: CREATED,
    updated_at: technical('fecha de sistema'),
    photo_path: PATH,
    thumbnail_path: PATH,
    photo_in_bloom: technical(
      'copia de plant_photos.in_bloom de la foto principal',
    ),
    validation: technical(
      'la calcula la base según si el nombre está en el catálogo',
    ),
    photo_count: technical('campo calculado: número de fotos'),
  },
} satisfies TableTexts<'plants'>

const PLANT_PHOTOS = {
  privacy: 'Las fotos de tus plantas:',
  dialog: 'Las fotos de tus plantas',
  columns: {
    position: 'orden',
    taken_at: 'fecha de la foto',
    note: 'nota',
    in_bloom: 'floración',
    id: ID,
    plant_id: PLANT,
    user_id: OWNER,
    created_at: CREATED,
    photo_path: PATH,
    thumbnail_path: PATH,
  },
} satisfies TableTexts<'plant_photos'>

const PLANT_LOG_ENTRIES = {
  privacy: 'La bitácora de tus plantas:',
  dialog: 'La bitácora de tus plantas',
  columns: {
    type: 'tipo de actividad',
    title: 'título',
    description: 'descripción',
    in_bloom: 'floración',
    id: ID,
    plant_id: PLANT,
    user_id: OWNER,
    created_at: CREATED,
    photo_path: PATH,
    thumbnail_path: PATH,
    idempotency_key: technical('evita duplicar el registro al reintentar'),
  },
} satisfies TableTexts<'plant_log_entries'>

const TABLES: [Table, TableTexts<Table>][] = [
  ['plants', PLANTS],
  ['plant_photos', PLANT_PHOTOS],
  ['plant_log_entries', PLANT_LOG_ENTRIES],
]

function terms(texts: TableTexts<Table>): string[] {
  return [
    ...new Set(
      Object.values(texts.columns).filter(
        (term): term is string => typeof term === 'string',
      ),
    ),
  ]
}

function normalized(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** El punto de la lista de la privacidad que empieza por ese rótulo. */
async function privacyItem(label: string): Promise<string> {
  const strong = await screen.findByText(
    label,
    { selector: 'li > strong' },
    { timeout: 10_000 },
  )
  return normalized(strong.closest('li')?.textContent)
}

function dialogItem(start: string): string {
  const found = DIALOG_TEXT.items.filter((item) => item.startsWith(start))
  expect(found, `Puntos del diálogo que empiezan por «${start}»`).toHaveLength(
    1,
  )
  return found[0] ?? ''
}

describe('datos del usuario en la privacidad y en el diálogo de eliminar la cuenta', () => {
  it.each(TABLES)(
    'la página de privacidad cita cada columna de %s',
    async (_table, texts) => {
      render(
        <MemoryRouter initialEntries={['/privacidad']}>
          <PrivacyPage />
        </MemoryRouter>,
      )
      const item = await privacyItem(texts.privacy)
      expect(terms(texts).filter((term) => !item.includes(term))).toEqual([])
    },
  )

  it.each(TABLES)(
    'el diálogo de eliminar la cuenta cita cada columna de %s',
    (_table, texts) => {
      const item = dialogItem(texts.dialog)
      expect(terms(texts).filter((term) => !item.includes(term))).toEqual([])
    },
  )
})
