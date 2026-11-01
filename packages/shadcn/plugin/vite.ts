import { existsSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

import type { Plugin } from "vite"

export type ShadcnOptions = {
  /** The style directory, for example "vega" for the `base-vega` style in components.json. */
  style: string
  /** Directory the `@/` alias points at. Defaults to `./src`. */
  src?: string
  /** Registry packages searched after the application's own files. */
  packages?: string[]
}

const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"]

/**
 * Replaces the application's `"@": "./src"` alias. `@/x` resolves to the application's own file when one exists,
 * so a component copied in with `shadcn add` overrides the package; otherwise it resolves to the same path in the
 * registry packages, e.g. `@/components/ui/button` to `@nyssance/shadcn/vega/components/ui/button`.
 */
export function shadcn(options: ShadcnOptions): Plugin {
  const src = resolve(options.src ?? "src")
  const packages = options.packages ?? ["@nyssance/shadcn"]
  return {
    name: "nyssance-shadcn",
    enforce: "pre",
    async resolveId(source, importer, resolveOptions) {
      if (!source.startsWith("@/")) return null
      // Keep Vite queries such as `?react`, `?url` or `?worker` on the resolved file.
      const queryStart = source.indexOf("?")
      const query = queryStart === -1 ? "" : source.slice(queryStart)
      const rest = source.slice(2, queryStart === -1 ? undefined : queryStart)
      const own = EXTENSIONS.map((extension) => join(src, rest + extension)).find(
        (file) => existsSync(file) && statSync(file).isFile()
      )
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
