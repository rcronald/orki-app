# Glosario de la interfaz

Las palabras con las que la app nombra cada cosa (#290). Vale para los
`texts.ts`, los literales de los componentes y las pruebas que los citan. El
índice de la documentación está en el [README](../../README.md#documentación);
el tono y la voz, en el design system ([Marca y design system](design-system.md)).

## Qué palabra va en cada sitio

| Palabra                    | Dónde                                                                                                                                       | Ejemplos                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| «orquídea»                 | Las acciones, la portada y lo general de «Mi colección» y «¿Ya la tengo?».                                                                  | «Registrar orquídea», «Tu orquídea quedó registrada», «No tienes orquídeas perdidas.» |
| «planta»                   | La ficha de una planta (`/coleccion/:id`), su edición y su bitácora.                                                                        | «Editar planta», «Datos de la planta», «Volver a la planta»                       |
| «ejemplar»                 | Solo los recuentos, en masculino.                                                                                                           | «18 ejemplares · 5 géneros», «3 de 12 ejemplares coinciden.», «2 ejemplares perdidos.» |
| «Mi colección»             | La pantalla y la pestaña. Dentro de una frase, «tu colección». Nunca «inventario» en la interfaz (sí en el código: `inventory/`).          | «Volver a Mi colección», «Exportar tu colección a CSV»                            |
| «Tu cuenta»                | El menú de la barra, su opción, la pantalla y los avisos que remiten a ella.                                                                | «Tu cuenta», «entra en «Tu cuenta» para terminar»                                 |
| «el equipo del catálogo»   | Quien valida los nombres propuestos, en todo lo que ve la persona que registra.                                                            | «el equipo del catálogo confirmará el nombre»                                     |

- **«el equipo del catálogo»** y no «un administrador»: ya era el nombre de los
  avisos de las fotos del registro y de la página de privacidad, no supone que
  sea una sola persona y no expone un rol técnico. Dentro del backoffice, que
  solo ven ellos, su rol sigue llamándose «administrador del catálogo»
  («Sin permiso de administrador», «Otro administrador ya resolvió…»).
- **«ficha»** queda para la ficha de una especie del catálogo («Cargando la
  ficha…»). La pantalla de una planta se nombra «la planta»: «Ver la planta»,
  «Abrir la planta para subirlas».
- **Las fotos, en plural** cuando pueden ser varias (hasta seis por planta):
  «con sus datos y sus fotos». En singular solo lo que es una («la foto
  principal», «Añadir foto» de la bitácora, que admite una).
- **El mismo botón, el mismo texto**: «Añadir fotos» en el registro, la
  edición y la ficha; «Así es su especie» sobre la foto de referencia en el
  registro y en la ficha.
- **Un aviso por acción**: tras dar de baja sale solo el aviso de la acción; el
  del estado («Dada de baja: …») sale al cerrarlo o al volver a la ficha. Un
  error que ya tiene título en la pantalla no repite otro en el aviso.
- **Placeholders que caben a 360 px**: lo que no quepa va en la etiqueta o en
  la ayuda, no en el placeholder («Nombre, código o ubicación», «Nombre,
  sinónimo o género»).
- La app es «orqui.app», en minúsculas; «Orki» solo en el código
  ([CLAUDE.md](../../CLAUDE.md)). Se trata de «tú», nunca de «usted».

## Fuera de este glosario

Los textos de la página de privacidad (`src/privacy/`) y la lista del diálogo
de eliminar la cuenta (`account/texts.ts`, `DIALOG_TEXT`) se revisan aparte
(#291). El nombre del archivo exportado es `orqui-app-coleccion-AAAA-MM-DD.csv`.
