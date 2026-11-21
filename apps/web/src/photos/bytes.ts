// Lectura de enteros y texto en un Uint8Array, sin salirse de sus límites.

export function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

export function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

export function u24le(bytes: Uint8Array, offset: number): number {
  return u16le(bytes, offset) | ((bytes[offset + 2] ?? 0) << 16)
}

export function u32be(bytes: Uint8Array, offset: number): number {
  return u16be(bytes, offset) * 0x10000 + u16be(bytes, offset + 2)
}

export function u32le(bytes: Uint8Array, offset: number): number {
  return u16le(bytes, offset) + u16le(bytes, offset + 2) * 0x10000
}

/** Texto ASCII de `length` bytes desde `offset` (vacío fuera de límites). */
export function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || offset + length > bytes.length) return ''
  let text = ''
  for (let i = offset; i < offset + length; i++) {
    text += String.fromCharCode(bytes[i] ?? 0)
  }
  return text
}

/** ¿Empiezan los bytes en `offset` con `prefix` (ASCII)? */
export function startsWithAscii(
  bytes: Uint8Array,
  offset: number,
  prefix: string,
): boolean {
  return ascii(bytes, offset, prefix.length) === prefix
}
