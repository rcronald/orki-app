# Procedencia y licencia de la muestra de pruebas

`muestra-col26.10xr.tsv` contiene 49 filas reales, completas y en el orden original, de la exportación de ChecklistBank del **Catalogue of Life eXtended Release COL26.10 XR** (clave `316691`). Se extrajeron el 20 de noviembre de 2026 del archivo `https://api.checklistbank.org/dataset/316691/export.zip?format=ColDP` (SHA-256 `6f2a6b6a645ea8306cea2149027c84dd7f08cd781b1079c5aee453a0a13adc73`), descargado una sola vez fuera del repositorio. La cabecera es la del archivo original.

`esperado-muestra.json` es la salida de la CLI sobre esa muestra, revisada a mano. Se regenera, si cambian las reglas a propósito, con:

```sh
uv run orki-catalogo tests/data/muestra-col26.10xr.tsv --salida tests/data/esperado-muestra.json
```

## Licencia y cita

Los datos tienen licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Cita de la versión:

> Bánki, O., Roskov, Y., Döring, M., Ower, G., Hernández Robles, D. R., Plata Corredor, C. A., Stjernegaard Jeppesen, T., Örn, A., Pape, T., Hobern, D., Garnett, S., Little, H., DeWalt, R. E., Miller, J., Orrell, T., Aalbu, R., Abbott, J., Abreu, C., Acero P, A., et al. (2026). Catalogue of Life (2026-10-16 XR). Catalogue of Life Foundation, Amsterdam, Netherlands. https://doi.org/10.48580/dgzlf

La mayoría de los nombres de orquídeas proceden de la WCVP: Govaerts, R. (2026). The World Checklist of Vascular Plants (WCVP) (16.0). The Royal Botanic Gardens, Kew, London, United Kingdom. https://doi.org/10.48580/d4nz

## Modificaciones

La muestra es un extracto (49 de 8 504 545 filas). Solo se modificó una fila a propósito:

- `7THCP` (_Cattleya bullieri_ Carrière): se añadieron espacios sobrantes al nombre (`␣␣Cattleya␣␣␣bullieri␣`) y a la autoría (`Carrière␣␣`), para probar la limpieza de espacios. En el archivo original no hay ningún nombre de Orchidaceae con espacios sobrantes.

## Casos que cubre

| Caso                                                 | Filas                                                                                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Especie aceptada con sinónimos                       | `4FR2J` _Phalaenopsis amabilis_ con `7VKDG`; `RWFC` _Cattleya labiata_ con `7THCP`                                                                    |
| Sinónimo ambiguo                                     | `7VX9T` _Epidendrum amabile_ → `4FR2J`                                                                                                                |
| Sinónimo de rango inferior                           | `7Z22G` _Cattleya labiata_ f. _alba_ y `KZT8K` (rango «infraspecific name») → `RWFC`                                                                  |
| Sinónimo de un infraespecífico aceptado (reasignado) | `7YX7Y` y `7XWJL` → subespecie aceptada `7YKK5` → `4FR2J`                                                                                             |
| Infraespecíficos aceptados                           | `7YKK5` (subespecie) y `VCLHC` (forma colgada del género, con su sinónimo `VCLHB` sin especie de destino)                                             |
| Nombre mal aplicado                                  | `8X2QV` «_Phalaenopsis amabilis_ Lindl.» → `4FR2M` _Phalaenopsis aphrodite_                                                                           |
| Provisional y sus sinónimos                          | `VJRY8` _Epipactis atrorubens_ (además cuelga de _Goodyera_ `8VXXY`, género del nombre distinto del padre), con `7VYRH` y `7Z2JG`                     |
| Nombre repetido                                      | `6CJK4` y `N8D5X` _Dendrobium thyrsiflorum_ (aceptada y provisional); `3L28J` y `3L28K` _Herminium alpinum_; `7Z22G` y `M9K5Q` _C. labiata_ f. _alba_ |
| Sinónimo igual al nombre aceptado                    | `7SXQ6` _Bulbophyllum fletcherianum_ Rolfe → `8W7QM` _B. fletcherianum_ J.G.Fowler                                                                    |
| Híbrido natural (nothoespecie)                       | `4FR3H` _Phalaenopsis_ × _intermedia_                                                                                                                 |
| Género híbrido (nothogénero)                         | `8VTQS` × _Anacamptorchis_ con `66JFS`; `8VVQS` × _Brassocattleya_ con `M592X` (nombre sin «×»); `69FQ` _Orchiserapias_ con `L2GFV` (nombre con «×»)  |
| Fórmula «A × B»                                      | `VQSPG` (con «×», colgada de la familia), `VQQXL` (con «x» latina), su sinónimo `R8WB3` y el sinónimo fórmula `VQQMR`                                 |
| Registros sin rango                                  | `BOLD.AAM4945` (BOLD) y `SH1132364.10FU` (UNITE)                                                                                                      |
| Otra familia                                         | `56YBS` _Tillandsia usneoides_ (Bromeliaceae) y `DPL`, la fila de la propia familia, que trae `col:family` vacía                                      |
| Sinónimos de rango género y familia                  | `8VXDV` _Epipactis_ Ség. y `LLFHH` Apostasiaceae                                                                                                      |
| Géneros sin especies importadas                      | `8VXXY` _Goodyera_ y `8VTQR` _Anacamptis_ (en la muestra)                                                                                             |
| Espacios y autoría                                   | `7THCP` (modificada, ver arriba); las autorías van aparte del nombre en todas las filas                                                               |
