// Pruebas de la comprobación de enlaces relativos (#288), sobre documentos
// escritos en una carpeta temporal.
//
//   npm run test:scripts

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { anclaDe, anclasDe, comprobarEnlaces, enlacesDe } from './enlaces.mjs'

describe('anclaDe', () => {
  test('sigue la regla de GitHub: minúsculas, sin signos, tildes y guiones', () => {
    assert.equal(
      anclaDe('Base de datos y migraciones'),
      'base-de-datos-y-migraciones',
    )
    assert.equal(anclaDe('¿Ya la tengo?'), 'ya-la-tengo')
    assert.equal(anclaDe('Preparar el `.env` local'), 'preparar-el-env-local')
    assert.equal(
      anclaDe('Fotos: compresión en el navegador'),
      'fotos-compresión-en-el-navegador',
    )
    assert.equal(anclaDe('[Enlace](x.md) y **negrita**'), 'enlace-y-negrita')
  })

  test('las repeticiones llevan -1, -2…', () => {
    const anclas = anclasDe('# A\n\n## Uso\n\n## Uso\n\n## Uso\n')
    assert.deepEqual([...anclas], ['a', 'uso', 'uso-1', 'uso-2'])
  })

  test('un # dentro de un bloque de código no es un encabezado', () => {
    const anclas = anclasDe('# Título\n\n```sh\n# comentario\n```\n')
    assert.deepEqual([...anclas], ['título'])
  })
})

describe('enlacesDe', () => {
  test('encuentra enlaces, imágenes y definiciones, no el código', () => {
    const texto = [
      'Ver [la guía](docs/guia.md#uso) y ![logo](img/logo.svg "Logo").',
      'En código no cuenta: `[x](no.md)`.',
      '```md',
      '[tampoco](no.md)',
      '```',
      '[ref]: otra.md',
      'Con espacios: [a](<docs/con espacio.md>).',
    ].join('\n')
    assert.deepEqual(
      enlacesDe(texto).map((e) => `${e.linea}:${e.destino}`),
      [
        '1:docs/guia.md#uso',
        '1:img/logo.svg',
        '6:otra.md',
        '7:docs/con espacio.md',
      ],
    )
  })
})

describe('comprobarEnlaces', () => {
  let raiz
  const escribir = (ruta, texto) => {
    mkdirSync(dirname(join(raiz, ruta)), { recursive: true })
    writeFileSync(join(raiz, ruta), texto)
  }

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'enlaces-'))
    escribir('docs/app/fotos.md', '# Fotos\n\n## Campo de foto y subida\n')
    escribir('scripts/x.mjs', '')
  })
  afterEach(() => rmSync(raiz, { recursive: true, force: true }))

  test('acepta archivos, carpetas, secciones y anclas del mismo documento', () => {
    escribir(
      'README.md',
      [
        '# orqui.app',
        '## Índice',
        '[Fotos](docs/app/fotos.md#campo-de-foto-y-subida)',
        '[Script](scripts/x.mjs) [Carpeta](scripts/) [Arriba](#índice)',
        '[Fuera](https://example.com/no.md) [Correo](mailto:a@b.c)',
        '[Desde la raíz](/docs/app/fotos.md)',
      ].join('\n'),
    )
    escribir('docs/app/otro.md', '[Subir](../../README.md#orquiapp)\n')
    assert.deepEqual(
      comprobarEnlaces(raiz, ['README.md', 'docs/app/otro.md']),
      [],
    )
  })

  test('falla con un archivo que no existe y con una sección que no existe', () => {
    escribir(
      'README.md',
      [
        '# orqui.app',
        '[Movido](docs/fotos.md)',
        '[Sección vieja](docs/app/fotos.md#fotos-compresión-en-el-navegador)',
        '[Ancla propia](#no-existe)',
      ].join('\n'),
    )
    assert.deepEqual(comprobarEnlaces(raiz, ['README.md']), [
      {
        archivo: 'README.md',
        linea: 2,
        destino: 'docs/fotos.md',
        motivo: 'no existe el archivo',
      },
      {
        archivo: 'README.md',
        linea: 3,
        destino: 'docs/app/fotos.md#fotos-compresión-en-el-navegador',
        motivo: 'no existe la sección',
      },
      {
        archivo: 'README.md',
        linea: 4,
        destino: '#no-existe',
        motivo: 'no existe la sección',
      },
    ])
  })

  test('las anclas codificadas en la URL se comparan decodificadas', () => {
    escribir('README.md', '[a](docs/app/fotos.md#campo-de-foto-y-subida)\n')
    escribir('B.md', '# Compresión\n[b](#compresi%C3%B3n)\n')
    assert.deepEqual(comprobarEnlaces(raiz, ['README.md', 'B.md']), [])
  })
})
