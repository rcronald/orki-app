# Reglas de trabajo en orqui.app

Valen para personas y agentes, salvo que el encargo diga otra cosa.
Qué es la app y dónde está cada documento: [README.md](README.md#documentación).

## Idioma y nombre

- Todo texto visible, comentario, nombre de prueba, documento y mensaje de commit
  va en español con tildes correctas.
- La app se llama «orqui.app», en minúsculas (también al inicio de frase).
  «Orki» sigue en el código, los paquetes y las clases `orki-`.

## Entorno

- Prefija toda orden de shell con
  `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"`.
- No leas `supabase/.env` ni `apps/web/.env*`.

## Comprobaciones

- Siempre: `npm run lint`, `npm run format:check`, `npm run enlaces`,
  `npm run typecheck` y `npm test`.
- Scripts: `npm run test:scripts`.
- Build: `npm run build && npm run build:medicion && npm run presupuesto`.
- Base de datos: `npm run db:test`, `npm run db:concurrencia`
  y `npm run db:types:check` (con `npm run db:types` si cambia el esquema).
- Pantallas: `npm run test:e2e` (Chromium, Firefox, WebKit y `celular`).

## Convenciones que muerden

- Tailwind 4 aquí no genera la escala numérica (`min-w-0`, `top-0`, `gap-4`):
  usa valores arbitrarios (`min-w-[0]`) o los tokens (`gap-space-4`).
- `apps/web/src/styles/bundle.css` es copia literal del design system: no se edita.
- Una migración fusionada no se edita: se corrige con otra.
  Se aplican solas en producción al fusionar en `main`,
  así que deben ser compatibles con la app ya desplegada.
- `db:test` exige Postgres 17, como el CI y Supabase;
  `ORKI_PERMITIR_PG_ANTIGUO=1` solo para probar en local con uno más antiguo.
- E2E: `@logica` para lo que no depende del motor y `@escritorio` para anchos
  de escritorio; sin etiqueta corre en los cuatro perfiles
  (ver [docs/pruebas.md](docs/pruebas.md#qué-corre-en-cada-perfil)).
- En las e2e no uses `dispatchEvent('click')`: tumba el Firefox de Playwright.
  Usa el clic o el teclado.
- En las pruebas unitarias, ESLint prohíbe `source.last().resolve(...)`
  y `.reject(...)`: espera la petición con `await source.respond(...)`.
- No subas el presupuesto de tamaño (`apps/web/presupuesto-tamano.json`)
  por tu cuenta. Un PR que lo sube incluye la tabla de qué creció; tras un
  recorte, bájalo con `npm run presupuesto -- --bajar`
  (ver [docs/medicion-de-carga.md](docs/medicion-de-carga.md#cambiar-el-presupuesto)).

## Issues y pull requests

- `main` está protegida: todo entra por pull request y el CI tiene que pasar.
- Un commit por sub-issue y un solo pull request por issue.
- El pull request cierra sus issues con `Closes #n` (una línea por issue):
  «Cierra #n» no los cierra.

## Trabajo en paralelo

- Puede haber varios agentes en la misma máquina:
  no toques los archivos que el encargo marque como ajenos.
- Las e2e escuchan en `ORKI_E2E_PUERTO` (4317 por defecto)
  y nunca reutilizan un servidor (#295):
  si el puerto está ocupado, elige otro, por ejemplo `ORKI_E2E_PUERTO=4441`.

## Si eres un agente con un encargo

- No ejecutes nada contra Supabase, Vercel, Clerk ni Sentry reales
  (nada de `npm run db:push` ni `db:status`), ni uses conectores MCP.
- No hagas `git push` ni abras pull requests: el coordinador integra.
  `gh` solo para leer issues.
- Empieza donde diga el encargo (normalmente `git fetch origin`,
  una rama nueva desde `origin/main`) y ejecuta `npm ci`.
- Informa con hechos: qué cambiaste, el resultado exacto de cada comprobación,
  qué decidiste y qué no pudiste verificar.
  Si una prueba falla y al repetirla pasa, dilo.
