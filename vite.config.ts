import { defineConfig } from 'vite';
import logseqDevPlugin from 'vite-plugin-logseq';

export default defineConfig({
  plugins: [logseqDevPlugin()],
  // Logseq loads the plugin from the local filesystem, so asset paths must be relative.
  base: './',
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
});
