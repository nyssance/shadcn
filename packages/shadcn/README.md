# @nyssance/shadcn

Every shadcn/ui component, installed once as a package instead of copied into each project.

- **Upstream, unmodified.** `src/<style>` is exactly what `shadcn add --all` writes for that style. Nothing is
  renamed, reformatted or patched; a new version is a re-run of the CLI.
- **Standard imports.** Application code keeps `@/components/ui/button`, `@/hooks/use-mobile`, … and reads the
  same as a project that copied the components itself.
- **Base UI only.** Styles are published as directories named after the Base UI style: `vega` is `base-vega`.

| Directory | components.json                                                                             |
| --------- | ------------------------------------------------------------------------------------------- |
| `vega`    | `"style": "base-vega"`, `"iconLibrary": "lucide"`, `"rtl": true`, default menu color/accent |

`baseColor` and the theme tokens (`--background`, `--primary`, …) stay in the application's stylesheet.

## Setup

```sh
bun add @nyssance/shadcn
```

Vite: replace the `"@": "./src"` alias with the plugin. `@/x` resolves to the application's own `src/x` when that
file exists, so a component copied in with `shadcn add` overrides the package; otherwise it resolves to the package.

```ts
import { shadcn } from "@nyssance/shadcn/vite"

export default defineConfig({
  plugins: [shadcn({ style: "vega" }), react(), tailwindcss()]
})
```

TypeScript: the same order, as path fallbacks.

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*", "./node_modules/@nyssance/shadcn/dist/vega/*"]
    }
  }
}
```

Tailwind: scan the package.

```css
@source "../node_modules/@nyssance/shadcn/dist/vega";
```

Subpath imports work without an alias as well: `@nyssance/shadcn/vega/components/ui/button`.

## License

MIT. See THIRD_PARTY_NOTICES.md for the upstream projects.
