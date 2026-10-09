/* global process, console */
// Bundles the storefront runtime into the Theme App Extension assets.
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Plain path resolution: test DOM environments replace the global URL class.
const here = dirname(fileURLToPath(import.meta.url));
const out = (f) => resolve(here, '../../../extensions/instafeed-theme/assets', f);

export const storefrontBuildOptions = {
  entryPoints: [resolve(here, '../src/storefront/index.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  logLevel: 'warning',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build({ ...storefrontBuildOptions, outfile: out('instafeed.js') });
  // hls.js (light build) is lazy-loaded only for hosted video in browsers without native HLS.
  const require = createRequire(import.meta.url);
  copyFileSync(require.resolve('hls.js/dist/hls.light.min.js'), out('instafeed-hls.js'));
  console.warn('[widget-sdk] built extensions/instafeed-theme/assets');
}
