// Comprueba la regla «expandir y contraer» en un pull request (#281): un PR que toca
// supabase/migrations/ no toca el código de la app (apps/web/src), salvo los tipos del
// esquema. La base va en un PR anterior al código que la usa, para que la migración llegue
// a producción antes que la web que la necesita (ver «Expandir y contraer» en
// supabase/README.md).
//
// Se salta de forma explícita y visible con la etiqueta «migración con código» en el PR: el
// job pasa, pero deja un aviso en la ejecución y en el resumen con los archivos que mezcla.
//
// Uso (en el workflow): node scripts/migraciones-y-codigo/index.mjs
//   Variables: ARCHIVOS (ruta de un archivo con los archivos cambiados, uno por línea, como
//   los da `git diff --name-only --no-renames`), ETIQUETAS (JSON con los nombres de las
//   etiquetas del PR) y GITHUB_STEP_SUMMARY.

import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ETIQUETA_EXCEPCION = 'migración con código'
export const MIGRACIONES = 'supabase/migrations/'
export const CODIGO = 'apps/web/src/'
// Los tipos generados del esquema van en el mismo commit que la migración, y sus alias y su
// prueba de tipos con ellos (README, «Tipos de TypeScript del esquema»).
export const PERMITIDOS = [
  'apps/web/src/lib/database.types.ts',
  'apps/web/src/lib/database.ts',
  'apps/web/src/lib/database.test.ts',
]

/** @param {string} texto */
export function leerArchivos(texto) {
  return [
    ...new Set(
      texto
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ]
}

/** @param {string | undefined} json */
export function leerEtiquetas(json) {
  if (!json?.trim()) return []
  try {
    const valor = JSON.parse(json)
    return Array.isArray(valor)
      ? valor.filter((v) => typeof v === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * @param {string[]} archivos
 * @param {string[]} etiquetas
 * @returns {{ resultado: 'sin-migraciones' | 'bien' | 'mezcla' | 'excepcion', migraciones: string[], codigo: string[] }}
 */
export function comprobar(archivos, etiquetas) {
  const migraciones = archivos.filter((a) => a.startsWith(MIGRACIONES))
  const codigo = archivos.filter(
    (a) => a.startsWith(CODIGO) && !PERMITIDOS.includes(a),
  )
  if (migraciones.length === 0)
    return { resultado: 'sin-migraciones', migraciones, codigo }
  if (codigo.length === 0) return { resultado: 'bien', migraciones, codigo }
  const excepcion = etiquetas.some(
    (e) => e.normalize('NFC').trim() === ETIQUETA_EXCEPCION,
  )
  return { resultado: excepcion ? 'excepcion' : 'mezcla', migraciones, codigo }
}

const lista = (archivos, max = 20) => [
  ...archivos.slice(0, max).map((a) => `- \`${a}\``),
  ...(archivos.length > max ? [`- y ${archivos.length - max} más`] : []),
]

export function informe(r) {
  const titulo = '## Migraciones y código de la app en el mismo PR'
  switch (r.resultado) {
    case 'sin-migraciones':
      return {
        codigo: 0,
        registro: ['Este PR no toca supabase/migrations/: nada que comprobar.'],
        resumen: `${titulo}\n\nEste PR no toca \`supabase/migrations/\`: nada que comprobar.\n`,
      }
    case 'bien':
      return {
        codigo: 0,
        registro: [
          'El PR toca migraciones y no toca el código de la app (salvo los tipos del esquema).',
        ],
        resumen: `${titulo}\n\nBien: el PR toca migraciones y no toca el código de la app (salvo los tipos del esquema).\n`,
      }
    case 'excepcion': {
      const aviso = `Excepción con la etiqueta «${ETIQUETA_EXCEPCION}»: este PR mezcla migraciones con código de la app (${r.codigo.length} archivo${r.codigo.length === 1 ? '' : 's'}). Al fusionarlo, la web nueva se publica después de la migración, pero la versión anterior de la app (pestañas y PWA abiertas) seguirá hablando con el esquema nuevo: la migración tiene que ser compatible con ella.`
      return {
        codigo: 0,
        registro: [`::warning::${aviso}`],
        resumen: [
          titulo,
          '',
          `**${aviso}**`,
          '',
          'Código de la app:',
          '',
          ...lista(r.codigo),
          '',
        ].join('\n'),
      }
    }
    default: {
      const error = `Este PR toca supabase/migrations/ y también el código de la app. Según la regla «expandir y contraer» (supabase/README.md), la migración va en un PR anterior al código que la usa. Si de verdad tienen que ir juntos, añade al PR la etiqueta «${ETIQUETA_EXCEPCION}» y explica por qué en la descripción.`
      return {
        codigo: 1,
        registro: [
          `::error::${error}`,
          `Migraciones: ${r.migraciones.join(', ')}`,
          `Código de la app: ${r.codigo.join(', ')}`,
        ],
        resumen: [
          titulo,
          '',
          `**Falla.** ${error}`,
          '',
          'Migraciones:',
          '',
          ...lista(r.migraciones),
          '',
          'Código de la app (fuera de los tipos del esquema):',
          '',
          ...lista(r.codigo),
          '',
        ].join('\n'),
      }
    }
  }
}

/** @param {Record<string, string | undefined>} entorno */
export function principal(entorno, registro = (l) => console.log(l)) {
  if (!entorno.ARCHIVOS) {
    registro('::error::Falta la variable ARCHIVOS.')
    return 1
  }
  const archivos = leerArchivos(readFileSync(entorno.ARCHIVOS, 'utf8'))
  const r = informe(comprobar(archivos, leerEtiquetas(entorno.ETIQUETAS)))
  for (const linea of r.registro) registro(linea)
  if (entorno.GITHUB_STEP_SUMMARY)
    appendFileSync(entorno.GITHUB_STEP_SUMMARY, `${r.resumen}\n`)
  return r.codigo
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = principal(process.env)
}
