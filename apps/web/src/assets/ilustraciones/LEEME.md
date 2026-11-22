# Ilustración de la cabecera de pantalla

Ilustración en color de la esquina superior izquierda de la cabecera de
pantalla (`PageHeader`, `orki-pagehead__art`, #206): una cattleya rosa con sus
hojas y dos capullos. Es decorativa (`alt=""`): una por pantalla, sin tapar el
texto.

## Origen

| Archivo                                  | Origen                                                                                                                                                                  | Notas                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `cabecera-240.webp`, `cabecera-480.webp` | Imagen generada con IA (OpenAI) a petición del autor del proyecto; entregada en el #194 («Recursos de mi colección», PNG de 1365 × 1152 con transparencia), 22 nov 2026 | No es un dibujo ni una foto de un ejemplar real |

Todas las imágenes del proyecto son generadas con IA (OpenAI). El PNG
entregado (unos 1,5 MB) no se versiona.

## Archivos

- `cabecera-240.webp` (240 × 186, unos 12 KB) y `cabecera-480.webp`
  (480 × 374, unos 31 KB): WebP con transparencia, medidas pares. Se sirven
  con `srcset` y `sizes` (96 px de ancho hasta 720 px y 160 px por encima):
  un celular a 2x pide la de 240; a 3x, y el escritorio a 2x, la de 480.
- `medidas.json`: recorte aplicado, peso, calidad y huella SHA-256 de cada
  variante.

No van en el precaché del service worker (`globPatterns` solo toma
`js, css, html, woff2, avif`): son decorativas y sin conexión la cabecera se
ve igual, sin la ilustración.

## Cómo se prepararon (y cómo sustituirla)

```sh
npm run ilustracion --workspace=apps/web -- ~/Descargas/recursos.png
```

`apps/web/scripts/ilustracion-cabecera.mjs`, con el Chromium de Playwright
(si falta: `npx playwright install chromium`):

1. Quita los restos del fondo: alfa por debajo de 16 a cero y las manchas
   sueltas de menos de 400 px (había varias casi invisibles arriba y a la
   derecha).
2. Limpia el halo claro del contorno: los tres anillos de píxeles junto a la
   transparencia toman el color de los vecinos de más adentro (solo si son
   más claros), sin tocar su alfa.
3. Recorta al contenido y exporta los dos anchos en WebP (calidad 0,8) con
   alto par, y reescribe `medidas.json`.

Revisada sobre el fondo crema de la app (`#FFFCF7`) y sobre verde oscuro: sin
halo visible. Una ilustración nueva debe ser un PNG con transparencia; tras
prepararla, revisar `/muestra` («Mi colección: piezas») a 390 y 1440 px.
