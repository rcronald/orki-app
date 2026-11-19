// Lectura de los tokens a partir del texto de tokens.css, la única fuente de
// sus valores en la app. La usan la prueba de contraste y la página de muestra,
// así ninguna de las dos copia valores a mano: si tokens.css cambia, las dos
// lo ven.

export interface Token {
  /** Nombre del token, sin los dos guiones: "color-primary". */
  name: string
  /** Valor tal como está escrito en tokens.css. */
  value: string
}

export interface TextStyleToken {
  /** "text-xl" */
  name: string
  fontSize: string
  lineHeight: string
  fontWeight: string
}

export interface DesignTokens {
  /** color-* y overlay-*. */
  colors: Token[]
  /** font-display y font-body. */
  families: Token[]
  textStyles: TextStyleToken[]
  spacing: Token[]
  radii: Token[]
  shadows: Token[]
  motion: Token[]
}

/**
 * Todas las declaraciones `--nombre: valor;` de tokens.css, en orden, sin
 * comentarios. Deja fuera los vaciados de Tailwind (`--color-*: initial`) y
 * las variables puente que solo apuntan a otra con var().
 */
export function readDeclarations(css: string): Token[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const tokens: Token[] = []
  for (const match of withoutComments.matchAll(
    /--([a-z0-9-]+)\s*:\s*([^;{}]+);/gi,
  )) {
    const [, name, rawValue] = match
    const value = rawValue?.trim().replace(/\s+/g, ' ')
    if (!name || !value || value === 'initial' || value.startsWith('var(')) {
      continue
    }
    tokens.push({ name, value })
  }
  return tokens
}

export function parseTokens(css: string): DesignTokens {
  const declarations = readDeclarations(css)
  const byName = new Map(declarations.map((token) => [token.name, token.value]))
  const withPrefix = (pattern: RegExp) =>
    declarations.filter((token) => pattern.test(token.name))

  const textStyles = withPrefix(/^text-[a-z0-9]+$/).map(
    ({ name, value }): TextStyleToken => ({
      name,
      fontSize: value,
      lineHeight: byName.get(`${name}--line-height`) ?? '',
      fontWeight: byName.get(`${name}--font-weight`) ?? '',
    }),
  )

  return {
    colors: withPrefix(/^(color|overlay)-/),
    families: withPrefix(/^font-(display|body)$/),
    textStyles,
    spacing: withPrefix(/^space-\d+$/),
    radii: withPrefix(/^radius-/),
    shadows: withPrefix(/^shadow-/),
    motion: withPrefix(/^motion-/),
  }
}

/** Colores con valor hexadecimal de seis cifras, por nombre. */
export function readColorTokens(css: string): Map<string, string> {
  return new Map(
    parseTokens(css)
      .colors.filter((token) => /^#[0-9a-f]{6}$/i.test(token.value))
      .map((token) => [token.name, token.value]),
  )
}
