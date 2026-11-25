# Fotos

Secciones que estaban en el README de la raíz hasta el #288; el índice de la documentación está en el [README](../../README.md#documentación).

## Fotos de referencia

Las fotos de referencia de las especies (#234, parte de #180) son fotos de iNaturalist que enseñan cómo es una especie, nunca la planta de nadie. El modelo, las licencias aceptadas (CC0, dominio público, CC BY y CC BY-SA) y el bucket público `species-photos` están en [Fotos de referencia](../../supabase/README.md#fotos-de-referencia); hoy puede no haber ninguna cargada, y todo se ve igual sin ellas.

- **La pieza** (`src/components/ui/ReferencePhoto.tsx`, ver `docs/piezas-de-interfaz.md`): siempre rotulada «Foto de referencia», con texto alternativo «Foto de referencia de <nombre científico>» y su crédito a la vista (autor, licencia enlazada a su texto legal en Creative Commons, «reducida» si la imagen está adaptada y «Ver el original en iNaturalist»). La imagen lleva su ancho y su alto, `loading="lazy"`, `decoding="async"` y sin `Referer`; si no carga, la pieza se retira entera, sin hueco roto.
- **Direcciones:** la pública del bucket (`supabase.storage.from('species-photos').getPublicUrl(ruta)`), sin token ni URL firmada. `src/lib/referencePhotos.ts` valida lo que llega (una licencia que no es de las cuatro, un original que no es de iNaturalist o una foto sin autor se tratan como «sin foto») y resuelve las direcciones.
- **Dónde se piden y cuántas consultas añaden:**
  - Catálogo público: en la misma respuesta de `get_public_species`, `search_public_species` y `list_public_genus_species`; ninguna consulta más.
  - Registro: al elegir una especie del catálogo (al editar, solo si cambia), «Así es su especie» bajo el nombre, con la miniatura y el crédito. Una consulta por clave a `species_photos` con sesión por especie elegida (`useReferencePhoto`, que la recuerda en memoria mientras dura la pestaña); ninguna sin conexión. Sin foto, o si falla, nada.
  - Detalle de una planta sin ninguna foto propia: la de su especie en el recuadro de la foto, con el rótulo, el crédito y «Aún no tienes fotos de esta planta…»; no es principal, no cuenta en «N de 6» ni abre el visor. Una consulta por clave al abrir el detalle (la misma que en el registro), ninguna con fotos propias o sin especie. No se embebe en la consulta de la colección: con 100 plantas en el doble, la respuesta pesaría entre un 19 % (con foto en 3 de cada 10 especies) y un 55 % (todas con foto) más, en cada carga de «Mi colección» y en su copia del dispositivo. La tarjeta del inventario no cambia.
  - Backoffice: embebida en la lectura del detalle de la especie (`species(..., species_photos(...))`), sin consulta más.
- **Retirar** (backoffice, en el detalle de la especie): «Retirar foto», con el motivo obligatorio (mal identificada, inapropiada, a petición del autor u otro) y confirmación, llama a `retire_species_photo` con la foto que se está viendo. Si cambió entretanto (`species_photo_not_found`), no se toca nada, se avisa y se relee el detalle. La retirada sale en el historial de la especie con su motivo y la foto.
- **Sin conexión y service worker:** las fotos de referencia no van en el precaché (no son del build) ni se copian a Cache Storage o IndexedDB. El service worker no tiene `runtimeCaching` (ver la configuración de Workbox en `vite.config.ts`), así que no intercepta las peticiones a Supabase: las imágenes, de otro origen, van a la red y solo las guarda la caché HTTP del navegador, con el `Cache-Control` que les ponga la carga (las rutas cambian con cada foto, así que no se sirve una vieja). Se decidió no añadir una regla de Workbox para ellas: guardarlas sería una copia local más de fotos de terceros (con su crédito que mantener y su retirada que propagar) y el inventario sin conexión no las necesita. Las fotos de las plantas tampoco pasan por el service worker: sus miniaturas las guarda la app en Cache Storage.
- **Pruebas:** `src/lib/referencePhotos.test.ts`, `src/components/ui/ReferencePhoto.test.tsx`, `src/catalog/CatalogRoutes.test.tsx`, `src/registration/SpeciesPreview.test.tsx`, `src/pages/NewPlantPage.test.tsx`, `src/pages/PlantDetailGallery.test.tsx`, `src/backoffice/SpeciesReferencePhoto.test.tsx` y `e2e/fotos-de-referencia.spec.ts` (el Supabase simulado sirve dos especies con foto y una ilustración WebP local, nunca la red).
- **Sin verificar:** el bucket `species-photos` real (direcciones públicas, cabeceras de caché y CORS del CDN de Supabase) y la carga, que aún no ha subido ninguna foto.

## Fotos: compresión en el navegador

`apps/web/src/photos/` prepara una foto antes de subirla (#81): la recodifica con canvas, la orienta, la reduce hasta los topes y genera su miniatura. No usa dependencias ni las transformaciones de imagen de Supabase (no están en el plan gratuito).

```ts
import { loadPhotoProcessing } from '../photos/load.ts'

const { processPhoto, PhotoProcessingError } = await loadPhotoProcessing()
const { photo, thumbnail } = await processPhoto(file, { signal })
// photo.blob, photo.type ('image/webp' | 'image/jpeg'), photo.width, photo.height,
// photo.bytes, photo.quality, photo.withinBudget; lo mismo en thumbnail.
// Error: PhotoProcessingError con reason 'empty' | 'not-an-image' | 'unsupported-format'
// | 'too-large' | 'decode-failed' | 'encode-failed' | 'unsupported-browser' | 'aborted'
// y message en español, listo para mostrar.
```

- **Carga diferida:** las pantallas solo importan `load.ts`; el resto va en un chunk propio que se descarga con la primera foto (y el service worker lo precachea).
- **Topes** (`DEFAULT_PHOTO_LIMITS` en `process.ts`): foto de 1600 px de lado mayor y menos de 300 000 bytes; miniatura de 400 px de lado mayor, sin recortar (la tarjeta la recorta con `object-fit: cover`, cuadrada en la lista y 4:3 en la cuadrícula) y menos de 30 000 bytes. La calidad empieza en 0,8 (0,75 la miniatura); si no cabe, prueba la mínima (0,5 y 0,45) y afina por bisección; si ni la mínima cabe, reduce las dimensiones. Como mucho 8 codificaciones por imagen; si no llega, devuelve la más ligera con `withinBudget: false`.
- **Entrada:** hasta 50 MB y 50 megapíxeles (un JPEG de 48 MP del iPhone cabe). El formato y el tamaño se leen de los primeros bytes, así que una imagen enorme se rechaza sin decodificarla. Se reduce por mitades, sin ningún lienzo mayor que la mitad del original (el tope de iOS es de 16,7 MP por lienzo).
- **Formato:** WebP donde el navegador lo codifica de verdad (Chrome, Edge, Firefox) y JPEG en Safari (macOS e iOS), que pide WebP y devuelve PNG sin avisar. Se averigua una vez por sesión codificando un lienzo de 2 × 2 y mirando el tipo y la firma del resultado, sin mirar el user agent.
- **Privacidad:** se devuelve siempre una imagen recodificada, nunca el archivo original, aunque ya sea pequeño. Al recodificar se pierden EXIF (cámara, fecha, GPS, miniatura embebida), XMP, IPTC y las imágenes adicionales (MPF). Cada resultado se inspecciona (`findMetadata()` en `metadata.ts`, sobre los bytes de JPEG y WebP); si llevara algo, se retira con `stripMetadata()` y se vuelve a comprobar. Solo queda el perfil de color ICC que escribe el navegador, que no identifica a nadie.
- **Orientación:** los navegadores actuales ya giran la foto según EXIF al decodificarla (`createImageBitmap`, Chrome 52, Firefox 93, Safari 15). Una prueba de una vez por sesión (un JPEG de 2 × 1 con orientación 6) lo confirma; solo si el navegador no gira, gira el módulo. Así nunca se gira dos veces.
- **Sin bloquear la interfaz:** `createImageBitmap` decodifica fuera del hilo principal, se dibuja en `OffscreenCanvas` donde existe y se cede el hilo entre pasos. Medido en Chrome 157 de escritorio (Mac): una foto de 12 MP tarda 180-400 ms con una sola tarea larga de unos 190 ms la primera vez y ninguna después; una de 48 MP, 360 ms con una tarea larga de 107 ms. No compensa un Web Worker.
- **Limitaciones por navegador:** HEIC solo lo abre Safari 17 o posterior; en Chrome, Edge, Firefox y Android da `unsupported-format` con un mensaje que lo explica. En el iPhone, al elegir de la galería con `accept="image/*"`, Safari entrega normalmente un JPEG (convierte el HEIC), según los informes de WebKit; falta comprobarlo en un iPhone real (#84). Safari siempre genera JPEG, algo más pesado que WebP a la misma calidad.
- **Prueba a mano:** fuera de producción, la sección "Fotos" de `/muestra` deja elegir una foto (o hacerla con la cámara en el celular) y muestra el original, el formato, las dimensiones, el peso y la calidad de la foto y la miniatura, los intentos, el tiempo y los metadatos que quedan. Es la que sirve para la prueba en iPhone y Android (#84).
- **Pruebas:** jsdom no tiene canvas, así que la lógica pura (tamaños, orientación, búsqueda de calidad, formato, metadatos, errores) se prueba directamente y la orquestación con un doble de la capa del navegador (`ImageBackend`). Los accesorios de `src/photos/fixtures/` son imágenes sintéticas de 48 × 32 px, entre ellas un JPEG con EXIF, GPS inventado y orientación 6, y un WebP con EXIF y XMP.

### Campo de foto y subida

El registro y la edición usan la galería desde el #221 (ver [Registro de una planta](coleccion-y-registro.md#registro-de-una-planta) y `docs/piezas-de-interfaz.md`). `PhotoField` (`src/photos/PhotoField.tsx`, #82), el campo de una sola foto (elegir, vista previa, reemplazar y quitar), queda para la sección "Fotos" de `/muestra`, la de la prueba a mano en el iPhone y en Android (#84). Prepara la foto con el módulo anterior y la entrega ya preparada; no sube nada.

```tsx
import { PhotoField, type PhotoFieldValue } from '../photos/PhotoField.tsx'
import { uploadPhotoFiles } from '../photos/upload.ts'
import { usePhotoUpload } from '../photos/usePhotoUpload.ts'

const [foto, setFoto] = useState<PhotoFieldValue | null>(null)
// { kind: 'new', photo: ProcessedPhoto, fileName } | { kind: 'stored', src } | null
const subida = usePhotoUpload<PlantPhotoPaths>()

<PhotoField
  value={foto}
  onChange={(valor) => { subida.reset(); setFoto(valor) }}
  upload={subida.state}            // opcional: lo muestra con "Reintentar" y "Cancelar subida"
  onRetryUpload={() => void subida.retry()}
  onCancelUpload={subida.cancel}
/>

if (foto?.kind === 'new') {
  const files = foto.photo
  await subida.start(({ signal, onProgress }) =>
    uploadPhotoFiles(files, { userId, plantId, signal, onProgress }))
}
```

- **Cámara y galería:** en el celular, dos botones: "Tomar foto" abre un `<input type="file" accept="image/*" capture="environment">` y "Elegir de la galería", uno sin `capture`. Con `capture`, iOS y Android abren directamente la cámara trasera. Sin él, el iPhone muestra su menú (fototeca, hacer foto, elegir archivo), pero Chrome en Android 14 y 15 abre el selector de fotos del sistema, que muchas veces ya no ofrece la cámara; por eso hay un botón para cada cosa. Los navegadores de escritorio ignoran `capture` (es una pista, según MDN), así que donde el puntero principal no es táctil (`(pointer: coarse)` no se cumple) queda un solo botón, "Elegir foto". La prop `camera` (`'auto' | 'show' | 'hide'`) lo fuerza. La galería del registro sigue la misma regla, con `useTouchDevice` (puntero grueso o `maxTouchPoints`).
- **Estados:** preparando (con "Cancelar"), lista (con el peso) y error con el texto del motivo (formato no admitido, HEIC, no es una imagen, demasiado grande...). Los estados se anuncian en una región `role="status"` y los errores en `role="alert"`. Mientras se prepara o se sube, los botones quedan con `aria-disabled` en vez de `disabled`, para no perder el foco.
- **Foco:** al quitar la foto, o al cancelar o terminar cuando el botón con el foco desaparece, el foco vuelve al primer botón de elegir. Todo funciona con el teclado; los `<input type="file">` están ocultos, fuera del orden de tabulación y del árbol de accesibilidad, y los abren los botones.
- **Vista previa:** una URL de objeto de la foto preparada, que se revoca al cambiar de foto, al quitarla y al desmontar. La caja es de 4:3 fija, así que la vista previa no mueve nada al aparecer.

Subida (`src/photos/upload.ts`), sobre una interfaz mínima del bucket (`PhotoStorage`, en `storage.ts`), con un doble en memoria para las pruebas y la página de muestra (`memory-storage.ts`):

- **`uploadPhotoFiles(files, { userId, plantId, signal, onProgress })`:** sube la foto y la miniatura a la vez con la [convención de rutas](../../supabase/README.md#fotos-de-plantas-storage) (`src/photos/paths.ts`): `<usuario>/<planta>/photo-<versión>.<webp|jpg>` y `thumb-<versión>`, con una versión nueva (`crypto.randomUUID()`) por foto preparada y la misma en sus reintentos. El tipo de contenido es el del Blob (con un Blob, supabase-js envía un formulario y Storage toma el tipo de la parte del archivo, no de `contentType`) y la caché es de un año (`cacheControl: '31536000'`): las rutas llevan versión y nunca cambian de contenido. Sin `upsert`; si la ruta ya existe (409), se da por subida, porque solo puede ser un intento anterior de esta misma foto cuya respuesta se perdió. Si falla una de las dos, borra las dos rutas antes de rechazar. La usa `uploadPlantPhotos` para cada foto de la galería.
- **Progreso:** archivos y bytes terminados (`UploadProgress`); storage-js no da el progreso de cada petición.
- **Cancelar:** storage-js no deja abortar una subida (`upload` no acepta `AbortSignal`). Al cancelar se deja de esperar enseguida (rechaza con `aborted`) y, cuando terminan las peticiones en curso, se borra lo que haya llegado. El reintento usa otra versión para que ese borrado tardío no se lleve sus archivos.
- **Errores** (`PhotoStorageError`, con `reason` y `message` en español): `offline`, `session-ended`, `too-large` y `unsupported-type` (rechazo del bucket por el tope de 1 MiB o el tipo), `forbidden` (políticas), `not-found`, `too-many-photos`, `position-taken`, `failed` y `aborted`. Storage a veces responde 400 con el código real en `statusCode` (`"413"`, `"403"`); se mira ese también. `uncertain` indica que la petición salió y no hubo respuesta, así que no se sabe si se aplicó.
- **Reintentar sin volver a elegir ni preparar la foto:** `usePhotoUpload()` guarda la última tarea y `retry()` la vuelve a lanzar con la misma foto ya preparada. Con la sesión terminada o la planta borrada no se ofrece "Reintentar" (`canRetryUpload`).

`replacePlantPhoto` y `removePlantPhoto` (una foto por planta, escribiendo las rutas en `plants`) y `PlantPhotoRecords.setPhotoPaths` se retiraron en el #221: ya no los usaba nada. Las versiones de la app ya instaladas que aún escriben esas columnas siguen funcionando, porque la base lo refleja en la foto principal de `plant_photos`. En `/muestra`, sección "Fotos", el campo sube a un bucket simulado en memoria (la página no tiene sesión de Clerk ni usa Supabase), con las rutas reales y la opción de simular un fallo de red, de la miniatura o de tamaño para ver el reintento.

### Bitácora del ejemplar

En la ficha (#267, parte del #263), a todo el ancho bajo los datos y las notas: `src/detail/PlantLogSection.tsx` (la sección) y `src/log/` (datos, registro y diálogo). La tabla y las funciones de la base están en [«Bitácora»](../../supabase/README.md#bitácora) del README de Supabase.

- **Lista:** del más reciente al más antiguo, de 20 en 20 con «Cargar más» (`list_plant_log_entries` con el cursor `created_at` e `id` del último, el `created_at` como texto tal como llegó). Cada registro: el icono y el nombre del tipo, el título, la fecha y la hora locales en formato corto («23 nov 2026, 7:40») y, solo si existen, la descripción, la miniatura de la foto (abre el visor, `PhotoLightbox`) y «Floración observada: sí/no». Filtro por actividad (un desplegable, como la maqueta de la ficha). Estados: cargando, sin registros, filtro sin resultados («Ver todas») y error con «Reintentar».
- **Añadir registro** (`AddLogEntryDialog.tsx`, en su propio chunk, pedido al montar la sección): diálogo en escritorio y pantalla completa hasta 720 px, con el nombre y el identificador del ejemplar arriba. Tipo (obligatorio), título (hasta 120), descripción (hasta 2000), una foto opcional (preparada como las de la galería, sin metadatos, en `<usuario>/<planta>/log/`; no cuenta en las seis) y la floración observada (Sin indicar, Sí, No), que **no cambia** el estado de la planta ni «en flor» de sus fotos. Cerrar con algo escrito pregunta antes de descartar.
- **Sin duplicados ni archivos sueltos** (`src/log/save.ts`): la clave de reintento se genera una vez al abrir el formulario y la base devuelve el registro ya creado si un intento anterior llegó a guardarlo; la foto preparada tiene su versión fija (mismas rutas al reintentar). Si el registro falla con seguridad, la foto subida se borra; si falla en la duda (respuesta perdida o error del servidor), se queda por si el registro la cita, y la limpia el script de fotos huérfanas («sin-registro»).
- **Tras guardar,** el registro queda arriba; si el filtro lo escondería, se quita y se dice. El foco vuelve a «Añadir registro» y se anuncia una vez.
- **Eliminar un registro:** papelera con confirmación; borra la fila y después su foto (si la foto no se puede borrar, queda para el script, sin error). El foco pasa al registro siguiente o, si no queda ninguno, a «Añadir registro». Editar un registro no se ofrece.
- **Sin conexión** no hay copia en el dispositivo: la sección lo dice y «Añadir registro» y eliminar quedan desactivados con el motivo. Lo ya leído se sigue viendo.
- **Imágenes:** con la descarga autenticada por ruta de siempre (`usePlantImage`), no con URL firmadas (ver abajo por qué).
- **Pruebas:** `src/log/*.test.ts` (datos y guardado con los dobles en memoria), `src/detail/PlantLogSection.test.tsx` (lista, filtro, «Cargar más», estados, diálogo, eliminar, sin conexión y axe) y `e2e/bitacora.spec.ts` (con y sin foto, orden y filtros, reintento sin duplicar, cancelar sin archivos, eliminar, sin conexión, teclado, celular con el teclado abierto, eliminar la planta con las fotos de su bitácora, y 360 y 1440 px con axe).

### Lectura de fotos y borrado sin huérfanos

El bucket es privado (#83): las imágenes no tienen una dirección pública. Hay dos formas de leerlas: URL firmadas (`createSignedUrls`, una petición firma muchas rutas) o descarga autenticada a `Blob` (`download`, con el token de la sesión). La app usa la **descarga autenticada, guardada por ruta**:

- Una URL firmada caduca y cambia en cada firma: el navegador la trata como otra dirección y la vuelve a bajar en cada sesión, y la caché sin conexión del #18 no puede usarla como clave. Firmar en lote ahorra una petición por imagen, pero las imágenes se bajan igual una a una.
- La ruta es una clave estable y su contenido nunca cambia (lleva la versión). Cada miniatura se baja una vez por dispositivo: queda en memoria mientras dura la pestaña y en **Cache Storage**, en una caché por usuario (`orki-miniaturas-v1:<usuario>`) con clave `/_orki/plant-photos/<ruta>` (una dirección del propio origen que nadie sirve). Desde la segunda visita, una lista de cientos de miniaturas no hace ninguna petición, y Cache Storage se lee sin red y también desde el service worker, que es lo que necesita el #18.
- Las descargas van como mucho de 6 en 6. Cada imagen se muestra con una URL de objeto que se revoca 30 s después de que ninguna pantalla la use (así no se recrea al desplazarse arriba y abajo).
- Al cambiar de usuario o cerrar sesión, `CollectionProvider` llama a `forgetPlantImagesExcept(usuario)`: vacía la memoria y borra de Cache Storage las miniaturas de los demás usuarios.

La estrategia vive en `src/photos/read.ts` detrás de `PlantImageSource` (`acquire(ruta, 'thumbnail' | 'photo')` devuelve una URL de objeto y `release(ruta)` la suelta) y de `PersistentImageCache`. Las pantallas solo usan los hooks de `src/photos/usePlantImage.ts`, así que el #18 puede cambiarla (por ejemplo, que el service worker sirva la caché) pasando otra fuente con `<PlantImagesContext value={...}>`, sin tocarlas:

```ts
const miniatura = usePlantImage(plant.thumbnailPath, 'thumbnail', visible)
const foto = usePlantImage(foto.photoPath, 'photo') // visor del detalle (#183), bajo demanda
// { status: 'none' | 'loading' | 'error' } o { status: 'ready', src }
```

- **Inventario:** `PlantCard` usa `usePlantThumbnail(plant, ref)` (`src/inventory/usePlantThumbnail.ts`), que pide solo `thumbnailPath`, nunca la foto grande, y solo cuando la tarjeta está en pantalla o a menos de 300 px (`useNearViewport`, con `IntersectionObserver`). Mientras carga o si falla, el marcador neutro del sistema, con un texto alternativo que lo dice ("Foto de _Cattleya labiata_: cargando"); la caja de la foto tiene proporción fija, así que la imagen no mueve nada al llegar. Tras un fallo se reintenta al volver la conexión (evento `online`) o al volver a montar la tarjeta: el fallo no se guarda. Las plantas sin foto siguen con "Sin foto".
- **Foto grande:** `usePlantImage(foto.photoPath, 'photo')` la baja bajo demanda, solo en el visor del detalle (#183), y la guarda solo en memoria (no ocupa Cache Storage). En la página del detalle se ven las miniaturas. La galería de la edición pide solo las miniaturas (`useStoredThumbnails`, con la misma fuente).

Sin huérfanos:

- **Quitar una foto de la galería** (`removeStoredPlantPhoto`) borra su fila y después sus dos archivos (ver [Varias fotos por planta](#varias-fotos-por-planta-api-de-datos)).
- **Eliminar una planta** (lo llamará el #16): `deletePlantWithPhotos({ userId, plantId, onPlantRemoved: removePlant })` (`src/photos/delete.ts`) borra primero la fila, la quita de la colección y después toda la carpeta `<usuario>/<planta>/` y su subcarpeta `log/` con las fotos de la bitácora (`deletePlantPhotoFolder`, que también se lleva restos de subidas anteriores; listar en Storage devuelve solo el primer nivel, por eso `log/` se lista aparte, #267). Si falla el borrado de la planta no se toca nada; si fallan los archivos, la planta ya no existe y devuelve `photosDeleted: false`.
- **Script de limpieza:** un fallo de red a mitad puede dejar archivos sin planta. `npm run fotos:huerfanas -- --ambiente desarrollo` los lista (modo de prueba, por defecto) y con `--borrar` los borra; da por usado todo archivo que citen `plants` o `plant_photos`, así que no se lleva las fotos secundarias. Ver [su sección](../../supabase/README.md#limpieza-de-fotos-huérfanas) en el README de Supabase.
- **Varias fotos:** eliminar una planta o la cuenta borra también las fotos secundarias: están en la misma carpeta `<usuario>/<planta>/` y sus filas de `plant_photos` se van con la planta (`on delete cascade`). Lo prueban `src/photos/delete.test.ts`, `src/account/supabase-effects.test.ts` y `e2e/edicion.spec.ts`. Las fotos de la bitácora (`<usuario>/<planta>/log/`) también se borran: la eliminación de la cuenta recorre un nivel más de carpetas y la de la planta lista `log/` aparte; lo prueban las dos pruebas unitarias y, para la planta, `e2e/bitacora.spec.ts`.

### Varias fotos por planta: API de datos

Desde el #182 una planta tiene de 0 a 6 fotos en `public.plant_photos` (ver [Varias fotos por planta](../../supabase/README.md#varias-fotos-por-planta) en el README de Supabase). El #219 dejó la capa de datos y el formulario con galería (#221) la usa al registrar y al editar. Las columnas `photo_path`, `thumbnail_path` y `photo_in_bloom` de `plants` siguen siendo la copia de la principal (la de `position` más baja), que la base mantiene en los dos sentidos: la tarjeta del inventario no cambia, y las versiones de la app ya instaladas que escriben en `plants` (el formulario de una foto, retirado en el #221) siguen funcionando, porque la base lo refleja en la principal.

Módulos (`src/photos/`), con la misma separación que la subida de una foto:

- `gallery.ts`: las operaciones (`uploadPlantPhotos`, `listPlantPhotos`, `removeStoredPlantPhoto` y, para el detalle (#183), `updatePlantPhoto`, `reorderPlantPhotos`, `orderWithMain`, `orderWithMove` y `checkPlantPhotoDetails`).
- `photo-rows.ts`: `PlantPhotoRows`, el acceso a `plant_photos` con PostgREST (`appPlantPhotoRows()`; `insertMany` y `removeMany` crean o borran varias filas en una sola petición, #285), `StoredPlantPhoto` (la fila con nombres de la app) y la traducción de errores (`photoRowError`). Tipos y alias de la tabla en `src/lib/database.ts` (`PlantPhoto`, `PlantPhotoInsert`, `PlantPhotoUpdate`).
- `memory-photo-rows.ts`: el doble en memoria con las reglas de la base (dueño, carpeta de las rutas, posiciones de 0 a 5 sin repetir, copia de la principal a la planta) y fallos a voluntad, también «después de aplicar». Lo usan las pruebas; sirve para la página de muestra.
- `MAX_PLANT_PHOTOS` (6) está en `paths.ts`; `MAX_PARALLEL_PHOTO_UPLOADS` (3), `eachLimited` y `serialQueue`, en `limited.ts`.

| Función                                                                                            | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Errores                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploadPlantPhotos(fotos, { userId, plantId, signal, onProgress, onPlantUpdated, storage, rows })` | Sube las fotos ya preparadas (`{ files, inBloom?, takenAt?, note? }`, con `files` = `ProcessedPhoto`) a una planta que ya existe, en el orden dado (los archivos de tres fotos en tres y las filas de una en una, #285), y crea su fila con su `position`. Con `knownPhotos` (las que ya tiene, sabidas por la base: `[]` para la planta recién insertada) no las vuelve a leer. Sirve para registrar y para añadir en la edición. Devuelve `{ results, photos, complete, plant }`. | Rechaza sin subir nada si no puede leer las fotos de la planta, si la señal ya está cancelada o si no caben (`too-many-photos`, contando las guardadas). Después resuelve siempre, con un resultado por foto: `uploaded` (`reused` si ya estaba), `failed` (con su `PhotoStorageError`) o `skipped` (cancelada antes de empezarla). |
| `listPlantPhotos({ userId, plantId, rows })`                                                       | Las fotos de la planta en orden (`StoredPlantPhoto[]`, la principal primero).                                                                                                                                                                                                                                                                                                                                                                                                       | `PhotoStorageError` (`offline`, `session-ended`...).                                                                                                                                                                                                                                                                                |
| `removeStoredPlantPhoto({ userId, plantId, photo, onPlantUpdated, storage, rows })`                | Quita una foto guardada: borra la fila (si era la principal, la base promueve la siguiente), relee la planta para la colección y borra sus dos archivos. Devuelve `{ photosDeleted, leftovers, plant }`.                                                                                                                                                                                                                                                                            | Si falla el borrado de la fila, rechaza y no toca los archivos. Si fallan los archivos, la foto ya no está y devuelve `photosDeleted: false` con las rutas en `leftovers` (para el script de limpieza).                                                                                                                             |
| `updatePlantPhoto({ userId, plantId, photo, main, changes, onPlantUpdated, rows })`                | Cambia `takenAt`, `note` o `inBloom` de una foto (solo las claves pasadas; la nota sin espacios a los lados, vacía `null`). Si cambia «en flor» de la principal (`main`), relee la planta. Devuelve `{ photo, plant }`.                                                                                                                                                                                                                                                             | Lo que no cumple las reglas (`checkPlantPhotoDetails`: fecha no posterior a hoy, nota de hasta 500 caracteres) rechaza con `failed` sin enviar nada; `not-found` si la foto ya no está; `offline`, `session-ended`.                                                                                                                 |
| `reorderPlantPhotos({ userId, plantId, photos, order, onPlantUpdated, rows })`                     | Pone las fotos en el orden `order` (los mismos ids; `orderWithMain` y `orderWithMove` lo calculan) de una vez: posiciones 0, 1, 2… Si cambia la principal, relee la planta. Mismo orden: no envía nada. Devuelve `{ photos, plant }`.                                                                                                                                                                                                                                               | `position-taken` si las fotos de la planta ya no son las leídas (hay que volver a leerlas); `offline`, `session-ended`, `failed`. Nunca deja la galería a medias.                                                                                                                                                                   |

- **Orden de cada foto: primero los dos archivos y después la fila.** Una fila sin archivo sería una foto rota (si es la principal, la base la copiaría a `plants` y la tarjeta no podría mostrarla); un archivo sin fila no lo ve nadie y lo recoge el script de limpieza pasadas 24 horas. Si falla un archivo, se borran los dos y no se crea la fila. Si la base rechaza la fila, se borran los dos archivos; si ese borrado también falla, quedan para el script. Si no se sabe si la fila llegó (`uncertain`, la red cayó sin respuesta), los archivos se quedan, porque quizá ya los cita: el reintento lo resuelve.
- **Reintento sin duplicados:** cada foto preparada tiene su versión fija (`photoVersionFor`), así que sus rutas son las mismas en cada intento. Antes de subir se leen las filas de la planta y una foto cuya ruta ya está en una fila se da por guardada (`reused: true`): no se sube ni se crea otra fila. Los archivos que ya estaban en el bucket los da por subidos el 409 de Storage. Se puede volver a llamar con todas las fotos o solo con las que fallaron.
- **Posiciones:** la de cada foto se decide en el primer intento y se recuerda (por la foto preparada, como la versión): reintentar la vuelve a usar si sigue libre, así una foto que falló a mitad del registro conserva su lugar. Una foto nueva va a la primera posición libre detrás de la última ocupada y, si al final ya no queda sitio, a la primera libre. Si otra foto (otro dispositivo) ocupa la posición entre la lectura y la escritura, la base responde `23505` (`position-taken`) y se prueba una vez con otra libre; si no queda ninguna, la foto falla con `too-many-photos` y sus archivos se borran.
- **Máximo de 6:** se comprueba antes de subir, contando las ya guardadas; lo garantiza además la base (`position` de 0 a 5 y única por planta).
- **Progreso** (`onProgress`): `{ index, completed, total, step }`, con `step` `uploading` (y `files`, el `UploadProgress` de sus dos archivos), `saving` (creando la fila) o `done` (y `result`).
- **Cancelar** (`signal`): las fotos en curso (hasta tres) dejan de esperarse (lo que llegue a subirse se borra al terminar, como en `uploadPhotoFiles`) y quedan `failed` con `aborted`, también la que ya subió y esperaba su turno para la fila; las que no empezaron, `skipped`. Una fila que ya salió hacia la base se espera. El reintento usa otra versión para la cancelada y la misma posición.
- **La planta de la colección:** la base copia la principal a `plants`, pero la planta en memoria no se entera. Si la principal o el número de fotos cambian (al subir fotos o al quitar una), se relee la planta y se pasa a `onPlantUpdated` (conéctalo con `useCollection().upsertPlant`); así `photoCount` sigue al día (#184). Si esa lectura falla no es un error: la base ya está bien y la colección lo verá en la próxima lectura.
- **Leer las imágenes:** con las rutas de cada `StoredPlantPhoto`, con los mismos hooks y la misma caché que el resto (`usePlantImage(foto.thumbnailPath, 'thumbnail')` para la cuadrícula y `usePlantImage(foto.photoPath, 'photo')` para verla en grande).
- **Reordenar va por una función de la base** (`reorder_plant_photos`, migración `20261124100000_reordenar_fotos.sql`): la unicidad de `(plant_id, position)` es diferible y con seis fotos no queda ninguna posición libre de paso, así que elegir la principal o mover una foto se hace en una sola sentencia. Recibe los ids de todas las fotos en el orden nuevo; solo el dueño; una lista que no sea exactamente la de la planta se rechaza.
- **Errores nuevos de `PhotoStorageError`:** `too-many-photos` («Una planta puede tener como mucho 6 fotos…», sin «Reintentar»: `canRetryUpload` lo excluye) y `position-taken`, que la galería resuelve sola o traduce a `too-many-photos`.

Registrar una planta con N fotos (#221), con la planta ya insertada como hoy:

```ts
import { uploadPlantPhotos } from '../photos/gallery.ts'

// fotos: las de la galería en su orden, ya preparadas (ProcessedPhoto)
const fotos = galeria.map(({ photo, inBloom }) => ({ files: photo, inBloom }))
const tarea = ({ signal, onProgress }) =>
  uploadPlantPhotos(fotos, {
    userId,
    plantId,
    signal,
    onProgress,
    onPlantUpdated: upsertPlant,
  })

const { results, complete } = await tarea({ signal, onProgress })
if (!complete) {
  // La planta y las fotos guardadas se conservan. Mostrar cuáles fallaron
  // (results[i].status === 'failed', con results[i].error.message) y ofrecer
  // "Reintentar", que vuelve a llamar con las mismas fotos: no duplica nada.
  const faltan = fotos.filter((_, i) => results[i].status !== 'uploaded')
  await uploadPlantPhotos(faltan, {
    userId,
    plantId,
    onPlantUpdated: upsertPlant,
  })
}
```

Editar la galería de una planta ya guardada:

```ts
import {
  listPlantPhotos,
  removeStoredPlantPhoto,
  uploadPlantPhotos,
} from '../photos/gallery.ts'

const guardadas = await listPlantPhotos({ userId, plantId }) // en orden; la primera es la principal

// Quitar una (si es la principal, pasa a serlo la siguiente)
const { photosDeleted } = await removeStoredPlantPhoto({
  userId,
  plantId,
  photo: guardadas[0],
  onPlantUpdated: upsertPlant,
})

// Añadir: van detrás de las que ya tiene; 'too-many-photos' si no caben
await uploadPlantPhotos(
  nuevas.map((photo) => ({ files: photo })),
  { userId, plantId, onPlantUpdated: upsertPlant },
)
```

Pruebas: `src/photos/gallery.test.ts` (0, 1 y 6 fotos, la séptima, fallo de un archivo, rechazo de la fila, limpieza que también falla, reintento con la fila perdida o llegada, cancelación, posición ocupada, añadir, leer en orden, quitar la principal y los fallos al quitar) y `src/photos/photo-rows.test.ts` (consultas y errores de PostgREST). Sin comprobar contra Supabase y Storage reales: lo que la base hace con las filas lo prueban `supabase/tests/fotos_de_plantas.sql` y el Supabase simulado de las pruebas de extremo a extremo.
