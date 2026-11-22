# Foto y dibujo de la portada

Imágenes del Hero de la portada (`/`, #179): la foto de la derecha y el dibujo
botánico decorativo de la izquierda. La app enlaza la foto en
`src/pages/HeroPhoto.tsx`; desde el rediseño (#200) el dibujo no se usa en la
portada (sigue aquí y en el design system).

## Fuente y licencia

| Archivo                                            | Fuente                                                                                                                | Licencia                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `original.jpg` y `portada-*.avif`, `portada-*.jpg` | Entregada por el responsable del proyecto en el design system (`assets/Photos/portada.png`, 1536 × 1024), 22 nov 2026 | **Pendiente de confirmar** el origen exacto y la licencia |
| `dibujo-botanico.svg`                              | Design system de orqui.apps (`assets/Illustrations/DibujoBotanico.svg`), copiado tal cual                             | Del proyecto                                              |

Cuando se confirme el origen de la foto (autor, página y licencia exacta, por
ejemplo CC BY-SA 4.0), se anota aquí con la atribución que pida la licencia.

## Archivos

- `original.jpg`: versión de trabajo de la foto entregada (JPEG de calidad 90,
  1536 × 1024, 433 KB). El PNG entregado pesa 2,2 MB y no se versiona.
- `portada-648.avif`, `portada-960.avif`, `portada-1296.avif` y
  `portada-1536.avif`: recorte 3:2 en cuatro anchos (el Hero dividido la
  recorta después con `object-fit: cover`: a la altura del bloque en
  escritorio y a 2:1 en celular), de 31 a 118 KB. Se sirven con `srcset` y `sizes`:
  un celular de 390 px a 3x pide la de 1296 (86 KB); a 2x, la de 960 (55 KB).
- `portada-960.jpg`: respaldo para los navegadores sin AVIF (131 KB).
- `foto.json`: lo que lee la app (texto alternativo, nombres y medidas). Va en
  el JavaScript, así que solo lleva eso.
- `medidas.json`: peso, calidad y huella SHA-256 de cada archivo.

Las variantes **no** van en el precaché del service worker (`globIgnores` en
`vite.config.ts`): suman unos 450 KB, más de lo que cabe en el presupuesto de
tamaño, y las pide una visita nueva, que tiene conexión. Sin conexión, la
portada se ve con su texto y el texto alternativo en el hueco de la foto. El
dibujo (SVG, 2 KB) tampoco se precachea: es decorativo y no sale en celular.

## Cómo sustituir la foto

1. Partir de la foto original con su licencia ya comprobada (JPEG, PNG, HEIC o
   TIFF; mejor de al menos 1536 px de ancho en 3:2, porque no se amplía).
2. En un Mac (usa `sips`, la herramienta de imágenes del sistema), una orden:

   ```sh
   npm run portada --workspace=apps/web -- preparar ~/Descargas/portada.png "Texto alternativo de la foto nueva"
   ```

   Guarda la versión de trabajo en `original.jpg`, recorta al centro en 3:2,
   genera los AVIF (bajando la calidad de 60 a 30 si alguno pasara de 150 KB)
   y el JPEG de respaldo, borra los anteriores y reescribe `foto.json` y
   `medidas.json`. Sin texto alternativo conserva el anterior: hay que darlo
   si la foto cambia. Sin foto (`... -- preparar`), regenera las variantes
   desde `original.jpg`. Si el recorte central corta la flor, recortar antes a
   mano a 3:2 y pasar ese archivo.

   Sin Mac: preparar los mismos archivos con otra herramienta (Squoosh,
   `avifenc`), con los mismos nombres, y escribir `foto.json` a mano.

3. Actualizar la tabla de arriba con su fuente y su licencia.
4. Pasar las pruebas (`npx vitest run src/pages/HomePage.test.tsx` desde
   `apps/web`) y revisar la portada a 390 y a 1536 px.
5. Volver a medir la carga (`npm run medir:carga -- --solo inicio`) y anotarlo
   en `docs/medicion-de-carga.md`.
