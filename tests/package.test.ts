import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

import { shadcn } from "../packages/shadcn/dist/vite.js"

const pkg = resolve(import.meta.dirname, "../packages/shadcn")
const styles = readdirSync(join(pkg, "src"))
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
}

for (const style of styles) {
  test(`${style}: every registry source has a module and declarations that load`, async () => {
    const sources = walk(join(pkg, "src", style)).filter((file) => /\.tsx?$/.test(file))
    expect(sources.length).toBeGreaterThan(60)
    for (const source of sources) {
      const name = relative(join(pkg, "src", style), source).replace(/\.tsx?$/, "")
      const module = (await import(`@nyssance/shadcn/${style}/${name}`)) as Record<string, unknown>
      expect(Object.keys(module).length).toBeGreaterThan(0)
      expect(readFileSync(join(pkg, "dist", style, `${name}.d.ts`), "utf8")).not.toContain('"@/')
    }
  })

  test(`${style}: components share one instance of each other`, () => {
    const sidebar = readFileSync(join(pkg, "dist", style, "components/ui/sidebar.js"), "utf8")
    expect(sidebar).toContain('from "./tooltip.js"')
    expect(sidebar).not.toContain("function TooltipProvider")
  })
}

test("the vite plugin prefers the application's own file, then the package", async () => {
  const app = mkdtempSync(join(tmpdir(), "shadcn-app-"))
  try {
    mkdirSync(join(app, "src/components/ui"), { recursive: true })
    writeFileSync(join(app, "src/components/ui/button.tsx"), "export const Button = 1\n")
    const plugin = shadcn({ style: "vega", src: join(app, "src") })
    const requests: string[] = []
    const context = {
      resolve: async (id: string) => {
        requests.push(id)
        return { id: `/resolved/${id}` }
      }
    }
    const resolveId = plugin.resolveId as (this: unknown, id: string, importer?: string, options?: object) => unknown
    expect(await resolveId.call(context, "@/components/ui/button", undefined, {})).toBe(
      join(app, "src/components/ui/button.tsx")
    )
    expect(await resolveId.call(context, "@/components/ui/dialog", undefined, {})).toEqual({
      id: "/resolved/@nyssance/shadcn/vega/components/ui/dialog"
    })
    expect(await resolveId.call(context, "react", undefined, {})).toBeNull()
    expect(requests).toEqual(["@nyssance/shadcn/vega/components/ui/dialog"])
  } finally {
    rmSync(app, { recursive: true, force: true })
  }
})
