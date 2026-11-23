import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Request, Route } from '@playwright/test'
import {
  catalogoInicial,
  type Catalogo,
  type Especie,
  type FotoDeReferencia,
  type Planta,
} from './datos.ts'

// Supabase simulado en la capa de red de Playwright (#148).
//
// La app de las pruebas es la de producción con su cliente de Supabase real
// (supabase-js): sus peticiones salen hacia https://supabase.orki.invalid y
// este módulo las responde desde la memoria del proceso de la prueba, con la
// forma de PostgREST y de Storage. Así se ejercita todo el código de la app que
// arma las consultas, interpreta las respuestas y traduce los errores; lo único
// simulado es el servidor.
//
// Solo implementa lo que usa la app, con las reglas que importan para los
// flujos: las políticas RLS (cada persona ve y escribe sus plantas; el
// backoffice, solo catalog_admin) y los disparadores de plants (con especie, el
// género, el tipo y la validación son los suyos; sin ella, "pending"). La
// identidad sale del token que pone el Clerk simulado
// (apps/web/medicion/clerk-simulado.tsx).
//
// Varias fotos por planta (#219): plant_photos con las reglas de la migración
// 20261122090000_varias_fotos_por_planta.sql que importan a la app: cada
// persona solo sus fotos, el dueño de la foto es el de la planta, rutas dentro
// de <usuario>/<planta>/, position de 0 a 5 y única por planta (23505), solo
// se cambian las columnas permitidas, la cascada al borrar la planta y la
// sincronización en los dos sentidos con photo_path, thumbnail_path y
// photo_in_bloom de plants (la principal es la de position más baja; lo que
// escribe la app de una foto en plants se refleja en la principal). Si una
// prueba pone la foto de una planta directamente en `datos.plantas`, antes de
// la siguiente petición se crea su fila en la posición 0, como la copia de la
// migración. La galería del detalle (#183) cambia la nota y la fecha (con sus
// restricciones) y reordena con reorder_plant_photos, la función propuesta en
// ese issue (aún sin migración).
//
// Catálogo público (#231, #232): las cuatro funciones que puede llamar anon
// (search_public_species, list_public_genera, list_public_genus_species y
// get_public_species) responden con o sin token, con sus topes y su
// paginación, y cada llamada queda en `llamadasPublicas` con si llevaba el
// token (la app no lo envía nunca). Como en la base desde el #231,
// search_species y search_genera exigen sesión.
//
// Fotos de referencia (#234): species_photos (`datos.fotosDeReferencia`) sale
// en las funciones públicas (reference_photo y reference_thumbnail), en la
// tabla con sesión (consulta por clave) y embebida en el detalle de una
// especie; retire_species_photo la retira (solo el administrador, con sus
// errores) y la anota en `fotosRetiradas`. El bucket público species-photos
// responde sin token con dos ilustraciones WebP locales (e2e/soporte), y
// cada descarga queda en `descargasDeReferencia`.
//
// Cualquier petición que no sepa responder queda en `sinSimular` y recibe un
// 501: la prueba falla al terminar (fixtures.ts), así un cambio de la app que
// pida algo nuevo no pasa desapercibido.

export const ORIGEN_SUPABASE = 'https://supabase.orki.invalid'

/** Funciones del catálogo público (#231): las puede llamar anon. */
const FUNCIONES_PUBLICAS = new Set([
  'search_public_species',
  'list_public_genera',
  'list_public_genus_species',
  'get_public_species',
])

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/photos/fixtures',
)

const SOPORTE = path.dirname(fileURLToPath(import.meta.url))

/** Las dos imágenes de las fotos de referencia simuladas (#234). */
const REFERENCIA = {
  medium: readFileSync(path.join(SOPORTE, 'foto-de-referencia-media.webp')),
  thumb: readFileSync(path.join(SOPORTE, 'foto-de-referencia-miniatura.webp')),
}

/** Columnas de reference_thumbnail (search_public_species y list_public_genus_species). */
function miniaturaDeReferencia(foto: FotoDeReferencia | undefined) {
  if (!foto) return null
  return {
    thumbnail_path: foto.thumbnail_path,
    thumbnail_width: foto.thumbnail_width,
    thumbnail_height: foto.thumbnail_height,
    author_name: foto.author_name,
    license: foto.license,
    source: foto.source,
    source_url: foto.source_url,
    is_modified: foto.is_modified,
  }
}

/** Columnas de reference_photo (get_public_species). */
function fotoPublica(foto: FotoDeReferencia | undefined) {
  if (!foto) return null
  return {
    ...miniaturaDeReferencia(foto),
    medium_path: foto.medium_path,
    medium_width: foto.medium_width,
    medium_height: foto.medium_height,
    attribution: foto.attribution,
    source_observation_id: foto.source_observation_id,
    obtained_at: foto.obtained_at,
  }
}

/** Solo las columnas pedidas en `select` (sin embebidos ni alias). */
function columnas(fila: Record<string, unknown>, select: string | null) {
  if (!select || select.trim() === '*') return fila
  return Object.fromEntries(
    select
      .split(',')
      .map((columna) => columna.trim())
      .filter((columna) => columna in fila)
      .map((columna) => [columna, fila[columna]]),
  )
}

interface Identidad {
  usuario: string | null
  rol: string | null
}

interface Archivo {
  tipo: string
  bytes: Buffer
}

/** Una fila de plant_photos. */
export interface FotoDePlanta {
  id: string
  plant_id: string
  user_id: string
  photo_path: string
  thumbnail_path: string
  in_bloom: boolean
  taken_at: string | null
  note: string | null
  position: number
  created_at: string
}

/** Columnas de plant_photos que la API deja cambiar. */
const COLUMNAS_EDITABLES_DE_FOTO = new Set([
  'photo_path',
  'thumbnail_path',
  'in_bloom',
  'taken_at',
  'note',
  'position',
])

const MAXIMO_DE_FOTOS = 6

/** ¿Está la ruta dentro de <usuario>/<planta>/ y con un solo nombre de archivo? */
function rutaDeLaPlanta(ruta: unknown, usuario: string, planta: string) {
  const carpeta = `${usuario}/${planta}/`
  return (
    typeof ruta === 'string' &&
    ruta.length <= 1024 &&
    ruta.startsWith(carpeta) &&
    ruta.length > carpeta.length &&
    !ruta.slice(carpeta.length).includes('/')
  )
}

export interface EventoDeProducto {
  name?: string
  [campo: string]: unknown
}

interface Respuesta {
  status: number
  body?: string | Buffer
  headers?: Record<string, string>
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'content-range, x-supabase-api-version',
}

function json(body: unknown, status = 200, headers = {}): Respuesta {
  return {
    status,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  }
}

const vacia = (status = 204): Respuesta => ({ status })

function errorPostgrest(status: number, code: string, message: string) {
  return json({ code, message, details: null, hint: null }, status)
}

const sinPermiso = () =>
  errorPostgrest(403, '42501', 'permission denied (simulado)')

/** Texto en minúsculas, sin tildes ni puntuación, para comparar nombres. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function identidadDe(cabeceras: Record<string, string>): Identidad {
  const token = /^Bearer (.+)$/i.exec(cabeceras.authorization ?? '')?.[1] ?? ''
  if (!token.startsWith('simulado.')) return { usuario: null, rol: null }
  try {
    const datos = JSON.parse(
      Buffer.from(token.slice('simulado.'.length), 'base64').toString('utf8'),
    ) as { sub?: unknown; app_role?: unknown }
    return {
      usuario: typeof datos.sub === 'string' ? datos.sub : null,
      rol: typeof datos.app_role === 'string' ? datos.app_role : null,
    }
  } catch {
    return { usuario: null, rol: null }
  }
}

/** Filtros de PostgREST de la dirección (columna=eq.valor, in.(…), gt.…). */
function filtrosDe(parametros: URLSearchParams) {
  const reservados = new Set([
    'select',
    'order',
    'limit',
    'offset',
    'on_conflict',
    'columns',
  ])
  const filtros: ((fila: Record<string, unknown>) => boolean)[] = []
  for (const [columna, expresion] of parametros) {
    if (reservados.has(columna)) continue
    const [, operador, valor] = /^(\w+)\.(.*)$/.exec(expresion) ?? []
    const texto = (fila: Record<string, unknown>) => String(fila[columna])
    switch (operador) {
      case 'eq':
        filtros.push((fila) => texto(fila) === valor)
        break
      case 'gt':
        filtros.push((fila) => texto(fila) > valor)
        break
      case 'in': {
        const lista = valor.replace(/^\(|\)$/g, '').split(',')
        filtros.push((fila) => lista.includes(texto(fila)))
        break
      }
      default:
        throw new Error(`Filtro sin simular: ${columna}=${expresion}`)
    }
  }
  return (fila: Record<string, unknown>) => filtros.every((f) => f(fila))
}

/** Respuesta de una lectura o escritura según lo que pide la cabecera Accept. */
function filas(
  lista: unknown[],
  cabeceras: Record<string, string>,
  status = 200,
): Respuesta {
  if ((cabeceras.accept ?? '').includes('application/vnd.pgrst.object+json')) {
    if (lista.length !== 1) {
      return errorPostgrest(
        406,
        'PGRST116',
        `JSON object requested, multiple (or no) rows returned (${lista.length})`,
      )
    }
    return json(lista[0], status)
  }
  return json(lista, status)
}

/** Las partes de un cuerpo multipart/form-data. */
function partesMultipart(cuerpo: Buffer, tipo: string) {
  const limite = /boundary=(?:"([^"]+)"|([^;]+))/.exec(tipo)
  const separador = limite?.[1] ?? limite?.[2]
  if (!separador) return []
  const partes: { cabeceras: string; contenido: Buffer }[] = []
  const marca = Buffer.from(`--${separador}`)
  let inicio = cuerpo.indexOf(marca)
  while (inicio !== -1) {
    const siguiente = cuerpo.indexOf(marca, inicio + marca.length)
    if (siguiente === -1) break
    const parte = cuerpo.subarray(inicio + marca.length + 2, siguiente - 2)
    const corte = parte.indexOf('\r\n\r\n')
    if (corte !== -1) {
      partes.push({
        cabeceras: parte.subarray(0, corte).toString('utf8'),
        contenido: parte.subarray(corte + 4),
      })
    }
    inicio = siguiente
  }
  return partes
}

export class SupabaseSimulado {
  readonly datos: Catalogo = catalogoInicial()
  readonly archivos = new Map<string, Archivo>()
  readonly perfiles = new Set<string>()
  readonly eventos: EventoDeProducto[] = []
  /** Filas de plant_photos. */
  fotos: FotoDePlanta[] = []
  /** Peticiones que no se supo responder (la prueba falla si hay alguna). */
  readonly sinSimular: string[] = []
  /**
   * Llamadas a las funciones del catálogo público (#232), con si llevaban el
   * token de una sesión: la app las hace siempre sin él.
   */
  readonly llamadasPublicas: { funcion: string; conToken: boolean }[] = []
  /** Fotos de referencia retiradas con retire_species_photo (#234). */
  readonly fotosRetiradas: {
    species_id: string
    source_photo_id: string
    reason: string
  }[] = []
  /** Descargas de imágenes del bucket público species-photos (#234). */
  readonly descargasDeReferencia: string[] = []
  /** Subidas cuyo archivo no se pudo leer del cuerpo (se guardó uno de muestra). */
  subidasSinCuerpo = 0
  private reloj = Date.parse('2026-11-21T15:00:00.000Z')

  /** Plantas de una persona, para comprobar lo que guardó la app. */
  plantasDe(usuario: string): Planta[] {
    return this.datos.plantas.filter((planta) => planta.user_id === usuario)
  }

  /** Fotos de una planta en orden (la principal primero). */
  fotosDe(plantaId: string): FotoDePlanta[] {
    this.copiarFotosAntiguas()
    return this.fotos
      .filter((foto) => foto.plant_id === plantaId)
      .sort((a, b) => a.position - b.position)
  }

  async responder(route: Route): Promise<void> {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    let respuesta: Respuesta
    try {
      respuesta = await this.atender(request)
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error)
      this.sinSimular.push(`${request.method()} ${request.url()} (${detalle})`)
      respuesta = json({ message: detalle }, 501)
    }
    await route.fulfill({
      status: respuesta.status,
      body: respuesta.body,
      headers: { ...CORS, ...respuesta.headers },
    })
  }

  private ahora(): string {
    this.reloj += 1000
    return new Date(this.reloj).toISOString()
  }

  private async atender(request: Request): Promise<Respuesta> {
    const url = new URL(request.url())
    const metodo = request.method()
    const cabeceras = await request.allHeaders()
    const yo = identidadDe(cabeceras)
    const ruta = url.pathname
    this.copiarFotosAntiguas()

    if (ruta.startsWith('/rest/v1/rpc/')) {
      const argumentos = (request.postDataJSON() ?? {}) as Record<
        string,
        unknown
      >
      return this.rpc(ruta.slice('/rest/v1/rpc/'.length), argumentos, yo)
    }
    if (ruta.startsWith('/rest/v1/')) {
      return this.tabla(
        ruta.slice('/rest/v1/'.length),
        metodo,
        url.searchParams,
        cabeceras,
        request,
        yo,
      )
    }
    if (ruta.startsWith('/storage/v1/')) {
      return this.storage(
        ruta.slice('/storage/v1/'.length),
        metodo,
        request,
        yo,
      )
    }
    throw new Error('ruta desconocida')
  }

  // Tablas ----------------------------------------------------------------------

  private filaDePlanta(planta: Planta) {
    const especie = this.datos.especies.find((e) => e.id === planta.species_id)
    const genero = this.datos.generos.find((g) => g.id === planta.genus_id)
    if (!genero) throw new Error(`planta sin género: ${planta.id}`)
    return {
      id: planta.id,
      entered_name: planta.entered_name,
      type: planta.type,
      validation: planta.validation,
      status: planta.status,
      acquired_on: planta.acquired_on,
      origin: planta.origin,
      location: planta.location,
      nickname: planta.nickname,
      flower_color: planta.flower_color,
      photo_in_bloom: planta.photo_in_bloom,
      photo_path: planta.photo_path,
      thumbnail_path: planta.thumbnail_path,
      // Campo calculado photo_count (#184): las filas de plant_photos.
      photo_count: this.fotos.filter((foto) => foto.plant_id === planta.id)
        .length,
      created_at: planta.created_at,
      updated_at: planta.updated_at,
      species: especie
        ? {
            id: especie.id,
            scientific_name: especie.scientific_name,
            type: especie.type,
            status: especie.status,
          }
        : null,
      genus: { id: genero.id, name: genero.name },
    }
  }

  /** Lo que hace el disparador de plants al insertar o cambiar la especie. */
  private aplicarEspecie(planta: Planta, cambioDeEspecie: boolean) {
    const especie = this.datos.especies.find((e) => e.id === planta.species_id)
    if (especie) {
      planta.genus_id = especie.genus_id
      planta.type = especie.type
      planta.validation = 'validated'
    } else if (cambioDeEspecie) {
      planta.species_id = null
      planta.validation = 'pending'
    }
  }

  private tabla(
    tabla: string,
    metodo: string,
    parametros: URLSearchParams,
    cabeceras: Record<string, string>,
    request: Request,
    yo: Identidad,
  ): Respuesta {
    const coincide = filtrosDe(parametros)
    switch (`${metodo} ${tabla}`) {
      case 'POST profiles': {
        if (yo.usuario === null) return sinPermiso()
        this.perfiles.add(yo.usuario)
        return vacia(201)
      }
      case 'GET genera': {
        const select = parametros.get('select') ?? ''
        return filas(
          this.datos.generos
            .filter((g) => coincide(g as unknown as Record<string, unknown>))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((g) =>
              select.includes('genus_abbreviations')
                ? {
                    id: g.id,
                    name: g.name,
                    is_quick_access: g.is_quick_access,
                    genus_abbreviations: g.abreviaturas.map((a, i) => ({
                      id: `${g.id}-${i}`,
                      abbreviation: a,
                    })),
                  }
                : { id: g.id, name: g.name },
            ),
          cabeceras,
        )
      }
      case 'GET species_names':
        return filas(
          this.datos.nombres
            .filter((n) => coincide(n as unknown as Record<string, unknown>))
            .map(({ id, species_id, name, type }) => ({
              id,
              species_id,
              name,
              type,
            })),
          cabeceras,
        )
      case 'GET genus_abbreviations':
        return filas(
          this.datos.generos
            .flatMap((g) =>
              g.abreviaturas.map((abbreviation, i) => ({
                id: `${g.id}-${i}`,
                genus_id: g.id,
                abbreviation,
              })),
            )
            .filter((a) => coincide(a)),
          cabeceras,
        )
      case 'GET species':
        return filas(
          this.datos.especies
            .filter((e) => coincide(e as unknown as Record<string, unknown>))
            .map((e) => this.detalleDeEspecie(e)),
          cabeceras,
        )
      case 'HEAD species': {
        const total = this.datos.especies.filter((e) =>
          coincide(e as unknown as Record<string, unknown>),
        ).length
        return { status: 200, headers: { 'content-range': `*/${total}` } }
      }
      case 'GET species_photos':
        // Con sesión, lectura pública como el resto del catálogo; sin ella,
        // nada (anon solo llega por las funciones públicas).
        if (yo.usuario === null) return sinPermiso()
        return filas(
          this.datos.fotosDeReferencia
            .filter((f) => coincide(f as unknown as Record<string, unknown>))
            .map((f) =>
              columnas(
                f as unknown as Record<string, unknown>,
                parametros.get('select'),
              ),
            ),
          cabeceras,
        )
      case 'GET plants':
      case 'PATCH plants':
      case 'DELETE plants':
      case 'POST plants':
        return this.plantas(metodo, coincide, cabeceras, request, yo)
      case 'GET plant_photos':
      case 'POST plant_photos':
      case 'PATCH plant_photos':
      case 'DELETE plant_photos':
        return this.fotosDePlantas(metodo, coincide, cabeceras, request, yo)
      default:
        throw new Error('tabla sin simular')
    }
  }

  /** La foto de referencia de una especie, si tiene. */
  private fotoDe(especieId: string): FotoDeReferencia | undefined {
    return this.datos.fotosDeReferencia.find((f) => f.species_id === especieId)
  }

  private detalleDeEspecie(especie: Especie) {
    const genero = this.datos.generos.find((g) => g.id === especie.genus_id)
    const foto = this.fotoDe(especie.id)
    return {
      ...especie,
      // Embebida en el detalle del backoffice: uno a uno, objeto o null.
      species_photos: foto ?? null,
      genera: { name: genero?.name ?? '' },
      species_names: this.datos.nombres
        .filter((n) => n.species_id === especie.id)
        .map(({ id, name, type, language }) => ({ id, name, type, language })),
    }
  }

  private plantas(
    metodo: string,
    coincide: (fila: Record<string, unknown>) => boolean,
    cabeceras: Record<string, string>,
    request: Request,
    yo: Identidad,
  ): Respuesta {
    // RLS: cada persona solo ve y toca sus plantas; sin sesión, nada.
    const mias = this.datos.plantas.filter(
      (p) =>
        yo.usuario !== null &&
        p.user_id === yo.usuario &&
        coincide(p as unknown as Record<string, unknown>),
    )
    if (metodo === 'GET') {
      return filas(
        mias
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((p) => this.filaDePlanta(p)),
        cabeceras,
      )
    }
    if (yo.usuario === null) {
      return errorPostgrest(401, 'PGRST301', 'JWT required (simulado)')
    }
    if (metodo === 'POST') {
      const cuerpo = request.postDataJSON() as Partial<Planta>
      if (this.datos.plantas.some((p) => p.id === cuerpo.id)) {
        return errorPostgrest(
          409,
          '23505',
          'duplicate key value violates unique constraint "plants_pkey"',
        )
      }
      const momento = this.ahora()
      const nueva: Planta = {
        id: String(cuerpo.id),
        user_id: yo.usuario,
        entered_name: String(cuerpo.entered_name),
        species_id: cuerpo.species_id ?? null,
        genus_id: String(cuerpo.genus_id),
        type: cuerpo.type ?? 'unknown',
        validation: 'pending',
        status: 'active',
        acquired_on: String(cuerpo.acquired_on),
        origin: cuerpo.origin ?? null,
        location: cuerpo.location ?? null,
        nickname: cuerpo.nickname ?? null,
        flower_color: cuerpo.flower_color ?? null,
        photo_in_bloom: cuerpo.photo_in_bloom ?? false,
        photo_path: null,
        thumbnail_path: null,
        created_at: momento,
        updated_at: momento,
      }
      this.aplicarEspecie(nueva, false)
      this.datos.plantas.push(nueva)
      return filas([this.filaDePlanta(nueva)], cabeceras, 201)
    }
    if (metodo === 'PATCH') {
      const cambios = request.postDataJSON() as Partial<Planta>
      const cambiaRutas = 'photo_path' in cambios || 'thumbnail_path' in cambios
      for (const planta of mias) {
        const despues = { ...planta, ...cambios }
        const sinFoto = despues.photo_path === null
        const sinMiniatura = despues.thumbnail_path === null
        if (cambiaRutas && sinFoto !== sinMiniatura) {
          return errorPostgrest(
            400,
            '23514',
            'violates check constraint "plants_photo_paths_together" (simulado)',
          )
        }
      }
      for (const planta of mias) {
        const antes = { ...planta }
        Object.assign(planta, cambios, { updated_at: this.ahora() })
        this.aplicarEspecie(planta, 'species_id' in cambios)
        this.reflejarFotoEnLaGaleria(planta, antes)
      }
      return filas(
        mias.map((p) => this.filaDePlanta(p)),
        cabeceras,
      )
    }
    // DELETE: con la planta se van sus fotos (on delete cascade).
    this.datos.plantas = this.datos.plantas.filter((p) => !mias.includes(p))
    this.fotos = this.fotos.filter(
      (foto) => !mias.some((planta) => planta.id === foto.plant_id),
    )
    return filas(
      mias.map((p) => ({ id: p.id })),
      cabeceras,
    )
  }

  // Fotos de las plantas (plant_photos) ------------------------------------------

  /**
   * Como private.copy_legacy_plant_photos(): una planta con foto y sin filas
   * de fotos pasa a tener su principal en la posición 0. Cubre las pruebas que
   * ponen la foto directamente en `datos.plantas`.
   */
  private copiarFotosAntiguas() {
    for (const planta of this.datos.plantas) {
      if (
        rutaDeLaPlanta(planta.photo_path, planta.user_id, planta.id) &&
        rutaDeLaPlanta(planta.thumbnail_path, planta.user_id, planta.id) &&
        !this.fotos.some((foto) => foto.plant_id === planta.id)
      ) {
        this.fotos.push({
          id: crypto.randomUUID(),
          plant_id: planta.id,
          user_id: planta.user_id,
          photo_path: String(planta.photo_path),
          thumbnail_path: String(planta.thumbnail_path),
          in_bloom: planta.photo_in_bloom,
          taken_at: null,
          note: null,
          position: 0,
          created_at: planta.created_at,
        })
      }
    }
  }

  /** Disparador sync_plant: la principal (position más baja) pasa a plants. */
  private copiarPrincipal(plantaId: string) {
    const planta = this.datos.plantas.find((p) => p.id === plantaId)
    if (!planta) return
    const [principal] = this.fotos
      .filter((foto) => foto.plant_id === plantaId)
      .sort((a, b) => a.position - b.position)
    const foto = principal?.photo_path ?? null
    const miniatura = principal?.thumbnail_path ?? null
    const enFloracion = principal?.in_bloom ?? false
    if (
      planta.photo_path !== foto ||
      planta.thumbnail_path !== miniatura ||
      planta.photo_in_bloom !== enFloracion
    ) {
      planta.photo_path = foto
      planta.thumbnail_path = miniatura
      planta.photo_in_bloom = enFloracion
      planta.updated_at = this.ahora()
    }
  }

  /**
   * Lo que hace la base cuando la app de una foto escribe en plants: poner la
   * foto crea la principal; sustituirla cambia sus rutas (y su fecha y su nota
   * vuelven a null); cambiar photo_in_bloom lo cambia en la principal; quitarla
   * borra solo la principal y la siguiente pasa a la planta.
   */
  private reflejarFotoEnLaGaleria(planta: Planta, antes: Planta) {
    const mismas =
      planta.photo_path === antes.photo_path &&
      planta.thumbnail_path === antes.thumbnail_path
    if (mismas && planta.photo_in_bloom === antes.photo_in_bloom) return
    const deLaPlanta = () =>
      this.fotos
        .filter((foto) => foto.plant_id === planta.id)
        .sort((a, b) => a.position - b.position)
    const [principal] = deLaPlanta()

    if (planta.photo_path === null && planta.thumbnail_path === null) {
      if (antes.photo_path === null && antes.thumbnail_path === null) return
      if (principal) this.fotos = this.fotos.filter((f) => f !== principal)
      const [siguiente] = deLaPlanta()
      if (siguiente) {
        planta.photo_path = siguiente.photo_path
        planta.thumbnail_path = siguiente.thumbnail_path
        planta.photo_in_bloom = siguiente.in_bloom
      }
      return
    }
    if (planta.photo_path === null || planta.thumbnail_path === null) return
    if (!principal) {
      this.fotos.push({
        id: crypto.randomUUID(),
        plant_id: planta.id,
        user_id: planta.user_id,
        photo_path: planta.photo_path,
        thumbnail_path: planta.thumbnail_path,
        in_bloom: planta.photo_in_bloom,
        taken_at: null,
        note: null,
        position: 0,
        created_at: this.ahora(),
      })
    } else if (!mismas) {
      Object.assign(principal, {
        photo_path: planta.photo_path,
        thumbnail_path: planta.thumbnail_path,
        in_bloom: planta.photo_in_bloom,
        taken_at: null,
        note: null,
      })
    } else {
      principal.in_bloom = planta.photo_in_bloom
    }
  }

  /** Posiciones de 0 a 5 y sin repetir en ninguna planta. */
  private posicionesValidas(fotos: FotoDePlanta[]): Respuesta | null {
    const vistas = new Set<string>()
    for (const foto of fotos) {
      if (
        !Number.isInteger(foto.position) ||
        foto.position < 0 ||
        foto.position >= MAXIMO_DE_FOTOS
      ) {
        return errorPostgrest(
          400,
          '23514',
          'violates check constraint "plant_photos_position_range" (simulado)',
        )
      }
      const clave = `${foto.plant_id}:${foto.position}`
      if (vistas.has(clave)) {
        return errorPostgrest(
          409,
          '23505',
          'duplicate key value violates unique constraint "plant_photos_plant_id_position_key" (simulado)',
        )
      }
      vistas.add(clave)
    }
    return null
  }

  private fotosDePlantas(
    metodo: string,
    coincide: (fila: Record<string, unknown>) => boolean,
    cabeceras: Record<string, string>,
    request: Request,
    yo: Identidad,
  ): Respuesta {
    // RLS: cada persona solo sus fotos; sin sesión, nada.
    const mias = this.fotos
      .filter(
        (foto) =>
          yo.usuario !== null &&
          foto.user_id === yo.usuario &&
          coincide(foto as unknown as Record<string, unknown>),
      )
      .sort(
        (a, b) =>
          a.plant_id.localeCompare(b.plant_id) || a.position - b.position,
      )
    const conRepresentacion = (cabeceras.prefer ?? '').includes(
      'return=representation',
    )
    if (metodo === 'GET') return filas(mias, cabeceras)
    if (yo.usuario === null) {
      return errorPostgrest(401, 'PGRST301', 'JWT required (simulado)')
    }
    const usuario = yo.usuario

    if (metodo === 'POST') {
      const cuerpo = request.postDataJSON() as
        Partial<FotoDePlanta> | Partial<FotoDePlanta>[]
      const nuevas: FotoDePlanta[] = []
      for (const fila of Array.isArray(cuerpo) ? cuerpo : [cuerpo]) {
        const dueno = fila.user_id ?? usuario
        if (dueno !== usuario) {
          return errorPostgrest(
            403,
            '42501',
            'new row violates row-level security policy for table "plant_photos" (simulado)',
          )
        }
        const planta = this.datos.plantas.find((p) => p.id === fila.plant_id)
        if (!planta) {
          return errorPostgrest(
            409,
            '23503',
            'violates foreign key constraint "plant_photos_plant_id_fkey" (simulado)',
          )
        }
        if (planta.user_id !== dueno) {
          return errorPostgrest(
            400,
            '23514',
            'el dueño de la foto tiene que ser el de la planta (simulado)',
          )
        }
        if (
          !rutaDeLaPlanta(fila.photo_path, dueno, planta.id) ||
          !rutaDeLaPlanta(fila.thumbnail_path, dueno, planta.id)
        ) {
          return errorPostgrest(
            400,
            '23514',
            'violates check constraint "plant_photos_photo_path_valid" (simulado)',
          )
        }
        nuevas.push({
          id: fila.id ?? crypto.randomUUID(),
          plant_id: planta.id,
          user_id: dueno,
          photo_path: String(fila.photo_path),
          thumbnail_path: String(fila.thumbnail_path),
          in_bloom: fila.in_bloom ?? false,
          taken_at: fila.taken_at ?? null,
          note: fila.note ?? null,
          position: Number(fila.position),
          created_at: this.ahora(),
        })
      }
      const error = this.posicionesValidas([...this.fotos, ...nuevas])
      if (error) return error
      this.fotos.push(...nuevas)
      for (const plantaId of new Set(nuevas.map((foto) => foto.plant_id))) {
        this.copiarPrincipal(plantaId)
      }
      return conRepresentacion ? filas(nuevas, cabeceras, 201) : vacia(201)
    }

    if (metodo === 'PATCH') {
      const cambios = request.postDataJSON() as Record<string, unknown>
      const prohibida = Object.keys(cambios).find(
        (columna) => !COLUMNAS_EDITABLES_DE_FOTO.has(columna),
      )
      if (prohibida) {
        return errorPostgrest(
          403,
          '42501',
          `permission denied for column ${prohibida} of table plant_photos (simulado)`,
        )
      }
      const cambiadas = mias.map((foto) => ({ ...foto, ...cambios }))
      for (const foto of cambiadas) {
        // plant_photos_note_valid y plant_photos_taken_at_not_future.
        const notaMala =
          foto.note !== null &&
          (foto.note.trim() === '' || [...foto.note].length > 500)
        const manana = new Date(Date.now() + 2 * 86_400_000)
          .toISOString()
          .slice(0, 10)
        if (notaMala || (foto.taken_at !== null && foto.taken_at > manana)) {
          return errorPostgrest(
            400,
            '23514',
            'violates check constraint "plant_photos_note_valid" (simulado)',
          )
        }
        if (
          !rutaDeLaPlanta(foto.photo_path, foto.user_id, foto.plant_id) ||
          !rutaDeLaPlanta(foto.thumbnail_path, foto.user_id, foto.plant_id)
        ) {
          return errorPostgrest(
            400,
            '23514',
            'violates check constraint "plant_photos_photo_path_valid" (simulado)',
          )
        }
      }
      // La unicidad se comprueba al final de la sentencia (deferrable).
      const error = this.posicionesValidas([
        ...this.fotos.filter((foto) => !mias.includes(foto)),
        ...cambiadas,
      ])
      if (error) return error
      mias.forEach((foto, indice) => Object.assign(foto, cambiadas[indice]))
      for (const plantaId of new Set(mias.map((foto) => foto.plant_id))) {
        this.copiarPrincipal(plantaId)
      }
      return conRepresentacion ? filas(mias, cabeceras) : vacia()
    }

    // DELETE
    this.fotos = this.fotos.filter((foto) => !mias.includes(foto))
    for (const plantaId of new Set(mias.map((foto) => foto.plant_id))) {
      this.copiarPrincipal(plantaId)
    }
    return conRepresentacion ? filas(mias, cabeceras) : vacia()
  }

  /**
   * La función propuesta en el #183 (aún sin migración): pone las fotos de la
   * planta en el orden de photo_ids, en una sola sentencia (la unicidad de la
   * posición se comprueba al final). Si la lista no es exactamente la de las
   * fotos de la planta, 22023 y no cambia nada.
   */
  private reordenarFotos(argumentos: Record<string, unknown>, yo: Identidad) {
    if (yo.usuario === null) {
      return errorPostgrest(401, 'PGRST301', 'JWT required (simulado)')
    }
    const plantaId = String(argumentos.target_plant_id)
    const ids = Array.isArray(argumentos.photo_ids)
      ? argumentos.photo_ids.map(String)
      : []
    const deLaPlanta = this.fotosDe(plantaId).filter(
      (foto) => foto.user_id === yo.usuario,
    )
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== deLaPlanta.length ||
      deLaPlanta.some((foto) => !ids.includes(foto.id))
    ) {
      return errorPostgrest(
        400,
        '22023',
        'las fotos no son las de la planta (simulado)',
      )
    }
    for (const foto of deLaPlanta) foto.position = ids.indexOf(foto.id)
    this.copiarPrincipal(plantaId)
    return json(this.fotosDe(plantaId))
  }

  // Funciones (RPC) ---------------------------------------------------------------

  private buscarEspecies(consulta: string) {
    const texto = normalizar(consulta)
    const resultados: {
      especie: Especie
      nombre: string
      tipo: 'scientific' | 'synonym' | 'common'
    }[] = []
    for (const especie of this.datos.especies) {
      const genero = this.datos.generos.find((g) => g.id === especie.genus_id)
      const epiteto = especie.scientific_name.split(' ').slice(1).join(' ')
      const candidatos: [string, 'scientific' | 'synonym' | 'common'][] = [
        [especie.scientific_name, 'scientific'],
        ...(genero?.abreviaturas ?? []).map((a): [string, 'scientific'] => [
          `${a} ${epiteto}`,
          'scientific',
        ]),
        ...this.datos.nombres
          .filter((n) => n.species_id === especie.id)
          .map((n): [string, 'synonym' | 'common'] => [n.name, n.type]),
      ]
      const encontrado = candidatos.find(([nombre]) =>
        normalizar(nombre).includes(texto),
      )
      if (encontrado) {
        const [nombre, tipo] = encontrado
        resultados.push({
          especie,
          nombre: tipo === 'scientific' ? especie.scientific_name : nombre,
          tipo,
        })
      }
    }
    return resultados.sort((a, b) =>
      a.especie.scientific_name.localeCompare(b.especie.scientific_name),
    )
  }

  private filaDeCatalogo(especie: Especie) {
    const genero = this.datos.generos.find((g) => g.id === especie.genus_id)
    const nombres = this.datos.nombres.filter(
      (n) => n.species_id === especie.id,
    )
    return {
      id: especie.id,
      scientific_name: especie.scientific_name,
      genus_id: especie.genus_id,
      genus_name: genero?.name ?? '',
      type: especie.type,
      status: especie.status,
      source: especie.source,
      source_ref: especie.source_ref,
      synonym_count: nombres.filter((n) => n.type === 'synonym').length,
      common_name_count: nombres.filter((n) => n.type === 'common').length,
      created_at: especie.created_at,
      updated_at: especie.updated_at,
    }
  }

  /** Grupos de la cola: plantas por validar con el mismo nombre y género. */
  private gruposDePropuestas() {
    const grupos = new Map<string, Planta[]>()
    for (const planta of this.datos.plantas) {
      if (planta.validation !== 'pending' || planta.species_id !== null) {
        continue
      }
      const clave = `${planta.genus_id}:${normalizar(planta.entered_name)}`
      grupos.set(clave, [...(grupos.get(clave) ?? []), planta])
    }
    return [...grupos.values()]
      .map((plantas) => {
        const primera = plantas[0]
        const genero = this.datos.generos.find((g) => g.id === primera.genus_id)
        return {
          genus_id: primera.genus_id,
          genus_name: genero?.name ?? '',
          name_key: normalizar(primera.entered_name),
          proposed_name: primera.entered_name,
          type: primera.type,
          plant_count: plantas.length,
          photos: this.fotosDeGrupo(plantas),
          plantas,
        }
      })
      .sort(
        (a, b) =>
          b.plant_count - a.plant_count ||
          a.proposed_name.localeCompare(b.proposed_name),
      )
  }

  /**
   * Como list_proposal_groups() desde el #184: hasta seis fotos de
   * plant_photos, por turnos (la principal de cada planta, de la más reciente
   * a la más antigua; después la segunda de cada una...). Una planta sin
   * filas aporta la foto de sus columnas.
   */
  private fotosDeGrupo(plantas: Planta[]) {
    const porPlanta = [...plantas]
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
      )
      .map((planta) => {
        const filas = this.fotos
          .filter((foto) => foto.plant_id === planta.id)
          .sort((a, b) => a.position - b.position)
        if (filas.length > 0) return filas
        return planta.photo_path && planta.thumbnail_path
          ? [
              {
                photo_path: planta.photo_path,
                thumbnail_path: planta.thumbnail_path,
              },
            ]
          : []
      })
    const fotos: { photo_path: string; thumbnail_path: string }[] = []
    for (let turno = 0; turno < 6; turno++) {
      for (const filas of porPlanta) {
        const foto = filas[turno]
        if (foto && fotos.length < 6) {
          fotos.push({
            photo_path: foto.photo_path,
            thumbnail_path: foto.thumbnail_path,
          })
        }
      }
    }
    return fotos
  }

  private grupoPedido(argumentos: Record<string, unknown>) {
    return this.gruposDePropuestas().find(
      (g) =>
        g.genus_id === argumentos.group_genus_id &&
        g.name_key === argumentos.group_name_key,
    )
  }

  private crearEspecie(
    argumentos: Record<string, unknown>,
    source: Especie['source'],
  ): Especie {
    const momento = this.ahora()
    const especie: Especie = {
      id: crypto.randomUUID(),
      scientific_name: String(argumentos.new_scientific_name),
      genus_id: String(argumentos.new_genus_id),
      type: argumentos.new_type === 'hybrid' ? 'hybrid' : 'species',
      status:
        argumentos.new_status === 'imported' ||
        argumentos.new_status === 'observed'
          ? argumentos.new_status
          : 'validated',
      source,
      source_ref: null,
      created_at: momento,
      updated_at: momento,
    }
    this.datos.especies.push(especie)
    return especie
  }

  /**
   * Catálogo público (#231, #232): las cuatro funciones que puede llamar
   * anon, con sus topes y su paginación (desde 1; más allá de la última, la
   * última), solo con las especies públicas (no las propuestas sin validar) y
   * ordenadas por el nombre normalizado, como la migración
   * 20261122150000_catalogo_publico.sql.
   */
  private catalogoPublico(
    nombre: string,
    argumentos: Record<string, unknown>,
  ): Respuesta {
    const publicas = this.datos.especies.filter(
      (e) => e.source !== 'user_proposal' || e.status === 'validated',
    )
    const genero = (id: string) => this.datos.generos.find((g) => g.id === id)
    const tope = (valor: unknown, porDefecto: number, maximo: number) => {
      const n = Math.trunc(Number(valor))
      return Number.isFinite(n) && n > 0 ? Math.min(n, maximo) : porDefecto
    }
    const pagina = (valor: unknown, paginas: number) => {
      const n = Math.trunc(Number(valor))
      return Math.min(Math.max(1, paginas), Number.isFinite(n) && n > 0 ? n : 1)
    }
    const porNombre = <T>(lista: T[], texto: (item: T) => string) =>
      [...lista].sort((a, b) => {
        const x = normalizar(texto(a))
        const y = normalizar(texto(b))
        return x < y ? -1 : x > y ? 1 : 0
      })
    switch (nombre) {
      case 'search_public_species': {
        const texto =
          typeof argumentos.query === 'string' ? argumentos.query : ''
        if (normalizar(texto).length < 2 || texto.length > 100) return json([])
        const ids = new Set(publicas.map((e) => e.id))
        return json(
          this.buscarEspecies(texto)
            .filter(({ especie }) => ids.has(especie.id))
            .slice(0, tope(argumentos.max_results, 10, 15))
            .map(({ especie, nombre: coincidencia, tipo }) => ({
              id: especie.id,
              scientific_name: especie.scientific_name,
              genus_id: especie.genus_id,
              genus_name: genero(especie.genus_id)?.name ?? '',
              type: especie.type,
              matched_name: coincidencia,
              matched_name_type: tipo,
              reference_thumbnail: miniaturaDeReferencia(
                this.fotoDe(especie.id),
              ),
            })),
        )
      }
      case 'list_public_genera': {
        const tamano = tope(argumentos.page_size, 100, 200)
        const generos = porNombre(
          this.datos.generos.filter((g) =>
            publicas.some((e) => e.genus_id === g.id),
          ),
          (g) => g.name,
        )
        const actual = pagina(
          argumentos.page_number,
          Math.ceil(generos.length / tamano),
        )
        return json(
          generos.slice((actual - 1) * tamano, actual * tamano).map((g) => ({
            id: g.id,
            name: g.name,
            species_count: publicas.filter((e) => e.genus_id === g.id).length,
            total_count: generos.length,
            current_page: actual,
          })),
        )
      }
      case 'list_public_genus_species': {
        const g = genero(String(argumentos.target_genus_id))
        const tamano = tope(argumentos.page_size, 50, 100)
        const especies = porNombre(
          publicas.filter((e) => e.genus_id === g?.id),
          (e) => e.scientific_name,
        )
        if (g === undefined || especies.length === 0) return json([])
        const actual = pagina(
          argumentos.page_number,
          Math.ceil(especies.length / tamano),
        )
        return json(
          especies.slice((actual - 1) * tamano, actual * tamano).map((e) => ({
            id: e.id,
            scientific_name: e.scientific_name,
            type: e.type,
            genus_id: g.id,
            genus_name: g.name,
            total_count: especies.length,
            current_page: actual,
            reference_thumbnail: miniaturaDeReferencia(this.fotoDe(e.id)),
          })),
        )
      }
      case 'get_public_species': {
        const especie = publicas.find(
          (e) => e.id === argumentos.target_species_id,
        )
        if (especie === undefined) return json([])
        const nombres = this.datos.nombres.filter(
          (n) => n.species_id === especie.id,
        )
        const sinonimos = nombres.filter((n) => n.type === 'synonym')
        const comunes = nombres.filter((n) => n.type === 'common')
        return json([
          {
            id: especie.id,
            scientific_name: especie.scientific_name,
            genus_id: especie.genus_id,
            genus_name: genero(especie.genus_id)?.name ?? '',
            type: especie.type,
            source: especie.source,
            source_ref:
              especie.source === 'col' || especie.source === 'gbif'
                ? especie.source_ref
                : null,
            synonyms: sinonimos.slice(0, 100).map((n) => n.name),
            synonym_count: sinonimos.length,
            common_names: comunes
              .slice(0, 100)
              .map((n) => ({ name: n.name, language: n.language })),
            common_name_count: comunes.length,
            reference_photo: fotoPublica(this.fotoDe(especie.id)),
          },
        ])
      }
      default:
        throw new Error(`función pública sin simular: ${nombre}`)
    }
  }

  private rpc(
    nombre: string,
    argumentos: Record<string, unknown>,
    yo: Identidad,
  ): Respuesta {
    const esAdmin = yo.rol === 'catalog_admin'
    if (FUNCIONES_PUBLICAS.has(nombre)) {
      this.llamadasPublicas.push({
        funcion: nombre,
        conToken: yo.usuario !== null,
      })
      return this.catalogoPublico(nombre, argumentos)
    }
    switch (nombre) {
      case 'search_species': {
        // Desde el #231, solo con sesión: sin ella, search_public_species.
        if (yo.usuario === null) return sinPermiso()
        const maximo = Number(argumentos.max_results ?? 10)
        return json(
          this.buscarEspecies(String(argumentos.query))
            .slice(0, maximo)
            .map(({ especie, nombre: coincidencia, tipo }) => {
              const genero = this.datos.generos.find(
                (g) => g.id === especie.genus_id,
              )
              return {
                id: especie.id,
                scientific_name: especie.scientific_name,
                genus_id: especie.genus_id,
                genus_name: genero?.name ?? '',
                type: especie.type,
                status: especie.status,
                matched_name: coincidencia,
                matched_name_type: tipo,
              }
            }),
        )
      }
      case 'search_genera': {
        if (yo.usuario === null) return sinPermiso()
        const texto = normalizar(String(argumentos.query))
        return json(
          this.datos.generos
            .map((g) => ({
              genero: g,
              abreviatura:
                g.abreviaturas.find((a) => normalizar(a).startsWith(texto)) ??
                null,
            }))
            .filter(
              ({ genero, abreviatura }) =>
                normalizar(genero.name).includes(texto) || abreviatura !== null,
            )
            .map(({ genero, abreviatura }) => ({
              id: genero.id,
              name: genero.name,
              is_quick_access: genero.is_quick_access,
              matched_abbreviation: normalizar(genero.name).includes(texto)
                ? null
                : abreviatura,
            })),
        )
      }
      case 'record_product_events': {
        if (yo.usuario === null) return sinPermiso()
        const lote = Array.isArray(argumentos.events) ? argumentos.events : []
        this.eventos.push(...(lote as EventoDeProducto[]))
        return vacia()
      }
      case 'reorder_plant_photos':
        return this.reordenarFotos(argumentos, yo)
      default:
        break
    }

    // Backoffice: solo administradores del catálogo (como las políticas).
    if (!esAdmin) return sinPermiso()
    switch (nombre) {
      case 'catalog_summary': {
        const especies = this.datos.especies
        const cuenta = (filtro: (e: Especie) => boolean) =>
          especies.filter(filtro).length
        return json([
          {
            genus_count: this.datos.generos.length,
            species_count: cuenta((e) => e.type === 'species'),
            hybrid_count: cuenta((e) => e.type === 'hybrid'),
            synonym_count: this.datos.nombres.filter(
              (n) => n.type === 'synonym',
            ).length,
            common_name_count: this.datos.nombres.filter(
              (n) => n.type === 'common',
            ).length,
            imported_count: cuenta((e) => e.status === 'imported'),
            validated_count: cuenta((e) => e.status === 'validated'),
            observed_count: cuenta((e) => e.status === 'observed'),
            col_source_count: cuenta((e) => e.source === 'col'),
            curated_source_count: cuenta((e) => e.source === 'curated'),
            user_proposal_source_count: cuenta(
              (e) => e.source === 'user_proposal',
            ),
            gbif_source_count: cuenta((e) => e.source === 'gbif'),
          },
        ])
      }
      case 'list_catalog_species': {
        const lista = [...this.datos.especies]
          .filter(
            (e) =>
              (argumentos.filter_genus_id === undefined ||
                e.genus_id === argumentos.filter_genus_id) &&
              (argumentos.filter_status === undefined ||
                e.status === argumentos.filter_status) &&
              (argumentos.filter_type === undefined ||
                e.type === argumentos.filter_type) &&
              (argumentos.filter_source === undefined ||
                e.source === argumentos.filter_source),
          )
          .sort((a, b) => a.scientific_name.localeCompare(b.scientific_name))
        return json(
          lista.map((e) => ({
            ...this.filaDeCatalogo(e),
            total_count: lista.length,
            has_previous: false,
            has_next: false,
          })),
        )
      }
      case 'search_catalog_species': {
        const lista = this.buscarEspecies(String(argumentos.query))
        return json(
          lista.map(({ especie, nombre: coincidencia, tipo }) => ({
            ...this.filaDeCatalogo(especie),
            matched_name: coincidencia,
            matched_name_type: tipo,
            total_count: lista.length,
            current_page: 1,
          })),
        )
      }
      case 'list_catalog_genera': {
        const texto =
          typeof argumentos.query === 'string'
            ? normalizar(argumentos.query)
            : ''
        const lista = this.datos.generos
          .filter(
            (g) =>
              (texto === '' || normalizar(g.name).includes(texto)) &&
              (argumentos.quick_access_only !== true || g.is_quick_access),
          )
          .sort((a, b) => a.name.localeCompare(b.name))
        return json(
          lista.map((g) => ({
            id: g.id,
            name: g.name,
            is_quick_access: g.is_quick_access,
            abbreviations: g.abreviaturas,
            species_count: this.datos.especies.filter(
              (e) => e.genus_id === g.id,
            ).length,
            total_count: lista.length,
            current_page: 1,
          })),
        )
      }
      case 'count_species_plants':
        return json(
          this.datos.plantas.filter(
            (p) => p.species_id === argumentos.target_species_id,
          ).length,
        )
      case 'species_history':
        return json([])
      case 'count_proposal_groups':
        return json(this.gruposDePropuestas().length)
      case 'list_proposal_groups': {
        const grupos = this.gruposDePropuestas()
        const desde = Number(argumentos.page_offset ?? 0)
        const tamano = Number(argumentos.page_size ?? 20)
        return json(
          grupos.slice(desde, desde + tamano).map((grupo) => ({
            genus_id: grupo.genus_id,
            genus_name: grupo.genus_name,
            name_key: grupo.name_key,
            proposed_name: grupo.proposed_name,
            type: grupo.type,
            plant_count: grupo.plant_count,
            photos: grupo.photos,
            total_count: grupos.length,
          })),
        )
      }
      case 'link_proposal_group': {
        const grupo = this.grupoPedido(argumentos)
        const especie = this.datos.especies.find(
          (e) => e.id === argumentos.target_species_id,
        )
        if (!grupo || !especie) {
          return errorPostgrest(400, 'P0002', 'grupo o especie inexistente')
        }
        for (const planta of grupo.plantas) {
          planta.species_id = especie.id
          this.aplicarEspecie(planta, true)
        }
        return json([
          { action_id: crypto.randomUUID(), plant_count: grupo.plant_count },
        ])
      }
      case 'mark_proposal_unidentifiable': {
        const grupo = this.grupoPedido(argumentos)
        if (!grupo) return errorPostgrest(400, 'P0002', 'grupo inexistente')
        for (const planta of grupo.plantas) planta.validation = 'unidentifiable'
        return json([
          { action_id: crypto.randomUUID(), plant_count: grupo.plant_count },
        ])
      }
      case 'create_catalog_species':
        return json(this.crearEspecie(argumentos, 'curated'))
      case 'set_catalog_species_status': {
        // Cambio de estado por lote: cuántas cambiaron (las que ya lo tenían
        // no cuentan).
        const ids = (argumentos.target_species_ids as string[]) ?? []
        const estado = argumentos.new_status as Especie['status']
        let cambiadas = 0
        for (const especie of this.datos.especies) {
          if (!ids.includes(especie.id) || especie.status === estado) continue
          especie.status = estado
          especie.updated_at = this.ahora()
          cambiadas += 1
        }
        return json(cambiadas)
      }
      case 'retire_species_photo':
        return this.retirarFoto(argumentos)
      case 'create_species_from_proposal': {
        const grupo = this.grupoPedido(argumentos)
        if (!grupo) {
          return json([
            {
              action_id: crypto.randomUUID(),
              plant_count: 0,
              species_id: null,
            },
          ])
        }
        const especie = this.crearEspecie(argumentos, 'user_proposal')
        for (const planta of grupo.plantas) {
          planta.species_id = especie.id
          this.aplicarEspecie(planta, true)
        }
        return json([
          {
            action_id: crypto.randomUUID(),
            plant_count: grupo.plant_count,
            species_id: especie.id,
          },
        ])
      }
      default:
        throw new Error('función sin simular')
    }
  }

  /**
   * retire_species_photo (#234): con un motivo válido y la foto que tiene la
   * especie, la borra y la anota; si no, los errores de la base.
   */
  private retirarFoto(argumentos: Record<string, unknown>): Respuesta {
    const motivos = [
      'misidentified',
      'inappropriate',
      'author_request',
      'other',
    ]
    const motivo = String(argumentos.retire_reason)
    if (!motivos.includes(motivo)) {
      return json(
        {
          code: '22023',
          message: 'Elige por qué se retira la foto (simulado)',
          details: JSON.stringify({ reason: 'reason_required' }),
          hint: null,
        },
        400,
      )
    }
    const especieId = String(argumentos.target_species_id)
    const foto = this.fotoDe(especieId)
    if (
      !foto ||
      foto.source_photo_id !== String(argumentos.target_source_photo_id)
    ) {
      return json(
        {
          code: 'P0002',
          message:
            'La foto de referencia de esta especie ya no es la que se quería retirar. (simulado)',
          details: JSON.stringify({
            reason: 'species_photo_not_found',
            species_id: especieId,
            source_photo_id: argumentos.target_source_photo_id,
            current_source_photo_id: foto?.source_photo_id ?? null,
          }),
          hint: null,
        },
        404,
      )
    }
    this.datos.fotosDeReferencia = this.datos.fotosDeReferencia.filter(
      (f) => f !== foto,
    )
    this.fotosRetiradas.push({
      species_id: especieId,
      source_photo_id: foto.source_photo_id,
      reason: motivo,
    })
    return json([
      {
        action_id: crypto.randomUUID(),
        medium_path: foto.medium_path,
        thumbnail_path: foto.thumbnail_path,
      },
    ])
  }

  // Storage ---------------------------------------------------------------------

  private storage(
    ruta: string,
    metodo: string,
    request: Request,
    yo: Identidad,
  ): Respuesta {
    const errorDeStorage = (status: number, error: string) =>
      json({ statusCode: String(status), error, message: error }, status)

    // Bucket público de las fotos de referencia (#234): sin token, cualquier
    // ruta <especie>/(medium|thumb)-<id>.webp; los archivos siguen ahí tras
    // retirar la foto, como en el bucket real.
    const publica =
      /^object\/public\/species-photos\/[0-9a-f-]{36}\/(medium|thumb)-[0-9]+\.webp$/.exec(
        ruta,
      )
    if (metodo === 'GET' && publica) {
      this.descargasDeReferencia.push(ruta)
      return {
        status: 200,
        body: publica[1] === 'medium' ? REFERENCIA.medium : REFERENCIA.thumb,
        headers: {
          'content-type': 'image/webp',
          'cache-control': 'public, max-age=31536000',
        },
      }
    }
    if (yo.usuario === null) return errorDeStorage(401, 'InvalidJWT')
    const propia = (archivo: string) => archivo.startsWith(`${yo.usuario}/`)
    const esAdmin = yo.rol === 'catalog_admin'

    const subida = /^object\/plant-photos\/(.+)$/.exec(ruta)
    if (metodo === 'POST' && subida) {
      const archivo = decodeURIComponent(subida[1])
      if (!propia(archivo)) return errorDeStorage(403, 'AccessDenied')
      if (this.archivos.has(archivo)) return errorDeStorage(409, 'Duplicate')
      this.archivos.set(archivo, this.archivoSubido(request, archivo))
      return json({ Id: archivo, Key: `plant-photos/${archivo}` })
    }

    // supabase-js descarga con object/<bucket>/<ruta> (con la sesión) o, en
    // otras versiones, con object/authenticated/<bucket>/<ruta>.
    const descarga = /^object\/(?:authenticated\/)?plant-photos\/(.+)$/.exec(
      ruta,
    )
    if (metodo === 'GET' && descarga) {
      const archivo = decodeURIComponent(descarga[1])
      if (!propia(archivo) && !esAdmin) {
        return errorDeStorage(400, 'AccessDenied')
      }
      const guardado = this.archivos.get(archivo)
      if (!guardado) return errorDeStorage(404, 'NoSuchKey')
      return {
        status: 200,
        body: guardado.bytes,
        headers: { 'content-type': guardado.tipo },
      }
    }

    if (metodo === 'POST' && ruta === 'object/list/plant-photos') {
      const { prefix = '' } = (request.postDataJSON() ?? {}) as {
        prefix?: string
      }
      const carpeta = prefix.endsWith('/') ? prefix : `${prefix}/`
      if (!propia(carpeta)) return json([])
      return json(
        [...this.archivos.keys()]
          .filter((archivo) => archivo.startsWith(carpeta))
          .map((archivo) => ({
            name: archivo.slice(carpeta.length),
            id: archivo,
          })),
      )
    }

    if (metodo === 'DELETE' && ruta === 'object/plant-photos') {
      const { prefixes = [] } = (request.postDataJSON() ?? {}) as {
        prefixes?: string[]
      }
      const borrados = prefixes.filter(
        (archivo) => propia(archivo) && this.archivos.delete(archivo),
      )
      return json(borrados.map((name) => ({ name })))
    }
    throw new Error('ruta de Storage sin simular')
  }

  /**
   * El archivo de una subida (multipart/form-data de supabase-js). Si el
   * navegador no deja leer el cuerpo, se guarda una imagen de muestra del
   * mismo tipo para que la app pueda descargarla después.
   */
  private archivoSubido(request: Request, archivo: string): Archivo {
    const tipoPorExtension = archivo.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg'
    const cuerpo = request.postDataBuffer()
    const parte = cuerpo
      ? partesMultipart(cuerpo, request.headers()['content-type'] ?? '').find(
          (p) => /content-type:/i.test(p.cabeceras),
        )
      : undefined
    if (parte && parte.contenido.length > 0) {
      const tipo =
        /content-type:\s*([^\r\n;]+)/i.exec(parte.cabeceras)?.[1] ??
        tipoPorExtension
      return { tipo, bytes: Buffer.from(parte.contenido) }
    }
    this.subidasSinCuerpo += 1
    return {
      tipo: tipoPorExtension,
      bytes: readFileSync(
        path.join(
          FIXTURES,
          tipoPorExtension === 'image/webp'
            ? 'sin-metadatos.webp'
            : 'sin-metadatos.jpg',
        ),
      ),
    }
  }
}
