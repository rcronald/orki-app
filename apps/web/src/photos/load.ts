// Punto de entrada diferido del procesamiento de fotos. Las pantallas importan
// solo este archivo, que no arrastra nada: process.ts y sus auxiliares van en
// un chunk propio que se descarga al pedir la primera foto (el service worker
// lo precachea con los demás, así que sin conexión también carga).
//
//   const { processPhoto } = await loadPhotoProcessing()
//   const { photo, thumbnail } = await processPhoto(file, { signal })

export function loadPhotoProcessing() {
  return import('./process.ts')
}
