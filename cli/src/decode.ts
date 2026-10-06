// Small decoders for the API's JSON: every response is parsed here, at the
// boundary, into a named type, so the rest of the CLI trusts its types.
// No dependency: the CLI ships as one file with nothing to install.

export class DecodeError extends Error {
  constructor(readonly path: string, readonly expected: string) {
    super(`Unexpected response from Listspace: ${path} should be ${expected}.`)
    this.name = 'DecodeError'
  }
}

/** Parses an unknown value or throws a DecodeError naming the path. */
export type Decoder<T> = (value: unknown, path: string) => T

export type Decoded<D> = D extends Decoder<infer T> ? T : never

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const string: Decoder<string> = (value, path) => {
  if (typeof value !== 'string') throw new DecodeError(path, 'a string')
  return value
}

export const number: Decoder<number> = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new DecodeError(path, 'a number')
  return value
}

export const boolean: Decoder<boolean> = (value, path) => {
  if (typeof value !== 'boolean') throw new DecodeError(path, 'true or false')
  return value
}

export function literal<const T extends readonly (string | number)[]>(...allowed: T): Decoder<T[number]> {
  return (value, path) => {
    const match = allowed.find((candidate) => candidate === value)
    if (match === undefined) throw new DecodeError(path, `one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`)
    return match
  }
}

export function nullable<T>(inner: Decoder<T>): Decoder<T | null> {
  return (value, path) => (value === null ? null : inner(value, path))
}

/** A field the server may leave out (older servers): undefined becomes the fallback. */
export function withDefault<T>(inner: Decoder<T>, fallback: T): Decoder<T> {
  return (value, path) => (value === undefined ? fallback : inner(value, path))
}

export function array<T>(inner: Decoder<T>): Decoder<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) throw new DecodeError(path, 'a list')
    return value.map((entry, index) => inner(entry, `${path}[${index}]`))
  }
}

type Shape = Record<string, Decoder<unknown>>
type FromShape<S extends Shape> = { [K in keyof S]: Decoded<S[K]> }

/** An object with at least these fields; other fields are dropped. */
export function object<S extends Shape>(shape: S): Decoder<FromShape<S>> {
  return (value, path) => {
    if (!isRecord(value)) throw new DecodeError(path, 'an object')
    const out: Record<string, unknown> = {}
    for (const [key, decode] of Object.entries(shape)) {
      out[key] = decode(value[key], `${path}.${key}`)
    }
    // Every key of the shape was just run through its own decoder above, so
    // `out` holds exactly FromShape<S>; TypeScript cannot follow a loop over keys.
    return out as FromShape<S>
  }
}

/** Two shapes told apart by a literal field, such as outcome. */
export function union<A, B>(pick: (value: Record<string, unknown>) => 'a' | 'b', a: Decoder<A>, b: Decoder<B>): Decoder<A | B> {
  return (value, path) => {
    if (!isRecord(value)) throw new DecodeError(path, 'an object')
    return pick(value) === 'a' ? a(value, path) : b(value, path)
  }
}
