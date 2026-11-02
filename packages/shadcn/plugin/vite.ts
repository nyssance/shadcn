import { existsSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import type { Plugin, Rolldown } from "vite"

export type ShadcnOptions = {
  /** The style directory, for example "vega" for the `base-vega` style in components.json. */
  style: string
  /** Directory the `@/` alias points at. Defaults to `./src`. */
  src?: string
  /** Registry packages searched after the application's own files. */
  packages?: string[]
}

const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"]
const BUILT = ["", ".js", "/index.js"]

const isFile = (file: string) => existsSync(file) && statSync(file).isFile()

/** Splits `@/x?query` into `x` and `?query`, so Vite queries such as `?react`, `?url` or `?worker` survive. */
function parse(source: string) {
  const queryStart = source.indexOf("?")
  return {
    rest: source.slice(2, queryStart === -1 ? undefined : queryStart),
    query: queryStart === -1 ? "" : source.slice(queryStart)
  }
}

/** The installed directory of a package, found the way Node does: in `node_modules` from `from` upwards. */
function packageDirectory(name: string, from: string) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return candidate
    if (dirname(dir) === dir) return undefined
  }
}

/**
 * Replaces the application's `"@": "./src"` alias. `@/x` resolves to the application's own file when one exists,
 * so a component copied in with `shadcn add` overrides the package; otherwise it resolves to the same path in the
 * registry packages, e.g. `@/components/ui/button` to `@nyssance/shadcn/vega/components/ui/button`.
 *
 * Vite keys a prebundled dependency by the specifier its dependency scan saw, and the dev server only serves the
 * prebundled copy when it resolves that same specifier. Left alone, the scan would key `@/components/ui/button`
 * while the dev server resolves `@nyssance/shadcn/vega/components/ui/button`: the prebundled copy would go unused
 * and the component's own imports (`@base-ui/react/button`, …) would surface only when a page first loads them,
 * re-optimizing and reloading the page. A scan plugin therefore hands the scanner the package specifier, so the
 * scan and the dev server agree, packages that import the registry by its package path share the same copy, and
 * every dependency is known before the first page loads.
 */
export function shadcn(options: ShadcnOptions): Plugin {
  const src = resolve(options.src ?? "src")
  const packages = options.packages ?? ["@nyssance/shadcn"]
  const ownFile = (rest: string) => EXTENSIONS.map((extension) => join(src, rest + extension)).find(isFile)
  // The package that ships `rest`, checked on disk so the scanner never records a miss for a package without it.
  const registry = (rest: string) =>
    packages.find((name) => {
      const dir = packageDirectory(name, src)
      return dir !== undefined && BUILT.some((extension) => isFile(join(dir, "dist", options.style, rest + extension)))
    })
  const scan: Rolldown.Plugin = {
    name: "nyssance-shadcn:scan",
    async resolveId(source, importer, extra) {
      if (!source.startsWith("@/")) return null
      const { rest, query } = parse(source)
      if (ownFile(rest)) return null
      const name = registry(rest)
      return name ? this.resolve(`${name}/${options.style}/${rest}${query}`, importer, extra) : null
    }
  }
  return {
    name: "nyssance-shadcn",
    enforce: "pre",
    config: () => ({ optimizeDeps: { rolldownOptions: { plugins: [scan] } } }),
    async resolveId(source, importer, resolveOptions) {
      if (!source.startsWith("@/")) return null
      const { rest, query } = parse(source)
      const own = ownFile(rest)
      if (own) return own + query
      for (const name of packages) {
        const resolved = await this.resolve(`${name}/${options.style}/${rest}${query}`, importer, {
          ...resolveOptions,
          skipSelf: true
        })
        if (resolved) return resolved
      }
      return null
    }
  }
}
