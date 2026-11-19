import type { ReactNode } from 'react'
import { CONTRAST_PAIRS, contrastRatio } from '../styles/contrast.ts'
import type { DesignTokens, Token } from '../styles/tokens.ts'
import { DISPLAY_TEXT_STYLES, TEXT_SAMPLES } from './data.ts'
import { Example, Section } from './layout.tsx'

// Secciones de tokens. Nombres y valores llegan de tokens.css (parseTokens) y
// las muestras se pintan con las variables CSS de esos mismos nombres, así la
// página no puede quedar desactualizada.

const cssVar = (name: string) => `var(--${name})`

function TokenName({ children }: { children: string }) {
  return (
    <code className="text-sm font-semibold break-words text-neutral-900">
      {children}
    </code>
  )
}

function ContrastList({
  color,
  colors,
}: {
  color: string
  colors: ReadonlyMap<string, string>
}) {
  const pairs = CONTRAST_PAIRS.filter(
    (pair) => pair.foreground === color || pair.background === color,
  )
  if (pairs.length === 0) {
    return (
      <p className="text-xs text-neutral-700">
        Sin pares de contraste declarados.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-space-2">
      {pairs.map((pair) => {
        const foreground = colors.get(pair.foreground)
        const background = colors.get(pair.background)
        const ratio =
          foreground && background
            ? contrastRatio(foreground, background)
            : undefined
        return (
          <li
            key={`${pair.foreground}/${pair.background}/${pair.kind}`}
            className="flex items-start gap-space-2"
          >
            {/* Muestra del par: fondo y, encima, una barra del primer plano. */}
            <span
              aria-hidden="true"
              className="mt-space-1 inline-flex h-space-5 w-space-6 flex-none items-center justify-center rounded-sm border border-neutral-700"
              style={{ background: cssVar(pair.background) }}
            >
              <span
                className="h-space-1 w-space-4 rounded-pill"
                style={{ background: cssVar(pair.foreground) }}
              />
            </span>
            <span className="min-w-0 text-xs text-neutral-700">
              <span className="break-words text-neutral-900">
                {pair.foreground} sobre {pair.background}
              </span>
              <br />
              <span className="font-semibold text-neutral-900">
                {ratio === undefined ? 'sin valor' : `${ratio.toFixed(2)}:1`}
              </span>{' '}
              · {pair.kind}, mínimo {pair.min}:1
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function ColorSection({ tokens }: { tokens: DesignTokens }) {
  const hexColors = new Map(
    tokens.colors
      .filter((token) => /^#[0-9a-f]{6}$/i.test(token.value))
      .map((token) => [token.name, token.value]),
  )
  return (
    <Section
      id="colores"
      title="Color"
      description="Cada token con su valor en tokens.css y los pares de contraste que el sistema declara válidos, calculados con la misma lógica que la prueba de contraste."
    >
      <ul className="grid grid-cols-1 gap-space-3 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.colors.map((token) => (
          <li
            key={token.name}
            className="flex min-w-0 flex-col gap-space-3 rounded-md bg-neutral-0 p-space-4"
          >
            <span
              aria-hidden="true"
              className="h-space-6 rounded-sm border border-neutral-700"
              style={{ background: cssVar(token.name) }}
            />
            <div className="flex flex-col">
              <TokenName>{token.name}</TokenName>
              <span className="text-sm text-neutral-700">{token.value}</span>
            </div>
            <ContrastList color={token.name} colors={hexColors} />
          </li>
        ))}
      </ul>
    </Section>
  )
}

function TypeSection({ tokens }: { tokens: DesignTokens }) {
  const lg = tokens.textStyles.find((style) => style.name === 'text-lg')
  return (
    <Section
      id="tipografia"
      title="Tipografía"
      description="Familias y estilos de texto con su tamaño, interlineado y peso."
    >
      <Example title="Familias">
        <dl className="flex flex-col gap-space-2">
          {tokens.families.map((family) => (
            <div key={family.name} className="flex flex-col">
              <dt>
                <TokenName>{family.name}</TokenName>
              </dt>
              <dd
                className="text-md text-neutral-700"
                style={{ fontFamily: cssVar(family.name) }}
              >
                {family.value}
              </dd>
            </div>
          ))}
        </dl>
      </Example>
      <Example title="Estilos de texto">
        <ul className="flex flex-col gap-space-4">
          {tokens.textStyles.map((style) => {
            const display = DISPLAY_TEXT_STYLES.has(style.name)
            return (
              <li
                key={style.name}
                className="flex min-w-0 flex-col gap-space-1"
              >
                <span className="text-xs text-neutral-700">
                  <TokenName>{style.name}</TokenName> · {style.fontSize} /{' '}
                  {style.lineHeight} · peso {style.fontWeight} ·{' '}
                  {display ? 'font-display' : 'font-body'}
                </span>
                <span
                  className="break-words text-neutral-900"
                  style={{
                    fontFamily: cssVar(display ? 'font-display' : 'font-body'),
                    fontSize: cssVar(style.name),
                    lineHeight: cssVar(`${style.name}--line-height`),
                    fontWeight: cssVar(`${style.name}--font-weight`),
                  }}
                >
                  {TEXT_SAMPLES[style.name] ?? style.name}
                </span>
              </li>
            )
          })}
          <li className="flex min-w-0 flex-col gap-space-1">
            <span className="text-xs text-neutral-700">
              <TokenName>scientific-name</TokenName> ·{' '}
              {lg ? `${lg.fontSize} / ${lg.lineHeight} · ` : ''}font-display en
              cursiva, en cualquier tamaño de la escala
            </span>
            <span className="scientific-name text-neutral-900">
              Phalaenopsis amabilis
            </span>
          </li>
        </ul>
      </Example>
    </Section>
  )
}

function TokenRow({ token, children }: { token: Token; children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-space-2">
      <span className="text-sm text-neutral-700">
        <TokenName>{token.name}</TokenName> · {token.value}
      </span>
      {children}
    </li>
  )
}

function SpaceSection({ tokens }: { tokens: DesignTokens }) {
  return (
    <Section
      id="espaciado"
      title="Espaciado, radios y sombra"
      description="En Tailwind, el espaciado se usa con el nombre del token: p-space-4, gap-space-2, mt-space-6."
    >
      <div className="grid grid-cols-1 gap-space-4 md:grid-cols-3">
        <Example title="Espaciado">
          <ul className="flex flex-col gap-space-3">
            {tokens.spacing.map((token) => (
              <TokenRow key={token.name} token={token}>
                <span
                  aria-hidden="true"
                  className="h-space-4 bg-secondary"
                  style={{ width: cssVar(token.name) }}
                />
              </TokenRow>
            ))}
          </ul>
        </Example>
        <Example title="Radios">
          <ul className="flex flex-col gap-space-3">
            {tokens.radii.map((token) => (
              <TokenRow key={token.name} token={token}>
                <span
                  aria-hidden="true"
                  className="h-[calc(var(--space-6)*2)] w-[calc(var(--space-6)*3)] border-2 border-secondary bg-neutral-50"
                  style={{ borderRadius: cssVar(token.name) }}
                />
              </TokenRow>
            ))}
          </ul>
        </Example>
        <Example title="Sombra y movimiento">
          <ul className="flex flex-col gap-space-4">
            {tokens.shadows.map((token) => (
              <TokenRow key={token.name} token={token}>
                <span
                  aria-hidden="true"
                  className="h-[calc(var(--space-6)*2)] rounded-lg bg-neutral-50"
                  style={{ boxShadow: cssVar(token.name) }}
                />
              </TokenRow>
            ))}
            {tokens.motion.map((token) => (
              <TokenRow key={token.name} token={token}>
                <span className="text-xs text-neutral-700">
                  Transición del fondo de la pantalla de registro.
                </span>
              </TokenRow>
            ))}
          </ul>
        </Example>
      </div>
    </Section>
  )
}

export function TokenSections({ tokens }: { tokens: DesignTokens }) {
  return (
    <>
      <ColorSection tokens={tokens} />
      <TypeSection tokens={tokens} />
      <SpaceSection tokens={tokens} />
    </>
  )
}
