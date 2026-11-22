# Fotos de fondo por género

Fotos del fondo dinámico del registro (#13): una por género de acceso rápido,
con el nombre del género en minúsculas (`phalaenopsis.avif`, `cattleya.avif`,
`dendrobium.avif`, `oncidium.avif`, `vanda.avif`). La app las enlaza en
`src/registration/genus-backgrounds.ts`, las pinta bajo el velo `overlay-genus`
(`src/registration/GenusBackdrop.tsx`) y el service worker las precachea
(`globPatterns` de `vite.config.ts`).

Las cinco son las definitivas (#126 y #128). `npm run fondos --workspace=apps/web
-- provisionales` sigue existiendo para generar fondos de prueba al añadir un
género nuevo.

## Fuente y licencia

Cada foto lleva aquí su fuente y su licencia. No se versiona ninguna foto sin
licencia clara que permita usarla en la app.

| Género       | Archivo             | Fuente                                                                              | Licencia                                                                                                                                 |
| ------------ | ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Cattleya     | `cattleya.avif`     | Imagen generada con ChatGPT (OpenAI) a petición del autor del proyecto, 21 nov 2026 | Del autor del proyecto: los términos de OpenAI ceden al usuario los derechos sobre lo generado. No es una fotografía de un ejemplar real |
| Dendrobium   | `dendrobium.avif`   | Imagen generada con ChatGPT (OpenAI) a petición del autor del proyecto, 21 nov 2026 | Del autor del proyecto: los términos de OpenAI ceden al usuario los derechos sobre lo generado. No es una fotografía de un ejemplar real |
| Oncidium     | `oncidium.avif`     | Imagen generada con ChatGPT (OpenAI) a petición del autor del proyecto, 21 nov 2026 | Del autor del proyecto: los términos de OpenAI ceden al usuario los derechos sobre lo generado. No es una fotografía de un ejemplar real |
| Phalaenopsis | `phalaenopsis.avif` | Imagen generada con ChatGPT (OpenAI) a petición del autor del proyecto, 21 nov 2026 | Del autor del proyecto: los términos de OpenAI ceden al usuario los derechos sobre lo generado. No es una fotografía de un ejemplar real |
| Vanda        | `vanda.avif`        | Imagen generada con ChatGPT (OpenAI) a petición del autor del proyecto, 21 nov 2026 | Del autor del proyecto: los términos de OpenAI ceden al usuario los derechos sobre lo generado. No es una fotografía de un ejemplar real |

Al cargar una definitiva, se sustituye su fila por la fuente (URL de la página
de la foto y autor) y la licencia exacta (por ejemplo, CC BY-SA 4.0), con la
atribución que pida la licencia.

## Formato objetivo

- **Recorte:** vertical 9:16, centrado en la flor, pensado para celular.
- **Tamaño:** 720 × 1280 píxeles. Bajo el velo al 85 % no se aprecia más
  detalle, y en pantallas anchas la foto se amplía con `background-size: cover`.
- **Formato:** AVIF (lo leen Chrome, Edge, Firefox y Safari 16 o posterior; si
  un navegador no puede, se queda el fondo neutro).
- **Peso:** menos de 100 KB cada una; lo normal con estas medidas es entre 30 y
  80 KB. La prueba de contraste falla si alguna pasa de 100 KB.

## Cómo sustituir una foto

1. Partir de la foto original con su licencia ya comprobada (JPEG, PNG, HEIC o
   TIFF, de al menos 720 × 1280 píxeles útiles en vertical).
2. En un Mac (usa `sips`, la herramienta de imágenes del sistema):

   ```sh
   npm run fondos --workspace=apps/web -- preparar phalaenopsis ~/Descargas/phalaenopsis-original.jpg
   ```

   Recorta al centro en 9:16, reduce a 720 × 1280, codifica en AVIF bajando la
   calidad (de 60 a 30) hasta quedar por debajo de 100 KB, guarda
   `phalaenopsis.avif` aquí y actualiza `medidas.json` (peso, huella SHA-256 y
   colores de la zona más clara y de la más oscura). Si el recorte central deja
   la flor fuera, recortar antes a mano a 9:16 y pasar ese archivo.

   Sin Mac: preparar la foto con otra herramienta (Squoosh, `avifenc`) con el
   mismo recorte, tamaño y peso, copiarla aquí con su nombre y medirla después
   en un Mac con `npm run fondos --workspace=apps/web -- medir`.

3. Actualizar la fila de la tabla de arriba con su fuente y su licencia.
4. Pasar las pruebas: `npx vitest run src/registration/genus-backdrop-contrast.test.ts`
   (desde `apps/web`). Comprueban que cada foto pesa menos de 100 KB, que
   `medidas.json` corresponde a la foto versionada y que el texto del formulario
   cumple contraste AA sobre el velo en su zona más clara y en la más oscura.
5. Revisar a ojo en `/muestra` (sección «Formulario de registro») y en el
   celular que la flor se reconoce y el formulario se lee bien.

## Cómo se mide el contraste

`medir` reduce la foto ya codificada a 180 × 320 (cada muestra es una zona de
4 × 4 píxeles de la foto, unos 2 × 2 px de pantalla en un celular) y se queda
con la muestra de mayor y la de menor luminancia relativa. La prueba compone el
velo `overlay-genus` sobre cada una como lo hace el navegador (mezcla en sRGB)
y exige 4,5:1 a los textos y 3:1 a los bordes que el formulario pinta
directamente sobre el fondo (`BACKDROP_FOREGROUNDS` en
`src/styles/contrast.ts`). Con el velo al 85 %, incluso sobre negro puro el
peor caso (texto `color-danger`) queda en 4,9:1.

Añadir un género con foto: añadir su archivo aquí y su entrada en
`src/registration/genus-backgrounds.ts`; la prueba exige que coincidan.
