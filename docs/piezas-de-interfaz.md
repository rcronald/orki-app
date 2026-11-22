# Piezas de interfaz para «Mi colección», «¿Ya la tengo?» y «Tu cuenta»

Guía de uso de las piezas del design system que dejaron listas el #206, el #213
y el #207 para los rediseños de «Mi colección» (#208), «¿Ya la tengo?» (#209) y
«Tu cuenta» (#214). Basta con esta página: no hace falta abrir ni tocar
`apps/web/src/styles/bundle.css`, `tokens.css`, `Icon` ni la barra. Todas se
ven, con sus variantes, en `/muestra` (secciones «Mi colección: piezas» y
«Tu cuenta: piezas»).

Rutas relativas a `apps/web/src/`. Los componentes se importan cada uno de su
archivo (no hay índice).

## Reglas comunes

- **El verde es la acción principal en toda la app.** `Button variant="primary"`
  (`orki-btn--primary`) es verde (`color-secondary-strong`, y
  `color-secondary` al pasar por encima). `strong` es un alias que conserva la
  portada; dentro de la app usa `primary`. Una sola acción principal por
  pantalla. El rosa (`color-primary`) es solo de la marca (el logotipo): no lo
  uses para acciones ni para selección.
- **Selección**: chip seleccionado relleno en verde con el texto claro
  (`aria-pressed="true"` o `orki-chip--selected`); el hover y la opción activa
  de listas en `color-secondary-soft`.
- Tailwind 4 aquí: las utilidades numéricas (`gap-4`, `top-0`, `min-w-0`) no
  generan CSS. Usa los tokens (`gap-space-4`, `p-space-3`) o valores arbitrarios
  (`min-w-[0]`).
- Hasta 720 px (`@media (max-width: 720px)`) las piezas cambian solas; para
  ajustar algo alrededor al mismo corte, la variante `publico-estrecho:`.
- Iconos (`components/ui/Icon.tsx`, `<Icon name="…" />`). Nuevos:
  `sliders-horizontal`, `layout-grid`, `list`, `download`, `cloud-off`, `file`,
  `shield`, `log-out` y `settings`. Ya estaban, entre otros: `plus`,
  `circle-check`, `check`, `search`, `x`, `map-pin`, `arrow-left`,
  `arrow-right`, `chevron-right`, `user`, `sprout`, `layers`, `triangle-alert`,
  `camera`.
- Las pruebas de cada pieza (con axe) están junto a su componente. Para axe en
  jsdom: `document.documentElement.lang = 'es'`, `document.title` y un
  `<main>` alrededor.

## Barra de la app (ya montada)

`components/AppBar.tsx` + `auth/AccountMenu.tsx`, montadas por
`components/AppShell.tsx`. **No hay que hacer nada en las pantallas**: toda
ruta dentro de `AppShell` la lleva.

- Con sesión (o con la sesión recordada sin confirmar): logotipo (a `/`),
  pestaña «Mi colección» con `aria-current="page"` en `/coleccion`, sus hijas
  y `/ya-la-tengo` (`PATHS.ownershipCheck`, la ruta propuesta del #209; si
  usas otra, avisa: está en `COLLECTION_AREA` de `AppBar.tsx`), y el menú
  «Tu cuenta» (foto o iniciales; «Mi cuenta», «Administración» solo con
  `catalog_admin`, «Cerrar sesión»).
- Sin sesión: la barra pública (`PublicHeader`). Mientras Clerk carga, solo el
  logotipo. Sin Clerk ni sesión: el logotipo y un aviso breve debajo.
- Sin lupa: «¿Ya la tengo?» se abre con un botón desde «Mi colección».
- El `<main id="contenido">` lleva `pt-space-5`; el pie (`SiteFooter`) y
  «Saltar al contenido» siguen igual.

Piezas: `orki-appbar` (`__brand`, `__logo`, `__nav`, `__tabs`, `__tab`,
`__end`) y el botón con menú `orki-menu` (`__button`, `__label`, `__popup`,
`__header`, `__list`, `__item`, `__separator`).

### `MenuButton` (`components/ui/MenuButton.tsx`)

Botón con menú (patrón «menu button» de las ARIA APG): `aria-haspopup="menu"`,
`aria-expanded`, foco en la primera opción al abrir, flechas en bucle, Inicio,
Fin, Escape devuelve el foco, Tab y clic fuera cierran (no atrapa el foco).

```ts
type MenuItem =
  | { kind: 'link'; label: string; icon?: IconName; to: string; state?: unknown }
  | { kind: 'action'; label: string; icon?: IconName; onSelect: () => void }
  | { kind: 'separator' }
interface MenuButtonProps {
  children: ReactNode // contenido del botón: le da el nombre accesible
  items: readonly MenuItem[]
  header?: ReactNode // texto fijo arriba, fuera del menú
  className?: string
}
```

## Cabecera de pantalla

`components/ui/PageHeader.tsx`, normalmente **a través de `Page`** (prop
`header`), que pone el título de la pestaña y lleva el foco al `h1` al navegar.

```ts
interface PageHeaderProps {
  title: ReactNode // h1, en Page sale de title o heading
  meta?: ReactNode // «18 ejemplares · 5 géneros» o la frase de apoyo
  actions?: ReactNode // hasta dos; solo en la variante por defecto
  back?: ReactNode // enlace de volver, con la clase orki-pagehead__back
  variant?: 'default' | 'center'
  art?: boolean // ilustración de la esquina; por defecto, true
  headingLevel?: 1 | 2 // 1 salvo en la muestra
  headingRef?: Ref<HTMLHeadingElement> // lo pone Page
  className?: string
}
```

- Título 64 px (32 px hasta 720 px) en `font-display` y `color-secondary-strong`;
  `meta` en `color-neutral-700`.
- Acciones a la derecha en escritorio; hasta 720 px, apiladas a todo el ancho
  debajo del título, en el orden en que las pases (la principal primero).
- Ilustración en color, decorativa (`alt=""`), arriba a la izquierda: el texto
  se aparta (`padding-left`) y no hay desplazamiento horizontal. Una por
  pantalla. Es `assets/ilustraciones/cabecera-{240,480}.webp` (ver su `LEEME.md`);
  no va en el precaché: sin conexión, la cabecera se ve sin ella.
- `variant="center"`: pantallas de una sola tarea («¿Ya la tengo?»): enlace de
  volver arriba, título y frase centrados, sin acciones.

```html
<div class="orki-pagehead [orki-pagehead--center]">
  <img class="orki-pagehead__art" alt="" />
  <div class="orki-pagehead__text">
    <a class="orki-link orki-pagehead__back">…</a>
    <h1 class="orki-pagehead__title" tabindex="-1">Mi colección</h1>
    <p class="orki-pagehead__meta">18 ejemplares · 5 géneros</p>
  </div>
  <div class="orki-pagehead__actions">…</div>
</div>
```

```tsx
// «Mi colección» (#208)
<Page
  title="Mi colección"
  width="wide"
  header={{
    meta: '18 ejemplares · 5 géneros',
    actions: (
      <>
        <Link to={PATHS.newPlant} className="orki-btn orki-btn--primary">
          <Icon name="plus" />
          Registrar orquídea
        </Link>
        <Link to={PATHS.ownershipCheck} className="orki-btn orki-btn--secondary">
          <Icon name="circle-check" />
          ¿Ya la tengo?
        </Link>
      </>
    ),
  }}
>
  …
</Page>

// «¿Ya la tengo?» (#209)
<Page
  title="¿Ya la tengo?"
  header={{
    variant: 'center',
    meta: 'Comprueba si una orquídea ya está en tu colección',
    back: (
      <Link to={PATHS.collection} className="orki-link orki-pagehead__back">
        <Icon name="arrow-left" />
        Volver a Mi colección
      </Link>
    ),
  }}
>
  …
</Page>
```

Si «Volver» tiene que recuperar la vista anterior (búsqueda, filtros y
posición), usa la misma técnica que el detalle (`detail/navigation.ts`,
`FROM_INVENTORY`, «atrás» con `navigate(-1)`): `back` acepta cualquier nodo.

## Barra de búsqueda del inventario

Tres piezas dentro de `<div className="orki-toolbar">` (fila que se parte; el
primer hijo, el campo, ocupa lo que sobra):

### `SearchField` (`components/ui/SearchField.tsx`)

```ts
type SearchFieldProps = Omit<InputProps, 'value' | 'onChange' | 'type'> & {
  label: string // nombre accesible: «Buscar en mi colección»
  hideLabel?: boolean // etiqueta solo para el lector (escritorio)
  value: string
  onValueChange: (value: string) => void // al escribir, borrar y con Escape
  clearLabel?: string // «Borrar la búsqueda»
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string // del contenedor orki-field
}
```

`role="searchbox"`, lupa a la izquierda, botón de borrar de 44 × 44 px (solo con
texto) que devuelve el foco al campo; Escape también borra. No filtra: el
contador de coincidencias va en un `role="status"` aparte, enlazado con
`aria-describedby`. Marcado: `orki-field` > `orki-search` > `orki-search__icon`
\+ `input.orki-field__input.orki-search__input` + `button.orki-search__clear`.

Para la etiqueta visible solo en móvil (como en la maqueta), deja `hideLabel`
en `false` y oculta la etiqueta en escritorio con una utilidad, o al revés.

### `FiltersButton` (`components/ui/FiltersButton.tsx`)

```ts
type FiltersButtonProps = ButtonProps & {
  activeCount: number // 0: sin indicador
  label?: string // «Filtros»
}
```

`orki-btn orki-btn--secondary` con `sliders-horizontal` y, con filtros, el
indicador `orki-count` (verde, número claro). Nombre accesible: «Filtros, 2
activos». Si abre un panel, pásale `aria-expanded` y `aria-controls`.

### `SegmentedControl` (`components/ui/SegmentedControl.tsx`)

```ts
interface SegmentedOption<V extends string> {
  value: V
  label: string
  icon?: IconName
}
type SegmentedControlProps<V extends string> = {
  label: string // nombre del grupo: «Vista»
  options: readonly SegmentedOption<V>[]
  value: V
  onValueChange: (value: V) => void
  iconOnly?: boolean // nombres solo para el lector y como tooltip
}
```

Grupo con nombre de botones de alternar (`aria-pressed`); la elegida, rellena en
verde. 44 × 44 px. Marcado: `div.orki-segmented[role=group]` >
`button.orki-segmented__option[aria-pressed]`.

```tsx
<div className="orki-toolbar">
  <SearchField
    label="Buscar en mi colección"
    hideLabel
    placeholder="Buscar en mi colección"
    value={query}
    onValueChange={setQuery}
    aria-describedby={statusId}
  />
  <FiltersButton
    activeCount={activeFilters}
    aria-expanded={open}
    aria-controls={panelId}
    onClick={toggle}
  />
  <SegmentedControl
    label="Vista"
    iconOnly
    value={view}
    onValueChange={setView}
    options={[
      { value: 'grid', label: 'Cuadrícula', icon: 'layout-grid' },
      { value: 'list', label: 'Lista', icon: 'list' },
    ]}
  />
</div>
```

## Fila de chips desplazable

`ChipGroup` (`components/ui/ChipGroup.tsx`) con `scroll`: una sola fila con
desplazamiento horizontal, sin barra visible; Tab recorre los chips y el
navegador lleva el que tiene el foco a la vista. Clases `orki-chips
orki-chips--scroll`. Los chips son `Chip` (`selected` → `aria-pressed`, relleno
verde con `check`).

```tsx
<ChipGroup aria-label="Género" scroll>
  <Chip selected={genus === null} onClick={() => setGenus(null)}>
    Todos
  </Chip>
  {genera.map((g) => (
    <Chip key={g} selected={genus === g} onClick={() => setGenus(g)}>
      {g}
    </Chip>
  ))}
</ChipGroup>
```

Un chip que no es un botón de alternar pero debe verse seleccionado (por
ejemplo, un filtro activo que se quita al pulsarlo) usa la clase
`orki-chip--selected`.

## Tarjeta de ejemplar con borde

`CollectionCard` (`components/ui/CollectionCard.tsx`). `SpecimenCard` y
`orki-card` siguen igual para el detalle y otras pantallas.

```ts
type CollectionCardProps = ArticleProps & {
  scientificName: string
  nameStyle?: 'scientific' | 'plain' // plain: nombre por validar, sin cursiva
  nickname?: ReactNode // segunda línea (apodo)
  badge?: ReactNode // insignia, solo si aplica: <StatusBadge status="pending" />
  location?: ReactNode // fila con map-pin («Ubicación:» para el lector)
  photo?: { src: string; alt: string } // sin foto, el marcador sin-foto.svg
  headingLevel?: 2 | 3 | 4 // h3 por defecto
  layout?: 'grid' | 'list' // list: miniatura de 96 px a la izquierda
  renderName?: (name: ReactNode) => ReactNode // el enlace al detalle
}
```

Borde `color-neutral-200` sobre `color-neutral-0`, `radius-lg`, sin sombra; foto
3:2; nombre en cursiva `font-display`. El enlace con `orki-card__link` cubre
toda la tarjeta (también la foto) y pinta el anillo de foco por dentro.
Marcado: `article.orki-card.orki-card--outline[.orki-card--row]` >
`img.orki-card__photo` + `div.orki-card__body` > `hN.orki-card__name` +
`p.orki-card__common` + insignia + `p.orki-card__place`.

```tsx
<CollectionCard
  ref={ref} // para usePlantThumbnail
  scientificName={plant.displayName}
  nameStyle={plant.displayNameIsScientific ? 'scientific' : 'plain'}
  nickname={plant.nickname ?? undefined}
  location={plant.location ?? undefined}
  badge={
    status !== 'validated' ? <StatusBadge status={status} /> : undefined
  }
  photo={photo}
  layout={view === 'list' ? 'list' : 'grid'}
  headingLevel={2}
  renderName={(name) => (
    <Link
      to={plantDetailPath(plant.id)}
      state={FROM_INVENTORY}
      className="orki-card__link"
    >
      {name}
    </Link>
  )}
/>
```

La rejilla (tres por fila en escritorio, dos en móvil) se compone con Tailwind:
`grid grid-cols-2 gap-space-3 md:grid-cols-3`.

## Resultado de consulta

`QueryAnswer` (`components/ui/QueryAnswer.tsx`), pieza `orki-answer`.
`OwnershipAnswer` (el texto actual del inventario) está hecha sobre ella y
admite las mismas `action` y `announce`.

```ts
type QueryAnswerTone = 'yes' | 'similar' | 'no' | 'notice'
type QueryAnswerProps = DivProps & {
  tone: QueryAnswerTone
  title: ReactNode // «Sí, la tienes»
  detail?: ReactNode // «2 ejemplares»
  action?: ReactNode // enlace con orki-answer__action
  icon?: IconName // por defecto: check, layers, search, cloud-off
  announce?: boolean // role="status" propio; por defecto, true
  children?: ReactNode // texto adicional (<p className="orki-answer__text">)
}
```

| Tono      | Para                                                      | Aspecto                                        |
| --------- | --------------------------------------------------------- | ---------------------------------------------- |
| `yes`     | «Sí, la tienes»                                           | Fondo `color-secondary-soft`, icono verde lleno |
| `similar` | «Tienes parecidas»                                        | Mismo fondo, icono con borde verde             |
| `no`      | «Aún no la tienes», «No, pero la tuviste»                 | Neutro (`color-neutral-50`), nunca rojo        |
| `notice`  | Un aviso que no es respuesta: «Sin copia disponible»      | Neutro, icono sobre `color-warning`            |

La acción va a la derecha en escritorio y debajo hasta 720 px. Marcado:
`div.orki-answer.orki-answer--{tono}` > `span.orki-answer__icon` +
`div.orki-answer__body` > `p.orki-answer__title` + `p.orki-answer__detail` +
`a.orki-link.orki-answer__action`.

```tsx
<QueryAnswer
  tone="yes"
  title="Sí, la tienes"
  detail={count === 1 ? '1 ejemplar' : `${count} ejemplares`}
  action={
    <Link to={matchesPath} className="orki-link orki-answer__action">
      Ver en mi colección
      <Icon name="arrow-right" />
    </Link>
  }
/>
```

Si la respuesta cambia mientras se escribe, deja una región `role="status"`
siempre montada y pon dentro `QueryAnswer announce={false}` (como hace hoy
`inventory/OwnershipPanel.tsx`). La acción de registrar con ese nombre va
debajo, fuera del bloque, como `Button`/`Link` `orki-btn--primary`.

## Piezas de «Tu cuenta»

### `Panel` (`components/ui/Panel.tsx`): sección con borde y de peligro

```ts
type PanelProps = SectionProps & {
  title: ReactNode // h2 en font-display
  headingLevel?: 2 | 3
  tone?: 'default' | 'danger'
}
```

`section.orki-panel[aria-labelledby]` > `h2.orki-panel__title` + contenido; para
un párrafo, `p.orki-panel__text`. `tone="danger"` (`orki-panel--danger`): borde
`color-danger`, fondo `color-danger-soft`, título en `color-danger`.

### `Avatar` (`components/ui/Avatar.tsx`)

```ts
interface AvatarProps {
  name?: string | null // iniciales: «Ana López» → «AL»
  imageUrl?: string | null // con Clerk: user.hasImage ? user.imageUrl : null
  size?: 'sm' | 'lg' // 36 px (barra) o 96 px (perfil)
  className?: string
}
```

Foto redonda; sin foto (o si no carga), iniciales en `font-display` sobre
`color-neutral-50`; sin nombre, el icono `user`. Decorativo (`aria-hidden`):
va siempre junto al nombre. `initialsOf()` está en `components/ui/initials.ts`.

### `ProfileSummary` (`components/ui/ProfileSummary.tsx`)

```ts
interface ProfileSummaryProps {
  name?: string | null
  email?: string | null
  imageUrl?: string | null
  action?: ReactNode // «Editar perfil»
}
```

Avatar grande, nombre (negrita) y correo; sin nombre, el correo ocupa su
lugar y el avatar muestra `user`. La acción a la derecha; hasta 720 px, debajo
a todo el ancho. Clases `orki-profile`, `__text`, `__name`, `__email`.

### `ActionList` y `ActionRow` (`components/ui/ActionRow.tsx`)

```ts
type ActionRowProps = {
  icon: IconName
  title: string // nombre accesible
  description?: ReactNode // descripción accesible
  disabledReason?: string // deshabilitada: aria-disabled y este motivo como texto
} & ({ to: string; state?: unknown } | { onClick?: () => void })
```

Fila de todo el ancho (mínimo 56 px) con icono, título, texto y
`chevron-right`; con `to`, un `Link`; sin él, un botón. Deshabilitada sigue
recibiendo el foco (se lee el motivo) y no hace nada. `ActionList`
(`ul.orki-actions`) pone la línea entre filas; cada fila en su `<li>`. Marcado:
`a|button.orki-action` > `svg` + `span.orki-action__text` >
`span.orki-action__title` + `span.orki-action__desc` + `svg` (chevron).

### Botón de peligro con borde

`<Button variant="danger-outline">Eliminar mi cuenta</Button>`
(`orki-btn--danger-outline`): abre la confirmación. El relleno
(`variant="danger"`) queda para la confirmación final del diálogo.

```tsx
const privacy = privacyLinkProps('cuenta')
const editor = useProfileEditor()

<Panel title="Perfil">
  <ProfileSummary
    name={user?.fullName}
    email={user?.primaryEmailAddress?.emailAddress}
    imageUrl={user?.hasImage ? user.imageUrl : null}
    action={
      <Button disabled={!editor.available} onClick={editor.open}>
        Editar perfil
      </Button>
    }
  />
</Panel>
<Panel title="Datos y privacidad">
  <ActionList>
    <li>
      <ActionRow icon="file" title="Exportar inventario a CSV"
        description="El archivo CSV no incluye las fotos." onClick={exportCsv} />
    </li>
    <li>
      <ActionRow icon="shield" title="Aviso de privacidad"
        description="Consulta qué datos guardamos y quién puede verlos."
        to={privacy.to} state={privacy.state} />
    </li>
  </ActionList>
</Panel>
<Panel title="Eliminar cuenta" tone="danger">
  <p className="orki-panel__text">
    Se eliminarán tu cuenta, tus plantas y sus fotos. Esta acción es irreversible.
  </p>
  <Button variant="danger-outline" className="self-start">Eliminar mi cuenta</Button>
</Panel>
```

Para un «Editar perfil» deshabilitado con motivo visible, envuelve el botón con
un texto enlazado por `aria-describedby`, o usa `ActionRow` con
`disabledReason`.

## Editor de perfil de Clerk

`auth/profile-editor.ts`:

```ts
export const PROFILE_EDITOR_PROPS // { appearance: { elements: { profileSection__danger: { display: 'none' } } } }
export function useProfileEditor(): {
  available: boolean // sesión confirmada por Clerk, Clerk cargado y conexión
  open: () => void // clerk.openUserProfile(PROFILE_EDITOR_PROPS); sin available, nada
}
```

La apariencia del design system llega del `ClerkProvider`; las props solo
ocultan el «Eliminar cuenta» propio de Clerk (borraría la cuenta sin borrar
los datos; la cuenta se elimina desde `/cuenta`). Al cerrar el editor,
`useUser()` ya trae el nombre y la foto nuevos, sin recargar. Hoy lo usa el
botón «Editar perfil» de `pages/AccountPage.tsx` (provisional hasta el #214).

En las pruebas:

- Unitarias (`test/clerk-mock.tsx`): `openUserProfile` es un `vi.fn` (se
  reinicia con `resetFakeClerk()`); `setFakeClerk({ fullName, imageUrl })` fija
  el nombre (por defecto «Persona de Prueba»; `null` sin nombre) y la foto
  (por defecto `null`: `hasImage` false). `useUser().user` trae `fullName`,
  `firstName`, `hasImage`, `imageUrl` y `primaryEmailAddress`.
- De extremo a extremo (`medicion/clerk-simulado.tsx`): `openUserProfile()`
  marca `<body data-perfil-simulado="abierto">`; la sesión de la prueba admite
  `nombre` (`test.use({ sesion: { usuario: 'user_x', nombre: null } })`) y el
  correo es `persona@orki.invalid`.

## Cerrar sesión

`auth/useSignOutHere.ts`: `const signOut = useSignOutHere()` devuelve la
función del cierre propio de la app (va a `/`, `markSignedOut`; Clerk se
entera con `PendingSignOut`, también si se hizo sin conexión; ver
`docs/sin-conexion.md`). La usan el menú «Tu cuenta» y debe usarla el
«Cerrar sesión» de la pantalla de cuenta.

## Enlace a la privacidad con su origen

`routes/text-page-origin.ts`: el enlace lleva en el estado de navegación de
dónde se viene, para que la página ofrezca la vuelta correcta («Volver a Tu
cuenta», «Volver a Mi colección»…).

```tsx
import { privacyLinkProps } from '../routes/text-page-origin.ts'

<Link {...privacyLinkProps('cuenta')} className="orki-link">
  Aviso de privacidad
</Link>
// o en una fila: <ActionRow to={p.to} state={p.state} … />
```

Orígenes: `inicio`, `registro`, `coleccion` y `cuenta`. Para otra página de
texto, `textPageState(origen)` como `state` del `Link`. Un origen nuevo se
añade a `ORIGINS` en ese archivo.

## Contraste

Todos los pares usados están en `styles/contrast.ts` (los comprueba
`contrast.test.ts` y los enseña `/muestra`). Si una pantalla combina colores
de otra forma, añade el par ahí.
