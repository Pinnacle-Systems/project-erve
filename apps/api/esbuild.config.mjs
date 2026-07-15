// Bundles the production API into a single self-contained ESM file.
//
// This exists because @erve/shared and @erve/types are TypeScript-source-only
// workspace packages (no build step, `exports` point at `src/index.ts`) and
// are real runtime dependencies of the API, not just types. The normal `tsc`
// build (`pnpm build`) only compiles apps/api/src and leaves
// `import ... from '@erve/shared'` as a bare specifier that plain `node`
// cannot resolve through a TS-source workspace symlink. Bundling inlines
// that workspace source directly into the output so the production runtime
// needs no TS loader and no workspace symlinks. This does not replace or
// change the existing `tsc`-based build/typecheck/dev workflow — it is an
// additional, deploy-only output.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// Anything that is a real npm package stays external and is installed for
// real in the production artifact; only @erve/* workspace source gets
// inlined into the bundle.
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@erve/'));

await build({
  entryPoints: [
    { in: path.join(__dirname, 'src/server.ts'), out: 'server' },
    // Same bundling approach as the server: a self-contained ESM CLI so
    // the production artifact needs no TS loader/devDependencies to run
    // the admin bootstrap command (see DEPLOYMENT.md).
    { in: path.join(__dirname, 'src/cli/admin-bootstrap.cli.ts'), out: 'admin-bootstrap' },
    { in: path.join(__dirname, 'src/cli/roles-bootstrap.cli.ts'), out: 'roles-bootstrap' },
  ],
  outdir: path.join(__dirname, 'dist-bundle'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  external,
  logLevel: 'info',
});
