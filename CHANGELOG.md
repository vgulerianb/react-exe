# Changelog

## 1.1.0

### Fixed

- CDN auto-resolve no longer hangs on "Loading dependencies from CDN..." in sandbox mode.
- React-based packages from the CDN (lucide-react, framer-motion, Radix, ...) now load and share your app's React instance, so hooks and context work.
- Multi-line imports, `import * as X from "pkg"` and default imports of CDN packages.
- `export default class ...`, `export default memo(...)` and anonymous default exports.
- Wildcard dependencies such as `"@/components/ui/*"` work again.
- Runtime errors inside the sandbox are shown instead of a blank preview.
- Toggling `enableTailwind` or `sandbox` no longer leaves a stale preview.
- The default security patterns no longer flag every `function()` expression.
- Previews no longer stay empty when the sandbox iframe loads before hydration (SSR).

### Changed

- Bundle size: 2.9 MB → 226 KB (644 KB → 54 KB gzipped). Babel was replaced by Sucrase, and compiles are about 15× faster.
- No bundler configuration is needed; remove `define: { "process.env": {} }` from your Vite config.
- React 19 is supported.
- In the sandbox, Tailwind loads in parallel with CDN packages, and CDN connections are opened early.
- `onError` is also called for compile, security-pattern and CDN errors.
- A failed CDN load shows an error instead of rendering with undefined imports.
- A default import of a namespace dependency now returns its `default` export when it has one (the whole namespace otherwise, as before).
- `clsx` and `tailwind-merge` are no longer dependencies.

### Added

- CSS and JSON files in multi-file projects, CSS imports from packages, `@/` and `~/` aliases, folder `index` files, re-exports and circular imports.
- Version-pinned imports, e.g. `import { format } from "date-fns@3"`.
- Error messages include the file name and a code frame.
- A dev playground (`npm run dev`) and unit tests (`npm test`).
