// Builds every style of every package. Registry sources keep their standard `@/` aliases; they resolve to the
// same style inside the package.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const check = process.argv.includes("--check")
const styles = readdirSync(join(repo, "packages/shadcn/src"))
const EXTENSIONS = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
}
function local(dir: string, rest: string): string | undefined {
  return EXTENSIONS.map((extension) => join(dir, rest + extension)).find(
    (candidate) => existsSync(candidate) && !readdirSafe(candidate)
  )
}
function readdirSafe(path: string): boolean {
  try {
    readdirSync(path)
    return true
  } catch {
    return false
  }
}
function tsc(root: string, options: Record<string, unknown>, include: string[]): void {
  const temporary = mkdtempSync(join(root, ".ts-build-"))
  try {
    const config = join(temporary, "tsconfig.json")
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ESNext", "DOM", "DOM.Iterable"],
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          isolatedModules: true,
          types: [],
          ...options
        },
        include
      })
    )
    const result = Bun.spawnSync(["bunx", "--bun", "--no-install", "tsc", "-p", config], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit"
    })
    if (result.exitCode !== 0) throw new Error(`tsc failed (${result.exitCode}): ${root}`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

for (const name of ["shadcn"]) {
  const root = join(repo, "packages", name)
  const dist = join(root, "dist")
  if (!check) rmSync(dist, { recursive: true, force: true })
  for (const style of styles) {
    const src = join(root, "src", style)
    const out = join(dist, style)
    // `@/x` resolves inside this style first; ReUI falls back to the shadcn package of the same style.
    const target = (rest: string): { path: string; external?: true } => {
      const file = local(src, rest)
      if (file) return { path: file }
      throw new Error(`${name}/${style}: alias has no file: @/${rest}`)
    }
    const paths = { "@/*": [`${src}/*`] }
    if (check) {
      tsc(root, { noEmit: true, paths }, [src])
      continue
    }
    tsc(
      root,
      {
        paths,
        rootDir: src,
        outDir: out,
        declaration: true,
        emitDeclarationOnly: true,
        removeComments: false
      },
      [src]
    )
    // One output file per source file, never bundled: each component stays a single module instance,
    // so shared React contexts (tooltip, sidebar, …) are not duplicated across entries.
    const transpiler = new Bun.Transpiler({
      loader: "tsx",
      target: "browser",
      autoImportJSX: true,
      tsconfig: { compilerOptions: { jsx: "react-jsx" } }
    })
    for (const file of walk(src).filter((file) => /\.tsx?$/.test(file))) {
      const output = join(out, relative(src, file)).replace(/\.tsx?$/, ".js")
      const code = transpiler
        .transformSync(readFileSync(file, "utf8"))
        .replace(
          /(from\s*|import\s*\(\s*|import\s+)"(@\/[^"]+|\.{1,2}\/[^"]+)"/g,
          (_match, lead: string, specifier: string) => {
            const resolved = specifier.startsWith("@/")
              ? target(specifier.slice(2)).path
              : resolve(dirname(file), specifier)
            let path = relative(dirname(file), resolved)
              .split(sep)
              .join("/")
              .replace(/\.tsx?$/, ".js")
            if (!path.endsWith(".js") && !path.endsWith(".css")) path += ".js"
            if (!path.startsWith(".")) path = `./${path}`
            return `${lead}"${path}"`
          }
        )
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(output, code)
    }
    for (const file of walk(src).filter((file) => file.endsWith(".css"))) {
      mkdirSync(dirname(join(out, relative(src, file))), { recursive: true })
      cpSync(file, join(out, relative(src, file)))
    }
    for (const file of walk(out).filter((file) => file.endsWith(".d.ts"))) {
      const text = readFileSync(file, "utf8")
      const rewritten = text.replace(/(from |import\()"@\/([^"]+)"/g, (_match, lead: string, rest: string) => {
        const resolved = target(rest)
        if (resolved.external) return `${lead}"${resolved.path}"`
        let path = relative(dirname(file), join(out, rest)).split(sep).join("/")
        if (!path.startsWith(".")) path = `./${path}`
        return `${lead}"${path}"`
      })
      if (rewritten !== text) writeFileSync(file, rewritten)
    }
    for (const file of walk(out)) {
      if (file.endsWith(".js") && readFileSync(file, "utf8").includes("react/jsx-dev-runtime"))
        throw new Error(`Development JSX: ${file}`)
      if (/\.(js|d\.ts)$/.test(file) && /["']@\//.test(readFileSync(file, "utf8")))
        throw new Error(`Unresolved alias in output: ${file}`)
    }
  }
  if (name === "shadcn" && !check) {
    const plugin = join(root, "plugin")
    tsc(
      root,
      {
        rootDir: plugin,
        outDir: dist,
        declaration: true,
        emitDeclarationOnly: true
      },
      [plugin]
    )
    const built = await Bun.build({
      entrypoints: [join(plugin, "vite.ts")],
      outdir: dist,
      target: "node",
      format: "esm",
      packages: "external"
    })
    if (!built.success) throw new AggregateError(built.logs, "vite plugin build failed")
  }
  if (!check) console.log(`@nyssance/${name}: ${walk(dist).length} files`)
}
if (check) console.log("typecheck passed")
