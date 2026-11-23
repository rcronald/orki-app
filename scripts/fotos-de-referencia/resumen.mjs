// Escribe en Markdown el resumen de una ejecución del workflow «Fotos de referencia» para
// $GITHUB_STEP_SUMMARY, a partir del resumen JSON de `orki-catalogo cargar-fotos-inaturalist`
// (--resumen-json) y de su código de salida.
//
// Uso (en el workflow): node scripts/fotos-de-referencia/resumen.mjs >> "$GITHUB_STEP_SUMMARY"
//   Variables: AMBIENTE, MODO, ALCANCE, CODIGO (vacío si el paso no terminó) y RESUMEN_JSON.

import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Código de salida de la carga cuando se detiene antes de escribir y basta con repetirla
// (INCOMPLETE en scripts/catalog-import/src/catalog_import/reference_photos_cli.py).
export const CODIGO_REANUDAR = 3

const LICENCIAS = {
  cc0: 'CC0',
  pd: 'Dominio público',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
}

const FILAS = [
  ['created', 'nuevas'],
  ['replaced', 'sustituidas'],
  ['updated', 'actualizadas'],
  ['removed', 'quitadas'],
  ['unchanged', 'sin cambios'],
]

// Resultados de una especie que se queda sin foto nueva (o sin ninguna).
const SIN_FOTO = ['sin_foto', 'sin_taxon', 'ambigua', 'error', 'omitida']

// Miles separados por un espacio a partir de cinco cifras («9000», «19 730»), como en la
// documentación del proyecto; sin depender de los datos regionales del ejecutor.
const numero = {
  format(valor) {
    const texto = String(valor)
    return /^\d{5,}$/.test(texto)
      ? texto.replace(/\B(?=(\d{3})+$)/g, ' ')
      : texto
  },
}

function celda(valor) {
  return String(valor).replaceAll('|', '\\|').replace(/\s+/g, ' ')
}

function tabla(cabecera, filas) {
  if (filas.length === 0) {
    return ['Ninguna.']
  }
  return [
    `| ${cabecera.join(' | ')} |`,
    `| ${cabecera.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`,
    ...filas.map((f) => `| ${f.map(celda).join(' | ')} |`),
  ]
}

function pares(objeto, etiqueta = (k) => k) {
  return Object.entries(objeto ?? {}).map(([k, v]) => [
    etiqueta(k),
    numero.format(v),
  ])
}

/** El estado de la ejecución según el código de salida de la carga. */
export function estado(codigo) {
  if (codigo === '' || codigo === null || codigo === undefined) {
    return (
      '**La carga no terminó** (se agotó el tiempo del paso o se canceló) y no escribió ' +
      'ninguna fila. Lo leído de iNaturalist y las imágenes descargadas quedan en la caché ' +
      'de Actions: **basta con volver a lanzar el workflow con las mismas entradas** para ' +
      'seguir desde ahí.'
    )
  }
  const n = Number(codigo)
  if (n === 0) {
    return 'La carga terminó bien.'
  }
  if (n === CODIGO_REANUDAR) {
    return (
      '**La carga se detuvo antes de escribir ninguna fila** (iNaturalist, el bucket de ' +
      'imágenes o Storage siguieron fallando tras los reintentos, o se llegó al tope de ' +
      'peticiones del día). Lo leído y descargado queda en la caché de Actions y los archivos ' +
      'ya subidos se reutilizan: **basta con volver a lanzar el workflow con las mismas ' +
      'entradas** (si fue el tope diario, al día siguiente en UTC).'
    )
  }
  return (
    `**La carga falló** (código de salida ${n}). No se ha escrito ninguna fila: la ` +
    'transacción se revierte entera. El motivo está en la salida de abajo y en el registro ' +
    'del paso.'
  )
}

/**
 * El resumen en Markdown.
 *
 * @param {{ ambiente: string, modo: string, alcance: string, codigo: string | null,
 *   resumen: any }} datos
 */
export function resumenMarkdown({ ambiente, modo, alcance, codigo, resumen }) {
  const lineas = [`## Fotos de referencia: ${ambiente}, ${modo}`, '']
  lineas.push(`Alcance pedido: ${alcance}.`, '', estado(codigo), '')
  if (!resumen) {
    return lineas.join('\n') + '\n'
  }
  const ejecucion = resumen.ejecucion ?? {}
  const escritura = ejecucion.modo === 'escritura'
  const filas = ejecucion.filas ?? {}
  const textoFilas = FILAS.map(
    ([k, e]) => `${e} ${numero.format(filas[k] ?? 0)}`,
  ).join(', ')
  const resultado = resumen.resultado ?? {}

  lineas.push(
    ...tabla(
      ['Concepto', 'Valor'],
      [
        ['Especies en el alcance', numero.format(resumen.en_alcance ?? 0)],
        [
          'Con foto (elegida o conservada)',
          numero.format(resumen.con_foto ?? 0),
        ],
        [
          'Sin foto nueva (sin foto, sin taxón, ambigua, error u omitida)',
          numero.format(SIN_FOTO.reduce((s, k) => s + (resultado[k] ?? 0), 0)),
        ],
        [
          'Archivos subidos a Storage',
          escritura
            ? `${numero.format(ejecucion.archivos_subidos ?? 0)} (${numero.format(ejecucion.bytes_subidos ?? 0)} bytes)`
            : 'ninguno (simulación)',
        ],
        [
          escritura
            ? 'Filas de species_photos escritas'
            : 'Filas de species_photos simuladas',
          textoFilas,
        ],
        [
          'Peticiones a la API de iNaturalist',
          `${numero.format(ejecucion.peticiones_red ?? 0)} a la red, ${numero.format(ejecucion.respuestas_de_cache ?? 0)} de la caché`,
        ],
        [
          'Imágenes',
          `${numero.format(ejecucion.descargas_red ?? 0)} descargadas (${numero.format(ejecucion.bytes_descargados ?? 0)} bytes), ${numero.format(ejecucion.descargas_cache ?? 0)} de la caché`,
        ],
      ],
    ),
    '',
    '### Por licencia',
    '',
    ...tabla(
      ['Licencia', 'Especies'],
      pares(resumen.por_licencia, (k) => LICENCIAS[k] ?? k),
    ),
    '',
    '### Resultado por especie',
    '',
    ...tabla(['Resultado', 'Especies'], pares(resultado)),
    '',
    '### Fotos candidatas descartadas, por motivo',
    '',
    ...tabla(['Motivo', 'Fotos'], pares(resumen.descartadas_por_motivo)),
    '',
    `Especies con alguna foto retirada descartada: ${numero.format(resumen.omitidas_por_retiradas ?? 0)}.`,
  )
  if ((ejecucion.generos_no_encontrados ?? []).length > 0) {
    lineas.push(
      '',
      `Géneros que iNaturalist no tiene: ${ejecucion.generos_no_encontrados.map(celda).join(', ')}.`,
    )
  }
  if (ejecucion.auditoria && escritura) {
    lineas.push(
      '',
      `Identificador de la carga en la auditoría: \`${ejecucion.auditoria}\`.`,
    )
  }
  lineas.push(
    '',
    'El reporte CSV y el resumen JSON están en el artefacto de esta ejecución.',
  )
  return lineas.join('\n') + '\n'
}

function principal(entorno) {
  const ruta = entorno.RESUMEN_JSON ?? ''
  const resumen =
    ruta && existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : null
  process.stdout.write(
    resumenMarkdown({
      ambiente: entorno.AMBIENTE ?? '',
      modo: entorno.MODO ?? '',
      alcance: entorno.ALCANCE ?? '',
      codigo: entorno.CODIGO ?? '',
      resumen,
    }),
  )
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = principal(process.env)
}
