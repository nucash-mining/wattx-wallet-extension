import esbuild from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';

await esbuild.build({
  entryPoints: ['src/background.js', 'src/content.js', 'src/inpage.js'],
  bundle: true,
  format: 'esm',
  outdir: 'dist',
  define: { global: 'globalThis' },
  inject: ['./buffer-shim.js'],
  plugins: [polyfillNode({ polyfills: { crypto: true, events: true, stream: true, buffer: true } })],
  logLevel: 'info',
});
console.log('built dist/');
