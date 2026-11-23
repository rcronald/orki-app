import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { estado, resumenMarkdown } from './resumen.mjs'

// Resumen JSON con la forma del que escribe `cargar-fotos-inaturalist --resumen-json`
// (tally() y «ejecucion» en reference_photos_cli.py).
const RESUMEN = {
  en_alcance: 12345,
  emparejamiento: { nombre_aceptado: 10000, sin_taxon: 2345 },
  con_foto: 3200,
  por_licencia: { 'cc-by': 2500, 'cc-by-sa': 600, cc0: 90, pd: 10 },
  por_seleccion: { taxon_default: 1000, taxon_photo: 2200 },
  resultado: {
    nueva: 3100,
    sin_cambios: 100,
    sin_foto: 6000,
    sin_taxon: 3000,
    ambigua: 145,
  },
  descartadas_por_motivo: { licencia_no_aceptada: 7000, con_marcas: 3 },
  omitidas_por_retiradas: 2,
  imagenes_preparadas: 3100,
  bytes_preparados: 200000000,
  ejecucion: {
    ambiente: 'dev',
    modo: 'escritura',
    alcance: 'todo el catálogo',
    generos_no_encontrados: ['Nohay'],
    peticiones_red: 700,
    respuestas_de_cache: 30,
    descargas_red: 3100,
    descargas_cache: 0,
    bytes_descargados: 310000000,
    archivos_subidos: 6200,
    bytes_subidos: 200000000,
    filas: { created: 3100, unchanged: 100 },
    auditoria: 'github-actions:1:1',
  },
}

const BASE = { ambiente: 'dev', modo: 'escribir', alcance: 'todo el catálogo' }

describe('resumenMarkdown', () => {
  test('da los recuentos que pide el issue', () => {
    const md = resumenMarkdown({ ...BASE, codigo: '0', resumen: RESUMEN })
    assert.match(md, /^## Fotos de referencia: dev, escribir$/m)
    assert.match(md, /La carga terminó bien\./)
    assert.match(md, /\| Especies en el alcance \| 12 345 \|/)
    assert.match(md, /\| Con foto \(elegida o conservada\) \| 3200 \|/)
    assert.match(md, /\| Sin foto nueva [^|]* \| 9145 \|/)
    assert.match(
      md,
      /\| Archivos subidos a Storage \| 6200 \(200 000 000 bytes\) \|/,
    )
    assert.match(
      md,
      /\| Filas de species_photos escritas \| nuevas 3100, sustituidas 0, actualizadas 0, quitadas 0, sin cambios 100 \|/,
    )
    assert.match(md, /\| CC BY-SA \| 600 \|/)
    assert.match(md, /\| Dominio público \| 10 \|/)
    assert.match(md, /\| licencia_no_aceptada \| 7000 \|/)
    assert.match(md, /\| sin_taxon \| 3000 \|/)
    assert.match(md, /Géneros que iNaturalist no tiene: Nohay\./)
    assert.match(md, /`github-actions:1:1`/)
  })

  test('en una simulación no hay subidas y las filas son simuladas', () => {
    const resumen = {
      ...RESUMEN,
      ejecucion: { ...RESUMEN.ejecucion, modo: 'simulacion' },
    }
    const md = resumenMarkdown({
      ...BASE,
      modo: 'simular',
      codigo: '0',
      resumen,
    })
    assert.match(
      md,
      /\| Archivos subidos a Storage \| ninguno \(simulación\) \|/,
    )
    assert.match(md, /\| Filas de species_photos simuladas \|/)
    assert.doesNotMatch(md, /auditoría/)
  })

  test('sin resumen JSON solo da el estado', () => {
    const md = resumenMarkdown({ ...BASE, codigo: '3', resumen: null })
    assert.match(md, /basta con volver a lanzar el workflow/)
    assert.doesNotMatch(md, /\| Concepto/)
  })

  test('los errores de subida van arriba, antes de los recuentos', () => {
    const resumen = {
      ...RESUMEN,
      ejecucion: {
        ...RESUMEN.ejecucion,
        subidas_fallidas: 3,
        errores_de_subida: [
          {
            especie: 'Phalaenopsis amabilis',
            detalle:
              'Storage respondió 413 a POST object/species-photos/a/medium-1.webp: demasiado grande',
          },
        ],
      },
    }
    const md = resumenMarkdown({ ...BASE, codigo: '5', resumen })
    assert.match(md, /terminó con errores de subida/)
    assert.match(md, /^### Errores de subida: 3$/m)
    assert.match(md, /\| Phalaenopsis amabilis \| Storage respondió 413 /)
    assert.match(md, /Y 2 más: el resto, en el reporte CSV\./)
    assert.match(md, /6200 \(200 000 000 bytes\); \*\*3 subidas fallidas\*\*/)
    assert.ok(md.indexOf('Errores de subida') < md.indexOf('| Concepto'))
  })

  test('sin errores de subida no hay sección de errores', () => {
    const md = resumenMarkdown({ ...BASE, codigo: '0', resumen: RESUMEN })
    assert.doesNotMatch(md, /Errores de subida/)
    assert.doesNotMatch(md, /subidas fallidas/)
  })

  test('escapa las barras de las celdas', () => {
    const resumen = { ...RESUMEN, resultado: { 'a|b': 1 } }
    assert.match(
      resumenMarkdown({ ...BASE, codigo: '0', resumen }),
      /\| a\\\|b \| 1 \|/,
    )
  })
})

describe('estado', () => {
  test('el código de reanudar dice que basta con volver a lanzarlo', () => {
    assert.match(estado('3'), /se detuvo antes de escribir ninguna fila/)
    assert.match(estado('3'), /basta con volver a lanzar el workflow/)
  })

  test('sin código (tiempo agotado o cancelado) también se reanuda', () => {
    assert.match(estado(''), /no terminó/)
    assert.match(estado(''), /basta con volver a lanzar el workflow/)
  })

  test('el código 4 dice que Storage rechazó la clave y cómo arreglarla', () => {
    assert.match(estado('4'), /Storage rechazó la clave secreta/)
    assert.match(estado('4'), /SUPABASE_SECRET_KEY/)
    assert.match(estado('4'), /botón de copiar/)
    assert.match(estado('4'), /No se ha escrito ninguna fila/)
  })

  test('el código 5 dice que hubo errores de subida', () => {
    assert.match(estado('5'), /errores de subida/)
    assert.doesNotMatch(estado('5'), /terminó bien/)
  })

  test('otro código es un fallo', () => {
    assert.match(estado('1'), /La carga falló\*\* \(código de salida 1\)/)
  })
})
