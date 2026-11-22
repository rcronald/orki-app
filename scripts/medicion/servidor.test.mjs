import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { brotliDecompressSync } from 'node:zlib'
import { archivoDeUrl, servirCarpeta } from './servidor.mjs'

describe('archivoDeUrl', () => {
  const carpeta = path.resolve('/build')

  test('la raíz es index.html', () => {
    assert.equal(archivoDeUrl(carpeta, '/'), path.join(carpeta, 'index.html'))
  })

  test('ignora la búsqueda y decodifica la ruta', () => {
    assert.equal(
      archivoDeUrl(carpeta, '/assets/a%20b.js?v=1'),
      path.join(carpeta, 'assets/a b.js'),
    )
  })

  test('no deja salir de la carpeta', () => {
    for (const url of ['/%2e%2e/secreto', '/a%2F..%2F..%2Fsecreto']) {
      assert.equal(archivoDeUrl(carpeta, url), path.join(carpeta, 'secreto'))
    }
  })
})

describe('servirCarpeta', () => {
  let carpeta
  let servidor

  before(async () => {
    carpeta = mkdtempSync(path.join(tmpdir(), 'orki-servidor-'))
    mkdirSync(path.join(carpeta, 'assets'))
    writeFileSync(
      path.join(carpeta, 'index.html'),
      '<!doctype html><p>Orki</p>',
    )
    writeFileSync(
      path.join(carpeta, 'assets/app.js'),
      'console.log(1)'.repeat(20),
    )
    servidor = await servirCarpeta(carpeta)
  })

  after(async () => {
    await servidor.cerrar()
    rmSync(carpeta, { recursive: true, force: true })
  })

  test('sirve los archivos comprimidos con Brotli si el navegador lo acepta', async () => {
    // node:http y no fetch, que descomprime solo: se quiere ver lo que viaja.
    const { estado, cabeceras, cuerpo } = await new Promise(
      (resolver, rechazar) => {
        get(
          `${servidor.url}/assets/app.js`,
          { headers: { 'Accept-Encoding': 'gzip, br' } },
          (respuesta) => {
            const partes = []
            respuesta.on('data', (parte) => partes.push(parte))
            respuesta.on('end', () =>
              resolver({
                estado: respuesta.statusCode,
                cabeceras: respuesta.headers,
                cuerpo: Buffer.concat(partes),
              }),
            )
          },
        ).on('error', rechazar)
      },
    )
    assert.equal(estado, 200)
    assert.equal(cabeceras['content-type'], 'text/javascript; charset=utf-8')
    assert.equal(cabeceras['content-encoding'], 'br')
    assert.equal(
      brotliDecompressSync(cuerpo).toString('utf8'),
      'console.log(1)'.repeat(20),
    )
  })

  test('responde cualquier otra ruta con index.html, como Vercel', async () => {
    const respuesta = await fetch(`${servidor.url}/coleccion?q=phal`)
    assert.equal(respuesta.status, 200)
    assert.match(await respuesta.text(), /Orki/)
  })
})
