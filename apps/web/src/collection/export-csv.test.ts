import { describe, expect, it } from 'vitest'
import { CATTLEYA, plant, RHYNCHOLAELIOCATTLEYA } from '../test/collection.ts'
import {
  BOM,
  csvCell,
  CSV_COLUMNS,
  exportFileName,
  exportOrder,
  inventoryCsv,
  neutralizeFormula,
} from './export-csv.ts'

const HEADER =
  'Nombre científico,Nombre ingresado,Género,Tipo,Estado,Validación,Fecha de adquisición,Origen,Ubicación,Apodo,Color de flor,Foto en floración,Fecha de registro,Número de fotos,Identificador,Notas'

// Filas del archivo sin la marca de orden de bytes ni la línea final vacía.
function rows(csv: string): string[] {
  expect(csv.startsWith(BOM)).toBe(true)
  expect(csv.endsWith('\r\n')).toBe(true)
  return csv.slice(BOM.length, -2).split('\r\n')
}

const amabilis = plant({
  displayName: 'Phalaenopsis amabilis',
  enteredName: 'phalaenopsis amabilis',
  acquiredOn: '2026-11-01',
  // Mediodía en UTC: el mismo día en cualquier zona de -11 a +11.
  createdAt: '2026-11-01T12:00:00+00:00',
  origin: 'Vivero Los Andes',
  location: 'Ventana de la sala',
  nickname: 'La blanca',
  flowerColor: 'white',
  photoPath: 'u/1.webp',
  photoInBloom: true,
})

describe('inventoryCsv', () => {
  it('empieza por la marca de orden de bytes, usa coma y CRLF, y lleva la cabecera en español', () => {
    const csv = inventoryCsv([amabilis])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(rows(csv)).toEqual([
      HEADER,
      'Phalaenopsis amabilis,phalaenopsis amabilis,Phalaenopsis,Especie,Activa,Validada,2026-11-01,Vivero Los Andes,Ventana de la sala,La blanca,Blanco,Sí,2026-11-01,1,PHA-001,',
    ])
    expect(CSV_COLUMNS).toHaveLength(16)
  })

  it('al codificarse en UTF-8 la marca son los bytes EF BB BF y las tildes, la ñ y el "×" se conservan', async () => {
    const csv = inventoryCsv([
      plant({
        displayName: '× Rhyncholaeliocattleya Memoria Anna Balmores',
        species: null,
        enteredName: 'la señora del Ñaño',
        genus: RHYNCHOLAELIOCATTLEYA,
      }),
    ])
    const bytes = new Uint8Array(
      await new Blob([csv], { type: 'text/csv;charset=utf-8' }).arrayBuffer(),
    )
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const decoded = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(decoded).toBe(csv)
    expect(rows(csv)[1]).toContain(
      ',la señora del Ñaño,× Rhyncholaeliocattleya,',
    )
  })

  it('una planta por validar deja vacío el nombre científico y los campos opcionales', () => {
    const pending = plant({
      displayName: 'la naranja del mercado',
      displayNameIsScientific: false,
      enteredName: 'la naranja del mercado',
      species: null,
      validation: 'pending',
      type: 'unknown',
      acquiredOn: '2026-10-05',
      createdAt: '2026-10-05T12:00:00+00:00',
    })
    expect(rows(inventoryCsv([pending]))[1]).toBe(
      ',la naranja del mercado,Phalaenopsis,No sé,Activa,Por validar,2026-10-05,,,,,,2026-10-05,0,PHA-001,',
    )
  })

  it('incluye las dadas de baja y las no identificables, con su estado en español', () => {
    const csv = inventoryCsv([
      plant({ status: 'lost' }),
      plant({ status: 'gifted', validation: 'unidentifiable', type: 'hybrid' }),
    ])
    const [, lost, gifted] = rows(csv)
    expect(lost?.split(',').slice(3, 6)).toEqual([
      'Especie',
      'Perdida',
      'Validada',
    ])
    expect(gifted?.split(',').slice(3, 6)).toEqual([
      'Híbrido',
      'Regalada',
      'No identificable',
    ])
  })

  it('foto en floración: "Sí", "No" o vacío si no hay foto', () => {
    const csv = inventoryCsv([
      plant({ photoPath: 'u/a.webp', photoInBloom: true, displayName: 'A' }),
      plant({ photoPath: 'u/b.webp', photoInBloom: false, displayName: 'B' }),
      plant({ photoPath: null, photoInBloom: false, displayName: 'C' }),
    ])
    expect(
      rows(csv)
        .slice(1)
        .map((row) => row.split(',')[11]),
    ).toEqual(['Sí', 'No', ''])
  })

  it('número de fotos: de 0 a 6, en la última columna, sin mover las demás', () => {
    const csv = inventoryCsv([
      plant({ photoPath: 'u/a.webp', photoCount: 6, displayName: 'A' }),
      plant({ photoPath: 'u/b.webp', photoCount: 1, displayName: 'B' }),
      plant({ photoPath: null, photoCount: 0, displayName: 'C' }),
    ])
    const [header, ...lines] = rows(csv)
    expect(header?.split(',')[13]).toBe('Número de fotos')
    expect(header?.split(',')[12]).toBe('Fecha de registro')
    expect(lines.map((row) => row.split(',')[13])).toEqual(['6', '1', '0'])
    expect(csv).not.toContain('u/a.webp')
  })

  it('identificador y notas (#265): al final, sin mover las columnas de antes', () => {
    const csv = inventoryCsv([
      plant({
        displayName: 'A',
        code: 'CAT-012',
        notes: 'Llegó sin flor.\nRiego cada 5 días, con agua "de lluvia".',
      }),
      // Copia del dispositivo anterior al #265: sin identificador ni notas.
      plant({ displayName: 'B', code: null, notes: null }),
      // Notas que una hoja tomaría por fórmula.
      plant({ displayName: 'C', code: 'PHA-001', notes: '=1+1' }),
    ])
    const [header, ...lines] = parseCsv(csv.slice(BOM.length))
    expect(header?.slice(0, 14)).toEqual(HEADER.split(',').slice(0, 14))
    expect(header?.slice(-2)).toEqual(['Identificador', 'Notas'])
    expect(lines.map((line) => line.slice(-2))).toEqual([
      ['CAT-012', 'Llegó sin flor.\nRiego cada 5 días, con agua "de lluvia".'],
      ['', ''],
      ['PHA-001', "'=1+1"],
    ])
    expect(lines.every((line) => line.length === 16)).toBe(true)
  })

  it('ordena por género y por nombre, sin tener en cuenta el "×" ni las tildes', () => {
    const plants = [
      plant({ displayName: 'Phalaenopsis schilleriana' }),
      plant({
        displayName: '× Rhyncholaeliocattleya Memoria Anna Balmores',
        genus: RHYNCHOLAELIOCATTLEYA,
      }),
      plant({ displayName: 'Cattleya rex', genus: CATTLEYA }),
      plant({ displayName: 'Phalaenopsis amabilis' }),
      plant({ displayName: 'Cattleya máxima', genus: CATTLEYA }),
    ]
    expect(exportOrder(plants).map((p) => p.displayName)).toEqual([
      'Cattleya máxima',
      'Cattleya rex',
      'Phalaenopsis amabilis',
      'Phalaenopsis schilleriana',
      '× Rhyncholaeliocattleya Memoria Anna Balmores',
    ])
  })

  it('una colección vacía da solo la cabecera', () => {
    expect(rows(inventoryCsv([]))).toEqual([HEADER])
  })

  it('las comas, comillas y saltos de línea no rompen las columnas', () => {
    const csv = inventoryCsv([
      plant({
        nickname: 'La "reina", de casa',
        location: 'Sala\nventana norte',
        origin: 'Vivero, Lima',
      }),
    ])
    const row = csv.slice(BOM.length).split('\r\n')[1]
    expect(row).toContain('"Vivero, Lima"')
    expect(row).toContain('"Sala\nventana norte"')
    expect(row).toContain('"La ""reina"", de casa"')
    expect(parseCsv(csv.slice(BOM.length))[1]).toHaveLength(16)
    expect(parseCsv(csv.slice(BOM.length))[1]?.[9]).toBe('La "reina", de casa')
  })

  it('un apodo que empieza por "=" se exporta como texto', () => {
    const csv = inventoryCsv([
      plant({ nickname: '=HYPERLINK("http://x","y")' }),
    ])
    expect(parseCsv(csv.slice(BOM.length))[1]?.[9]).toBe(
      `'=HYPERLINK("http://x","y")`,
    )
  })

  it('con 1 000 plantas se genera enseguida', () => {
    const many = Array.from({ length: 1000 }, (_, index) =>
      plant({
        displayName: `Phalaenopsis ejemplar ${index}`,
        nickname: `N${index}`,
      }),
    )
    const start = performance.now()
    const csv = inventoryCsv(many)
    expect(performance.now() - start).toBeLessThan(200)
    expect(rows(csv)).toHaveLength(1001)
  })
})

describe('neutralizeFormula y csvCell', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+51 999', "'+51 999"],
    ['-la pequeña', "'-la pequeña"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tTAB', "'\tTAB"],
    ['\rCR', "'\rCR"],
    ['  =oculta', "'  =oculta"],
  ])('neutraliza %j', (value, expected) => {
    expect(neutralizeFormula(value)).toBe(expected)
  })

  it.each([
    'Phalaenopsis',
    '2026-11-01',
    'Vivero 2-B',
    'a=b',
    'correo@x.pe',
    '',
  ])('deja intacto %j', (value) => {
    expect(neutralizeFormula(value)).toBe(value)
  })

  it('escapa solo lo que hace falta', () => {
    expect(csvCell('simple')).toBe('simple')
    expect(csvCell('')).toBe('')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('di "hola"')).toBe('"di ""hola"""')
    expect(csvCell('dos\r\nlíneas')).toBe('"dos\r\nlíneas"')
    expect(csvCell(' con espacio ')).toBe('" con espacio "')
    // Neutralizada y con comas: apóstrofo dentro de las comillas.
    expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`)
  })
})

describe('exportFileName', () => {
  it('lleva la fecha local del dispositivo', () => {
    expect(exportFileName(new Date(2026, 10, 21, 23, 30))).toBe(
      'orqui-app-inventario-2026-11-21.csv',
    )
    expect(exportFileName(new Date(2026, 0, 5))).toBe(
      'orqui-app-inventario-2026-01-05.csv',
    )
  })
})

// Lector de CSV mínimo (RFC 4180) para comprobar que las columnas no se rompen.
function parseCsv(text: string): string[][] {
  const result: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\r' && text[index + 1] === '\n') {
      row.push(cell)
      result.push(row)
      row = []
      cell = ''
      index += 1
    } else cell += char
  }
  return result
}
