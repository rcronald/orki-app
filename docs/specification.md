# Orki

App web responsive (PWA, mobile-first) para coleccionistas de orquídeas. Este documento es la especificación de la Fase 1 (MVP de inventario) y el contexto base para el desarrollo.

- Repositorio: `orki-app` (monorepo)
- Flujo de ramas: GitHub Flow
- Ambientes: desarrollo y producción
- Idioma de la interfaz en v1: español

## 1. Resumen

Orki permite que cada coleccionista registre las orquídeas que posee y, al adquirir una nueva, sepa al instante si ya la tiene para no comprar especies duplicadas. La Fase 1 se centra solo en ese inventario. El catálogo navegable con filtros, los planes de cuidado y la vinculación NFC quedan para fases posteriores.

## 2. Objetivos y usuarios

Usuarios objetivo: aficionados y coleccionistas con 1 a 100+ orquídeas; viveros pequeños como segundo segmento.

- Responder "¿ya tengo esta?" en menos de 5 segundos desde el celular, estando en la tienda o el vivero.
- Registrar una orquídea nueva en menos de 1 minuto gracias al autocompletado desde el catálogo.
- Cero compras duplicadas por desconocimiento del propio inventario.
- La colección personal requiere cuenta; el catálogo base es consultable sin registro.

## 3. Alcance de la Fase 1

### 3.1 Registro rápido

Puede iniciar desde la cámara (foto primero) o desde el buscador.

| Campo | Tipo | Obligatorio | Comportamiento |
| --- | --- | --- | --- |
| Nombre científico | Texto con autocompletado desde el catálogo base | Sí | Búsqueda tolerante a errores; prioriza nombre científico y muestra sinónimos |
| Género | Chips de acceso rápido: Phalaenopsis, Cattleya, Dendrobium, Oncidium, Vanda. El chip "Otro" abre un buscador sobre todos los géneros del catálogo | Sí | Se marca solo cuando el autocompletado encuentra la especie; si no, lo elige el usuario. Siempre se guarda un género real del catálogo, nunca "Otro" |
| Tipo | Chips: Especie, Híbrido, No sé | Sí | Se marca solo cuando el autocompletado reconoce el nombre; si no, lo elige el usuario |
| Foto | Imagen | No | Compresión en el navegador antes de subir. Opcional en todos los casos, también cuando la especie no se encuentra |
| Fecha de adquisición | Fecha | Sí | Precargada con la fecha del día, editable con un toque |
| Origen | Texto con autocompletado | No | Recuerda las tiendas y viveros ya usados por el usuario |

Sección plegable "Más detalles" (todo opcional): ubicación del ejemplar en casa, apodo o etiqueta, color de flor del ejemplar y si la foto es en floración o no.

Fondo dinámico: la pantalla cambia a una foto característica del género detectado, con un velo claro para mantener legible el formulario, y solo cuando hay coincidencia clara para evitar parpadeos. Aplica solo a los géneros que tienen foto cargada (al inicio, los cinco de acceso rápido); el resto usa el fondo neutro.

Especie no encontrada: el usuario la guarda con el género, el tipo y el nombre tal como la conoce. La foto sigue siendo opcional, pero el formulario la recomienda porque ayuda al administrador a validar el nombre. Queda en su inventario con estado "nombre por validar" y se propone al catálogo general. Cuando un administrador confirma el nombre exacto, el registro pasa a "validada" y se enlaza a la especie del catálogo.

### 3.2 Consulta "¿Ya la tengo?"

Búsqueda instantánea sobre el inventario propio por nombre científico, común o género, con resultado claro: la tienes (con cuántos ejemplares) o no la tienes. Debe incluir también los registros con "nombre por validar". Debe responder rápido con mala señal: el inventario propio se cachea en el dispositivo y la búsqueda corre sobre esa copia.

Alcance de la caché en Fase 1: es de solo lectura. Se actualiza cada vez que hay conexión y permite consultar sin señal, mostrando la fecha de la última actualización. Registrar, editar y dar de baja requieren conexión; el registro sin conexión y la sincronización quedan para la Fase 2.

### 3.3 Vista de inventario

- Lista y cuadrícula con fotos, agrupable por género, con contador total y por género.
- Varios ejemplares de una misma especie se registran como ejemplares distintos bajo la misma especie.
- Edición, baja (planta perdida o regalada) y exportación del inventario a CSV.

| Filtro del inventario | Valores |
| --- | --- |
| Género | Los géneros presentes en la colección del usuario |
| Color de flor | blanco, rosado, morado, amarillo, naranja, bicolor. Lo indica el usuario en cada ejemplar (opcional); los ejemplares sin color no aparecen al filtrar por color |
| Estado | activa, perdida, regalada |
| Origen | tienda o vivero de adquisición |

### 3.4 Backoffice de catálogo

Panel web para administradores (rutas protegidas dentro de la misma app) que mantiene el catálogo base del que se alimenta el autocompletado.

- Importación: en Fase 1 no hay pantalla de carga. La hacen los scripts de `scripts/catalog-import/`, que se corren a demanda y dejan un reporte en CSV de registros nuevos, actualizados y rechazados. El backoffice solo muestra el resultado: cada especie con su estado y su fuente.
- Lo importado se publica de inmediato; el administrador valida en paralelo, no como paso previo. Cada especie lleva un estado: importada, validada u observada.
- Alta, edición, fusión de duplicados y baja de especies; gestión de sinónimos y nombres comunes.
- Cola de propuestas de usuarios (registros con "nombre por validar"): confirmar el nombre exacto y enlazarlos a la especie correcta.
- Roles: administrador de catálogo; auditoría básica de quién cambió qué.

### 3.5 Cuentas

Autenticación con Clerk: correo (código de verificación) y Google. El rol (usuario o administrador de catálogo) se guarda en los metadatos públicos del usuario en Clerk, que el propio usuario no puede modificar. En Fase 1 el rol de administrador se asigna a mano desde el panel de Clerk.

### 3.6 Fuera de alcance en v1

Catálogo navegable con filtros, planes de cuidado y recordatorios, bitácora, NFC/QR, identificación o diagnóstico por foto con IA, apps nativas, marketplace, intercambios entre coleccionistas y foros.

## 4. Modelo de datos

Regla central: especie y ejemplar son entidades separadas. Un usuario puede tener varios ejemplares de una especie, y un ejemplar puede estar enlazado a una especie validada o llevar un nombre pendiente. Los nombres de campos son orientativos.

| Entidad | Campos principales | Relaciones |
| --- | --- | --- |
| Usuario (perfil) | id de usuario de Clerk (texto), idioma preferido. El correo, el acceso con Google y el rol viven en Clerk, no en la base de datos | 1 usuario tiene N plantas |
| Género | nombre, foto característica (opcional; fondo del registro), acceso rápido (sí/no; define los chips del registro) | 1 género tiene N especies |
| Especie (catálogo) | nombre científico, nombres comunes, género, tipo (especie, híbrido), estado (importada, validada, observada), fuente (GBIF, lista curada, propuesta de usuario) | 0..1 especie para N plantas |
| Sinónimo | nombre alternativo, especie a la que apunta | N sinónimos por especie |
| Planta (ejemplar) | usuario, especie (opcional), nombre ingresado, género, tipo (especie, híbrido, no sé), foto, fecha de adquisición, origen, estado (activa, perdida, regalada), validación (validada, nombre por validar), ubicación, apodo, color de flor (opcional), en floración | pertenece a 1 usuario |

Género y tipo de la planta: mientras el ejemplar está "por validar" valen los que eligió el usuario. Al enlazarlo a una especie del catálogo, se sobrescriben con los de esa especie para que no puedan discrepar.

Color de flor: es un dato del ejemplar, no de la especie, porque ninguna fuente del catálogo lo trae y varía entre híbridos y clones.

Entidades de fases posteriores (no construir en Fase 1): tarea de cuidado y evento de bitácora (1 planta tiene N), tag NFC (1 planta tiene 0..1).

Seguridad de datos: Row Level Security para que cada usuario solo vea y edite su inventario; el catálogo es de lectura pública y escritura solo para administradores. Las políticas identifican al usuario y su rol a partir del token de sesión de Clerk, no de Supabase Auth: el id de usuario es el de Clerk (texto, no UUID) y el rol llega como un dato del token.

## 5. Arquitectura y stack

SPA estática en Vercel que habla directo con Supabase; sin backend propio en Fase 1.

| Capa | Elección | Notas |
| --- | --- | --- |
| Frontend | React + Vite + TypeScript, Tailwind, PWA desde el inicio | PWA en Fase 1 significa instalable, con la app y el inventario propio cacheados para lectura. El backoffice son rutas protegidas en la misma app |
| Base de datos | Supabase Postgres con extensión pg_trgm | Índices de trigramas sobre nombre científico, sinónimos y nombres comunes; sin Elasticsearch |
| API | Supabase (PostgREST) con Row Level Security | Sin backend que mantener |
| Autenticación | Clerk: correo con código de verificación y Google | Conectado a Supabase como proveedor de autenticación externo; Supabase valida el token de Clerk y aplica RLS. Rol en los metadatos públicos de Clerk, incluido en el token de sesión. No se usa Supabase Auth |
| Fotos | browser-image-compression + Supabase Storage con miniaturas | Mayor costo de almacenamiento y de carga |
| Importación de catálogo | Scripts en Python fuera de la app. Fuentes: taxonomía base de GBIF (especies y sinónimos) y una lista curada propia en CSV (híbridos comunes) | Normalizan y cargan a Postgres con estado "importada"; se corren a demanda y generan un reporte CSV |
| Hosting y entrega | Vercel (frontend) + Supabase gestionado | Despliegue automático desde GitHub |
| Observabilidad | Sentry + 2 eventos de producto | Registro completado y búsqueda "¿ya la tengo?" con su resultado |

Costos: cero durante desarrollo y validación. Al abrir a usuarios reales, Supabase Pro (25 USD al mes más uso) y Vercel Pro (20 USD al mes por asiento), porque el plan Hobby de Vercel es solo para uso no comercial. Límites del plan Free de Supabase a vigilar: 500 MB de base de datos, 1 GB de storage y pausa tras una semana sin uso. Clerk tiene plan gratuito con tope de usuarios activos; confirmar el límite vigente antes de abrir a usuarios reales.

Estructura sugerida del monorepo:

```
orki-app/
  apps/web/               # SPA React + Vite (app de usuario y backoffice)
  scripts/catalog-import/ # Scripts Python de importación del catálogo
  supabase/               # Migraciones, políticas RLS y configuración
  docs/specification.md   # Este documento
  README.md
```

## 6. Requisitos no funcionales

| Categoría | Requisito |
| --- | --- |
| Rendimiento | Carga inicial menor a 3 s en equipos de gama media con 4G; imágenes con lazy loading y formatos modernos (WebP/AVIF) |
| Accesibilidad | WCAG 2.1 nivel AA |
| Compatibilidad | Últimas 2 versiones de Chrome, Safari, Firefox y Edge |
| Seguridad | HTTPS obligatorio; ids opacos no adivinables; datos personales mínimos |
| Disponibilidad | 99.5% mensual |
| Escalabilidad | Hasta 10 000 usuarios y 100 000 plantas sin rediseño |

## 7. Design tokens

Principio: la interfaz es neutra y las fotos de las orquídeas ponen el color. Tokens pensados para CSS variables o Tailwind; el modo oscuro se define sobre los mismos nombres en fase 3.

| Token | Valor | Uso |
| --- | --- | --- |
| color-primary | #D83B6F | Acciones principales, chip seleccionado, acento de marca |
| color-primary-soft | #FCE4EC | Fondos de chips y estados hover del primario |
| color-secondary | #336049 | Títulos, etiquetas, bordes de campos (verde hoja) |
| color-success | #2E7D4F | Respuesta "Sí, la tienes", estado "validada" |
| color-warning | #D9A441 | Estado "nombre por validar", avisos |
| color-neutral-0 | #FFFCF7 | Fondo de pantalla (blanco cálido) |
| color-neutral-50 | #F6F1E8 | Fondo de tarjetas y secciones (crema claro) |
| color-neutral-700 | #545454 | Texto secundario y placeholders |
| color-neutral-900 | #1F1F1F | Texto principal |
| font-display | Serif elegante (ej. Playfair Display o Lora) | Títulos y nombres científicos; nombre científico siempre en cursiva |
| font-body | Sans simple (ej. Inter) | Todo lo demás |
| text-xs / sm / md / lg / xl / display | 12 / 14 / 16 / 18 / 22 / 32 px | Escala tipográfica |
| space-1 a space-6 | 4 / 8 / 12 / 16 / 24 / 32 px | Espaciado en múltiplos de 4 |
| radius-sm / md / lg / pill | 8 / 12 / 16 / 999 px | Botones y campos 12, tarjetas 16, chips pill |
| shadow-card | 0 2px 8px rgba(31, 31, 31, 0.08) | Sombra única, muy suave |
| overlay-genus | rgba(255, 252, 247, 0.85) | Velo sobre la foto de fondo del género en el registro |
| motion-bg | 300 ms ease-in-out | Transición del fondo al detectar género |

Componentes base de Fase 1: tarjeta de planta, buscador con autocompletado, chip de filtro, chip de género, chip de tipo, chip de estado, botón primario y secundario, campo de texto, sección plegable, tarjeta de resultado "¿ya la tengo?".

## 8. Mockups de referencia

Diseño en Canva: "Mockup móvil de Orki" (ID `DAHbRx1BRWg`, 3 páginas, 1264 x 1264 px). Enlace: https://www.canva.com/d/BGGfFrxKIejHsaz

Son referencia de estructura y jerarquía, no pixel-perfect.

| Página | Pantalla | Qué muestra |
| --- | --- | --- |
| 1 | Inventario | Buscador fijo arriba, chips de género, contador de orquídeas y géneros, cuadrícula de tarjetas con foto, nombre científico en cursiva y chip de estado |
| 2 | Registro rápido | Nombre científico con autocompletado, chips de género, chips de tipo (Especie, Híbrido, No sé), foto, origen con autocompletado, fecha precargada con hoy, sección plegable "Más detalles", botón primario |
| 3 | ¿Ya la tengo? | Tarjeta de respuesta en verde ("Sí, la tienes - 2 ejemplares") y variante en gris ("No la tienes") |

## 9. Orden de implementación

El orden importa: primero el modelo, luego los datos, luego la interfaz.

1. Modelo de datos y esquema: especie y ejemplar separados, tabla de sinónimos y políticas RLS. Va primero porque la carga del catálogo necesita el esquema y migrarlo después es costoso.
2. Autenticación y roles con Clerk: integración con Supabase y políticas RLS probadas para usuario y administrador de catálogo, antes de cualquier pantalla con datos.
3. Catálogo base: correr la carga inicial (GBIF y lista curada de híbridos) antes de construir la interfaz, porque sin datos no hay autocompletado.
4. Normalización de nombres: es el mayor riesgo técnico. Manejo de abreviaturas de género y búsqueda tolerante a errores de tipeo sobre nombres científicos, sinónimos y nombres comunes.
5. Registro rápido con autocompletado, incluido el caso de especie no encontrada.
6. Búsqueda "¿ya la tengo?": es la funcionalidad estrella; rápida desde el celular y con caché local de solo lectura del inventario propio.
7. Fotos: comprimir en el cliente antes de subir y servir miniaturas.
8. Backoffice mínimo: tabla de especies con estados, fusión de duplicados y cola de nombres por validar; sin inversión en diseño.
9. Validación temprana: probar con 5 a 10 coleccionistas reales que registren su colección completa antes de pulir.

## 10. Roadmap

| Fase | Prioridad | Contenido | Condición para pasar a la siguiente |
| --- | --- | --- | --- |
| 1 - MVP inventario | Must have | Registro con autocompletado, búsqueda "¿ya la tengo?", vista de inventario y conteos, backoffice e importación de catálogo, cuentas (correo o Google) | Inventario en uso real por coleccionistas |
| 2 - Catálogo y cuidados | Should have | Catálogo navegable con filtros, plan de cuidados y recordatorios, bitácora con fotos y dashboard, registro y edición sin conexión con sincronización | Recordatorios y offline en producción |
| 3 - NFC y extras | Could have | Vinculación NFC + QR, identificación de especie y diagnóstico por foto con IA, perfil público e inglés, modo oscuro | - |

## 11. Riesgos y preguntas abiertas

- Cobertura de híbridos: GBIF cubre especies y sinónimos, pero casi no trae híbridos ni cultivares, que son la mayoría de lo que se vende en tiendas. Se parte con una lista curada de los 50-100 híbridos más comunes en Perú y se crece con los aportes validados de usuarios. Hasta entonces, muchos registros de híbridos quedarán como "nombre por validar".
- Duplicados por nombre: una misma especie puede tener varios nombres comunes; el autocompletado debe priorizar el nombre científico y mostrar sinónimos.
- Nombres no validados: el registro con nombre "como lo conocen" puede generar duplicados ocultos; la búsqueda "¿ya la tengo?" debe incluir esos registros pendientes.
- Fuentes del catálogo (decidido para Fase 1):
  - Taxonomía base de GBIF (GBIF Backbone Taxonomy), filtrada a la familia Orchidaceae: nombres aceptados y sinónimos. Es la referencia para especies. Antes de la primera carga hay que confirmar su licencia y la atribución que exige.
  - Lista curada propia en CSV dentro del repositorio: híbridos y nombres comerciales comunes en Perú. Es la referencia para híbridos.
  - Registro de híbridos de la RHS: solo consulta manual del administrador al validar propuestas; no se importa.
  - Las ocurrencias de GBIF (presencia en Perú) quedan fuera de la Fase 1; pueden sumarse después para priorizar resultados locales.
  - Conflictos de nombres: para especies manda GBIF; para híbridos manda la lista curada. Lo que no esté en ninguna entra como propuesta de usuario.
