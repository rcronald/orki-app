// Enlaces relativos rotos en la documentación (#288): busca en los .md los
// enlaces a archivos del repositorio y a sus secciones (#ancla) que no
// existen. Los enlaces a otros sitios (https:, mailto:…) no se comprueban.
//
// Las anclas se calculan como GitHub: el texto del encabezado en minúsculas,
// sin signos de puntuación (las tildes y la ñ se quedan) y con guiones en
// lugar de espacios; si se repite, «-1», «-2»…
//
// Lo usa index.mjs (npm run enlaces); las pruebas están en enlaces.test.mjs.

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** Quita los bloques de código cercados (``` y ~~~), que no tienen enlaces. */
export function sinBloquesDeCodigo(texto) {
  const lineas = texto.split('\n')
  let cerca = null
  return lineas
    .map((linea) => {
      const marca = linea.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (cerca) {
        if (
          marca &&
          marca[1][0] === cerca[0] &&
          marca[1].length >= cerca.length
        ) {
          cerca = null
        }
        return ''
      }
      if (marca) {
        cerca = marca[1]
        return ''
      }
      return linea
    })
    .join('\n')
}

/** Quita el código en línea (`…`), donde un «[x](y)» no es un enlace. */
function sinCodigoEnLinea(linea) {
  return linea.replace(/(`+)[\s\S]*?\1/g, (codigo) => ' '.repeat(codigo.length))
}

/** El ancla que GitHub da a un encabezado (sin contar las repeticiones). */
export function anclaDe(encabezado) {
  const texto = encabezado
    // Enlaces e imágenes: queda su texto.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Etiquetas HTML.
    .replace(/<[^>]+>/g, '')
    // Marcas de énfasis y de código.
    .replace(/[*`]/g, '')
  return texto
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

/** Todas las anclas de un documento: sus encabezados y los id de HTML. */
export function anclasDe(texto) {
  const anclas = new Set()
  const vistas = new Map()
  for (const linea of sinBloquesDeCodigo(texto).split('\n')) {
    const encabezado = linea.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/)
    if (encabezado) {
      const base = anclaDe(encabezado[1])
      const veces = vistas.get(base) ?? 0
      vistas.set(base, veces + 1)
      anclas.add(veces === 0 ? base : `${base}-${veces}`)
    }
    for (const html of linea.matchAll(/<a\s[^>]*\b(?:id|name)="([^"]+)"/g)) {
      anclas.add(html[1])
    }
  }
  return anclas
}

/** Los destinos de los enlaces de un documento, con su número de línea. */
export function enlacesDe(texto) {
  const enlaces = []
  sinBloquesDeCodigo(texto)
    .split('\n')
    .forEach((original, indice) => {
      const linea = sinCodigoEnLinea(original)
      const encontrados = [
        ...linea.matchAll(/\]\(\s*<([^>]*)>[^)]*\)/g),
        ...linea.matchAll(/\]\(\s*([^)<\s]+)(?:\s+["'(][^)]*)?\)/g),
        ...linea.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/g),
      ]
      for (const enlace of encontrados) {
        enlaces.push({ destino: enlace[1], linea: indice + 1 })
      }
    })
  return enlaces
}

/** Si el destino es de otro sitio (con esquema, o //servidor/…). */
export function esExterno(destino) {
  return /^[a-z][a-z0-9+.-]*:/i.test(destino) || destino.startsWith('//')
}

function decodificar(texto) {
  try {
    return decodeURIComponent(texto)
  } catch {
    return texto
  }
}

/**
 * Comprueba los enlaces relativos de unos documentos. `archivos` son rutas
 * relativas a `raiz`. Devuelve los rotos: { archivo, linea, destino, motivo }.
 */
export function comprobarEnlaces(raiz, archivos) {
  const cacheAnclas = new Map()
  const anclasDelArchivo = (absoluta) => {
    if (!cacheAnclas.has(absoluta)) {
      cacheAnclas.set(absoluta, anclasDe(readFileSync(absoluta, 'utf8')))
    }
    return cacheAnclas.get(absoluta)
  }

  const rotos = []
  for (const archivo of archivos) {
    const absoluto = path.join(raiz, archivo)
    const texto = readFileSync(absoluto, 'utf8')
    for (const { destino, linea } of enlacesDe(texto)) {
      if (esExterno(destino)) continue
      const almohadilla = destino.indexOf('#')
      const ruta = decodificar(
        almohadilla === -1 ? destino : destino.slice(0, almohadilla),
      ).replace(/\?.*$/, '')
      const ancla =
        almohadilla === -1 ? null : decodificar(destino.slice(almohadilla + 1))

      let objetivo = absoluto
      if (ruta !== '') {
        objetivo = ruta.startsWith('/')
          ? path.join(raiz, ruta)
          : path.resolve(path.dirname(absoluto), ruta)
        if (!existsSync(objetivo)) {
          rotos.push({
            archivo,
            linea,
            destino,
            motivo: 'no existe el archivo',
          })
          continue
        }
      }
      if (
        ancla &&
        statSync(objetivo).isFile() &&
        objetivo.endsWith('.md') &&
        !anclasDelArchivo(objetivo).has(ancla.toLowerCase())
      ) {
        rotos.push({ archivo, linea, destino, motivo: 'no existe la sección' })
      }
    }
  }
  return rotos
}
