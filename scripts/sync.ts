// Regenerates the package source from upstream with the shadcn CLI, exactly as `shadcn add` writes it
// into an application. Nothing here edits a registry file: re-running this script is the only way sources change.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
// shadcn CLI version, and output directory → components.json style. Base UI styles only.
const upstream = {
  cli: "shadcn@4.23.0",
  styles: { vega: "base-vega" } as Record<string, string>,
  components: { iconLibrary: "lucide", rtl: true, menuColor: "default", menuAccent: "subtle" },
}

function run(cwd: string, command: string[], attempts = 1): void {
  for (let attempt = 1; ; attempt++) {
    const result = Bun.spawnSync(command, {
      cwd,
      stdout: "inherit",
      stderr: "inherit"
    })
    if (result.exitCode === 0) return
    if (attempt >= attempts) throw new Error(`${command.slice(0, 4).join(" ")} … failed (${result.exitCode})`)
    // Registry hosts rate-limit bursts of item requests.
    Bun.sleepSync(attempt * 20_000)
  }
}
function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
}
function snapshot(dir: string): Map<string, string> {
  return new Map(walk(dir).map((file) => [relative(dir, file), file]))
}

const dependencies = new Set<string>()
const installed = new Map<string, string>()

for (const [style, registryStyle] of Object.entries(upstream.styles)) {
  const work = mkdtempSync(join(tmpdir(), "nyssance-shadcn-"))
  try {
    writeFileSync(
      join(work, "package.json"),
      JSON.stringify({
        name: "registry",
        private: true,
        type: "module",
        packageManager: "bun@1.4.4"
      })
    )
    writeFileSync(
      join(work, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { jsx: "react-jsx", paths: { "@/*": ["./src/*"] } }
      })
    )
    mkdirSync(join(work, "src"))
    writeFileSync(join(work, "src/index.css"), '@import "tailwindcss";\n')
    writeFileSync(
      join(work, "components.json"),
      JSON.stringify({
        $schema: "https://ui.shadcn.com/schema.json",
        style: registryStyle,
        rsc: false,
        tsx: true,
        tailwind: {
          config: "",
          css: "src/index.css",
          baseColor: "neutral",
          cssVariables: true,
          prefix: ""
        },
        ...upstream.components,
        aliases: {
          components: "@/components",
          utils: "@/lib/utils",
          ui: "@/components/ui",
          lib: "@/lib",
          hooks: "@/hooks"
        },
        registries: {}
      })
    )
    run(work, ["bun", "add", "react", "react-dom"])
    // One `shadcn add <item>` per registry item, as an application adds them. `add --all` skips some items
    // (sonner in 4.23.0), and a multi-item add applies the rsc transform nondeterministically to shared files.
    const index = (await (await fetch(`https://ui.shadcn.com/r/styles/${registryStyle}/registry.json`)).json()) as {
      items: { name: string; type: string; files?: unknown[] }[]
    }
    const items = index.items.filter((item) => ["registry:ui", "registry:hook", "registry:lib"].includes(item.type))
    for (const item of items) run(work, ["bunx", upstream.cli, "add", item.name, "--yes", "--overwrite"], 4)
    for (const item of items) {
      const detail = (await (
        await fetch(`https://ui.shadcn.com/r/styles/${registryStyle}/${item.name}.json`)
      ).json()) as { files?: { path: string }[] }
      for (const file of detail.files ?? []) {
        const name = file.path.split("/").pop()!
        if (!walk(join(work, "src")).some((written) => written.endsWith(`/${name}`)))
          throw new Error(`${registryStyle}: CLI did not write ${item.name} (${name})`)
      }
    }
    const files = [...snapshot(join(work, "src")).keys()].filter(
      (file) => /\.(tsx?|css)$/.test(file) && file !== "index.css" && file !== "lib/utils.ts"
    )
    const out = join(repo, "packages/shadcn/src", style)
    rmSync(out, { recursive: true, force: true })
    for (const file of files) {
      mkdirSync(dirname(join(out, file)), { recursive: true })
      cpSync(join(work, "src", file), join(out, file))
    }
    console.log(`shadcn/${style}: ${files.length} files`)

    // Dependencies are what the sources import; versions are what the CLI installed, else the latest release.
    const text = walk(out)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n")
    for (const [, specifier] of text.matchAll(/from "([^"./][^"]*)"/g)) {
      if (specifier.startsWith("@/")) continue
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]
      if (name === "react" || name === "react-dom") continue
      dependencies.add(name)
      const manifest = join(work, "node_modules", name, "package.json")
      if (!installed.has(name) && existsSync(manifest))
        installed.set(name, `^${(JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version}`)
    }
    const declared = JSON.parse(readFileSync(join(work, "package.json"), "utf8")) as {
      dependencies: Record<string, string>
    }
    for (const [name, version] of Object.entries(declared.dependencies)) installed.set(name, version)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const path = join(repo, "packages/shadcn/package.json")
const pkg = JSON.parse(readFileSync(path, "utf8")) as {
  version: string
  dependencies: Record<string, string>
}
// The package version follows the shadcn CLI that generated it. npm never reuses a version, so a repackage of
// the same CLI release bumps the patch by hand; a newer CLI release resets it to the CLI version.
const cliVersion = upstream.cli.slice(upstream.cli.lastIndexOf("@") + 1)
if (Bun.semver.order(cliVersion, pkg.version) > 0) pkg.version = cliVersion
for (const dependency of dependencies) {
  if (installed.has(dependency)) continue
  const latest = (await (await fetch(`https://registry.npmjs.org/${dependency}/latest`)).json()) as { version: string }
  installed.set(dependency, `^${latest.version}`)
}
pkg.dependencies = Object.fromEntries(
  [...dependencies].sort().map((dependency) => [dependency, installed.get(dependency)!])
)
writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`synced ${Object.values(upstream.styles).join(", ")} with ${upstream.cli}`)
